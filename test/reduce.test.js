// «Reducir tamaño»: niveles, textos de tamaño y reescalado por media de áreas.  npm test
import assert from 'node:assert/strict';
import { REDUCE_LEVELS, formatSize, sizeChange, worthSaving } from '../src/reduce.js';
import { downscaleRGBA, targetSize } from '../src/engine/resample.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

t('niveles: 300, 150 y 96 ppp, de más a menos calidad', () => {
  assert.deepEqual(Object.values(REDUCE_LEVELS).map((l) => [l.label, l.dpi]), [['Alta calidad', 300], ['Equilibrado', 150], ['Mínimo tamaño', 96]]);
  const q = Object.values(REDUCE_LEVELS).map((l) => l.quality);
  assert.ok(q[0] > q[1] && q[1] > q[2]);
});

t('tamaños en español: «12,4 MB → 3,1 MB (−75 %)»', () => {
  const MB = 1024 * 1024;
  assert.equal(sizeChange(12.4 * MB, 3.1 * MB), '12,4 MB → 3,1 MB (−75 %)');
  assert.equal(formatSize(850 * 1024), '850 KB');
  assert.equal(formatSize(1000 * 1024), '1 MB');
  assert.equal(formatSize(25 * MB), '25 MB');
  assert.equal(formatSize(900), '900 bytes');
  assert.equal(sizeChange(1000, 1200), '1000 bytes → 1 KB'); // si crece, sin porcentaje
  assert.equal(worthSaving(1000, 995), false);
  assert.equal(worthSaving(1000, 900), true);
});

t('targetSize: solo si pasa de la resolución (con un 15 % de margen)', () => {
  assert.equal(targetSize(2000, 1500, 160, 150), null);
  assert.deepEqual(targetSize(2000, 1500, 500, 150), { width: 600, height: 450 });
  assert.equal(targetSize(10, 10, NaN, 150), null);
});

t('downscaleRGBA: media exacta de áreas (también con factores no enteros)', () => {
  // 4×2 → 2×1: cada píxel nuevo es la media de un bloque de 2×2.
  const src = new Uint8Array([0, 0, 0, 255, 100, 100, 100, 255, 200, 0, 0, 255, 200, 0, 0, 255,
    100, 100, 100, 255, 200, 200, 200, 255, 0, 0, 200, 255, 0, 0, 200, 255]);
  assert.deepEqual([...downscaleRGBA(src, 4, 2, 2, 1)], [100, 100, 100, 255, 100, 0, 100, 255]);
  // Un color uniforme sigue igual con cualquier factor.
  const flat = new Uint8Array(7 * 5 * 4).map((_, i) => [10, 20, 30, 255][i % 4]);
  const out = downscaleRGBA(flat, 7, 5, 3, 2);
  for (let i = 0; i < out.length; i += 4) assert.deepEqual([...out.subarray(i, i + 4)], [10, 20, 30, 255]);
  // Sin reducir: se devuelve lo mismo.
  assert.equal(downscaleRGBA(flat, 7, 5, 7, 5), flat);
});

console.log(`\n${passed} pruebas superadas.`);
