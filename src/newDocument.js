// «Nuevo documento» (Archivo → Nuevo documento…, Ctrl+N): un documento de páginas en blanco que no viene de ningún
// PDF. Puro: se prueba en Node (test/insert.test.js). Las páginas son las mismas que «Insertar página en blanco»
// (docId: null); al guardar, compose() parte de FPDF_CreateNewDocument.
import { blankPage } from './insertPages.js';
import { t } from './i18n/index.js';

const MM = 72 / 25.4;

/** Tamaños de página, en puntos y en vertical. */
export const PAGE_SIZES = {
  A4: { label: 'A4', hint: '210 × 297 mm', width: 210 * MM, height: 297 * MM },
  Letter: { get label() { return t('dialogs.paper.letter'); }, hint: '216 × 279 mm', width: 612, height: 792 },
  A3: { label: 'A3', hint: '297 × 420 mm', width: 297 * MM, height: 420 * MM },
};

export const MAX_NEW_PAGES = 500;
export const DEFAULT_NEW_DOC = { size: 'A4', landscape: false, count: 1 };

/** Número de páginas válido (1 a MAX_NEW_PAGES); lo que no es un número, 1. */
export function clampCount(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_NEW_PAGES, Math.max(1, v)) : 1;
}

/** Tamaño de cada página: { width, height } en puntos, girado si es horizontal. Tamaño desconocido → A4. */
export function newPageSize(size, landscape) {
  const s = PAGE_SIZES[size] ?? PAGE_SIZES.A4;
  return landscape ? { width: s.height, height: s.width } : { width: s.width, height: s.height };
}

/** Las páginas del documento nuevo. */
export function newDocumentPages({ size, landscape, count } = DEFAULT_NEW_DOC) {
  const dims = newPageSize(size, landscape);
  return Array.from({ length: clampCount(count) }, () => blankPage(dims));
}
