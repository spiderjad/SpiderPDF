const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, nativeTheme, shell, clipboard, screen, nativeImage, ClipboardItem } = require('electron');
const { ShareMenu } = require('electron'); // solo existe en macOS (menú Compartir del sistema)
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { verifyPdfSignatures } = require('./sigverify.cjs');
const recents = require('./recents.cjs');
const { writeAtomic } = require('./fsutil.cjs');
const { migrateLegacyData } = require('./migrate.cjs');
const { createShare } = require('./share.cjs');
const session = require('./session.cjs');
const { createUpdater } = require('./updater.cjs');

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

// Ventanas de la app (las ocultas de imprimir no cuentan). Cada una tiene sus pestañas (la interfaz informa con
// «tabs:report») y su propio aviso de cambios sin guardar. webContents.id → {
//   win, dirty (nº de pestañas con cambios), tabs: [ruta], active, remember (Preferencias → recordar pestañas),
//   pending: [rutas] que abrirá al cargar, snapshot: pestaña que llega de otra ventana, adopt: respuesta para esa otra }
const windows = new Map();
let lastFocused = null;
let quitting = false; // Salir: las ventanas que se cierran siguen en la sesión
let discardOnQuit = false; // «Reiniciar sin guardar» para actualizar: ya se confirmó, no se vuelve a preguntar
const argvPaths = [];

// Pruebas e2e: carpeta de datos propia (y con ella su propio candado de instancia única), para no
// chocar con la app abierta ni tocar las preferencias del usuario. Solo sin empaquetar.
// Nombre de la app en el diálogo de impresión, la barra de tareas y las notificaciones (también en desarrollo,
// donde si no sería «Electron»). Va antes de todo: la carpeta de datos (userData) sale del nombre.
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID); // = build.appId

// Línea de órdenes «--html-a-pdf» (electron/htmlpdf.cjs): convierte sin ventana y sale. Antes del candado de
// instancia única (con la app abierta, si no, la orden iría a esa ventana) y de todo lo demás (sesión, recientes,
// actualizaciones). Un «return» en lo alto de un módulo CommonJS termina el módulo.
const htmlpdf = require('./htmlpdf.cjs');
if (htmlpdf.wanted(process.argv)) {
  htmlpdf.runCli(require('electron'), require('./i18n.cjs'));
  return;
}

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
argvPaths.push(...pdfPaths(process.argv.slice(1)));

const infoOf = (e) => windows.get(e.sender.id) ?? null;
const winOf = (e) => BrowserWindow.fromWebContents(e.sender);
const alive = (w) => !!w && !w.isDestroyed();
/** Ventana a la que va lo que llega de fuera: la que tiene el foco, o la última que lo tuvo. */
function targetWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windows.has(focused.webContents.id)) return focused;
  if (alive(lastFocused)) return lastFocused;
  return [...windows.values()].map((x) => x.win).find(alive) ?? null;
}
function show(w) {
  if (w.isMinimized()) w.restore();
  w.focus();
}

/**
 * PDFs que hay que abrir en una ventana (target). Los que ya están abiertos en alguna pestaña se muestran allí
 * (esa ventana pasa al frente y activa la pestaña); los demás se devuelven para abrirlos en target.
 */
function routeOpen(paths, target) {
  const list = [...windows.entries()].map(([id, x]) => ({ id, tabs: x.tabs }));
  const { owned, free } = session.owners(paths, list);
  for (const [id, own] of owned) {
    const x = windows.get(id);
    if (!alive(x?.win)) { free.push(...own); continue; }
    if (x.win === target) { free.push(...own); continue; } // en la misma ventana: la interfaz activa la pestaña
    show(x.win);
    for (const p of own) x.win.webContents.send('tabs:activate', p);
    e2eLog('ya abierto en otra ventana:', own.join(', '));
  }
  return free;
}

app.on('second-instance', (_e, argv) => {
  e2eLog('second-instance', JSON.stringify(argv.slice(1)));
  const target = targetWindow();
  if (!target) return;
  const free = routeOpen(pdfPaths(argv), target);
  if (free.length || !pdfPaths(argv).length) show(target);
  sendFiles(target, free);
});

// macOS: doble clic en un PDF o arrastrarlo al icono del Dock.
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  const target = targetWindow();
  if (target && !target.webContents.isLoading()) sendFiles(target, routeOpen([filePath], target));
  else argvPaths.push(filePath);
});

async function readPdfs(paths) {
  return Promise.all(paths.map(async (p) => {
    try {
      return { name: path.basename(p), path: p, bytes: await fs.readFile(p) };
    } catch (e) {
      return { name: path.basename(p), path: p, error: T('file.readFailed', { reason: e.code || e.message }) };
    }
  }));
}

async function sendFiles(w, paths) {
  if (paths.length && alive(w)) w.webContents.send('files:incoming', await readPdfs(paths));
}

const send = (cmd, arg) => () => targetWindow()?.webContents.send('menu', arg === undefined ? cmd : { cmd, arg });
const broadcast = (channel, value) => { for (const x of windows.values()) if (alive(x.win)) x.win.webContents.send(channel, value); };

// --- Archivos recientes (ver recents.cjs) ---------------------------------------
let recentList = [];
const recentsDir = () => app.getPath('userData');
async function setRecents(list) {
  recentList = list;
  // Si no se puede escribir, la lista vale para esta sesión (y se intenta de nuevo en el siguiente cambio).
  await recents.save(recentsDir(), list, { onRetry: (e, i) => e2eLog('recientes: reintento', i, e.code) })
    .catch((e) => e2eLog('recientes: no se pudo guardar', e.code ?? e.message));
  broadcast('recents:changed', recentList);
  buildMenu();
}

// Archivo, Editar y Ver se definen una sola vez en menu.json.
// macOS: menú nativo (la barra del sistema). Windows y Linux: sin menú nativo; la interfaz
// dibuja su propia barra con el mismo contenido y gestiona los atajos de teclado.
const MENU = require('./menu.json');
const i18n = require('./i18n.cjs');
const { T } = i18n;

// macOS: el menú de la app (SpiderPDF → Acerca de, Preferencias, Ocultar, Salir) y Ventana, traducidos; los de
// Electron por defecto salen en inglés. Preferencias va aquí (Cmd+,) y no en Editar, como en toda app de Mac.
function buildMenu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  const item = (it) => {
    if (it === '-' || it.sep) return (it.dev && app.isPackaged) ? null : { type: 'separator' };
    if (it.dev && app.isPackaged) return null;
    const m = { ...it, ...(it.mac ?? {}) };
    if (m.hidden) return null;
    if (m.submenu === 'recents') {
      return {
        label: i18n.label(m.label),
        submenu: recentList.length
          ? [...recentList.map((r) => ({ label: r.name, click: send('openRecent', r.path) })), { type: 'separator' }, { label: T('menu.clearRecents'), click: send('clearRecents') }]
          : [{ label: T('menu.noRecents'), enabled: false }],
      };
    }
    const out = { label: i18n.label(m.label) };
    if (m.accel) out.accelerator = m.accel;
    if (m.role) out.role = m.role;
    else out.click = send(m.cmd);
    return out;
  };
  const prefs = MENU.flatMap((menu) => menu.items).find((it) => it.cmd === 'prefs');
  const name = { app: APP_NAME };
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: T('mac.about', name) },
        { type: 'separator' },
        { label: i18n.label(prefs?.label) || T('mac.preferences'), accelerator: 'Cmd+,', click: send('prefs') },
        { type: 'separator' },
        { role: 'services', label: T('mac.services') },
        { type: 'separator' },
        { role: 'hide', label: T('mac.hide', name) },
        { role: 'hideOthers', label: T('mac.hideOthers') },
        { role: 'unhide', label: T('mac.showAll') },
        { type: 'separator' },
        { role: 'quit', label: T('mac.quit', name) },
      ],
    },
    ...MENU.map((menu) => ({ label: i18n.label(menu.label), submenu: menu.items.map(item).filter(Boolean) })),
    {
      label: T('mac.window'),
      role: 'window',
      submenu: [
        { role: 'minimize', label: T('mac.minimize') },
        { role: 'zoom', label: T('mac.zoom') },
        { type: 'separator' },
        { role: 'front', label: T('mac.front') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Colores de la barra de título (los botones de ventana los pinta Windows).
const TITLEBAR_H = 40;
const overlayColors = () => (nativeTheme.shouldUseDarkColors
  ? { color: '#0A0A0A', symbolColor: '#EDEDED' } // = --sp-bg / --sp-text-primary de spider-ui (oscuro)
  : { color: '#FFFFFF', symbolColor: '#0A0A0A' });

/** Ventana nueva cerca de un punto de la pantalla (donde se soltó una pestaña), sin salirse del área de trabajo. */
function boundsNear(point, width, height) {
  const p = { x: Math.round(Number(point?.x) || 0), y: Math.round(Number(point?.y) || 0) };
  const area = screen.getDisplayNearestPoint(p).workArea;
  const w = Math.min(width, area.width);
  const h = Math.min(height, area.height);
  // La pestaña queda bajo el puntero: la barra de pestañas está a unos 50 px del borde de arriba.
  const x = Math.min(Math.max(area.x, p.x - 120), area.x + area.width - w);
  const y = Math.min(Math.max(area.y, p.y - 56), area.y + area.height - h);
  return { x, y, width: w, height: h };
}

/**
 * Ventana de la app. pending: PDFs que abre al cargar (los de una ventana de la sesión anterior); snapshot:
 * pestaña que llega de otra ventana (tab:detach).
 */
function createWindow({ bounds = null, pending = [], snapshot = null } = {}) {
  const win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 860,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: APP_NAME,
    ...(WINDOW_ICON ? { icon: WINDOW_ICON } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0A0A0A' : '#FFFFFF',
    ...(isMac ? {} : { titleBarStyle: 'hidden', titleBarOverlay: { ...overlayColors(), height: TITLEBAR_H } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const id = win.webContents.id;
  windows.set(id, { win, dirty: 0, tabs: [], active: 0, remember: false, pending: [...pending], snapshot, adopt: null, first: windows.size === 0 });
  lastFocused ??= win;
  win.on('focus', () => { lastFocused = win; });
  win.once('ready-to-show', () => win.show());

  // La app nunca navega fuera ni abre ventanas nuevas.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    const n = windows.get(id)?.dirty ?? 0;
    if (!n || discardOnQuit) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: [T('quit.discard'), T('quit.cancel')],
      defaultId: 1,
      cancelId: 1,
      message: n > 1 ? T('quit.messageMany', { count: n }) : T('quit.message'),
      detail: n > 1 ? T('quit.detailMany') : T('quit.detail'),
    });
    if (choice === 1) { e.preventDefault(); quitting = false; } // canceló: si era Salir, ya no se sale
  });
  win.on('closed', () => {
    const x = windows.get(id);
    windows.delete(id);
    if (lastFocused === win) lastFocused = null;
    x?.adopt?.({ ok: false }); // se cerró antes de recibir la pestaña: se queda en la ventana de la que salía
    // Cerrar una ventana (y no la app): sus pestañas ya no son de la sesión. Al salir, o si era la última, sí.
    if (!quitting && windows.size > 0 && x?.remember) writeSession();
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('app://local/index.html');
  return win;
}

// --- Pestañas y sesión (ver session.cjs) ------------------------------------------------------------
// La interfaz informa de sus pestañas con archivo cada vez que cambian. Con «Recordar las pestañas abiertas»
// (Preferencias), se guardan en sesion.json; las escrituras van en cola para que no se pisen.
let sessionWrite = Promise.resolve();
function writeSession() {
  const list = [...windows.values()];
  const remember = list.some((x) => x.remember);
  const data = { windows: list.filter((x) => x.remember).map((x) => ({ tabs: x.tabs, active: x.active })) };
  const dir = app.getPath('userData');
  sessionWrite = sessionWrite
    .then(() => (remember ? session.save(dir, data, { onRetry: (err, i) => e2eLog('sesión: reintento', i, err.code) }) : session.clear(dir)))
    .catch((err) => e2eLog('sesión: no se pudo guardar', err.code ?? err.message));
  return sessionWrite;
}

ipcMain.on('tabs:report', (e, report = {}) => {
  const x = infoOf(e);
  if (!x) return;
  const clean = session.cleanWindow(report);
  const before = JSON.stringify([x.tabs, x.active, x.remember]);
  const wasRemembering = x.remember;
  Object.assign(x, clean, { remember: !!report.remember });
  if (before !== JSON.stringify([x.tabs, x.active, x.remember]) && (x.remember || wasRemembering)) writeSession();
});

// Una sola vez por sesión de la app, y solo si la interfaz lo pide (Preferencias → recordar pestañas): la primera
// ventana de la sesión anterior se abre en la que pregunta; las demás, en ventanas nuevas.
let sessionRestored = false;
ipcMain.handle('session:restore', async (e) => {
  if (sessionRestored) return null;
  sessionRestored = true;
  const saved = await session.load(app.getPath('userData'));
  const [first, ...rest] = saved.windows;
  if (!first) return null;
  const from = winOf(e);
  rest.forEach((w, i) => {
    const b = from?.getNormalBounds();
    createWindow({ bounds: b ? { ...b, x: b.x + 32 * (i + 1), y: b.y + 32 * (i + 1) } : null, pending: w.tabs });
  });
  return { entries: await readPdfs(first.tabs), active: first.active };
});

// Arrastrar una pestaña fuera: ventana nueva donde se soltó, con la pestaña ya preparada (snapshot: el documento
// con sus PDF). La respuesta llega cuando la ventana nueva la ha abierto (tab:adopted) o si se cierra antes; solo
// entonces la ventana de la que sale la quita (si algo falla, no se pierde nada).
ipcMain.handle('tab:detach', (e, snapshot, point) => {
  const from = winOf(e);
  if (!from || !snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.sources)) return { ok: false };
  const b = from.getNormalBounds();
  const w = createWindow({ bounds: boundsNear(point, b.width, b.height), snapshot });
  e2eLog('tab:detach', snapshot.sources.length, 'PDF(s) → ventana', w.webContents.id);
  return new Promise((resolve) => { windows.get(w.webContents.id).adopt = resolve; });
});
ipcMain.handle('tab:pending', (e) => {
  const x = infoOf(e);
  const snap = x?.snapshot ?? null;
  if (x) x.snapshot = null;
  return snap;
});
ipcMain.on('tab:adopted', (e, ok) => {
  const x = infoOf(e);
  x?.adopt?.({ ok: !!ok });
  if (x) x.adopt = null;
});

// --- IPC -----------------------------------------------------------------
// Versión del contrato con la interfaz (= DESKTOP_API de src/desktop.js y apiVersion del preload).
const DESKTOP_API = 13;
ipcMain.handle('app:apiVersion', () => DESKTOP_API);
// Idioma: el del sistema al arrancar; la ventana manda el que usa de verdad (Preferencias → Idioma).
ipcMain.on('app:setLang', (_e, lang) => i18n.setLang(String(lang)));
// Tema (Preferencias → Tema): Electron lo aplica a todas las ventanas, a la barra de título y a los diálogos nativos.
ipcMain.on('app:setTheme', (_e, theme) => {
  const next = theme === 'light' || theme === 'dark' ? theme : 'system';
  if (nativeTheme.themeSource !== next) nativeTheme.themeSource = next;
});
i18n.onChange(() => buildMenu());

const isPdfPath = (p) => typeof p === 'string' && path.isAbsolute(p) && /\.pdf$/i.test(p);
const isImagePath = (p) => typeof p === 'string' && path.isAbsolute(p) && /\.(png|jpe?g)$/i.test(p);

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
ipcMain.handle('recents:open', async (e, filePath) => {
  const known = recentList.find((r) => recents.samePath(r.path, filePath));
  if (!known) return { missing: true, name: path.basename(String(filePath)) };
  try {
    await fs.access(known.path);
  } catch {
    await setRecents(recents.removeRecent(recentList, known.path));
    return { missing: true, name: known.name };
  }
  // Si ya está abierto en otra ventana, se muestra allí.
  return { entries: await readPdfs(routeOpen([known.path], winOf(e))) };
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
const num = (v, min, max) => { const n = Number(v); if (!(n >= min && n <= max)) throw new Error(T('print.badOption')); return n; };

// Impresoras instaladas. Pruebas e2e (sin empaquetar): globalThis.__spiderPdfPrintersHook.
ipcMain.handle('print:printers', async (e) => {
  const hook = !app.isPackaged && globalThis.__spiderPdfPrintersHook;
  const list = hook ? await hook() : await e.sender.getPrintersAsync();
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
  if (!job || !(page?.jpg instanceof Uint8Array)) throw new Error(T('print.badPage'));
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
  return `<!doctype html><html lang="${i18n.getLang()}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
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
        resolve({ ok, cancelled: userCancel, error: ok || userCancel ? null : T('print.rejected') });
      });
    });
  } finally {
    pw.destroy();
  }
}

ipcMain.handle('print:run', async (e, id) => {
  const job = printJobs.get(id);
  if (!job || !job.pages.length) throw new Error(T('print.noPages'));
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

ipcMain.handle('dialog:open', async (e) => {
  const win = winOf(e);
  const res = await dialog.showOpenDialog(win, {
    title: T('dialog.openTitle'),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: T('dialog.pdfFilter'), extensions: ['pdf'] }],
  });
  // Los que ya están abiertos en otra ventana se muestran allí.
  return res.canceled ? [] : readPdfs(routeOpen(res.filePaths, win));
});

// PDFs que abre la ventana al cargar: los del arranque (doble clic, «Abrir con») en la primera; los de su ventana de
// la sesión anterior en las que se abren al recordarla.
ipcMain.handle('files:pending', async (e) => {
  const x = infoOf(e);
  if (!x) return [];
  const paths = x.pending.splice(0);
  if (x.first) paths.push(...argvPaths.splice(0));
  return readPdfs(paths);
});

// Dividir y Exportar como imagen: ¿cuáles de estos archivos existen ya? (para preguntar antes de reemplazarlos).
// Solo rutas de PDF o de imagen.
ipcMain.handle('files:exist', async (_e, paths) => {
  const list = Array.isArray(paths) ? paths.filter((p) => isPdfPath(p) || isImagePath(p)).slice(0, 5000) : [];
  const out = [];
  for (const p of list) if (await fs.access(p).then(() => true, () => false)) out.push(p);
  return out;
});

// Solo elige dónde guardar (sin escribir): la interfaz decide si hace falta confirmar antes.
// Preferencias → «Carpeta de salida»: elegir una carpeta. → ruta o null.
ipcMain.handle('dialog:chooseFolder', async (e, { defaultPath } = {}) => {
  const res = await dialog.showOpenDialog(winOf(e), {
    title: T('dialog.folderTitle'),
    buttonLabel: T('dialog.folderButton'),
    defaultPath: typeof defaultPath === 'string' && defaultPath ? defaultPath : undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled || !res.filePaths?.[0] ? null : res.filePaths[0];
});

ipcMain.handle('dialog:saveAs', async (e, { defaultPath } = {}) => {
  const res = await dialog.showSaveDialog(winOf(e), {
    title: T('dialog.saveTitle'),
    defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
    filters: [{ name: T('dialog.pdfDocument'), extensions: ['pdf'] }],
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
  clipboard, // macOS: copiar el archivo sin el ayudante de Windows
  ShareMenu,
});
app.on('will-quit', () => share.cleanup());
ipcMain.handle('share:prepare', (_e, o = {}) => {
  if (o.bytes && !(o.bytes instanceof Uint8Array) && !(o.bytes instanceof ArrayBuffer)) throw new Error(T('ipc.expectedPdf'));
  return share.prepare({ bytes: o.bytes, from: typeof o.from === 'string' ? o.from : undefined, name: o.name });
});
ipcMain.handle('share:copyFile', (_e, id) => share.copyFile(String(id)));
ipcMain.handle('share:mail', (_e, id, subject) => {
  const h = shareHook();
  return h?.mail ? h.mail(String(id), String(subject ?? '')) : share.mail(String(id), subject);
});
ipcMain.handle('share:reveal', (_e, id) => share.reveal(String(id)));
// macOS: menú Compartir del sistema (AirDrop, Mensajes, Mail, Notas…) junto a la ventana.
ipcMain.handle('share:system', (e, id) => share.system(String(id), winOf(e)));
ipcMain.handle('share:whatsapp', (_e, id) => share.whatsapp(String(id)));
ipcMain.handle('share:ai', (_e, id, provider) => share.ai(String(id), String(provider)));

// --- Actualizaciones (ver updater.cjs) -----------------------------------------------------------------
// Desde las versiones publicadas en GitHub; solo en la app instalada para Windows. En e2e (sin empaquetar),
// globalThis.__spiderPdfUpdateHook = un autoUpdater simulado (se crea de nuevo si cambia).
let updater = null;
function getUpdater() {
  const hook = app.isPackaged ? null : globalThis.__spiderPdfUpdateHook ?? null;
  if (updater && updater.hook === hook) return updater;
  const enabled = !!hook || (app.isPackaged && process.platform === 'win32');
  const autoUpdater = hook ?? (enabled ? require('electron-updater').autoUpdater : null);
  if (autoUpdater && !hook) autoUpdater.logger = null; // sin registros en disco
  updater = createUpdater({ autoUpdater, enabled, current: app.getVersion(), onChange: (s) => broadcast('update:changed', s), log: e2eLog });
  updater.hook = hook;
  return updater;
}
ipcMain.handle('update:state', () => getUpdater().state);
ipcMain.handle('update:check', (_e, o = {}) => getUpdater().check({ auto: !!o?.auto }));
// Reiniciar para actualizar. Con cambios sin guardar en alguna ventana, primero se dice cuántos (la interfaz
// pregunta) y solo con discard se sigue: el instalador cierra la app y no esperaría al aviso de cada ventana.
ipcMain.handle('update:install', (_e, o = {}) => {
  const u = getUpdater();
  if (u.state.status !== 'ready') return { ok: false };
  const dirty = [...windows.values()].reduce((n, x) => n + (x.dirty || 0), 0);
  if (dirty && !o?.discard) return { ok: false, dirty };
  discardOnQuit = true;
  quitting = true; // las pestañas abiertas se recuerdan como al salir
  e2eLog('actualizar: reiniciar e instalar', u.state.version);
  return { ok: u.install() };
});

// --- Exportar (Excel, Word) -------------------------------------------------------------------
// La interfaz genera el archivo; aquí se elige dónde y se escribe con el mismo guardado atómico que los PDF.
// Solo se pueden abrir después (export:open) los archivos exportados en esta sesión.
const EXPORT_KINDS = {
  xlsx: { title: 'export.excelTitle', name: 'export.excelName', ext: 'xlsx' }, // claves de strings.json
  docx: { title: 'export.wordTitle', name: 'export.wordName', ext: 'docx' },
};
const exported = new Set();
ipcMain.handle('export:save', async (e, { bytes, defaultPath, kind } = {}) => {
  const k = EXPORT_KINDS[kind];
  if (!k) throw new Error(T('export.unknownFormat'));
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new Error(T('ipc.expectedFile'));
  const res = await dialog.showSaveDialog(winOf(e), {
    title: T(k.title),
    defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
    filters: [{ name: T(k.name), extensions: [k.ext] }],
  });
  if (res.canceled || !res.filePath) return null;
  const filePath = path.extname(res.filePath) ? res.filePath : `${res.filePath}.${k.ext}`;
  await writeAtomic(filePath, Buffer.from(bytes), { onRetry: (err, i) => e2eLog('exportar: reintento', i, err.code) });
  exported.add(path.resolve(filePath));
  return { path: filePath, name: path.basename(filePath) };
});
// En e2e (sin empaquetar), globalThis.__spiderPdfOpenPathHook(path) sustituye a abrirlo con su programa.
ipcMain.handle('export:open', async (_e, filePath) => {
  const full = path.resolve(String(filePath));
  if (!exported.has(full)) return { ok: false, message: T('export.onlyExported') };
  const hook = app.isPackaged ? null : globalThis.__spiderPdfOpenPathHook;
  const err = await (hook ? hook(full) : shell.openPath(full));
  return err ? { ok: false, message: T('export.openFailed', { error: err }) } : { ok: true };
});

// Enlaces web de un PDF: la interfaz ya pidió confirmación. Solo http(s) y correo; nada de archivos ni programas.
// En e2e (sin empaquetar), globalThis.__spiderPdfLinkHook(url) sustituye al navegador del sistema.
ipcMain.handle('link:open', async (_e, raw) => {
  let url;
  try { url = new URL(String(raw)); } catch { return { ok: false, message: T('link.invalid') }; }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return { ok: false, message: T('link.blocked') };
  const hook = app.isPackaged ? null : globalThis.__spiderPdfLinkHook;
  await (hook ? hook(url.href) : shell.openExternal(url.href));
  return { ok: true };
});

// Integridad de las firmas digitales (ver sigverify.cjs). Recibe los bytes del PDF tal como se abrió.
ipcMain.handle('pdf:verifySignatures', (_e, bytes) => {
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new Error(T('ipc.expectedPdf'));
  return verifyPdfSignatures(Buffer.from(bytes));
});

// Archivos escritos en esta sesión: los únicos que se pueden mostrar en su carpeta (file:reveal).
const written = new Set();
ipcMain.handle('file:save', async (e, { bytes, path: target, suggestedName }) => {
  let filePath = target;
  if (!filePath) {
    const res = await dialog.showSaveDialog(winOf(e), {
      title: T('dialog.saveTitle'),
      defaultPath: suggestedName,
      filters: [{ name: T('dialog.pdfDocument'), extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    filePath = res.filePath;
  }
  // Escritura segura: primero a un temporal y luego se reemplaza el original (con reintentos si Windows
  // lo tiene bloqueado un instante: antivirus, indexador, OneDrive…).
  await writeAtomic(filePath, Buffer.from(bytes), { onRetry: (err, i) => e2eLog('guardar: reintento', i, err.code) });
  written.add(path.resolve(filePath));
  return { path: filePath, name: path.basename(filePath) };
});
// Exportar como imagen: cada página en su archivo (ruta absoluta .png o .jpg en una carpeta que existe).
ipcMain.handle('image:save', async (e, { bytes, path: target } = {}) => {
  if (!isImagePath(target)) throw new Error(T('ipc.expectedImagePath'));
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new Error(T('ipc.expectedFile'));
  await writeAtomic(target, Buffer.from(bytes), { onRetry: (err, i) => e2eLog('imagen: reintento', i, err.code) });
  written.add(path.resolve(target));
  return { path: target, name: path.basename(target) };
});
// «Copiar como imagen»: una página (PNG) al portapapeles del sistema. Electron 44 cambió la API del portapapeles
// (asíncrona, con ClipboardItem, como la web; ya no hay writeImage): Windows recibe la imagen como mapa de bits y PNG.
ipcMain.handle('clipboard:image', async (_e, bytes) => {
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new Error(T('ipc.expectedFile'));
  const buf = Buffer.from(bytes);
  if (nativeImage.createFromBuffer(buf).isEmpty()) return { ok: false };
  if (typeof clipboard.writeImage === 'function') clipboard.writeImage(nativeImage.createFromBuffer(buf));
  else await clipboard.write([new ClipboardItem({ 'image/png': new Blob([buf], { type: 'image/png' }) })]);
  return { ok: true };
});
// «Mostrar en la carpeta» tras Dividir. En e2e (sin empaquetar), globalThis.__spiderPdfRevealHook(path).
ipcMain.handle('file:reveal', async (_e, filePath) => {
  const full = path.resolve(String(filePath));
  if (!written.has(full)) return { ok: false };
  const hook = app.isPackaged ? null : globalThis.__spiderPdfRevealHook;
  if (hook) await hook(full); else shell.showItemInFolder(full);
  return { ok: true };
});

// Pestañas con cambios sin guardar de esa ventana (un número; true/false de una interfaz antigua también vale).
ipcMain.on('state:dirty', (e, value) => {
  const x = infoOf(e);
  if (!x) return;
  x.dirty = Math.max(0, Math.round(Number(value) || 0));
  if (isMac && alive(x.win)) x.win.setDocumentEdited(x.dirty > 0);
});
ipcMain.on('state:title', (e, title) => { const w = winOf(e); if (alive(w)) w.setTitle(String(title)); });

// Acciones de sistema pedidas desde la barra de menús propia (Windows y Linux).
ipcMain.on('menu:role', (e, role) => {
  const win = winOf(e);
  if (!alive(win)) return;
  if (role === 'quit') app.quit(); // todas las ventanas; cada una pasa por su aviso de cambios sin guardar
  else if (role === 'close') win.close();
  else if (role === 'toggleDevTools' && !app.isPackaged) win.webContents.toggleDevTools();
  else if (role === 'reload' && !app.isPackaged) win.webContents.reload();
});

nativeTheme.on('updated', () => {
  if (isMac) return;
  for (const x of windows.values()) if (alive(x.win)) x.win.setTitleBarOverlay({ ...overlayColors(), height: TITLEBAR_H });
});

// --- Ciclo de vida -----------------------------------------------------------
app.whenReady().then(async () => {
  i18n.setLang(i18n.detect([app.getLocale()])); // getLocale respeta --lang (las pruebas e2e lo usan)
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
  app.on('activate', () => { if (!windows.size) createWindow(); });
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
