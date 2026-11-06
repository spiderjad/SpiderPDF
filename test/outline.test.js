// Índice tras reordenar, eliminar y unir (src/outline.js).  Ejecutar: node test/outline.test.js
import assert from 'node:assert/strict';
import { mapOutline, pruneOutline, activeId, visibleNodes } from '../src/outline.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

const tree = [
  { title: 'Uno', pageIndex: 0, children: [{ title: 'Uno.a', pageIndex: 1, children: [] }] },
  { title: 'Dos', pageIndex: 2, children: [] },
  { title: 'Web', pageIndex: -1, children: [] },
];
const pg = (docId, index) => ({ docId, index });
const brief = (nodes) => nodes.map((n) => [n.title, n.pos, n.missing, brief(n.children)]);

t('un solo PDF: cada marcador apunta a la posición actual de su página', () => {
  const out = mapOutline([pg(1, 2), pg(1, 0), pg(1, 1)], new Map([[1, tree]]));
  assert.deepEqual(brief(out), [['Uno', 1, false, [['Uno.a', 2, false, []]]], ['Dos', 0, false, []], ['Web', -1, false, []]]);
});

t('si su página se eliminó, queda marcado como perdido (missing); un enlace externo no', () => {
  const out = mapOutline([pg(1, 0), pg(1, 2)], new Map([[1, tree]]));
  assert.deepEqual(out[0].children[0].missing, true);
  assert.equal(out[0].children[0].pos, -1);
  assert.equal(out[2].missing, false);
});

t('varios PDFs: un grupo por archivo, en el orden en que aparecen, con su nombre', () => {
  const out = mapOutline([pg(2, 0), pg(1, 0), pg(2, 1)], new Map([[1, tree], [2, []]]), new Map([[1, 'Propuesta'], [2, 'Carta']]));
  assert.deepEqual(out.map((g) => [g.title, g.pos, g.group]), [['Carta', 0, true], ['Propuesta', 1, true]]);
  assert.equal(out[1].children[0].pos, 1);
  assert.equal(out[1].children[1].missing, true);
});

t('varios PDFs sin ningún índice: lista vacía', () => {
  assert.deepEqual(mapOutline([pg(1, 0), pg(2, 0)], new Map([[1, []], [2, []]])), []);
});

t('para guardar se quitan los que no llevan a ninguna página, salvo que tengan hijos que sí', () => {
  const out = pruneOutline(mapOutline([pg(1, 1)], new Map([[1, tree]])));
  assert.deepEqual(brief(out), [['Uno', -1, true, [['Uno.a', 0, false, []]]]]);
});

const big = mapOutline([0, 1, 2].map((i) => pg(1, i)), new Map([[1, tree]]));

t('marcador activo: el último cuya página es la actual o anterior', () => {
  assert.equal(activeId(big, 0), 'd1/0');
  assert.equal(activeId(big, 1), 'd1/0/0');
  assert.equal(activeId(big, 2), 'd1/1');
});

t('si el activo está dentro de un nodo plegado, se marca ese nodo', () => {
  assert.equal(activeId(big, 1, new Set()), 'd1/0');
  assert.equal(activeId(big, 1, new Set(['d1/0'])), 'd1/0/0');
});

t('nodos visibles para el teclado: los hijos de un plegado no cuentan', () => {
  assert.equal(visibleNodes(big, new Set()).length, 3);
  assert.deepEqual(visibleNodes(big, new Set(['d1/0'])).map((v) => [v.node.title, v.depth]), [['Uno', 0], ['Uno.a', 1], ['Dos', 0], ['Web', 0]]);
});

console.log(`\n${passed} pruebas de índice superadas.`);
