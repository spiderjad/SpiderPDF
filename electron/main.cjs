const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, nativeTheme, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { verifyPdfSignatures } = require('./sigverify.cjs');
const recents = require('./recents.cjs');
const { writeAtomic } = require('./fsutil.cjs');
const { migrateLegacyData } = require('./migrate.cjs');
const { createShare } = require('./share.cjs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DIST = path.join(__dirname, '..', 'dist');
const isMac = process.platform === 'darwin';
const APP_NAME = 'SpiderPDF'; // = productName en package.json
const APP_ID = 'com.diego.spiderpdf'; // = build.appId (AppUserModelId en Windows)
// Icono de la ventana (en Windows y Linux; en macOS lo pone el paquete .app). Empaquetado, build/icon.* va en «files».
const WINDOW_ICON = isMac ? undefined : path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// En producción la interfaz se sirve desde app://local/ (no file://):
// así funcionan fetch del .wasm, los módulos y el Worker, con una CSP estricta.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
].join('; ');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
};

let win = null;
let dirty = false;
const pendingPaths = [];

// Pruebas e2e: carpeta de datos propia (y con ella su propio candado de instancia única), para no
// chocar con la app abierta ni tocar las preferencias del usuario. Solo sin empaquetar.
// Nombre de la app en el diálogo de impresión, la barra de tareas y las notificaciones (también en desarrollo,
// donde si no sería «Electron»). Va antes de todo: la carpeta de datos (userData) sale del nombre.
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID); // = build.appId
const E2E = !!process.env.SPIDERPDF_USER_DATA && !app.isPackaged;
if (E2E) app.setPath('userData', process.env.SPIDERPDF_USER_DATA);
/** Registro de eventos del proceso principal, solo en las pruebas e2e (<userData>/e2e.log). */
const e2eLog = (...a) => {
  if (E2E) require('node:fs').appendFileSync(path.join(app.getPath('userData'), 'e2e.log'), `${new Date().toISOString()} pid=${process.pid} ${a.join(' ')}\n`);
};

// Una sola instancia: abrir un .pdf con la app ya abierta lo manda a la misma ventana.
const gotLock = app.requestSingleInstanceLock();
e2eLog('arranque; candado:', gotLock, 'argv:', JSON.stringify(process.argv.slice(1)));
if (!gotLock) app.quit();

// Datos de la versión anterior («PDF Editor»): recientes y firmas guardadas, una sola vez (electron/migrate.cjs).
// En las pruebas e2e solo con SPIDERPDF_LEGACY_DATA (nunca la carpeta real del usuario).
if (gotLock) {
  const legacy = E2E ? process.env.SPIDERPDF_LEGACY_DATA : path.join(app.getPath('appData'), 'PDF Editor');
  const migrated = migrateLegacyData(legacy, app.getPath('userData'));
  if (migrated.done) e2eLog('migración:', JSON.stringify(migrated));
}

const pdfPaths = (argv) => argv.filter((a) => a.toLowerCase().endsWith('.pdf'));
pendingPaths.push(...pdfPaths(process.argv.slice(1)));

app.on('second-instance', (_e, argv) => {
  e2eLog('second-instance', JSON.stringify(argv.slice(1)));
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  sendFiles(pdfPaths(argv));
});

// macOS: doble clic en un PDF o arrastrarlo al icono del Dock.
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (win && !win.webContents.isLoading()) sendFiles([filePath]);
  else pendingPaths.push(filePath);
});

async function readPdfs(paths) {
  return Promise.all(paths.map(async (p) => {
    try {
      return { name: path.basename(p), path: p, bytes: await fs.readFile(p) };
    } catch (e) {
      return { name: path.basename(p), path: p, error: `No se pudo leer el archivo: ${e.code || e.message}` };
    }
  }));
}

async function sendFiles(paths) {
  if (paths.length && win) win.webContents.send('files:incoming', await readPdfs(paths));
}

const send = (cmd, arg) => () => win?.webContents.send('menu', arg === undefined ? cmd : { cmd, arg });

// --- Archivos recientes (ver recents.cjs) ---------------------------------------
let recentList = [];
const recentsDir = () => app.getPath('userData');
async function setRecents(list) {
  recentList = list;
  // Si no se puede escribir, la lista vale para esta sesión (y se intenta de nuevo en el siguiente cambio).
  await recents.save(recentsDir(), list, { onRetry: (e, i) => e2eLog('recientes: reintento', i, e.code) })
    .catch((e) => e2eLog('recientes: no se pudo guardar', e.code ?? e.message));
  win?.webContents.send('recents:changed', recentList);
  buildMenu();
}

// Archivo, Editar y Ver se definen una sola vez en menu.json.
// macOS: menú nativo (la barra del sistema). Windows y Linux: sin menú nativo; la interfaz
// dibuja su propia barra con el mismo contenido y gestiona los atajos de teclado.
const MENU = require('./menu.json');

function buildMenu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  const item = (it) => {
    if (it === '-' || it.sep) return (it.dev && app.isPackaged) ? null : { type: 'separator' };
    if (it.dev && app.isPackaged) return null;
    const m = { ...it, ...(it.mac ?? {}) };
    if (m.submenu === 'recents') {
      return {
        label: m.label,
        submenu: recentList.length
          ? [...recentList.map((r) => ({ label: r.name, click: send('openRecent', r.path) })), { type: 'separator' }, { label: 'Borrar lista', click: send('clearRecents') }]
          : [{ label: 'Sin archivos recientes', enabled: false }],
      };
    }
    const out = { label: m.label };
    if (m.accel) out.accelerator = m.accel;
    if (m.role) out.role = m.role;
    else out.click = send(m.cmd);
    return out;
  };
  const template = [
    { role: 'appMenu' },
    ...MENU.map((menu) => ({ label: menu.label, submenu: menu.items.map(item).filter(Boolean) })),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Colores de la barra de título (los botones de ventana los pinta Windows).
const TITLEBAR_H = 40;
const overlayColors = () => (nativeTheme.shouldUseDarkColors
  ? { color: '#0E0E11', symbolColor: '#F5F5F5' }
  : { color: '#FFFFFF', symbolColor: '#121216' });

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: APP_NAME,
    ...(WINDOW_ICON ? { icon: WINDOW_ICON } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0E0E11' : '#FFFFFF',
    ...(isMac ? {} : { titleBarStyle: 'hidden', titleBarOverlay: { ...overlayColors(), height: TITLEBAR_H } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  // La app nunca navega fuera ni abre ventanas nuevas.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Salir sin guardar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      message: 'Hay cambios sin guardar',
      detail: 'Si cierras ahora, se perderán los cambios hechos en las páginas.',
    });
    if (choice === 1) e.preventDefault();
  });
  win.on('closed', () => { win = null; dirty = false; });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('app://local/index.html');
}

// --- IPC -----------------------------------------------------------------
// Versión del contrato con la interfaz (= DESKTOP_API de src/desktop.js y apiVersion del preload).
const DESKTOP_API = 5;
ipcMain.handle('app:apiVersion', () => DESKTOP_API);

const isPdfPath = (p) => typeof p === 'string' && path.isAbsolute(p) && /\.pdf$/i.test(p);

ipcMain.handle('recents:list', () => recentList);
// La interfaz avisa de cada PDF abierto o guardado con ruta.
ipcMain.handle('recents:add', async (_e, filePath) => {
  e2eLog('recents:add', filePath, 'lista antes:', recentList.map((r) => r.name).join(','));
  if (!isPdfPath(filePath)) return recentList;
  app.addRecentDocument(filePath); // Lista de accesos directos (Windows) y menú del Dock (macOS)
  await setRecents(recents.addRecent(recentList, filePath));
  return recentList;
});
// Solo abre rutas que están en la lista: la interfaz no puede pedir archivos cualesquiera.
ipcMain.handle('recents:open', async (_e, filePath) => {
  const known = recentList.find((r) => recents.samePath(r.path, filePath));
  if (!known) return { missing: true, name: path.basename(String(filePath)) };
  try {
    await fs.access(known.path);
  } catch {
    await setRecents(recents.removeRecent(recentList, known.path));
    return { missing: true, name: known.name };
  }
  return { entries: await readPdfs([known.path]) };
});
ipcMain.handle('recents:clear', async () => {
  app.clearRecentDocuments();
  await setRecents([]);
  return recentList;
});

// --- Imprimir ------------------------------------------------------------------------
// El diálogo de impresión es de la app (src/components/PrintDialog.jsx). La interfaz manda cada página ya
// renderizada (JPEG a 300 ppp) con su caja en la hoja (rotate, x, y, w, h en puntos, ver src/printLayout.js);
// aquí se escriben en una carpeta temporal y se imprimen por lotes, cada lote en una ventana oculta sin
// JavaScript que se destruye al acabar: así la memoria no crece con el número de páginas.
const printJobs = new Map();
let printSeq = 0;
const DUPLEX = new Set(['simplex', 'longEdge', 'shortEdge']);
const PAGE_SIZES = new Set(['A3', 'A4', 'Letter', 'Legal']);
const num = (v, min, max) => { const n = Number(v); if (!(n >= min && n <= max)) throw new Error('Opción de impresión no válida.'); return n; };

// Impresoras instaladas. Pruebas e2e (sin empaquetar): globalThis.__spiderPdfPrintersHook.
ipcMain.handle('print:printers', async () => {
  const hook = !app.isPackaged && globalThis.__spiderPdfPrintersHook;
  const list = hook ? await hook() : await win.webContents.getPrintersAsync();
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault, options: p.options ?? {} }));
});

ipcMain.handle('print:begin', async (_e, o = {}) => {
  const opts = {
    title: String(o.title ?? APP_NAME).slice(0, 200),
    paper: { w: num(o.paper?.w, 100, 5000), h: num(o.paper?.h, 100, 5000), size: PAGE_SIZES.has(o.paper?.size) ? o.paper.size : 'A4' },
    deviceName: typeof o.deviceName === 'string' ? o.deviceName : '',
    copies: Math.round(num(o.copies ?? 1, 1, 999)),
    color: o.color !== false,
    duplex: DUPLEX.has(o.duplex) ? o.duplex : 'simplex',
    system: !!o.system, // «Configuración avanzada»: el diálogo del sistema en vez de imprimir directamente
    batch: Math.round(num(o.batch ?? 24, 2, 200)),
  };
  const id = ++printSeq;
  printJobs.set(id, { dir: await fs.mkdtemp(path.join(os.tmpdir(), 'spiderpdf-imprimir-')), pages: [], opts });
  return id;
});

ipcMain.handle('print:page', async (_e, id, page) => {
  const job = printJobs.get(id);
  if (!job || !(page?.jpg instanceof Uint8Array)) throw new Error('Página de impresión no válida.');
  const b = page.box ?? {};
  const box = { rotate: b.rotate === 90 ? 90 : 0, x: num(b.x, -5000, 5000), y: num(b.y, -5000, 5000), w: num(b.w, 1, 10000), h: num(b.h, 1, 10000) };
  const name = `p${job.pages.length + 1}.jpg`;
  await fs.writeFile(path.join(job.dir, name), Buffer.from(page.jpg));
  job.pages.push({ name, box });
});

ipcMain.handle('print:cancel', async (_e, id) => {
  const job = printJobs.get(id);
  printJobs.delete(id);
  if (job) await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
});

/** HTML de un lote: una hoja (del papel elegido) por página, con la página colocada en su caja. */
function sheetsHtml(title, paper, pages) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pt = (v) => `${v.toFixed(3)}pt`;
  const img = ({ name, box: { rotate, x, y, w, h } }) => {
    // Girada 90°: la imagen (sin girar) mide h × w y se gira alrededor del centro de la caja.
    const [iw, ih] = rotate ? [h, w] : [w, h];
    const left = x + w / 2 - iw / 2;
    const top = y + h / 2 - ih / 2;
    const rot = rotate ? 'transform: rotate(90deg);' : '';
    return `<div class="sheet"><img src="${name}" alt="" style="left:${pt(left)};top:${pt(top)};width:${pt(iw)};height:${pt(ih)};${rot}"></div>`;
  };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: ${pt(paper.w)} ${pt(paper.h)}; margin: 0 }
html, body { margin: 0; padding: 0; background: #fff }
.sheet { position: relative; width: ${pt(paper.w)}; height: ${pt(paper.h)}; overflow: hidden; break-after: page }
.sheet:last-child { break-after: auto }
.sheet img { position: absolute; display: block }
</style></head><body>
${pages.map(img).join('\n')}
</body></html>`;
}

/** Imprime unas hojas en una ventana oculta que se destruye al acabar. → { ok, cancelled, error } */
async function printSheets(job, pages, part, options) {
  const pw = new BrowserWindow({ show: false, title: APP_NAME, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    const html = path.join(job.dir, `lote-${part}.html`);
    await fs.writeFile(html, sheetsHtml(job.opts.title, job.opts.paper, pages));
    await pw.loadFile(html);
    // Pruebas e2e (solo sin empaquetar): imprimir a PDF en vez de a una impresora.
    const hook = !app.isPackaged && globalThis.__spiderPdfPrintHook;
    if (hook) return await hook(pw.webContents, options, part);
    e2eLog('imprimir lote', part, JSON.stringify({ ...options, margins: undefined }));
    return await new Promise((resolve) => {
      pw.webContents.print(options, (ok, reason) => {
        e2eLog('imprimir lote', part, 'respuesta:', ok, reason ?? '');
        // Con el diálogo del sistema, «cancel» es que el usuario canceló. En silencio nadie cancela: es un error
        // (p. ej. la impresora necesitaba mostrar una ventana y no pudo).
        const userCancel = !ok && !options.silent && /cancel/i.test(String(reason));
        resolve({ ok, cancelled: userCancel, error: ok || userCancel ? null : 'La impresora no aceptó el trabajo.' });
      });
    });
  } finally {
    pw.destroy();
  }
}

ipcMain.handle('print:run', async (e, id) => {
  const job = printJobs.get(id);
  if (!job || !job.pages.length) throw new Error('No hay páginas que imprimir.');
  printJobs.delete(id);
  const o = job.opts;
  const base = {
    printBackground: true, margins: { marginType: 'none' }, pageSize: o.paper.size, landscape: false,
    color: o.color, duplexMode: o.duplex, collate: true,
  };
  try {
    // Configuración avanzada: un único trabajo con el diálogo del sistema (opciones del controlador).
    if (o.system) {
      return await printSheets(job, job.pages, 1, { ...base, silent: false, deviceName: o.deviceName || undefined, copies: o.copies });
    }
    // Por lotes. Con varias copias y varios lotes, el documento entero se repite por copia (copias intercaladas).
    const parts = [];
    for (let i = 0; i < job.pages.length; i += o.batch) parts.push(job.pages.slice(i, i + o.batch));
    const rounds = parts.length > 1 ? o.copies : 1;
    const copies = parts.length > 1 ? 1 : o.copies;
    const total = parts.length * rounds;
    let done = 0;
    for (let r = 0; r < rounds; r++) {
      for (const pages of parts) {
        const res = await printSheets(job, pages, done + 1, { ...base, silent: true, deviceName: o.deviceName, copies });
        if (!res.ok) return res;
        done++;
        e.sender.send('print:progress', { done, total });
      }
    }
    return { ok: true, jobs: total };
  } finally {
    fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }
});

ipcMain.handle('dialog:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Abrir PDF',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }],
  });
  return res.canceled ? [] : readPdfs(res.filePaths);
});

ipcMain.handle('files:pending', async () => readPdfs(pendingPaths.splice(0)));

// Solo elige dónde guardar (sin escribir): la interfaz decide si hace falta confirmar antes.
ipcMain.handle('dialog:saveAs', async (_e, { defaultPath } = {}) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Guardar PDF',
    defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
    filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
  });
  return res.canceled || !res.filePath ? null : res.filePath;
});

// --- Compartir (ver share.cjs) ---------------------------------------------------------------
// En las pruebas e2e (solo sin empaquetar), globalThis.__spiderPdfShareHook puede sustituir lo que sale de la app:
// { openExternal(url), reveal(path), installed: [protocolos con app], mail(id, subject) → respuesta del ayudante }.
const shareHook = () => (app.isPackaged ? null : globalThis.__spiderPdfShareHook ?? null);
const share = createShare({
  app: {
    isPackaged: app.isPackaged,
    getApplicationNameForProtocol: (u) => {
      const h = shareHook();
      if (h && 'installed' in h) return h.installed.includes(u) ? 'app' : '';
      return app.getApplicationNameForProtocol(u);
    },
  },
  shell: {
    openExternal: (u) => (shareHook()?.openExternal ? shareHook().openExternal(u) : shell.openExternal(u)),
    showItemInFolder: (p) => (shareHook()?.reveal ? shareHook().reveal(p) : shell.showItemInFolder(p)),
  },
  log: e2eLog,
});
app.on('will-quit', () => share.cleanup());
ipcMain.handle('share:prepare', (_e, o = {}) => {
  if (o.bytes && !(o.bytes instanceof Uint8Array) && !(o.bytes instanceof ArrayBuffer)) throw new Error('Se esperaban los bytes del PDF.');
  return share.prepare({ bytes: o.bytes, from: typeof o.from === 'string' ? o.from : undefined, name: o.name });
});
ipcMain.handle('share:copyFile', (_e, id) => share.copyFile(String(id)));
ipcMain.handle('share:mail', (_e, id, subject) => {
  const h = shareHook();
  return h?.mail ? h.mail(String(id), String(subject ?? '')) : share.mail(String(id), subject);
});
ipcMain.handle('share:reveal', (_e, id) => share.reveal(String(id)));
ipcMain.handle('share:whatsapp', (_e, id) => share.whatsapp(String(id)));
ipcMain.handle('share:ai', (_e, id, provider) => share.ai(String(id), String(provider)));

// Integridad de las firmas digitales (ver sigverify.cjs). Recibe los bytes del PDF tal como se abrió.
ipcMain.handle('pdf:verifySignatures', (_e, bytes) => {
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new Error('Se esperaban los bytes del PDF.');
  return verifyPdfSignatures(Buffer.from(bytes));
});

ipcMain.handle('file:save', async (_e, { bytes, path: target, suggestedName }) => {
  let filePath = target;
  if (!filePath) {
    const res = await dialog.showSaveDialog(win, {
      title: 'Guardar PDF',
      defaultPath: suggestedName,
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    filePath = res.filePath;
  }
  // Escritura segura: primero a un temporal y luego se reemplaza el original (con reintentos si Windows
  // lo tiene bloqueado un instante: antivirus, indexador, OneDrive…).
  await writeAtomic(filePath, Buffer.from(bytes), { onRetry: (e, i) => e2eLog('guardar: reintento', i, e.code) });
  return { path: filePath, name: path.basename(filePath) };
});

ipcMain.on('state:dirty', (_e, value) => {
  dirty = !!value;
  if (isMac) win?.setDocumentEdited(dirty);
});
ipcMain.on('state:title', (_e, title) => win?.setTitle(String(title)));

// Acciones de sistema pedidas desde la barra de menús propia (Windows y Linux).
ipcMain.on('menu:role', (_e, role) => {
  if (!win) return;
  if (role === 'quit') win.close(); // pasa por el aviso de cambios sin guardar
  else if (role === 'toggleDevTools' && !app.isPackaged) win.webContents.toggleDevTools();
  else if (role === 'reload' && !app.isPackaged) win.webContents.reload();
});

nativeTheme.on('updated', () => {
  if (win && !isMac) win.setTitleBarOverlay({ ...overlayColors(), height: TITLEBAR_H });
});

// --- Ciclo de vida -----------------------------------------------------------
app.whenReady().then(async () => {
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('No encontrado', { status: 404 });
    try {
      const body = await fs.readFile(file);
      return new Response(body, {
        headers: {
          'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
          'Content-Security-Policy': CSP,
        },
      });
    } catch {
      return new Response('No encontrado', { status: 404 });
    }
  });
  recentList = await recents.load(recentsDir());
  e2eLog('listo; recientes cargados:', recentList.map((r) => r.name).join(','));
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
