// Recorre las páginas del estado buscando tablas (en el worker: texto con cajas y líneas dibujadas).
import { pdf } from '../engine/client.js';
import { detectTables } from '../tables.js';

/** Tamaño de la página SIN girar en puntos (las cajas del texto vienen sin girar). */
export const unrotatedSize = (page) => ((page.rot0 ?? 0) % 2 === 1 ? { W: page.height, H: page.width } : { W: page.width, H: page.height });

/**
 * Tablas de las páginas, en orden de lectura: [{ page (desde 1), rows, kind, box }].
 * onProgress({ done, total }); isCancelled() → para a la siguiente página.
 */
export async function scanTables(pages, { onProgress, isCancelled } = {}) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    if (isCancelled?.()) break;
    const p = pages[i];
    const [chars, rules] = await Promise.all([pdf.pageChars(p).catch(() => null), pdf.rules(p.docId, p.index).catch(() => [])]);
    if (chars?.text) {
      const { W, H } = unrotatedSize(p);
      for (const t of detectTables(chars, rules, W, H)) out.push({ ...t, page: i + 1 });
    }
    onProgress?.({ done: i + 1, total: pages.length });
  }
  return out;
}
