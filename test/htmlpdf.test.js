// HTML a PDF por línea de órdenes: argumentos (electron/htmlpdf.cjs).  Ejecutar: node test/htmlpdf.test.js
// La conversión de verdad (Electron) está en test/e2e/html-a-pdf.spec.mjs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { wanted, parseArgs, countPages } = require('../electron/htmlpdf.cjs');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };
const CWD = path.resolve('/trabajo');
const P = (...a) => path.resolve(CWD, ...a);

t('solo se activa con --html-a-pdf', () => {
  assert.equal(wanted(['SpiderPDF.exe', 'a.pdf']), false);
  assert.equal(wanted(['SpiderPDF.exe', '--html-a-pdf', 'a.html', 'a.pdf']), true);
});

t('un par entrada/salida, rutas relativas a la carpeta actual; se ignora lo de antes (exe, carpeta de la app)', () => {
  const r = parseArgs(['electron.exe', 'C:\\dev\\SpiderPDF', '--html-a-pdf', 'docs\\01 Informe.html', 'out/01.pdf'], CWD);
  assert.deepEqual(r, { jobs: [{ input: P('docs\\01 Informe.html'), output: P('out/01.pdf') }] });
});

t('varios pares de una vez; las opciones de Chromium (--lang=…) no cuentan', () => {
  const r = parseArgs(['x', '--html-a-pdf', 'a.html', 'a.pdf', '--lang=ca', 'b.htm', 'B.PDF'], CWD);
  assert.deepEqual(r.jobs.map((j) => path.basename(j.output)), ['a.pdf', 'B.PDF']);
});

t('solo la entrada: el PDF al lado con el mismo nombre', () => {
  assert.equal(parseArgs(['x', '--html-a-pdf', 'informe.html'], CWD).jobs[0].output, P('informe.pdf'));
  assert.equal(parseArgs(['x', '--html-a-pdf', 'informe.HTM'], CWD).jobs[0].output, P('informe.pdf'));
});

t('errores: sin archivos, número impar, salida que no es .pdf, misma entrada y salida, dos al mismo PDF', () => {
  assert.equal(parseArgs(['x', '--html-a-pdf'], CWD).error, 'html.usage');
  assert.equal(parseArgs(['x', '--html-a-pdf', 'a.html', 'a.pdf', 'b.html'], CWD).error, 'html.usage');
  assert.deepEqual(parseArgs(['x', '--html-a-pdf', 'a.html', 'a.docx'], CWD), { error: 'html.notPdf', params: { file: 'a.docx' } });
  assert.equal(parseArgs(['x', '--html-a-pdf', 'a.pdf', 'A.PDF'], CWD).error, 'html.same');
  assert.equal(parseArgs(['x', '--html-a-pdf', 'a.html', 'z.pdf', 'b.html', 'Z.pdf'], CWD).error, 'html.dupOutput');
});

t('cuenta las páginas del PDF de Chromium sin confundir /Pages', () => {
  const pdf = Buffer.from('<< /Type /Pages /Count 2 >> << /Type /Page /Parent 1 0 R >> << /Type/Page >>', 'latin1');
  assert.equal(countPages(pdf), 2);
  assert.equal(countPages(Buffer.from('nada')), null);
});

console.log(`\n${passed} pruebas de HTML a PDF superadas.`);
