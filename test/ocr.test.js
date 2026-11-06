// OCR, partes puras (src/ocr/image.js, deskew.js, layer.js).  Ejecutar: node test/ocr.test.js
import assert from 'node:assert/strict';
import { toGray, downscale, rotate, rotate90, crop, toPgm } from '../src/ocr/image.js';
import { analyze, MIN_SKEW } from '../src/ocr/deskew.js';
import { wordsFromResult, meanConfidence, ocrChars, dropCovered, SIZE_FROM_ROW } from '../src/ocr/layer.js';
import { findMatches } from '../src/textGeom.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg ?? ''} ${a} ≠ ${b}`);

/** Página sintética: 30 líneas de «palabras» (rectángulos oscuros) separadas por huecos. */
function textPage(W = 1200, H = 1700) {
  const data = new Uint8Array(W * H).fill(248);
  for (let l = 0; l < 26; l++) {
    const y0 = 120 + l * 56;
    for (let x = 100; x < W - 180;) {
      const len = 35 + ((l * 37 + x) % 110);
      for (let y = y0; y < y0 + 20; y++) for (let xx = x; xx < Math.min(W - 100, x + len); xx++) if ((xx + y) % 3) data[y * W + xx] = 25;
      x += len + 22;
    }
  }
  return { w: W, h: H, data };
}

t('gris desde RGBA, reducción por bloques y PGM con su cabecera', () => {
  const g = toGray(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]), 2, 2);
  assert.deepEqual([...g.data], [255, 0, 76, 28]);
  const d = downscale({ w: 4, h: 2, data: Uint8Array.from([0, 100, 200, 200, 100, 0, 200, 200]) }, 2);
  assert.deepEqual([d.w, d.h, d.k, ...d.data], [2, 1, 2, 50, 200]);
  const pgm = toPgm({ w: 3, h: 1, data: Uint8Array.from([1, 2, 3]) });
  assert.equal(new TextDecoder().decode(pgm.subarray(0, 11)), 'P5\n3 1\n255\n');
  assert.deepEqual([...pgm.subarray(11)], [1, 2, 3]);
});

t('giros: cuartos de vuelta exactos y cualquier ángulo sin recortar; back() lleva cada punto a la imagen original', () => {
  const img = { w: 3, h: 2, data: Uint8Array.from([1, 2, 3, 4, 5, 6]) };
  const r1 = rotate90(img, 1);
  assert.deepEqual([r1.w, r1.h, ...r1.data], [2, 3, 4, 1, 5, 2, 6, 3]);
  assert.deepEqual(rotate90(img, 2).data, Uint8Array.from([6, 5, 4, 3, 2, 1]));
  assert.deepEqual(rotate(img, -90).data, rotate90(img, 3).data);
  for (const q of [1, 2, 3]) {
    const r = rotate90({ w: 40, h: 30, data: new Uint8Array(1200) }, q);
    const [x, y] = r.back(r.w * 0.25, r.h * 0.75);
    // Ida y vuelta: girar el punto de vuelta con rotate90 de la imagen original da el mismo sitio.
    assert.ok(x >= 0 && x <= 40 && y >= 0 && y <= 30);
  }
  const page = textPage(400, 300);
  const r = rotate(page, 30);
  assert.ok(r.w > 400 && r.h > 300, 'el lienzo crece para que quepa entera');
  const [cx, cy] = r.back(r.w / 2, r.h / 2);
  near(cx, 200, 1e-6); near(cy, 150, 1e-6);
  // Un punto girado 30° alrededor del centro vuelve a su sitio.
  const rad = (30 * Math.PI) / 180;
  const [px, py] = [300 - 200, 50 - 150];
  const fx = r.w / 2 + px * Math.cos(rad) - py * Math.sin(rad);
  const fy = r.h / 2 + px * Math.sin(rad) + py * Math.cos(rad);
  const [bx, by] = r.back(fx, fy);
  near(bx, 300, 1e-6, 'x'); near(by, 50, 1e-6, 'y');
  assert.deepEqual([...crop({ w: 3, h: 2, data: Uint8Array.from([1, 2, 3, 4, 5, 6]) }, 1, 0, 3, 2).data], [2, 3, 5, 6]);
});

t('enderezar: recta = sin tocar; torcida ±n° = el giro contrario; de lado = líneas en vertical', () => {
  const page = textPage();
  assert.deepEqual(analyze(page), { quarter: 0, skew: 0 });
  for (const deg of [3, -2.5, 6]) {
    const a = analyze(rotate(page, deg));
    assert.equal(a.quarter, 0);
    near(a.skew, -deg, 0.2, `torcida ${deg}°:`);
  }
  for (const deg of [90, -90, 93]) {
    const a = analyze(rotate(page, deg));
    assert.equal(a.quarter, 1, `de lado ${deg}°`);
    near(a.skew, -(deg - Math.round(deg / 90) * 90), 0.2, `de lado ${deg}°:`);
  }
  assert.equal(analyze(rotate(page, MIN_SKEW / 2)).skew, 0, 'casi recta: no se toca');
  assert.equal(analyze({ w: 100, h: 100, data: new Uint8Array(10000).fill(255) }).empty, true);
});

// Resultado de Tesseract de ejemplo: una línea de dos palabras y una palabra de ruido.
const tess = {
  blocks: [{ paragraphs: [{ lines: [
    { baseline: { x0: 100, y0: 200, x1: 500, y1: 200 }, rowAttributes: { rowHeight: 50 }, words: [
      { text: 'Hola', confidence: 95, bbox: { x0: 100, y0: 160, x1: 260, y1: 210 } },
      { text: 'Ñandú', confidence: 90, bbox: { x0: 300, y0: 160, x1: 500, y1: 210 } },
    ] },
    { baseline: { x0: 100, y0: 300, x1: 300, y1: 300 }, rowAttributes: { rowHeight: 50 }, words: [
      { text: '~', confidence: 5, bbox: { x0: 100, y0: 260, x1: 120, y1: 310 } },
      { text: 'adiós', confidence: 80, bbox: { x0: 140, y0: 260, x1: 300, y1: 310 } },
    ] },
  ] }] }],
};

t('palabras: línea base en fracciones de la página, tamaño en puntos, espacios, y fuera el ruido', () => {
  const words = wordsFromResult(tess, { back: (x, y) => [x, y], W: 1000, H: 2000, dpi: 200 });
  assert.deepEqual(words.map((w) => [w.t, w.line, w.space]), [['Hola', 0, true], ['Ñandú', 0, false], ['adiós', 1, false]]);
  assert.deepEqual(words[0].a, [0.1, 0.1]);
  assert.deepEqual(words[0].b, [0.26, 0.1]);
  near(words[0].size, (50 * 72 / 200) * SIZE_FROM_ROW, 0.01);
  near(meanConfidence(tess), (95 * 4 + 90 * 5 + 5 + 80 * 5) / 15, 1e-9);
});

t('palabras de una página girada (rot0 = 1): se guardan en la página sin girar', () => {
  const [w] = wordsFromResult(tess, { back: (x, y) => [x, y], W: 1000, H: 2000, dpi: 200, R: 1 });
  // En pantalla (0,1; 0,1) con la página girada 90° → sin girar (v, 1 - u) = (0,1; 0,9).
  assert.deepEqual(w.a, [0.1, 0.9]);
});

t('caracteres para buscar y seleccionar: palabras con espacio, líneas con «\\r\\n» generados, cajas en su sitio', () => {
  const words = wordsFromResult(tess, { back: (x, y) => [x, y], W: 1000, H: 2000, dpi: 200 });
  const c = ocrChars(words, 500, 1000);
  assert.equal(c.text, 'Hola Ñandú\r\nadiós');
  assert.deepEqual([...c.generated.slice(10, 12)], [1, 1]);
  assert.equal(c.hasText, true);
  const [m] = findMatches(c.text, 'nandu');
  const box = c.boxes.slice(m.start * 4, m.start * 4 + 4);
  near(box[0], 0.3, 1e-6, 'u0'); // «Ñ» empieza donde la palabra
  assert.ok(box[1] < 0.1 && box[3] > 0.1, 'la caja rodea la línea base');
  // Escaneo torcido: la línea base sube; las cajas siguen la inclinación.
  const tilted = ocrChars([{ t: 'ab', a: [0.1, 0.5], b: [0.3, 0.4], size: 12, line: 0 }], 500, 1000);
  assert.ok(tilted.boxes[1] > tilted.boxes[5], 'la «b» está más arriba que la «a»');
});

t('reconocer «todo el documento»: no se duplica el texto que la página ya tenía', () => {
  const words = wordsFromResult(tess, { back: (x, y) => [x, y], W: 1000, H: 2000, dpi: 200 });
  // Texto original justo encima de «Ñandú» (u 0,3-0,5; v 0,08-0,1).
  const kept = dropCovered(words, Float32Array.from([0.3, 0.07, 0.5, 0.11]), 500, 1000);
  assert.deepEqual(kept.map((w) => w.t), ['Hola', 'adiós']);
  assert.equal(dropCovered(words, new Float32Array(0), 500, 1000).length, 3);
});

console.log(`\n${passed} pruebas de OCR superadas.`);
