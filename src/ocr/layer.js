// Capa de texto del OCR. Puro (test/ocr.test.js): lo usan la interfaz (buscar, seleccionar y copiar antes de guardar)
// y el motor (la escribe al guardar, pdfium-core applyOcr).
//
// Palabra: { t, a: [u, v], b: [u, v], size, line, space }. a y b son los extremos de su línea base en fracciones de la
// página SIN GIRAR (como las anotaciones, CLAUDE.md idea 3); size, el tamaño de letra en puntos; line, el número de
// línea; space, si le sigue un espacio (todas menos la última de cada línea).
import { fromDisplay } from '../geometry.js';
import { hasRealText } from '../textGeom.js';

/** Alto de letra respecto al alto de línea que da Tesseract (medido con Helvetica: 20 pt → 17,9 pt de línea). */
export const SIZE_FROM_ROW = 1.12;
const ASC = 0.8; // ascendente y descendente, en tamaños de letra: la caja de selección de cada letra
const DESC = 0.25;

/**
 * Resultado de Tesseract (con blocks) → palabras. back(x, y): de la imagen reconocida (enderezada) a la renderizada;
 * W × H, tamaño de la renderizada; dpi, su resolución; R, el giro de la página (rot0: la imagen se renderiza tal como
 * se ve). minConfidence: las palabras con menos confianza (ruido, manchas) se descartan.
 */
export function wordsFromResult(data, { back, W, H, dpi, R = 0, minConfidence = 15 }) {
  const out = [];
  let line = 0;
  const toPage = (x, y) => {
    const [ox, oy] = back(x, y);
    return fromDisplay(ox / W, oy / H, R).map((n) => Math.round(n * 1e5) / 1e5);
  };
  for (const block of data?.blocks ?? []) {
    for (const par of block.paragraphs ?? []) {
      for (const ln of par.lines ?? []) {
        const words = (ln.words ?? [])
          .map((w) => ({ ...w, text: String(w.text ?? '').trim() }))
          .filter((w) => w.text && w.confidence >= minConfidence && hasRealText(w.text));
        if (!words.length) continue;
        const bl = ln.baseline ?? {};
        const rowPx = ln.rowAttributes?.rowHeight || (words[0].bbox.y1 - words[0].bbox.y0);
        const size = Math.round(((rowPx * 72) / dpi) * SIZE_FROM_ROW * 100) / 100;
        const baseY = (x, w) => {
          if (bl.has_baseline === false || bl.x1 === bl.x0 || bl.x0 == null) return w.bbox.y1;
          return bl.y0 + ((bl.y1 - bl.y0) * (x - bl.x0)) / (bl.x1 - bl.x0);
        };
        words.forEach((w, i) => {
          const { x0, x1 } = w.bbox;
          out.push({
            t: w.text,
            a: toPage(x0, baseY(x0, w)),
            b: toPage(x1, baseY(x1, w)),
            size,
            line,
            space: i < words.length - 1,
            conf: Math.round(w.confidence),
          });
        });
        line++;
      }
    }
  }
  return out;
}

/** Confianza media del resultado, ponderada por letras (0-100; 0 si no hay palabras). */
export function meanConfidence(data) {
  let sum = 0; let n = 0;
  for (const b of data?.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) {
    for (const w of l.words ?? []) {
      const len = String(w.text ?? '').trim().length;
      sum += (w.confidence ?? 0) * len;
      n += len;
    }
  }
  return n ? sum / n : 0;
}

/**
 * Texto y cajas por carácter de la capa, como textChars del motor: { text, boxes, generated, hasText }. Las letras de
 * cada palabra se reparten a partes iguales a lo largo de su línea base; los espacios ocupan el hueco hasta la
 * siguiente; las líneas se separan con «\r\n» generados (sin caja). pw × ph: tamaño de la página sin girar (puntos).
 */
export function ocrChars(words, pw, ph) {
  let text = '';
  const boxes = [];
  const generated = [];
  const pt = ([u, v]) => [u * pw, v * ph];
  const frac = ([x0, y0, x1, y1]) => [x0 / pw, y0 / ph, x1 / pw, y1 / ph];
  const quad = (p, q, dir, size) => {
    const up = [dir[1] * ASC * size, -dir[0] * ASC * size]; // perpendicular hacia arriba (y hacia abajo en la página)
    const dn = [-dir[1] * DESC * size, dir[0] * DESC * size];
    const xs = [p[0] + up[0], p[0] + dn[0], q[0] + up[0], q[0] + dn[0]];
    const ys = [p[1] + up[1], p[1] + dn[1], q[1] + up[1], q[1] + dn[1]];
    return frac([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  };
  const push = (ch, box, gen = 0) => { text += ch; boxes.push(...(box ?? [0, 0, 0, 0])); generated.push(gen); };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && prev.line !== w.line) { push('\r', null, 1); push('\n', null, 1); }
    const A = pt(w.a); const B = pt(w.b);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const dir = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    const chars = [...w.t];
    chars.forEach((ch, k) => {
      const p = [A[0] + dir[0] * len * (k / chars.length), A[1] + dir[1] * len * (k / chars.length)];
      const q = [A[0] + dir[0] * len * ((k + 1) / chars.length), A[1] + dir[1] * len * ((k + 1) / chars.length)];
      push(ch, quad(p, q, dir, w.size));
    });
    const next = words[i + 1];
    if (w.space && next && next.line === w.line) push(' ', quad(B, pt(next.a), dir, w.size));
  });
  return { text, boxes: Float32Array.from(boxes), generated: Uint8Array.from(generated), hasText: hasRealText(text) };
}

/**
 * Quita las palabras que caen sobre texto que la página ya tiene (al reconocer «todo el documento» no se duplica lo
 * que ya se podía buscar). existing: cajas por carácter [u0, v0, u1, v1, …] del texto original.
 */
export function dropCovered(words, existing, pw, ph) {
  if (!existing?.length) return words;
  const rects = [];
  for (let i = 0; i < existing.length; i += 4) {
    if (existing[i + 2] > existing[i] && existing[i + 3] > existing[i + 1]) rects.push(existing.subarray ? existing.subarray(i, i + 4) : existing.slice(i, i + 4));
  }
  if (!rects.length) return words;
  const { boxes } = ocrChars(words, pw, ph);
  // Caja de cada palabra = unión de las de sus letras (en el orden de ocrChars, sin espacios ni saltos).
  let k = 0;
  return words.filter((w, i) => {
    if (i > 0 && words[i - 1].line !== w.line) k += 2; // «\r\n»
    let u0 = 1; let v0 = 1; let u1 = 0; let v1 = 0;
    for (let c = 0; c < [...w.t].length; c++, k++) {
      u0 = Math.min(u0, boxes[k * 4]); v0 = Math.min(v0, boxes[k * 4 + 1]);
      u1 = Math.max(u1, boxes[k * 4 + 2]); v1 = Math.max(v1, boxes[k * 4 + 3]);
    }
    const next = words[i + 1];
    if (w.space && next && next.line === w.line) k++;
    const cu = (u0 + u1) / 2; const cv = (v0 + v1) / 2;
    return !rects.some((r) => cu >= r[0] && cu <= r[2] && cv >= r[1] && cv <= r[3]);
  });
}
