// Utilidades de firma sin DOM (se prueban en Node). Trabajan con objetos tipo ImageData:
// { width, height, data: Uint8ClampedArray RGBA }.

/**
 * Quita el fondo claro de una imagen escaneada o fotografiada: los píxeles más claros que
 * `threshold` pasan a transparentes y los de la franja `soft` por debajo, a semitransparentes
 * (bordes suaves). Devuelve una copia.
 */
export function removeBackground(img, threshold = 215, soft = 40) {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum >= threshold) data[i + 3] = 0;
    else if (lum > threshold - soft) data[i + 3] = Math.round(data[i + 3] * ((threshold - lum) / soft));
  }
  return { width: img.width, height: img.height, data };
}

/** Caja que contiene los píxeles visibles (alfa > minAlpha), o null si la imagen está vacía. */
export function alphaBounds(img, minAlpha = 8) {
  let x0 = img.width; let y0 = img.height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > minAlpha) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Caja ampliada con un margen, sin salirse de la imagen. */
export function padBounds(b, pad, width, height) {
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  return { x, y, w: Math.min(width, b.x + b.w + pad) - x, h: Math.min(height, b.y + b.h + pad) - y };
}

/** Grosor del trazo según la velocidad (px/ms): algo más fino cuanto más rápido, como una pluma. */
export function strokeWidth(speed, base) {
  return base * Math.max(0.7, Math.min(1.2, 1.2 - speed * 0.25));
}

/** Distancia mínima entre puntos de un trazo: los más cercanos solo añaden temblor. */
export const MIN_POINT_DIST = 2;

/**
 * Curva Catmull-Rom que pasa por todos los puntos, como tramos de Bézier cúbica.
 * pts: [{ x, y, w }] → [{ from, c1, c2, to, w }] (w = grosor medio del tramo).
 */
export function catmullRomSegments(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    out.push({
      from: [p1.x, p1.y],
      c1: [p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6],
      c2: [p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6],
      to: [p2.x, p2.y],
      w: (p1.w + p2.w) / 2,
    });
  }
  return out;
}

// --- Últimas firmas (localStorage) -----------------------------------------------------
const KEY = 'spiderpdf:firmas';
const MAX_RECENT = 5;
const MAX_BYTES = 400_000; // por firma, para no llenar el almacenamiento

export function loadRecent(storage) {
  try {
    const list = JSON.parse(storage?.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((s) => typeof s?.src === 'string' && s.src.startsWith('data:image/')) : [];
  } catch {
    return [];
  }
}

/** Añade una firma al principio (sin repetir) y guarda. Devuelve la lista nueva. */
export function rememberSignature(storage, sig) {
  const list = [sig, ...loadRecent(storage).filter((s) => s.src !== sig.src)]
    .filter((s) => s.src.length <= MAX_BYTES)
    .slice(0, MAX_RECENT);
  try { storage?.setItem(KEY, JSON.stringify(list)); } catch { /* almacenamiento lleno o bloqueado */ }
  return list;
}

export function forgetSignature(storage, src) {
  const list = loadRecent(storage).filter((s) => s.src !== src);
  try { storage?.setItem(KEY, JSON.stringify(list)); } catch { /* ignorar */ }
  return list;
}
