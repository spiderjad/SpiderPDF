// Compartir (proceso principal): la copia que se comparte vive en una carpeta temporal propia que se borra al cerrar
// la app (y al arrancar, las que quedaran de una ejecución anterior). La interfaz solo maneja identificadores: las
// órdenes (copiar, correo, Explorador, WhatsApp) actúan sobre archivos que se prepararon aquí, nunca sobre una ruta
// cualquiera. Las órdenes nativas (portapapeles como archivo, correo MAPI) las hace el ayudante en C#.
const { execFile } = require('node:child_process');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { T } = require('./i18n.cjs');

const PREFIX = 'SpiderPDF-compartir-';

/** «Enviar a IA»: protocolo de la app de escritorio (si está instalada) y web. Lista cerrada. */
const AI = {
  claude: { protocol: 'claude://', web: 'https://claude.ai/new' },
  chatgpt: { protocol: 'chatgpt://', web: 'https://chatgpt.com/' },
};

/** Nombre de archivo seguro: sin rutas ni caracteres prohibidos en Windows, con .pdf al final. */
function safeName(name) {
  let n = String(name ?? '').split(/[\\/]/).pop().replace(/[:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  n = n.replace(/\.pdf$/i, '').slice(0, 150).trim() || T('share.defaultName');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `${n}_`;
  return `${n}.pdf`;
}

/** Ruta del ayudante: dentro de resources/ en la app empaquetada; en desarrollo, la compilada en build/helper/. */
function helperPath(app) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'helper', 'SpiderPdfHelper.exe')
    : path.join(__dirname, '..', 'build', 'helper', 'SpiderPdfHelper.exe');
}

/** Ejecuta una orden del ayudante. → { ok, code?, message? } */
function runHelper(app, args, { timeout = 0 } = {}) {
  return new Promise((resolve) => {
    const exe = helperPath(app);
    if (process.platform !== 'win32' || !fsSync.existsSync(exe)) {
      resolve({ ok: false, code: 'sin-ayudante', message: T('share.noHelper') });
      return;
    }
    execFile(exe, args, { windowsHide: true, timeout, encoding: 'utf8' }, (err, stdout) => {
      const line = String(stdout ?? '').trim().split('\n').pop();
      try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, code: 'ayudante', message: err?.message ?? T('share.helperNoReply') }); }
    });
  });
}

function createShare({ app, shell, log = () => {} }) {
  const root = path.join(os.tmpdir(), `${PREFIX}${process.pid}`);
  const files = new Map(); // id → ruta
  let seq = 0;

  // Restos de ejecuciones anteriores (cierres bruscos): fuera las carpetas de procesos que ya no existen.
  try {
    for (const name of fsSync.readdirSync(os.tmpdir())) {
      if (!name.startsWith(PREFIX)) continue;
      const pid = Number(name.slice(PREFIX.length));
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch { /* ese proceso ya no existe */ }
      if (!alive || pid === process.pid) fsSync.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    }
  } catch { /* sin acceso a la carpeta temporal: no pasa nada */ }

  const file = (id) => {
    const f = files.get(id);
    if (!f || !fsSync.existsSync(f)) throw new Error(T('share.gone'));
    return f;
  };

  return {
    root,
    /** Escribe la copia a compartir. bytes, o from (ruta de un PDF abierto, para compartirlo tal cual). → { id, name, size } */
    async prepare({ bytes, from, name }) {
      const id = `c${++seq}`;
      const dir = path.join(root, id); // cada copia en su carpeta: se puede repetir el nombre
      await fs.mkdir(dir, { recursive: true });
      const target = path.join(dir, safeName(name));
      if (from) {
        const head = Buffer.alloc(5);
        const fd = await fs.open(from, 'r');
        try { await fd.read(head, 0, 5, 0); } finally { await fd.close(); }
        if (head.toString('latin1') !== '%PDF-') throw new Error(T('share.notPdf'));
        await fs.copyFile(from, target);
      } else {
        await fs.writeFile(target, Buffer.from(bytes));
      }
      files.set(id, target);
      log('compartir: preparado', id, path.basename(target));
      return { id, name: path.basename(target), size: (await fs.stat(target)).size };
    },
    copyFile: (id) => runHelper(app, ['copy-file', file(id)], { timeout: 20_000 }),
    // Sin límite de tiempo: según el cliente, la orden no vuelve hasta que se envía o se cierra el correo.
    mail: (id, subject) => runHelper(app, ['mail', file(id), String(subject ?? '')]),
    reveal(id) { shell.showItemInFolder(file(id)); return { ok: true }; },
    /** WhatsApp: el archivo al portapapeles y la app de escritorio (o la web, si no está instalada). */
    async whatsapp(id) {
      const f = file(id);
      const copied = await runHelper(app, ['copy-file', f], { timeout: 20_000 });
      const desktop = !!app.getApplicationNameForProtocol('whatsapp://');
      if (desktop) {
        await shell.openExternal('whatsapp://');
      } else {
        await shell.openExternal('https://web.whatsapp.com/');
        shell.showItemInFolder(f); // para arrastrarlo a la web
      }
      return { ok: true, desktop, copied: !!copied.ok };
    },
    /** Enviar a IA: el archivo al portapapeles y la app de escritorio de esa IA (o su web, si no está instalada). */
    async ai(id, provider) {
      const p = AI[provider] ?? AI.claude;
      const copied = await runHelper(app, ['copy-file', file(id)], { timeout: 20_000 });
      const desktop = !!app.getApplicationNameForProtocol(p.protocol);
      await shell.openExternal(desktop ? p.protocol : p.web);
      return { ok: true, desktop, copied: !!copied.ok, provider: provider in AI ? provider : 'claude' };
    },
    /** Al cerrar: fuera la carpeta temporal. */
    cleanup() {
      try { fsSync.rmSync(root, { recursive: true, force: true }); } catch { /* en uso: lo limpia el próximo arranque */ }
    },
  };
}

module.exports = { createShare, safeName, runHelper, helperPath };
