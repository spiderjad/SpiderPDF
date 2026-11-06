// Índice impreso → marcadores (src/toc.js) e índice creado en el estado (outline.js, state.js).  npm test
import assert from 'node:assert/strict';
import {
  textLines, parseTocLine, numbering, tocEntries, guessOffset, targetIndex, findTocPages, treeFromLevels, levelsFromTree,
} from '../src/toc.js';
import { mapCustomOutline, outlineForSave } from '../src/outline.js';
import { reducer, initialState } from '../src/state.js';
import { allows, editPolicy } from '../src/signed.js';

const test = (name, fn) => { try { fn(); console.log(`ok - ${name}`); } catch (e) { console.error(`FALLO - ${name}`); throw e; } };

/** Caracteres como los da el motor: lines = [[texto, u0, v, uRight?]]; cada letra de 0,008 de ancho. */
function chars(lines) {
  let text = '';
  const boxes = [];
  lines.forEach(([t, u0, v, uRight], li) => {
    const cw = uRight ? (uRight - u0) / t.length : 0.008;
    [...t].forEach((c, i) => { text += c; boxes.push(u0 + i * cw, v, u0 + (i + 1) * cw, v + 0.014); });
    if (li < lines.length - 1) { text += '\r\n'; boxes.push(0, 0, 0, 0, 0, 0, 0, 0); }
  });
  return { text, boxes: Float32Array.from(boxes) };
}

const R = 0.9; // borde derecho de la columna de números
const toc = (rows, start = 0.2) => rows.map(([t, indent = 0], i) => [t, 0.1 + indent, start + i * 0.03, R]);

test('parseTocLine: relleno, número, romanos, y lo que no es una entrada', () => {
  assert.deepEqual(parseTocLine('2.1 ESTRUCTURA ORGANIZATIVA ............ 4'), { title: '2.1 ESTRUCTURA ORGANIZATIVA', printed: 4, roman: false, leader: true });
  assert.deepEqual(parseTocLine('1 INTRODUCCIÓN. ANTECEDENTES Y OBJETIVOS.................. 4').title, '1 INTRODUCCIÓN. ANTECEDENTES Y OBJETIVOS');
  assert.equal(parseTocLine('Prólogo . . . . . . . iv').printed, 4);
  assert.equal(parseTocLine('Prólogo . . . . . . . iv').roman, true);
  assert.equal(parseTocLine('Capítulo 3 … 27').printed, 27);
  assert.equal(parseTocLine('Introducción    5').leader, false);
  assert.equal(parseTocLine('Anexo vi'), null);         // romano sin relleno: parte del título
  assert.equal(parseTocLine('Hoja2'), null);            // pegado: no es un número de página
  assert.equal(parseTocLine('.......... 12'), null);    // sin título
  assert.equal(parseTocLine('Informe anual 2024'), null);
});

test('numbering: profundidad por la numeración', () => {
  assert.equal(numbering('2.1 Fases').depth, 2);
  assert.equal(numbering('3. Presupuesto').depth, 1);
  assert.equal(numbering('A.2 Anexo').depth, 2);
  assert.equal(numbering('A. Anexo').depth, 1);
  assert.equal(numbering('A modo de resumen'), null);
  assert.equal(numbering('2024 en cifras'), null);
});

test('textLines une el número que PDFium separa del título y ordena de arriba abajo', () => {
  const c = chars([['Segundo ....', 0.1, 0.30], ['7', 0.88, 0.302, 0.9], ['Primero ....', 0.1, 0.2], ['3', 0.88, 0.2, 0.9]]);
  const lines = textLines(c);
  assert.deepEqual(lines.map((l) => l.text), ['Primero .... 3', 'Segundo .... 7']);
  assert.ok(Math.abs(lines[0].u1 - 0.9) < 1e-6);
});

const MEMBRETE = [
  ['Consultora S.L.', 0, 0.05], ['Página 3 de 16', 0.7, 0.05],
];
const propuestaPage = () => chars([
  ['Consultora S.L.', 0.1, 0.05], ['Página 3 de 16', 0.78, 0.05, R],
  ['ÍNDICE', 0.1, 0.15],
  ...toc([
    ['INFORMACIÓN GENERAL ................................ 2'],
    ['ÍNDICE ........................................... 3'],
    ['1 INTRODUCCIÓN. ANTECEDENTES Y OBJETIVOS........... 4'],
    ['2 DESCRIPCIÓN Y ALCANCE ........................... 4'],
    ['2.1 ESTRUCTURA ORGANIZATIVA ....................... 4'],
    ['2.2 FLUJO DE TRASLADO ............................. 4'],
    ['2.3 FLUJO DE VENTAS ............................... 6'],
    ['3 PLAN DE PROYECTO ................................ 10'],
    ['4 PROPUESTA ECONÓMICA ............................. 11'],
    ['4.1 HONORARIOS .................................... 11'],
  ]),
  ['Pie de página 3', 0.4, 0.95],
]);
void MEMBRETE;

test('tocEntries: entradas, niveles por numeración y sin cabecera ni pie', () => {
  const { entries, score } = tocEntries(textLines(propuestaPage()));
  assert.equal(score, 10);
  assert.deepEqual(entries.map((e) => [e.title, e.level, e.printed]), [
    ['INFORMACIÓN GENERAL', 1, 2],
    ['ÍNDICE', 1, 3],
    ['1 INTRODUCCIÓN. ANTECEDENTES Y OBJETIVOS', 1, 4],
    ['2 DESCRIPCIÓN Y ALCANCE', 1, 4],
    ['2.1 ESTRUCTURA ORGANIZATIVA', 2, 4],
    ['2.2 FLUJO DE TRASLADO', 2, 4],
    ['2.3 FLUJO DE VENTAS', 2, 6],
    ['3 PLAN DE PROYECTO', 1, 10],
    ['4 PROPUESTA ECONÓMICA', 1, 11],
    ['4.1 HONORARIOS', 2, 11],
  ]);
});

test('tocEntries: sin numeración, el nivel sale de la sangría; título partido en dos líneas', () => {
  const c = chars([
    ['Contenido', 0.1, 0.1],
    ...toc([
      ['Presentación .................... 1'],
      ['Objetivos ....................... 2', 0.04],
      ['Alcance del trabajo y', 0.04],
    ], 0.2),
    ['condiciones particulares ........ 3', 0.14, 0.29, R],
    ...toc([
      ['Presupuesto ..................... 5'],
      ['Honorarios ...................... 5', 0.04],
      ['Detalle por fase ................ 6', 0.08],
    ], 0.32),
  ]);
  const { entries } = tocEntries(textLines(c));
  assert.deepEqual(entries.map((e) => [e.title, e.level, e.printed]), [
    ['Presentación', 1, 1],
    ['Objetivos', 2, 2],
    ['Alcance del trabajo y condiciones particulares', 2, 3],
    ['Presupuesto', 1, 5],
    ['Honorarios', 2, 5],
    ['Detalle por fase', 3, 6],
  ]);
});

test('tocEntries: sin relleno de puntos, por la columna de números alineada', () => {
  const c = chars([['Índice', 0.1, 0.1], ...toc([['Uno 1'], ['Dos 4'], ['Tres 9'], ['Cuatro 12']])]);
  assert.equal(tocEntries(textLines(c)).entries.length, 4);
  // Texto corrido que termina en números sueltos (sin alinear): no es un índice.
  const prosa = chars([['En 2023 vendimos 12', 0.1, 0.2, 0.5], ['y luego unas 40', 0.1, 0.23, 0.42], ['y al final otras 7', 0.1, 0.26, 0.61], ['más 3', 0.1, 0.29, 0.2]]);
  assert.equal(tocEntries(textLines(prosa)).score, 0);
  // Números que bajan sin sentido: no es un índice.
  const tabla = chars(toc([['Enero .... 30'], ['Febrero .... 2'], ['Marzo .... 25'], ['Abril .... 1'], ['Mayo .... 19']]));
  assert.equal(tocEntries(textLines(tabla)).score, 0);
});

test('guessOffset: desfase por los títulos en las páginas (sin contar el índice)', () => {
  const entries = [
    { title: '1 Introducción', printed: 1 }, { title: '2 Alcance', printed: 2 }, { title: '3 Presupuesto', printed: 4 },
  ];
  const pages = ['Portada', 'Índice: 1 Introducción 1 2 Alcance 2 3 Presupuesto 4', 'INTRODUCCIÓN y más', '2. ALCANCE', 'nada', '3 PRESUPUESTO'];
  const g = guessOffset(entries, pages, [1]);
  assert.equal(g.offset, 2);
  assert.equal(g.matched, 3);
  assert.equal(targetIndex(entries[2], g.offset), 5);
  // Sin coincidencias: 0. Romanos: desde la primera página.
  assert.equal(guessOffset(entries, ['a', 'b']).offset, 0);
  assert.equal(targetIndex({ printed: 3, roman: true }, 7), 2);
});

test('findTocPages: la primera página de índice y las que la siguen', () => {
  const p = textLines(propuestaPage());
  const nada = textLines(chars([['Texto normal de una página', 0.1, 0.2]]));
  assert.deepEqual(findTocPages([nada, nada, p, p, nada, p]), [2, 3]);
  assert.deepEqual(findTocPages([nada, nada]), []);
});

test('treeFromLevels / levelsFromTree: ida y vuelta, y saltos de nivel', () => {
  const rows = [{ title: 'A', level: 1 }, { title: 'A.1', level: 2 }, { title: 'A.1.1', level: 3 }, { title: 'B', level: 1 }, { title: 'B.x', level: 3 }];
  const tree = treeFromLevels(rows);
  assert.deepEqual(JSON.parse(JSON.stringify(tree)), [
    { title: 'A', children: [{ title: 'A.1', children: [{ title: 'A.1.1', children: [] }] }] },
    { title: 'B', children: [{ title: 'B.x', children: [] }] },
  ]);
  assert.deepEqual(levelsFromTree(tree).map((r) => [r.title, r.level]), [['A', 1], ['A.1', 2], ['A.1.1', 3], ['B', 1], ['B.x', 2]]);
});

// --- Índice creado en el estado ---------------------------------------------------------------
const pages = ['p1', 'p2', 'p3'].map((key, index) => ({ key, docId: 1, index, rot: 0, annots: [] }));
const custom = [{ title: 'Uno', key: 'p1', children: [{ title: 'Uno.a', key: 'p2', children: [] }] }, { title: 'Dos', key: 'p3', children: [] }];

test('mapCustomOutline / outlineForSave: siguen a su página al reordenar o eliminar', () => {
  const moved = [pages[2], pages[0], pages[1]];
  assert.deepEqual(mapCustomOutline(moved, custom).map((n) => [n.title, n.pos]), [['Uno', 1], ['Dos', 0]]);
  const deleted = [pages[0], pages[1]];
  const m = mapCustomOutline(deleted, custom);
  assert.equal(m[1].missing, true);
  assert.deepEqual(outlineForSave(deleted, custom), [{ title: 'Uno', pos: 0, children: [{ title: 'Uno.a', pos: 1, children: [] }] }]);
  assert.equal(outlineForSave(pages, null), undefined);
});

test('setOutline: se deshace y se rehace con las páginas', () => {
  let s = reducer(initialState, { type: 'open', sources: [{ docId: 1, name: 'a.pdf' }], pages, file: { path: '/a.pdf', name: 'a.pdf' } });
  assert.equal(s.outline, null);
  s = reducer(s, { type: 'setOutline', outline: custom });
  assert.equal(s.outline, custom);
  assert.equal(s.dirty, true);
  s = reducer(s, { type: 'rotate', keys: new Set(['p1']), delta: 1 });
  s = reducer(s, { type: 'undo' });
  assert.equal(s.outline, custom);
  assert.equal(s.pages[0].rot, 0);
  s = reducer(s, { type: 'undo' });
  assert.equal(s.outline, null);
  s = reducer(s, { type: 'redo' });
  assert.equal(s.outline, custom);
  assert.equal(reducer(s, { type: 'setOutline', outline: custom }), s); // el mismo: no es un cambio
});

test('setOutline no se permite en un PDF certificado', () => {
  const certified = editPolicy([{ docId: 1, signed: 1, mdp: 2 }]);
  assert.equal(allows(certified, { type: 'setOutline', outline: custom }), false);
  assert.equal(allows(editPolicy([]), { type: 'setOutline', outline: custom }), true);
});
