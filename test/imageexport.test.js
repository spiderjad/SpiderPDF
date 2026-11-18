// Pruebas de Exportar como imagen (src/imageExport.js).  Ejecutar: npm test
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import jpegjs from 'jpeg-js';
import {
  defaultImagePattern, imagePatternError, imageNames, parseDpi, pixelSize, setPngDpi, setJpegDpi, readDpi,
  loadImagePrefs, saveImagePrefs, IMAGE_STORE, MAX_PIXELS,
} from '../src/imageExport.js';
import { pngRGB } from './forensics.js';
import { setLang } from '../src/i18n/index.js';

setLang('es');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

t('patrón por defecto en el idioma de la interfaz: «{documento}_p{n}»', () => {
  assert.equal(defaultImagePattern(), '{documento}_p{n}');
  setLang('en');
  assert.equal(defaultImagePattern(), '{document}_p{n}');
  setLang('es');
});

t('nombres: el número de página del documento, el nombre sin .pdf, la extensión del formato y sin repetir', () => {
  assert.deepEqual(imageNames('{documento}_p{n}', [1, 2, 10], { name: 'Factura 12.pdf' }), ['Factura 12_p1.png', 'Factura 12_p2.png', 'Factura 12_p10.png']);
  assert.deepEqual(imageNames('{document}-{n}.png', [3], { name: 'a', format: 'jpeg' }), ['a-3.jpg'], 'la extensión escrita se cambia por la del formato');
  assert.deepEqual(imageNames('{name} pág {N}', [1], { name: 'x' }), ['x pág 1.png'], 'variables sin distinguir mayúsculas y en otros idiomas');
  assert.deepEqual(imageNames('a:b/{n}', [1], { name: 'x' }), ['a-b-1.png'], 'sin caracteres prohibidos');
  assert.deepEqual(imageNames('igual', [1, 2], { name: 'x' }), ['igual.png', 'igual (2).png']);
});

t('patrón: vacío, con un dato que no existe o sin {n} → error', () => {
  assert.equal(imagePatternError('{documento}_p{n}'), null);
  assert.equal(imagePatternError('{n}.jpg'), null);
  assert.ok(imagePatternError('  .png '));
  assert.match(imagePatternError('{fecha}_{n}'), /\{fecha\}/);
  assert.match(imagePatternError('{documento}'), /\{n\}/);
});

t('resolución: entre 36 y 600 ppp, solo números', () => {
  assert.deepEqual(parseDpi('200'), { dpi: 200 });
  for (const bad of ['', 'abc', '20', '601', '1.5', '-72']) assert.ok(parseDpi(bad).error, bad);
});

t('píxeles: A4 a 72, 150 y 300 ppp; las páginas enormes se bajan para no pasar de 40 Mpx', () => {
  assert.deepEqual(pixelSize(595, 842, 72), { scale: 1, width: 595, height: 842, dpi: 72, capped: false });
  assert.deepEqual([pixelSize(595, 842, 150).width, pixelSize(595, 842, 150).height], [1240, 1754]);
  assert.deepEqual([pixelSize(595, 842, 300).width, pixelSize(595, 842, 300).height], [2479, 3508]);
  const big = pixelSize(2384, 3370, 600); // A0
  assert.equal(big.capped, true);
  assert.ok(big.width * big.height <= MAX_PIXELS * 1.001);
  assert.ok(big.dpi < 600);
});

t('PNG con su resolución (pHYs válido tras IHDR, sustituye al que hubiera)', () => {
  const png = pngRGB(4, 3, () => [255, 0, 0]);
  const out = setPngDpi(png, 300);
  assert.equal(readDpi(out), 300);
  // Cada chunk con su CRC correcto y pHYs justo después de IHDR.
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const types = [];
  for (let o = 8; o < out.length;) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...out.subarray(o + 4, o + 8));
    assert.equal(view.getUint32(o + 8 + len), crc32(out.subarray(o + 4, o + 8 + len)), `CRC de ${type}`);
    types.push(type);
    o += 12 + len;
  }
  assert.deepEqual(types.slice(0, 2), ['IHDR', 'pHYs']);
  const again = setPngDpi(out, 150);
  assert.equal(readDpi(again), 150);
  assert.equal(again.length, out.length, 'no se acumulan pHYs');
  assert.equal(readDpi(png), null);
});

t('JPG con su resolución en la cabecera JFIF; la imagen sigue siendo la misma', () => {
  const w = 8; const h = 8;
  const data = Buffer.alloc(w * h * 4, 200);
  const jpg = new Uint8Array(jpegjs.encode({ data, width: w, height: h }, 90).data);
  const out = setJpegDpi(jpg, 150);
  assert.equal(readDpi(out), 150);
  const back = jpegjs.decode(out);
  assert.equal(back.width, 8);
  assert.equal(jpg.length, out.length);
});

t('se recuerda lo último; lo que no vale vuelve al valor por defecto', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveImagePrefs(storage, { format: 'jpeg', quality: 0.8, dpi: 'custom', custom: '200', pattern: '{n}' });
  assert.deepEqual(loadImagePrefs(storage), { format: 'jpeg', quality: 0.8, dpi: 'custom', custom: '200', pattern: '{n}' });
  store.set(IMAGE_STORE, JSON.stringify({ format: 'gif', quality: 3, dpi: 99, custom: 'x' }));
  assert.deepEqual(loadImagePrefs(storage), { format: 'png', quality: 0.9, dpi: 150, custom: '200', pattern: '' });
  assert.deepEqual(loadImagePrefs({ getItem: () => { throw new Error('no'); } }).format, 'png');
});

console.log(`\n${passed} pruebas superadas.`);
