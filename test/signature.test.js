// Pruebas de src/signature.js.  Ejecutar: npm test
import assert from 'node:assert/strict';
import {
  removeBackground, alphaBounds, padBounds, strokeWidth, catmullRomSegments, loadRecent, rememberSignature, forgetSignature,
} from '../src/signature.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

/** Imagen de prueba: fondo blanco opaco con un rectángulo oscuro en (x, y, w, h). */
function scan(width, height, ink = { x: 3, y: 2, w: 4, h: 2 }, bg = 250) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = x >= ink.x && x < ink.x + ink.w && y >= ink.y && y < ink.y + ink.h;
      const v = inside ? 20 : bg;
      data.set([v, v, v, 255], i);
    }
  }
  return { width, height, data };
}
const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

t('quitar el fondo deja transparente el papel y opaca la tinta', () => {
  const out = removeBackground(scan(10, 6));
  assert.equal(alphaAt(out, 0, 0), 0);
  assert.equal(alphaAt(out, 4, 2), 255);
});

t('los grises intermedios quedan semitransparentes (bordes suaves)', () => {
  const out = removeBackground(scan(4, 4, { x: 0, y: 0, w: 0, h: 0 }, 195), 215, 40);
  const a = alphaAt(out, 1, 1);
  assert.ok(a > 0 && a < 255, `alfa ${a}`);
});

t('quitar el fondo no modifica la imagen original', () => {
  const img = scan(10, 6);
  removeBackground(img);
  assert.equal(alphaAt(img, 0, 0), 255);
});

t('la caja de contenido encuentra la tinta', () => {
  assert.deepEqual(alphaBounds(removeBackground(scan(10, 6))), { x: 3, y: 2, w: 4, h: 2 });
});

t('una imagen vacía no tiene caja', () => {
  assert.equal(alphaBounds(removeBackground(scan(5, 5, { x: 0, y: 0, w: 0, h: 0 }))), null);
});

t('el margen no se sale de la imagen', () => {
  assert.deepEqual(padBounds({ x: 1, y: 1, w: 3, h: 3 }, 5, 10, 6), { x: 0, y: 0, w: 9, h: 6 });
});

t('el trazo es más fino cuanto más rápido y nunca desaparece', () => {
  assert.ok(strokeWidth(0, 3) > strokeWidth(1, 3));
  assert.ok(strokeWidth(100, 3) > 0);
});

t('últimas firmas: sin repetir, la más reciente primero y como mucho 5', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  for (let i = 0; i < 7; i++) rememberSignature(storage, { src: `data:image/png;base64,${i}`, width: 10, height: 5 });
  rememberSignature(storage, { src: 'data:image/png;base64,3', width: 10, height: 5 });
  const list = loadRecent(storage);
  assert.equal(list.length, 5);
  assert.equal(list[0].src, 'data:image/png;base64,3');
  assert.equal(new Set(list.map((s) => s.src)).size, 5);
  assert.equal(forgetSignature(storage, 'data:image/png;base64,3').length, 4);
});

t('almacenamiento roto, lleno o ausente no rompe nada', () => {
  assert.deepEqual(loadRecent({ getItem: () => '{no es json' }), []);
  assert.deepEqual(loadRecent(undefined), []);
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
  assert.equal(rememberSignature(full, { src: 'data:image/png;base64,x' }).length, 1);
  assert.deepEqual(loadRecent({ getItem: () => JSON.stringify([{ src: 'javascript:alert(1)' }]) }), []);
});

t('Catmull-Rom: un tramo por par de puntos, que pasa por todos', () => {
  const pts = [{ x: 0, y: 0, w: 2 }, { x: 10, y: 5, w: 3 }, { x: 20, y: 0, w: 2 }, { x: 30, y: 8, w: 4 }];
  const segs = catmullRomSegments(pts);
  assert.equal(segs.length, 3);
  segs.forEach((s, i) => { assert.deepEqual(s.from, [pts[i].x, pts[i].y]); assert.deepEqual(s.to, [pts[i + 1].x, pts[i + 1].y]); });
  assert.equal(segs[0].w, 2.5);
});

t('Catmull-Rom: tres puntos en línea dan una recta (los controles quedan en la línea)', () => {
  const [s] = catmullRomSegments([{ x: 0, y: 0, w: 1 }, { x: 10, y: 10, w: 1 }, { x: 20, y: 20, w: 1 }]);
  assert.equal(s.c1[0], s.c1[1]);
  assert.equal(s.c2[0], s.c2[1]);
});

t('el grosor varía poco: entre el 70 % y el 120 % del base', () => {
  assert.ok(strokeWidth(0, 2.5) <= 3 && strokeWidth(100, 2.5) >= 1.75);
});

console.log(`\n${passed} pruebas de firma superadas.`);
