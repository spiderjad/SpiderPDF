// Pestañas: varios documentos en una ventana. Puro (sin React ni DOM) para probarlo en Node (test/tabs.test.js).
//
// Estado de la ventana: { tabs: [{ id, doc }], active }. Cada doc es el estado de un documento (src/state.js) y
// su reducer es el de siempre: una acción de documento va a la pestaña a.tab o, sin ella, a la activa. Las tareas
// que esperan (guardar, OCR…) anotan su pestaña al empezar y la mandan en a.tab, así no tocan otra si se cambia.
// Siempre hay al menos una pestaña (vacía: el estado inicial con «Abre un PDF para empezar»).
//
// Mover una pestaña a otra ventana: snapshotDoc() la deja lista para el IPC (sin historial ni Blobs) y en la
// ventana nueva restoreDoc() la reconstruye con los docId de sus PDF ya abiertos allí y claves nuevas (las claves
// de página y los id de anotación son contadores de cada ventana: los de la otra podrían repetirse).

import { reducer as docReducer, initialState, newKey, newAnnotId } from './state.js';
import { samePath } from './savePlan.js';

let tabSeq = 0;
export const newTabId = () => `t${++tabSeq}`;

/** Documento vacío para una pestaña nueva: hereda la vista y el zoom de la que estaba activa. */
const blankDoc = (from) => ({ ...initialState, mode: from?.mode ?? initialState.mode, zoom: from?.zoom ?? initialState.zoom });

export function initialTabs() {
  const id = newTabId();
  return { tabs: [{ id, doc: blankDoc() }], active: id };
}

export const activeTab = (root) => root.tabs.find((x) => x.id === root.active) ?? root.tabs[0];
export const tabById = (root, id) => root.tabs.find((x) => x.id === id) ?? null;
/** ¿Pestaña sin documento ni cambios? (se reutiliza al abrir en vez de crear otra). */
export const isBlank = (doc) => !doc.pages.length && !doc.dirty;
/** Pestañas con cambios sin guardar. */
export const dirtyTabs = (root) => root.tabs.filter((x) => x.doc.dirty && x.doc.pages.length > 0);
/**
 * Pestaña que ya tiene abierto ese archivo (el suyo: donde guarda «Guardar»). Un PDF añadido a otro documento no
 * cuenta: abrirlo aparte es otra cosa.
 */
export function findTabByPath(root, path) {
  if (!path) return null;
  return root.tabs.find((x) => x.doc.file?.path && samePath(x.doc.file.path, path)) ?? null;
}

/** Pestaña siguiente (dir 1) o anterior (dir -1), dando la vuelta. */
export function cycleTab(root, dir) {
  const i = root.tabs.findIndex((x) => x.id === root.active);
  const n = root.tabs.length;
  return root.tabs[(i + dir + n) % n].id;
}

/** Lo que se recuerda para la próxima vez: las rutas de las pestañas con archivo y cuál estaba activa. */
export function sessionOf(root) {
  const withPath = root.tabs.filter((x) => x.doc.file?.path);
  return { tabs: withPath.map((x) => x.doc.file.path), active: Math.max(0, withPath.findIndex((x) => x.id === root.active)) };
}

function insertAfter(tabs, afterId, tab) {
  const i = tabs.findIndex((x) => x.id === afterId);
  return i < 0 ? [...tabs, tab] : [...tabs.slice(0, i + 1), tab, ...tabs.slice(i + 1)];
}

function setDoc(root, id, doc) {
  return { ...root, tabs: root.tabs.map((x) => (x.id === id ? { ...x, doc } : x)) };
}

export function tabsReducer(root, a) {
  switch (a.type) {
    case 'tabNew': {
      // a: { id?, doc?, activate = true }. Se coloca a la derecha de la activa.
      const tab = { id: a.id ?? newTabId(), doc: a.doc ?? blankDoc(activeTab(root).doc) };
      return { tabs: insertAfter(root.tabs, root.active, tab), active: a.activate === false ? root.active : tab.id };
    }

    case 'tabOpen': {
      // a: { sources, pages, file, into?, newTab? }. En la pestaña into (por defecto la activa) si está vacía; si no,
      // o con newTab, en una nueva a la derecha de la activa. Queda activa.
      const open = { type: 'open', sources: a.sources, pages: a.pages, file: a.file };
      const into = a.newTab ? null : tabById(root, a.into ?? root.active);
      if (into && isBlank(into.doc)) return { ...setDoc(root, into.id, docReducer(into.doc, open)), active: into.id };
      const tab = { id: a.id ?? newTabId(), doc: docReducer(blankDoc(activeTab(root).doc), open) };
      return { tabs: insertAfter(root.tabs, root.active, tab), active: tab.id };
    }

    case 'tabAdopt': {
      // a: { doc, into? }. Documento que llega de otra ventana (ya reconstruido con restoreDoc); como tabOpen.
      const into = a.newTab ? null : tabById(root, a.into ?? root.active);
      if (into && isBlank(into.doc)) return { ...setDoc(root, into.id, a.doc), active: into.id };
      const tab = { id: newTabId(), doc: a.doc };
      return { tabs: insertAfter(root.tabs, root.active, tab), active: tab.id };
    }

    case 'tabClose': {
      // a: { id }. Al cerrar la activa pasa a la de su derecha (o la de su izquierda si era la última).
      const i = root.tabs.findIndex((x) => x.id === a.id);
      if (i < 0) return root;
      const tabs = root.tabs.filter((x) => x.id !== a.id);
      if (!tabs.length) {
        const id = newTabId();
        return { tabs: [{ id, doc: blankDoc(root.tabs[i].doc) }], active: id };
      }
      const active = root.active === a.id ? tabs[Math.min(i, tabs.length - 1)].id : root.active;
      return { tabs, active };
    }

    case 'tabActivate':
      return root.active === a.id || !tabById(root, a.id) ? root : { ...root, active: a.id };

    case 'tabMove': {
      // a: { id, to }: la pestaña pasa a la posición to (arrastrarla en la barra). No es un cambio del documento.
      const i = root.tabs.findIndex((x) => x.id === a.id);
      const to = Math.max(0, Math.min(root.tabs.length - 1, a.to));
      if (i < 0 || i === to) return root;
      const tabs = root.tabs.slice();
      const [tab] = tabs.splice(i, 1);
      tabs.splice(to, 0, tab);
      return { ...root, tabs };
    }

    default: {
      // Acción de documento: a la pestaña a.tab o a la activa.
      const tab = tabById(root, a.tab ?? root.active);
      if (!tab) return root;
      const doc = docReducer(tab.doc, a);
      return doc === tab.doc ? root : setDoc(root, tab.id, doc);
    }
  }
}

// --- Mover una pestaña a otra ventana ----------------------------------------------------------

const blobBytes = async (b) => ({ bytes: new Uint8Array(await b.arrayBuffer()), type: b.type });

/**
 * Documento → algo que se puede mandar por IPC (clonado estructurado de Electron): sin historial (deshacer no viaja),
 * la selección como lista y los Blob (imágenes insertadas como página, firmas) como bytes.
 */
export async function snapshotDoc(doc) {
  const pages = await Promise.all(doc.pages.map(async (p) => ({
    ...p,
    created: p.created?.blob instanceof Blob ? { ...p.created, blob: await blobBytes(p.created.blob) } : p.created,
    annots: await Promise.all((p.annots ?? []).map(async (x) => (x.src instanceof Blob ? { ...x, src: await blobBytes(x.src) } : x))),
  })));
  return {
    pages,
    selected: [...doc.selected],
    anchor: doc.anchor,
    mode: doc.mode,
    zoom: doc.zoom,
    current: doc.current,
    file: doc.file,
    dirty: doc.dirty,
    security: doc.security?.kind === 'remove' ? { kind: 'remove' } : null, // «Proteger» (token del worker) no viaja
    outline: doc.outline,
    annotSel: doc.annotSel,
  };
}

/**
 * Snapshot (de snapshotDoc) → documento de esta ventana. docIds: Map docId de la otra ventana → docId de esta;
 * sources: los PDF ya abiertos aquí. Claves de página e id de anotación nuevos (y todo lo que los nombra).
 */
export function restoreDoc(snap, { docIds, sources }) {
  const keys = new Map();
  const annotIds = new Map(); // "clave vieja:id viejo" → id nuevo
  const toBlob = (v) => (v && v.bytes instanceof Uint8Array ? new Blob([v.bytes], { type: v.type }) : v);
  const pages = snap.pages.map((p) => {
    const key = newKey();
    keys.set(p.key, key);
    return {
      ...p,
      key,
      docId: p.docId == null ? null : docIds.get(p.docId),
      created: p.created ? { ...p.created, blob: toBlob(p.created.blob) } : p.created,
      annots: (p.annots ?? []).map((x) => {
        const id = newAnnotId();
        annotIds.set(`${p.key}:${x.id}`, id);
        return { ...x, id, src: toBlob(x.src) };
      }),
    };
  });
  if (pages.some((p) => p.docId === undefined)) throw new Error('restoreDoc: falta el PDF de alguna página');
  const outline = (nodes) => nodes?.map((n) => ({ ...n, key: n.key == null ? n.key : keys.get(n.key) ?? null, children: outline(n.children) ?? [] }));
  const sel = snap.annotSel && annotIds.get(`${snap.annotSel.key}:${snap.annotSel.id}`);
  return {
    ...initialState,
    sources,
    pages,
    selected: new Set(snap.selected.map((k) => keys.get(k)).filter(Boolean)),
    anchor: keys.get(snap.anchor) ?? null,
    mode: snap.mode,
    zoom: snap.zoom,
    current: Math.min(snap.current ?? 0, Math.max(0, pages.length - 1)),
    file: snap.file,
    dirty: snap.dirty,
    security: snap.security,
    outline: snap.outline ? outline(snap.outline) : null,
    annotSel: sel ? { key: keys.get(snap.annotSel.key), id: sel } : null,
  };
}
