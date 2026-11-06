// PDF → Word (src/export/docLayout.js, src/export/docx.js), con PDFium y la librería docx de verdad.  npm test
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { init } from '@embedpdf/pdfium';
import * as docx from 'docx';
import JSZip from 'jszip';
import { PdfCore } from '../src/engine/pdfium-core.js';
import { detectTables } from '../src/tables.js';
import { analyzePage, layoutDocument, blockText, styledWords } from '../src/export/docLayout.js';
import { buildDocx, wordFont } from '../src/export/docx.js';
import { ocrChars } from '../src/ocr/layer.js';
import { informe, INFORME, factura, FACTURA, albaranLineas, ALBARAN_LINEAS } from './make-fixtures.js';
import { pngRGB } from './forensics.js';

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`FALLO - ${name}`); throw e; } };

const require = createRequire(import.meta.url);
const pdfium = await init({ wasmBinary: await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
pdfium.PDFiumExt_Init();
const core = new PdfCore(pdfium);

/** Como lo prepara la interfaz (scanDoc.js), con las imágenes codificadas en PNG. */
function analyze(bytes) {
  const d = core.open(bytes);
  const images = new Map();
  const pages = d.pages.map((p, i) => {
    const chars = core.textChars(d.docId, i);
    const imgs = core.pageImages(d.docId, i);
    for (const im of imgs) {
      images.set(im, { type: 'png', bytes: pngRGB(im.width, im.height, (x, y) => im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4), 4) });
    }
    const tables = detectTables(chars, core.rules(d.docId, i), p.width, p.height);
    return analyzePage({ chars, styles: core.charStyles(d.docId, i), W: p.width, H: p.height, tables, images: imgs });
  });
  core.close(d.docId);
  return { pages, images };
}

const summary = (bs) => bs.map((b) => (b.type === 'list' ? `${b.ordered ? 'ol' : 'ul'}:${b.items.length}` : b.type === 'heading' ? `h${b.level}` : b.type));

const inf = analyze(await informe());
const L = layoutDocument(inf.pages);

await test('informe: orden y tipo de los bloques (título, títulos de sección, párrafos, listas, tabla, imágenes)', () => {
  assert.deepEqual(summary(L.pages[0]), ['image', 'title', 'paragraph', 'h1', 'paragraph', 'paragraph', 'h2', 'ul:3', 'h1', 'table', 'image', 'paragraph']);
  assert.deepEqual(summary(L.pages[1]), ['h1', 'paragraph', 'ol:3', 'paragraph']);
  assert.equal(L.body.size, 10.5);
  assert.deepEqual(L.headings, { title: 22, levels: [15, 12.5, 10.5] });
});

await test('informe: textos, negrita dentro del párrafo y color del título de sección', () => {
  const [, title, sub, h1, p1] = L.pages[0];
  assert.equal(blockText(title), INFORME.titulo);
  assert.equal(blockText(sub), INFORME.subtitulo);
  assert.equal(blockText(h1), INFORME.h1[0]);
  assert.equal(h1.runs[0].style.color, 0x1a408c);
  const bold = p1.runs.filter((r) => r.style.bold).map((r) => r.text.trim());
  assert.deepEqual(bold, [INFORME.negrita]);
  assert.match(blockText(p1), /^El volumen de ventas .* provincia de Girona\.$/);
});

await test('informe: lista de viñetas sin la viñeta, con el elemento partido en dos líneas unido', () => {
  const ul = L.pages[0][7];
  assert.deepEqual(ul.items.map(blockText), INFORME.vinetas);
});

await test('informe: lista numerada sin los números y palabra partida con guion vuelta a unir', () => {
  const [, p, ol] = L.pages[1];
  assert.deepEqual(ol.items.map(blockText), INFORME.numerada);
  assert.ok(blockText(p).includes('calendario de suministro más estable'), blockText(p));
});

await test('informe: la tabla con su cabecera y las imágenes con su tamaño en la página', () => {
  assert.deepEqual(L.pages[0][9].rows, INFORME.tabla);
  const [logo] = L.pages[0];
  assert.ok(Math.abs(logo.width - 55) < 0.5 && logo.align === 'right');
  const foto = L.pages[0][10];
  assert.ok(Math.abs(foto.width - 240) < 0.5 && Math.abs(foto.height - 120) < 0.5);
  assert.ok(Math.abs(L.margins.left - 60) < 0.5);
});

await test('factura: las líneas «clave … valor» son párrafos sueltos, con sangría y tabuladores en su sitio', async () => {
  const F = layoutDocument(analyze(await factura()).pages);
  const totals = F.pages[0].filter((b) => b.type === 'paragraph' && b.tabs && b.indent);
  assert.deepEqual(totals.map(blockText), [`Base imponible\t${FACTURA.base} €`, `IVA 21 %\t${FACTURA.iva} €`, `TOTAL\t${FACTURA.total} €`]);
  assert.ok(Math.abs(totals[0].indent - (380 - 50)) < 1);
  // El importe acaba en el margen derecho: tabulador a la derecha, como en el PDF.
  assert.equal(totals[0].tabs.length, 1);
  assert.equal(totals[0].tabs[0].align, 'right');
  assert.ok(Math.abs(totals[0].tabs[0].pos - (545 - 50)) < 3, JSON.stringify(totals[0].tabs));
  assert.equal(F.pages[0].filter((b) => b.type === 'table').length, 1);
  assert.equal(F.pages[0].find((b) => b.type === 'table').rows.length, FACTURA.lineas.length + 1);
});

await test('página escaneada con OCR: el texto sustituye a la imagen de la página; tamaño sacado de las cajas', () => {
  const W = 595; const H = 842;
  const line = (n, ws, v, size = 11) => {
    let u = 0.1;
    return ws.map((t, i) => {
      const w = { t, a: [u, v], b: [u + t.length * 0.011, v], size, line: n, space: i < ws.length - 1 };
      u += t.length * 0.011 + 0.006;
      return w;
    });
  };
  const words = [
    ...line(0, ['ALBARÁN', '4711'], 0.1, 18),
    ...line(1, ['Entrega', 'de', 'mercancía', 'en', 'el', 'almacén', 'de', 'Mollet', 'según', 'el', 'pedido', 'del', 'cliente', 'y', 'las'], 0.16),
    ...line(2, ['condiciones', 'pactadas.'], 0.18),
  ];
  const chars = ocrChars(words, W, H);
  const page = analyzePage({ chars, styles: null, W, H, images: [{ rect: [0, 0, 1, 1], width: 10, height: 10 }] });
  const D = layoutDocument([page]);
  assert.deepEqual(summary(D.pages[0]), ['title', 'paragraph']);
  assert.equal(blockText(D.pages[0][1]), 'Entrega de mercancía en el almacén de Mollet según el pedido del cliente y las condiciones pactadas.');
});

await test('styledWords: un trozo por estilo dentro de la palabra; generated y espacios separan', () => {
  const chars = { text: 'ab cd', boxes: Float32Array.from([0, 0, 0.01, 0.02, 0.01, 0, 0.02, 0.02, 0.02, 0, 0.03, 0.02, 0.03, 0, 0.04, 0.02, 0.04, 0, 0.05, 0.02]), generated: new Uint8Array(5) };
  const styles = { size: Float32Array.from([10, 10, 10, 10, 10]), flags: Uint8Array.from([1, 0, 0, 0, 0]), color: new Uint32Array(5), font: new Uint16Array(5), fonts: ['Arial'] };
  const ws = styledWords(chars, styles, 1000, 1000);
  assert.deepEqual(ws.map((w) => w.text), ['ab', 'cd']);
  assert.deepEqual(ws[0].segs.map((s) => [s.text, s.style.bold]), [['a', true], ['b', false]]);
});

await test('encabezado repetido (albarán de dos páginas): sale de las páginas y va al encabezado de Word, con el número de página como campo', async () => {
  const A = layoutDocument(analyze(await albaranLineas()).pages);
  assert.deepEqual(A.header.map(blockText), [`ALBARÁN ${ALBARAN_LINEAS.numero}`, `Fecha de entrega: ${ALBARAN_LINEAS.fecha} · Página 1`, 'Destino: Supermercados Nord, S.A. · Almacén de Mollet']);
  assert.deepEqual(A.header.map((b) => b.pageNumber), [false, true, false]);
  assert.ok(!A.pages.flat().some((b) => /ALBARÁN|Fecha de entrega/.test(blockText(b))), 'ya no está en el cuerpo');
  assert.equal(A.footer.length, 0);
  const zip = await JSZip.loadAsync(await buildDocx(docx, A, { title: 'Albarán' }));
  const header = Object.keys(zip.files).find((f) => /^word\/header\d*\.xml$/.test(f));
  const hx = await zip.file(header).async('string');
  assert.ok(hx.includes('ALBARÁN AL-0457'));
  assert.ok(/<w:instrText[^>]*>\s*PAGE\s*<\/w:instrText>/.test(hx), 'campo PAGE en el encabezado');
  assert.ok(!/Página 1</.test(hx), 'el 1 no queda escrito');
});

await test('imágenes repetidas en el mismo sitio (membrete, logotipos) no van al cuerpo; las demás sí', () => {
  const page = (extra) => ({ W: 595, H: 842, lines: [], items: [
    { kind: 'image', y: 10, image: { rect: [0.1, 0.01, 0.3, 0.06] } },
    ...extra.map((r) => ({ kind: 'image', y: r[1] * 842, image: { rect: r } })),
  ] });
  const D = layoutDocument([page([[0.1, 0.3, 0.6, 0.5]]), page([]), page([])]);
  assert.deepEqual(D.pages.map((bs) => bs.length), [1, 0, 0]);
  assert.deepEqual(D.pages[0][0].image.rect, [0.1, 0.3, 0.6, 0.5]);
  // Páginas escaneadas sin OCR: la imagen ocupa toda la página en todas, pero cada una es su contenido.
  const scan = () => ({ W: 595, H: 842, lines: [], items: [{ kind: 'image', y: 0, image: { rect: [0, 0, 1, 1] } }] });
  assert.deepEqual(layoutDocument([scan(), scan(), scan()]).pages.map((bs) => bs.length), [1, 1, 1]);
});

await test('sin líneas repetidas arriba o abajo (informe) no hay encabezado ni pie', () => {
  assert.deepEqual([L.header.length, L.footer.length], [0, 0]);
});

await test('wordFont: las fuentes del PDF por las de Word', () => {
  assert.equal(wordFont('Helvetica-Bold'), 'Arial');
  assert.equal(wordFont('ABCDEF+ArialMT'), 'Arial');
  assert.equal(wordFont('Times-Roman'), 'Times New Roman');
  assert.equal(wordFont('Courier'), 'Courier New');
  assert.equal(wordFont('ABCDEF+Calibri-Bold'), 'Calibri');
  assert.equal(wordFont('OpenSans-Italic'), 'Open Sans');
  assert.equal(wordFont(''), null);
});

await test('documento de Word: estilos de título, listas de Word, tabla, imágenes, saltos de página y tamaño A4', async () => {
  const bytes = await buildDocx(docx, L, { title: 'Informe', images: inf.images });
  await mkdir('test/out/exportar', { recursive: true });
  await writeFile('test/out/exportar/informe.docx', bytes);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml').async('string');
  const styles = (xml.match(/<w:pStyle w:val="([^"]+)"\/>/g) ?? []).map((m) => m.match(/w:val="([^"]+)"/)[1]);
  assert.deepEqual(styles.filter((s) => s !== 'ListParagraph'), ['Title', 'Heading1', 'Heading2', 'Heading1', 'Heading1']);
  const text = (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((m) => m.replace(/<[^>]+>/g, '')).join('');
  for (const s of [INFORME.titulo, ...INFORME.vinetas, ...INFORME.numerada, 'calendario de suministro más estable', '47.152,00']) assert.ok(text.includes(s), s);
  assert.ok(!text.includes('•'), 'las viñetas son de Word, no texto');
  assert.ok(!/\b1\. Revisar/.test(text), 'los números son de Word, no texto');
  assert.equal((xml.match(/<w:numPr>/g) ?? []).length, 6);
  assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 1);
  assert.equal((xml.match(/<w:tr>|<w:tr /g) ?? []).length, 4);
  assert.ok(xml.includes('w:fill="F5F0FF"'), 'cabecera de la tabla con fondo');
  assert.ok(/<w:r>(?:(?!<\/w:r>).)*<w:b\/>(?:(?!<\/w:r>).)*12,4 %/s.test(xml), 'la negrita del párrafo');
  assert.equal((xml.match(/<pic:pic/g) ?? []).length, 2);
  assert.equal(Object.keys(zip.files).filter((f) => f.startsWith('word/media/') && !f.endsWith('/')).length, 2);
  assert.equal((xml.match(/<w:pageBreakBefore\/>/g) ?? []).length, 1);
  assert.ok(xml.includes('<w:pgSz w:w="11900" w:h="16840"'));
  const st = await zip.file('word/styles.xml').async('string');
  assert.ok(/w:styleId="Heading1".*?w:sz w:val="30"/s.test(st), 'Título 1 a 15 pt');
});

await test('documento de Word: sin saltos de página ni imágenes si no se piden', async () => {
  const bytes = await buildDocx(docx, L, { title: 'Informe', images: new Map(), pageBreaks: false });
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');
  assert.equal((xml.match(/<pic:pic/g) ?? []).length, 0);
  assert.ok(!xml.includes('pageBreakBefore') && !xml.includes('w:type="page"'));
});

console.log(`\n${passed} pruebas superadas.`);
