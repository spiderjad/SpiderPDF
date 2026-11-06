// Bloques (src/export/docLayout.js) → documento de Word con la librería docx (MIT). Sin DOM: se prueba en Node.
// La librería llega como parámetro: en la app se carga con import() solo al exportar; en las pruebas, la de Node.
//
// Estilos de verdad (Título, Título 1-3, viñetas y numeración de Word) para que el documento se pueda seguir
// editando como uno hecho a mano: el índice de Word, el panel de navegación y las listas funcionan.

import { hasHeader, numberStyle } from '../tables.js';
import { isBlackish, isNumericCell, numericColumns } from './docLayout.js';
import { t } from '../i18n/index.js';

const PT_TO_TWIP = 20;
const PT_TO_PX = 96 / 72; // docx mide las imágenes en píxeles a 96 ppp

/** Fuente de Word para una del PDF: las estándar del PDF por sus equivalentes; el resto, por su familia. */
export function wordFont(name = '') {
  const n = name.replace(/^[A-Z]{6}\+/, '').replace(/[-,](Bold|Italic|Oblique|BoldItalic|BoldOblique|Regular|Roman|Medium|Light|Semibold|SemiBold|Black|Heavy|Book)+$/i, '').replace(/(MT|PS|PSMT)$/, '');
  if (!n) return null;
  if (/^helvetica|^arial/i.test(n)) return 'Arial';
  if (/^times/i.test(n)) return 'Times New Roman';
  if (/^courier/i.test(n)) return 'Courier New';
  if (/^symbol$|^zapf/i.test(n)) return null;
  return n.replace(/([a-z])([A-Z])/g, '$1 $2'); // «TimesNewRoman» → «Times New Roman», «OpenSans» → «Open Sans»
}

const hex = (c) => (c >>> 0).toString(16).padStart(6, '0').toUpperCase();

/**
 * Documento .docx. layout: resultado de layoutDocument; images: Map(bloque.image → { type, bytes }) con las
 * imágenes ya codificadas. → Uint8Array
 */
export async function buildDocx(docx, layout, { title = t('export.docx.defaultTitle'), images = new Map(), pageBreaks = true, author = '' } = {}) {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType,
    ImageRun, Tab, TabStopType, LevelFormat, ShadingType, BorderStyle, PageBreak, Header, Footer, PageNumber,
  } = docx;
  const { body, headings, margins, pageSize } = layout;
  const baseFont = wordFont(body.font) ?? 'Arial';
  const half = (pt) => Math.max(2, Math.round(pt * 2));
  const textW = pageSize.W - margins.left - margins.right; // ancho útil en puntos
  const align = (a) => (a === 'center' ? AlignmentType.CENTER : a === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT);

  // Un trozo con estilo → TextRun. En títulos, el tamaño y la negrita los pone el estilo (salvo que difieran).
  // numbers: en encabezados y pies con número de página, el primer número es el campo «página» y uno igual al
  // total de páginas, el campo «número de páginas» (Word los actualiza al repaginar).
  const run = (r, { inHeading = false, size = body.size, numbers = null } = {}) => {
    const parts = r.text.split('\t');
    let children = parts.flatMap((t, i) => (i ? [new Tab(), t] : [t])).filter((c) => c !== '');
    if (numbers) {
      children = children.flatMap((c) => (typeof c !== 'string' ? [c] : c.split(/(\d+)/).filter(Boolean).map((t) => {
        if (!/^\d+$/.test(t)) return t;
        if (!numbers.current) { numbers.current = true; return PageNumber.CURRENT; }
        return +t === layout.pages.length ? PageNumber.TOTAL_PAGES : t;
      })));
    }
    const f = wordFont(r.style.font);
    return new TextRun({
      children,
      bold: inHeading ? (r.style.bold ? undefined : false) : r.style.bold || undefined,
      italics: r.style.italic || undefined,
      color: isBlackish(r.style.color) ? undefined : hex(r.style.color),
      size: Math.abs(r.style.size - size) > 0.6 ? half(r.style.size) : undefined,
      font: f && f !== baseFont ? f : undefined,
    });
  };

  let listCount = 0;
  const children = [];
  layout.pages.forEach((blocks, pi) => {
    let breakPending = pageBreaks && pi > 0;
    const para = (opts) => {
      const p = new Paragraph({ ...opts, pageBreakBefore: breakPending || undefined });
      breakPending = false;
      return p;
    };
    const flushBreak = () => {
      if (!breakPending) return;
      children.push(new Paragraph({ children: [new PageBreak()] }));
      breakPending = false;
    };
    for (const b of blocks) {
      if (b.type === 'title' || b.type === 'heading') {
        const size = b.type === 'title' ? headings.title : headings.levels[b.level - 1];
        children.push(para({
          heading: b.type === 'title' ? HeadingLevel.TITLE : [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][b.level - 1],
          alignment: align(b.align),
          tabStops: tabs(b),
          children: b.runs.map((r) => run(r, { inHeading: true, size })),
        }));
      } else if (b.type === 'paragraph') {
        children.push(para({
          alignment: align(b.align),
          indent: b.indent ? { left: Math.round(b.indent * PT_TO_TWIP) } : undefined,
          tabStops: tabs(b),
          children: b.runs.map((r) => run(r)),
        }));
      } else if (b.type === 'list') {
        const instance = ++listCount; // cada lista numerada empieza en 1
        for (const it of b.items) {
          children.push(para({
            ...(b.ordered ? { numbering: { reference: 'numerada', level: 0, instance } } : { numbering: { reference: 'vinetas', level: 0 } }),
            children: it.runs.map((r) => run(r)),
          }));
        }
      } else if (b.type === 'table') {
        flushBreak();
        children.push(table(b.rows, b.width));
        children.push(new Paragraph({ children: [] })); // Word pega las tablas seguidas si no hay nada entre ellas
      } else if (b.type === 'image') {
        const img = images.get(b.image);
        if (!img) continue;
        let w = b.width; let h = b.height;
        if (w > textW) { h *= textW / w; w = textW; }
        children.push(para({
          alignment: align(b.align),
          children: [new ImageRun({ type: img.type, data: img.bytes, transformation: { width: Math.round(w * PT_TO_PX), height: Math.round(h * PT_TO_PX) } })],
        }));
      }
    }
    flushBreak(); // página sin nada (en blanco): se respeta el salto
  });
  if (!children.length) children.push(new Paragraph({ children: [] }));

  function table(rows, width = textW) {
    const style = numberStyle(rows);
    const head = hasHeader(rows, style);
    const n = Math.max(...rows.map((r) => r.length));
    // Anchos por el contenido (como hace Word con «autoajustar»), dentro del ancho útil.
    // El texto más largo de cada columna (hasta 40 letras: lo más largo se parte en líneas). La cabecera cuenta por
    // su palabra más larga (puede ir en dos líneas; los importes de debajo, no) y los números llevan algo de aire.
    const lens = Array.from({ length: n }, (_, c) => {
      const body = rows.slice(head ? 1 : 0).map((r) => (r[c] ?? '').length + (isNumericCell(r[c] ?? '') ? 2 : 0));
      const headWord = head ? Math.max(0, ...(rows[0][c] ?? '').split(/\s+/).map((w) => w.length)) : 0;
      return Math.min(40, Math.max(4, headWord, ...body));
    });
    const total = lens.reduce((a, b) => a + b, 0);
    const tableW = Math.min(textW, Math.max(width, textW * 0.4)); // el ancho que tenía en el PDF
    const widths = lens.map((l) => Math.round((l / total) * tableW * PT_TO_TWIP));
    const numeric = numericColumns(rows, head); // columnas de números: a la derecha, también su cabecera
    const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFC6' };
    const borders = { top: border, bottom: border, left: border, right: border };
    return new Table({
      width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
      columnWidths: widths,
      rows: rows.map((r, ri) => new TableRow({
        tableHeader: head && ri === 0,
        children: Array.from({ length: n }, (_, c) => {
          const t = r[c] ?? '';
          const isHead = head && ri === 0;
          return new TableCell({
            width: { size: widths[c], type: WidthType.DXA },
            borders,
            shading: isHead ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F5F0FF' } : undefined,
            margins: { top: 40, bottom: 40, left: 90, right: 90 },
            children: [new Paragraph({
              alignment: (isHead ? numeric[c] : isNumericCell(t)) ? AlignmentType.RIGHT : AlignmentType.LEFT,
              children: [new TextRun({ text: t, bold: isHead || undefined })],
            })],
          });
        }),
      })),
    });
  }

  function runningPara(b) {
    const numbers = b.pageNumber ? { current: false } : null;
    return new Paragraph({
      alignment: align(b.align),
      spacing: { after: 0 },
      indent: b.indent ? { left: Math.round(b.indent * PT_TO_TWIP) } : undefined,
      tabStops: tabs(b),
      children: b.runs.map((r) => run(r, { numbers })),
    });
  }

  /** Tabuladores del bloque ({ pos, align } en puntos desde el margen) → los de Word. */
  function tabs(b) {
    return b.tabs?.map((t) => ({ type: t.align === 'right' ? TabStopType.RIGHT : TabStopType.LEFT, position: Math.round(t.pos * PT_TO_TWIP) }));
  }

  const headingStyle = (id, name, size, extra = {}) => ({
    id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { font: baseFont, size: half(size), bold: true, color: '000000' },
    paragraph: { spacing: { before: Math.round(size * 0.8 * PT_TO_TWIP), after: Math.round(size * 0.3 * PT_TO_TWIP) }, keepNext: true },
    ...extra,
  });

  const doc = new Document({
    creator: author || 'SpiderPDF', // Preferencias → tu nombre
    lastModifiedBy: author || 'SpiderPDF',
    title,
    styles: {
      default: { document: { run: { font: baseFont, size: half(body.size) }, paragraph: { spacing: { after: Math.round(body.size * 0.5 * PT_TO_TWIP), line: 264 } } } },
      paragraphStyles: [
        headingStyle('Title', 'Title', headings.title ?? body.size * 2, { paragraph: { spacing: { after: Math.round(body.size * PT_TO_TWIP) } } }),
        headingStyle('Heading1', 'Heading 1', headings.levels[0]),
        headingStyle('Heading2', 'Heading 2', headings.levels[1]),
        headingStyle('Heading3', 'Heading 3', headings.levels[2]),
      ],
    },
    numbering: {
      config: [
        { reference: 'vinetas', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 425, hanging: 283 } } } }] },
        { reference: 'numerada', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 425, hanging: 283 } } } }] },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: Math.round(pageSize.W * PT_TO_TWIP), height: Math.round(pageSize.H * PT_TO_TWIP) },
          margin: { top: 1134, bottom: 1134, left: Math.round(margins.left * PT_TO_TWIP), right: Math.round(margins.right * PT_TO_TWIP), header: 567, footer: 567 },
        },
      },
      headers: layout.header?.length ? { default: new Header({ children: layout.header.map(runningPara) }) } : undefined,
      footers: layout.footer?.length ? { default: new Footer({ children: layout.footer.map(runningPara) }) } : undefined,
      children,
    }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
