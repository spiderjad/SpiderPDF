// Insertar páginas nuevas (src/insertPages.js) y deshacer.  Ejecutar: node test/insert.test.js
import assert from 'node:assert/strict';
import { blankSize, imagePageSize, insertIndex, referencePage, blankPage, imagePage, A4, A3 } from '../src/insertPages.js';
import { reducer, initialState } from '../src/state.js';
import { PAGE_SIZES, MAX_NEW_PAGES, clampCount, newPageSize, newDocumentPages } from '../src/newDocument.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} ≠ ${b}`);

t('página en blanco: A4 si no hay referencia; si la hay, su tamaño tal como se ve (girada incluida)', () => {
  assert.deepEqual(blankSize(null), A4);
  assert.deepEqual(blankSize({ width: 842, height: 595, rot: 0 }), { width: 842, height: 595 });
  assert.deepEqual(blankSize({ width: 595, height: 842, rot: 1 }), { width: 842, height: 595 });
});

t('imagen como página: su tamaño a 150 ppp', () => {
  const s = imagePageSize(1500, 900); // 10 × 6 pulgadas
  near(s.width, 720, 'ancho');
  near(s.height, 432, 'alto');
  assert.deepEqual([s.pxW, s.pxH], [1500, 900]); // no se reduce
});

t('imagen enorme (foto de móvil 4000 × 3000): como mucho A3 apaisado y como mucho 300 ppp', () => {
  const s = imagePageSize(4000, 3000); // 4:3 es menos alargada que A3 (√2:1): la limita el alto
  near(s.height, A3.width, 'alto = lado corto de A3');
  near(s.width, (A3.width * 4) / 3, 'ancho con la proporción');
  assert.ok(s.width <= A3.height + 0.01 && s.height <= A3.width + 0.01);
  assert.equal(s.pxW, 4000); // 4000 px en 15,6″ ≈ 257 ppp: no hace falta reducir
  const big = imagePageSize(12000, 9000); // ≈ 770 ppp en esa página
  assert.equal(big.pxW, Math.round((big.width * 300) / 72));
  assert.equal(big.pxH, Math.round((big.pxW * 9000) / 12000));
});

t('imagen vertical: A3 vertical como máximo', () => {
  const s = imagePageSize(3000, 6000);
  near(s.height, A3.height, 'alto');
  near(s.width, A3.height / 2, 'ancho');
});

const pages = ['a', 'b', 'c', 'd'].map((k) => ({ key: k, width: 595, height: 842, rot: 0 }));
const st = (extra) => ({ ...initialState, pages, ...extra });

t('se inserta tras la última página seleccionada; sin selección, tras la actual al leer, o al final', () => {
  assert.equal(insertIndex(st({ selected: new Set(['a', 'c']) })), 3);
  assert.equal(insertIndex(st({ mode: 'read', current: 1 })), 2);
  assert.equal(insertIndex(st({ mode: 'organize' })), 4);
  assert.equal(referencePage(st({ selected: new Set(['b', 'a']) })).key, 'b');
  assert.equal(referencePage(st({})), null);
});

t('las páginas nuevas no vienen de ningún PDF y se deshacen como cualquier cambio', () => {
  const b = blankPage(A4);
  const i = imagePage({ blob: 'blob', pxW: 1500, pxH: 900, name: 'plano.png' });
  assert.equal(b.docId, null);
  assert.deepEqual(b.created, { kind: 'blank' });
  assert.equal(i.source, 'plano');
  assert.equal(i.created.kind, 'image');
  let s = st({ selected: new Set(['b']) });
  s = reducer(s, { type: 'add', pages: [b, i], sources: [], at: insertIndex(s) });
  assert.deepEqual(s.pages.map((p) => p.key), ['a', 'b', b.key, i.key, 'c', 'd']);
  assert.deepEqual([...s.selected], [b.key, i.key]);
  s = reducer(s, { type: 'undo' });
  assert.deepEqual(s.pages.map((p) => p.key), ['a', 'b', 'c', 'd']);
});

t('nuevo documento: A4, Carta y A3 en vertical u horizontal', () => {
  const a4 = newPageSize('A4', false);
  near(a4.width, 595.28, 'A4 ancho'); near(a4.height, 841.89, 'A4 alto');
  assert.deepEqual(newPageSize('Letter', true), { width: 792, height: 612 });
  const a3 = newPageSize('A3', true);
  near(a3.width, 1190.55, 'A3 horizontal ancho'); near(a3.height, 841.89, 'A3 horizontal alto');
  assert.deepEqual(newPageSize('desconocido', false), newPageSize('A4', false));
  assert.deepEqual(Object.keys(PAGE_SIZES), ['A4', 'Letter', 'A3']);
});

t(`nuevo documento: de 1 a ${MAX_NEW_PAGES} páginas en blanco, todas del mismo tamaño y sin PDF de origen`, () => {
  assert.equal(clampCount(0), 1); assert.equal(clampCount(-3), 1); assert.equal(clampCount('abc'), 1);
  assert.equal(clampCount('7'), 7); assert.equal(clampCount(2.6), 3); assert.equal(clampCount(10_000), MAX_NEW_PAGES);
  const pages = newDocumentPages({ size: 'Letter', landscape: false, count: 3 });
  assert.equal(pages.length, 3);
  assert.equal(new Set(pages.map((p) => p.key)).size, 3);
  for (const p of pages) {
    assert.deepEqual([p.docId, p.index, p.width, p.height, p.rot, p.created.kind], [null, -1, 612, 792, 0, 'blank']);
  }
});

t('nuevo documento en el estado: sin archivo, con cambios sin guardar y sin historial de deshacer', () => {
  const s = reducer(initialState, { type: 'open', sources: [], pages: newDocumentPages({ size: 'A4', landscape: true, count: 2 }), file: null });
  assert.equal(s.pages.length, 2); assert.equal(s.file, null); assert.equal(s.dirty, true);
  assert.equal(s.past.length, 0);
  assert.ok(s.pages[0].width > s.pages[0].height);
});

console.log(`\n${passed} pruebas de insertar páginas superadas.`);
