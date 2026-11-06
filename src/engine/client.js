// Puente entre la interfaz y el worker de PDFium, con caché de renders.
import { ocrChars } from '../ocr/layer.js';
import { findMatches, lineRects } from '../textGeom.js';

const worker = new Worker(new URL('./pdf.worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let seq = 0;

worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  if (data.progress) { p.onProgress?.(data.progress); return; }
  pending.delete(data.id);
  if (data.error) p.reject(Object.assign(new Error(data.error), { needsPassword: data.needsPassword, wrongPassword: data.wrongPassword, cancelled: data.cancelled }));
  else p.resolve(data.result);
};

/** Envía una operación al worker. → { id, promise }. onProgress recibe { done, total } si el worker informa. */
function job(op, args, transfer = [], onProgress) {
  const id = ++seq;
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, op, args }, transfer);
  });
  return { id, promise, cancel: () => worker.postMessage({ op: 'cancel', args: { target: id } }) };
}

const call = (op, args, transfer = []) => job(op, args, transfer).promise;

/** Página del estado → referencia para el motor (las imágenes, ya en RGBA: el worker no decodifica imágenes). */
async function toEngineRef({ docId, index, rot, annots, fields, textEdits, source, width, height, created, ocr }) {
  return {
    docId, index, rot,
    source, // nombre del archivo, para los grupos del índice al unir PDFs
    ocr: ocr?.length ? ocr : undefined, // capa de texto del OCR (src/ocr/layer.js)
    // Página nueva (docId null): el motor la crea con este tamaño y, si es una imagen, con sus píxeles.
    create: created ? { width, height, image: created.kind === 'image' ? await blobToRGBA(created.blob, created.pxW, created.pxH) : undefined } : undefined,
    textEdits: textEdits && Object.keys(textEdits).length ? textEdits : undefined,
    annots: annots?.length ? await Promise.all(annots.map(toEngineAnnot)) : undefined,
    fields: fields && Object.keys(fields).length ? fields : undefined,
  };
}

export const pdf = {
  /** Promesa que se cumple cuando el motor PDFium está cargado. */
  ready: () => call('init', {}),

  /** bytes: Uint8Array. Se copia antes de transferirlo al worker. */
  open(bytes, password = '', known) {
    return pdf.openJob(bytes, password, undefined, known).promise;
  },

  /** Abrir con avance ({ done, total } de páginas leídas) y cancelación. → { promise, cancel } */
  openJob(bytes, password = '', onProgress, known) {
    const buf = bytes.slice().buffer;
    return job('open', { bytes: buf, password, known }, [buf], onProgress);
  },
  /**
   * Guarda el documento. pages: páginas del estado ({ docId, index, rot, annots, fields, textEdits }).
   * Devuelve { bytes, warnings } (avisos de la redacción).
   * Las imágenes (firmas) se convierten aquí a RGBA: el worker no decodifica imágenes.
   */
  async compose(pages, onProgress, { security, hidden } = {}) {
    const refs = await Promise.all(pages.map(toEngineRef));
    return job('compose', { refs, security, hidden }, [], onProgress).promise;
  },

  /**
   * «Reducir tamaño» del documento tal como está. level: high | balanced | small. → { promise, cancel };
   * promise → { bytes, composed (tamaño sin reducir), images, reduced, warnings }. onProgress({ phase, done, total }).
   */
  async reduceJob(pages, { level, security, docIds }, onProgress) {
    const refs = await Promise.all(pages.map(toEngineRef));
    return job('reduce', { refs, level, security, docIds }, [], onProgress);
  },

  /** Desbloquea los permisos con la contraseña de propietario. → { ...security, unlocked } */
  unlockOwner: (docId, password) => call('unlockOwner', { docId, password }),

  /**
   * Deja en el worker la protección elegida (contraseñas y permisos) hasta guardar. → token (lo único que guarda
   * la interfaz). dropProtection lo olvida.
   */
  setProtection: ({ user, owner, perms }) => call('setProtection', { user, owner, perms }),
  dropProtection: (token) => call('dropProtection', { token }),

  /**
   * Una página renderizada como JPEG (para imprimir). scale: píxeles por punto; rot: giro del usuario;
   * gray: en escala de grises. → Uint8Array
   */
  renderJpeg: (docId, index, scale, rot = 0, gray = false) => call('renderJpeg', { docId, index, scale, rot, gray }),

  /** Letras de text que no tiene la fuente del texto objIndex de la página. → { missing: [letras] } */
  checkGlyphs: (docId, index, objIndex, text) => call('checkGlyphs', { docId, index, objIndex, text }),

  /** Datos de la fuente del texto objIndex (incrustada), para la vista previa; null si no se puede. En caché. */
  fontData(docId, index, objIndex) {
    const key = `${docId}:${index}:${objIndex}`;
    if (!fontDataCache.has(key)) fontDataCache.set(key, call('fontData', { docId, index, objIndex }).catch(() => null));
    return fontDataCache.get(key);
  },

  /** Texto de una página con la caja de cada carácter (una vez por página, en caché). */
  textChars(docId, index) {
    if (docId == null) return Promise.resolve(NO_CHARS); // página nueva: sin texto
    const key = `${docId}:${index}`;
    if (!charCache.has(key)) {
      charCache.set(key, call('textChars', { docId, index }).catch((e) => { charCache.delete(key); throw e; }));
    }
    return charCache.get(key);
  },

  /**
   * Texto de una página del estado, contando el reconocido por OCR (todavía sin guardar: está en page.ocr).
   * Mismo formato que textChars; si la página ya tenía texto, el reconocido va detrás.
   */
  async pageChars(page) {
    const base = await this.textChars(page.docId, page.index);
    if (!page.ocr?.length) return base;
    if (!ocrCache.has(page.ocr)) {
      const odd = (page.rot0 ?? 0) % 2 === 1; // width/height ya llevan el /Rotate; la capa va sin girar
      const own = ocrChars(page.ocr, odd ? page.height : page.width, odd ? page.width : page.height);
      ocrCache.set(page.ocr, base.text ? join(base, own) : own);
    }
    return ocrCache.get(page.ocr);
  },

  /** Buscar en una página del estado (con su OCR si lo tiene). → { hasText, matches: [{ start, end, rects }] } */
  async pageSearch(page, query) {
    if (!page.ocr?.length) return this.search(page.docId, page.index, query);
    const c = await this.pageChars(page);
    return { hasText: c.hasText, matches: findMatches(c.text, query).map((m) => ({ ...m, rects: lineRects(c.boxes, c.generated, m.start, m.end) })) };
  },

  /** Páginas que son solo imagen (escaneos) de un documento abierto. En caché. */
  imageOnlyPages(docId) {
    if (docId == null) return Promise.resolve([]);
    const key = `${docId}:`;
    if (!scanCache.has(key)) scanCache.set(key, call('imageOnlyPages', { docId }).catch(() => []));
    return scanCache.get(key);
  },

  /** Una página renderizada en gris para el OCR (dpi o menos si es muy grande). → { w, h, data, dpi } */
  ocrGray: (docId, index, dpi) => call('ocrGray', { docId, index, dpi }),

  /** Busca en una página (en el worker). → { hasText, matches: [{ start, end, rects }] } */
  search: (docId, index, query) => (docId == null ? Promise.resolve({ hasText: true, matches: [] }) : call('search', { docId, index, query })),

  /** Bloques de texto de una página (se piden una vez y se guardan en caché). */
  textRuns(docId, index) {
    if (docId == null) return Promise.resolve([]);
    const key = `${docId}:${index}`;
    if (!runCache.has(key)) {
      runCache.set(key, call('textRuns', { docId, index }).catch((e) => { runCache.delete(key); throw e; }));
    }
    return runCache.get(key);
  },

  /** Campos de formulario de una página (se piden una vez y se guardan en caché). */
  fields(docId, index) {
    if (docId == null) return Promise.resolve([]);
    const key = `${docId}:${index}`;
    if (!fieldCache.has(key)) {
      fieldCache.set(key, call('fields', { docId, index }).catch((e) => { fieldCache.delete(key); throw e; }));
    }
    return fieldCache.get(key);
  },

  /** Índice de un PDF abierto: [{ title, pageIndex, children }] (una vez por documento, en caché). */
  bookmarks(docId) {
    if (docId == null) return Promise.resolve([]);
    const key = `${docId}:`;
    if (!outlineCache.has(key)) {
      outlineCache.set(key, call('bookmarks', { docId }).catch((e) => { outlineCache.delete(key); throw e; }));
    }
    return outlineCache.get(key);
  },

  close(docId) {
    for (const c of [fieldCache, runCache, charCache, outlineCache, fontDataCache, scanCache]) for (const key of c.keys()) if (key.startsWith(`${docId}:`)) c.delete(key);
    return call('close', { docId });
  },
};

const fieldCache = new Map(); // "docId:index" -> Promise<campos>
const runCache = new Map();   // "docId:index" -> Promise<bloques de texto>
const charCache = new Map();  // "docId:index" -> Promise<texto con cajas por carácter>
const outlineCache = new Map(); // "docId:" -> Promise<índice>
const fontDataCache = new Map();
const scanCache = new Map(); // "docId:" -> Promise<índices de páginas escaneadas>
const ocrCache = new WeakMap(); // palabras del OCR -> caracteres (se rehacen si cambian)

/** Une dos textos con cajas (el original y el reconocido), separados por un salto de línea generado. */
function join(a, b) {
  const boxes = new Float32Array(a.boxes.length + 8 + b.boxes.length);
  boxes.set(a.boxes); boxes.set(b.boxes, a.boxes.length + 8);
  const generated = new Uint8Array(a.generated.length + 2 + b.generated.length);
  generated.set(a.generated); generated.set([1, 1], a.generated.length); generated.set(b.generated, a.generated.length + 2);
  return { text: `${a.text}
${b.text}`, boxes, generated, hasText: a.hasText || b.hasText };
} // "docId:index:objIndex" -> Promise<bytes | null>
const NO_CHARS = { text: '', boxes: new Float32Array(0), generated: new Uint8Array(0), hasText: false };

// --- Imágenes de las páginas nuevas ---------------------------------------
const decoded = new WeakMap(); // Blob -> Promise<ImageBitmap>
function decode(blob) {
  if (!decoded.has(blob)) decoded.set(blob, createImageBitmap(blob));
  return decoded.get(blob);
}

/** Blob de imagen → { width, height, pixels RGBA } a w × h (reducida si hace falta). Sin fetch: CSP. */
async function blobToRGBA(blob, w, h) {
  const bmp = await decode(blob);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  return { width: w, height: h, pixels: ctx.getImageData(0, 0, w, h).data };
}

/** Render de una página nueva (en blanco o imagen) sin pasar por el motor, con el giro del usuario. */
async function renderCreated(page, scale) {
  const swap = page.rot % 2 === 1;
  const W = page.width * scale;
  const H = page.height * scale;
  const cw = Math.max(1, Math.round(swap ? H : W));
  const ch = Math.max(1, Math.round(swap ? W : H));
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  if (page.created.kind === 'image') {
    const bmp = await decode(page.created.blob);
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((page.rot * Math.PI) / 2);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, -W / 2, -H / 2, W, H);
  }
  return canvas.transferToImageBitmap();
}

/** data URL → Blob sin fetch (la CSP solo permite connect-src 'self'). */
function dataUrlToBlob(url) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url ?? '');
  if (!m) throw new Error('La imagen de la firma no es válida.');
  const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
}

/** Anotación del estado → la que espera el motor. Las imágenes llegan como src (data URL o Blob). */
async function toEngineAnnot(a) {
  if (a.type !== 'image' || a.image) return a;
  const blob = a.src instanceof Blob ? a.src : dataUrlToBlob(a.src);
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const { src, ...rest } = a;
    return { ...rest, image: { width: bmp.width, height: bmp.height, pixels: data } };
  } finally {
    bmp.close();
  }
}

// --- Caché LRU de imágenes renderizadas ---------------------------------
const MAX_CACHED = 400;
const MAX_SIDE_PX = 4096;
const cache = new Map();
const inflight = new Map();

/** Escala por punto PDF, redondeada para que los renders se reutilicen. */
export function scaleFor(displayWidthPts, cssWidth) {
  const dpr = window.devicePixelRatio || 1;
  const raw = (cssWidth * dpr) / displayWidthPts;
  const capped = Math.min(raw, MAX_SIDE_PX / displayWidthPts);
  return Math.max(0.125, Math.ceil(capped * 8) / 8);
}

/**
 * Render de una página (ImageBitmap) con caché LRU. fresh: ignora la caché y pide uno nuevo
 * (para cuando el que había llegó cerrado).
 */
export function renderPage(page, scale, { fresh = false } = {}) {
  if (page.docId == null) return renderCreated(page, scale); // página nueva: se dibuja aquí, rápido y sin caché
  const key = `${page.docId}:${page.index}:${page.rot}:${scale}`;
  if (fresh) { cache.delete(key); inflight.delete(key); }
  if (cache.has(key)) {
    const bmp = cache.get(key);
    cache.delete(key);
    cache.set(key, bmp);
    return Promise.resolve(bmp);
  }
  if (inflight.has(key)) return inflight.get(key);
  const job = call('render', { docId: page.docId, index: page.index, scale, rot: page.rot }).then(
    (bmp) => {
      inflight.delete(key);
      cache.set(key, bmp);
      if (cache.size > MAX_CACHED) {
        const [oldKey, old] = cache.entries().next().value;
        cache.delete(oldKey);
        // Cerrar libera memoria, pero no en el acto: alguien puede tenerlo aún pendiente de dibujar.
        setTimeout(() => old.close?.(), 5000);
      }
      return bmp;
    },
    (err) => { inflight.delete(key); throw err; },
  );
  inflight.set(key, job);
  return job;
}
