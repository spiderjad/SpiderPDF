// Pruebas de «Dividir PDF» (src/split.js): grupos de cada modo, nombres y tamaño máximo con PDFium de verdad.
// Ejecutar: npm test
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import {
  everyGroups, parseEvery, parseRanges, leftOut, bookmarkGroups, firstPos, parseMb, groupsBySize,
  safeFileName, patternError, fileNames, pagesLabel,
} from '../src/split.js';
import { setLang } from '../src/i18n/index.js';
import { PdfCore } from '../src/engine/pdfium-core.js';

setLang('es');
let passed = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const spans = (groups) => groups.map((g) => [g.from, g.to]);

t('cada N páginas y página por página', () => {
  assert.deepEqual(spans(everyGroups(7, 3)), [[0, 3], [3, 6], [6, 7]]);
  assert.deepEqual(spans(everyGroups(3, 1)), [[0, 1], [1, 2], [2, 3]]);
  assert.deepEqual(parseEvery('2', 7), { n: 2 });
  assert.ok(parseEvery('0', 7).error);
  assert.ok(parseEvery('2,5', 7).error);
  assert.ok(parseEvery('', 7).error);
  assert.match(parseEvery('7', 7).error, /un solo archivo/);
});

t('intervalos: «1-3, 4-8, 9-», sueltas, «-2» y errores claros', () => {
  assert.deepEqual(spans(parseRanges('1-3, 4-8, 9-', 12).groups), [[0, 3], [3, 8], [8, 12]]);
  assert.deepEqual(spans(parseRanges('5; -2 ; 3–4', 6).groups), [[4, 5], [0, 2], [2, 4]]);
  assert.deepEqual(spans(parseRanges('1-3, 2-4', 5).groups), [[0, 3], [1, 4]], 'se pueden repetir páginas');
  assert.match(parseRanges('', 5).error, /Escribe los intervalos/);
  assert.match(parseRanges('1-3, x', 5).error, /«x» no es una página/);
  assert.match(parseRanges('1-9', 5).error, /tiene 5 páginas/);
  assert.match(parseRanges('4-2', 5).error, /al revés/);
  assert.deepEqual(leftOut(parseRanges('1-2, 5', 7).groups, 7), [2, 3, 5, 6]);
});

t('marcadores de primer nivel: desde su página hasta el siguiente; lo de antes va con el primero', () => {
  const marks = [{ title: 'Anexo', pos: 9 }, { title: 'Intro', pos: 2 }, { title: 'Otro en la 3', pos: 2 }, { title: 'Sin página', pos: -1 }, { title: 'Cuerpo', pos: 4 }];
  const g = bookmarkGroups(12, marks);
  assert.deepEqual(g.map((x) => [x.from, x.to, x.title]), [[0, 4, 'Intro'], [4, 9, 'Cuerpo'], [9, 12, 'Anexo']]);
  assert.deepEqual(bookmarkGroups(5, [{ title: 'x', pos: -1 }]), []);
  assert.equal(firstPos({ pos: -1, children: [{ pos: -1, children: [] }, { pos: 6, children: [] }] }), 6);
  assert.equal(firstPos({ pos: 3, children: [] }), 3);
});

t('tamaño en MB: coma o punto, mínimo y máximo', () => {
  assert.deepEqual(parseMb('2,5'), { bytes: Math.floor(2.5 * 1024 * 1024) });
  assert.deepEqual(parseMb(' 10 '), { bytes: 10 * 1024 * 1024 });
  assert.ok(parseMb('0').error);
  assert.ok(parseMb('0,05').error);
  assert.ok(parseMb('-1').error);
  assert.ok(parseMb('5 MB').error);
  assert.match(parseMb('').error, /como mínimo 0,1/);
});

t('nombres: patrón, sin caracteres prohibidos, sin repetir y siempre .pdf', () => {
  const groups = [{ from: 0, to: 3, title: 'Capítulo 1: Introducción' }, { from: 3, to: 4, title: 'Anexo' }, { from: 4, to: 6, title: 'anexo' }];
  assert.deepEqual(fileNames('factura_{n}.pdf', groups, { name: 'Facturas 2026' }), ['factura_1.pdf', 'factura_2.pdf', 'factura_3.pdf']);
  assert.deepEqual(fileNames('{name} {pages}', groups, { name: 'Libro' }), ['Libro 1-3.pdf', 'Libro 4.pdf', 'Libro 5-6.pdf']);
  assert.deepEqual(fileNames('{title}', groups), ['Capítulo 1- Introducción.pdf', 'Anexo.pdf', 'anexo (2).pdf']);
  assert.deepEqual(fileNames('{N}-{NAME}.PDF', groups.slice(0, 1), { name: 'a/b' }), ['1-a-b.pdf'], 'sin distinguir mayúsculas en los datos');
  assert.deepEqual(fileNames('{title}', [{ from: 0, to: 1, title: '' }, { from: 1, to: 2, title: '' }]), ['1.pdf', '2.pdf'], 'sin título, el número');
  assert.equal(safeFileName('  ../con  '), 'con_');
  assert.equal(safeFileName('a<b>c?.'), 'a-b-c-');
  assert.equal(safeFileName('x'.repeat(300)).length, 150);
  assert.equal(pagesLabel({ from: 4, to: 5 }), '5');
  assert.equal(pagesLabel({ from: 0, to: 3 }), '1-3');
});

t('patrón: vacío, datos desconocidos y que dé nombres distintos', () => {
  assert.equal(patternError('{name}_{n}.pdf'), null);
  assert.equal(patternError('trozo {pages}'), null);
  assert.match(patternError('  .pdf'), /Escribe un nombre/);
  assert.match(patternError('{name}_{num}'), /«\{num\}» no es un dato/);
  assert.match(patternError('{name}.pdf'), /Incluye \{n\} o \{pages\}/);
  assert.match(patternError('{title}.pdf'), /Incluye \{n\} o \{pages\}/, '{title} solo vale con marcadores');
  assert.equal(patternError('{title}.pdf', 'bookmarks'), null);
});

t('tamaño máximo (simulado): ningún grupo pasa del máximo, pocas composiciones y una página enorme va sola', async () => {
  const sizes = [10, 10, 10, 10, 80, 10, 10, 10, 10, 10, 10, 10, 200, 10, 10];
  let calls = 0;
  const sizeOf = async (from, to) => {
    calls++;
    let n = 5; // lo que pesa todo PDF (cabecera, catálogo…)
    for (let i = from; i < to; i++) n += sizes[i];
    return new Uint8Array(n);
  };
  const g = await groupsBySize(sizes.length, 50, sizeOf);
  assert.deepEqual(spans(g), [[0, 4], [4, 5], [5, 9], [9, 12], [12, 13], [13, 15]]);
  assert.ok(g.every((x) => x.over || x.size <= 50));
  assert.deepEqual(g.filter((x) => x.over).map((x) => x.from), [4, 12]);
  assert.ok(g.every((x) => x.bytes.length === x.size));
  assert.ok(calls < 45, `demasiadas composiciones: ${calls}`);
  // Todo cabe: un solo archivo con una sola composición.
  calls = 0;
  assert.deepEqual(spans(await groupsBySize(3, 1000, sizeOf)), [[0, 3]]);
  assert.equal(calls, 1);
  // Cancelar.
  await assert.rejects(groupsBySize(sizes.length, 50, sizeOf, { isCancelled: () => true }), (e) => e.cancelled);
});

t('tamaño máximo con PDFium: cada archivo compuesto no pasa del máximo y se reparten todas las páginas', async () => {
  const require = createRequire(import.meta.url);
  const { init } = await import('@embedpdf/pdfium');
  const pdfium = await init({ wasmBinary: await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  pdfium.PDFiumExt_Init();
  const core = new PdfCore(pdfium);
  // 12 páginas con una imagen de ruido cada una (no se comprime): unos 30 KB por página, algunas el doble.
  const doc = await PDFDocument.create();
  for (let i = 0; i < 12; i++) {
    const side = i % 5 === 0 ? 140 : 100;
    const img = await doc.embedPng(noisePng(side, side, i));
    const p = doc.addPage([595, 842]);
    p.drawImage(img, { x: 50, y: 300, width: 300, height: 300 });
    p.drawText(`Página ${i + 1}`, { x: 50, y: 760, size: 18 });
  }
  const { docId } = core.open(await doc.save());
  const refs = Array.from({ length: 12 }, (_, index) => ({ docId, index, rot: 0 }));
  const sizeOf = async (from, to) => core.compose(refs.slice(from, to));
  const max = 100 * 1024;
  const g = await groupsBySize(12, max, sizeOf);
  assert.ok(g.length > 1 && g.length < 12, `grupos: ${g.length}`);
  assert.deepEqual(g.map((x) => x.from), [0, ...g.slice(0, -1).map((x) => x.to)], 'seguidos, sin huecos');
  assert.equal(g.at(-1).to, 12);
  for (const x of g) {
    assert.ok(x.size <= max, `${x.from}-${x.to}: ${x.size}`);
    const back = core.open(x.bytes); // el PDF de cada trozo se abre y tiene sus páginas
    assert.equal(back.pages.length, x.to - x.from);
    core.close(back.docId);
  }
  // El siguiente grupo ya no cabría con una página más (no se desperdicia sitio).
  for (const x of g.slice(0, -1)) assert.ok((await sizeOf(x.from, x.to + 1)).length > max);
  core.close(docId);
});

/** PNG RGB de ruido (incomprimible), sin dependencias. */
function noisePng(w, h, seed) {
  let x = seed * 7919 + 1; // xorshift32: cada imagen distinta y sin patrones que se compriman
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) for (let i = 0; i < w * 3; i++) raw[y * (1 + w * 3) + 1 + i] = rnd() >>> 24;
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const [name, fn] of tests) {
  await fn();
  passed++;
  console.log('  ok -', name);
}
console.log(`\ndividir: ${passed} pruebas correctas`);
