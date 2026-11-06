// Recorre las páginas del estado para exportar a Word: texto (con su OCR sin guardar), aspecto de cada letra,
// tablas e imágenes (ya codificadas en el worker). El análisis es puro (src/export/docLayout.js).
import { pdf } from '../engine/client.js';
import { detectTables } from '../tables.js';
import { analyzePage } from './docLayout.js';
import { unrotatedSize } from './scan.js';

/**
 * → { pages: [analizada], images: Map(imagen → { type, bytes }) }. onProgress({ done, total });
 * isCancelled() → para a la siguiente página. withImages: false = sin imágenes (más ligero).
 */
export async function scanDocument(pages, { onProgress, isCancelled, withImages = true } = {}) {
  const out = [];
  const images = new Map();
  for (let i = 0; i < pages.length; i++) {
    if (isCancelled?.()) break;
    const p = pages[i];
    const { W, H } = unrotatedSize(p);
    const [chars, styles, rules, imgs] = await Promise.all([
      pdf.pageChars(p).catch(() => null),
      pdf.charStyles(p.docId, p.index).catch(() => null),
      pdf.rules(p.docId, p.index).catch(() => []),
      withImages ? pdf.pageImages(p.docId, p.index).catch(() => []) : [],
    ]);
    const list = [...imgs];
    // Página nueva hecha de una imagen (Insertar → Imagen como página): la imagen ocupa la página.
    if (withImages && p.created?.kind === 'image' && p.created.blob) {
      const type = /png/.test(p.created.blob.type) ? 'png' : 'jpg';
      list.push({ rect: [0, 0, 1, 1], width: p.created.pxW, height: p.created.pxH, type, bytes: new Uint8Array(await p.created.blob.arrayBuffer()) });
    }
    for (const im of list) images.set(im, { type: im.type, bytes: im.bytes });
    const tables = chars?.text ? detectTables(chars, rules, W, H) : [];
    out.push(analyzePage({ chars, styles, W, H, tables, images: list }));
    onProgress?.({ done: i + 1, total: pages.length });
  }
  return { pages: out, images };
}
