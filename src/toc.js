// Índice impreso → marcadores. Puro (sin DOM ni motor): lo usa la interfaz y se prueba en Node.
//
// Una página de índice tiene líneas «2.1 Estructura organizativa ........ 4»: título (con o sin
// numeración), puntos de relleno (o un hueco) y el número de página IMPRESO. Aquí se detectan esas
// líneas, su jerarquía (por la numeración 2, 2.1, 2.1.3… o, si no la hay, por la sangría) y el desfase
// entre el número impreso y la página real del PDF (portada sin numerar, índice en romanos…).
//
// Los caracteres llegan como los da el motor (textChars): { text, boxes: [u0, v0, u1, v1] por carácter
// en fracciones de la página sin girar, v hacia abajo }.

import { normalizeForSearch } from './textGeom.js';

const LEADER_CHARS = '.·•…_‥⋯-‐–—';
const isLeader = (c) => LEADER_CHARS.includes(c);
const ROMAN = /^[ivxlcdm]{1,7}$/i;

/**
 * Líneas de texto de una página, de arriba abajo: [{ text, u0, u1, v0, v1 }].
 * Se parte por los saltos de línea y se vuelven a unir los trozos que están a la misma altura (PDFium
 * separa a veces el número de página del título si hay mucho hueco entre ellos).
 */
export function textLines({ text, boxes }) {
  const segs = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.text.trim()) segs.push(cur);
    cur = null;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n' || c === '\r') { flush(); continue; }
    const [u0, v0, u1, v1] = [boxes[i * 4], boxes[i * 4 + 1], boxes[i * 4 + 2], boxes[i * 4 + 3]];
    const sized = u1 > u0 || v1 > v0;
    if (!cur) cur = { text: '', u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity, chars: [] };
    cur.text += c;
    if (sized && c.trim()) {
      cur.u0 = Math.min(cur.u0, u0); cur.u1 = Math.max(cur.u1, u1);
      cur.v0 = Math.min(cur.v0, v0); cur.v1 = Math.max(cur.v1, v1);
      cur.chars.push(u0);
    }
  }
  flush();
  const lines = segs.filter((s) => Number.isFinite(s.u0));
  // Misma altura (centros a menos de un tercio del alto de línea) → la misma línea, ordenada de izquierda a derecha.
  const out = [];
  for (const s of lines) {
    const mid = (s.v0 + s.v1) / 2;
    const h = s.v1 - s.v0;
    const same = out.find((o) => Math.abs((o.v0 + o.v1) / 2 - mid) < Math.max(h, o.v1 - o.v0) / 3);
    if (same) same.parts.push(s);
    else out.push({ v0: s.v0, v1: s.v1, parts: [s] });
  }
  return out
    .map((o) => {
      const parts = o.parts.sort((a, b) => a.u0 - b.u0);
      return {
        text: parts.map((p) => p.text.trim()).join(' '),
        u0: parts[0].u0,
        u1: Math.max(...parts.map((p) => p.u1)),
        v0: Math.min(...parts.map((p) => p.v0)),
        v1: Math.max(...parts.map((p) => p.v1)),
      };
    })
    .sort((a, b) => a.v0 - b.v0);
}

/** Numeración del principio del título: «2.1», «3.», «A.2», «A.» → { num, depth } o null. */
export function numbering(title) {
  const m = /^((?:\d{1,3}|[A-Z])(?:\.\d{1,3})+|\d{1,3})\.?\s+(?=\S)/.exec(title) ?? /^([A-Z])\.\s+(?=\S)/.exec(title);
  if (!m) return null;
  return { num: m[1], depth: m[1].split('.').length, rest: title.slice(m[0].length) };
}

/**
 * Una línea de índice: «título [relleno] número». → { title, printed, roman, leader } o null.
 * printed: número impreso (los romanos, como número: «iv» = 4). leader: lleva puntos de relleno.
 */
export function parseTocLine(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = /^(.*?)([\s.·•…_‥⋯\-‐–—]*)\s*(\d{1,4}|[ivxlcdm]{1,7})$/i.exec(t);
  if (!m) return null;
  const [, head, sep, num] = m;
  const leaders = [...sep].filter(isLeader).length;
  const leader = leaders >= 3 || sep.includes('…') || sep.includes('⋯');
  const roman = ROMAN.test(num);
  if (roman && !leader) return null; // «Anexo vi» sin relleno: es parte del título
  if (!roman && !leader && !/\s/.test(sep)) return null; // «Hoja2»: pegado, no es un número de página
  const title = head.replace(/[\s.·•…_‥⋯\-‐–—]+$/, '').trim();
  if (!/\p{L}/u.test(title)) return null;
  // «2.1» solo, o un año («Informe 2024») sin relleno: no.
  if (!leader && Number(num) > 999) return null;
  return { title, printed: roman ? romanValue(num) : Number(num), roman, leader };
}

function romanValue(s) {
  const v = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let n = 0;
  const a = s.toLowerCase();
  for (let i = 0; i < a.length; i++) n += v[a[i]] < (v[a[i + 1]] ?? 0) ? -v[a[i]] : v[a[i]];
  return n;
}

/**
 * Entradas del índice de una página (sus líneas, de textLines). → { entries, score }
 *   entries: [{ title, printed, roman, num, level, u0 }] en orden.
 *   score: cuánto parece un índice (0 = nada). Una página es índice con score ≥ 3.
 * Cuentan las líneas con relleno de puntos y, si no lo hay, las que terminan en un número alineado a la
 * derecha con otras. Un título largo partido en dos líneas se une (la primera línea no lleva número).
 */
export function tocEntries(lines) {
  const parsed = lines.map((l) => ({ line: l, p: parseTocLine(l.text) }));
  const cands = parsed.filter((x) => x.p);
  if (cands.length < 3) return { entries: [], score: 0 };
  const withLeader = cands.filter((x) => x.p.leader);
  // Columna de los números: la mediana del borde derecho de las líneas con relleno (o de todas).
  const ref = (withLeader.length >= 3 ? withLeader : cands).map((x) => x.line.u1).sort((a, b) => a - b);
  const right = ref[Math.floor(ref.length / 2)];
  const aligned = (x) => Math.abs(x.line.u1 - right) < 0.03;
  // Con relleno, una línea sin él solo cuenta entre la primera y la última que lo llevan (así no entran
  // la cabecera «Página 3 de 16» ni el pie).
  const top = withLeader[0]?.line.v0 ?? 0;
  const bottom = withLeader.at(-1)?.line.v1 ?? 1;
  const inside = (x) => x.line.v0 >= top - 0.001 && x.line.v1 <= bottom + 0.001;
  const keep = new Set(cands.filter((x) => (withLeader.length >= 3 ? x.p.leader || (aligned(x) && inside(x)) : aligned(x))));
  if (withLeader.length < 3 && keep.size < 4) return { entries: [], score: 0 };

  const entries = [];
  let pending = null; // línea sin número justo encima (primera mitad de un título partido)
  let started = false;
  for (const x of parsed) {
    if (!keep.has(x)) {
      // Solo se une si viene de dentro del índice (no el encabezado «Índice») y lleva numeración propia,
      // o si ya ha empezado el índice y la línea siguiente no la lleva.
      pending = started || numbering(x.line.text) ? x.line : null;
      continue;
    }
    let title = x.p.title;
    let u0 = x.line.u0;
    if (pending && !numbering(title) && x.line.v0 - pending.v1 < (x.line.v1 - x.line.v0) * 1.5) {
      title = `${pending.text.trim()} ${title}`;
      u0 = pending.u0;
    }
    pending = null;
    started = true;
    const n = numbering(title);
    entries.push({ title, printed: x.p.printed, roman: x.p.roman, num: n?.num ?? null, depth: n?.depth ?? 0, u0 });
  }

  // Los números de página deben ir (casi siempre) en aumento.
  const arabic = entries.filter((e) => !e.roman).map((e) => e.printed);
  const rising = arabic.filter((v, i) => i === 0 || v >= arabic[i - 1]).length;
  if (arabic.length >= 3 && rising / arabic.length < 0.7) return { entries: [], score: 0 };

  assignLevels(entries);
  for (const e of entries) delete e.depth;
  return { entries, score: entries.length >= 3 ? entries.length : 0 };
}

/**
 * Nivel de cada entrada (1 = primer nivel). Con numeración, su profundidad («2.1» = 2). Sin ella, la
 * sangría: el nivel de las entradas numeradas que empiezan a esa altura o, si no hay numeradas, el
 * puesto de su sangría entre las distintas que hay.
 */
function assignLevels(entries) {
  const TOL = 0.012;
  const numbered = entries.filter((e) => e.depth);
  const byDepth = new Map();
  for (const e of numbered) byDepth.set(e.depth, [...(byDepth.get(e.depth) ?? []), e.u0]);
  const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const cols = [...byDepth].map(([d, us]) => [d, median(us)]).sort((a, b) => a[0] - b[0]);
  const indents = [];
  for (const u of entries.map((e) => e.u0).sort((a, b) => a - b)) if (!indents.length || u - indents.at(-1) > TOL) indents.push(u);
  for (const e of entries) {
    if (e.depth) { e.level = e.depth; continue; }
    if (cols.length) {
      // La columna más cercana (en empate, la de menos nivel). Más a la izquierda que todas: primer nivel.
      let best = cols[0];
      for (const c of cols) if (Math.abs(c[1] - e.u0) < Math.abs(best[1] - e.u0) - TOL / 2) best = c;
      e.level = e.u0 < cols[0][1] - TOL ? 1 : best[0];
    } else {
      e.level = indents.findIndex((u) => Math.abs(u - e.u0) <= TOL) + 1 || 1;
    }
  }
  // Sin saltos: un hijo está como mucho un nivel por debajo del anterior (3 después de 1 → 2).
  let prev = 0;
  for (const e of entries) { e.level = Math.max(1, Math.min(e.level, prev + 1)); prev = e.level; }
}

/** Título sin numeración y normalizado (para buscarlo en las páginas). */
function key(title) {
  const n = numbering(title);
  const base = normalizeForSearch(n ? n.rest : title).norm.replace(/[.·…_\-–—:]+$/, '').trim();
  return base.slice(0, 48);
}

/**
 * Desfase entre los números impresos y las páginas del PDF: página real (desde 0) = printed − 1 + offset.
 * Cada entrada vota por las páginas en las que aparece su título (sin contar las del propio índice); gana
 * el desfase con más votos. En empate, el más cercano a 0. Sin ningún voto, 0.
 *   pageTexts: texto de cada página del documento, en su orden. skip: índices de las páginas del índice.
 * → { offset, votes, matched } (matched: entradas cuyo título está en su página con ese desfase).
 */
export function guessOffset(entries, pageTexts, skip = []) {
  const skipSet = new Set(skip);
  const norms = pageTexts.map((t, i) => (skipSet.has(i) ? '' : normalizeForSearch(t ?? '').norm));
  const votes = new Map();
  for (const e of entries) {
    if (e.roman) continue;
    const k = key(e.title);
    if (k.length < 3) continue;
    const seen = new Set();
    norms.forEach((t, i) => {
      if (!t.includes(k)) return;
      const o = i - (e.printed - 1);
      if (seen.has(o)) return;
      seen.add(o);
      votes.set(o, (votes.get(o) ?? 0) + 1);
    });
  }
  let offset = 0;
  let best = 0;
  for (const [o, v] of votes) {
    if (v > best || (v === best && Math.abs(o) < Math.abs(offset))) { offset = o; best = v; }
  }
  return { offset, votes: best, matched: best };
}

/** Página real (desde 0) de una entrada con un desfase. Los romanos cuentan desde la primera página. */
export const targetIndex = (e, offset) => (e.roman ? e.printed - 1 : e.printed - 1 + offset);

/**
 * Páginas de índice entre las primeras del documento: la primera que lo parece y las que la siguen
 * seguidas (un índice de varias páginas). pageLines: [líneas de textLines] de las primeras páginas.
 * → [índices] (vacío si ninguna lo parece).
 */
export function findTocPages(pageLines) {
  const first = pageLines.findIndex((l) => l && tocEntries(l).score >= 3);
  if (first < 0) return [];
  const out = [first];
  for (let i = first + 1; i < pageLines.length && pageLines[i] && tocEntries(pageLines[i]).score >= 3; i++) out.push(i);
  return out;
}

/**
 * Árbol de marcadores a partir de una lista plana con niveles: [{ title, level, ...resto }] →
 * [{ title, ...resto, children }]. Un nivel que salta (1 → 3) cuelga del último que hay.
 */
export function treeFromLevels(rows) {
  const root = { children: [], level: 0 };
  const stack = [root];
  for (const r of rows) {
    const { level, ...rest } = r;
    while (stack.length > 1 && stack.at(-1).level >= level) stack.pop();
    const node = { ...rest, children: [], level };
    stack.at(-1).children.push(node);
    stack.push(node);
  }
  const strip = (nodes) => nodes.map(({ level, children, ...rest }) => ({ ...rest, children: strip(children) }));
  return strip(root.children);
}

/** Lista plana con niveles a partir de un árbol (para editarlo). */
export function levelsFromTree(nodes, level = 1, out = []) {
  for (const { children, ...rest } of nodes) {
    out.push({ ...rest, level });
    levelsFromTree(children ?? [], level + 1, out);
  }
  return out;
}
