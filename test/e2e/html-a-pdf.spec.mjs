// HTML a PDF por línea de órdenes (electron/htmlpdf.cjs): SpiderPDF.exe --html-a-pdf <entrada> <salida>, sin ventana.
// Lo que pide la plantilla de TIC: @page A4 con cajas de margen (cabecera, «CONFIDENCIAL», «n / total»), portada sin
// cabecera, CSS e imágenes relativos al HTML, filas de tabla sin partir. Con la app empaquetada (SPIDERPDF_E2E_EXE)
// se prueba además SpiderPDF.com, el lanzador de consola que espera y devuelve el código de salida.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile, copyFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, PACKAGED_EXE, tempDir, launch, engine } from './helpers.mjs';

const require = createRequire(import.meta.url);
const ROWS = 90;

/** Ejecuta la orden. via: 'exe' (SpiderPDF.exe o electron + carpeta) o 'com' (SpiderPDF.com, solo empaquetada). */
function run(args, { cwd, via = 'exe' } = {}) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.SPIDERPDF_USER_DATA;
  const packaged = PACKAGED_EXE && path.resolve(PACKAGED_EXE); // relativa a donde se lanzan las pruebas, no a cwd
  const exe = via === 'com' ? path.join(path.dirname(packaged), 'SpiderPDF.com') : packaged || require('electron');
  const all = ['--lang=es-ES', ...(PACKAGED_EXE ? [] : [ROOT]), '--html-a-pdf', ...args];
  return new Promise((resolve, reject) => {
    const p = spawn(exe, all, { cwd, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Informe como los de la plantilla: CSS en una subcarpeta, imagen relativa, portada y una tabla larga. */
async function makeReport(dir, name = 'Informe del projecte') {
  await mkdir(path.join(dir, 'css'), { recursive: true });
  await mkdir(path.join(dir, 'img'), { recursive: true });
  await copyFile(path.join(ROOT, 'build', 'icon.png'), path.join(dir, 'img', 'logo.png'));
  await writeFile(path.join(dir, 'css', 'plantilla.css'), `
@page { size: A4; margin: 25mm 18mm 20mm;
  @top-left { content: "MANUAL OPERATIU · TIC"; font-size: 9pt }
  @top-right { content: "${name}"; font-size: 9pt }
  @bottom-left { content: "CONFIDENCIAL"; font-size: 8pt }
  @bottom-right { content: counter(page) " / " counter(pages); font-size: 8pt } }
@page :first { @top-left { content: none } @top-right { content: none } @bottom-left { content: none } @bottom-right { content: none } }
body { font-family: sans-serif }
.portada { break-after: page; background: #1d3557; color: #fff; padding: 40mm 10mm; }
table { border-collapse: collapse; width: 100% } td { border: 1px solid #999; padding: 8px }
tr { break-inside: avoid }`);
  const rows = Array.from({ length: ROWS }, (_, i) => `<tr><td>Fila ${i + 1} inici<br>Fila ${i + 1} final</td><td>Valor ${i + 1}</td></tr>`).join('');
  const html = path.join(dir, `${name}.html`);
  await writeFile(html, `<!doctype html><html lang="ca"><meta charset="utf-8"><title>${name}</title>
<link rel="stylesheet" href="css/plantilla.css">
<section class="portada"><img src="img/logo.png" width="120" alt=""><h1>${name}</h1><p>Alba · TIC</p></section>
<h1>Índex</h1><h2>Taula de pesades</h2><table>${rows}</table></html>`);
  return html;
}

test('convierte un HTML con la plantilla: cajas de margen, n / total, portada, CSS e imagen relativos, filas enteras', async () => {
  const dir = await tempDir();
  const html = await makeReport(dir);
  const out = path.join(dir, 'sortida', 'Informe del projecte.pdf');
  await mkdir(path.dirname(out));

  const r = await run([path.basename(html), path.relative(dir, out)], { cwd: dir }); // rutas relativas
  expect(r.stderr).toBe('');
  expect(r.code).toBe(0);

  const core = await engine();
  const doc = core.open(await readFile(out));
  const n = doc.pages.length;
  expect(n).toBeGreaterThan(2);
  expect(r.stdout.trim()).toBe(`PDF creado: ${out} (${n} pág.)`);
  expect(Math.round(doc.pages[0].width)).toBe(595); // A4
  expect(Math.round(doc.pages[0].height)).toBe(842);

  const texts = doc.pages.map((_, i) => core.pageText(doc.docId, i).replace(/\s+/g, ' '));
  // Portada: sin cabecera ni pie, con la imagen relativa.
  expect(texts[0]).not.toContain('MANUAL OPERATIU');
  expect(texts[0]).not.toContain('CONFIDENCIAL');
  expect(core.pageImages(doc.docId, 0).length).toBe(1);
  // Las demás: cabecera, título, pie y «n / total».
  for (let i = 1; i < n; i++) {
    expect(texts[i]).toContain('MANUAL OPERATIU · TIC');
    expect(texts[i]).toContain('Informe del projecte');
    expect(texts[i]).toContain('CONFIDENCIAL');
    expect(texts[i]).toContain(`${i + 1} / ${n}`);
  }
  // Cada fila entera en una página (las dos líneas de la celda juntas) y todas presentes.
  for (let f = 1; f <= ROWS; f++) {
    const page = texts.findIndex((t) => t.includes(`Fila ${f} inici `));
    expect(page, `fila ${f}`).toBeGreaterThan(0);
    expect(texts[page], `fila ${f} partida`).toContain(`Fila ${f} final`);
  }
  // Marcadores desde los títulos.
  expect(core.bookmarks(doc.docId).map((b) => b.title)).toEqual(['Informe del projecte', 'Índex']);
  // No deja temporales.
  expect(existsSync(`${out}.tmp`)).toBe(false);
});

test('varios archivos de una vez: los buenos se convierten aunque falle uno (código 1, error en stderr)', async () => {
  const dir = await tempDir();
  const a = await makeReport(dir, 'Manual operari');
  const b = await makeReport(dir, 'Circuit · aplicacions');
  const r = await run([a, path.join(dir, 'a.pdf'), path.join(dir, 'falta.html'), path.join(dir, 'x.pdf'), b, path.join(dir, 'b.pdf')]);
  expect(r.code).toBe(1);
  expect(r.stderr.trim()).toBe(`No existe el archivo: ${path.join(dir, 'falta.html')}`);
  expect(r.stdout.match(/PDF creado/g)).toHaveLength(2);
  expect((await stat(path.join(dir, 'a.pdf'))).size).toBeGreaterThan(1000);
  expect(existsSync(path.join(dir, 'x.pdf'))).toBe(false);
  const core = await engine();
  const doc = core.open(await readFile(path.join(dir, 'b.pdf')));
  expect(core.pageText(doc.docId, 1)).toContain('Circuit · aplicacions'); // acentos y «·» en la cabecera
});

test('orden mal escrita: código 2 y cómo se usa', async () => {
  const r = await run(['solo.html', 'uno.pdf', 'otro.html']);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain('Uso: SpiderPDF --html-a-pdf');
  const r2 = await run(['a.html', 'a.docx']);
  expect(r2.code).toBe(2);
  expect(r2.stderr).toContain('La salida tiene que ser un archivo .pdf: a.docx');
});

test('con SpiderPDF abierto, la orden convierte igual y no toca la ventana abierta', async () => {
  const dir = await tempDir();
  const { app, errors } = await launch(dir);
  try {
    const html = await makeReport(dir);
    const r = await run([html, path.join(dir, 'abierta.pdf')]);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(existsSync(path.join(dir, 'abierta.pdf'))).toBe(true);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('SpiderPDF.com (app empaquetada): espera, pasa la salida y el código de salida', async () => {
  test.skip(!PACKAGED_EXE, 'solo con la app empaquetada (SPIDERPDF_E2E_EXE)');
  const dir = await tempDir();
  const html = await makeReport(dir);
  const ok = await run([html, path.join(dir, 'com.pdf')], { via: 'com' });
  expect(ok.code).toBe(0);
  expect(ok.stdout).toContain('PDF creado');
  expect(existsSync(path.join(dir, 'com.pdf'))).toBe(true);
  const bad = await run([path.join(dir, 'falta.html'), path.join(dir, 'y.pdf')], { via: 'com' });
  expect(bad.code).toBe(1);
  expect(bad.stderr).toContain('No existe el archivo');
});
