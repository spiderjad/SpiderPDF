// Reconocer una página: enderezarla si hace falta, pasarla por Tesseract y devolver la capa de texto.
// Independiente del entorno (test/engine.test.js lo usa en Node con Tesseract real; la interfaz, en el navegador):
// recognize(pgm) → resultado de Tesseract con blocks.
import { rotate, toPgm } from './image.js';
import { analyze } from './deskew.js';
import { wordsFromResult, meanConfidence } from './layer.js';

export const OCR_DPI = 300; // resolución a la que se renderiza cada página para reconocerla
export const GOOD_CONFIDENCE = 60; // con menos, se prueba también la página dada la vuelta

/**
 * gray: la página renderizada en gris a dpi ({ w, h, data }); R: su giro propio (rot0).
 * → { words, angle, confidence } con angle el giro (grados, sentido horario) que se aplicó para reconocerla:
 *   0 si estaba recta; ±n si estaba torcida; 90/180/270 (+ inclinación) si estaba girada.
 */
export async function ocrPage(gray, { dpi = OCR_DPI, R = 0, recognize, isCancelled }) {
  const an = analyze(gray);
  if (an.empty) return { words: [], angle: 0, confidence: 0 };
  const candidates = an.quarter ? [90, 270] : [0, 180];
  let best = null;
  for (const base of candidates) {
    if (isCancelled?.()) throw Object.assign(new Error('Cancelado'), { cancelled: true });
    const angle = base + an.skew;
    const img = angle === 0 ? { ...gray, back: (x, y) => [x, y] } : rotate(gray, angle);
    const data = await recognize(toPgm(img));
    const confidence = meanConfidence(data);
    if (!best || confidence > best.confidence) best = { data, img, angle, confidence };
    if (confidence >= GOOD_CONFIDENCE) break;
  }
  const words = wordsFromResult(best.data, { back: best.img.back, W: gray.w, H: gray.h, dpi, R });
  return { words, angle: ((best.angle % 360) + 360) % 360, confidence: Math.round(best.confidence) };
}
