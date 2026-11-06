// Tablas detectadas (src/tables.js) → libro de Excel con ExcelJS (MIT). Sin DOM: se prueba en Node.
// ExcelJS llega como parámetro: en la app se carga con import() solo al exportar; en las pruebas, el de Node.

import { numberStyle, parseCell, hasHeader } from '../tables.js';
import { t } from '../i18n/index.js';

export { hasHeader };

const BAD = /[[\]:*?/\\]/g;

/** Nombre de hoja válido (31 caracteres, sin []:*?/\) y sin repetir. */
export function sheetName(base, used) {
  let name = base.replace(BAD, '-').slice(0, 31).trim() || t('export.xlsx.sheetFallback');
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.replace(BAD, '-').slice(0, 26)} (${i})`;
  used.add(name.toLowerCase());
  return name;
}

const pagesLabel = (pages) => (pages.length > 1 ? t('export.xlsx.pageRange', { from: pages[0], to: pages.at(-1) }) : t('export.xlsx.pageOne', { page: pages[0] }));

/**
 * Libro con las tablas. tables: [{ rows: [[texto]], pages: [números de página desde 1] }].
 * mode: 'table' (una hoja por tabla) | 'page' (una hoja por página, las tablas una debajo de otra).
 * → Uint8Array del .xlsx
 */
export async function buildXlsx(ExcelJS, tables, { mode = 'table', title = t('export.xlsx.defaultTitle'), author = '' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = author || 'SpiderPDF'; // Preferencias → tu nombre
  wb.lastModifiedBy = author || 'SpiderPDF';
  wb.title = title;
  wb.created = new Date();
  const used = new Set();
  const groups = mode === 'page'
    ? [...new Set(tables.map((tb) => tb.pages[0]))].map((p) => ({ name: t('export.xlsx.sheetPage', { page: p }), tables: tables.filter((tb) => tb.pages[0] === p) }))
    : tables.map((tb, i) => ({ name: t('export.xlsx.sheetTable', { n: i + 1, pages: pagesLabel(tb.pages) }), tables: [tb] }));

  for (const g of groups) {
    const ws = wb.addWorksheet(sheetName(g.name, used));
    const widths = [];
    let r = 1;
    g.tables.forEach((tb, ti) => {
      if (ti > 0) r += 1; // una fila en blanco entre tablas
      const style = numberStyle(tb.rows);
      const header = hasHeader(tb.rows, style);
      const first = r;
      tb.rows.forEach((row, ri) => {
        const isHead = header && ri === 0;
        row.forEach((text, ci) => {
          const cell = ws.getCell(r, ci + 1);
          const { value, numFmt } = isHead ? { value: text || null } : parseCell(text, style);
          cell.value = value;
          if (numFmt) cell.numFmt = numFmt;
          if (isHead) {
            cell.font = { bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F0FF' } };
            cell.border = { bottom: { style: 'thin', color: { argb: 'FFC4C4CA' } } };
          }
          if (typeof value === 'string' && value.length > 50) cell.alignment = { wrapText: true, vertical: 'top' };
          const len = value instanceof Date ? 10 : String(text ?? '').length;
          widths[ci] = Math.max(widths[ci] ?? 6, Math.min(60, len + 2));
        });
        r++;
      });
      if (header && g.tables.length === 1) {
        ws.views = [{ state: 'frozen', ySplit: first }];
        ws.autoFilter = { from: { row: first, column: 1 }, to: { row: r - 1, column: tb.rows[0].length } };
      }
    });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
