// Imprimir (src/print.js) y menú de recientes (src/menu.js).  Ejecutar: node test/print.test.js
import assert from 'node:assert/strict';
import { printScale, PRINT_DPI, MAX_PRINT_PIXELS } from '../src/print.js';
import { recentItems, menuModel } from '../src/menu.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

t('A4 a 300 ppp (2480 × 3508 px)', () => {
  const s = printScale(595.28, 841.89);
  assert.equal(s, PRINT_DPI / 72);
  assert.equal(Math.round(595.28 * s), 2480);
  assert.equal(Math.round(841.89 * s), 3508);
});

t('un A0 se limita a 40 Mpx (menos de 300 ppp)', () => {
  const [w, h] = [2383.94, 3370.39];
  const s = printScale(w, h);
  assert.ok(s < PRINT_DPI / 72);
  assert.ok(Math.round(w * s) * Math.round(h * s) <= MAX_PRINT_PIXELS * 1.001);
});

t('submenú «Abrir reciente»: un elemento por archivo y «Borrar lista»; vacío, un aviso', () => {
  const items = recentItems([{ name: 'a.pdf', path: 'C:\\a.pdf' }]);
  assert.deepEqual(items.map((i) => i.label), ['a.pdf', undefined, 'Borrar lista']);
  assert.deepEqual([items[0].cmd, items[0].arg], ['openRecent', 'C:\\a.pdf']);
  assert.deepEqual(recentItems([]).map((i) => [i.label, i.cmd]), [['Sin archivos recientes', 'none']]);
});

t('el menú Archivo lleva «Abrir reciente» e «Imprimir…» (Ctrl+P); en el navegador, sin recientes', () => {
  const archivo = menuModel({ recents: [{ name: 'a.pdf', path: '/a.pdf' }] })[0];
  const rec = archivo.items.find((i) => i.label === 'Abrir reciente');
  assert.equal(rec.items[0].label, 'a.pdf');
  assert.equal(archivo.items.find((i) => i.cmd === 'print').accel, 'CmdOrCtrl+P');
  assert.ok(!menuModel({ web: true })[0].items.some((i) => i.label === 'Abrir reciente'));
});

// --- Diálogo de impresión (src/printLayout.js) ---------------------------------------------
const L = await import('../src/printLayout.js');
const near = (a, b) => Math.abs(a - b) < 0.01;

t('intervalo «1-3, 5»: páginas en orden y sin repetir; «7-» y «-2» abiertos', () => {
  assert.deepEqual(L.parseRange('1-3, 5', 10).pages, [0, 1, 2, 4]);
  assert.deepEqual(L.parseRange('5, 1-3, 2', 10).pages, [0, 1, 2, 4]);
  assert.deepEqual(L.parseRange('8-', 10).pages, [7, 8, 9]);
  assert.deepEqual(L.parseRange('-2', 10).pages, [0, 1]);
  assert.deepEqual(L.parseRange(' 4 – 5 ', 10).pages, [3, 4]);
});

t('intervalo no válido: un texto que lo explica', () => {
  assert.match(L.parseRange('', 10).error, /Escribe/);
  assert.match(L.parseRange('1-3, x', 10).error, /«x»/);
  assert.match(L.parseRange('12', 10).error, /10 páginas/);
  assert.match(L.parseRange('5-2', 10).error, /al revés/);
  assert.match(L.parseRange('-', 10).error, /no es una página/);
});

t('qué páginas: todas, la actual, la selección o el intervalo', () => {
  const state = { pages: ['a', 'b', 'c', 'd'].map((key) => ({ key })), selected: new Set(['c', 'a']), current: 1 };
  assert.deepEqual(L.resolvePages(state, 'all').pages.map((p) => p.key), ['a', 'b', 'c', 'd']);
  assert.deepEqual(L.resolvePages(state, 'current').pages.map((p) => p.key), ['b']);
  assert.deepEqual(L.resolvePages(state, 'selection').pages.map((p) => p.key), ['a', 'c']);
  assert.deepEqual(L.resolvePages(state, 'custom', '2-3').pages.map((p) => p.key), ['b', 'c']);
  assert.ok(L.resolvePages(state, 'custom', '9').error);
});

t('ajustar: una página vertical A4 en A4 cabe con su margen, centrada y sin girar', () => {
  const r = L.sheetLayout(595.28, 841.89, L.PAPERS.A4);
  assert.equal(r.rotate, 0);
  assert.ok(near(r.y, L.FIT_MARGIN) || near(r.x, L.FIT_MARGIN));
  assert.ok(r.x >= L.FIT_MARGIN - 0.01 && r.y >= L.FIT_MARGIN - 0.01);
  assert.ok(near(r.x * 2 + r.w, L.PAPERS.A4.w) && near(r.y * 2 + r.h, L.PAPERS.A4.h)); // centrada
});

t('orientación automática: una apaisada se gira 90° y aprovecha el papel; sin ella, se reduce en vertical', () => {
  const rot = L.sheetLayout(841.89, 595.28, L.PAPERS.A4);
  assert.equal(rot.rotate, 90);
  assert.ok(rot.w < rot.h); // ocupa la hoja a lo alto
  const flat = L.sheetLayout(841.89, 595.28, L.PAPERS.A4, { autoRotate: false });
  assert.equal(flat.rotate, 0);
  assert.ok(rot.scale > flat.scale * 1.3);
});

t('tamaño real: escala 1 y centrada (lo que no cabe se corta)', () => {
  const r = L.sheetLayout(841.89, 1190.55, L.PAPERS.A4, { fit: 'actual' }); // A3 en A4
  assert.equal(r.scale, 1);
  assert.ok(r.x < 0 && r.y < 0);
});

t('hojas: a doble cara la mitad (redondeando), por copia', () => {
  assert.equal(L.sheetCount(5, 1, 'simplex'), 5);
  assert.equal(L.sheetCount(5, 2, 'longEdge'), 6);
});

t('doble cara: no en impresoras virtuales; CUPS lo dice; si no, se supone que sí', () => {
  assert.equal(L.supportsDuplex({ name: 'Microsoft Print to PDF' }), false);
  assert.equal(L.supportsDuplex({ name: 'OneNote (Desktop)' }), false);
  assert.equal(L.supportsDuplex({ name: 'HP', options: { sides: 'one-sided' } }), false);
  assert.equal(L.supportsDuplex({ name: 'HP', options: { sides: 'two-sided-long-edge' } }), true);
  assert.equal(L.supportsDuplex({ name: 'Brother HL-L2350DW' }), true);
});

t('las impresoras virtuales que preguntan dónde guardar van por el diálogo del sistema', () => {
  assert.equal(L.needsSystemDialog({ name: 'Microsoft Print to PDF' }), true);
  assert.equal(L.needsSystemDialog({ name: 'Microsoft XPS Document Writer' }), true);
  assert.equal(L.needsSystemDialog({ name: 'Brother HL-L2350DW' }), false);
  assert.equal(L.needsSystemDialog(undefined), false);
});

t('lotes pares para imprimir documentos grandes', () => {
  assert.deepEqual(L.batches(50, 24), [[0, 24], [24, 48], [48, 50]]);
  assert.equal(L.PRINT_BATCH % 2, 0);
});

console.log(`\n${passed} pruebas de imprimir y recientes superadas.`);
