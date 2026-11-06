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

// Índice IMPRESO (sin marcadores), como el de una propuesta exportada de Word: portada sin numerar, así que
// la página impresa 1 es la 2 del PDF (desfase +1); puntos de relleno; numeración 1, 2, 2.1…; entradas sin
// numerar; un título partido en dos líneas; cabecera y pie con números que no son entradas.
export const INDICE_IMPRESO = [
  // [título en el índice, nivel, página impresa]
  ['INFORMACIÓN GENERAL', 1, 1],
  ['ÍNDICE', 1, 2],
  ['1 INTRODUCCIÓN. ANTECEDENTES Y OBJETIVOS', 1, 3],
  ['2 DESCRIPCIÓN Y ALCANCE', 1, 3],
  ['2.1 ESTRUCTURA ORGANIZATIVA', 2, 3],
  ['2.2 FLUJO DE TRASLADO', 2, 4],
  ['2.3 TAREAS EXCLUIDAS DEL ALCANCE DEL PROYECTO Y OTRAS CONSIDERACIONES', 2, 5],
  ['3 PLAN DE PROYECTO', 1, 5],
  ['4 PROPUESTA ECONÓMICA', 1, 6],
  ['4.1 HONORARIOS', 2, 6],
  ['4.2 PLAN DE FACTURACIÓN', 2, 7],
  ['5 CONDICIONES', 1, 7],
];

export async function indiceImpreso() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.15, .15, .2);
  const W = 595; const H = 842; const L = 60; const R = 535;
  const total = 8;
  const page = (printed) => {
    const p = doc.addPage([W, H]);
    p.drawText('Propuesta de servicios', { x: L, y: 800, size: 9, font: f, color: rgb(.45, .45, .5) });
    if (printed) {
      const head = `Página ${printed} de ${total - 1}`;
      p.drawText(head, { x: R - f.widthOfTextAtSize(head, 9), y: 800, size: 9, font: f, color: rgb(.45, .45, .5) });
      p.drawText(String(printed), { x: W / 2 - 3, y: 40, size: 9, font: f, color: rgb(.45, .45, .5) });
    }
    return p;
  };
  const body = (p, y, n = 8) => { for (let l = 0; l < n; l++) p.drawText(lorem.slice(0, 70 + ((l * 31) % 70)), { x: L, y: y - l * 16, size: 10, font: f, color: ink }); };

  // 1: portada (sin número)
  const cover = page(null);
  cover.drawText('Oferta de servicios', { x: L, y: 520, size: 30, font: b, color: rgb(.12, .16, .35) });
  cover.drawText('Proyecto de integración', { x: L, y: 480, size: 16, font: f, color: ink });
  // 2 (impresa 1): información general
  const info = page(1);
  info.drawText('INFORMACIÓN GENERAL', { x: L, y: 740, size: 14, font: b, color: ink });
  body(info, 710);
  // 3 (impresa 2): el índice
  const toc = page(2);
  toc.drawText('ÍNDICE', { x: L, y: 740, size: 14, font: b, color: ink });
  let y = 710;
  for (const [title, level, printed] of INDICE_IMPRESO) {
    const x = L + (level - 1) * 12;
    const font = level === 1 ? b : f;
    const num = String(printed);
    const nx = R - f.widthOfTextAtSize(num, 10);
    // El 2.3 no cabe: se parte en dos líneas y solo la segunda lleva el relleno y el número.
    let last = title;
    if (title.length > 50) {
      const cut = title.lastIndexOf(' ', 52);
      toc.drawText(title.slice(0, cut), { x, y, size: 10, font, color: ink });
      y -= 15;
      last = title.slice(cut + 1);
    }
    toc.drawText(last, { x, y, size: 10, font, color: ink });
    const from = x + font.widthOfTextAtSize(last, 10) + 4;
    const dots = Math.max(3, Math.floor((nx - 4 - from) / f.widthOfTextAtSize('.', 10)));
    toc.drawText('.'.repeat(dots), { x: from, y, size: 10, font: f, color: ink });
    toc.drawText(num, { x: nx, y, size: 10, font: f, color: ink });
    y -= 22;
  }
  // 4.. (impresas 3..7): los apartados con su título en la página que dice el índice
  for (let printed = 3; printed <= 7; printed++) {
    const p = page(printed);
    let yy = 740;
    for (const [title, , at] of INDICE_IMPRESO) {
      if (at !== printed || title === 'ÍNDICE' || title === 'INFORMACIÓN GENERAL') continue;
      const size = /^\d+ /.test(title) ? 14 : 12;
      const words = title.split(' ');
      let line = '';
      for (const w of words) {
        if (b.widthOfTextAtSize(`${line} ${w}`, size) > R - L) { p.drawText(line.trim(), { x: L, y: yy, size, font: b, color: ink }); yy -= size + 4; line = ''; }
        line += ` ${w}`;
      }
      p.drawText(line.trim(), { x: L, y: yy, size, font: b, color: ink });
      body(p, yy - 26, 5);
      yy -= 130;
    }
  }
  doc.setTitle('Propuesta con índice impreso');
  return doc.save();
}

// Enlaces: la página 1 lleva a las páginas 2 y 3 (uno con /Dest y otro con una acción «Ir a») y a una web.
export const ENLACE_WEB = 'https://example.com/spiderpdf';
export async function enlaces() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx = doc.context;
  const pages = ['Contenido', 'Capítulo uno', 'Capítulo dos'].map((t, i) => {
    const p = doc.addPage([595, 842]);
    p.drawText(t, { x: 60, y: 760, size: 22, font: b, color: rgb(.12, .16, .35) });
    p.drawText(`${i + 1}`, { x: 540, y: 800, size: 10, font: f, color: rgb(.5, .5, .5) });
    return p;
  });
  const blue = rgb(.1, .3, .75);
  const rows = [
    ['Ir al capítulo uno', { Dest: ctx.obj([pages[1].ref, PDFName.of('Fit')]) }],
    ['Ir al capítulo dos', { A: ctx.obj({ S: 'GoTo', D: ctx.obj([pages[2].ref, PDFName.of('XYZ'), 0, 800, 0]) }) }],
    ['Visita la web del proyecto', { A: ctx.obj({ S: 'URI', URI: PDFString.of(ENLACE_WEB) }) }],
  ];
  const annots = rows.map(([text, target], i) => {
    const y = 700 - i * 40;
    pages[0].drawText(text, { x: 60, y, size: 14, font: f, color: blue });
    const w = f.widthOfTextAtSize(text, 14);
    return ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [58, y - 4, 62 + w, y + 14], Border: [0, 0, 0], ...target }));
  });
  pages[0].node.set(PDFName.of('Annots'), ctx.obj(annots));
  for (let l = 0; l < 6; l++) pages[0].drawText(lorem.slice(0, 80), { x: 60, y: 520 - l * 18, size: 10, font: f, color: rgb(.2, .2, .2) });
  return doc.save();
}

// Factura con tabla de líneas DIBUJADA (rejilla), importes en formato español y totales debajo.
export const FACTURA = {
  numero: 'F-2026/0912',
  fecha: '05/11/2026',
  cabecera: ['Código', 'Descripción', 'Cantidad', 'Precio', 'Dto. %', 'Importe'],
  lineas: [
    ['A-1001', 'Fuet extra 150 g', '120', '2,35', '0', '282,00'],
    ['A-1002', 'Longaniza de Vic 250 g', '48', '4,90', '5', '223,44'],
    ['A-2010', 'Chorizo ibérico loncheado 100 g', '200', '1,85', '0', '370,00'],
    ['A-2011', 'Salchichón ibérico 1 kg', '12', '18,40', '10', '198,72'],
    ['B-0301', 'Jamón cocido extra (pieza)', '6', '42,10', '0', '252,60'],
    ['B-0302', 'Pavo braseado (pieza)', '6', '38,75', '0', '232,50'],
    ['C-5001', 'Caja expositora', '10', '1.250,00', '15', '10.625,00'],
    ['C-5002', 'Portes', '1', '35,00', '0', '35,00'],
  ],
  base: '12.219,26', iva: '2.566,04', total: '14.785,30',
};

export async function factura() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.12, .12, .16);
  const p = doc.addPage([595, 842]);
  p.drawText('Embutidos del Ter, S.L.', { x: 50, y: 790, size: 16, font: b, color: ink });
  p.drawText('CIF B17000000 · Carretera de Vic, 12 · 17000 Girona', { x: 50, y: 772, size: 9, font: f, color: ink });
  p.drawText(`FACTURA ${FACTURA.numero}`, { x: 360, y: 790, size: 14, font: b, color: ink });
  p.drawText(`Fecha: ${FACTURA.fecha}`, { x: 360, y: 772, size: 10, font: f, color: ink });
  p.drawText('Cliente: Supermercados Nord, S.A.', { x: 50, y: 730, size: 10, font: f, color: ink });
  // Rejilla: columnas con su borde izquierdo y alineación (los números a la derecha).
  const cols = [50, 110, 300, 360, 430, 480, 545];
  const right = [false, false, true, true, true, true];
  const top = 690; const rowH = 20;
  const rows = [FACTURA.cabecera, ...FACTURA.lineas];
  p.drawRectangle({ x: cols[0], y: top - rowH, width: cols.at(-1) - cols[0], height: rowH, color: rgb(.9, .91, .95) });
  rows.forEach((r, i) => {
    const y = top - i * rowH - 14;
    r.forEach((t, c) => {
      const font = i === 0 ? b : f;
      const w = font.widthOfTextAtSize(t, 9);
      const x = right[c] && i > 0 ? cols[c + 1] - 5 - w : cols[c] + 5;
      p.drawText(t, { x, y, size: 9, font, color: ink });
    });
  });
  const bottom = top - rows.length * rowH;
  for (let i = 0; i <= rows.length; i++) p.drawLine({ start: { x: cols[0], y: top - i * rowH }, end: { x: cols.at(-1), y: top - i * rowH }, thickness: 0.6, color: ink });
  for (const x of cols) p.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.6, color: ink });
  // Totales (fuera de la tabla).
  [['Base imponible', FACTURA.base], ['IVA 21 %', FACTURA.iva], ['TOTAL', FACTURA.total]].forEach(([k, v], i) => {
    const y = bottom - 30 - i * 16;
    const font = i === 2 ? b : f;
    p.drawText(k, { x: 380, y, size: 10, font, color: ink });
    p.drawText(`${v} €`, { x: 545 - font.widthOfTextAtSize(`${v} €`, 10), y, size: 10, font, color: ink });
  });
  p.drawText('Forma de pago: transferencia a 30 días. Vencimiento: 05/12/2026.', { x: 50, y: 120, size: 9, font: f, color: ink });
  doc.setTitle(`Factura ${FACTURA.numero}`);
  return doc.save();
}

// Albarán SIN líneas: columnas solo por la alineación del texto; una descripción partida en dos líneas;
// dos páginas (la tabla sigue en la segunda con su cabecera repetida).
export const ALBARAN_LINEAS = {
  numero: 'AL-0457',
  fecha: '2026-11-05',
  cabecera: ['Ref.', 'Artículo', 'Lote', 'Caducidad', 'Cajas', 'Kg'],
  lineas: [
    ['1001', 'Fuet extra 150 g', 'L2610A', '15/01/2027', '12', '21,60'],
    ['1002', 'Longaniza de Vic 250 g', 'L2610B', '20/01/2027', '8', '24,00'],
    ['2010', 'Chorizo ibérico loncheado 100 g en bandeja de atmósfera protectora', 'L2611C', '10/12/2026', '20', '20,00'],
    ['2011', 'Salchichón ibérico 1 kg', 'L2611D', '28/02/2027', '4', '48,00'],
    ['3001', 'Butifarra blanca', 'L2612E', '30/11/2026', '15', '37,50'],
    ['3002', 'Butifarra negra', 'L2612F', '30/11/2026', '15', '36,75'],
    ['3003', 'Bull blanco', 'L2612G', '05/12/2026', '6', '18,30'],
    ['4001', 'Jamón cocido extra', 'L2613H', '15/12/2026', '3', '27,90'],
    ['4002', 'Pavo braseado', 'L2613I', '15/12/2026', '3', '25,80'],
    ['4003', 'Mortadela con aceitunas', 'L2613J', '20/12/2026', '5', '30,00'],
    ['5001', 'Paté de campaña', 'L2614K', '10/01/2027', '10', '12,00'],
    ['5002', 'Sobrasada de Mallorca', 'L2614L', '31/03/2027', '6', '9,00'],
  ],
  porPagina: 8,
};

export async function albaranLineas() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.12, .12, .16);
  const A = ALBARAN_LINEAS;
  // Borde izquierdo (texto) o derecho (números) de cada columna.
  const x = [50, 95, 330, 390, 495, 545];
  const num = [false, false, false, false, true, true];
  const put = (p, t, c, y, font) => p.drawText(t, { x: num[c] ? x[c] - font.widthOfTextAtSize(t, 9.5) : x[c], y, size: 9.5, font, color: ink });
  for (let start = 0, pg = 1; start < A.lineas.length; start += A.porPagina, pg++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`ALBARÁN ${A.numero}`, { x: 50, y: 790, size: 15, font: b, color: ink });
    p.drawText(`Fecha de entrega: ${A.fecha}   ·   Página ${pg}`, { x: 50, y: 770, size: 9.5, font: f, color: ink });
    p.drawText('Destino: Supermercados Nord, S.A. · Almacén de Mollet', { x: 50, y: 755, size: 9.5, font: f, color: ink });
    let y = 715;
    A.cabecera.forEach((t, c) => put(p, t, c, y, b));
    y -= 22;
    for (const r of A.lineas.slice(start, start + A.porPagina)) {
      const long = f.widthOfTextAtSize(r[1], 9.5) > 225;
      r.forEach((t, c) => {
        if (c === 1 && long) {
          const cut = t.lastIndexOf(' ', 40);
          put(p, t.slice(0, cut), c, y, f);
          put(p, t.slice(cut + 1), c, y - 12, f);
        } else put(p, t, c, y, f);
      });
      y -= long ? 30 : 18;
    }
    p.drawText('Recibido conforme: ______________________', { x: 50, y: 120, size: 9.5, font: f, color: ink });
  }
  doc.setTitle(`Albarán ${A.numero}`);
  return doc.save();
}

// Informe para exportar a Word: títulos de dos niveles, párrafos de varias líneas con negrita en medio, lista de
// viñetas (una partida en dos líneas), lista numerada, tabla con rejilla, una foto, un logo con transparencia y
// una palabra partida con guion entre dos líneas. Dos páginas.
export const INFORME = {
  titulo: 'Informe trimestral de ventas',
  subtitulo: 'Embutidos del Ter, S.L. · Tercer trimestre de 2026',
  h1: ['1. Resumen', '2. Ventas por línea de producto', '3. Próximos pasos'],
  h2: '1.1 Canales',
  negrita: '12,4 %',
  vinetas: ['Grandes superficies: 58 % de la facturación.', 'Tiendas tradicionales y charcuterías de barrio, con un crecimiento sostenido durante todo el trimestre gracias a las nuevas rutas.', 'Exportación: 9 %.'],
  numerada: ['Revisar las tarifas de 2027.', 'Ampliar la ruta de Girona.', 'Lanzar el formato de 100 g.'],
  tabla: [['Línea', 'Unidades', 'Importe'], ['Fuet', '18.200', '42.770,00'], ['Chorizo', '9.650', '17.852,50'], ['Jamón cocido', '1.120', '47.152,00']],
  partida: ['suminis', 'tro'], // «suministro» partida con guion al final de una línea
};

export async function informe() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.12, .12, .16);
  const blue = rgb(.1, .25, .55);
  const I = INFORME;
  const L = 60; const R = 535;
  // Párrafo con trozos [texto, fuente]: parte en líneas por anchura real; devuelve la y de debajo.
  const para = (p, runs, y, { size = 10.5, lead = 15, indent = 0 } = {}) => {
    const words = runs.flatMap(([t, font]) => t.split(' ').filter(Boolean).map((w) => [w, font]));
    let x = L + indent;
    for (const [w, font] of words) {
      const ww = font.widthOfTextAtSize(w, size);
      if (x + ww > R) { x = L + indent; y -= lead; }
      p.drawText(w, { x, y, size, font, color: ink });
      x += ww + f.widthOfTextAtSize(' ', size);
    }
    return y - lead;
  };
  const p1 = doc.addPage([595, 842]);
  // Logo con transparencia (círculo) arriba a la derecha y título.
  const logo = await doc.embedPng(pngRGB(80, 80, (x, y) => {
    const d = Math.hypot(x - 40, y - 40);
    return d < 36 ? [40, 90, 170, 255] : [255, 255, 255, 0];
  }, 4));
  p1.drawImage(logo, { x: 480, y: 760, width: 55, height: 55 });
  p1.drawText(I.titulo, { x: L, y: 785, size: 22, font: b, color: ink });
  p1.drawText(I.subtitulo, { x: L, y: 765, size: 11, font: f, color: ink });
  let y = 725;
  p1.drawText(I.h1[0], { x: L, y, size: 15, font: b, color: blue });
  y -= 22;
  y = para(p1, [['El volumen de ventas del trimestre creció un', f], [I.negrita, b], ['respecto al mismo periodo del año anterior, impulsado por la línea de curados y por la apertura de dos rutas nuevas en la provincia de Girona.', f]], y);
  y -= 9; // espacio entre párrafos
  y = para(p1, [['Los márgenes se mantuvieron estables a pesar de la subida del precio de la materia prima, que se compensó con la renegociación de los contratos de transporte.', f]], y);
  y -= 8;
  p1.drawText(I.h2, { x: L, y, size: 12.5, font: b, color: ink });
  y -= 20;
  for (const t of I.vinetas) {
    p1.drawText('•', { x: L + 6, y, size: 10.5, font: f, color: ink });
    y = para(p1, [[t, f]], y, { indent: 20 });
  }
  y -= 8;
  p1.drawText(I.h1[1], { x: L, y, size: 15, font: b, color: blue });
  y -= 30;
  // Tabla con rejilla.
  const cols = [L, 230, 330, 450];
  const rowH = 20;
  const top = y + 14;
  I.tabla.forEach((r, i) => {
    const yy = top - i * rowH - 14;
    r.forEach((t, c) => {
      const font = i === 0 ? b : f;
      const w = font.widthOfTextAtSize(t, 10);
      p1.drawText(t, { x: c > 0 && i > 0 ? cols[c + 1] - 6 - w : cols[c] + 6, y: yy, size: 10, font, color: ink });
    });
  });
  const bottom = top - I.tabla.length * rowH;
  for (let i = 0; i <= I.tabla.length; i++) p1.drawLine({ start: { x: L, y: top - i * rowH }, end: { x: cols.at(-1), y: top - i * rowH }, thickness: 0.6, color: ink });
  for (const x of cols) p1.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.6, color: ink });
  y = bottom - 30;
  // Foto (degradado opaco).
  const foto = await doc.embedPng(pngRGB(240, 120, (x, yy) => [80 + (x * 0.6) | 0, 120 + (yy * 0.8) | 0, 90]));
  p1.drawImage(foto, { x: L, y: y - 120, width: 240, height: 120 });
  y -= 140;
  para(p1, [['Figura 1. Evolución de las ventas semanales.', f]], y, { size: 9 });

  const p2 = doc.addPage([595, 842]);
  y = 785;
  p2.drawText(I.h1[2], { x: L, y, size: 15, font: b, color: blue });
  y -= 22;
  // Línea que acaba en «suminis-» y sigue con «tro» en la siguiente.
  p2.drawText(`Para el próximo trimestre se ha acordado con los proveedores un calendario de suminis-`, { x: L, y, size: 10.5, font: f, color: ink });
  y -= 15;
  p2.drawText('tro más estable, con entregas semanales fijas y un stock de seguridad de diez días.', { x: L, y, size: 10.5, font: f, color: ink });
  y -= 23;
  I.numerada.forEach((t, i) => {
    p2.drawText(`${i + 1}.`, { x: L + 4, y, size: 10.5, font: f, color: ink });
    p2.drawText(t, { x: L + 20, y, size: 10.5, font: f, color: ink });
    y -= 15;
  });
  y -= 8;
  para(p2, [['Este informe se ha preparado con los datos del sistema de gestión a 30 de septiembre de 2026.', f]], y);
  doc.setTitle(I.titulo);
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
await writeFile('test/fixtures/indice-impreso.pdf', await indiceImpreso());
await writeFile('test/fixtures/enlaces.pdf', await enlaces());
await writeFile('test/fixtures/factura.pdf', await factura());
await writeFile('test/fixtures/albaran-lineas.pdf', await albaranLineas());
await writeFile('test/fixtures/informe.pdf', await informe());
await writeFile('test/fixtures/firmado.pdf', await firmado());
await writeFile('test/fixtures/contrato.pdf', await contrato());
await writeFile('test/fixtures/anexo.pdf', await anexo());
await writeFile('test/fixtures/albaran-girado.pdf', await escaneado());
await writeFile('test/fixtures/formulario.pdf', await formulario());
await writeFile('test/fixtures/escaneo.pdf', await escaneo());
await writeFile('test/fixtures/albaran-escaneado.pdf', await albaranEscaneado());
console.log('fixtures ok');
}
