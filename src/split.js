// Dividir un PDF en varios (Archivo → Dividir PDF…). Puro: se prueba en Node (test/split.test.js).
//
// Cada modo da los grupos de páginas de cada archivo: [{ from, to, title? }] con posiciones en el documento tal como
// está ahora (desde 0; to no incluido).
//   every      cada N páginas («página por página» = cada 1)
//   ranges     intervalos escritos: «1-3, 4-8, 9-» → un archivo por intervalo
//   bookmarks  un archivo por marcador de primer nivel: desde su página hasta antes del siguiente (las páginas de
//              antes del primero van con él)
//   size       tamaño máximo: se compone de verdad cada trozo (groupsBySize con sizeOf) y se guardan esos bytes
// Nombres: patrón con {n} (número), {name} (nombre del PDF), {pages} («4-8») y {title} (el marcador).

import { t } from './i18n/index.js';

export const SPLIT_MODES = ['every', 'ranges', 'bookmarks', 'size', 'page'];
export const DEFAULT_PATTERN = '{name}_{n}.pdf';
export const MIN_MB = 0.1;
export const MAX_MB = 10000;
const VARS = ['n', 'name', 'pages', 'title'];

/** Cada N páginas. */
export function everyGroups(count, n) {
  const k = Math.max(1, Math.floor(n));
  const out = [];
  for (let from = 0; from < count; from += k) out.push({ from, to: Math.min(count, from + k) });
  return out;
}

/** N escrito por el usuario. → { n } o { error } */
export function parseEvery(text, count) {
  const s = String(text ?? '').trim();
  if (!/^\d+$/.test(s) || Number(s) < 1) return { error: t('dialogs.split.everyInvalid') };
  const n = Number(s);
  if (n >= count) return { error: t('dialogs.split.everyTooBig', { count }) };
  return { n };
}

/**
 * Intervalos escritos («1-3, 4-8, 9-», «5», «-2»): un archivo por intervalo, en el orden escrito (se pueden repetir
 * páginas en dos archivos). → { groups } o { error }
 */
export function parseRanges(text, count) {
  const parts = String(text ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return { error: t('dialogs.split.rangesEmpty') };
  const groups = [];
  for (const part of parts) {
    let a;
    let b;
    let m;
    if ((m = /^(\d+)$/.exec(part))) {
      a = b = Number(m[1]);
    } else if ((m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part)) && (m[1] || m[2])) {
      a = m[1] ? Number(m[1]) : 1;
      b = m[2] ? Number(m[2]) : count;
    } else {
      return { error: t('dialogs.split.rangeInvalid', { part }) };
    }
    if (a < 1 || b < 1 || a > count || b > count) return { error: t('dialogs.split.rangeOut', { count }) };
    if (a > b) return { error: t('dialogs.split.rangeReversed', { part }) };
    groups.push({ from: a - 1, to: b });
  }
  return { groups };
}

/** Páginas que no van en ningún archivo (posiciones), para avisar. */
export function leftOut(groups, count) {
  const used = new Uint8Array(count);
  for (const g of groups) used.fill(1, g.from, g.to);
  return [...used.keys()].filter((i) => !used[i]);
}

/**
 * Marcadores de primer nivel → grupos. marks: [{ title, pos }] (pos = posición de su página, o -1). Varios en la
 * misma página: cuenta el primero. → [{ from, to, title }] ([] si no hay ninguno con página).
 */
export function bookmarkGroups(count, marks) {
  const seen = new Set();
  const list = marks
    .filter((m) => m.pos >= 0 && m.pos < count)
    .map((m, i) => ({ ...m, i }))
    .sort((x, y) => x.pos - y.pos || x.i - y.i)
    .filter((m) => (seen.has(m.pos) ? false : seen.add(m.pos)));
  return list.map((m, i) => ({ from: i === 0 ? 0 : m.pos, to: list[i + 1]?.pos ?? count, title: m.title }));
}

/** Página del primer marcador que lleva a alguna (el propio o, si no lleva a ninguna, el de sus hijos). */
export function firstPos(node) {
  if (node.pos >= 0) return node.pos;
  for (const c of node.children ?? []) {
    const p = firstPos(c);
    if (p >= 0) return p;
  }
  return -1;
}

/** «2,5» o «2.5» MB → bytes. → { bytes } o { error } */
export function parseMb(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  const v = /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  if (!(v >= MIN_MB && v <= MAX_MB)) return { error: t('dialogs.split.sizeInvalid', { min: String(MIN_MB).replace('.', t('dialogs.split.decimal')) }) };
  return { bytes: Math.floor(v * 1024 * 1024) };
}

const cancelledError = () => Object.assign(new Error(t('dialogs.split.cancelled')), { cancelled: true });

/**
 * Grupos de páginas seguidas que no pasan de maxBytes, componiendo de verdad (sizeOf(from, to) → Promise<bytes>,
 * el mismo PDF que se guardará). Busca el final de cada grupo a saltos (según lo que pesa cada página de media) y
 * luego por bisección: pocas composiciones por archivo. Una página que sola ya pasa del máximo va sola (over).
 * Supone que más páginas no pesan menos (casi siempre cierto); aun si no, ningún grupo pasa del máximo.
 * → [{ from, to, size, bytes, over? }]
 */
export async function groupsBySize(count, maxBytes, sizeOf, { isCancelled = () => false, onProgress } = {}) {
  const probe = async (from, to) => {
    if (isCancelled()) throw cancelledError();
    const bytes = await sizeOf(from, to);
    if (isCancelled()) throw cancelledError();
    return bytes;
  };
  const all = await probe(0, count);
  if (all.length <= maxBytes) return [{ from: 0, to: count, size: all.length, bytes: all }];
  const perPage = all.length / count;
  const groups = [];
  let from = 0;
  while (from < count) {
    onProgress?.({ done: from, total: count, files: groups.length });
    let best = null; // { to, bytes }: el final más lejano que cabe
    let single = null; // bytes de la primera página sola (si se compuso)
    let hi = count + 1; // primer final que no cabe
    const tryEnd = async (to) => {
      const bytes = await probe(from, to);
      if (to === from + 1) single = bytes;
      if (bytes.length <= maxBytes) { best = { to, bytes }; return true; }
      hi = to;
      return false;
    };
    // 1. Primer intento según la media; si cabe, crecer a saltos cada vez mayores hasta que no quepa.
    if (await tryEnd(Math.min(count, from + Math.max(1, Math.floor(maxBytes / perPage))))) {
      let step = Math.max(1, Math.floor((maxBytes - best.bytes.length) / perPage));
      while (best.to < count && await tryEnd(Math.min(count, best.to + step))) step *= 2;
    }
    // 2. Bisección entre lo último que cabe y lo primero que no.
    while (hi - (best?.to ?? from) > 1) await tryEnd(Math.floor(((best?.to ?? from) + hi) / 2));
    if (best) groups.push({ from, to: best.to, size: best.bytes.length, bytes: best.bytes });
    else {
      const bytes = single ?? await probe(from, from + 1);
      groups.push({ from, to: from + 1, size: bytes.length, bytes, over: true });
    }
    from = groups.at(-1).to;
  }
  onProgress?.({ done: count, total: count, files: groups.length });
  return groups;
}

// --- Nombres -------------------------------------------------------------------------------------------

/** Nombre de archivo válido en Windows y macOS: sin rutas ni caracteres prohibidos, sin nombres reservados. */
export function safeFileName(base) {
  let n = String(base ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim()
    .replace(/^[.\s-]+/, '').replace(/[.\s]+$/, '');
  n = n.slice(0, 150).trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `${n}_`;
  return n;
}

/**
 * ¿El patrón vale? Tiene que dar un nombre distinto a cada archivo: con {n} o {pages} (o {title}, al dividir por
 * marcadores, que es el único modo en el que tiene valor). → null o el texto del error.
 */
export function patternError(pattern, mode = 'every') {
  const p = String(pattern ?? '').trim();
  if (!p.replace(/\.pdf$/i, '').trim()) return t('dialogs.split.patternEmpty');
  const unknown = [...p.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).find((v) => !VARS.includes(v.toLowerCase()));
  if (unknown !== undefined) return t('dialogs.split.patternUnknown', { bad: `{${unknown}}` });
  const varies = mode === 'bookmarks' ? /\{(n|pages|title)\}/i : /\{(n|pages)\}/i;
  if (!varies.test(p)) return t(mode === 'bookmarks' ? 'dialogs.split.patternNeedsTitle' : 'dialogs.split.patternNeedsN');
  return null;
}

/**
 * Nombre de cada archivo. groups: [{ from, to, title? }]; name: el del documento. Sin repetir (los que coinciden
 * llevan « (2)», « (3)»…, también sin distinguir mayúsculas) y siempre .pdf.
 */
export function fileNames(pattern, groups, { name = '' } = {}) {
  const base = String(pattern ?? '').trim().replace(/\.pdf$/i, '');
  const used = new Set();
  return groups.map((g, i) => {
    const pages = g.to - g.from > 1 ? `${g.from + 1}-${g.to}` : String(g.from + 1);
    const vars = { n: String(i + 1), name: safeFileName(name), pages, title: safeFileName(g.title ?? '') };
    let n = safeFileName(base.replace(/\{(n|name|pages|title)\}/gi, (_, v) => vars[v.toLowerCase()])) || vars.n;
    let candidate = n;
    for (let k = 2; used.has(candidate.toLowerCase()); k++) candidate = `${n} (${k})`;
    used.add(candidate.toLowerCase());
    return `${candidate}.pdf`;
  });
}

/** Rango de páginas para mostrar: «1-3» o «5». */
export const pagesLabel = (g) => (g.to - g.from > 1 ? `${g.from + 1}-${g.to}` : String(g.from + 1));
