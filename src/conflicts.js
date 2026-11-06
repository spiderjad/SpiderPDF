// Elementos del usuario que quedan encima de una zona a redactar (sin DOM; se prueba en Node).
// Al guardar, la redacción va la última y los borra: la interfaz avisa antes.

import { t } from './i18n/index.js';

export const NOTE_PT = 20; // lado del icono de nota en el PDF, en puntos (ver pdfium-core addAnnot)

const overlaps = ([a0, b0, a1, b1], [c0, d0, c1, d1]) => a0 < c1 && a1 > c0 && b0 < d1 && b1 > d0;

/** Ancho y alto de la página sin rotar (CropBox), en puntos. */
function unrotatedSize(page) {
  return (page.rot0 ?? 0) % 2 ? [page.height, page.width] : [page.width, page.height];
}

/** Caja de una nota en fracciones sin rotar. */
export function noteRect(a, page) {
  const [w, h] = unrotatedSize(page);
  return [a.at[0], a.at[1], a.at[0] + NOTE_PT / w, a.at[1] + NOTE_PT / h];
}

/**
 * Conflictos de una página: [{ kind: 'image' | 'note' | 'text' | 'textbox', id }]
 * id es el id de la anotación, o el objIndex del texto editado. runs: bloques de texto de la página
 * (hacen falta solo si hay textos editados).
 */
export function redactConflicts(page, runs = []) {
  const zones = (page.annots ?? []).filter((a) => a.type === 'redact').map((a) => a.rect);
  if (!zones.length) return [];
  const hit = (rect) => zones.some((z) => overlaps(rect, z));
  const out = [];
  for (const a of page.annots) {
    if (a.type === 'image' && hit(a.rect)) out.push({ kind: 'image', id: a.id });
    if (a.type === 'textbox' && a.text?.trim() && hit(a.rect)) out.push({ kind: 'textbox', id: a.id });
    if (a.type === 'note' && hit(noteRect(a, page))) out.push({ kind: 'note', id: a.id });
  }
  const edits = page.textEdits ?? {};
  for (const r of runs) {
    const e = edits[r.objIndex];
    if (e && e.text !== '' && hit(r.rect)) out.push({ kind: 'text', id: r.objIndex });
  }
  return out;
}

/** Mensaje del aviso para un conflicto (kind: 'image' | 'note' | 'text' | 'textbox'). */
export function conflictMessage(kind) {
  return t(`reader.conflicts.${kind}`);
}
