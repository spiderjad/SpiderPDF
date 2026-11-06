// Pruebas del estado (reordenar, selección, deshacer).  Ejecutar: npm test
import assert from 'node:assert/strict';
import { reducer, initialState, pagesFrom, targetKeys } from '../src/state.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };
const sizes = (n) => Array.from({ length: n }, () => ({ width: 595, height: 842 }));
const order = (s) => s.pages.map((p) => `${p.source}${p.index + 1}`).join(' ');

const A = { docId: 1, name: 'A' };
const B = { docId: 2, name: 'B' };
let s = reducer(initialState, { type: 'open', sources: [A], pages: pagesFrom(A, sizes(4)), file: { path: '/a.pdf', name: 'a.pdf' } });
const key = (label) => s.pages.find((p) => `${p.source}${p.index + 1}` === label).key;

t('abrir no marca cambios', () => { assert.equal(order(s), 'A1 A2 A3 A4'); assert.equal(s.dirty, false); });

t('mover una página al principio', () => {
  s = reducer(s, { type: 'move', keys: new Set([key('A3')]), to: 0 });
  assert.equal(order(s), 'A3 A1 A2 A4');
  assert.equal(s.dirty, true);
});

t('mover varias páginas juntas al final', () => {
  s = reducer(s, { type: 'move', keys: new Set([key('A3'), key('A1')]), to: 4 });
  assert.equal(order(s), 'A2 A4 A3 A1');
});

t('soltar en el mismo sitio no crea historial', () => {
  const before = s.past.length;
  s = reducer(s, { type: 'move', keys: new Set([key('A2')]), to: 0 });
  assert.equal(s.past.length, before);
});

t('selección con Mayús hace rango', () => {
  s = reducer(s, { type: 'select', key: key('A4'), how: 'single' });
  s = reducer(s, { type: 'select', key: key('A1'), how: 'range' });
  assert.equal(s.selected.size, 3);
});

t('girar suma cuartos de vuelta y vuelve a 0', () => {
  const k = new Set([key('A2')]);
  for (let i = 0; i < 4; i++) s = reducer(s, { type: 'rotate', keys: k, delta: 1 });
  assert.equal(s.pages[0].rot, 0);
  s = reducer(s, { type: 'rotate', keys: k, delta: -1 });
  assert.equal(s.pages[0].rot, 3);
});

t('añadir otro PDF en una posición concreta', () => {
  s = reducer(s, { type: 'add', sources: [B], pages: pagesFrom(B, sizes(2)), at: 1 });
  assert.equal(order(s), 'A2 B1 B2 A4 A3 A1');
  assert.equal(s.selected.size, 2);
});

t('eliminar la selección', () => {
  s = reducer(s, { type: 'delete', keys: s.selected });
  assert.equal(order(s), 'A2 A4 A3 A1');
});

t('deshacer y rehacer', () => {
  s = reducer(s, { type: 'undo' });
  assert.equal(order(s), 'A2 B1 B2 A4 A3 A1');
  s = reducer(s, { type: 'redo' });
  assert.equal(order(s), 'A2 A4 A3 A1');
});

t('en modo lectura sin selección actúa sobre la página actual', () => {
  s = reducer(s, { type: 'clearSelection' });
  s = reducer(s, { type: 'mode', mode: 'read' });
  s = reducer(s, { type: 'current', index: 2 });
  assert.deepEqual([...targetKeys(s)], [key('A3')]);
});

// --- Paso 2: anotaciones y formularios ---------------------------------------------
const C = { docId: 3, name: 'C' };
let f = reducer(initialState, {
  type: 'open', sources: [C],
  pages: pagesFrom(C, [{ width: 595, height: 842, rot0: 1 }, { width: 595, height: 842 }]),
  file: { path: '/c.pdf', name: 'c.pdf' },
});
const k0 = f.pages[0].key;
const k1 = f.pages[1].key;
const annotsOf = (st, k) => st.pages.find((p) => p.key === k).annots;

t('las páginas guardan rot0 y empiezan sin anotaciones ni campos', () => {
  assert.deepEqual(f.pages.map((p) => p.rot0), [1, 0]);
  assert.deepEqual(f.pages[0].annots, []);
  assert.deepEqual(f.pages[0].fields, {});
});

t('añadir una anotación le da id, la selecciona y marca cambios', () => {
  f = reducer(f, { type: 'addAnnot', key: k0, annot: { type: 'highlight', rect: [0.1, 0.1, 0.4, 0.15], color: '#FFD400' } });
  const [a] = annotsOf(f, k0);
  assert.ok(a.id);
  assert.deepEqual(f.annotSel, { key: k0, id: a.id });
  assert.equal(f.dirty, true);
  assert.equal(f.past.length, 1);
});

t('añadir no toca las demás páginas (se comparten por referencia)', () => {
  const before = f.pages[1];
  f = reducer(f, { type: 'addAnnot', key: k0, annot: { type: 'note', at: [0.5, 0.5], text: '' } });
  assert.equal(f.pages[1], before);
});

t('actualizar una anotación cambia solo esa', () => {
  const [hl, note] = annotsOf(f, k0);
  f = reducer(f, { type: 'updateAnnot', key: k0, id: note.id, changes: { text: 'Hola' } });
  assert.equal(annotsOf(f, k0)[1].text, 'Hola');
  assert.equal(annotsOf(f, k0)[0], hl);
});

t('arrastrar (group) se deshace de una vez', () => {
  const id = annotsOf(f, k0)[0].id;
  const before = f.past.length;
  for (const x of [0.2, 0.3, 0.4]) {
    f = reducer(f, { type: 'updateAnnot', key: k0, id, changes: { rect: [x, 0.1, x + 0.3, 0.15] }, group: true });
  }
  assert.equal(f.past.length, before + 1);
  f = reducer(f, { type: 'undo' });
  assert.deepEqual(annotsOf(f, k0)[0].rect, [0.1, 0.1, 0.4, 0.15]);
  f = reducer(f, { type: 'redo' });
  assert.deepEqual(annotsOf(f, k0)[0].rect, [0.4, 0.1, 0.7, 0.15]);
});

t('dos arrastres seguidos separados por otro cambio son dos pasos', () => {
  const id = annotsOf(f, k0)[0].id;
  const before = f.past.length;
  f = reducer(f, { type: 'updateAnnot', key: k0, id, changes: { color: '#00FF00' } });
  f = reducer(f, { type: 'updateAnnot', key: k0, id, changes: { rect: [0, 0, 0.3, 0.05] }, group: true });
  assert.equal(f.past.length, before + 2);
});

t('anotación inexistente o página inexistente: no cambia nada', () => {
  assert.equal(reducer(f, { type: 'updateAnnot', key: k0, id: 'nope', changes: { text: 'x' } }), f);
  assert.equal(reducer(f, { type: 'addAnnot', key: 'nope', annot: { type: 'note', at: [0, 0] } }), f);
  assert.equal(reducer(f, { type: 'removeAnnot', key: k0, id: 'nope' }), f);
});

t('borrar la anotación seleccionada quita la selección; deshacer la recupera', () => {
  const id = annotsOf(f, k0)[0].id;
  f = reducer(f, { type: 'selectAnnot', key: k0, id });
  f = reducer(f, { type: 'removeAnnot', key: k0, id });
  assert.equal(annotsOf(f, k0).length, 1);
  assert.equal(f.annotSel, null);
  f = reducer(f, { type: 'undo' });
  assert.equal(annotsOf(f, k0).length, 2);
  f = reducer(f, { type: 'selectAnnot', key: k0, id });
  f = reducer(f, { type: 'redo' });
  assert.equal(f.annotSel, null, 'tras rehacer el borrado ya no existe');
});

t('escribir en un campo se agrupa en un solo paso de deshacer', () => {
  const before = f.past.length;
  for (const v of ['D', 'Di', 'Die', 'Diego']) f = reducer(f, { type: 'setField', key: k1, annotIndex: 0, value: v });
  assert.deepEqual(f.pages[1].fields, { 0: 'Diego' });
  assert.equal(f.past.length, before + 1);
  f = reducer(f, { type: 'setField', key: k1, annotIndex: 2, value: true }); // otro campo: paso nuevo
  assert.equal(f.past.length, before + 2);
  f = reducer(f, { type: 'undo' });
  assert.deepEqual(f.pages[1].fields, { 0: 'Diego' });
  f = reducer(f, { type: 'undo' });
  assert.deepEqual(f.pages[1].fields, {});
});

t('poner el mismo valor no crea historial', () => {
  f = reducer(f, { type: 'setField', key: k1, annotIndex: 1, value: 'x' });
  const same = reducer(f, { type: 'setField', key: k1, annotIndex: 1, value: 'x' });
  assert.equal(same, f);
});

t('girar y mover conservan anotaciones y campos', () => {
  f = reducer(f, { type: 'rotate', keys: new Set([k0]), delta: 1 });
  f = reducer(f, { type: 'move', keys: new Set([k1]), to: 0 });
  assert.equal(f.pages[0].key, k1);
  assert.deepEqual(f.pages[0].fields, { 1: 'x' });
  assert.equal(f.pages[1].annots.length, 1); // la otra se borró (y se rehízo el borrado) arriba
  assert.equal(f.pages[1].rot, 1);
});

t('eliminar la página de la anotación seleccionada quita la selección', () => {
  f = reducer(f, { type: 'selectAnnot', key: k0, id: annotsOf(f, k0)[0].id });
  f = reducer(f, { type: 'delete', keys: new Set([k0]) });
  assert.equal(f.annotSel, null);
  f = reducer(f, { type: 'selectAnnot' });
  assert.equal(f.annotSel, null);
});

t('endGroup separa dos arrastres seguidos de la misma anotación', () => {
  let g = reducer(initialState, { type: 'open', sources: [C], pages: pagesFrom({ ...C, hasForm: true }, sizes(1)), file: null });
  assert.equal(g.pages[0].hasForm, true);
  const k = g.pages[0].key;
  g = reducer(g, { type: 'addAnnot', key: k, annot: { type: 'highlight', rect: [0, 0, 0.1, 0.1] } });
  const id = g.annotSel.id;
  const before = g.past.length;
  g = reducer(g, { type: 'updateAnnot', key: k, id, changes: { rect: [0.1, 0, 0.2, 0.1] }, group: true });
  g = reducer(g, { type: 'endGroup' });
  g = reducer(g, { type: 'updateAnnot', key: k, id, changes: { rect: [0.2, 0, 0.3, 0.1] }, group: true });
  assert.equal(g.past.length, before + 2);
  assert.equal(reducer(reducer(g, { type: 'endGroup' }), { type: 'endGroup' }).lastTag, null);
});

t('editar texto del PDF: guardar, deshacer y volver al original', () => {
  let g = reducer(initialState, { type: 'open', sources: [C], pages: pagesFrom(C, sizes(1)), file: null });
  const k = g.pages[0].key;
  assert.deepEqual(g.pages[0].textEdits, {});
  g = reducer(g, { type: 'setTextEdit', key: k, objIndex: 3, text: 'Hola', from: 'Adiós' });
  assert.deepEqual(g.pages[0].textEdits, { 3: { text: 'Hola', from: 'Adiós' } });
  assert.equal(reducer(g, { type: 'setTextEdit', key: k, objIndex: 3, text: 'Hola', from: 'Adiós' }), g, 'mismo texto: sin cambios');
  g = reducer(g, { type: 'setTextEdit', key: k, objIndex: 3, text: '', from: 'Adiós' });
  assert.equal(g.pages[0].textEdits[3].text, '');
  g = reducer(g, { type: 'setTextEdit', key: k, objIndex: 3, text: 'Adiós', from: 'Adiós' });
  assert.deepEqual(g.pages[0].textEdits, {}, 'volver al original quita la edición');
  g = reducer(g, { type: 'undo' });
  assert.equal(g.pages[0].textEdits[3].text, '');
  assert.equal(reducer(initialState, { type: 'setTextEdit', key: 'x', objIndex: 0, text: 'a', from: 'b' }), initialState);
});

t('duplicar una anotación (Ctrl+D): copia desplazada, con id propio, seleccionada; se deshace', () => {
  const [p] = pagesFrom({ docId: 1, name: 'x' }, [{ width: 595, height: 842 }]);
  let s = reducer({ ...initialState, pages: [p] }, { type: 'addAnnot', key: p.key, annot: { type: 'textbox', rect: [0.1, 0.1, 0.4, 0.2], k: 0, text: 'Hola', style: {} } });
  const id = s.annotSel.id;
  s = reducer(s, { type: 'duplicateAnnot', key: p.key, id });
  const [a, b] = s.pages[0].annots;
  assert.notEqual(b.id, a.id);
  assert.equal(b.text, 'Hola');
  assert.ok(Math.abs(b.rect[0] - 0.12) < 1e-9 && Math.abs(b.rect[1] - 0.12) < 1e-9);
  assert.deepEqual(s.annotSel, { key: p.key, id: b.id });
  assert.equal(reducer(s, { type: 'undo' }).pages[0].annots.length, 1);
});

t('traer al frente / enviar atrás: cambia el orden de dibujo; si ya estaba ahí, no cuenta como cambio', () => {
  const [p] = pagesFrom({ docId: 1, name: 'x' }, [{ width: 595, height: 842 }]);
  const annots = ['a', 'b', 'c'].map((id) => ({ id, type: 'textbox', rect: [0, 0, 0.1, 0.1] }));
  const s = { ...initialState, pages: [{ ...p, annots }] };
  assert.deepEqual(reducer(s, { type: 'reorderAnnot', key: p.key, id: 'a', to: 'front' }).pages[0].annots.map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(reducer(s, { type: 'reorderAnnot', key: p.key, id: 'c', to: 'back' }).pages[0].annots.map((x) => x.id), ['c', 'a', 'b']);
  assert.equal(reducer(s, { type: 'reorderAnnot', key: p.key, id: 'c', to: 'front' }), s);
});

t('OCR: la capa de cada página se guarda en el estado; una tanda entera se deshace de una vez', () => {
  let o = reducer(initialState, { type: 'open', sources: [C], pages: pagesFrom(C, sizes(3)), file: { path: '/c.pdf', name: 'c.pdf' } });
  const [k1, k2] = o.pages.map((p) => p.key);
  const words = [{ t: 'Hola', a: [0.1, 0.1], b: [0.2, 0.1], size: 12, line: 0, space: false }];
  o = reducer(o, { type: 'setOcr', key: k1, words, job: 7 });
  o = reducer(o, { type: 'setOcr', key: k2, words, job: 7 });
  assert.equal(o.dirty, true);
  assert.deepEqual(o.pages.map((p) => p.ocr?.length ?? 0), [1, 1, 0]);
  o = reducer(o, { type: 'undo' });
  assert.deepEqual(o.pages.map((p) => p.ocr?.length ?? 0), [0, 0, 0], 'un solo paso');
  o = reducer(o, { type: 'redo' });
  assert.deepEqual(o.pages.map((p) => p.ocr?.length ?? 0), [1, 1, 0]);
  assert.equal(reducer(o, { type: 'setOcr', key: 'no-existe', words, job: 8 }), o);
});

console.log(`\n${passed} pruebas de estado superadas.`);
