// Tablas de una página → filas y columnas (para exportar a Excel). Puro: sin DOM ni motor; se prueba en Node.
//
// Entradas (del motor): caracteres { text, boxes } (textChars, fracciones sin girar, v hacia abajo), las líneas
// rectas dibujadas (rules: [[u0, v0, u1, v1]]) y el tamaño de la página en puntos (para medir en puntos).
// Dos formas de encontrar una tabla:
//   1. Con rejilla: líneas horizontales y verticales que se cruzan → las celdas son los huecos de la rejilla.
//   2. Por alineación (sin líneas): varias líneas seguidas con el texto repartido en las mismas columnas.
// Los valores se convierten aparte (parseCell): números en formato español o inglés, porcentajes, importes y fechas.

import { getLocale } from './i18n/index.js';

const SNAP = 2.5; // pt: líneas a menos de esto son la misma

// --- Palabras, líneas y celdas ----------------------------------------------------------------
/** Palabras con su caja en puntos: [{ text, x0, x1, y0, y1 }] (y hacia abajo). */
export function words({ text, boxes }, W, H) {
  const out = [];
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const x0 = boxes[i * 4] * W; const y0 = boxes[i * 4 + 1] * H;
    const x1 = boxes[i * 4 + 2] * W; const y1 = boxes[i * 4 + 3] * H;
    if (/\s/.test(c) || !(x1 > x0 || y1 > y0)) { flush(); continue; }
    const h = y1 - y0;
    if (cur && Math.abs((cur.y0 + cur.y1) / 2 - (y0 + y1) / 2) < h / 2 && x0 - cur.x1 < h * 0.25 && x0 >= cur.x0 - 0.5) {
      cur.text += c; cur.x1 = Math.max(cur.x1, x1); cur.y0 = Math.min(cur.y0, y0); cur.y1 = Math.max(cur.y1, y1);
    } else {
      flush();
      cur = { text: c, x0, x1, y0, y1 };
    }
  }
  flush();
  return out;
}

/** Palabras agrupadas en líneas (por altura), de arriba abajo; cada una con sus palabras de izquierda a derecha. */
export function lines(ws) {
  const out = [];
  for (const w of [...ws].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const mid = (w.y0 + w.y1) / 2;
    const l = out.find((o) => Math.abs((o.y0 + o.y1) / 2 - mid) < Math.min(o.y1 - o.y0, w.y1 - w.y0) / 2);
    if (l) { l.words.push(w); l.y0 = Math.min(l.y0, w.y0); l.y1 = Math.max(l.y1, w.y1); } else out.push({ y0: w.y0, y1: w.y1, words: [w] });
  }
  for (const l of out) l.words.sort((a, b) => a.x0 - b.x0);
  return out.sort((a, b) => a.y0 - b.y0);
}

/** Trozos de una línea separados por un hueco mayor que medio alto de letra: [{ text, x0, x1 }]. */
export function cellsOf(line) {
  const gap = Math.max(4, (line.y1 - line.y0) * 0.55);
  const out = [];
  for (const w of line.words) {
    const last = out.at(-1);
    if (last && w.x0 - last.x1 < gap) { last.text += ` ${w.text}`; last.x1 = w.x1; } else out.push({ text: w.text, x0: w.x0, x1: w.x1 });
  }
  return out;
}

// --- 1. Tablas con rejilla ---------------------------------------------------------------------
const cluster = (vals) => {
  const out = [];
  for (const v of [...vals].sort((a, b) => a - b)) if (!out.length || v - out.at(-1) > SNAP) out.push(v);
  return out;
};

/**
 * Rejillas: grupos de líneas verticales y horizontales que forman al menos 2 × 2 celdas.
 * → [{ xs: [bordes], ys: [bordes], x0, x1, y0, y1 }] en puntos.
 */
export function grids(rules, W, H) {
  const hs = []; const vs = [];
  for (const [u0, v0, u1, v1] of rules) {
    const x0 = u0 * W; const x1 = u1 * W; const y0 = v0 * H; const y1 = v1 * H;
    if (y1 - y0 < SNAP && x1 - x0 > 8) hs.push({ y: (y0 + y1) / 2, x0, x1 });
    else if (x1 - x0 < SNAP && y1 - y0 > 6) vs.push({ x: (x0 + x1) / 2, y0, y1 });
  }
  // Componentes: líneas que se tocan (una horizontal cruza una vertical).
  const all = [...hs.map((h) => ({ h })), ...vs.map((v) => ({ v }))];
  const touch = (a, b) => {
    const h = a.h ?? b.h; const v = a.v ?? b.v;
    if (!h || !v) return false;
    return v.x >= h.x0 - SNAP && v.x <= h.x1 + SNAP && h.y >= v.y0 - SNAP && h.y <= v.y1 + SNAP;
  };
  const group = all.map((_, i) => i);
  const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (touch(all[i], all[j])) group[find(i)] = find(j);
  const comps = new Map();
  all.forEach((x, i) => { const k = find(i); comps.set(k, [...(comps.get(k) ?? []), x]); });
  const out = [];
  for (const items of comps.values()) {
    const H_ = items.filter((x) => x.h).map((x) => x.h);
    const V_ = items.filter((x) => x.v).map((x) => x.v);
    const xs = cluster(V_.map((v) => v.x));
    const ys = cluster(H_.map((h) => h.y));
    if (xs.length < 3 || ys.length < 3) continue; // menos de 2 columnas o 2 filas: un recuadro, no una tabla
    out.push({ xs, ys, x0: xs[0], x1: xs.at(-1), y0: ys[0], y1: ys.at(-1) });
  }
  return out.sort((a, b) => a.y0 - b.y0);
}

/** Las palabras de dentro de una rejilla, repartidas en sus celdas. → filas de textos (sin filas vacías). */
function fillGrid(g, ws) {
  const rows = Array.from({ length: g.ys.length - 1 }, () => Array.from({ length: g.xs.length - 1 }, () => []));
  const inside = [];
  for (const w of ws) {
    const cx = (w.x0 + w.x1) / 2; const cy = (w.y0 + w.y1) / 2;
    if (cx < g.x0 || cx > g.x1 || cy < g.y0 || cy > g.y1) continue;
    const c = g.xs.findIndex((x, i) => i > 0 && cx <= x) - 1;
    const r = g.ys.findIndex((y, i) => i > 0 && cy <= y) - 1;
    if (r < 0 || c < 0) continue;
    rows[r][c].push(w);
    inside.push(w);
  }
  const text = (cell) => lines(cell).map((l) => l.words.map((w) => w.text).join(' ')).join(' ');
  const body = rows.map((r) => r.map(text)).filter((r) => r.some((t) => t));

  // Cabecera sin bordes (texto sobre un fondo de color justo encima de la rejilla): las líneas pegadas por
  // arriba, dentro de su anchura, se reparten por sus columnas y forman una sola fila.
  const usedSet = new Set(inside);
  const above = lines(ws.filter((w) => !usedSet.has(w) && w.x0 >= g.x0 - SNAP && w.x1 <= g.x1 + SNAP && w.y1 <= g.y0 + SNAP))
    .sort((a, b) => b.y0 - a.y0);
  const head = [];
  let edge = g.y0;
  // Una línea con una palabra que cruza el borde de una columna no es cabecera (es un título o un párrafo encima).
  const inner = g.xs.slice(1, -1);
  const straddles = (l) => l.words.some((w) => inner.some((x) => w.x0 < x - SNAP && w.x1 > x + SNAP));
  for (const l of above) {
    const lh = l.y1 - l.y0;
    if (edge - l.y1 > lh * 1.6 || head.length >= 3 || straddles(l)) break;
    head.push(l);
    edge = l.y0;
  }
  if (head.length) {
    const cells = Array.from({ length: g.xs.length - 1 }, () => []);
    for (const l of head.reverse()) {
      for (const w of l.words) {
        const cx = (w.x0 + w.x1) / 2;
        const c = Math.max(0, g.xs.findIndex((x, i) => i > 0 && cx <= x) - 1);
        cells[c].push(w);
        inside.push(w);
      }
    }
    body.unshift(cells.map(text));
  }
  return { rows: body, used: inside, headLines: head.length };
}

// --- 2. Tablas por alineación ------------------------------------------------------------------
/**
 * Bloques de líneas seguidas con el texto en varias columnas. Se admite dentro una línea de continuación
 * (la descripción partida en dos). → [{ lines, cols: [[x0, x1]] }]
 */
function streamBlocks(ls) {
  const rows = ls.map((l) => ({ l, cells: cellsOf(l) }));
  const blocks = [];
  let cur = [];
  const close = () => {
    while (cur.length && cur.at(-1).cells.length < 2) cur.pop(); // no termina en una línea suelta
    if (cur.filter((r) => r.cells.length >= 2).length >= 2) blocks.push(cur);
    cur = [];
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const prev = cur.at(-1);
    const lh = r.l.y1 - r.l.y0;
    const near = prev && r.l.y0 - prev.l.y1 < Math.max(lh, prev.l.y1 - prev.l.y0) * 2.2;
    if (prev && !near) close();
    if (r.cells.length >= 2) { cur.push(r); continue; }
    // Una línea de un solo trozo dentro de un bloque: continuación si la siguiente sigue la tabla.
    const next = rows[i + 1];
    if (cur.length && next && next.cells.length >= 2 && next.l.y0 - r.l.y1 < lh * 2.2) cur.push(r);
    else close();
  }
  close();

  const out = [];
  for (const b of blocks) {
    // Columnas: los huecos que ningún trozo cruza, mirando las filas del cuerpo (la cabecera puede ser más ancha).
    const multi = b.filter((r) => r.cells.length >= 2);
    const body = multi.length > 2 ? multi.slice(1) : multi;
    const iv = body.flatMap((r) => r.cells.map((c) => [c.x0, c.x1])).sort((a, c) => a[0] - c[0]);
    const cols = [];
    for (const [a, c] of iv) {
      const last = cols.at(-1);
      if (last && a <= last[1] + 1) last[1] = Math.max(last[1], c); else cols.push([a, c]);
    }
    if (cols.length < 3) continue; // dos columnas: suele ser «clave valor» (totales, datos del cliente), no una tabla
    out.push({ rows: b, cols });
  }
  return out;
}

/** Columna de un trozo: la que más se solapa con él (o la más cercana). */
function colOf(cols, c) {
  let best = 0; let score = -Infinity;
  cols.forEach(([a, b], i) => {
    const s = Math.min(b, c.x1) - Math.max(a, c.x0);
    const d = s > 0 ? s : -Math.min(Math.abs(a - c.x1), Math.abs(c.x0 - b));
    if (d > score) { score = d; best = i; }
  });
  return best;
}

function fillStream(block) {
  const { rows, cols } = block;
  const out = [];
  for (const r of rows) {
    const row = cols.map(() => '');
    for (const c of r.cells) { const i = colOf(cols, c); row[i] = row[i] ? `${row[i]} ${c.text}` : c.text; }
    const filled = row.filter(Boolean).length;
    // Continuación: sin la primera columna y con pocas celdas → se añade a la fila anterior.
    if (out.length && !row[0] && filled <= Math.max(1, Math.floor(cols.length / 3))) {
      const prev = out.at(-1);
      row.forEach((t, i) => { if (t) prev[i] = prev[i] ? `${prev[i]} ${t}` : t; });
      continue;
    }
    out.push(row);
  }
  return out;
}

// --- Página entera -----------------------------------------------------------------------------
/**
 * Tablas de una página. → [{ rows: [[texto]], kind: 'grid' | 'stream', box: [u0, v0, u1, v1] }] de arriba abajo.
 * El texto de una rejilla no se vuelve a usar para las tablas por alineación.
 */
export function detectTables(chars, rules, W, H) {
  const ws = words(chars, W, H);
  const tables = [];
  const used = new Set();
  for (const g of grids(rules, W, H)) {
    const { rows, used: u } = fillGrid(g, ws);
    if (rows.length < 2) continue;
    u.forEach((w) => used.add(w));
    const top = u.reduce((m, w) => Math.min(m, w.y0), g.y0); // con la cabecera sin bordes de encima, si la tiene
    tables.push({ rows, kind: 'grid', box: [g.x0 / W, top / H, g.x1 / W, g.y1 / H] });
  }
  const rest = ws.filter((w) => !used.has(w));
  for (const b of streamBlocks(lines(rest))) {
    const rows = fillStream(b);
    if (rows.length < 2) continue;
    const y0 = b.rows[0].l.y0; const y1 = b.rows.at(-1).l.y1;
    tables.push({ rows, kind: 'stream', box: [b.cols[0][0] / W, y0 / H, b.cols.at(-1)[1] / W, y1 / H] });
  }
  return tables.sort((a, b) => a.box[1] - b.box[1]).map((t) => ({ ...t, rows: dropEmptyColumns(t.rows) }));
}

function dropEmptyColumns(rows) {
  const n = Math.max(...rows.map((r) => r.length));
  const keep = [...Array(n).keys()].filter((i) => rows.some((r) => (r[i] ?? '').trim()));
  return rows.map((r) => keep.map((i) => (r[i] ?? '').trim()));
}

/**
 * Une las tablas que siguen en la página siguiente: la última de una página y la primera de la siguiente, con
 * las mismas columnas; si la segunda repite la cabecera, se quita. tables: [{ page, rows, … }] en orden de
 * lectura. → [{ …, pages: [páginas], rows }]
 */
export function joinContinued(tables) {
  const lastOf = new Map(); const firstOf = new Map();
  for (const t of tables) { if (!firstOf.has(t.page)) firstOf.set(t.page, t); lastOf.set(t.page, t); }
  const out = [];
  let tail = null; // tabla original con la que acaba la última de out
  for (const t of tables) {
    const prev = out.at(-1);
    const joins = prev && tail && lastOf.get(tail.page) === tail && firstOf.get(t.page) === t
      && t.page === tail.page + 1 && t.rows[0]?.length === prev.rows[0]?.length;
    const same = joins && prev.rows[0].join('|').toLowerCase() === t.rows[0].join('|').toLowerCase();
    // Si la de la página siguiente trae su propia cabecera y es otra, es otra tabla (otro documento unido…).
    if (joins && (same || !hasHeader(t.rows))) {
      prev.rows = [...prev.rows, ...(same ? t.rows.slice(1) : t.rows)];
      prev.pages.push(t.page);
    } else {
      out.push({ ...t, pages: [t.page], rows: [...t.rows] });
    }
    tail = t;
  }
  return out;
}

/** ¿La primera fila es una cabecera? Todo texto, y debajo hay algún número o fecha. */
export function hasHeader(rows, style = numberStyle(rows)) {
  if (rows.length < 2) return false;
  const typed = (t) => { const v = parseCell(t, style).value; return v !== null && typeof v !== 'string'; };
  return !rows[0].some(typed) && rows.slice(1).some((r) => r.some(typed));
}

// --- Valores -----------------------------------------------------------------------------------
/**
 * Formato de los números de una tabla: 'es' (1.234,56) o 'en' (1,234.56), por mayoría de los decimales que se
 * ven. Por defecto, 'es'.
 */
export function numberStyle(rows) {
  let es = 0; let en = 0;
  for (const t of rows.flat()) {
    if (/\d,\d{1,2}(\s|$|%|€)/.test(t) || /\d\.\d{3},\d/.test(t)) es++;
    else if (/\d\.\d{1,2}(\s|$|%|€|\$)/.test(t) || /\d,\d{3}\.\d/.test(t)) en++;
  }
  return en > es ? 'en' : 'es';
}

/**
 * Valor de una celda para Excel: { value, numFmt? }. value es número, Date (UTC) o texto.
 *   «1.234,56» → 1234.56 · «12,5 %» → 0.125 (formato %) · «35,00 €» → 35 (formato €) · «05/11/2026», «2026-11-05» → fecha.
 *   Los códigos con ceros delante («0457») y los que mezclan letras se quedan como texto.
 */
export function parseCell(text, style = 'es') {
  const t = String(text ?? '').trim();
  if (!t) return { value: null };
  const date = parseDate(t);
  if (date) return { value: date, numFmt: 'dd/mm/yyyy' };
  const m = /^([-+]?)\s*(€|\$|£)?\s*([\d.,\s]+?)\s*(%|€|\$|£|EUR|eur)?$/.exec(t);
  if (!m || !/\d/.test(m[3])) return { value: t };
  let digits = m[3].replace(/\s/g, '');
  if (/^0\d/.test(digits)) return { value: t }; // código con ceros delante
  const [dec, thou] = style === 'en' ? ['.', ','] : [',', '.'];
  const group = new RegExp(`^\\d{1,3}(\\${thou}\\d{3})+(\\${dec}\\d+)?$`);
  const plain = new RegExp(`^\\d+(\\${dec}\\d+)?$`);
  if (!group.test(digits) && !plain.test(digits)) return { value: t };
  digits = digits.split(thou).join('').replace(dec, '.');
  let n = Number(digits);
  if (!Number.isFinite(n)) return { value: t };
  if (m[1] === '-') n = -n;
  const unit = m[4] ?? m[2];
  const decimals = digits.includes('.') ? digits.split('.')[1].length : 0;
  const base = decimals ? `#,##0.${'0'.repeat(Math.min(decimals, 4))}` : '#,##0';
  if (unit === '%') return { value: n / 100, numFmt: decimals ? `0.${'0'.repeat(Math.min(decimals, 4))}%` : '0%' };
  if (unit === '€' || unit?.toLowerCase() === 'eur') return { value: n, numFmt: `${base} "€"` };
  if (unit === '$') return { value: n, numFmt: `"$"${base}` };
  if (unit === '£') return { value: n, numFmt: `"£"${base}` };
  return { value: n, numFmt: decimals ? base : n >= 10000 ? '#,##0' : '0' };
}

function parseDate(t) {
  let d; let m; let y;
  let r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (r) { [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])]; if (y < 100) y += 2000; }
  else if ((r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) { [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])]; }
  else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCDate() === d ? date : null;
}

/** Cómo se verá una celda en Excel (para la vista previa): número con sus decimales, %, € y fechas dd/mm/aaaa. */
export function displayCell(text, style = 'es') {
  const { value, numFmt = '' } = parseCell(text, style);
  if (value === null) return { text: '', align: 'left' };
  if (value instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return { text: `${p(value.getUTCDate())}/${p(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`, align: 'right', kind: 'date' };
  }
  if (typeof value !== 'number') return { text: value, align: 'left' };
  const decimals = (/0\.(0+)/.exec(numFmt)?.[1].length) ?? 0;
  const pct = numFmt.includes('%');
  const n = new Intl.NumberFormat(getLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: numFmt.includes('#,##0') ? 'always' : false })
    .format(pct ? value * 100 : value);
  const unit = pct ? (getLocale().startsWith('en') ? '%' : ' %') : numFmt.includes('€') ? ' €' : numFmt.includes('"$"') ? ' $' : '';
  return { text: n + unit, align: 'right', kind: 'number' };
}
