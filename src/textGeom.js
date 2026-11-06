// Texto de una página: búsqueda, selección y rectángulos por línea (sin DOM; lo usan el motor y la UI).
// Los caracteres vienen del motor como { text, boxes, generated }:
//   text       una letra por carácter de PDFium (text[i] es el carácter i)
//   boxes      Float32Array de 4 por carácter: [u0, v0, u1, v1] en fracciones SIN rotar (v hacia abajo)
//   generated  Uint8Array: 1 si PDFium lo añadió (espacios y saltos de línea entre bloques)

const MARKS = /[̀-ͯ]/g;
const isSpace = (c) => /\s/.test(c);

/**
 * Texto preparado para buscar sin distinguir mayúsculas ni tildes, con los espacios y saltos de línea
 * reducidos a un solo espacio. map[k] = carácter original del que sale la letra k de norm.
 */
export function normalizeForSearch(text) {
  let norm = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (isSpace(c)) {
      if (norm && norm[norm.length - 1] !== ' ') { norm += ' '; map.push(i); }
      continue;
    }
    for (const d of c.normalize('NFKD').replace(MARKS, '').toLowerCase()) { norm += d; map.push(i); }
  }
  return { norm, map };
}

/** La consulta, normalizada igual que el texto. */
export function normalizeQuery(q) {
  return normalizeForSearch(q.trim()).norm.trim();
}

/** Todas las apariciones (sin solaparse) como rangos de caracteres originales [start, end). */
export function findMatches(text, query) {
  const q = normalizeQuery(query);
  if (!q) return [];
  const { norm, map } = normalizeForSearch(text);
  const out = [];
  for (let pos = norm.indexOf(q); pos >= 0; pos = norm.indexOf(q, pos + q.length)) {
    out.push({ start: map[pos], end: map[pos + q.length - 1] + 1 });
  }
  return out;
}

const boxAt = (boxes, i) => [boxes[i * 4], boxes[i * 4 + 1], boxes[i * 4 + 2], boxes[i * 4 + 3]];
const usable = (boxes, generated, i) => !generated?.[i] && boxes[i * 4 + 2] > boxes[i * 4] && boxes[i * 4 + 3] > boxes[i * 4 + 1];

/** ¿Dos cajas están en la misma línea? (se solapan en vertical al menos la mitad de la más baja) */
function sameLine(a, b) {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return overlap > 0.5 * Math.min(a[3] - a[1], b[3] - b[1]);
}

/** Rectángulos (uno por línea) que cubren los caracteres [from, to). */
export function lineRects(boxes, generated, from, to) {
  const out = [];
  let cur = null;
  for (let i = from; i < to; i++) {
    if (!usable(boxes, generated, i)) continue;
    const b = boxAt(boxes, i);
    const gap = 2.5 * (b[3] - b[1]); // un hueco mayor parte el rectángulo (columnas)
    if (cur && sameLine(cur, b) && b[0] <= cur[2] + gap && b[2] >= cur[0] - gap) {
      cur = [Math.min(cur[0], b[0]), Math.min(cur[1], b[1]), Math.max(cur[2], b[2]), Math.max(cur[3], b[3])];
    } else {
      if (cur) out.push(cur);
      cur = b;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Posición del cursor de texto (0..n, «antes del carácter i») para un punto (u, v) sin rotar.
 * Dentro de un carácter: antes o después según la mitad. En la misma línea: el más cercano en horizontal.
 * Fuera de toda línea: el carácter más cercano. Devuelve -1 si la página no tiene texto.
 */
export function caretAt(boxes, generated, u, v) {
  const n = boxes.length / 4;
  // 1. La línea más cercana en vertical (como hace un navegador: primero la línea, luego la letra).
  let near = -1;
  let nearDy = Infinity;
  let nearDx = Infinity;
  for (let i = 0; i < n; i++) {
    if (!usable(boxes, generated, i)) continue;
    const [u0, v0, u1, v1] = boxAt(boxes, i);
    if (u >= u0 && u <= u1 && v >= v0 && v <= v1) return u > (u0 + u1) / 2 ? i + 1 : i;
    const dx = u < u0 ? u0 - u : u > u1 ? u - u1 : 0;
    const dy = v < v0 ? v0 - v : v > v1 ? v - v1 : 0;
    if (dy < nearDy - 1e-9 || (Math.abs(dy - nearDy) <= 1e-9 && dx < nearDx)) { near = i; nearDy = dy; nearDx = dx; }
  }
  if (near < 0) return -1;
  // 2. Dentro de esa línea, la letra más cercana en horizontal.
  const line = boxAt(boxes, near);
  let best = near;
  let bestDx = Infinity;
  for (let i = 0; i < n; i++) {
    if (!usable(boxes, generated, i)) continue;
    const b = boxAt(boxes, i);
    if (!sameLine(b, line)) continue;
    const dx = u < b[0] ? b[0] - u : u > b[2] ? u - b[2] : 0;
    if (dx < bestDx) { bestDx = dx; best = i; }
  }
  const [u0, , u1] = boxAt(boxes, best);
  return u > (u0 + u1) / 2 ? best + 1 : best;
}

/** Carácter bajo el punto (u, v) sin rotar, o -1 (para el cursor de texto). */
export function charIndexAt(boxes, generated, u, v) {
  const n = boxes.length / 4;
  for (let i = 0; i < n; i++) {
    if (!usable(boxes, generated, i)) continue;
    if (u >= boxes[i * 4] && u <= boxes[i * 4 + 2] && v >= boxes[i * 4 + 1] && v <= boxes[i * 4 + 3]) return i;
  }
  return -1;
}

/** Palabra que contiene el carácter i: [start, end). Si i no es letra ni número, solo ese carácter. */
export function wordAt(text, i) {
  const isWord = (c) => /[\p{L}\p{N}_'’-]/u.test(c ?? '');
  if (!isWord(text[i])) return [i, Math.min(text.length, i + 1)];
  let a = i;
  let b = i + 1;
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  return [a, b];
}

/** Texto a copiar de [from, to): saltos de línea de PDFium como \n y sin espacios al final de cada línea. */
export function selectedText(text, from, to) {
  return text.slice(from, to).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

/** ¿La página tiene texto real? (si no, es una imagen escaneada) */
export function hasRealText(text) {
  return /[\p{L}\p{N}]/u.test(text);
}
