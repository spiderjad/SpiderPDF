// Tablas → Excel (src/tables.js, src/export/xlsx.js), con PDFium y ExcelJS de verdad.  npm test
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { init } from '@embedpdf/pdfium';
import ExcelJS from 'exceljs';
import { PdfCore } from '../src/engine/pdfium-core.js';
import { detectTables, joinContinued, parseCell, numberStyle, grids, cellsOf, lines, words } from '../src/tables.js';
import { buildXlsx, sheetName, hasHeader } from '../src/export/xlsx.js';
import { factura, FACTURA, albaranLineas, ALBARAN_LINEAS, contrato, indiceImpreso } from './make-fixtures.js';

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`FALLO - ${name}`); throw e; } };

const require = createRequire(import.meta.url);
const pdfium = await init({ wasmBinary: await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
pdfium.PDFiumExt_Init();
const core = new PdfCore(pdfium);

/** Tablas de todas las páginas de un PDF, como las prepara la interfaz. */
function tablesOf(bytes) {
  const d = core.open(bytes);
  const out = [];
  d.pages.forEach((p, i) => {
    for (const t of detectTables(core.textChars(d.docId, i), core.rules(d.docId, i), p.width, p.height)) out.push({ ...t, page: i + 1 });
  });
  core.close(d.docId);
  return out;
}

const factBytes = await factura();
const albBytes = await albaranLineas();

await test('parseCell: números españoles e ingleses, %, €, fechas y códigos', () => {
  assert.deepEqual(parseCell('1.234,56'), { value: 1234.56, numFmt: '#,##0.00' });
  assert.equal(parseCell('10.625,00').value, 10625);
  assert.equal(parseCell('-3,5').value, -3.5);
  assert.equal(parseCell('120').value, 120);
  assert.deepEqual(parseCell('21 %'), { value: 0.21, numFmt: '0%' });
  assert.deepEqual(parseCell('12,5%'), { value: 0.125, numFmt: '0.0%' });
  assert.deepEqual(parseCell('35,00 €'), { value: 35, numFmt: '#,##0.00 "€"' });
  assert.equal(parseCell('1,234.56', 'en').value, 1234.56);
  assert.equal(parseCell('1.234', 'es').value, 1234);
  assert.equal(parseCell('1.234', 'en').value, 1.234);
  assert.equal(parseCell('05/11/2026').value.toISOString(), '2026-11-05T00:00:00.000Z');
  assert.equal(parseCell('2026-11-05').value.toISOString(), '2026-11-05T00:00:00.000Z');
  assert.equal(parseCell('5/1/27').value.toISOString(), '2027-01-05T00:00:00.000Z');
  assert.equal(parseCell('31/02/2026').value, '31/02/2026'); // no existe: texto
  assert.equal(parseCell('0457').value, '0457'); // ceros delante: código
  assert.equal(parseCell('A-1001').value, 'A-1001');
  assert.equal(parseCell('L2610A').value, 'L2610A');
  assert.equal(parseCell('1,2,3').value, '1,2,3');
  assert.equal(parseCell('').value, null);
  assert.equal(numberStyle([['1.234,56', '2,5']]), 'es');
  assert.equal(numberStyle([['1,234.56', '2.50']]), 'en');
});

await test('cellsOf: palabras separadas por un espacio van juntas; un hueco ancho separa columnas', () => {
  const box = (text, x0, x1) => ({ text, x0, x1, y0: 100, y1: 110 });
  const l = { y0: 100, y1: 110, words: [box('Fuet', 50, 70), box('extra', 73, 95), box('12', 200, 210), box('21,60', 300, 325)] };
  assert.deepEqual(cellsOf(l).map((c) => c.text), ['Fuet extra', '12', '21,60']);
});

await test('factura (con rejilla): cabecera y 8 líneas en 6 columnas; los totales de debajo no son tabla', () => {
  const ts = tablesOf(factBytes);
  assert.equal(ts.length, 1);
  assert.equal(ts[0].kind, 'grid');
  assert.deepEqual(ts[0].rows, [FACTURA.cabecera, ...FACTURA.lineas]);
});

await test('albarán (sin líneas): por alineación; descripción partida unida; sigue en la página 2', () => {
  const ts = tablesOf(albBytes);
  assert.deepEqual(ts.map((t) => [t.page, t.kind, t.rows.length]), [[1, 'stream', 9], [2, 'stream', 5]]);
  assert.deepEqual(ts[0].rows[0], ALBARAN_LINEAS.cabecera);
  assert.deepEqual(ts[0].rows[3], ALBARAN_LINEAS.lineas[2]); // «Chorizo … atmósfera protectora» en una celda
  const joined = joinContinued(ts);
  assert.equal(joined.length, 1);
  assert.deepEqual(joined[0].pages, [1, 2]);
  assert.deepEqual(joined[0].rows, [ALBARAN_LINEAS.cabecera, ...ALBARAN_LINEAS.lineas]); // cabecera repetida, fuera
});

await test('sin tablas: el contrato (texto corrido) y la página de índice impreso', async () => {
  assert.deepEqual(tablesOf(await contrato()), []);
  assert.deepEqual(tablesOf(await indiceImpreso()), []);
});

await test('joinContinued no une tablas de páginas no seguidas ni con otras columnas', () => {
  const t = (page, n, head = 'a') => ({ page, rows: [[head, ...Array(n - 1).fill('x')], Array(n).fill('1')] });
  assert.equal(joinContinued([t(1, 3), t(3, 3)]).length, 2);
  assert.equal(joinContinued([t(1, 3), t(2, 4)]).length, 2);
  // Continuación sin cabecera (solo datos): se une con todas sus filas. Con otra cabecera: es otra tabla.
  const datos = { page: 2, rows: [['7', 'x', 'x'], ['8', 'y', 'y']] };
  assert.equal(joinContinued([t(1, 3), datos])[0].rows.length, 4);
  assert.equal(joinContinued([t(1, 3), t(2, 3, 'otra')]).length, 2);
});

await test('grids: un recuadro solo (2 × 1) no es una tabla', () => {
  const W = 600; const H = 800;
  const box = [[0.1, 0.1, 0.9, 0.1], [0.1, 0.2, 0.9, 0.2], [0.1, 0.1, 0.1, 0.2], [0.9, 0.1, 0.9, 0.2]];
  assert.equal(grids(box, W, H).length, 0);
  void lines; void words;
});

await test('Excel: una hoja por tabla, números y fechas como valores, cabecera fija con filtro', async () => {
  const tables = joinContinued([...tablesOf(factBytes), ...tablesOf(albBytes).map((t) => ({ ...t, page: t.page + 1 }))]);
  const bytes = await buildXlsx(ExcelJS, tables, { title: 'Prueba' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Tabla 1 (pág. 1)', 'Tabla 2 (págs. 2-3)']);
  const f = wb.worksheets[0];
  assert.equal(f.getCell('A1').value, 'Código');
  assert.equal(f.getCell('A1').font.bold, true);
  assert.equal(f.getCell('C2').value, 120);
  assert.equal(f.getCell('D8').value, 1250);
  assert.equal(f.getCell('D8').numFmt, '#,##0.00');
  assert.equal(f.getCell('F8').value, 10625);
  assert.equal(f.views[0].ySplit, 1);
  assert.ok(f.autoFilter);
  const a = wb.worksheets[1];
  assert.equal(a.rowCount, 13);
  assert.equal(a.getCell('A2').value, 1001);
  assert.ok(a.getCell('D2').value instanceof Date);
  assert.equal(a.getCell('D2').value.toISOString().slice(0, 10), '2027-01-15');
  assert.equal(a.getCell('D2').numFmt, 'dd/mm/yyyy');
  assert.equal(a.getCell('F2').value, 21.6);
  assert.equal(a.getCell('B4').value, 'Chorizo ibérico loncheado 100 g en bandeja de atmósfera protectora');
});

await test('Excel: una hoja por página, con las tablas una debajo de otra', async () => {
  const t = (page, rows) => ({ page, pages: [page], rows });
  const bytes = await buildXlsx(ExcelJS, [t(1, [['a', 'b'], ['1', '2']]), t(1, [['c', 'd'], ['3', '4']]), t(2, [['e', 'f'], ['5', '6']])], { mode: 'page' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Página 1', 'Página 2']);
  assert.equal(wb.worksheets[0].getCell('A4').value, 'c');
  assert.equal(wb.worksheets[0].getCell('B5').value, 4);
});

await test('sheetName y hasHeader', () => {
  const used = new Set();
  assert.equal(sheetName('Tabla 1 (pág. 1/2)', used), 'Tabla 1 (pág. 1-2)');
  assert.equal(sheetName('Tabla 1 (pág. 1/2)', used), 'Tabla 1 (pág. 1-2) (2)');
  assert.equal(sheetName('x'.repeat(40), used).length, 31);
  assert.equal(hasHeader([['Ref', 'Kg'], ['1', '2,5']]), true);
  assert.equal(hasHeader([['a', 'b'], ['c', 'd']]), false);
});

console.log(`\n${passed} pruebas superadas.`);
