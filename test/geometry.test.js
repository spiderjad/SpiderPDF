// Pruebas de src/geometry.js.  Ejecutar: npm test
import assert from 'node:assert/strict';
import {
  toDisplay, fromDisplay, rectToDisplay, rectFromDisplay, moveAnnot, annotBounds, imageMatrix,
} from '../src/geometry.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };
const near = (a, b, msg) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9, `${msg}: ${a} ≠ ${b}`));

const samples = [[0, 0], [1, 1], [0.2, 0.7], [0.9, 0.1], [0.5, 0.5]];

t('ida y vuelta toDisplay/fromDisplay para R = 0..3 (y negativos o >3)', () => {
  for (const R of [0, 1, 2, 3, 4, -1, 7]) {
    for (const [u, v] of samples) near(fromDisplay(...toDisplay(u, v, R), R), [u, v], `R=${R}`);
  }
});

t('girar 90° horario lleva la esquina superior izquierda a la superior derecha', () => {
  near(toDisplay(0, 0, 1), [1, 0], 'R=1');
  near(toDisplay(0, 0, 2), [1, 1], 'R=2');
  near(toDisplay(0, 0, 3), [0, 1], 'R=3');
});

t('cuatro cuartos de vuelta seguidos vuelven al punto de partida', () => {
  for (const [u, v] of samples) {
    let p = [u, v];
    for (let i = 0; i < 4; i++) p = toDisplay(...p, 1);
    near(p, [u, v], 'R=1 x4');
  }
});

t('ida y vuelta de rectángulos para R = 0..3', () => {
  const rect = [0.1, 0.2, 0.6, 0.35];
  for (const R of [0, 1, 2, 3]) near(rectFromDisplay(rectToDisplay(rect, R), R), rect, `R=${R}`);
});

t('en R impares el rectángulo cambia ancho por alto', () => {
  const d = rectToDisplay([0.1, 0.2, 0.6, 0.35], 1);
  assert.ok(Math.abs(d.w - 0.15) < 1e-9 && Math.abs(d.h - 0.5) < 1e-9);
});

t('mover una anotación en pantalla la mueve igual en la página girada', () => {
  const a = { type: 'highlight', rect: [0.2, 0.2, 0.4, 0.3] };
  for (const R of [0, 1, 2, 3]) {
    const before = rectToDisplay(a.rect, R);
    const after = rectToDisplay(moveAnnot(a, 0.1, 0.05, R).rect, R);
    near([after.x - before.x, after.y - before.y], [0.1, 0.05], `R=${R}`);
  }
});

t('mover no saca la anotación de la página', () => {
  const m = moveAnnot({ type: 'highlight', rect: [0.8, 0.8, 0.95, 0.9] }, 0.5, 0.5, 0);
  near(m.rect, [0.85, 0.9, 1, 1], 'clamp');
});

t('mover tinta y notas', () => {
  const ink = moveAnnot({ type: 'ink', strokes: [[0.1, 0.1, 0.2, 0.3]] }, 0.1, 0, 1);
  near(ink.strokes[0], [0.1, 0, 0.2, 0.2], 'tinta R=1');
  const note = moveAnnot({ type: 'note', at: [0.5, 0.5] }, 0.1, 0.2, 0);
  near(note.at, [0.6, 0.7], 'nota');
});

t('caja de cada tipo de anotación', () => {
  near(annotBounds({ type: 'ink', strokes: [[0.3, 0.4, 0.1, 0.9], [0.5, 0.2]] }), [0.1, 0.2, 0.5, 0.9], 'tinta');
  near(annotBounds({ type: 'note', at: [0.3, 0.4] }), [0.3, 0.4, 0.3, 0.4], 'nota');
});

t('imageMatrix llena exactamente la caja en los cuatro giros', () => {
  // Las esquinas del cuadrado unidad de la imagen deben caer en las de la caja.
  const [x0, y0, w, h] = [100, 200, 80, 40];
  const apply = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f];
  for (const k of [0, 1, 2, 3]) {
    const m = imageMatrix(k, x0, y0, w, h);
    const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => apply(m, x, y));
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    near([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], [x0, y0, x0 + w, y0 + h], `k=${k}`);
  }
});

console.log(`\n${passed} pruebas de geometría superadas.`);
