// Pruebas de las pestañas (src/tabs.js): abrir, cerrar, cambiar, mover y pasar un documento a otra ventana.
// Ejecutar: npm test
import assert from 'node:assert/strict';
import { pagesFrom } from '../src/state.js';
import {
  initialTabs, tabsReducer, activeTab, isBlank, dirtyTabs, findTabByPath, cycleTab, sessionOf, snapshotDoc, restoreDoc,
} from '../src/tabs.js';

let passed = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const sizes = (n) => Array.from({ length: n }, () => ({ width: 595, height: 842 }));
const src = (docId, name) => ({ docId, name, path: `C:\\docs\\${name}.pdf` });
const openAction = (s, extra = {}) => ({ type: 'tabOpen', sources: [s], pages: pagesFrom(s, sizes(3)), file: { path: s.path, name: `${s.name}.pdf` }, ...extra });
const names = (root) => root.tabs.map((x) => x.doc.file?.name ?? '(vacía)');

t('empieza con una pestaña vacía', () => {
  const r = initialTabs();
  assert.equal(r.tabs.length, 1);
  assert.equal(r.active, r.tabs[0].id);
  assert.ok(isBlank(activeTab(r).doc));
});

t('abrir en la pestaña vacía la reutiliza; el siguiente va a una nueva a la derecha y queda activa', () => {
  let r = initialTabs();
  const first = r.active;
  r = tabsReducer(r, openAction(src(1, 'a'), { into: first }));
  assert.deepEqual(names(r), ['a.pdf']);
  assert.equal(r.active, first);
  assert.equal(activeTab(r).doc.dirty, false);
  r = tabsReducer(r, openAction(src(2, 'b'), { into: first })); // la activa ya no está vacía: pestaña nueva
  assert.deepEqual(names(r), ['a.pdf', 'b.pdf']);
  assert.equal(activeTab(r).doc.file.name, 'b.pdf');
  r = tabsReducer(r, { type: 'tabActivate', id: first });
  r = tabsReducer(r, openAction(src(3, 'c')));
  assert.deepEqual(names(r), ['a.pdf', 'c.pdf', 'b.pdf'], 'se abre junto a la activa');
});

t('la pestaña nueva hereda la vista y el zoom de la activa', () => {
  let r = tabsReducer(initialTabs(), openAction(src(1, 'a'), {}));
  r = tabsReducer(r, { type: 'mode', mode: 'read' });
  r = tabsReducer(r, { type: 'zoom', zoom: 1.5 });
  r = tabsReducer(r, { type: 'tabNew' });
  assert.equal(activeTab(r).doc.mode, 'read');
  assert.equal(activeTab(r).doc.zoom, 1.5);
  assert.ok(isBlank(activeTab(r).doc));
});

t('las acciones de documento van a la activa o a la pestaña a.tab', () => {
  let r = tabsReducer(initialTabs(), openAction(src(1, 'a'), {}));
  const a = r.active;
  r = tabsReducer(r, openAction(src(2, 'b')));
  const b = r.active;
  r = tabsReducer(r, { type: 'rotate', keys: new Set([r.tabs[1].doc.pages[0].key]), delta: 1 });
  assert.equal(r.tabs[1].doc.pages[0].rot, 1);
  assert.equal(r.tabs[1].doc.dirty, true);
  // Guardar terminó en la pestaña a mientras se miraba la b: va a la a.
  r = tabsReducer(r, { type: 'saved', file: { path: 'C:\\x.pdf', name: 'x.pdf' }, tab: a });
  assert.equal(r.tabs[0].doc.file.name, 'x.pdf');
  assert.equal(r.tabs[1].doc.file.name, 'b.pdf');
  assert.equal(r.active, b);
  // Una pestaña que ya no existe: nada.
  const same = tabsReducer(r, { type: 'saved', file: { path: 'C:\\y.pdf', name: 'y.pdf' }, tab: 'zzz' });
  assert.equal(same, r);
  // Una acción que no cambia nada no crea un estado nuevo.
  assert.equal(tabsReducer(r, { type: 'current', index: 0 }), r);
});

t('cerrar: la activa pasa a la de la derecha, o a la izquierda si era la última; la última deja una vacía', () => {
  let r = initialTabs();
  r = tabsReducer(r, openAction(src(1, 'a'), { into: r.active }));
  r = tabsReducer(r, openAction(src(2, 'b')));
  r = tabsReducer(r, openAction(src(3, 'c')));
  const [ta, tb, tc] = r.tabs.map((x) => x.id);
  r = tabsReducer(r, { type: 'tabActivate', id: tb });
  r = tabsReducer(r, { type: 'tabClose', id: tb });
  assert.deepEqual(names(r), ['a.pdf', 'c.pdf']);
  assert.equal(r.active, tc);
  r = tabsReducer(r, { type: 'tabClose', id: tc });
  assert.equal(r.active, ta);
  r = tabsReducer(r, { type: 'tabClose', id: 'no-existe' });
  assert.deepEqual(names(r), ['a.pdf']);
  r = tabsReducer(r, { type: 'tabClose', id: ta });
  assert.equal(r.tabs.length, 1);
  assert.ok(isBlank(activeTab(r).doc));
  // Cerrar otra que no es la activa no cambia la activa.
  r = tabsReducer(r, openAction(src(4, 'd'), { into: r.active }));
  r = tabsReducer(r, openAction(src(5, 'e')));
  const [td, te] = r.tabs.map((x) => x.id);
  r = tabsReducer(r, { type: 'tabClose', id: td });
  assert.equal(r.active, te);
});

t('Ctrl+Tab y Ctrl+Mayús+Tab dan la vuelta', () => {
  let r = tabsReducer(initialTabs(), openAction(src(1, 'a'), {}));
  r = tabsReducer(r, openAction(src(2, 'b')));
  r = tabsReducer(r, openAction(src(3, 'c')));
  const ids = r.tabs.map((x) => x.id);
  assert.equal(r.active, ids[2]);
  assert.equal(cycleTab(r, 1), ids[0]);
  assert.equal(cycleTab(r, -1), ids[1]);
});

t('arrastrar en la barra cambia el orden (sin tocar los documentos)', () => {
  let r = tabsReducer(initialTabs(), openAction(src(1, 'a'), {}));
  r = tabsReducer(r, openAction(src(2, 'b')));
  r = tabsReducer(r, openAction(src(3, 'c')));
  const c = r.tabs[2];
  r = tabsReducer(r, { type: 'tabMove', id: c.id, to: 0 });
  assert.deepEqual(names(r), ['c.pdf', 'a.pdf', 'b.pdf']);
  assert.equal(r.tabs[0], c);
  assert.equal(tabsReducer(r, { type: 'tabMove', id: c.id, to: 0 }), r);
  r = tabsReducer(r, { type: 'tabMove', id: c.id, to: 99 });
  assert.deepEqual(names(r), ['a.pdf', 'b.pdf', 'c.pdf']);
});

t('buscar la pestaña de un archivo (sin distinguir mayúsculas ni barras en Windows)', () => {
  let r = tabsReducer(initialTabs(), openAction(src(1, 'a'), {}));
  r = tabsReducer(r, openAction(src(2, 'b')));
  assert.equal(findTabByPath(r, 'c:/DOCS/a.PDF')?.doc.file.name, 'a.pdf');
  assert.equal(findTabByPath(r, 'C:\\docs\\z.pdf'), null);
  assert.equal(findTabByPath(r, null), null);
  // Un PDF añadido a otro documento no cuenta como abierto.
  const added = src(9, 'anexo');
  r = tabsReducer(r, { type: 'add', sources: [added], pages: pagesFrom(added, sizes(1)) });
  assert.equal(findTabByPath(r, added.path), null);
});

t('cambios sin guardar y lo que se recuerda de la sesión', () => {
  let r = tabsReducer(initialTabs(), openAction(src(1, 'a'), {}));
  r = tabsReducer(r, openAction(src(2, 'b')));
  r = tabsReducer(r, { type: 'tabNew' }); // vacía: no se recuerda
  assert.deepEqual(dirtyTabs(r), []);
  r = tabsReducer(r, { type: 'rotate', keys: new Set([r.tabs[0].doc.pages[0].key]), delta: 1, tab: r.tabs[0].id });
  assert.deepEqual(dirtyTabs(r).map((x) => x.doc.file.name), ['a.pdf']);
  assert.deepEqual(sessionOf(r), { tabs: ['C:\\docs\\a.pdf', 'C:\\docs\\b.pdf'], active: 0 });
  r = tabsReducer(r, { type: 'tabActivate', id: r.tabs[1].id });
  assert.equal(sessionOf(r).active, 1);
});

t('pasar a otra ventana: sin historial, Blobs como bytes, claves nuevas y todo lo que las nombra', async () => {
  const s = src(7, 'contrato');
  let r = tabsReducer(initialTabs(), openAction(s, {}));
  const doc0 = activeTab(r).doc;
  const [p0, p1, p2] = doc0.pages.map((p) => p.key);
  const sig = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  r = tabsReducer(r, { type: 'addAnnot', key: p1, annot: { type: 'image', rect: [0.1, 0.1, 0.3, 0.2], k: 0, src: sig } });
  r = tabsReducer(r, { type: 'addAnnot', key: p1, annot: { type: 'note', rect: [0.5, 0.5, 0.55, 0.55], text: 'hola' } });
  r = tabsReducer(r, { type: 'add', sources: [], pages: [{ key: 'pnueva', docId: null, index: -1, width: 595, height: 842, rot0: 0, rot: 0, source: '', annots: [], fields: {}, textEdits: {}, created: { kind: 'image', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), pxW: 10, pxH: 10, name: 'foto.jpg' } }], at: 3 });
  r = tabsReducer(r, { type: 'setOutline', outline: [{ title: 'Uno', key: p0, children: [{ title: 'Dos', key: p2, children: [] }] }] });
  r = tabsReducer(r, { type: 'select', key: p2, how: 'single' });
  r = tabsReducer(r, { type: 'mode', mode: 'read' });
  r = tabsReducer(r, { type: 'current', index: 2 });
  const doc = activeTab(r).doc;
  assert.ok(doc.past.length > 0);
  const noteId = doc.pages[1].annots[1].id;
  r = tabsReducer(r, { type: 'selectAnnot', key: p1, id: noteId });

  const snap = await snapshotDoc(activeTab(r).doc);
  assert.equal(snap.past, undefined, 'el historial no viaja');
  assert.deepEqual(snap.selected, [p2]);
  assert.ok(snap.pages[1].annots[0].src.bytes instanceof Uint8Array, 'la firma viaja como bytes');
  assert.equal(snap.pages[3].created.blob.type, 'image/jpeg');
  assert.ok(!JSON.stringify(Object.keys(snap)).includes('future'));
  structuredClone(snap); // se puede mandar por IPC

  const opened = { docId: 41, name: 'contrato', path: s.path };
  const back = restoreDoc(snap, { docIds: new Map([[7, 41]]), sources: [opened] });
  assert.deepEqual(back.sources, [opened]);
  assert.deepEqual(back.pages.map((p) => p.docId), [41, 41, 41, null]);
  assert.ok(back.pages.every((p, i) => p.key !== snap.pages[i].key), 'claves nuevas');
  assert.ok(back.pages[1].annots[0].src instanceof Blob && back.pages[1].annots[0].src.type === 'image/png');
  assert.deepEqual([...new Uint8Array(await back.pages[3].created.blob.arrayBuffer())], [1, 2, 3]);
  assert.equal(back.pages[1].annots[1].text, 'hola');
  assert.notEqual(back.pages[1].annots[1].id, noteId);
  assert.deepEqual(back.annotSel, { key: back.pages[1].key, id: back.pages[1].annots[1].id });
  assert.deepEqual([...back.selected], [back.pages[2].key]);
  assert.equal(back.outline[0].key, back.pages[0].key);
  assert.equal(back.outline[0].children[0].key, back.pages[2].key);
  assert.equal(back.mode, 'read');
  assert.equal(back.current, 2);
  assert.equal(back.dirty, true);
  assert.deepEqual(back.past, []);
  assert.deepEqual(back.future, []);

  // En la ventana nueva entra en su pestaña vacía.
  let w = initialTabs();
  w = tabsReducer(w, { type: 'tabAdopt', doc: back, into: w.active });
  assert.equal(w.tabs.length, 1);
  assert.equal(activeTab(w).doc, back);
  // Y deshacer en ella empieza de cero.
  assert.equal(tabsReducer(w, { type: 'undo' }), w);
});

t('una protección nueva («Proteger», que vive en el worker) no viaja; quitarla sí', async () => {
  let r = tabsReducer(initialTabs(), openAction(src(1, 'a'), {}));
  r = tabsReducer(r, { type: 'setSecurity', security: { kind: 'set', token: 'p1', perms: 0 } });
  assert.equal((await snapshotDoc(activeTab(r).doc)).security, null);
  r = tabsReducer(r, { type: 'setSecurity', security: { kind: 'remove' } });
  assert.deepEqual((await snapshotDoc(activeTab(r).doc)).security, { kind: 'remove' });
});

t('restoreDoc falla si falta el PDF de alguna página', async () => {
  const s = src(3, 'x');
  const r = tabsReducer(initialTabs(), openAction(s, {}));
  const snap = await snapshotDoc(activeTab(r).doc);
  assert.throws(() => restoreDoc(snap, { docIds: new Map(), sources: [] }));
});

for (const [name, fn] of tests) {
  await fn();
  passed++;
  console.log('  ok -', name);
}
console.log(`\ntabs: ${passed} pruebas correctas`);
