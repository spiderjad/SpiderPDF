// HTML a PDF desde la línea de órdenes, sin ventana:
//   SpiderPDF.exe --html-a-pdf <entrada.html> <salida.pdf> [<entrada2.html> <salida2.pdf> …]
// (en una terminal, mejor SpiderPDF.com: espera a que termine y devuelve el código de salida; ver SpiderPdfCli.cs).
// Lo usan las herramientas de TIC (la skill de documentación) en lugar de Chrome. Chromium de Electron: respeta @page
// con tamaño, márgenes y las cajas de margen (@top-left… con counter(page) y counter(pages)).
// Códigos de salida: 0 todo bien; 1 algún archivo falló (los demás se convierten igual); 2 orden mal escrita.
// Va antes del candado de instancia única (main.cjs): con SpiderPDF abierto, la orden no se pasa a la ventana.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const FLAG = '--html-a-pdf';
const HTML = /\.x?html?$/i;
const LOAD_TIMEOUT = 60_000; // por archivo: cargar, fuentes e imágenes
const FONT_MARGIN = 400; // ms tras document.fonts.ready (fuentes de Google que piden más archivos al pintar)

const wanted = (argv) => argv.includes(FLAG);

/**
 * Argumentos de la orden → { jobs: [{ input, output }] } o { error: clave de strings.json, params }.
 * argv: process.argv completo. Se ignoran las opciones de Chromium (--lang=…) y, sin empaquetar, la carpeta de la app.
 * Rutas relativas a cwd. Una sola entrada sin salida: el mismo nombre con .pdf al lado.
 */
function parseArgs(argv, cwd = process.cwd()) {
  const i = argv.indexOf(FLAG);
  const rest = argv.slice(i + 1).filter((a) => !a.startsWith('--'));
  if (!rest.length) return { error: 'html.usage' };
  if (rest.length === 1 && HTML.test(rest[0])) rest.push(rest[0].replace(HTML, '.pdf'));
  if (rest.length % 2) return { error: 'html.usage' };
  const jobs = [];
  for (let k = 0; k < rest.length; k += 2) {
    const input = path.resolve(cwd, rest[k]);
    const output = path.resolve(cwd, rest[k + 1]);
    if (!/\.pdf$/i.test(output)) return { error: 'html.notPdf', params: { file: rest[k + 1] } };
    if (input.toLowerCase() === output.toLowerCase()) return { error: 'html.same', params: { file: rest[k] } };
    jobs.push({ input, output });
  }
  const outs = jobs.map((j) => j.output.toLowerCase());
  const dup = outs.find((o, n) => outs.indexOf(o) !== n);
  if (dup) return { error: 'html.dupOutput', params: { file: jobs[outs.indexOf(dup)].output } };
  return { jobs };
}

/** Número de páginas del PDF que escribe Chromium (Skia: diccionarios sin comprimir). null si no se sabe. */
function countPages(bytes) {
  const m = bytes.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return m ? m.length : null;
}

/** Espera a que el documento esté listo para imprimir: fuentes, imágenes y un margen para las fuentes web. */
const READY_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
  await frame();
  await wait(${FONT_MARGIN});
  await document.fonts.ready;
  await frame();
  return true;
})()`;

function withTimeout(promise, ms, error) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(error), ms); })])
    .finally(() => clearTimeout(timer));
}

/** Convierte un archivo. → { pages } o lanza un Error con .key/.params (strings.json). */
async function convert({ BrowserWindow, session }, { input, output }) {
  const fail = (key, params) => Object.assign(new Error(key), { key, params });
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw fail('html.noInput', { file: input });
  if (!fs.existsSync(path.dirname(output))) throw fail('html.noFolder', { folder: path.dirname(output) });

  const ses = session.fromPartition('html-a-pdf'); // en memoria: nada se guarda en disco
  const win = new BrowserWindow({
    show: false,
    width: 1240,
    height: 1754,
    webPreferences: {
      session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false,
      backgroundThrottling: false, // oculta: sin esto los temporizadores van lentos
    },
  });
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault()); // ni redirecciones ni scripts que cambien de página
  try {
    await withTimeout(win.loadFile(input), LOAD_TIMEOUT, fail('html.timeout', { file: input }))
      .catch((e) => { throw e.key ? e : fail('html.loadFailed', { file: input, reason: e.message }); });
    await withTimeout(wc.executeJavaScript(READY_SCRIPT, true), LOAD_TIMEOUT, fail('html.timeout', { file: input }));
    const bytes = await wc.printToPDF({
      preferCSSPageSize: true, // el tamaño de @page manda; si no hay, A4
      pageSize: 'A4',
      printBackground: true,
      displayHeaderFooter: false, // sin la cabecera y el pie del navegador
      generateTaggedPDF: true,
      generateDocumentOutline: true, // marcadores desde los títulos (h1, h2…)
    });
    const tmp = `${output}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, output);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw fail('html.writeFailed', { file: output, reason: e.code || e.message });
    }
    return { pages: countPages(bytes) };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/**
 * Modo línea de órdenes: convierte y sale con su código. No crea ventanas visibles, ni sesión, ni recientes, ni busca
 * actualizaciones. Carpeta de datos temporal propia (no la de la app, que puede estar abierta) y se borra al salir.
 */
function runCli(electron, { T, setLang, detect }) {
  const { app } = electron;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'SpiderPDF-html-'));
  app.setPath('userData', userData);
  app.disableHardwareAcceleration(); // sin GPU: más rápido de arrancar y nada que ver en pantalla
  app.on('window-all-closed', () => {}); // las ventanas ocultas se cierran entre archivo y archivo

  const out = (s) => process.stdout.write(`${s}\n`);
  const err = (s) => process.stderr.write(`${s}\n`);
  const finish = (code) => {
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* Chromium aún la usa: queda en %TEMP% */ }
    app.exit(code);
  };

  app.whenReady().then(async () => {
    setLang(detect([app.getLocale()]));
    const parsed = parseArgs(process.argv);
    if (parsed.error) {
      err(T(parsed.error, parsed.params));
      if (parsed.error !== 'html.usage') err(T('html.usage'));
      return finish(2);
    }
    let failed = 0;
    for (const job of parsed.jobs) {
      try {
        const { pages } = await convert(electron, job);
        out(pages == null ? T('html.done', { file: job.output }) : T('html.donePages', { file: job.output, count: pages }));
      } catch (e) {
        failed++;
        err(e.key ? T(e.key, e.params) : T('html.failed', { file: job.input, reason: e.message }));
      }
    }
    finish(failed ? 1 : 0);
  }).catch((e) => {
    err(T('html.failed', { file: '', reason: e.message }));
    finish(1);
  });
}

module.exports = { FLAG, wanted, parseArgs, countPages, runCli };
