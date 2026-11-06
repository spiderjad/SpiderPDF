// Cuadros de texto nuevo (src/textbox.js).  Ejecutar: node test/textbox.test.js
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  FAMILIES, fontFile, familyKey, displayFontName, similarFamily, fontStyleOf, nearestRun, defaultStyle,
  usesPdfFont, wrapLines, missingChars,
} from '../src/textbox.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

t('las 12 fuentes incluidas existen (3 familias × normal, negrita, cursiva y negrita cursiva)', () => {
  for (const f of Object.keys(FAMILIES)) for (const b of [false, true]) for (const i of [false, true]) {
    assert.ok(existsSync(`node_modules/@expo-google-fonts/${fontFile(f, b, i)}`), fontFile(f, b, i));
  }
  assert.equal(familyKey('serif', true, true), 'serif-700-i');
});

t('nombre legible de una fuente del PDF', () => {
  assert.equal(displayFontName('ABCDEF+Helvetica-Bold'), 'Helvetica');
  assert.equal(displayFontName('TimesNewRomanPSMT'), 'Times New Roman');
  assert.equal(displayFontName('ArialMT,Italic'), 'Arial');
  assert.equal(displayFontName(''), 'Fuente del PDF');
});

t('familia incluida más parecida', () => {
  assert.equal(similarFamily('ABCDEF+TimesNewRomanPSMT'), 'serif');
  assert.equal(similarFamily('Georgia-Bold'), 'serif');
  assert.equal(similarFamily('CourierNew'), 'mono');
  assert.equal(similarFamily('Helvetica'), 'sans');
  assert.equal(similarFamily('PTSans-Regular'), 'sans');
});

t('negrita y cursiva por nombre, peso o ángulo', () => {
  assert.deepEqual(fontStyleOf('Helvetica-BoldOblique'), { bold: true, italic: true });
  assert.deepEqual(fontStyleOf('Inter', 700, 0), { bold: true, italic: false });
  assert.deepEqual(fontStyleOf('Foo', 400, -12), { bold: false, italic: true });
});

const runs = [
  { objIndex: 3, text: 'Título', rect: [0.1, 0.1, 0.6, 0.14], fontName: 'ABCDEF+Georgia-Bold', ptSize: 23.7, color: '#1f2a59', weight: 700 },
  { objIndex: 7, text: 'Cuerpo', rect: [0.1, 0.2, 0.9, 0.22], fontName: 'Helvetica', ptSize: 10.5, color: '#333333' },
  { objIndex: 9, text: 'oculto', rect: [0.5, 0.5, 0.6, 0.52], fontName: 'Helvetica', ptSize: 10, invisible: true },
];

t('bloque más cercano al clic (en puntos, sin los invisibles)', () => {
  assert.equal(nearestRun(runs, 0.3, 0.12, 595, 842).objIndex, 3); // dentro del título
  assert.equal(nearestRun(runs, 0.5, 0.25, 595, 842).objIndex, 7);
  assert.equal(nearestRun(runs, 0.55, 0.51, 595, 842).objIndex, 7); // el invisible no cuenta
  assert.equal(nearestRun([], 0.5, 0.5), null);
});

t('estilo por defecto: el del texto más cercano (fuente, tamaño redondeado a medio punto, color, negrita)', () => {
  const s = defaultStyle(runs[0]);
  assert.deepEqual(s.pdf, { objIndex: 3, name: 'Georgia', raw: 'ABCDEF+Georgia-Bold' });
  assert.equal(s.usePdf, true);
  assert.equal(s.family, 'serif');
  assert.equal(s.size, 23.5);
  assert.equal(s.color, '#1f2a59');
  assert.equal(s.bold, true);
  assert.equal(defaultStyle(null).family, 'sans');
  assert.equal(usesPdfFont({ style: s }), true);
  assert.equal(usesPdfFont({ style: s, fallback: true }), false);
  assert.equal(usesPdfFont({ style: { ...s, usePdf: false } }), false);
});

const mono = (s) => s.length; // cada letra mide 1

t('partir en líneas: palabras enteras, respeta los saltos y corta las palabras demasiado largas', () => {
  assert.deepEqual(wrapLines('uno dos tres cuatro', 8, mono), ['uno dos', 'tres', 'cuatro']);
  assert.deepEqual(wrapLines('a\n\nb', 8, mono), ['a', '', 'b']);
  assert.deepEqual(wrapLines('supercalifragilístico', 8, mono), ['supercal', 'ifragilí', 'stico']);
  assert.deepEqual(wrapLines('', 8, mono), ['']);
  assert.deepEqual(wrapLines('hola   mundo', 20, mono), ['hola   mundo']);
});

t('letras que faltan en una fuente (sin espacios, sin repetir)', () => {
  assert.deepEqual(missingChars('Hola ñandú €', 'Holamundo'), ['ñ', 'ú', '€']);
  assert.deepEqual(missingChars('Hola', 'Hola'), []);
});

console.log(`\n${passed} pruebas de cuadros de texto superadas.`);
