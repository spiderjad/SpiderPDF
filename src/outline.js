// Índice (marcadores) del documento que se está editando. Puro: lo usan la interfaz y el motor.
//
// Cada PDF abierto tiene su árbol tal como viene: [{ title, pageIndex, children }], con pageIndex
// en la numeración de ESE PDF (-1 si no lleva a una página suya). Tras unir, reordenar y eliminar,
// cada marcador apunta a la posición actual de su página (pos), o a ninguna si se eliminó (missing).

import { t } from './i18n/index.js';

/**
 * Árbol para mostrar o guardar.
 *   pages: páginas en su orden actual ({ docId, index, source? }).
 *   trees: Map docId → árbol de ese PDF (o undefined si aún no se ha leído).
 *   names: Map docId → nombre del archivo (para los grupos).
 * Devuelve [{ id, title, pos, missing, group?, children }]:
 *   pos     posición actual de la página destino (-1 si no hay).
 *   missing la página destino existía pero ya no está.
 *   group   nodo que agrupa un archivo (solo si hay varios PDFs y alguno tiene índice).
 */
export function mapOutline(pages, trees, names = new Map()) {
  const pos = new Map();
  pages.forEach((p, i) => { const k = `${p.docId}:${p.index}`; if (!pos.has(k)) pos.set(k, i); });
  const docs = [...new Set(pages.map((p) => p.docId))].filter((d) => d != null); // páginas nuevas: sin índice

  const conv = (docId, nodes, prefix) => (nodes ?? []).map((n, i) => {
    const id = `${prefix}/${i}`;
    const p = n.pageIndex >= 0 ? pos.get(`${docId}:${n.pageIndex}`) ?? -1 : -1;
    return { id, title: n.title, pos: p, missing: n.pageIndex >= 0 && p < 0, children: conv(docId, n.children, id) };
  });

  if (docs.length === 1) return conv(docs[0], trees.get(docs[0]), `d${docs[0]}`);
  if (!docs.some((d) => trees.get(d)?.length)) return [];
  return docs.map((d) => ({
    id: `d${d}`,
    title: names.get(d) ?? t('reader.outline.documentN', { n: d }),
    pos: pos.get(`${d}:${pages.find((p) => p.docId === d).index}`),
    missing: false,
    group: true,
    children: conv(d, trees.get(d), `d${d}`),
  }));
}

/** Quita los marcadores que no llevan a ninguna página y no tienen hijos que sí lleven (para guardar). */
export function pruneOutline(nodes) {
  return nodes.flatMap((n) => {
    const children = pruneOutline(n.children);
    return n.pos >= 0 || children.length ? [{ ...n, children }] : [];
  });
}

/** Todos los nodos en orden de lectura, con la lista de sus antepasados. */
export function flatten(nodes, ancestors = [], out = []) {
  for (const n of nodes) {
    out.push({ node: n, ancestors });
    flatten(n.children, [...ancestors, n.id], out);
  }
  return out;
}

/**
 * Marcador de la sección que se está viendo: el último (en orden de lectura) cuya página está en
 * la página actual o antes. Con varios en la misma página gana el último (el más concreto).
 * Si está dentro de un nodo plegado, se marca el antepasado visible más cercano.
 */
export function activeId(nodes, current, expanded = null) {
  let best = null;
  let bestPos = -1;
  for (const { node, ancestors } of flatten(nodes)) {
    if (node.pos < 0 || node.pos > current) continue;
    if (node.pos >= bestPos) { best = { node, ancestors }; bestPos = node.pos; }
  }
  if (!best) return null;
  if (expanded) {
    const hidden = best.ancestors.findIndex((a) => !expanded.has(a));
    if (hidden >= 0) return best.ancestors[hidden];
  }
  return best.node.id;
}

/** Nodos visibles (los hijos de los plegados no cuentan), para moverse con el teclado. */
export function visibleNodes(nodes, expanded, depth = 0, out = []) {
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.children.length && expanded.has(n.id)) visibleNodes(n.children, expanded, depth + 1, out);
  }
  return out;
}

// --- Índice creado en la app (desde un índice impreso) ------------------------------------------
// Vive en el estado (state.outline) como [{ title, key, children }]: key es la página del estado a la
// que lleva (así sigue a su página al reordenar). Al guardar sustituye al índice de los PDF de partida.

/** Como mapOutline, para el índice creado: [{ id, title, pos, missing, children }]. */
export function mapCustomOutline(pages, tree, prefix = 'c') {
  const pos = new Map(pages.map((p, i) => [p.key, i]));
  return (tree ?? []).map((n, i) => {
    const id = `${prefix}/${i}`;
    const p = n.key != null ? pos.get(n.key) ?? -1 : -1;
    return { id, title: n.title, pos: p, missing: n.key != null && p < 0, children: mapCustomOutline(pages, n.children, id) };
  });
}

/** Índice creado → el que escribe el motor (compose): [{ title, pos, children }], sin los que no llevan a nada. */
export function outlineForSave(pages, tree) {
  if (!tree) return undefined;
  const strip = (nodes) => nodes.map((n) => ({ title: n.title, pos: n.pos, children: strip(n.children) }));
  return strip(pruneOutline(mapCustomOutline(pages, tree)));
}
