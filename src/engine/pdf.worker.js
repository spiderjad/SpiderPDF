// Web Worker: todo el trabajo de PDFium ocurre aquí para no congelar la interfaz.
import { init } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { PdfCore } from './pdfium-core.js';
import { createSubsetter } from './subset.js';
import { FONT_URLS, HB_SUBSET_WASM } from './fontUrls.js';
import { familyKey } from '../textbox.js';
import { toGray } from '../ocr/image.js';
import { createQpdf, finishWithQpdf } from './qpdf.js';
import createQpdfModule from './qpdf/qpdf.mjs';
import qpdfWasmUrl from './qpdf/qpdf.wasm?url';
import { reducePdf } from './reduce.js';
import { setLang, t } from '../i18n/index.js';

/** JPEG con el codificador del navegador (rápido, nativo). quality: 0-1. */
async function encodeJpeg(rgba, width, height, quality) {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
}

const OCR_MAX_PIXELS = 36e6; // páginas enormes (planos): se reconocen a menos resolución

let corePromise;
function getCore() {
  corePromise ??= (async () => {
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    const pdfium = await init({ wasmBinary });
    pdfium.PDFiumExt_Init();
    return new PdfCore(pdfium);
  })();
  return corePromise;
}

// Texto nuevo: las fuentes incluidas y el subconjuntador se cargan la primera vez que hacen falta.
const fontCache = new Map(); // clave → bytes del TTF
let subsetterPromise;
async function prepareTextFonts(core, refs) {
  const keys = new Set();
  for (const r of refs) for (const a of r.annots ?? []) if (a.type === 'textbox' && a.text) keys.add(familyKey(a.style.family, a.style.bold, a.style.italic));
  if (refs.some((r) => r.ocr?.length)) keys.add(familyKey('sans', false, false)); // capa de texto del OCR
  if (!keys.size) return;
  await Promise.all([...keys].filter((k) => !fontCache.has(k)).map(async (k) => {
    fontCache.set(k, new Uint8Array(await (await fetch(FONT_URLS[k])).arrayBuffer()));
  }));
  subsetterPromise ??= (async () => createSubsetter(await (await fetch(HB_SUBSET_WASM)).arrayBuffer()))();
  core.subsetFont = await subsetterPromise;
  core.fontBytes = (k) => fontCache.get(k);
}

// qpdf: solo se carga la primera vez que hace falta (redactar un PDF protegido, cambiar la contraseña).
let qpdfPromise;
const getQpdf = () => (qpdfPromise ??= (async () => createQpdf(createQpdfModule, await (await fetch(qpdfWasmUrl)).arrayBuffer()))());

let jpegCanvas = null; // canvas reutilizado para pasar páginas a JPEG al imprimir
let jpegCtx = null;

// Protección elegida en «Proteger con contraseña», pendiente de guardar: token → { user, owner, perms }.
const protections = new Map();
let protectionSeq = 0;
function keepProtection({ user, owner, perms }) {
  const token = `p${++protectionSeq}`;
  protections.set(token, { user, owner, perms });
  return token;
}
function takeProtection(token) {
  const p = protections.get(token);
  if (!p) throw new Error(t('engine.protectionLost'));
  return p; // se conserva: cada «Guardar» vuelve a proteger con ella hasta cerrar el documento
}

function knownPasswords(core, { docIds = [], token } = {}) {
  const list = [''];
  for (const d of docIds) { const e = core.docs.get(d); if (e) list.push(e.ownerPassword, e.password); }
  const p = token && protections.get(token);
  if (p) list.push(p.owner, p.user);
  return [...new Set(list.filter((x) => x != null))];
}

const cancelled = new Set();
const progress = (id) => (p) => self.postMessage({ id, progress: p });

self.onmessage = async ({ data: { id, op, args } }) => {
  // Cancelar llega mientras otra operación cede el control (openAsync): solo se anota.
  if (op === 'cancel') { cancelled.add(args.target); return; }
  try {
    const core = await getCore();
    let result;
    let transfer = [];
    switch (op) {
      case 'init':
        result = true;
        break;
      case 'setLang': // los errores y avisos del motor salen en el idioma de la interfaz
        setLang(args.lang, args.languages);
        result = true;
        break;
      case 'open': {
        // known: { docIds, token } → probar las contraseñas que el worker ya conoce (lo que acaba de guardar:
        // la copia redactada que se reabre, o el documento compuesto para imprimir), sin volver a pedirlas.
        const tries = args.known ? knownPasswords(core, args.known) : [args.password];
        for (const [i, pw] of tries.entries()) {
          try {
            result = await core.openAsync(args.bytes, pw, { onProgress: progress(id), isCancelled: () => cancelled.has(id) });
            break;
          } catch (e) {
            if (!e.needsPassword || i === tries.length - 1) throw e;
          }
        }
        break;
      }
      case 'render': {
        const r = core.render(args.docId, args.index, args.scale, args.rot);
        result = await createImageBitmap(new ImageData(r.pixels, r.width, r.height));
        transfer = [result];
        break;
      }
      case 'renderJpeg': {
        // Para imprimir: la página a la escala pedida, ya comprimida (no viaja ni se guarda un mapa de bits enorme).
        // JPEG de calidad alta: mucho más rápido de codificar que PNG a 300 ppp y 5-10 veces más pequeño.
        const r = core.render(args.docId, args.index, args.scale, args.rot ?? 0);
        if (args.gray) {
          // Blanco y negro aquí mismo: no todos los controladores respetan la opción de color.
          const px = r.pixels;
          for (let i = 0; i < px.length; i += 4) {
            const y = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
            px[i] = px[i + 1] = px[i + 2] = y;
          }
        }
        // Un solo canvas para todas las páginas y en CPU (willReadFrequently): con uno nuevo por página, acelerado
        // por GPU, el proceso GPU acumulaba cientos de MB por página hasta que el recolector los soltaba (medido).
        jpegCanvas ??= new OffscreenCanvas(1, 1);
        jpegCtx ??= jpegCanvas.getContext('2d', { willReadFrequently: true });
        jpegCanvas.width = r.width;
        jpegCanvas.height = r.height;
        jpegCtx.putImageData(new ImageData(r.pixels, r.width, r.height), 0, 0);
        result = new Uint8Array(await (await jpegCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer());
        transfer = [result.buffer];
        break;
      }
      case 'imageOnlyPages':
        result = core.imageOnlyPages(args.docId);
        break;
      case 'ocrGray': {
        // La página tal como se ve (con su /Rotate), en gris, para el OCR.
        const [w, h] = core.pageSize(args.docId, args.index);
        const dpi = Math.min(args.dpi, Math.floor(72 * Math.sqrt(OCR_MAX_PIXELS / Math.max(1, w * h))));
        const r = core.render(args.docId, args.index, dpi / 72, 0);
        result = { ...toGray(r.pixels, r.width, r.height), dpi };
        transfer = [result.data.buffer];
        break;
      }
      case 'textRuns':
        result = core.textRuns(args.docId, args.index);
        break;
      case 'textChars': {
        result = core.textChars(args.docId, args.index);
        transfer = [result.boxes.buffer, result.generated.buffer];
        break;
      }
      case 'search':
        result = core.searchPage(args.docId, args.index, args.query);
        break;
      case 'rules':
        result = core.rules(args.docId, args.index);
        break;
      case 'charStyles': {
        result = core.charStyles(args.docId, args.index);
        transfer = [result.size.buffer, result.flags.buffer, result.color.buffer, result.font.buffer];
        break;
      }
      case 'pageImages': {
        // Para Word: PNG si tiene transparencia, JPEG si no (fotos y escaneos pesan mucho menos).
        const list = core.pageImages(args.docId, args.index);
        result = [];
        for (const im of list) {
          const canvas = new OffscreenCanvas(im.width, im.height);
          canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(im.data.buffer), im.width, im.height), 0, 0);
          const type = im.alpha ? 'png' : 'jpg';
          const blob = await canvas.convertToBlob(im.alpha ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 });
          result.push({ rect: im.rect, width: im.width, height: im.height, type, bytes: new Uint8Array(await blob.arrayBuffer()) });
        }
        transfer = result.map((r) => r.bytes.buffer);
        break;
      }
      case 'links':
        result = core.links(args.docId, args.index);
        break;
      case 'bookmarks':
        result = core.bookmarks(args.docId);
        break;
      case 'fields':
        result = core.fields(args.docId, args.index);
        break;
      case 'checkGlyphs':
        result = core.checkGlyphs(args.docId, args.index, args.objIndex, args.text);
        break;
      case 'fontData':
        result = core.fontData(args.docId, args.index, args.objIndex);
        if (result) transfer = [result.buffer];
        break;
      case 'reduce': {
        // «Reducir tamaño»: el documento tal como está (compose, con su protección) → imágenes → qpdf.
        await prepareTextFonts(core, args.refs);
        const security = args.security?.token ? takeProtection(args.security.token) : args.security;
        const raw = await finishWithQpdf(getQpdf, core.compose(args.refs, null, { security, outline: args.outline }), core.post);
        core.post = null;
        const passwords = knownPasswords(core, { docIds: args.docIds, token: args.security?.token });
        const r = await reducePdf(core, raw, {
          level: args.level, passwords, encode: encodeJpeg, qpdf: await getQpdf(),
          onProgress: progress(id), isCancelled: () => cancelled.has(id),
        });
        result = { bytes: r.bytes, composed: raw.length, images: r.images, reduced: r.reduced, warnings: core.warnings ?? [] };
        transfer = [r.bytes.buffer];
        break;
      }
      case 'unlockOwner':
        result = core.unlockOwner(args.docId, args.password);
        break;
      case 'compose': {
        await prepareTextFonts(core, args.refs);
        const security = args.security?.token ? takeProtection(args.security.token) : args.security;
        const raw = core.compose(args.refs, progress(id), { security, hidden: !!args.hidden, outline: args.outline });
        const bytes = await finishWithQpdf(getQpdf, raw, core.post);
        core.post = null;
        result = { bytes, warnings: core.warnings ?? [], incremental: !!core.incremental };
        transfer = [bytes.buffer];
        break;
      }
      case 'setProtection':
        // Las contraseñas nuevas se quedan aquí hasta guardar; la interfaz solo conserva el identificador.
        result = keepProtection(args);
        break;
      case 'dropProtection':
        protections.delete(args.token);
        break;
      case 'close':
        core.close(args.docId);
        break;
      default:
        throw new Error(`Operación desconocida: ${op}`);
    }
    self.postMessage({ id, result }, transfer);
  } catch (e) {
    self.postMessage({ id, error: e.message, needsPassword: !!e.needsPassword, wrongPassword: !!e.wrongPassword, cancelled: !!e.cancelled });
  } finally {
    cancelled.delete(id);
  }
};
