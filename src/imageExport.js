// Exportar páginas como imagen (Archivo → Exportar como imagen…) y «Copiar como imagen». Lógica pura: nombres de
// archivo, resolución y tamaño en píxeles, y la resolución escrita dentro del PNG (pHYs) y del JPG (JFIF), para
// que se abran a su tamaño real. La interfaz está en src/components/ImageExportDialog.jsx.
import { t } from './i18n/index.js';
import { safeFileName } from './split.js';

export const IMAGE_FORMATS = ['png', 'jpeg'];
export const IMAGE_DPIS = [72, 150, 300];
export const DPI_RANGE = { min: 36, max: 600 };
export const QUALITY_RANGE = { min: 0.5, max: 1 };
export const MAX_PIXELS = 40e6; // por imagen (40 Mpx ≈ A4 a 450 ppp); más, se baja la resolución de esa página
export const COPY_DPI = 150; // «Copiar como imagen»: buena para pegar en un documento o un chat
export const EXT = { png: 'png', jpeg: 'jpg' };
const DOC_VARS = ['documento', 'document', 'name', 'nombre', 'nom'];

/** El dato del nombre del documento en el idioma de la interfaz: «{documento}» (valen todos en cualquier idioma). */
export const docVar = () => `{${t('dialogs.img.docVar')}}`;
/** Patrón por defecto: «{documento}_p{n}». */
export const defaultImagePattern = () => `${docVar()}_p{n}`;

const stripExt = (p) => String(p ?? '').trim().replace(/\.(png|jpe?g)$/i, '');

/** ¿El patrón vale? Necesita {n} (si no, todas las páginas tendrían el mismo nombre). → null o el texto del error. */
export function imagePatternError(pattern) {
  const p = stripExt(pattern);
  if (!p) return t('dialogs.img.patternEmpty');
  const unknown = [...p.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).find((v) => v.toLowerCase() !== 'n' && !DOC_VARS.includes(v.toLowerCase()));
  if (unknown !== undefined) return t('dialogs.img.patternUnknown', { bad: `{${unknown}}` });
  if (!/\{n\}/i.test(p)) return t('dialogs.img.patternNeedsN');
  return null;
}

/**
 * Nombre de cada imagen. positions: número de página (desde 1) de cada una en el documento; name: el del documento
 * (sin .pdf). Sin repetir (« (2)»…) y con la extensión del formato.
 */
export function imageNames(pattern, positions, { name = '', format = 'png' } = {}) {
  const base = stripExt(pattern);
  const doc = safeFileName(String(name).replace(/\.pdf$/i, '')) || 'documento';
  const used = new Set();
  return positions.map((n) => {
    const raw = base.replace(/\{([^}]*)\}/g, (m, v) => (v.toLowerCase() === 'n' ? String(n) : DOC_VARS.includes(v.toLowerCase()) ? doc : m));
    const stem = safeFileName(raw) || `${doc}_p${n}`;
    let candidate = stem;
    for (let k = 2; used.has(candidate.toLowerCase()); k++) candidate = `${stem} (${k})`;
    used.add(candidate.toLowerCase());
    return `${candidate}.${EXT[format] ?? 'png'}`;
  });
}

/** Resolución escrita por el usuario. → { dpi } o { error } */
export function parseDpi(text) {
  const s = String(text ?? '').trim();
  if (!/^\d{1,4}$/.test(s)) return { error: t('dialogs.img.dpiInvalid', { min: DPI_RANGE.min, max: DPI_RANGE.max }) };
  const dpi = Number(s);
  if (dpi < DPI_RANGE.min || dpi > DPI_RANGE.max) return { error: t('dialogs.img.dpiInvalid', { min: DPI_RANGE.min, max: DPI_RANGE.max }) };
  return { dpi };
}

/**
 * Píxeles de una página de w × h puntos (tal como se ve) a esa resolución. Si pasa de MAX_PIXELS se baja (capped).
 * → { scale (píxeles por punto, para el motor), width, height, dpi (la real), capped }
 */
export function pixelSize(w, h, dpi) {
  let scale = dpi / 72;
  const capped = w * h * scale * scale > MAX_PIXELS;
  if (capped) scale = Math.sqrt(MAX_PIXELS / (w * h));
  return { scale, width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), dpi: Math.round(scale * 72), capped };
}

// --- Resolución dentro del archivo ------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[n] = c >>> 0;
  }
  return tbl;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG con su resolución (chunk pHYs, en píxeles por metro) justo después de IHDR; si ya tenía uno, se cambia. */
export function setPngDpi(bytes, dpi) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (src.length < 33 || sig.some((v, i) => src[i] !== v)) return src;
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  // Quitar un pHYs anterior (si lo hay) y localizar el final de IHDR.
  const chunks = [];
  for (let o = 8; o + 12 <= src.length;) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...src.subarray(o + 4, o + 8));
    chunks.push({ o, end: o + 12 + len, type });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(21);
  const pv = new DataView(phys.buffer);
  pv.setUint32(0, 9);
  phys.set([112, 72, 89, 115], 4); // «pHYs»
  pv.setUint32(8, ppm);
  pv.setUint32(12, ppm);
  phys[16] = 1; // unidad: metro
  pv.setUint32(17, crc32(phys.subarray(4, 17)));
  const parts = [src.subarray(0, 8)];
  for (const c of chunks) {
    if (c.type === 'pHYs') continue;
    parts.push(src.subarray(c.o, c.end));
    if (c.type === 'IHDR') parts.push(phys);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** JPG con su resolución en la cabecera JFIF (APP0); si no la tiene, se deja como está. */
export function setJpegDpi(bytes, dpi) {
  const out = new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  // FF D8, FF E0, longitud (2), «JFIF\0», versión (2), unidades (1), densidad X (2), Y (2)
  if (out[0] !== 0xff || out[1] !== 0xd8 || out[2] !== 0xff || out[3] !== 0xe0) return out;
  if (String.fromCharCode(...out.subarray(6, 11)) !== 'JFIF\0') return out;
  const d = Math.min(65535, Math.round(dpi));
  out[13] = 1; // puntos por pulgada
  out[14] = d >> 8; out[15] = d & 0xff;
  out[16] = d >> 8; out[17] = d & 0xff;
  return out;
}

/** Lee la resolución de un PNG (pHYs) o un JPG (JFIF), para las pruebas. → ppp o null. */
export function readDpi(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xd8) return b[13] === 1 ? (b[14] << 8) | b[15] : null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let o = 8; o + 12 <= b.length;) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8));
    if (type === 'pHYs' && b[o + 16] === 1) return Math.round(view.getUint32(o + 8) * 0.0254);
    if (type === 'IEND') break;
    o += 12 + len;
  }
  return null;
}

// --- Lo último usado: «spiderpdf:imagen» -----------------------------------------------------------------
export const IMAGE_STORE = 'spiderpdf:imagen';
const DEFAULTS = { format: 'png', quality: 0.9, dpi: 150, custom: '200', pattern: '' };

export function loadImagePrefs(storage) {
  try {
    const v = JSON.parse(storage?.getItem(IMAGE_STORE) ?? '{}') ?? {};
    return {
      format: IMAGE_FORMATS.includes(v.format) ? v.format : DEFAULTS.format,
      quality: Number(v.quality) >= QUALITY_RANGE.min && Number(v.quality) <= QUALITY_RANGE.max ? Number(v.quality) : DEFAULTS.quality,
      dpi: IMAGE_DPIS.includes(v.dpi) || v.dpi === 'custom' ? v.dpi : DEFAULTS.dpi,
      custom: /^\d{1,4}$/.test(v.custom ?? '') ? v.custom : DEFAULTS.custom,
      pattern: typeof v.pattern === 'string' ? v.pattern.slice(0, 200) : DEFAULTS.pattern,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveImagePrefs(storage, prefs) {
  try {
    const { format, quality, dpi, custom, pattern } = prefs;
    storage?.setItem(IMAGE_STORE, JSON.stringify({ format, quality, dpi, custom, pattern }));
  } catch { /* sin almacenamiento */ }
}
