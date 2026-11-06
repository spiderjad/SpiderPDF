// Pruebas de src/textGeom.js (buscar y seleccionar texto).  Ejecutar: npm test
import assert from 'node:assert/strict';
import {
  normalizeForSearch, findMatches, lineRects, caretAt, charIndexAt, wordAt, selectedText, hasRealText,
} from '../src/textGeom.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

/** Dos líneas de texto con cajas de 0,01 de ancho; entre líneas, «\r\n» generado por PDFium. */
function sample() {
  const lines = ['Razón social', 'Más datos'];
  let text = '';
  const boxes = [];
  const generated = [];
  lines.forEach((line, li) => {
    if (li) { for (const c of '\r\n') { text += c; boxes.push(0, 0, 0, 0); generated.push(1); } }
    [...line].forEach((c, k) => {
      text += c;
      boxes.push(0.1 + k * 0.01, 0.1 + li * 0.05, 0.1 + (k + 1) * 0.01, 0.12 + li * 0.05);
      generated.push(0);
    });
  });
  return { text, boxes: Float32Array.from(boxes), generated: Uint8Array.from(generated) };
}

t('normalizar quita tildes y mayúsculas y conserva el mapa al texto original', () => {
  const { norm, map } = normalizeForSearch('Razón  SOCIAL\r\nx');
  assert.equal(norm, 'razon social x');
  assert.equal(map[3], 3); // la «o» sale de la «ó»
  assert.equal(map[norm.length - 1], 'Razón  SOCIAL\r\nx'.length - 1);
});

t('buscar sin distinguir mayúsculas ni tildes: «razon» encuentra «Razón»', () => {
  assert.deepEqual(findMatches('La Razón y la razon', 'RAZON'), [{ start: 3, end: 8 }, { start: 14, end: 19 }]);
  assert.deepEqual(findMatches('nada', '   '), []);
});

t('buscar atraviesa los saltos de línea', () => {
  const { text } = sample();
  const [m] = findMatches(text, 'social mas');
  assert.equal(text.slice(m.start, m.end), 'social\r\nMás');
});

t('un rectángulo por línea', () => {
  const s = sample();
  const [m] = findMatches(s.text, 'social mas');
  const rects = lineRects(s.boxes, s.generated, m.start, m.end);
  assert.equal(rects.length, 2);
  assert.ok(Math.abs(rects[0][0] - 0.16) < 1e-6 && Math.abs(rects[1][2] - 0.13) < 1e-6);
});

t('cursor: dentro de una letra, antes o después según la mitad; fuera, la más cercana de la línea', () => {
  const s = sample();
  assert.equal(caretAt(s.boxes, s.generated, 0.1005, 0.11), 0);
  assert.equal(caretAt(s.boxes, s.generated, 0.1095, 0.11), 1);
  assert.equal(caretAt(s.boxes, s.generated, 0.5, 0.11), 12); // a la derecha de la línea 1: final de «social»
  assert.equal(caretAt(s.boxes, s.generated, 0.05, 0.16), 14); // a la izquierda de la línea 2: inicio de «Más»
  assert.equal(caretAt(new Float32Array(0), new Uint8Array(0), 0.5, 0.5), -1);
  // Un poco por debajo de la línea 2 y muy a la derecha: final de la línea 2, no una letra de la línea 1.
  assert.equal(caretAt(s.boxes, s.generated, 0.9, 0.18), s.text.length);
  // Entre las dos líneas, más cerca de la 1: en la línea 1.
  assert.equal(caretAt(s.boxes, s.generated, 0.9, 0.125), 12);
});

t('palabra con doble clic, también con tildes', () => {
  const s = sample();
  assert.deepEqual(wordAt(s.text, 2), [0, 5]);
  assert.equal(s.text.slice(...wordAt(s.text, 15)), 'Más');
  assert.deepEqual(wordAt(s.text, 5), [5, 6]); // espacio: solo él
});

t('texto copiado con saltos de línea normales', () => {
  const s = sample();
  assert.equal(selectedText(s.text, 6, 17), 'social\nMás');
});

t('página sin texto real (escaneada)', () => {
  assert.equal(hasRealText('\r\n  '), false);
  assert.equal(hasRealText('1'), true);
});

t('letra bajo el puntero (para el cursor de texto)', () => {
  const s = sample();
  assert.equal(charIndexAt(s.boxes, s.generated, 0.105, 0.11), 0);
  assert.equal(charIndexAt(s.boxes, s.generated, 0.5, 0.5), -1);
});

console.log(`\n${passed} pruebas de texto superadas.`);
