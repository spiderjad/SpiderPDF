// Genera PDFs de ejemplo realistas para probar la interfaz.  Ejecutar: node test/make-fixtures.js
// Las pruebas importan los generadores para no depender de los archivos (que se pueden haber editado a mano).
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pngRGB } from './forensics.js';
import { signPdf, addSignatureIncremental } from './sign-pdf.js';
import { PDFDocument, PDFName, PDFHexString, PDFString, StandardFonts, rgb, degrees } from 'pdf-lib';

const lorem = 'Las partes acuerdan las condiciones de suministro descritas en este documento, incluyendo plazos de entrega, calidades exigidas y procedimiento de reclamaciones.';

export async function contrato() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const titles = ['Contrato de suministro', 'Condiciones generales', 'Precios y pagos', 'Calidad y trazabilidad', 'Firmas'];
  titles.forEach((title, i) => {
    const p = doc.addPage([595, 842]);
    p.drawText(`${i + 1}`, { x: 540, y: 800, size: 10, font: f, color: rgb(.5, .5, .5) });
    p.drawText(title, { x: 60, y: 760, size: 24, font: b, color: rgb(.12, .16, .35) });
    p.drawRectangle({ x: 60, y: 745, width: 475, height: 2, color: rgb(.12, .16, .35) });
    for (let l = 0; l < 26; l++) {
      const w = 60 + ((l * 37) % 90);
      p.drawText(lorem.slice(0, w), { x: 60, y: 710 - l * 22, size: 10.5, font: f, color: rgb(.2, .2, .2) });
    }
    if (i === 2) {
      for (let r = 0; r < 6; r++) p.drawRectangle({ x: 60, y: 200 - r * 22, width: 475, height: 20, color: r % 2 ? rgb(.95, .95, .97) : rgb(.88, .9, .96) });
    }
  });
  return doc.save();
}

export async function anexo() {
  const doc = await PDFDocument.create();
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  ['Anexo I: planificación', 'Anexo II: escandallo'].forEach((title, i) => {
    const p = doc.addPage([842, 595]);
    p.drawText(title, { x: 50, y: 530, size: 22, font: b, color: rgb(.55, .18, .1) });
    for (let c = 0; c < 8; c++) {
      const h = 60 + ((c * 53 + i * 31) % 260);
      p.drawRectangle({ x: 70 + c * 88, y: 90, width: 56, height: h, color: rgb(.55, .18 + c * .05, .1 + c * .06) });
      p.drawText(`S${c + 1}`, { x: 88 + c * 88, y: 70, size: 11, font: f });
    }
    if (i === 1) p.setRotation(degrees(0));
  });
  return doc.save();
}

export async function escaneado() {
  // Página "torcida": viene girada 90° como un escaneo mal orientado.
  const doc = await PDFDocument.create();
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = doc.addPage([595, 842]);
  p.drawText('Albarán 0457', { x: 60, y: 760, size: 26, font: b });
  p.drawRectangle({ x: 60, y: 300, width: 475, height: 400, borderColor: rgb(.3, .3, .3), borderWidth: 1.5 });
  p.setRotation(degrees(90));
  return doc.save();
}

export async function formulario() {
  // Solicitud con texto, casilla y desplegable, para probar el relleno de formularios.
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = doc.addPage([595, 842]);
  p.drawText('Solicitud de alta de proveedor', { x: 60, y: 760, size: 22, font: b, color: rgb(.12, .16, .35) });
  const label = (text, x, y) => p.drawText(text, { x, y, size: 11, font: f, color: rgb(.2, .2, .2) });
  const form = doc.getForm();
  // Letra fija de 11 pt (no automática) en los campos de texto y el desplegable.
  label('Razón social', 60, 712);
  const razon = form.createTextField('razon_social');
  razon.addToPage(p, { x: 60, y: 684, width: 300, height: 22 });
  razon.setFontSize(11);
  label('CIF', 60, 662);
  const cif = form.createTextField('cif');
  cif.addToPage(p, { x: 60, y: 634, width: 150, height: 22 });
  cif.setFontSize(11);
  label('País', 60, 612);
  const pais = form.createDropdown('pais');
  pais.setOptions(['España', 'Argentina', 'Portugal', 'Francia']);
  pais.addToPage(p, { x: 60, y: 584, width: 150, height: 22 });
  pais.setFontSize(11);
  form.createCheckBox('acepta_condiciones').addToPage(p, { x: 60, y: 540, width: 14, height: 14 });
  label('Acepto las condiciones generales de compra', 82, 543);
  label('Firma:', 60, 300);
  p.drawRectangle({ x: 60, y: 200, width: 220, height: 90, borderColor: rgb(.6, .6, .6), borderWidth: 1 });
  return doc.save();
}

export async function escaneo() {
  // Página que es solo una imagen (como un escáner): sin texto que buscar ni seleccionar.
  const doc = await PDFDocument.create();
  const p = doc.addPage([595, 842]);
  const img = await doc.embedPng(pngRGB(119, 168, (x, y) => {
    const line = y > 20 && y < 150 && (y % 9 < 2) && x > 12 && x < 12 + ((y * 37) % 90);
    return line ? [70, 70, 75] : [246, 244, 238];
  }));
  p.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  return doc.save();
}

/** Texto del albarán escaneado (las pruebas de OCR buscan estas palabras). */
export const ALBARAN = {
  title: 'ALBARÁN DE ENTREGA Nº 0457',
  lines: [
    'Cliente: Ferretería Peñalba, S.L.',
    'Fecha: 05/11/2026 · Delivery note',
    'Tornillos hexagonales M8 ........ 250 uds',
    'Arandelas planas M8 ............. 500 uds',
    'Tuercas autoblocantes ........... 300 uds',
    'Lliurament a domicili: Girona',
    'Signatura del receptor',
  ],
};

/**
 * Albarán escaneado (solo imágenes, en gris, a 150 ppp): página 1 recta, página 2 torcida 3° y página 3 girada 90°
 * (escaneada de lado). Se dibuja con texto real, se renderiza con PDFium y se incrusta como imagen.
 */
export async function albaranEscaneado() {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { init } = await import('@embedpdf/pdfium');
  const { PdfCore } = await import('../src/engine/pdfium-core.js');
  const { toGray, rotate } = await import('../src/ocr/image.js');
  const require = createRequire(import.meta.url);
  const pdfium = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  pdfium.PDFiumExt_Init();
  const core = new PdfCore(pdfium);

  const src = await PDFDocument.create();
  const f = await src.embedFont(StandardFonts.Helvetica);
  const b = await src.embedFont(StandardFonts.HelveticaBold);
  const p = src.addPage([595, 842]);
  p.drawText(ALBARAN.title, { x: 60, y: 760, size: 20, font: b });
  ALBARAN.lines.forEach((t, i) => p.drawText(t, { x: 60, y: 700 - i * 34, size: 13, font: f }));
  p.drawRectangle({ x: 60, y: 170, width: 220, height: 70, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 1 });
  const d = core.open(await src.save());
  const r = core.render(d.docId, 0, 150 / 72, 0);
  const gray = toGray(r.pixels, r.width, r.height);

  const doc = await PDFDocument.create();
  for (const angle of [0, 3, 90]) {
    let img = angle ? rotate(gray, angle) : gray;
    if (angle % 90) img = { ...img, ...cropCenter(img, gray.w, gray.h) }; // torcida: mismo tamaño de página
    // Algo de «papel»: fondo un poco gris y ruido suave, como un escáner.
    const png = pngRGB(img.w, img.h, (x, y) => {
      const v = Math.min(255, Math.max(0, Math.round(img.data[y * img.w + x] * 0.94 + ((x * 7 + y * 13) % 11) - 2)));
      return [v, v, v];
    });
    const emb = await doc.embedPng(png);
    const [pw, ph] = angle === 90 ? [842, 595] : [595, 842];
    doc.addPage([pw, ph]).drawImage(emb, { x: 0, y: 0, width: pw, height: ph });
  }
  core.close(d.docId);
  return doc.save();
}

/** Recorte centrado al tamaño w × h (la página torcida conserva el tamaño del papel). */
function cropCenter(img, w, h) {
  const x0 = Math.floor((img.w - w) / 2); const y0 = Math.floor((img.h - h) / 2);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) data.set(img.data.subarray((y0 + y) * img.w + x0, (y0 + y) * img.w + x0 + w), y * w);
  return { w, h, data };
}

/**
 * Escribe un índice (marcadores) en un PDF de pdf-lib. nodes: [{ title, page?, top?, uri?, children? }]
 * page: índice de página (destino «ajustar», o XYZ con top); uri: enlace externo en vez de página.
 */
export function addOutline(doc, nodes) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const build = (list, parentRef) => {
    const refs = list.map(() => ctx.nextRef());
    let total = 0;
    list.forEach((n, i) => {
      const dict = { Title: PDFHexString.fromText(n.title), Parent: parentRef };
      if (i > 0) dict.Prev = refs[i - 1];
      if (i < list.length - 1) dict.Next = refs[i + 1];
      if (n.uri) dict.A = ctx.obj({ S: 'URI', URI: PDFString.of(n.uri) });
      else if (n.page !== undefined) {
        dict.Dest = n.top !== undefined
          ? ctx.obj([pages[n.page].ref, PDFName.of('XYZ'), 0, n.top, 0])
          : ctx.obj([pages[n.page].ref, PDFName.of('Fit')]);
      }
      const kids = n.children?.length ? build(n.children, refs[i]) : null;
      if (kids) Object.assign(dict, { First: kids.first, Last: kids.last, Count: kids.count });
      ctx.assign(refs[i], ctx.obj(dict));
      total += 1 + (kids?.count ?? 0);
    });
    return { first: refs[0], last: refs[refs.length - 1], count: total };
  };
  const root = ctx.nextRef();
  const top = build(nodes, root);
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }));
  doc.catalog.set(PDFName.of('Outlines'), root);
}

export const INDICE = [
  { title: '1. Introducción', page: 0, children: [
    { title: '1.1 Objetivo', page: 0, top: 500 },
    { title: '1.2 Alcance', page: 1 },
  ] },
  { title: '2. Propuesta', page: 2, children: [
    { title: '2.1 Fases', page: 3, children: [
      { title: 'Fase A: análisis', page: 3, top: 400 },
      { title: 'Fase B: implantación', page: 4 },
    ] },
  ] },
  { title: '3. Presupuesto y condiciones', page: 5 },
  { title: 'Web del proyecto', uri: 'https://example.com' },
];

export async function indice() {
  // Propuesta de 6 páginas con índice anidado (3 niveles, destinos «ajustar» y XYZ, y un enlace externo).
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const heads = ['1. Introducción', '1.2 Alcance', '2. Propuesta', '2.1 Fases', 'Fase B: implantación', '3. Presupuesto y condiciones'];
  heads.forEach((title, i) => {
    const p = doc.addPage([595, 842]);
    p.drawText(`${i + 1}`, { x: 540, y: 800, size: 10, font: f, color: rgb(.5, .5, .5) });
    p.drawText(title, { x: 60, y: 760, size: 22, font: b, color: rgb(.12, .16, .35) });
    if (i === 0) p.drawText('1.1 Objetivo', { x: 60, y: 480, size: 16, font: b, color: rgb(.12, .16, .35) });
    if (i === 3) p.drawText('Fase A: análisis', { x: 60, y: 380, size: 16, font: b, color: rgb(.12, .16, .35) });
    for (let l = 0; l < 10; l++) p.drawText(lorem.slice(0, 70 + ((l * 29) % 70)), { x: 60, y: 720 - l * 20, size: 10.5, font: f, color: rgb(.2, .2, .2) });
  });
  addOutline(doc, INDICE);
  doc.setTitle('Propuesta con índice');
  return doc.save();
}

export async function firmado() {
  // El contrato con una firma digital real (certificado autofirmado de prueba, ver sign-pdf.js).
  return signPdf(await contrato());
}

export async function certificado() {
  // El formulario con una firma de CERTIFICACIÓN que solo permite rellenarlo (DocMDP P=2).
  return signPdf(await formulario(), undefined, { mdp: 2 });
}

export async function dosFirmas() {
  // El contrato firmado dos veces: la segunda firma se añadió con un guardado incremental.
  return addSignatureIncremental(await firmado());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
await writeFile('test/fixtures/certificado.pdf', await certificado());
await writeFile('test/fixtures/dos-firmas.pdf', await dosFirmas());
await writeFile('test/fixtures/indice.pdf', await indice());
await writeFile('test/fixtures/firmado.pdf', await firmado());
await writeFile('test/fixtures/contrato.pdf', await contrato());
await writeFile('test/fixtures/anexo.pdf', await anexo());
await writeFile('test/fixtures/albaran-girado.pdf', await escaneado());
await writeFile('test/fixtures/formulario.pdf', await formulario());
await writeFile('test/fixtures/escaneo.pdf', await escaneo());
await writeFile('test/fixtures/albaran-escaneado.pdf', await albaranEscaneado());
console.log('fixtures ok');
}
