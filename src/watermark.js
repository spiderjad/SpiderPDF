// Marca de agua (Editar → Marca de agua…). Lógica pura, compartida por la interfaz (vista previa en SVG,
// src/components/WatermarkLayer.jsx) y el motor (contenido de la página, pdfium-core.js → addWatermark).
//
// Una marca de agua:
//   { kind: 'text' | 'image', text, family: 'sans'|'serif'|'mono', bold, size (pt), color, opacity (0-1),
//     rotation: 'diagonal'|'horizontal'|'vertical'|'custom', angle (grados en sentido antihorario; solo 'custom'),
//     position: 'center' | 'tile', layer: 'front' | 'back',
//     image: { src (data URL), pxW, pxH } | null, scale (ancho de la imagen, en fracción del ancho de la página) }
// Se coloca sobre la página tal como se ve (con su giro): queda derecha en pantalla, como un sello.
// En el estado, cada página lleva la suya en page.watermark; page.stripWm = quitar al guardar las marcas de agua
// que el PDF ya trae de SpiderPDF (el motor las reconoce por su marca de contenido, WM_MARK en pdfium-core.js).
import { parseRange } from './printLayout.js';

export const WM_PRESETS = [
  { id: 'draft', key: 'core.wm.preset.draft' },
  { id: 'copy', key: 'core.wm.preset.copy' },
  { id: 'confidential', key: 'core.wm.preset.confidential' },
];
export const WM_COLORS = [
  ['#6B7280', 'core.color.gray'], ['#B91C1C', 'core.color.red'], ['#1D4ED8', 'core.color.blue'], ['#111827', 'core.color.black'],
];
export const WM_FAMILIES = ['sans', 'serif', 'mono'];
export const WM_ROTATIONS = ['diagonal', 'horizontal', 'vertical', 'custom'];
export const WM_TEXT_MAX = 60;
export const WM_SIZE = { min: 8, max: 300 };
export const WM_OPACITY = { min: 0.05, max: 1 };
export const WM_SCALE = { min: 0.05, max: 1 };
const MAX_TILES = 400; // en mosaico, como mucho (un texto diminuto no debe llenar la página de miles de copias)

export const DEFAULT_WM = {
  kind: 'text', text: '', family: 'sans', bold: true, size: 72, color: WM_COLORS[0][0], opacity: 0.3,
  rotation: 'diagonal', angle: 45, position: 'center', layer: 'front', image: null, scale: 0.5,
};

const clamp = (v, { min, max }, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : d);
const HEX = /^#[0-9a-f]{6}$/i;

/** Marca de agua con todos sus campos y dentro de los límites (lo que venga de fuera: recordado, otra ventana). */
export function normalizeWm(w) {
  const d = DEFAULT_WM;
  const img = w?.image;
  return {
    kind: w?.kind === 'image' ? 'image' : 'text',
    text: String(w?.text ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, WM_TEXT_MAX),
    family: WM_FAMILIES.includes(w?.family) ? w.family : d.family,
    bold: w?.bold == null ? d.bold : !!w.bold,
    size: Math.round(clamp(w?.size, WM_SIZE, d.size)),
    color: HEX.test(w?.color ?? '') ? w.color.toUpperCase() : d.color,
    opacity: Math.round(clamp(w?.opacity, WM_OPACITY, d.opacity) * 100) / 100,
    rotation: WM_ROTATIONS.includes(w?.rotation) ? w.rotation : d.rotation,
    angle: Math.round(clamp(w?.angle, { min: -180, max: 180 }, d.angle)),
    position: w?.position === 'tile' ? 'tile' : 'center',
    layer: w?.layer === 'back' ? 'back' : 'front',
    image: img && typeof img.src === 'string' && img.pxW > 0 && img.pxH > 0 ? { src: img.src, pxW: img.pxW, pxH: img.pxH } : null,
    scale: Math.round(clamp(w?.scale, WM_SCALE, d.scale) * 100) / 100,
  };
}

/** ¿Se puede aplicar? Texto: algo escrito; imagen: una imagen elegida. */
export function wmReady(w) {
  return w?.kind === 'image' ? !!w.image?.src : !!String(w?.text ?? '').trim();
}

/** Giro visible, en grados en sentido antihorario. Diagonal = de la esquina de abajo a la izquierda a la de arriba a la derecha. */
export function wmAngle(w, W, H) {
  switch (w.rotation) {
    case 'horizontal': return 0;
    case 'vertical': return 90;
    case 'custom': return w.angle ?? 0;
    default: return (Math.atan2(H, W) * 180) / Math.PI;
  }
}

/** Tamaño de la imagen en puntos sobre una página de W puntos de ancho (visible). */
export function imageBox(w, W) {
  const iw = W * w.scale;
  return { w: iw, h: (iw * w.image.pxH) / w.image.pxW };
}

/**
 * Dónde va cada copia en una página de W × H puntos (tal como se ve; y hacia abajo), para una marca de bw × bh
 * puntos (su tinta, sin girar). → { angle, centers: [[x, y], …] }.
 * Centrada: una en el centro. En mosaico: filas en la dirección del texto, alternas desplazadas media copia, con
 * huecos proporcionales a la altura; solo las copias que se ven (aunque sea en parte).
 */
export function wmPlacements(w, { W, H }, { w: bw, h: bh }) {
  const angle = wmAngle(w, W, H);
  if (w.position !== 'tile' || !(bw > 0) || !(bh > 0)) return { angle, centers: [[W / 2, H / 2]] };
  const a = (angle * Math.PI) / 180;
  const ux = Math.cos(a); const uy = -Math.sin(a); // a lo largo del texto (en pantalla, y hacia abajo)
  const nx = Math.sin(a); const ny = Math.cos(a); // de una fila a la siguiente
  const su = bw + Math.max(bh * 1.5, 24);
  const sn = bh + Math.max(bh * 2, 36);
  const ex = Math.abs(ux) * bw / 2 + Math.abs(nx) * bh / 2; // media caja girada, en horizontal
  const ey = Math.abs(uy) * bw / 2 + Math.abs(ny) * bh / 2; // y en vertical
  const reach = Math.hypot(W, H) / 2 + Math.max(bw, bh);
  const ni = Math.ceil(reach / su) + 1;
  const nj = Math.ceil(reach / sn) + 1;
  const centers = [];
  for (let j = -nj; j <= nj; j++) {
    const shift = (Math.abs(j) % 2) * su / 2;
    for (let i = -ni; i <= ni; i++) {
      const s = i * su + shift;
      const x = W / 2 + s * ux + j * sn * nx;
      const y = H / 2 + s * uy + j * sn * ny;
      if (x + ex > 0 && x - ex < W && y + ey > 0 && y - ey < H) centers.push([x, y]);
    }
  }
  // De arriba abajo y de izquierda a derecha (orden estable, igual en pantalla y en el PDF).
  centers.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  return { angle, centers: centers.slice(0, MAX_TILES) };
}

/**
 * Páginas a las que se aplica: 'all', 'range' (texto «1-3, 5») o 'selection'. → { keys: [key] } o { error }.
 */
export function wmTargets(pages, mode, { range = '', selected = new Set() } = {}) {
  if (mode === 'selection') {
    const keys = pages.filter((p) => selected.has(p.key)).map((p) => p.key);
    return keys.length ? { keys } : { error: 'selection' };
  }
  if (mode === 'range') {
    const r = parseRange(range, pages.length);
    return r.error ? { error: r.error } : { keys: r.pages.map((i) => pages[i].key) };
  }
  return { keys: pages.map((p) => p.key) };
}

// --- Lo último usado (sin la imagen): «spiderpdf:marca-agua» -----------------------------------------------
export const WM_STORE = 'spiderpdf:marca-agua';

export function loadWmPrefs(storage) {
  try {
    const raw = storage?.getItem(WM_STORE);
    return normalizeWm({ ...(raw ? JSON.parse(raw) : {}), image: null });
  } catch {
    return normalizeWm({});
  }
}

export function saveWmPrefs(storage, w) {
  try {
    const { image: _img, ...rest } = normalizeWm(w);
    storage?.setItem(WM_STORE, JSON.stringify(rest));
  } catch { /* sin almacenamiento */ }
}
