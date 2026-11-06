// Páginas nuevas que no vienen de ningún PDF (página en blanco, imagen como página). Puro: se prueba en Node.
// En el estado son páginas con docId: null, index: -1 y created = { kind: 'blank' } |
// { kind: 'image', blob, pxW, pxH, name }. compose() las crea al guardar (FPDFPage_New).
import { newKey } from './state.js';

const displaySize = (p) => (p.rot % 2 ? { w: p.height, h: p.width } : { w: p.width, h: p.height });

export const A4 = { width: 595.28, height: 841.89 };
export const A3 = { width: 841.89, height: 1190.55 };
const IMAGE_DPI = 150; // la página toma el tamaño de la imagen a 150 ppp…
const MAX_EMBED_DPI = 300; // …y nunca se incrustan más de 300 ppp

export const isCreated = (page) => page.docId == null;

/** Tamaño de una página en blanco: el de la página de referencia tal como se ve, o A4. */
export function blankSize(ref) {
  if (!ref) return { ...A4 };
  const { w, h } = displaySize(ref);
  return { width: w, height: h };
}

/**
 * Página para una imagen de pxW × pxH píxeles: su tamaño a 150 ppp, como mucho A3 (en la orientación de la
 * imagen). → { width, height } en puntos y { pxW, pxH } a incrustar (reducida si pasa de 300 ppp).
 */
export function imagePageSize(pxW, pxH) {
  let width = (pxW * 72) / IMAGE_DPI;
  let height = (pxH * 72) / IMAGE_DPI;
  const landscape = pxW > pxH;
  const maxW = landscape ? A3.height : A3.width;
  const maxH = landscape ? A3.width : A3.height;
  const k = Math.min(1, maxW / width, maxH / height);
  width *= k;
  height *= k;
  const e = Math.min(1, (width * MAX_EMBED_DPI) / 72 / pxW);
  return { width, height, pxW: Math.max(1, Math.round(pxW * e)), pxH: Math.max(1, Math.round(pxH * e)) };
}

/** Dónde insertar: tras la última página seleccionada; si no hay, tras la actual al leer; si no, al final. */
export function insertIndex(s) {
  const sel = s.pages.reduce((last, p, i) => (s.selected.has(p.key) ? i : last), -1);
  if (sel >= 0) return sel + 1;
  if (s.mode === 'read' && s.pages.length) return s.current + 1;
  return s.pages.length;
}

/** Página de referencia para el tamaño de una página en blanco: la última seleccionada, o la actual al leer. */
export function referencePage(s) {
  const sel = [...s.pages].reverse().find((p) => s.selected.has(p.key));
  if (sel) return sel;
  return s.mode === 'read' ? s.pages[s.current] : null;
}

function base(created, size, source) {
  return {
    key: newKey(), docId: null, index: -1, width: size.width, height: size.height, rot0: 0, rot: 0,
    source, hasForm: false, annots: [], fields: {}, textEdits: {}, created,
  };
}

export const blankPage = (size) => base({ kind: 'blank' }, size, 'Página en blanco');

export function imagePage({ blob, pxW, pxH, name }) {
  const size = imagePageSize(pxW, pxH);
  return base({ kind: 'image', blob, pxW: size.pxW, pxH: size.pxH, name }, size, name.replace(/\.[^.]+$/, ''));
}
