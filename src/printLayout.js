// Impresión: papel, intervalo de páginas y colocación de cada página en la hoja. Puro (lo usan la vista
// previa del diálogo y el proceso principal, que monta las hojas con estos mismos números); probado en
// test/print.test.js. Medidas en puntos (1/72").
import { t } from './i18n/index.js';

const MM = 72 / 25.4;

/** Papeles (en vertical). electron: valor de pageSize para webContents.print(). */
export const PAPERS = {
  A4: { label: 'A4', w: 210 * MM, h: 297 * MM, electron: 'A4' },
  Letter: { get label() { return t('dialogs.paper.letter'); }, w: 612, h: 792, electron: 'Letter' },
  A3: { label: 'A3', w: 297 * MM, h: 420 * MM, electron: 'A3' },
  Legal: { get label() { return t('dialogs.paper.legal'); }, w: 612, h: 1008, electron: 'Legal' },
};

/** Margen al «Ajustar a la página»: las impresoras no llegan al borde del papel. */
export const FIT_MARGIN = 5 * MM;

/**
 * Intervalo escrito por el usuario («1-3, 5», «7-», «-2») → índices (desde 0), en orden y sin repetir.
 * → { pages } o { error } con un texto para mostrar.
 */
export function parseRange(text, total) {
  const parts = String(text ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { error: t('dialogs.print.rangeEmpty') };
  const out = new Set();
  for (const part of parts) {
    let a;
    let b;
    let m;
    if ((m = /^(\d+)$/.exec(part))) {
      a = b = Number(m[1]);
    } else if ((m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part)) && (m[1] || m[2])) {
      a = m[1] ? Number(m[1]) : 1; // «-3»: desde la primera
      b = m[2] ? Number(m[2]) : total; // «7-»: hasta la última
    } else {
      return { error: t('dialogs.print.rangeInvalid', { part }) };
    }
    if (a < 1 || b < 1 || a > total || b > total) return { error: t('dialogs.print.rangeOut', { count: total }) };
    if (a > b) return { error: t('dialogs.print.rangeReversed', { part }) };
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  return { pages: [...out].sort((x, y) => x - y) };
}

/**
 * Páginas a imprimir según la opción de intervalo.
 * range: 'all' | 'current' | 'selection' | 'custom'. → { pages: [página del estado] } o { error }
 */
export function resolvePages(state, range, custom = '') {
  if (range === 'current') return { pages: state.pages[state.current] ? [state.pages[state.current]] : [] };
  if (range === 'selection') return { pages: state.pages.filter((p) => state.selected.has(p.key)) };
  if (range === 'custom') {
    const r = parseRange(custom, state.pages.length);
    return r.error ? r : { pages: r.pages.map((i) => state.pages[i]) };
  }
  return { pages: state.pages };
}

/**
 * Dónde va una página de w × h puntos (ya con su giro) en una hoja del papel dado (en vertical).
 *   fit: 'fit' (ajustar al área con margen, ampliando o reduciendo) | 'actual' (tamaño real, centrada; lo que
 *        no quepa se corta)
 *   autoRotate: girar 90° las páginas apaisadas para aprovechar el papel.
 * → { rotate: 0 | 90, x, y, w, h } caja que ocupa la página en la hoja (ya girada), y scale.
 */
export function sheetLayout(w, h, paper, { fit = 'fit', autoRotate = true, margin = FIT_MARGIN } = {}) {
  const rotate = autoRotate && w > h && paper.h > paper.w ? 90 : 0;
  const cw = rotate ? h : w;
  const ch = rotate ? w : h;
  const scale = fit === 'actual' ? 1 : Math.min((paper.w - 2 * margin) / cw, (paper.h - 2 * margin) / ch);
  const bw = cw * scale;
  const bh = ch * scale;
  return { rotate, scale, x: (paper.w - bw) / 2, y: (paper.h - bh) / 2, w: bw, h: bh };
}

/** Hojas de papel: una página por cara; a doble cara, dos por hoja. Por copia. */
export function sheetCount(pages, copies = 1, duplex = 'simplex') {
  return (duplex === 'simplex' ? pages : Math.ceil(pages / 2)) * copies;
}

/**
 * ¿Impresora virtual (PDF, XPS, OneNote, fax)? No imprimen a doble cara. Electron no dice en Windows si una
 * impresora física admite doble cara; si no lo admite, el controlador lo ignora y sale a una cara.
 */
export const isVirtualPrinter = (name = '') => /pdf|xps|onenote|fax|writer/i.test(name);

/**
 * ¿Hay que imprimir con el diálogo del sistema? Las impresoras virtuales (PDF, XPS, OneNote) preguntan dónde
 * guardar con su propia ventana, y al imprimir en silencio esa ventana no puede aparecer (el trabajo se
 * cancela). Con ellas se usa el diálogo de Windows, con la impresora ya elegida.
 */
export const needsSystemDialog = (printer) => !!printer && isVirtualPrinter(`${printer.name} ${printer.displayName ?? ''}`) && !/fax/i.test(printer.name);

/** ¿Admite doble cara? En macOS/Linux, CUPS lo dice («sides»); en Windows, toda impresora no virtual. */
export function supportsDuplex(printer) {
  if (!printer || isVirtualPrinter(`${printer.name} ${printer.displayName ?? ''}`)) return false;
  const sides = printer.options?.sides ?? printer.options?.['sides-supported'];
  return sides ? /two-sided/.test(String(sides)) : true;
}

/** Lotes para imprimir sin decodificar todo de una vez. Par, para que la doble cara no se descuadre. */
export const PRINT_BATCH = 24;
export function batches(n, size = PRINT_BATCH) {
  const out = [];
  for (let i = 0; i < n; i += size) out.push([i, Math.min(n, i + size)]);
  return out;
}
