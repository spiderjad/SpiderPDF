// Páginas de un PDF → bloques de un documento de Word: título, títulos de sección, párrafos (con negritas,
// cursivas y colores), listas, tablas e imágenes, en orden de lectura. Puro: sin DOM ni motor; se prueba en Node.
//
// Entradas por página (del motor): caracteres { text, boxes, generated } (textChars o la capa de OCR), su aspecto
// (charStyles: tamaño, negrita/cursiva, color, fuente; null en el OCR), las tablas ya detectadas (src/tables.js)
// y las imágenes con su caja. Todo en fracciones de la página SIN girar; aquí se mide en puntos.
//
// Cómo se decide (lo que haría una persona mirando la página):
//   · tamaño del cuerpo = el tamaño con más letras del documento;
//   · título = la letra más grande si sale una sola vez (al principio); títulos de sección = tamaños claramente
//     mayores que el cuerpo (nivel por tamaño) o líneas cortas enteras en negrita;
//   · listas = líneas que empiezan por viñeta (•, –, ▪…) o por «1.», «a)», «iv.»; las líneas que siguen alineadas
//     con su texto son la continuación del elemento;
//   · párrafo nuevo si hay más espacio del normal entre líneas, si cambia la sangría o si la línea anterior acaba
//     en punto antes del margen derecho;
//   · las palabras partidas con guion al final de línea (PDFium las marca con \u0002) se vuelven a unir.

import { lines as groupLines } from '../tables.js';

const BULLETS = '•·▪◦‣●○■□➢►▶✓✔–—*-';
const BULLET_WORD = new RegExp(`^[${BULLETS}]$`);
const BULLET_GLUED = /^([•▪◦‣●○■□➢►▶✓✔])(.+)$/u;
const ORDERED_WORD = /^(\(?\d{1,2}[.)]|[a-z][.)]|\(?(?:i{1,3}|iv|vi{0,3}|ix|x)[.)])$/i;
const END_PUNCT = /[.!?:;»”)]$/;

// --- Palabras con estilo -----------------------------------------------------------------------
const styleKey = (s) => `${s.bold ? 1 : 0}${s.italic ? 1 : 0}:${s.color}:${s.font}:${Math.round(s.size * 2)}`;

function styleAt(styles, i, h) {
  if (styles && styles.size[i] > 0) {
    return {
      size: styles.size[i],
      bold: (styles.flags[i] & 1) === 1,
      italic: (styles.flags[i] & 2) === 2,
      color: styles.color[i] ?? 0,
      font: styles.fonts?.[styles.font[i]] ?? '',
    };
  }
  return { size: Math.max(4, h / 1.15), bold: false, italic: false, color: 0, font: '' }; // OCR: del alto de la caja
}

/**
 * Palabras con su caja en puntos y sus trozos de estilo: [{ text, x0, x1, y0, y1, segs: [{ text, style }], hyph }].
 * hyph: la palabra acaba en un guion de final de línea (se une con la primera de la línea siguiente).
 */
export function styledWords(chars, styles, W, H) {
  const { text, boxes, generated } = chars;
  const out = [];
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (let i = 0; i < text.length; i++) {
    // Viñetas de las fuentes Symbol / Wingdings (Word): llegan como caracteres privados (U+F0B7…).
    const c = /[-]/.test(text[i]) ? '•' : text[i];
    if (c === '\u0002') { if (cur) cur.hyph = true; flush(); continue; }
    if (generated?.[i]) { flush(); continue; }
    const x0 = boxes[i * 4] * W; const y0 = boxes[i * 4 + 1] * H;
    const x1 = boxes[i * 4 + 2] * W; const y1 = boxes[i * 4 + 3] * H;
    if (/\s/.test(c) || !(x1 > x0 || y1 > y0)) { flush(); continue; }
    const h = y1 - y0;
    const st = styleAt(styles, i, h);
    if (cur && Math.abs((cur.y0 + cur.y1) / 2 - (y0 + y1) / 2) < h / 2 && x0 - cur.x1 < h * 0.25 && x0 >= cur.x0 - 0.5) {
      cur.text += c; cur.x1 = Math.max(cur.x1, x1); cur.y0 = Math.min(cur.y0, y0); cur.y1 = Math.max(cur.y1, y1);
      const last = cur.segs.at(-1);
      if (styleKey(last.style) === styleKey(st)) last.text += c; else cur.segs.push({ text: c, style: st });
    } else {
      flush();
      cur = { text: c, x0, x1, y0, y1, segs: [{ text: c, style: st }], hyph: false };
    }
  }
  flush();
  return out;
}

/** Datos de una línea: tamaño (el de más letras), si es toda negrita, texto y bordes. */
function lineInfo(l) {
  const bySize = new Map();
  let letters = 0; let boldLetters = 0;
  for (const w of l.words) {
    for (const s of w.segs) {
      const n = s.text.replace(/[^\p{L}\p{N}]/gu, '').length;
      const k = Math.round(s.style.size * 2) / 2;
      bySize.set(k, (bySize.get(k) ?? 0) + s.text.length);
      letters += n;
      if (s.style.bold) boldLetters += n;
    }
  }
  const size = [...bySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  return {
    ...l,
    x0: Math.min(...l.words.map((w) => w.x0)),
    x1: Math.max(...l.words.map((w) => w.x1)),
    size,
    letters,
    bold: letters > 0 && boldLetters / letters > 0.9,
    gappy: l.words.some((w, i) => i > 0 && isTabGap(l.words[i - 1], w)),
    text: l.words.map((w) => w.text).join(' '),
  };
}

/** Hueco entre dos palabras de la misma línea que no es un espacio: columnas «clave … valor». */
const isTabGap = (a, b) => b.x0 - a.x1 > Math.max(12, (b.y1 - b.y0) * 2);

/**
 * Tabuladores de una línea con huecos, medidos desde el margen izquierdo: [{ pos, align }]. El trozo que acaba en
 * el margen derecho lleva tabulador a la derecha (importes, «Página 2 de 16»); los demás, donde empiezan.
 */
function tabStops(line, left, rightEdge) {
  const ws = line.words;
  const starts = ws.map((w, i) => (i > 0 && isTabGap(ws[i - 1], w) ? i : -1)).filter((i) => i > 0);
  return starts.map((s, k) => {
    const end = (starts[k + 1] ?? ws.length) - 1;
    return ws[end].x1 > rightEdge - 8
      ? { pos: Math.max(0, rightEdge - left), align: 'right' }
      : { pos: Math.max(0, ws[s].x0 - left), align: 'left' };
  });
}

const area = ([u0, v0, u1, v1]) => Math.max(0, u1 - u0) * Math.max(0, v1 - v0);

/**
 * Una página: sus líneas (sin las que están dentro de una tabla), tablas e imágenes, en orden vertical.
 * page: { chars, styles, W, H, tables: [{ rows, box }], images: [{ rect, … }] }
 */
export function analyzePage({ chars, styles = null, W, H, tables = [], images = [] }) {
  const pad = 2; // pt
  const inTable = (w) => tables.some((t) => {
    const cx = (w.x0 + w.x1) / 2; const cy = (w.y0 + w.y1) / 2;
    return cx >= t.box[0] * W - pad && cx <= t.box[2] * W + pad && cy >= t.box[1] * H - pad && cy <= t.box[3] * H + pad;
  });
  const ws = chars?.text ? styledWords(chars, styles, W, H).filter((w) => !inTable(w)) : [];
  const ls = groupLines(ws).map(lineInfo);
  // La imagen que ocupa casi toda una página con texto encima es un escaneo con su capa de OCR: el texto la sustituye.
  const imgs = images.filter((im) => !(ls.length && area(im.rect) > 0.6));
  const items = [
    ...ls.map((l) => ({ kind: 'line', y: l.y0, line: l })),
    ...tables.map((t) => ({ kind: 'table', y: t.box[1] * H, table: t })),
    ...imgs.map((im) => ({ kind: 'image', y: im.rect[1] * H, image: im })),
  ].sort((a, b) => a.y - b.y);
  return { W, H, items, lines: ls };
}

// --- Documento -------------------------------------------------------------------------------
/** Tamaño de letra con más letras en todo el documento. */
function bodySize(pages) {
  const count = new Map();
  for (const p of pages) for (const l of p.lines) count.set(l.size, (count.get(l.size) ?? 0) + l.letters);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
}

/** Fuente con más letras (nombre del PDF). */
function bodyFont(pages) {
  const count = new Map();
  for (const p of pages) for (const l of p.lines) for (const w of l.words) for (const s of w.segs) {
    if (!s.style.bold && !s.style.italic) count.set(s.style.font, (count.get(s.style.font) ?? 0) + s.text.length);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/** Tamaños de título: los claramente mayores que el cuerpo, agrupados (±0,6 pt), de mayor a menor. */
function headingSizes(pages, body) {
  const sizes = [];
  for (const p of pages) for (const l of p.lines) if (l.size >= body * 1.15 && l.letters >= 2) sizes.push(l.size);
  const groups = [];
  for (const s of [...new Set(sizes)].sort((a, b) => b - a)) {
    const g = groups.at(-1);
    if (g && g.at(-1) - s <= 0.6) g.push(s); else groups.push([s]);
  }
  return groups.map((g) => ({ max: g[0], min: g.at(-1), lines: sizes.filter((s) => s <= g[0] && s >= g.at(-1)).length }));
}

const startsList = (l) => {
  const first = l.words[0]?.text ?? '';
  if (l.words.length > 1 && BULLET_WORD.test(first)) return { ordered: false, skip: 1 };
  if (BULLET_GLUED.test(first)) return { ordered: false, skip: 0, glued: true };
  if (l.words.length > 1 && ORDERED_WORD.test(first)) return { ordered: true, skip: 1, label: first };
  return null;
};

/** Trozos de texto con estilo de un grupo de líneas, uniendo las palabras partidas con guion. */
function runsOf(lines, { skipFirst = 0, gluedBullet = false } = {}) {
  const runs = [];
  const push = (text, style) => {
    const last = runs.at(-1);
    if (last && styleKey(last.style) === styleKey(style)) last.text += text; else runs.push({ text, style });
  };
  let pendingSpace = false;
  lines.forEach((l, li) => {
    let ws = l.words;
    if (li === 0 && skipFirst) ws = ws.slice(skipFirst);
    ws.forEach((w, wi) => {
      let segs = w.segs;
      if (li === 0 && wi === 0 && gluedBullet) {
        const m = BULLET_GLUED.exec(w.text);
        segs = [{ text: m[2], style: segs.at(-1).style }];
      }
      if (pendingSpace && runs.length) {
        // Un hueco grande en la misma línea (columnas «clave … valor») es un tabulador.
        const prev = wi > 0 ? ws[wi - 1] : null;
        push(prev && isTabGap(prev, w) ? '\t' : ' ', runs.at(-1).style);
      }
      for (const s of segs) push(s.text, s.style);
      const lastOfLine = wi === ws.length - 1;
      pendingSpace = !(lastOfLine && w.hyph); // «suminis-» + «tro» → «suministro»
    });
  });
  return runs.filter((r) => r.text);
}

/**
 * Bloques del documento a partir de las páginas analizadas (analyzePage).
 * → { body: { size, font }, margins: { left, right, top }, pageSize: { W, H }, pages: [[bloque]] }
 * Bloques: { type: 'title' | 'heading', level?, runs, align } · { type: 'paragraph', runs, align, tabs? }
 *          · { type: 'list', ordered, items: [{ runs }] } · { type: 'table', rows } · { type: 'image', image, width, height, align }
 */
export function layoutDocument(allPages) {
  const { pages, header: headLines, footer: footLines } = splitRunning(allPages);
  const body = bodySize(pages);
  const font = bodyFont(pages);
  const heads = headingSizes(pages, body);
  // La letra más grande, una sola vez y en la primera página: título del documento.
  const first = pages[0]?.lines ?? [];
  const titleSize = heads[0] && heads[0].lines <= 2 && first.some((l) => l.size >= heads[0].min) ? heads[0] : null;
  const levels = heads.filter((h) => h !== titleSize);
  const levelOf = (size) => {
    const i = levels.findIndex((h) => size >= h.min - 0.01);
    return i < 0 ? null : Math.min(3, i + 1);
  };
  const boldLevel = Math.min(3, levels.length + 1); // línea corta en negrita al tamaño del cuerpo

  // Márgenes: el texto de cuerpo más a la izquierda y más a la derecha de todo el documento.
  // Cuentan también las líneas de un tamaño parecido (totales a 10 pt con cuerpo a 9) y los bordes de las tablas.
  const edges = pages.flatMap((p) => [
    ...p.lines.filter((l) => Math.abs(l.size - body) <= body * 0.25).map((l) => [l.x0, l.x1]),
    ...p.items.filter((it) => it.kind === 'table').map((it) => [it.table.box[0] * p.W, it.table.box[2] * p.W]),
  ]);
  const left = edges.length ? Math.min(...edges.map((e) => e[0])) : 72;
  const rightEdge = edges.length ? Math.max(...edges.map((e) => e[1])) : (pages[0]?.W ?? 595) - 72;

  const out = pages.map((p) => {
    const colW = Math.max(1, rightEdge - left);
    const kindOf = (l) => {
      if (titleSize && l.size >= titleSize.min - 0.01) return { type: 'title' };
      const lv = l.size >= body * 1.15 ? levelOf(l.size) : null;
      if (lv) return { type: 'heading', level: lv };
      const list = startsList(l);
      if (list) return { type: 'item', list };
      if (l.bold && l.x1 - l.x0 < colW * 0.7 && !END_PUNCT.test(l.text) && l.letters >= 3 && !/\d[\d.,]*\s*[€$%]?$/.test(l.text)) {
        return { type: 'heading', level: boldLevel, weak: true };
      }
      return { type: 'paragraph' };
    };

    // Distancia normal entre líneas seguidas del cuerpo en esta página (para ver el espacio entre párrafos).
    const pitches = [];
    for (let i = 1; i < p.lines.length; i++) {
      const a = p.lines[i - 1]; const b = p.lines[i];
      if (Math.abs(a.size - body) < 1 && Math.abs(b.size - body) < 1) pitches.push(b.y0 - a.y0);
    }
    pitches.sort((a, b) => a - b);
    const pitch = pitches.length ? pitches[Math.floor(pitches.length / 3)] : body * 1.35; // tercil bajo: el interlineado

    const blocks = [];
    let group = null; // { kind, lines, … } que se está formando
    const close = () => {
      if (!group) return;
      const g = group; group = null;
      if (g.type === 'list') { blocks.push({ type: 'list', ordered: g.ordered, items: g.items.map((it) => ({ runs: runsOf(it.lines, it.opts) })) }); return; }
      const runs = runsOf(g.lines);
      if (!runs.length) return;
      const centered = g.lines.every((l) => Math.abs((l.x0 + l.x1) / 2 - p.W / 2) < p.W * 0.03 && l.x0 > left + colW * 0.08);
      const block = { type: g.type, runs, align: centered ? 'center' : 'left' };
      if (g.level) block.level = g.level;
      // Sangría: todo el párrafo empieza más a la derecha del margen (p. ej. los totales de una factura).
      const indent = Math.min(...g.lines.map((l) => l.x0)) - left;
      if (!centered && indent > 6) block.indent = indent;
      // Una sola línea con huecos (clave … valor): tabuladores en las posiciones del PDF (desde el margen).
      if (g.lines.length === 1 && runs.some((r) => r.text.includes('\t'))) block.tabs = tabStops(g.lines[0], left, rightEdge);
      blocks.push(block);
    };

    let prev = null; // línea anterior
    for (const it of p.items) {
      if (it.kind !== 'line') {
        close(); prev = null;
        if (it.kind === 'table') blocks.push({ type: 'table', rows: it.table.rows, width: (it.table.box[2] - it.table.box[0]) * p.W });
        else {
          const [u0, v0, u1, v1] = it.image.rect;
          const cx = (u0 + u1) / 2;
          blocks.push({ type: 'image', image: it.image, width: (u1 - u0) * p.W, height: (v1 - v0) * p.H, align: Math.abs(cx - 0.5) < 0.04 ? 'center' : (u0 * p.W > left + colW * 0.5 ? 'right' : 'left') });
        }
        continue;
      }
      const l = it.line;
      const k = kindOf(l);
      const gap = prev ? l.y0 - prev.y0 : Infinity;
      const bigGap = gap > Math.max(pitch * 1.3, l.size * 1.9);
      if (k.type === 'item') {
        if (group?.type !== 'list' || group.ordered !== k.list.ordered || gap > pitch * 2.2) { close(); group = { type: 'list', ordered: k.list.ordered, items: [] }; }
        const textX = l.words[k.list.skip]?.x0 ?? l.x0;
        group.items.push({ lines: [l], textX, opts: { skipFirst: k.list.skip, gluedBullet: !!k.list.glued } });
      } else if (k.type === 'paragraph' && group?.type === 'list' && !bigGap && Math.abs(l.x0 - group.items.at(-1).textX) < 4) {
        group.items.at(-1).lines.push(l); // continuación del elemento (alineada con su texto)
      } else if (k.type === 'title' || k.type === 'heading') {
        // Un título partido en dos líneas del mismo tamaño sigue siendo uno.
        const same = group && group.type === k.type && group.level === k.level && !bigGap && Math.abs(prev.size - l.size) < 0.6;
        if (!same) { close(); group = { type: k.type, level: k.level, lines: [] }; }
        group.lines.push(l);
      } else {
        const last = group?.type === 'paragraph' ? group.lines.at(-1) : null;
        const newPara = !last || bigGap || l.gappy || last.gappy
          || Math.abs(l.size - last.size) > 1
          || l.x0 - last.x0 > 4 // más sangrada que la anterior: primera línea de otro párrafo
          || (END_PUNCT.test(last.text) && last.x1 < rightEdge - colW * 0.12);
        if (newPara) { close(); group = { type: 'paragraph', lines: [] }; }
        group.lines.push(l);
      }
      prev = l;
    }
    close();
    return blocks;
  });

  // Encabezado y pie: un párrafo por línea, alineado como en el PDF; con el número de página si cambia. Con huecos
  // («Consultora S.L. ········ Página 2 de 16»): a la izquierda y con tabuladores (el último, a la derecha).
  const running = (list) => list.map(({ line: l, W, pageNumber }) => {
    const cx = (l.x0 + l.x1) / 2;
    if (l.gappy) return { type: 'paragraph', runs: runsOf([l]), align: 'left', tabs: tabStops(l, left, rightEdge), indent: l.x0 - left > 6 ? l.x0 - left : undefined, pageNumber };
    const align = Math.abs(cx - W / 2) < W * 0.05 ? 'center' : l.x0 > W / 2 ? 'right' : 'left';
    return { type: 'paragraph', runs: runsOf([l]), align, pageNumber };
  });

  return {
    header: running(headLines),
    footer: running(footLines),
    body: { size: body, font },
    headings: { title: titleSize?.max ?? null, levels: [...levels.map((h) => h.max), body, body, body].slice(0, 3) },
    margins: { left: Math.max(36, Math.min(108, left)), right: Math.max(36, Math.min(108, (pages[0]?.W ?? 595) - rightEdge)) },
    pageSize: { W: pages[0]?.W ?? 595, H: pages[0]?.H ?? 842 },
    pages: out,
  };
}

/**
 * Encabezado y pie de página que se repiten: líneas en el 12 % de arriba o de abajo con el mismo texto (los números
 * no cuentan: «Página 3 de 16») en el mismo sitio en al menos la mitad de las páginas (y dos como mínimo).
 * Se quitan de las páginas. → { pages, header: [{ line, W, pageNumber }], footer: […] }
 * pageNumber: el número cambia de una página a otra (en Word, el campo de número de página).
 */
export function splitRunning(pages) {
  const none = { pages, header: [], footer: [] };
  if (pages.length < 2) return none;
  const keyOf = (l, p) => {
    const zone = l.y1 < p.H * 0.12 ? 'top' : l.y0 > p.H * 0.88 ? 'bottom' : null;
    return zone && `${zone}|${Math.round(l.y0 / 6)}|${l.text.replace(/\d+/g, '#')}`;
  };
  const seen = new Map(); // clave → { pages: Set, texts: Set, first: { line, p } }
  pages.forEach((p, pi) => {
    for (const l of p.lines) {
      const k = keyOf(l, p);
      if (!k) continue;
      if (!seen.has(k)) seen.set(k, { pages: new Set(), texts: new Set(), first: { line: l, p } });
      const s = seen.get(k); s.pages.add(pi); s.texts.add(l.text);
    }
  });
  const need = Math.max(2, Math.ceil(pages.length / 2));
  const keys = new Set([...seen].filter(([, s]) => s.pages.size >= need).map(([k]) => k));
  // Imágenes en el mismo sitio en muchas páginas: membrete, logotipos, franjas de adorno. Fuera del cuerpo. Las que
  // ocupan casi toda la página no: son páginas escaneadas (cada una distinta aunque estén en el mismo sitio).
  const imgKey = (im) => (area(im.rect) > 0.5 ? null : im.rect.map((v) => Math.round(v * 60)).join(','));
  const imgPages = new Map();
  pages.forEach((p, pi) => p.items.forEach((it) => {
    if (it.kind !== 'image') return;
    const k = imgKey(it.image);
    if (k == null) return;
    if (!imgPages.has(k)) imgPages.set(k, new Set());
    imgPages.get(k).add(pi);
  }));
  const imgRepeated = new Set([...imgPages].filter(([, s]) => s.size >= need).map(([k]) => k));
  if (!keys.size && !imgRepeated.size) return none;
  const pick = (zone) => [...keys].filter((k) => k.startsWith(zone)).map((k) => seen.get(k))
    .sort((a, b) => a.first.line.y0 - b.first.line.y0)
    .map((s) => ({ line: s.first.line, W: s.first.p.W, pageNumber: s.texts.size > 1 }));
  const drop = (p) => {
    const out = new Set(p.lines.filter((l) => keys.has(keyOf(l, p))));
    return {
      ...p,
      lines: p.lines.filter((l) => !out.has(l)),
      items: p.items.filter((it) => !(it.kind === 'line' && out.has(it.line)) && !(it.kind === 'image' && imgRepeated.has(imgKey(it.image)))),
    };
  };
  return { pages: pages.map(drop), header: pick('top'), footer: pick('bottom') };
}

/** Texto plano de un bloque (vista previa y pruebas). */
export const blockText = (b) => (b.runs ?? []).map((r) => r.text).join('');

/**
 * Color que no se copia (0xRRGGBB): casi negro (se deja el del documento) o muy claro (texto blanco sobre una franja
 * de color, que en Word quedaría blanco sobre blanco).
 */
export const isBlackish = (c) => {
  const r = (c >> 16) & 255; const g = (c >> 8) & 255; const b = c & 255;
  return (r < 60 && g < 60 && b < 70) || 0.2126 * r + 0.7152 * g + 0.0722 * b > 215;
};

/** Celda que es un número, importe o porcentaje (va a la derecha, como en una hoja de cálculo). */
export const isNumericCell = (t) => /^[-+−]?\(?[\d.,\s]+\)?\s*(%|€|\$|£)?$|^(€|\$|£)\s*[-+]?[\d.,]+$/.test(t.trim()) && /\d/.test(t);

/** Columnas de números de una tabla (≥ 80 % de sus celdas con algo, sin contar la cabecera). */
export function numericColumns(rows, header) {
  const n = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: n }, (_, c) => {
    const vals = rows.slice(header ? 1 : 0).map((r) => (r[c] ?? '').trim()).filter(Boolean);
    return vals.length > 0 && vals.filter(isNumericCell).length / vals.length >= 0.8;
  });
}
