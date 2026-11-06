// Prueba del núcleo PDFium en Node, sin Electron.  Ejecutar: npm test
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync as readFileSyncSafe } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { createSubsetter } from '../src/engine/subset.js';
import { fontFile, parseFamilyKey, defaultStyle } from '../src/textbox.js';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { init } from '@embedpdf/pdfium';
import { PDFDocument, PDFName, PDFDict, PDFNumber, PDFHexString, PDFString, StandardFonts, rgb, degrees, beginText, endText, setFontAndSize, setTextMatrix, showText } from 'pdf-lib';
import { PdfCore } from '../src/engine/pdfium-core.js';
import { fontTraits } from '../src/engine/fontTraits.js';
import { rectToDisplay } from '../src/geometry.js';
import { parsePdf, unreachable, scanWord, pngRGB } from './forensics.js';
import { contrato, indice, indiceImpreso, enlaces, ENLACE_WEB, factura, albaranLineas, informe, INFORME } from './make-fixtures.js';
import { textLines, findTocPages, tocEntries, guessOffset, targetIndex, treeFromLevels } from '../src/toc.js';
import { signPdf, selfSignedCert, signatureIntact, certIsSelfSigned, byteRange } from './sign-pdf.js';
import { createQpdf, finishWithQpdf } from '../src/engine/qpdf.js';
import createQpdfModule from '../src/engine/qpdf/qpdf.mjs';
import { ALL_PERMS, PERM, permsFor, permsPolicy } from '../src/security.js';
import { reducePdf } from '../src/engine/reduce.js';
import jpegjs from 'jpeg-js';

const require = createRequire(import.meta.url);
const wasmBinary = await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
const pdfium = await init({ wasmBinary });
pdfium.PDFiumExt_Init();
const core = new PdfCore(pdfium);
const qpdf = await createQpdf(createQpdfModule, await readFile(new URL('../src/engine/qpdf/qpdf.wasm', import.meta.url)));

// PDFs de prueba: A tiene 3 páginas A4 verticales, B tiene 2 apaisadas (la 2ª ya viene rotada 90°)
async function makePdf(label, n, size, preRotate = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < n; i++) {
    const p = doc.addPage(size);
    p.drawText(`${label}${i + 1}`, { x: 60, y: size[1] - 120, size: 64, font, color: rgb(0.1, 0.1, 0.4) });
    if (preRotate[i]) p.setRotation(degrees(preRotate[i]));
  }
  return doc.save();
}
const A = await makePdf('A', 3, [595, 842]);
const B = await makePdf('B', 2, [842, 595], { 1: 90 });

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

const a = core.open(A);
const b = core.open(B);

t('abre y lee número de páginas', () => {
  assert.equal(a.pages.length, 3);
  assert.equal(b.pages.length, 2);
});

t('lee tamaños (respetando la rotación que ya trae el PDF)', () => {
  assert.equal(Math.round(a.pages[0].width), 595);
  assert.equal(Math.round(b.pages[0].width), 842);
  assert.equal(Math.round(b.pages[1].width), 595); // venía rotada 90°
});

let img;
t('renderiza una página a RGBA con contenido', () => {
  img = core.render(a.docId, 0, 0.5);
  assert.equal(img.width, 298);
  assert.equal(img.pixels.length, img.width * img.height * 4);
  let dark = 0;
  for (let i = 0; i < img.pixels.length; i += 4) if (img.pixels[i] < 128) dark++;
  assert.ok(dark > 100, 'el texto debería verse');
});

t('renderiza rotado (cambia ancho y alto)', () => {
  const r = core.render(a.docId, 0, 0.5, 1);
  assert.equal(r.width, img.height);
  assert.equal(r.height, img.width);
});

const refs = [
  { docId: b.docId, index: 0, rot: 0 },
  { docId: a.docId, index: 2, rot: 1 },   // A3 girada 90°
  { docId: a.docId, index: 0, rot: 0 },
  { docId: b.docId, index: 1, rot: 3 },   // B2: 90 + 270 = 0
]; // A2 eliminada

const out = core.compose(refs);
const check = await PDFDocument.load(out);

t('une dos PDFs, reordena y elimina', () => assert.equal(check.getPageCount(), 4));
t('aplica la rotación pedida', () => {
  const rots = check.getPages().map(p => p.getRotation().angle);
  assert.deepEqual(rots, [0, 90, 0, 0]);
});

t('el resultado se puede volver a abrir con PDFium', () => {
  const r = core.open(out);
  assert.equal(r.pages.length, 4);
  core.close(r.docId);
});

t('extrae una sola página', () => {
  const one = core.compose([{ docId: a.docId, index: 1, rot: 0 }]);
  const r = core.open(one);
  assert.equal(r.pages.length, 1);
  core.close(r.docId);
});

t('rechaza un archivo que no es PDF con un mensaje claro', () => {
  assert.throws(() => core.open(new TextEncoder().encode('hola')), /no es un PDF válido/);
});

t('cerrar libera el documento', () => {
  core.close(b.docId);
  assert.throws(() => core.render(b.docId, 0), /no está abierto/);
});

// --- Paso 2: formularios, anotaciones y firmas -----------------------------------

// Formulario de 2 páginas: la 1ª con texto, casilla y desplegable; la 2ª sin campos.
async function makeForm() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  p.drawText('Formulario', { x: 60, y: 780, size: 24, font });
  const form = doc.getForm();
  form.createTextField('nombre').addToPage(p, { x: 60, y: 700, width: 250, height: 24 });
  form.createCheckBox('acepto').addToPage(p, { x: 60, y: 650, width: 16, height: 16 });
  const dd = form.createDropdown('pais');
  dd.setOptions(['España', 'Argentina', 'Portugal']);
  dd.addToPage(p, { x: 60, y: 600, width: 150, height: 24 });
  return doc.save();
}
const F = await makeForm();
const f = core.open(F);
const byName = (list, name) => list.find((x) => x.name === name);

t('detecta si un PDF tiene formulario', () => {
  assert.equal(f.hasForm, true);
  assert.equal(a.hasForm, false);
});

t('devuelve rot0 por página', () => {
  assert.deepEqual(b.pages.map((p) => p.rot0), [0, 1]);
});

let formFields;
t('lee los campos: tipo, nombre, opciones y caja en fracciones', () => {
  formFields = core.fields(f.docId, 0);
  assert.deepEqual(formFields.map((x) => x.type).sort(), ['checkbox', 'combo', 'text']);
  const nombre = byName(formFields, 'nombre');
  assert.equal(nombre.value, '');
  // x: 60..310 de 595; y: 700..724 de 842 (v medido desde arriba)
  const want = [60 / 595, (842 - 724) / 842, 310 / 595, (842 - 700) / 842];
  nombre.rect.forEach((x, i) => assert.ok(Math.abs(x - want[i]) < 0.002, `rect ${nombre.rect}`));
  assert.equal(byName(formFields, 'acepto').checked, false);
  assert.deepEqual(byName(formFields, 'pais').options, ['España', 'Argentina', 'Portugal']);
  assert.equal(core.fields(f.docId, 1).length, 0);
});

/** Busca un diccionario de pdf-lib y lo resuelve si es referencia. */
const deref = (ctx, x) => (x && x.constructor.name === 'PDFRef' ? ctx.lookup(x) : x);

console.log('  compose con formulario rellenado:');
{
  const values = {
    [byName(formFields, 'nombre').annotIndex]: 'Diego Pérez',
    [byName(formFields, 'acepto').annotIndex]: true,
    [byName(formFields, 'pais').annotIndex]: 1,
  };
  // La página del formulario pasa a ser la 2ª, y se añade una de A delante.
  const outForm = core.compose([
    { docId: f.docId, index: 1, rot: 0 },
    { docId: f.docId, index: 0, rot: 0, fields: values },
    { docId: a.docId, index: 0, rot: 0 },
  ]);
  const doc = await PDFDocument.load(outForm);
  t('  · el AcroForm sigue existiendo con sus 3 campos', () => {
    const names = doc.getForm().getFields().map((x) => x.getName()).sort();
    assert.deepEqual(names, ['acepto', 'nombre', 'pais']);
  });
  t('  · los valores se guardan', () => {
    const form = doc.getForm();
    assert.equal(form.getTextField('nombre').getText(), 'Diego Pérez');
    assert.equal(form.getCheckBox('acepto').isChecked(), true);
    assert.deepEqual(form.getDropdown('pais').getSelected(), ['Argentina']);
  });
  t('  · PDFium vuelve a leer los valores en la página nueva', () => {
    const r = core.open(outForm);
    const list = core.fields(r.docId, 1);
    assert.equal(byName(list, 'nombre').value, 'Diego Pérez');
    assert.equal(byName(list, 'acepto').checked, true);
    assert.equal(byName(list, 'pais').selected, 1);
    core.close(r.docId);
  });
  t('  · el original no se modifica', () => {
    assert.equal(byName(core.fields(f.docId, 0), 'nombre').value, '');
  });
}

t('un formulario de otro PDF se importa rellenado', () => {
  const field = byName(formFields, 'nombre');
  const outMix = core.compose([
    { docId: a.docId, index: 0, rot: 0 },
    { docId: a.docId, index: 1, rot: 0 },
    { docId: f.docId, index: 0, rot: 0, fields: { [field.annotIndex]: 'Importado' } },
  ]);
  const r = core.open(outMix);
  assert.equal(r.pages.length, 3);
  // Se ve el texto: la zona del campo tiene píxeles oscuros.
  const img = core.render(r.docId, 2, 1);
  const [u0, v0, u1, v1] = field.rect;
  let dark = 0;
  for (let y = Math.floor(v0 * img.height); y < v1 * img.height; y++) {
    for (let x = Math.floor(u0 * img.width); x < u1 * img.width; x++) if (img.pixels[(y * img.width + x) * 4] < 100) dark++;
  }
  assert.ok(dark > 20, 'el valor debería verse en la página importada');
  core.close(r.docId);
});

{
  const annots = [
    { type: 'highlight', rect: [0.1, 0.3, 0.5, 0.33], color: '#FFD400' },
    { type: 'ink', strokes: [[0.1, 0.5, 0.2, 0.55, 0.3, 0.5]], color: '#1F3A93', width: 2 },
    { type: 'note', at: [0.8, 0.1], text: 'Revisar esta cláusula', author: 'Diego' },
  ];
  const outAnn = core.compose([{ docId: a.docId, index: 0, rot: 0, annots }]);
  const doc = await PDFDocument.load(outAnn);
  const ctx = doc.context;
  const list = doc.getPage(0).node.Annots().asArray().map((x) => deref(ctx, x));
  const sub = (d) => d.get(PDFName.of('Subtype')).toString();

  t('crea resaltado, tinta y nota', () => {
    assert.deepEqual(list.map(sub).sort(), ['/Highlight', '/Ink', '/Text']);
  });
  t('las anotaciones tienen apariencia (/AP)', () => {
    for (const d of list) assert.ok(d.get(PDFName.of('AP')), `${sub(d)} sin /AP`);
  });
  t('la nota guarda texto y autor', () => {
    const note = list.find((d) => sub(d) === '/Text');
    assert.equal(note.lookup(PDFName.of('Contents')).decodeText(), 'Revisar esta cláusula');
    assert.equal(note.lookup(PDFName.of('T')).decodeText(), 'Diego');
  });
  t('el resaltado se ve amarillo donde se pidió', () => {
    const r = core.open(outAnn);
    const img = core.render(r.docId, 0, 1);
    const x = Math.round(0.3 * img.width); const y = Math.round(0.315 * img.height);
    const [R, G, B] = img.pixels.slice((y * img.width + x) * 4);
    assert.ok(R > 200 && G > 180 && B < 120, `color ${R},${G},${B}`);
    core.close(r.docId);
  });
}

// Firma de prueba 40x20: solo el cuarto superior izquierdo es opaco (negro),
// el resto transparente. Así se distingue cualquier giro o espejo.
const sig = { width: 40, height: 20, pixels: new Uint8ClampedArray(40 * 20 * 4) };
for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) sig.pixels[(y * 40 + x) * 4 + 3] = 255;

for (const k of [0, 1, 2, 3]) {
  t(`la firma sale derecha y transparente en una página girada ${k * 90}°`, () => {
    const rect = [0.5, 0.6, 0.8, 0.75];
    const outSig = core.compose([{ docId: a.docId, index: 0, rot: k, annots: [{ type: 'image', rect, k, image: sig }] }]);
    const r = core.open(outSig);
    const img = core.render(r.docId, 0, 1); // ya sale con /Rotate aplicado: es lo que ve el usuario
    const d = rectToDisplay(rect, k);
    // Cuartos de la caja en pantalla: arriba-izquierda negro, los otros tres blancos.
    const sample = (fx, fy) => {
      const x = Math.floor((d.x + d.w * fx) * img.width);
      const y = Math.floor((d.y + d.h * fy) * img.height);
      return img.pixels[(y * img.width + x) * 4];
    };
    assert.ok(sample(0.25, 0.25) < 60, 'arriba a la izquierda debería ser negro');
    for (const [fx, fy] of [[0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      assert.ok(sample(fx, fy) > 240, `(${fx}, ${fy}) debería ser transparente`);
    }
    core.close(r.docId);
  });
}

console.log('  máscara de la firma:');
{
  const outSig = core.compose([{ docId: a.docId, index: 0, rot: 0, annots: [{ type: 'image', rect: [0.5, 0.6, 0.8, 0.75], k: 0, image: sig }] }]);
  const doc = await PDFDocument.load(outSig);
  const ctx = doc.context;
  const xobjs = deref(ctx, doc.getPage(0).node.Resources().get(PDFName.of('XObject')));
  const images = xobjs.entries().map(([, ref]) => deref(ctx, ref)).filter((s) => s.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
  t('  · hay una imagen con /SMask', () => {
    assert.ok(images.some((s) => s.dict.get(PDFName.of('SMask'))), 'ninguna imagen tiene SMask');
  });
}

// --- Paso 3: editar texto existente y redacción real ---------------------------------------
console.log('  texto existente y redacción:');
const helv = { widthOfTextAtSize: null };
async function makeText() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  helv.widthOfTextAtSize = (s, size) => font.widthOfTextAtSize(s, size);
  const p = doc.addPage([595, 842]);
  p.drawText('Título', { x: 60, y: 760, size: 24, font: bold });
  p.drawText('Nombre: Juan Pérez García', { x: 60, y: 700, size: 12, font, color: rgb(0.2, 0.2, 0.6) });
  p.drawText('Importe total: 1.250 euros', { x: 60, y: 660, size: 12, font });
  return doc.save();
}
const T = core.open(await makeText());
const runs = core.textRuns(T.docId, 0);
const runOf = (list, start) => list.find((x) => x.text.startsWith(start));
const toFrac = (x, y) => [x / 595, (842 - y) / 842];
/** Origen en puntos del primer carácter ch de la página 1 (según PDFium). */
function charOrigin(docId, ch) {
  const page = pdfium.FPDF_LoadPage(core.doc(docId), 0);
  const tp = pdfium.FPDFText_LoadPage(page);
  try {
    for (let i = 0; i < pdfium.FPDFText_CountChars(tp); i++) {
      if (pdfium.FPDFText_GetUnicode(tp, i) !== ch.codePointAt(0)) continue;
      return core.withMem(16, (q) => {
        pdfium.FPDFText_GetCharOrigin(tp, i, q, q + 8);
        return [pdfium.pdfium.getValue(q, 'double'), pdfium.pdfium.getValue(q + 8, 'double')];
      });
    }
    return [NaN, NaN];
  } finally {
    pdfium.FPDFText_ClosePage(tp);
    pdfium.FPDF_ClosePage(page);
  }
}

t('lee los bloques de texto con tamaño, color, fuente y caja', () => {
  assert.equal(runs.length, 3);
  const name = runOf(runs, 'Nombre');
  assert.equal(name.text, 'Nombre: Juan Pérez García');
  assert.ok(Math.abs(name.ptSize - 12) < 0.01);
  assert.equal(name.color, '#333399');
  assert.match(name.fontName, /Helvetica/);
  assert.match(runOf(runs, 'Título').fontName, /Times-Bold/);
  const [u0, v0] = name.rect;
  assert.ok(Math.abs(u0 - 60 / 595) < 0.004 && Math.abs(v0 - toFrac(0, 700 + 9)[1]) < 0.01, `rect ${name.rect}`);
});

t('editar un texto lo sustituye en el mismo sitio, tamaño, color y familia', () => {
  const name = runOf(runs, 'Nombre');
  const title = runOf(runs, 'Título');
  const out = core.compose([{ docId: T.docId, index: 0, rot: 0, textEdits: {
    [name.objIndex]: { text: 'Nombre: Ana López', from: name.text },
    [title.objIndex]: { text: 'Título nuevo', from: title.text },
  } }]);
  const r = core.open(out);
  const after = core.textRuns(r.docId, 0);
  const edited = runOf(after, 'Nombre');
  assert.equal(edited.text, 'Nombre: Ana López');
  assert.ok(Math.abs(edited.rect[0] - name.rect[0]) < 0.003, 'misma x');
  assert.ok(Math.abs(edited.rect[3] - name.rect[3]) < 0.003, 'misma línea base');
  assert.ok(Math.abs(edited.ptSize - 12) < 0.01);
  assert.equal(edited.color, '#333399');
  assert.equal(runOf(after, 'Título').fontName, 'Times-Bold');
  assert.ok(!core.pageText(r.docId, 0).includes('Juan'));
  assert.ok(core.pageText(r.docId, 0).includes('Importe total'));
  core.close(r.docId);
});

t('vaciar un texto lo borra', () => {
  const imp = runOf(runs, 'Importe');
  const out = core.compose([{ docId: T.docId, index: 0, rot: 0, textEdits: { [imp.objIndex]: { text: '', from: imp.text } } }]);
  const r = core.open(out);
  assert.ok(!core.pageText(r.docId, 0).includes('Importe'));
  assert.equal(core.textRuns(r.docId, 0).length, 2);
  core.close(r.docId);
});

t('si el texto del archivo no coincide con el editado, falla sin estropear nada', () => {
  const name = runOf(runs, 'Nombre');
  assert.throws(() => core.compose([{ docId: T.docId, index: 0, rot: 0, textEdits: { [name.objIndex]: { text: 'x', from: 'otro texto' } } }]), /no coincide/);
});

console.log('  editar texto escalado por la matriz (Tf 1 + Tm 14):');
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595, 842]);
  const key = p.node.newFontDictionary('F9', font.ref);
  p.pushOperators(beginText(), setFontAndSize(key, 1), setTextMatrix(14, 0, 0, 14, 100, 600), showText(font.encodeText('Escalado')), endText());
  const S = core.open(await doc.save());
  const [run] = core.textRuns(S.docId, 0);
  const out = core.compose([{ docId: S.docId, index: 0, rot: 0, textEdits: { [run.objIndex]: { text: 'Otro', from: 'Escalado' } } }]);
  const r = core.open(out);
  const [after] = core.textRuns(r.docId, 0);
  t('  · tamaño 14 y misma posición', () => {
    assert.equal(after.text, 'Otro');
    assert.ok(Math.abs(after.ptSize - 14) < 0.01, `ptSize ${after.ptSize}`);
    assert.ok(Math.abs(after.rect[0] - run.rect[0]) < 0.003);
  });
  core.close(r.docId);
  core.close(S.docId);
}

{
  // Zona sobre «Juan Pérez» (calculada con los anchos reales de Helvetica).
  const x0 = 60 + helv.widthOfTextAtSize('Nombre: ', 12) - 0.5;
  const x1 = 60 + helv.widthOfTextAtSize('Nombre: Juan Pérez', 12) + 0.5;
  const zone = [...toFrac(x0, 714), ...toFrac(x1, 696)];
  const out = core.compose([{ docId: T.docId, index: 0, rot: 0, annots: [{ type: 'redact', rect: zone }] }]);
  const r = core.open(out);
  const text = core.pageText(r.docId, 0);

  t('redactar elimina del archivo el texto de la zona', () => {
    assert.ok(!text.includes('Juan'), text);
    assert.ok(!text.includes('Pérez'), text);
    assert.ok(!new TextDecoder('latin1').decode(out).includes('Juan'));
  });
  t('redactar conserva el resto de la línea y de la página', () => {
    assert.ok(text.includes('Nombre:'), text);
    assert.ok(text.includes('García'), text);
    assert.ok(text.includes('Importe total: 1.250 euros'));
  });
  t('lo que queda de la línea sigue en su sitio (mismo origen, al 0,1 pt)', () => {
    for (const ch of ['G', 'N', 's']) {
      const [ox, oy] = charOrigin(T.docId, ch);
      const [nx, ny] = charOrigin(r.docId, ch);
      assert.ok(Math.hypot(nx - ox, ny - oy) < 0.1, `«${ch}» se movió de ${ox},${oy} a ${nx},${ny}`);
    }
  });
  t('la zona queda tapada en negro', () => {
    const img = core.render(r.docId, 0, 1);
    const x = Math.round(((zone[0] + zone[2]) / 2) * img.width);
    const y = Math.round(((zone[1] + zone[3]) / 2) * img.height);
    assert.ok(img.pixels[(y * img.width + x) * 4] < 20);
    assert.deepEqual(core.warnings, []);
  });
  core.close(r.docId);
}

{
  // Imagen roja de 100 x 100 px: se redacta su mitad izquierda.
  const red = { width: 100, height: 100, pixels: new Uint8ClampedArray(100 * 100 * 4) };
  for (let i = 0; i < red.pixels.length; i += 4) red.pixels.set([220, 30, 30, 255], i);
  const withImg = core.open(core.compose([{ docId: a.docId, index: 0, rot: 0, annots: [{ type: 'image', rect: [0.2, 0.5, 0.6, 0.7], k: 0, image: red }] }]));
  const out = core.compose([{ docId: withImg.docId, index: 0, rot: 0, annots: [{ type: 'redact', rect: [0.1, 0.45, 0.4, 0.75] }] }]);
  const r = core.open(out);
  // Leer los píxeles de la imagen guardada (no lo que se ve encima).
  const e = core.entry(r.docId);
  const page = pdfium.FPDF_LoadPage(e.handle, 0);
  let sample = null;
  for (let i = 0; i < pdfium.FPDFPage_CountObjects(page); i++) {
    const o = pdfium.FPDFPage_GetObject(page, i);
    if (pdfium.FPDFPageObj_GetType(o) !== 3) continue;
    const bmp = pdfium.FPDFImageObj_GetBitmap(o);
    const buf = pdfium.FPDFBitmap_GetBuffer(bmp);
    const stride = pdfium.FPDFBitmap_GetStride(bmp);
    const bpp = { 1: 1, 2: 3, 3: 4, 4: 4 }[pdfium.FPDFBitmap_GetFormat(bmp)];
    const px = (x, y) => [...pdfium.pdfium.HEAPU8.slice(buf + y * stride + x * bpp, buf + y * stride + x * bpp + 3)];
    sample = { left: px(10, 50), right: px(90, 50) };
    pdfium.FPDFBitmap_Destroy(bmp);
  }
  pdfium.FPDF_ClosePage(page);
  t('redactar sobre una imagen cambia sus píxeles, no solo los tapa', () => {
    assert.ok(sample, 'la imagen debería seguir en la página');
    assert.deepEqual(sample.left, [0, 0, 0]);
    assert.ok(sample.right[2] > 150 && sample.right[0] < 80, `derecha ${sample.right}`); // BGR: rojo
  });
  core.close(r.docId);
  core.close(withImg.docId);
}

{
  // Una nota que ya estaba en el PDF y cae en la zona se elimina.
  const withNote = core.open(core.compose([{ docId: a.docId, index: 0, rot: 0, annots: [{ type: 'note', at: [0.5, 0.5], text: 'secreto' }] }]));
  const out = core.compose([{ docId: withNote.docId, index: 0, rot: 0, annots: [{ type: 'redact', rect: [0.45, 0.45, 0.6, 0.6] }] }]);
  t('redactar quita las notas que tocan la zona', () => {
    assert.ok(!/\/Subtype\s*\/Text/.test(new TextDecoder('latin1').decode(out)));
    assert.ok(!new TextDecoder('latin1').decode(out).includes('secreto'));
  });
  core.close(withNote.docId);
}

{
  // Firma y nota colocadas por el usuario encima de una zona: se borran con ella al guardar.
  const sigImg = { width: 40, height: 20, pixels: new Uint8ClampedArray(40 * 20 * 4).fill(255) };
  const out = core.compose([{ docId: a.docId, index: 0, rot: 0, annots: [
    { type: 'image', rect: [0.5, 0.5, 0.7, 0.6], k: 0, image: sigImg },
    { type: 'note', at: [0.3, 0.3], text: 'nota tapada' },
    { type: 'redact', rect: [0.25, 0.25, 0.75, 0.65] },
  ] }]);
  const r = core.open(out);
  const img = core.render(r.docId, 0, 1);
  const at = (u, v) => img.pixels[(Math.round(v * img.height) * img.width + Math.round(u * img.width)) * 4];
  t('lo que el usuario puso encima de una zona también se borra (firma y nota)', () => {
    assert.ok(at(0.6, 0.55) < 20, 'la firma no debería verse sobre el negro');
    assert.ok(!new TextDecoder('latin1').decode(out).includes('nota tapada'));
  });
  core.close(r.docId);
}

t('redactar sobre un campo de formulario lo elimina con su valor, y avisa', () => {
  const F2 = core.open(F);
  const fields = core.fields(F2.docId, 0);
  const field = byName(fields, 'nombre');
  const out = core.compose([{
    docId: F2.docId, index: 0, rot: 0,
    fields: { [field.annotIndex]: 'Valor secreto' },
    annots: [{ type: 'redact', rect: field.rect }],
  }]);
  assert.ok(core.warnings.some((w) => /se eliminó un campo de formulario/.test(w)), core.warnings.join(' '));
  assert.deepEqual(scanWord(parsePdf(out), 'secreto'), []);
  core.close(F2.docId);
});

core.close(T.docId);

// --- Prueba forense de la redacción (bytes del archivo guardado) ---------------------------
console.log('  prueba forense de la redacción («trazabilidad» en contrato.pdf):');
{
  const WORD = 'trazabilidad';
  // contrato.pdf con todo lo que podría delatar la palabra fuera del contenido de la página.
  const src = await PDFDocument.load(await contrato()); // el mismo generador que test/fixtures/contrato.pdf
  const bold = await src.embedFont(StandardFonts.HelveticaBold);
  const p4 = src.getPage(3); // «Calidad y trazabilidad», título a 24 pt en (60, 760)
  const x0 = 60 + bold.widthOfTextAtSize('Calidad y ', 24);
  const x1 = 60 + bold.widthOfTextAtSize('Calidad y trazabilidad', 24);
  src.setTitle('Informe de trazabilidad');
  src.setSubject('Calidad y trazabilidad');
  src.setKeywords([WORD, 'lotes']);
  src.setAuthor('Diego');
  const xmp = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Informe de trazabilidad</dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  src.catalog.set(PDFName.of('Metadata'), src.context.register(src.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
  const ctx = src.context;
  const [outl, b1, b2] = [ctx.nextRef(), ctx.nextRef(), ctx.nextRef()];
  ctx.assign(b1, ctx.obj({ Title: PDFHexString.fromText('Contrato de suministro'), Parent: outl, Next: b2, Dest: [src.getPage(0).ref, 'Fit'] }));
  ctx.assign(b2, ctx.obj({ Title: PDFHexString.fromText('Calidad y trazabilidad'), Parent: outl, Prev: b1, Dest: [p4.ref, 'Fit'] }));
  ctx.assign(outl, ctx.obj({ Type: 'Outlines', First: b1, Last: b2, Count: 2 }));
  src.catalog.set(PDFName.of('Outlines'), outl);
  const form = src.getForm();
  const inZone = form.createTextField('lote');
  inZone.addToPage(p4, { x: x0 + 4, y: 758, width: 120, height: 20 });
  inZone.setText(`lote ${WORD} 42`);
  const outZone = form.createTextField('fuera');
  outZone.addToPage(p4, { x: 60, y: 300, width: 200, height: 20 });
  outZone.setText('fuera de la zona');
  const note = (rect, contents) => p4.node.addAnnot(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: rect, Contents: PDFString.of(contents), F: 4 })));
  note([x0 + 130, 760, x0 + 150, 780], `nota sobre ${WORD}`);
  note([400, 200, 420, 220], 'otra nota');
  const red = await src.embedPng(pngRGB(100, 100, () => [220, 30, 30]));
  p4.drawImage(red, { x: 300, y: 400, width: 100, height: 100 });
  const input = await src.save(); // con flujos de objetos, como muchos PDF reales

  const C = core.open(input);
  const toFrac = ([ax, ay, bx, by]) => [ax / 595, (842 - by) / 842, bx / 595, (842 - ay) / 842];
  const zoneWord = toFrac([x0 - 1, 752, x1 + 1, 790]);  // la palabra, el campo «lote» y la nota de dentro
  const zoneImg = toFrac([280, 380, 350, 520]);          // la mitad izquierda de la imagen
  const refs = C.pages.map((_, i) => ({ docId: C.docId, index: i, rot: 0 }));
  refs[3].annots = [{ type: 'redact', rect: zoneWord }, { type: 'redact', rect: zoneImg }];
  const out = core.compose(refs);
  const parsed = parsePdf(out);

  // Antes de redactar, la palabra sí está (si no, la prueba no probaría nada).
  t('  · control: el original contiene la palabra en contenido, metadatos, XMP, marcadores, campo y nota', () => {
    const before = scanWord(parsePdf(input), WORD);
    assert.ok(before.length >= 3, JSON.stringify(before));
  });

  t('  · 1. ningún flujo (descomprimido, referenciado o no) ni objeto contiene la palabra en ninguna codificación', () => {
    const found = scanWord(parsed, WORD);
    assert.deepEqual(found, [], `aparece en: ${JSON.stringify(found)}`);
  });

  t('  · 2. sin objetos huérfanos ni guardados incrementales', () => {
    const orphans = unreachable(parsed);
    assert.deepEqual(orphans, [], `huérfanos: ${JSON.stringify(orphans)}`);
    assert.equal((parsed.text.match(/%%EOF/g) ?? []).length, 1, 'más de una sección %%EOF');
    assert.equal((parsed.text.match(/startxref/g) ?? []).length, 1, 'más de un startxref');
  });

  const R = core.open(out);
  const h = core.doc(R.docId);
  const meta = (key) => core.readWide((p, len) => pdfium.FPDF_GetMetaText(h, key, p, len));
  const titles = [];
  for (let bm = pdfium.FPDFBookmark_GetFirstChild(h, 0); bm; bm = pdfium.FPDFBookmark_GetNextSibling(h, bm)) {
    titles.push(core.readWide((p, len) => pdfium.FPDFBookmark_GetTitle(bm, p, len)));
  }

  t('  · 3a. metadatos: lo que contenía la palabra desaparece; el resto se conserva', () => {
    for (const k of ['Title', 'Subject', 'Keywords']) assert.ok(!meta(k).toLowerCase().includes(WORD), `${k}: ${meta(k)}`);
    assert.equal(meta('Author'), 'Diego');
    assert.ok(!/\/Metadata\b/.test(parsed.text) || !scanWord(parsed, WORD).length);
  });

  t('  · 3b. marcadores: se quita el que nombraba la palabra; el otro sigue', () => {
    assert.deepEqual(titles, ['Contrato de suministro']);
  });

  t('  · 3c. campos y notas: los de la zona desaparecen; los de fuera siguen (el campo, visible)', () => {
    assert.ok(core.pageText(R.docId, 3).includes('fuera de la zona'), core.pageText(R.docId, 3));
    assert.ok(new TextDecoder('latin1').decode(out).includes('otra nota') || [...parsed.objects.values()].some((o) => o.dict.includes('otra nota')));
  });

  t('  · 4. la imagen guardada tiene esos píxeles sobrescritos y no queda ninguna copia original', () => {
    const images = [...parsed.objects.values()].filter((o) => /\/Subtype\s*\/Image/.test(o.dict) && /\/Width\s+100\b/.test(o.dict) && /\/Height\s+100\b/.test(o.dict));
    assert.ok(images.length >= 1, 'debería quedar la imagen');
    for (const img of images) {
      const d = img.decoded;
      assert.equal(d.length >= 30000, true, `datos de ${d.length} bytes`);
      const px = (x, y) => [...d.subarray((y * 100 + x) * 3, (y * 100 + x) * 3 + 3)];
      assert.deepEqual(px(10, 50), [0, 0, 0], 'la parte tapada debe ser negra en la propia imagen');
      assert.deepEqual(px(90, 50), [220, 30, 30], 'la parte libre se conserva');
    }
  });

  core.close(R.docId);
  core.close(C.docId);

  // El mismo documento protegido (abrir + permisos, sin imprimir ni copiar): la copia redactada sigue protegida
  // con la misma configuración. La redacción crea un PDF nuevo; qpdf le copia la protección del original.
  console.log('  redactar un PDF protegido con contraseña:');
  const P = core.open(input);
  const PERMS = permsFor({ print: false, copy: false, edit: true });
  pdfium.EPDF_SetEncryption(core.doc(P.docId), 'abrir-ñ1', 'dueño-ñ2', PERMS);
  const locked = core.save(core.doc(P.docId));
  core.close(P.docId);
  for (const pw of ['abrir-ñ1', 'dueño-ñ2']) {
    const E = core.open(locked, pw);
    const raw = core.compose(E.pages.map((_, i) => ({ docId: E.docId, index: i, rot: 0, annots: i === 3 ? [{ type: 'redact', rect: zoneWord }] : undefined })));
    const post = core.post;
    const saved = await finishWithQpdf(async () => qpdf, raw, post);
    const plain = await qpdf.run(['--decrypt', '--password=abrir-ñ1', '/in.pdf', '/out.pdf'], { 'in.pdf': saved }, 'out.pdf');
    const opened = (p) => { try { const r = core.open(saved, p); core.close(r.docId); return r.security; } catch (e) { return e.wrongPassword ? 'incorrecta' : e.message; } };
    t(`  · abierto con la contraseña ${pw.startsWith('abrir') ? 'de abrir' : 'de permisos'}: la copia pide contraseña y tiene las mismas`, () => {
      assert.ok(post?.copyEncryption, 'compose deja a qpdf copiar la protección');
      assert.equal(core.open(raw).security.encrypted, false, 'sin qpdf saldría sin proteger (por eso se copia)');
      assert.match(opened(''), /protegido/);
      assert.equal(opened('otra'), 'incorrecta');
      const u = opened('abrir-ñ1');
      const o = opened('dueño-ñ2');
      assert.deepEqual([u.encrypted, u.revision, u.owner, u.perms], [true, 6, false, PERMS], 'contraseña de abrir: mismos permisos');
      assert.deepEqual([o.owner, o.userPerms], [true, PERMS], 'contraseña de permisos: todo permitido');
      assert.match(Buffer.from(saved).toString('latin1'), /\/AESV3/, 'AES-256');
    });
    t('  · descifrada, no contiene la palabra en ningún sitio ni objetos huérfanos', () => {
      const parsedPlain = parsePdf(plain);
      assert.deepEqual(scanWord(parsedPlain, WORD), []);
      assert.deepEqual(unreachable(parsedPlain), []);
      assert.ok(scanWord(parsePdf(input), WORD).length > 0, 'control: el original sí la tiene');
    });
    core.close(E.docId);
  }
}

// --- Reducir tamaño ---------------------------------------------------------------------------------
console.log('  reducir tamaño:');
{
  const encode = async (rgba, w, h, q) => new Uint8Array(jpegjs.encode({ data: rgba, width: w, height: h }, Math.round(q * 100)).data);
  // Foto «ruidosa» de 2000×1500 (a 500 ppp en la página) en dos páginas; un PNG con transparencia grande; texto y un
  // rectángulo (vector) que no deben cambiar ni un píxel.
  const W = 2000;
  const H = 1500;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const photo = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W; const y = (i / W) | 0;
    photo[i * 4] = (x * 255 / W + rnd() * 40) | 0; photo[i * 4 + 1] = (y * 255 / H) | 0; photo[i * 4 + 2] = (x ^ y) & 255; photo[i * 4 + 3] = 255;
  }
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const img = await doc.embedJpg(jpegjs.encode({ data: photo, width: W, height: H }, 95).data);
  const alpha = await doc.embedPng(pngRGB(1200, 1200, (x, y) => [x % 256, y % 256, 90, (x + y) % 256], 4));
  for (let p = 0; p < 2; p++) {
    const pg = doc.addPage([595, 842]);
    pg.drawText(`Texto que no cambia ${p + 1}`, { x: 60, y: 780, size: 18, font });
    pg.drawRectangle({ x: 60, y: 700, width: 200, height: 40, borderColor: rgb(0.8, 0.1, 0.1), borderWidth: 2 });
    pg.drawImage(img, { x: 80, y: 300, width: 288, height: 216 });
    if (p === 1) pg.drawImage(alpha, { x: 400, y: 60, width: 144, height: 144 });
  }
  const input = await doc.save();
  const sizes = {};
  for (const level of ['high', 'balanced', 'small']) sizes[level] = (await reducePdf(core, input, { level, encode, qpdf })).bytes;
  const out = sizes.balanced;
  const parsed = parsePdf(out);
  // Diccionarios de imagen con ese ancho, buscados en el texto del archivo (los de flujos nunca van en /ObjStm).
  const widthCount = (bytes, w) => (Buffer.from(bytes).toString('latin1').match(new RegExp(`/Width\\s+${w}\\b`, 'g')) ?? []).length;

  t('el archivo baja de verdad (más en cada nivel) y no quedan las imágenes originales sueltas', () => {
    assert.ok(out.length < input.length / 3, `${input.length} → ${out.length}`); // el PNG con transparencia se queda
    assert.ok(sizes.small.length < sizes.balanced.length && sizes.balanced.length < sizes.high.length, JSON.stringify(Object.values(sizes).map((b) => b.length)));
    assert.equal(widthCount(input, 2000), 1, 'control: el original tiene la foto de 2000 px');
    assert.equal(widthCount(out, 2000), 0, 'ninguna imagen de 2000 px en el resultado');
    assert.deepEqual(unreachable(parsed), [], 'sin objetos sueltos');
    assert.match(parsed.text, /\/ObjStm/, 'con flujos de objetos');
  });
  const A = core.open(input);
  const B = core.open(out);
  t('texto y vectores, idénticos píxel a píxel; la foto, a 150 ppp y parecida; la imagen con transparencia, intacta', () => {
    assert.equal(B.pages.length, 2);
    for (let i = 0; i < 2; i++) {
      assert.equal(core.pageText(B.docId, i), core.pageText(A.docId, i));
      const a = core.render(A.docId, i, 1, 0);
      const b = core.render(B.docId, i, 1, 0);
      // Franja superior (texto y rectángulo): y de 0 a 150 pt desde arriba.
      const top = (r) => Buffer.from(r.pixels.subarray(0, r.width * 150 * 4));
      assert.equal(Buffer.compare(top(a), top(b)), 0, `página ${i + 1}: texto o rectángulo cambiaron`);
      let diff = 0; let n = 0;
      for (let y = 842 - 516; y < 842 - 300; y++) for (let x = 80; x < 368; x++) { const k = (y * a.width + x) * 4; diff += Math.abs(a.pixels[k] - b.pixels[k]); n++; }
      assert.ok(diff / n < 12, `página ${i + 1}: la foto cambió demasiado (${(diff / n).toFixed(1)})`);
    }
    assert.equal(widthCount(out, 1200), 2, 'el PNG con transparencia (y su SMask) siguen a 1200 px');
    const pg = core.openPage(core.entry(B.docId), 0);
    try {
      for (let k = 0; k < pdfium.FPDFPage_CountObjects(pg); k++) {
        const o = pdfium.FPDFPage_GetObject(pg, k);
        if (pdfium.FPDFPageObj_GetType(o) !== 3) continue;
        const px = core.withMem(8, (q) => { pdfium.FPDFImageObj_GetImagePixelSize(o, q, q + 4); return core.rt.getValue(q, 'i32'); });
        assert.equal(px, 600, '2000 px a 500 ppp → 600 px a 150 ppp');
      }
    } finally { core.closePage(core.entry(B.docId), pg); }
  });
  core.close(A.docId); core.close(B.docId);

  // Protegido: se reduce con la contraseña de abrir y sigue protegido igual.
  const P = core.open(input);
  const PERMS = permsFor({ print: false });
  const locked = core.compose(P.pages.map((_, i) => ({ docId: P.docId, index: i, rot: 0 })), null, { security: { user: 'abrir', owner: 'dueño', perms: PERMS } });
  core.close(P.docId);
  const lockedOut = (await reducePdf(core, locked, { level: 'balanced', passwords: ['', 'abrir'], encode, qpdf })).bytes;
  t('protegido: se reduce y conserva la misma protección', () => {
    assert.ok(lockedOut.length < locked.length / 3, `${locked.length} → ${lockedOut.length}`);
    assert.throws(() => core.open(lockedOut), (e) => e.needsPassword);
    const r = core.open(lockedOut, 'abrir');
    assert.equal(r.security.perms, PERMS);
    assert.equal(core.open(lockedOut, 'dueño').security.owner, true);
    core.close(r.docId);
  });
  const plain = await contrato();
  const r = await reducePdf(core, plain, { level: 'small', encode, qpdf });
  t('un PDF sin imágenes que reducir: no se reduce ninguna y nunca crece', () => {
    assert.equal(r.reduced, 0);
    assert.ok(r.bytes.length <= plain.length);
  });
}

// --- Compartir: «Quitar información oculta» ------------------------------------------------------
console.log('  quitar información oculta (compartir):');
{
  const src = await PDFDocument.load(await contrato());
  src.setTitle('Título secreto');
  src.setAuthor('Autor secreto');
  const ctx = src.context;
  const p1 = src.getPage(0);
  p1.node.addAnnot(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 200, 420, 220], Contents: PDFString.of('nota oculta'), F: 4 })));
  const form = src.getForm();
  const f = form.createTextField('campo');
  f.addToPage(p1, { x: 60, y: 300, width: 200, height: 20 });
  f.setText('valor visible');
  await src.attach(new TextEncoder().encode('adjunto secreto'), 'adjunto.txt', { mimeType: 'text/plain' });
  const input = await src.save();
  const H = core.open(input);
  const refs = H.pages.map((_, i) => ({ docId: H.docId, index: i, rot: 0 }));
  const plain = core.compose(refs);
  const clean = core.compose(refs, null, { hidden: true });
  const C = core.open(clean);
  const hC = core.doc(C.docId);
  const meta = (h, key) => core.readWide((p, len) => pdfium.FPDF_GetMetaText(h, key, p, len));
  t('sin la opción, todo sigue (control)', () => {
    const text = Buffer.from(plain).toString('latin1');
    assert.ok(text.includes('nota oculta') || scanWord(parsePdf(plain), 'nota oculta').length);
  });
  t('metadatos, notas y adjuntos fuera; lo que se ve no cambia (el campo queda como texto)', () => {
    assert.equal(meta(hC, 'Title'), '');
    assert.equal(meta(hC, 'Author'), '');
    const parsed = parsePdf(clean);
    for (const w of ['secreto', 'nota oculta']) assert.deepEqual(scanWord(parsed, w), [], w);
    assert.ok(!/\/EmbeddedFiles|\/AcroForm/.test(parsed.text));
    assert.deepEqual(unreachable(parsed), []);
    assert.ok(core.pageText(C.docId, 0).includes('valor visible'));
    assert.equal(C.pages.length, H.pages.length);
    for (let i = 0; i < 2; i++) {
      const a1 = core.render(H.docId, i, 0.5, 0).pixels;
      const a2 = core.render(C.docId, i, 0.5, 0).pixels;
      let diff = 0;
      for (let k = 0; k < a1.length; k += 4) if (Math.abs(a1[k] - a2[k]) > 40) diff++;
      // La nota se dibuja como icono en el original; fuera de eso, igual.
      assert.ok(diff < a1.length / 4 / 200, `página ${i + 1}: ${diff} píxeles distintos`);
    }
  });
  core.close(C.docId);
  core.close(H.docId);
}

// --- Contraseñas: abrir, proteger, quitar, permisos --------------------------------------------
console.log('  contraseñas:');
{
  const plain = await contrato();
  const base = core.open(plain);
  t('un PDF sin proteger: security sin cifrado y todo permitido', () => {
    assert.deepEqual(base.security, { encrypted: false, revision: -1, owner: false, perms: ALL_PERMS, userPerms: ALL_PERMS });
  });
  const PERMS = permsFor({ print: false, copy: true, edit: false });
  const refs = (d) => d.pages.map((_, i) => ({ docId: d.docId, index: i, rot: 0 }));
  const prot = core.compose(refs(base), null, { security: { user: 'abrir', owner: 'permisos', perms: PERMS } });
  const protPost = core.post;
  const prot2 = await finishWithQpdf(async () => qpdf, prot, protPost);

  t('proteger: AES-256 (revisión 6), sin texto en claro; qpdf reescribe y la protección sigue igual', () => {
    for (const bytes of [prot, prot2]) {
      const txt = Buffer.from(bytes).toString('latin1');
      assert.match(txt, /\/V 5/);
      assert.match(txt, /\/AESV3/);
      const r = core.open(bytes, 'abrir');
      assert.equal(r.security.revision, 6);
      assert.equal(r.security.perms, PERMS);
      assert.ok(core.pageText(r.docId, 0).includes('Contrato de suministro'));
      core.close(r.docId);
    }
  });
  t('abrir: sin contraseña pide una; mal, «incorrecta»; bien, abre', () => {
    assert.throws(() => core.open(prot2), (e) => e.needsPassword && !e.wrongPassword && /protegido con contraseña/.test(e.message));
    assert.throws(() => core.open(prot2, 'mal'), (e) => e.needsPassword && e.wrongPassword && e.message === 'La contraseña no es correcta.');
    const r = core.open(prot2, 'abrir');
    assert.deepEqual([r.security.encrypted, r.security.owner], [true, false]);
    core.close(r.docId);
  });
  t('permisos: con la de abrir valen las restricciones; con la de permisos, todo', () => {
    const u = core.open(prot2, 'abrir');
    assert.deepEqual(permsPolicy(u.security), { pages: false, content: false, annots: false, forms: false, print: false, copy: true });
    assert.equal(core.unlockOwner(u.docId, 'mal').unlocked, false);
    const un = core.unlockOwner(u.docId, 'permisos');
    assert.deepEqual([un.unlocked, un.owner, un.perms], [true, true, ALL_PERMS]);
    assert.equal(permsPolicy(un), null);
    core.close(u.docId);
    const o = core.open(prot2, 'permisos');
    assert.equal(o.security.owner, true);
    core.close(o.docId);
  });
  t('guardar un protegido sin tocar la protección: la conserva (también abierto con la de abrir)', () => {
    const u = core.open(prot2, 'abrir');
    const out = core.compose(refs(u).map((r, i) => (i === 0 ? { ...r, rot: 1 } : r)));
    assert.equal(core.post, null);
    assert.throws(() => core.open(out), (e) => e.needsPassword);
    const r = core.open(out, 'abrir');
    assert.equal(r.security.perms, PERMS);
    assert.equal(core.open(out, 'permisos').security.owner, true);
    core.close(r.docId); core.close(u.docId);
  });
  const u = core.open(prot2, 'permisos');
  const removed = await finishWithQpdf(async () => qpdf, core.compose(refs(u), null, { security: { remove: true } }), core.post);
  core.close(u.docId);
  t('quitar la contraseña: abre sin ella y no queda diccionario de cifrado', () => {
    const r = core.open(removed);
    assert.equal(r.security.encrypted, false);
    assert.ok(!/\/Encrypt|\/AESV3/.test(Buffer.from(removed).toString('latin1')));
    assert.ok(core.pageText(r.docId, 0).includes('Contrato de suministro'));
    core.close(r.docId);
  });
  t('permisos al proteger: sin imprimir se quitan los dos bits (si no, PDFium vuelve a activar imprimir)', () => {
    const p = permsFor({ print: false });
    assert.equal(p & (PERM.print | PERM.printHigh), 0);
    const bytes = core.compose(refs(base), null, { security: { user: 'x1234', owner: 'y1234', perms: p } });
    const r = core.open(bytes, 'x1234');
    assert.equal(r.security.perms, p);
    assert.equal(permsPolicy(r.security).print, false);
    core.close(r.docId);
  });
  t('la contraseña no aparece en el PDF (ni en claro ni en UTF-16)', () => {
    for (const bytes of [prot, prot2, removed]) {
      const s = Buffer.from(bytes);
      for (const pw of ['abrir', 'permisos']) {
        assert.equal(s.indexOf(Buffer.from(pw, 'latin1')), -1);
        assert.equal(s.indexOf(Buffer.from(pw, 'utf16le')), -1);
      }
    }
  });
  core.close(base.docId);
}

// --- Texto de la página: caracteres con su caja y búsqueda ---------------------------------
console.log('  texto de la página (seleccionar y buscar):');
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const write = (p) => {
    p.drawText('Razón social: Ribera Norte', { x: 60, y: 700, size: 12, font });
    p.drawText('Importe total', { x: 60, y: 680, size: 12, font });
  };
  write(doc.addPage([595, 842]));
  const rotated = doc.addPage([595, 842]);
  write(rotated);
  rotated.setRotation(degrees(90));
  const scan = doc.addPage([595, 842]);
  scan.drawImage(await doc.embedPng(pngRGB(40, 40, (x, y) => ((x + y) % 7 ? [240, 240, 240] : [30, 30, 30]))), { x: 0, y: 0, width: 595, height: 842 });
  const D = core.open(await doc.save());
  const c0 = core.textChars(D.docId, 0);
  const box = (c, i) => [...c.boxes.subarray(i * 4, i * 4 + 4)];

  t('extrae el texto con la caja de cada carácter en fracciones sin rotar', () => {
    assert.ok(c0.text.includes('Razón social: Ribera Norte'));
    assert.equal(c0.boxes.length, c0.text.length * 4);
    const [u0, , , v1] = box(c0, c0.text.indexOf('R'));
    assert.ok(Math.abs(u0 - 60 / 595) < 0.004, `u0 ${u0}`);
    assert.ok(Math.abs(v1 - (842 - 700) / 842) < 0.006, `v1 ${v1}`); // la base de la «R» está en la línea base
    assert.equal(c0.hasText, true);
  });

  t('en una página girada las cajas son las mismas (sin rotar); el orden de lectura puede cambiar', () => {
    const c1 = core.textChars(D.docId, 1);
    for (const word of ['Razón', 'Importe']) {
      const i0 = c0.text.indexOf(word);
      const i1 = c1.text.indexOf(word);
      assert.ok(i1 >= 0, `falta «${word}»`);
      for (let k = 0; k < word.length; k++) {
        box(c0, i0 + k).forEach((x, j) => assert.ok(Math.abs(x - box(c1, i1 + k)[j]) < 1e-4, `«${word}»[${k}]`));
      }
    }
  });

  t('marca los caracteres que añade PDFium entre líneas', () => {
    const nl = c0.text.indexOf('\n');
    assert.ok(nl > 0 && c0.generated[nl] === 1);
    assert.equal(c0.generated[c0.text.indexOf('R')], 0);
  });

  t('una página que es solo imagen no tiene texto', () => {
    assert.equal(core.textChars(D.docId, 2).hasText, false);
    assert.equal(core.searchPage(D.docId, 2, 'razon').hasText, false);
  });

  t('buscar: «razon» encuentra «Razón», con su rectángulo', () => {
    const r = core.searchPage(D.docId, 0, 'RAZON');
    assert.equal(r.matches.length, 1);
    const [m] = r.matches;
    assert.equal(c0.text.slice(m.start, m.end), 'Razón');
    assert.equal(m.rects.length, 1);
    assert.ok(Math.abs(m.rects[0][0] - 60 / 595) < 0.004);
  });

  t('buscar a través de un salto de línea da un rectángulo por línea', () => {
    const [m] = core.searchPage(D.docId, 0, 'norte importe').matches;
    assert.equal(m.rects.length, 2);
    assert.ok(m.rects[1][1] > m.rects[0][1]);
  });

  core.close(D.docId);
}

// --- Abrir con avance y cancelación; avance al guardar -----------------------------------
console.log('  avance al abrir y al guardar:');
{
  const big = await PDFDocument.create();
  for (let i = 0; i < 60; i++) big.addPage([300, 400]);
  const bigBytes = await big.save();

  const steps = [];
  const r = await core.openAsync(bigBytes, '', { onProgress: (p) => steps.push(p), every: 25 });
  t('abrir informa del avance por páginas y termina en el total', () => {
    assert.deepEqual(steps, [{ done: 25, total: 60 }, { done: 50, total: 60 }, { done: 60, total: 60 }]);
    assert.equal(r.pages.length, 60);
    assert.equal(r.hasForm, false);
  });

  let asked = 0;
  await assert.rejects(
    core.openAsync(bigBytes, '', { every: 10, isCancelled: () => ++asked >= 2 }),
    (e) => e.cancelled === true,
  );
  t('abrir se puede cancelar y no deja el documento abierto', () => {
    assert.equal(core.docs.size, [...core.docs.keys()].filter((id) => id <= r.docId).length);
  });

  console.log('  ok - abrir detecta el formulario sin leer todos los campos'); passed++;
  const withForm = await core.openAsync(F);
  assert.equal(withForm.hasForm, true);
  core.close(withForm.docId);

  const progress = [];
  core.compose(r.pages.map((_, i) => ({ docId: r.docId, index: i, rot: 0 })), (p) => progress.push(p));
  t('guardar informa del avance por páginas', () => {
    assert.equal(progress.at(-1).done, 60);
    assert.equal(progress.at(-1).total, 60);
    assert.ok(progress.length >= 60);
  });
  core.close(r.docId);
}

core.close(f.docId);

console.log('  marcadores (índice):');
{
  const I = core.open(await indice());
  const titles = (nodes) => nodes.map((n) => [n.title, n.pageIndex, titles(n.children)]);
  const readBack = (bytes) => { const r = core.open(bytes); const tree = core.readOutline(core.doc(r.docId)); core.close(r.docId); return tree; };

  t('lee el índice anidado: título, página y hijos (un enlace externo no lleva a página)', () => {
    const tree = core.bookmarks(I.docId);
    assert.deepEqual(titles(tree), [
      ['1. Introducción', 0, [['1.1 Objetivo', 0, []], ['1.2 Alcance', 1, []]]],
      ['2. Propuesta', 2, [['2.1 Fases', 3, [['Fase A: análisis', 3, []], ['Fase B: implantación', 4, []]]]]],
      ['3. Presupuesto y condiciones', 5, []],
      ['Web del proyecto', -1, []],
    ]);
    assert.ok(!('view' in tree[0]), 'la vista es interna del motor');
  });

  t('un PDF sin índice devuelve una lista vacía', () => assert.deepEqual(core.bookmarks(a.docId), []));

  t('reordenar sin eliminar conserva el índice original tal cual (también el enlace externo)', () => {
    const order = [5, 4, 3, 2, 1, 0];
    const tree = readBack(core.compose(order.map((index) => ({ docId: I.docId, index, rot: 0 }))));
    assert.deepEqual(titles(tree)[0], ['1. Introducción', 5, [['1.1 Objetivo', 5, []], ['1.2 Alcance', 4, []]]]);
    assert.equal(tree[3].title, 'Web del proyecto');
  });

  t('tras eliminar una página: cada marcador a su nueva posición, el de la página eliminada fuera y la vista XYZ intacta', () => {
    const order = [2, 3, 0, 1, 5]; // sin «Fase B» (índice 4)
    const tree = readBack(core.compose(order.map((index) => ({ docId: I.docId, index, rot: 0 }))));
    assert.deepEqual(titles(tree), [
      ['1. Introducción', 2, [['1.1 Objetivo', 2, []], ['1.2 Alcance', 3, []]]],
      ['2. Propuesta', 0, [['2.1 Fases', 1, [['Fase A: análisis', 1, []]]]]],
      ['3. Presupuesto y condiciones', 4, []],
    ]);
    assert.deepEqual(tree[0].children[0].view.xyz.slice(0, 4), [true, 0, true, 500]);
    assert.equal(tree[1].view.mode, 2); // «ajustar la página»
  });

  t('con varios PDFs unidos: un grupo por archivo con su nombre, que lleva a su primera página', () => {
    const refs = [
      { docId: a.docId, index: 0, rot: 0, source: 'Carta' },
      ...[0, 1, 2].map((index) => ({ docId: I.docId, index, rot: 0, source: 'Propuesta' })),
      { docId: a.docId, index: 1, rot: 0, source: 'Carta' },
    ];
    const tree = readBack(core.compose(refs));
    assert.deepEqual(titles(tree), [
      ['Carta', 0, []],
      ['Propuesta', 1, [
        ['1. Introducción', 1, [['1.1 Objetivo', 1, []], ['1.2 Alcance', 2, []]]],
        ['2. Propuesta', 3, []], // sus hijos llevaban a páginas que no se incluyen
      ]],
    ]);
  });
  core.close(I.docId);
}
{
  const doc = await PDFDocument.load(await indice());
  const ctx = doc.context;
  const root = ctx.lookup(doc.catalog.get(PDFName.of('Outlines')));
  const last = ctx.lookup(root.get(PDFName.of('Last')));
  last.set(PDFName.of('Next'), root.get(PDFName.of('First'))); // el último apunta al primero
  const C = core.open(await doc.save());
  t('  · ciclo: se lee cada marcador una sola vez', () => assert.equal(core.bookmarks(C.docId).length, 4));
  core.close(C.docId);
}

console.log('  PDFs firmados digitalmente:');
const plainContrato = await contrato();
{
  const cert = selfSignedCert();
  const signedBytes = await signPdf(await contrato(), cert);
  t('el generador de pruebas firma de verdad: certificado autofirmado y firma que cubre el archivo', () => {
    assert.ok(certIsSelfSigned(cert.certDer));
    assert.equal(signatureIntact(signedBytes), true);
    const tampered = signedBytes.slice();
    tampered[200] ^= 1; // un solo byte cambiado dentro de lo firmado
    assert.equal(signatureIntact(tampered), false);
  });

  const S = core.open(signedBytes);
  t('al abrir, detecta que el PDF tiene una firma digital', () => assert.equal(S.signed, 1));
  t('un PDF sin firmar no cuenta como firmado', () => {
    const N = core.open(plainContrato);
    assert.equal(N.signed, 0);
    core.close(N.docId);
  });
  core.close(S.docId);
}

console.log('  guardado incremental de un PDF firmado (test/fixtures/firmado.pdf):');
{
  const orig = new Uint8Array(await readFile('test/fixtures/firmado.pdf'));
  t('  · control: la firma del fixture verifica y cubre el archivo entero', () => {
    assert.equal(signatureIntact(orig), true, 'regenera el fixture: node test/make-fixtures.js');
    const [, , c, d] = byteRange(orig);
    assert.equal(c + d, orig.length);
  });
  const S = core.open(orig);
  const all = (extra = {}) => S.pages.map((_, i) => ({ docId: S.docId, index: i, rot: 0, ...(extra[i] ?? {}) }));
  const note = { type: 'note', at: [0.5, 0.5], text: 'Revisado', color: '#FFD400' };

  const inc = core.compose(all({ 1: { annots: [note, { type: 'highlight', rect: [0.1, 0.1, 0.5, 0.15], color: '#FFD400' }] } }));
  t('  · con una anotación se guarda en incremental: el archivo original queda intacto al principio', () => {
    assert.equal(core.incremental, true);
    assert.ok(inc.length > orig.length);
    assert.ok(Buffer.from(inc.subarray(0, orig.length)).equals(Buffer.from(orig)), 'los bytes firmados cambiaron');
  });
  t('  · el ByteRange original sigue cubriendo exactamente los bytes del archivo original y la firma verifica', () => {
    const [a, , c, d] = byteRange(inc);
    assert.equal(a, 0);
    assert.equal(c + d, orig.length);
    assert.equal(signatureIntact(inc), true);
  });
  t('  · la revisión nueva lleva la anotación y el PDF sigue firmado', () => {
    const R = core.open(inc);
    const page = pdfium.FPDF_LoadPage(core.doc(R.docId), 1);
    assert.equal(pdfium.FPDFPage_GetAnnotCount(page), 2);
    pdfium.FPDF_ClosePage(page);
    assert.equal(R.signed, 1);
    core.close(R.docId);
  });

  t('  · giros, texto editado y firma gráfica también van en incremental y la firma verifica', () => {
    const runs = core.textRuns(S.docId, 0);
    const title = runs.find((r) => r.text.includes('Contrato'));
    const sig = { type: 'image', rect: [0.6, 0.8, 0.8, 0.85], k: 0, image: { width: 2, height: 1, pixels: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]) } };
    const out = core.compose(all({ 0: { textEdits: { [title.objIndex]: { text: 'Contrato revisado', from: title.text } }, annots: [sig] }, 2: { rot: 1 } }));
    assert.equal(core.incremental, true);
    assert.equal(signatureIntact(out), true);
    const R = core.open(out);
    assert.ok(core.pageText(R.docId, 0).includes('Contrato revisado'));
    core.close(R.docId);
  });

  t('  · tras quitar una página hay que reescribir el archivo: la firma deja de verificar', () => {
    const out = core.compose(all().filter((r) => r.index !== 3));
    assert.equal(core.incremental, false);
    assert.equal(signatureIntact(out), false);
  });
  t('  · tras reordenar, igual', () => {
    const out = core.compose(all().reverse());
    assert.equal(core.incremental, false);
    assert.equal(signatureIntact(out), false);
  });
  t('  · un PDF sin firmar se sigue guardando entero (sin revisiones)', () => {
    const N = core.open(plainContrato);
    core.compose([{ docId: N.docId, index: 0, rot: 1 }]);
    assert.equal(core.incremental, false);
    core.close(N.docId);
  });
  core.close(S.docId);

  for (const p of [1, 2, 3]) {
    const C = core.open(await signPdf(plainContrato, undefined, { mdp: p }));
    t(`  · firma de certificación con DocMDP P=${p}: se detecta al abrir`, () => assert.equal(C.mdp, p));
    core.close(C.docId);
  }
  t('  · una firma normal (de aprobación) no certifica', () => {
    const N = core.open(orig);
    assert.equal(N.mdp, 0);
    core.close(N.docId);
  });
}

console.log('  páginas nuevas (insertar en blanco e imagen como página):');
{
  const blank = (width, height) => ({ docId: null, index: -1, rot: 0, create: { width, height } });
  // Imagen 4 × 2: mitad izquierda roja opaca, mitad derecha transparente.
  const px = new Uint8ClampedArray(4 * 2 * 4);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) px.set(x < 2 ? [220, 20, 20, 255] : [0, 0, 0, 0], (y * 4 + x) * 4);
  const imageRef = { docId: null, index: -1, rot: 0, create: { width: 400, height: 200, image: { width: 4, height: 2, pixels: px } } };
  const A3 = core.open(A);
  const sizes = (bytes) => { const r = core.open(bytes); const s = r.pages.map((p) => [Math.round(p.width), Math.round(p.height)]); return { r, s }; };

  t('una página en blanco entre dos del PDF, con su tamaño', () => {
    const { r, s } = sizes(core.compose([{ docId: A3.docId, index: 0, rot: 0 }, blank(300, 400), { docId: A3.docId, index: 1, rot: 0 }]));
    assert.deepEqual(s, [[595, 842], [300, 400], [595, 842]]);
    assert.equal(core.pageText(r.docId, 1).trim(), '');
    assert.ok(core.pageText(r.docId, 2).includes('A2'));
    core.close(r.docId);
  });

  t('imagen como página: la imagen ocupa la página y conserva la transparencia (se ve el blanco)', () => {
    const { r, s } = sizes(core.compose([imageRef, { docId: A3.docId, index: 2, rot: 0 }]));
    assert.deepEqual(s[0], [400, 200]);
    const img = core.render(r.docId, 0, 0.5);
    const at = (u, v) => [...img.pixels.slice((Math.floor(v * img.height) * img.width + Math.floor(u * img.width)) * 4, (Math.floor(v * img.height) * img.width + Math.floor(u * img.width)) * 4 + 3)];
    const [rr, gg, bb] = at(0.25, 0.5);
    assert.ok(rr > 180 && gg < 80 && bb < 80, `rojo esperado: ${[rr, gg, bb]}`);
    assert.deepEqual(at(0.75, 0.5), [255, 255, 255]);
    core.close(r.docId);
  });

  t('un documento hecho solo de páginas nuevas (sin ningún PDF de partida), con una nota y girada', () => {
    const out = core.compose([{ ...blank(595.28, 841.89), annots: [{ type: 'note', at: [0.5, 0.5], text: 'Hola' }] }, { ...imageRef, rot: 1 }]);
    const r = core.open(out);
    assert.equal(r.pages.length, 2);
    const p0 = pdfium.FPDF_LoadPage(core.doc(r.docId), 0);
    assert.equal(pdfium.FPDFPage_GetAnnotCount(p0), 1);
    pdfium.FPDF_ClosePage(p0);
    assert.deepEqual([Math.round(r.pages[1].width), Math.round(r.pages[1].height)], [200, 400]); // girada 90°
    core.close(r.docId);
  });

  const indiceBytes = await indice();
  t('insertar al principio de un PDF con índice: los marcadores se desplazan con sus páginas', () => {
    const I = core.open(indiceBytes);
    const out = core.compose([blank(595, 842), ...[0, 1, 2, 3, 4, 5].map((index) => ({ docId: I.docId, index, rot: 0 }))]);
    const R = core.open(out);
    const tree = core.bookmarks(R.docId);
    assert.deepEqual(tree.map((n) => n.pageIndex), [1, 3, 6, -1]);
    core.close(R.docId);
    core.close(I.docId);
  });

  t('en un PDF firmado, insertar una página obliga a reescribir (no incremental)', () => {
    const S = core.open(new Uint8Array(readFileSyncSafe('test/fixtures/firmado.pdf')));
    core.compose([...S.pages.map((_, index) => ({ docId: S.docId, index, rot: 0 })), blank(595, 842)]);
    assert.equal(core.incremental, false);
    core.close(S.docId);
  });
  core.close(A3.docId);
}

console.log('  texto nuevo (cuadros de texto):');
{
  // Fuentes incluidas y subconjunto, como en el worker.
  core.fontBytes = (key) => { const k = parseFamilyKey(key); return readFileSyncSafe(`node_modules/@expo-google-fonts/${fontFile(k.family, k.bold, k.italic)}`); };
  core.subsetFont = await createSubsetter(readFileSyncSafe('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'));
  const TEXT = 'Ñandú ¿€?';
  const box = (rect, text, style = {}, extra = {}) => ({
    id: `t${Math.random()}`, type: 'textbox', rect, k: 0, text,
    style: { pdf: null, usePdf: false, family: 'sans', size: 14, bold: false, italic: false, color: '#1f3a93', align: 'left', ...style },
    ...extra,
  });
  const runsOf = (bytes, i = 0) => { const r = core.open(bytes); const runs = core.textRuns(r.docId, i); const text = core.pageText(r.docId, i); core.close(r.docId); return { runs, text }; };
  const plain = core.open(plainContrato);
  const refsWith = (annots, page = 0) => plain.pages.map((_, index) => ({ docId: plain.docId, index, rot: 0, annots: index === page ? annots : undefined }));
  const base = core.compose(refsWith([]));

  t('fuente incluida (Inter): «Ñandú ¿€?» es texto real, se extrae igual y la fuente va en subconjunto', () => {
    const out = core.compose(refsWith([box([0.1, 0.5, 0.6, 0.55], TEXT)]));
    const { runs, text } = runsOf(out);
    assert.ok(text.includes(TEXT), text.slice(-80));
    const run = runs.find((r) => r.text.includes('Ñandú'));
    assert.match(run.fontName, /Inter/);
    assert.equal(run.color, '#1f3a93');
    assert.ok(Math.abs(run.ptSize - 14) < 0.1);
    assert.ok(out.length - base.length < 20_000, `la fuente debería ir en subconjunto: +${out.length - base.length} bytes`);
  });

  t('fuente del PDF (Helvetica, la del texto más cercano): se reutiliza y escribe «Ñandú ¿€?»', () => {
    const near = core.textRuns(plain.docId, 0).find((r) => r.fontName.includes('Helvetica') && !r.fontName.includes('Bold'));
    const style = defaultStyle(near);
    assert.equal(style.usePdf, true);
    assert.deepEqual(core.checkGlyphs(plain.docId, 0, near.objIndex, TEXT).missing, []);
    const { runs, text } = runsOf(core.compose(refsWith([box([0.1, 0.5, 0.6, 0.55], TEXT, style)])));
    assert.ok(text.includes(TEXT));
    assert.equal(runs.find((r) => r.text.includes('Ñandú')).fontName, near.fontName);
  });

  // Un PDF con Noto Serif incrustada en subconjunto: solo trae las letras de «Hola mundo».
  const sub = await PDFDocument.create();
  sub.registerFontkit(fontkit);
  const serif = await sub.embedFont(readFileSyncSafe('node_modules/@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf'), { subset: true });
  sub.addPage([595, 842]).drawText('Hola mundo', { x: 60, y: 760, size: 18, font: serif });
  const S = core.open(await sub.save());
  const run = core.textRuns(S.docId, 0)[0];
  const style = defaultStyle(run);

  t('fuente del PDF a la que le faltan letras: se detectan («ñ, ú, €»)', () => {
    assert.equal(style.family, 'serif');
    assert.deepEqual(core.checkGlyphs(S.docId, 0, run.objIndex, 'Hola ñandú €').missing, ['ñ', 'ú', '€']);
    assert.deepEqual(core.checkGlyphs(S.docId, 0, run.objIndex, 'mundo Hola').missing, []);
  });

  t('…y al guardar se usa la incluida más parecida (Noto Serif completa): el texto sale entero', () => {
    const out = core.compose([{ docId: S.docId, index: 0, rot: 0, annots: [box([0.1, 0.3, 0.8, 0.35], 'Hola ñandú €', style)] }]);
    const { text, runs } = runsOf(out);
    assert.ok(text.includes('Hola ñandú €'), text);
    assert.notEqual(runs.find((r) => r.text.includes('ñandú')).fontName, run.fontName);
  });

  t('…y si tiene todas las letras, se usa la del PDF', () => {
    const { runs } = runsOf(core.compose([{ docId: S.docId, index: 0, rot: 0, annots: [box([0.1, 0.3, 0.8, 0.35], 'mundo Hola', style)] }]));
    assert.equal(runs.find((r) => r.text.includes('mundo Hola')).fontName, run.fontName);
  });

  t('datos de la fuente para la vista previa: la incrustada sí, la estándar (Helvetica) no', () => {
    assert.ok(core.fontData(S.docId, 0, run.objIndex)?.length > 100);
    const helv = core.textRuns(plain.docId, 0)[0];
    assert.equal(core.fontData(plain.docId, 0, helv.objIndex), null);
  });
  core.close(S.docId);

  t('líneas: se parte por palabras al ancho del cuadro, centradas, dentro de la caja', () => {
    const rect = [0.2, 0.4, 0.5, 0.6];
    const txt = 'Las partes acuerdan las condiciones de suministro descritas en este documento';
    const { runs } = runsOf(core.compose(refsWith([box(rect, txt, { size: 12, align: 'center' })])));
    const lines = runs.filter((r) => r.fontName.includes('Inter')).sort((x, y) => x.rect[1] - y.rect[1]);
    assert.ok(lines.length >= 3, `${lines.length} líneas`);
    assert.equal(lines.map((l) => l.text).join(' '), txt);
    for (const l of lines) {
      assert.ok(l.rect[0] >= rect[0] - 0.002 && l.rect[2] <= rect[2] + 0.002, `«${l.text}» se sale`);
      assert.ok(Math.abs((l.rect[0] + l.rect[2]) / 2 - (rect[0] + rect[2]) / 2) < 0.01, `«${l.text}» no está centrada`);
    }
    for (let i = 1; i < lines.length; i++) assert.ok(Math.abs(lines[i].rect[1] - lines[i - 1].rect[1] - (12 * 1.2) / 842) < 0.004);
  });

  t('cuadro creado con la página girada (k = 1): el texto va girado 90° en el PDF, derecho en pantalla', () => {
    const { runs } = runsOf(core.compose(refsWith([box([0.3, 0.3, 0.4, 0.7], 'Girado', {}, { k: 1 })])));
    const r = runs.find((x) => x.text.includes('Girado'));
    assert.ok(Math.abs(Math.abs(r.angle) - Math.PI / 2) < 0.01, `ángulo ${r.angle}`);
  });

  t('una zona a redactar encima de un cuadro: lo que cae dentro se borra', () => {
    // «secreto» empieza a 59,5 pt; la zona tapa hasta 0,4 × 595 = 238 pt y el texto sigue mucho más allá.
    const txt = 'secreto y luego una frase larga que sigue visible fuera de la zona';
    const out = core.compose(refsWith([box([0.1, 0.5, 0.95, 0.55], txt, { size: 12 }), { type: 'redact', rect: [0.05, 0.49, 0.4, 0.56] }]));
    const { text } = runsOf(out);
    assert.ok(!text.includes('secreto'), text.slice(-80));
    assert.ok(text.includes('fuera de la zona'), text.slice(-80));
  });
  core.close(plain.docId);
}

console.log('  OCR (texto reconocido en páginas escaneadas):');
{
  // Tesseract.js real en Node, con los mismos idiomas que lleva la app (copiados a una carpeta: langPath).
  const { createWorker } = await import('tesseract.js');
  const { mkdtemp, copyFile } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { toGray } = await import('../src/ocr/image.js');
  const { ocrPage, OCR_DPI } = await import('../src/ocr/run.js');
  const { ocrChars } = await import('../src/ocr/layer.js');
  const { findMatches } = await import('../src/textGeom.js');
  const { albaranEscaneado, escaneo } = await import('./make-fixtures.js');
  const langDir = await mkdtemp(path.join(os.tmpdir(), 'spiderpdf-ocr-'));
  for (const c of ['spa', 'cat', 'eng']) await copyFile(`node_modules/@tesseract.js-data/${c}/4.0.0_best_int/${c}.traineddata.gz`, path.join(langDir, `${c}.traineddata.gz`));
  const worker = await createWorker(['spa', 'cat', 'eng'], 1, { cacheMethod: 'none', langPath: langDir });
  const recognize = async (pgm) => (await worker.recognize(Buffer.from(pgm), {}, { blocks: true })).data;
  core.fontBytes ??= (key) => { const k = parseFamilyKey(key); return readFileSyncSafe(`node_modules/@expo-google-fonts/${fontFile(k.family, k.bold, k.italic)}`); };
  core.subsetFont ??= await createSubsetter(readFileSyncSafe('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'));

  try {
    const alb = await albaranEscaneado();
    const d = core.open(alb);

    t('páginas que son solo imagen: las tres del albarán escaneado', () => {
      assert.deepEqual(core.imageOnlyPages(d.docId), [0, 1, 2]);
    });
    {
      const e = core.open(await escaneo());
      const c = core.open(plainContrato);
      t('…y escaneo.pdf sí, el contrato no', () => {
        assert.deepEqual(core.imageOnlyPages(e.docId), [0]);
        assert.deepEqual(core.imageOnlyPages(c.docId), []);
      });
      core.close(e.docId); core.close(c.docId);
    }

    // Reconocer las tres páginas como lo hace la interfaz: render a 300 ppp en gris → ocrPage.
    const results = [];
    for (let i = 0; i < 3; i++) {
      const r = core.render(d.docId, i, OCR_DPI / 72, 0);
      results.push(await ocrPage(toGray(r.pixels, r.width, r.height), { dpi: OCR_DPI, R: d.pages[i].rot0, recognize }));
    }
    const textOf = (res) => res.words.map((w) => w.t).join(' ');
    t('se endereza solo lo que hace falta: recta 0°, torcida 3° (se gira -3°) y de lado (se gira 270°)', () => {
      assert.equal(results[0].angle, 0);
      assert.ok(Math.abs(results[1].angle - 357) < 0.6, `torcida: ${results[1].angle}`);
      assert.ok(Math.abs(results[2].angle - 270) < 0.6, `de lado: ${results[2].angle}`);
    });
    t('lee el albarán en las tres páginas (español, catalán e inglés, con tildes y ñ)', () => {
      for (const [i, res] of results.entries()) {
        const text = textOf(res);
        for (const w of ['ALBARÁN', 'Tornillos', 'Peñalba', 'Lliurament', 'Delivery', '0457']) assert.ok(text.includes(w), `página ${i + 1}: falta «${w}» en «${text}»`);
        assert.ok(res.confidence > 70, `página ${i + 1}: confianza ${res.confidence}`);
      }
    });

    // Guardar con la capa de texto.
    const refs = d.pages.map((p, index) => ({ docId: d.docId, index, rot: 0, ocr: results[index].words }));
    const saved = core.compose(refs);
    const s = core.open(saved);
    // Dónde está «Tornillos» en la imagen: x = 60 pt, línea base a 632 pt del pie en el original (A4 vertical).
    const tornillos = [60 / 595, (842 - 632) / 842];
    const expected = [tornillos, null, [1 - tornillos[1], tornillos[0]]]; // la de lado: girada 90° en sentido horario
    t('al guardar, el texto es real: se extrae y se busca («tornillos», «penalba» sin tilde)', () => {
      for (let i = 0; i < 3; i++) {
        const text = core.pageText(s.docId, i);
        assert.ok(/Tornillos hexagonales M8/.test(text), `página ${i + 1}: «${text.slice(0, 120)}»`);
        assert.equal(core.searchPage(s.docId, i, 'penalba').matches.length, 1);
      }
    });
    t('…en su sitio: el resultado de buscar cae sobre la palabra de la imagen (también en la de lado)', () => {
      for (const i of [0, 2]) {
        const [m] = core.searchPage(s.docId, i, 'tornillos').matches;
        const [u0, v0, u1, v1] = m.rects[0];
        const [eu, ev] = expected[i];
        if (i === 0) {
          assert.ok(Math.abs(u0 - eu) < 0.01 && Math.abs(v1 - ev) < 0.01, `página 1: ${m.rects[0]} frente a ${expected[i]}`);
        } else {
          // De lado: la palabra baja en vertical; su borde izquierdo es la línea base (u ≈ 0,75) y empieza arriba (v ≈ 0,1).
          assert.ok(u0 < eu + 0.01 && u1 > eu - 0.03 && Math.abs(v0 - ev) < 0.015, `página 3: ${m.rects[0]} frente a ${expected[i]}`);
        }
      }
      const [m] = core.searchPage(s.docId, 1, 'tornillos').matches;
      assert.ok(Math.abs(m.rects[0][0] - 0.1) < 0.03, `torcida: ${m.rects[0]}`);
    });
    t('la página se ve exactamente igual: el texto es invisible (mismos píxeles antes y después)', () => {
      for (let i = 0; i < 3; i++) {
        const before = core.render(d.docId, i, 1, 0).pixels;
        const after = core.render(s.docId, i, 1, 0).pixels;
        assert.equal(Buffer.compare(Buffer.from(before), Buffer.from(after)), 0, `página ${i + 1}`);
      }
    });
    t('la capa que ve la interfaz antes de guardar (ocrChars) coincide con la que extrae PDFium al abrir lo guardado', () => {
      for (let i = 0; i < 3; i++) {
        const ui = ocrChars(results[i].words, d.pages[i].width, d.pages[i].height);
        const [mu] = findMatches(ui.text, 'tornillos');
        const [mp] = core.searchPage(s.docId, i, 'tornillos').matches;
        const uiBox = ui.boxes.slice(mu.start * 4, mu.start * 4 + 4);
        const pdfBox = core.textChars(s.docId, i).boxes.slice(mp.start * 4, mp.start * 4 + 4);
        const centre = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        const [a1, a2] = centre(uiBox); const [b1, b2] = centre(pdfBox);
        assert.ok(Math.hypot(a1 - b1, a2 - b2) < 0.012, `página ${i + 1}: ${[...uiBox]} frente a ${[...pdfBox]}`);
      }
    });
    await mkdir('test/out', { recursive: true });
    await writeFile('test/out/albaran-ocr.pdf', saved);
    core.close(s.docId);
    core.close(d.docId);
  } finally {
    await worker.terminate();
  }
}

console.log('  índice impreso → marcadores y enlaces:');
{
  const D = core.open(await indiceImpreso());
  const n = D.pages.length;
  const lines = [...Array(n).keys()].map((i) => textLines(core.textChars(D.docId, i)));
  const tocPages = findTocPages(lines);
  const entries = tocPages.flatMap((p) => tocEntries(lines[p]).entries);
  const { offset } = guessOffset(entries, [...Array(n).keys()].map((i) => core.pageText(D.docId, i)), tocPages);
  t('  · la página 3 es el índice; 12 entradas y desfase +1 (portada sin numerar)', () => {
    assert.deepEqual(tocPages, [2]);
    assert.equal(entries.length, 12);
    assert.equal(offset, 1);
    assert.equal(entries[6].title, '2.3 TAREAS EXCLUIDAS DEL ALCANCE DEL PROYECTO Y OTRAS CONSIDERACIONES');
  });
  const tree = treeFromLevels(entries.map((e) => ({ title: e.title, level: e.level, pos: targetIndex(e, offset) })));
  const forSave = (nodes) => nodes.map((x) => ({ title: x.title, pos: x.pos, children: forSave(x.children) }));
  const refs = D.pages.map((_, i) => ({ docId: D.docId, index: i, rot: 0 }));
  const saved = core.compose(refs, null, { outline: forSave(tree) });
  const titles = (nodes) => nodes.map((x) => [x.title, x.pageIndex, titles(x.children)]);
  t('  · al guardar, los marcadores quedan en el PDF con su jerarquía y su página real', () => {
    const R = core.open(saved);
    const bm = core.bookmarks(R.docId);
    assert.equal(bm.length, 7);
    assert.deepEqual(titles(bm)[3], ['2 DESCRIPCIÓN Y ALCANCE', 3, [
      ['2.1 ESTRUCTURA ORGANIZATIVA', 3, []], ['2.2 FLUJO DE TRASLADO', 4, []],
      ['2.3 TAREAS EXCLUIDAS DEL ALCANCE DEL PROYECTO Y OTRAS CONSIDERACIONES', 5, []]]]);
    assert.deepEqual(titles(bm).at(-1), ['5 CONDICIONES', 7, []]);
    core.close(R.docId);
  });
  const indiceBytes = await indice();
  t('  · el índice creado sustituye al que ya tuviera; pos -1 = marcador sin destino', () => {
    const I = core.open(indiceBytes);
    const out2 = core.compose(I.pages.map((_, i) => ({ docId: I.docId, index: i, rot: 0 })), null, {
      outline: [{ title: 'Solo', pos: 2, children: [{ title: 'Sin página', pos: -1, children: [] }] }],
    });
    const R = core.open(out2);
    assert.deepEqual(titles(core.bookmarks(R.docId)), [['Solo', 2, [['Sin página', -1, []]]]]);
    core.close(R.docId);
    core.close(I.docId);
  });
  core.close(D.docId);

  const E = core.open(await enlaces());
  t('  · links: internos con /Dest y con acción «Ir a», y web; en fracciones de la página', () => {
    const l = core.links(E.docId, 0);
    assert.equal(l.length, 3);
    assert.equal(l[0].pageIndex, 1);
    assert.equal(l[1].pageIndex, 2);
    assert.equal(l[2].uri, ENLACE_WEB);
    const [u0, v0, u1, v1] = l[0].rect;
    assert.ok(u0 > 0.09 && u0 < 0.11 && u1 > 0.2 && u1 < 0.5, `rect ${l[0].rect}`);
    assert.ok(v0 > 0.14 && v1 < 0.18 && v1 > v0, `rect ${l[0].rect}`);
    assert.deepEqual(core.links(E.docId, 1), []);
  });
  core.close(E.docId);

  const F = core.open(await factura());
  const A = core.open(await albaranLineas());
  t('  · rules: las líneas de la rejilla de la factura (sin las del fondo de la cabecera); el albarán no tiene', () => {
    const r = core.rules(F.docId, 0);
    const horiz = r.filter(([, v0, , v1]) => Math.abs(v1 - v0) < 1e-3);
    const vert = r.filter(([u0, , u1]) => Math.abs(u1 - u0) < 1e-3);
    assert.equal(horiz.length, 10); // 9 filas = 10 líneas
    assert.equal(vert.length, 7);   // 6 columnas = 7 líneas
    assert.equal(r.length, 17);     // el rectángulo de fondo de la cabecera (solo relleno) no cuenta
    assert.ok(horiz.every(([u0, , u1]) => Math.abs(u0 - 50 / 595) < 0.002 && Math.abs(u1 - 545 / 595) < 0.002));
    assert.deepEqual(core.rules(A.docId, 0), []);
  });
  core.close(F.docId);
  core.close(A.docId);

  const orig = new Uint8Array(await readFile('test/fixtures/firmado.pdf'));
  const S = core.open(orig);
  const inc = core.compose(S.pages.map((_, i) => ({ docId: S.docId, index: i, rot: 0 })), null, {
    outline: [{ title: 'Condiciones', pos: 1, children: [] }],
  });
  t('  · en un PDF firmado, el índice va en una revisión incremental y la firma sigue verificando', () => {
    assert.equal(core.incremental, true);
    assert.ok(Buffer.from(inc.subarray(0, orig.length)).equals(Buffer.from(orig)));
    assert.equal(signatureIntact(inc), true);
    const R = core.open(inc);
    assert.deepEqual(titles(core.bookmarks(R.docId)), [['Condiciones', 1, []]]);
    core.close(R.docId);
  });
  core.close(S.docId);
}

console.log('  exportar a Word: aspecto de las letras e imágenes:');
{
  const D = core.open(await informe());
  const c = core.textChars(D.docId, 0);
  const st = core.charStyles(D.docId, 0);
  const at = (s) => c.text.indexOf(s);
  t('  · charStyles: un valor por carácter de textChars', () => {
    assert.equal(st.size.length, c.text.length);
    assert.equal(st.flags.length, c.text.length);
  });
  t('  · tamaño, negrita y color de cada letra (título 22 pt negrita, cuerpo 10,5, sección azul)', () => {
    const ti = at(INFORME.titulo);
    assert.ok(Math.abs(st.size[ti] - 22) < 0.1);
    assert.equal(st.flags[ti] & 1, 1);
    assert.match(st.fonts[st.font[ti]], /Helvetica-Bold/);
    const body = at('El volumen');
    assert.ok(Math.abs(st.size[body] - 10.5) < 0.1);
    assert.equal(st.flags[body] & 1, 0);
    assert.equal(st.flags[at(INFORME.negrita)] & 1, 1, 'la negrita dentro del párrafo');
    const h = at(INFORME.h1[0]);
    assert.equal(st.color[h], (Math.round(0.1 * 255) << 16) | (Math.round(0.25 * 255) << 8) | Math.round(0.55 * 255));
  });
  t('  · PDFium marca con \\u0002 la palabra partida con guion al final de línea', () => {
    const c2 = core.textChars(D.docId, 1);
    assert.ok(c2.text.includes(`${INFORME.partida[0]}\u0002${INFORME.partida[1]}`));
  });
  const imgs = core.pageImages(D.docId, 0);
  t('  · pageImages: el logo con transparencia (con su alfa, a su resolución) y la foto opaca, de arriba abajo', () => {
    assert.equal(imgs.length, 2);
    const [logo, foto] = imgs;
    assert.equal(logo.alpha, true);
    assert.equal(logo.width, 80); // su resolución propia, no 1 píxel por punto (55)
    const px = (im, x, y) => [...im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];
    assert.equal(px(logo, 1, 1)[3], 0, 'esquina transparente');
    const mid = px(logo, 40, 40);
    assert.ok(mid[3] === 255 && mid[2] > 150 && mid[0] < 80, `centro azul opaco: ${mid}`);
    assert.equal(foto.alpha, false);
    assert.equal(foto.width, 240);
    assert.ok(Math.abs(foto.rect[0] - 60 / 595) < 0.002 && Math.abs((foto.rect[2] - foto.rect[0]) * 595 - 240) < 0.5);
    assert.ok(logo.rect[1] < foto.rect[1]);
  });
  t('  · las imágenes enormes se reducen a 200 ppp de su tamaño en la página', () => {
    const big = core.pageImages(D.docId, 0, { maxDpi: 72 });
    assert.equal(big[1].width, 240); // 240 pt a 72 ppp = 240 px: igual
    const small = core.pageImages(D.docId, 0, { maxDpi: 36 });
    assert.equal(small[1].width, 120);
  });
  core.close(D.docId);
}

console.log('  negrita y cursiva leídas de la propia fuente (PDF con nombres genéricos «F1»):');
{
  const ttf = (w) => new Uint8Array(readFileSyncSafe(`node_modules/@expo-google-fonts/inter/${w}/Inter_${w}.ttf`));
  t('  · fontTraits: peso y estilo del archivo de la fuente (OS/2 y nombre)', () => {
    assert.deepEqual(fontTraits(ttf('400Regular')), { bold: false, italic: false, weight: 400, name: 'Inter Regular' });
    assert.equal(fontTraits(ttf('700Bold')).bold, true);
    assert.equal(fontTraits(ttf('700Bold')).weight, 700);
    assert.equal(fontTraits(ttf('400Regular_Italic')).italic, true);
    assert.equal(fontTraits(new Uint8Array([1, 2, 3])), null);
  });
  // Como los PDF de Chrome o de algunos Word: fuentes incrustadas que se llaman «F1», «F2» y sin peso en el descriptor.
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(ttf('400Regular'), { subset: true });
  const bold = await doc.embedFont(ttf('700Bold'), { subset: true });
  const p = doc.addPage([595, 842]);
  p.drawText('Texto normal', { x: 50, y: 760, size: 11, font: reg });
  p.drawText('Texto en negrita', { x: 50, y: 740, size: 11, font: bold });
  let k = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of('BaseFont'))) obj.set(PDFName.of('BaseFont'), PDFName.of(`F${++k}`));
    if (obj.get(PDFName.of('FontName'))) { obj.set(PDFName.of('FontName'), PDFName.of(`F${++k}`)); obj.delete(PDFName.of('FontWeight')); obj.set(PDFName.of('Flags'), PDFNumber.of(4)); }
  }
  const G = core.open(await doc.save());
  t('  · charStyles: la negrita sale de la fuente aunque el PDF la llame «F3» y no diga su peso', () => {
    const c = core.textChars(G.docId, 0);
    const st = core.charStyles(G.docId, 0);
    assert.equal(st.flags[c.text.indexOf('Texto normal')] & 1, 0);
    assert.equal(st.flags[c.text.indexOf('Texto en negrita')] & 1, 1);
    assert.ok(Math.abs(st.size[c.text.indexOf('Texto normal')] - 11) < 0.05);
  });
  core.close(G.docId);
}

await mkdir('test/out', { recursive: true });
await writeFile('test/out/resultado.pdf', out);
console.log(`\n${passed} pruebas superadas. Salida en test/out/resultado.pdf`);
