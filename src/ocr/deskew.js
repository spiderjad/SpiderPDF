// Escaneos torcidos o girados: de qué lado van las líneas de texto y cuánto se inclinan. Puro (test/ocr.test.js).
// Método: perfil de proyección. Con los píxeles de tinta de una imagen reducida, se suman por filas a lo largo de
// cada ángulo candidato; cuando el ángulo coincide con el de las líneas, las filas de texto y los huecos entre ellas
// quedan muy marcados (la suma de diferencias al cuadrado entre filas vecinas es máxima).
import { downscale } from './image.js';

const WORK = 1000; // la imagen se reduce a este lado como mucho
export const MAX_SKEW = 10; // grados: más que esto no es «torcido», es otra cosa
export const MIN_SKEW = 0.4; // por debajo no se endereza (no merece la pena y la página se queda como está)

/** Puntos de tinta (umbral de Otsu) de la imagen reducida. → { xs, ys, w, h, k } */
export function inkPoints(img) {
  const s = downscale(img, WORK);
  const hist = new Uint32Array(256);
  for (const v of s.data) hist[v]++;
  const thr = otsu(hist, s.data.length);
  const xs = []; const ys = [];
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) if (s.data[y * s.w + x] < thr) { xs.push(x); ys.push(y); }
  }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys), w: s.w, h: s.h, k: s.k };
}

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0; let wB = 0; let best = 0; let thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB; const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = i; }
  }
  return thr + 1;
}

/** Nitidez del perfil de filas con los puntos girados deg grados (líneas horizontales si vertical = false). */
export function profileScore(pts, deg, vertical = false) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad); const sin = Math.sin(rad);
  const size = Math.ceil(Math.hypot(pts.w, pts.h)) + 2;
  const off = size / 2;
  const bins = new Float64Array(size);
  for (let i = 0; i < pts.xs.length; i++) {
    const x = vertical ? pts.ys[i] : pts.xs[i];
    const y = vertical ? pts.xs[i] : pts.ys[i];
    const r = Math.round(y * cos - x * sin + off);
    if (r >= 0 && r < size) bins[r]++;
  }
  let s = 0;
  for (let i = 1; i < size; i++) s += (bins[i] - bins[i - 1]) ** 2;
  return s;
}

/** Mejor ángulo en [-MAX_SKEW, MAX_SKEW]: pasada gruesa de 0,5° y fina de 0,05°. → { angle, score } */
export function bestAngle(pts, vertical = false) {
  let best = { angle: 0, score: -1 };
  for (let a = -MAX_SKEW; a <= MAX_SKEW + 1e-9; a += 0.5) {
    const score = profileScore(pts, a, vertical);
    if (score > best.score) best = { angle: a, score };
  }
  const center = best.angle;
  for (let a = center - 0.5; a <= center + 0.5 + 1e-9; a += 0.05) {
    const score = profileScore(pts, a, vertical);
    if (score > best.score) best = { angle: a, score };
  }
  return { angle: Math.round(best.angle * 100) / 100, score: best.score };
}

/**
 * Cómo enderezar la página antes de reconocer: { quarter: 0 | 1, skew } con quarter 1 si las líneas de texto van en
 * vertical (escaneo girado 90°: hay que probar 90 y 270) y skew el giro, en grados y sentido horario, que deja las
 * líneas horizontales (0 si es menor que MIN_SKEW). El giro de 180° no se distingue así: lo decide la confianza del
 * OCR (src/ocr/run.js). Sin tinta suficiente → { quarter: 0, skew: 0, empty: true }.
 */
export function analyze(img) {
  const pts = inkPoints(img);
  if (pts.xs.length < 200) return { quarter: 0, skew: 0, empty: true };
  const h = bestAngle(pts, false);
  const v = bestAngle(pts, true);
  const vertical = v.score > h.score * 1.3;
  const r = vertical ? v : h;
  // Perfil horizontal: el ángulo que alinea las filas es el contrario de la inclinación del texto.
  const skew = Math.abs(r.angle) < MIN_SKEW ? 0 : (vertical ? r.angle : -r.angle);
  return { quarter: vertical ? 1 : 0, skew };
}
