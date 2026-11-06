// Estado puro (sin React ni DOM) para poder probarlo en Node.
// Una página es { key, docId, index, width, height, rot0, rot, source, annots, fields }:
//   rot0   giro que ya trae el PDF (cuartos de vuelta); rot, el que añade el usuario.
//   annots [{ id, type: 'highlight' | 'ink' | 'note' | 'image', ... }] en fracciones sin rotar (ver geometry.js).
//   fields { annotIndex: valor } solo con los campos de formulario que el usuario cambió.
//   textEdits { objIndex: { text, from } } textos del PDF cambiados ('' = borrado); from = texto original.
//   Las anotaciones { type: 'redact', rect } son zonas que se redactan al guardar.
// Las anotaciones y los campos viven dentro de las páginas, así que deshacer y rehacer los cubren.
// outline: índice creado en la app ([{ title, key, children }], ver outline.js) o null = el de los PDF.
// El historial guarda { pages, outline } en cada paso.

import { moveAnnot } from './geometry.js';

let keySeq = 0;
export const newKey = () => `p${++keySeq}`;
let annotSeq = 0;
export const newAnnotId = () => `a${++annotSeq}`;

const HISTORY_LIMIT = 100;

export const initialState = {
  sources: [],          // [{ docId, name, path }]
  pages: [],
  selected: new Set(),  // keys
  anchor: null,         // última página clicada (para Mayús+clic)
  past: [],
  future: [],
  mode: 'organize',     // 'organize' | 'read'
  zoom: 1,              // 1 = 100 %
  current: 0,           // página visible en modo lectura
  file: null,           // { path, name } donde se guarda con "Guardar"
  dirty: false,
  // Protección elegida para el próximo guardado (sin contraseñas: viven en el worker, ver pdf.setProtection):
  // null = la del PDF base; { kind: 'set', token, perms, separateOwner } o { kind: 'remove' }.
  security: null,
  outline: null,        // índice creado desde un índice impreso (null = el de los PDF de partida)
  annotSel: null,       // { key, id } anotación seleccionada con la herramienta Seleccionar
  lastTag: null,        // etiqueta del último cambio, para agrupar ediciones seguidas en un solo paso de deshacer
};

export function pagesFrom(source, sizes) {
  return sizes.map((s, index) => ({
    key: newKey(), docId: source.docId, index, width: s.width, height: s.height,
    rot0: s.rot0 ?? 0, rot: 0, source: source.name, hasForm: !!source.hasForm, annots: [], fields: {}, textEdits: {},
  }));
}

/**
 * Guarda un cambio en el historial. Si tag coincide con el del cambio anterior (escribir en un campo,
 * arrastrar una anotación), se agrupa con él: un solo Deshacer lo revierte entero.
 */
function commit(s, pages, extra = {}, tag = null) {
  const merge = tag !== null && tag === s.lastTag && s.past.length > 0;
  const past = merge ? s.past : [...s.past.slice(-HISTORY_LIMIT + 1), { pages: s.pages, outline: s.outline }];
  return { ...s, past, future: [], pages, dirty: true, lastTag: tag, ...extra };
}

/** Cambia una página concreta. Devuelve s si no existe o si fn no cambia nada. */
function editPage(s, key, fn, extra, tag) {
  const i = s.pages.findIndex((p) => p.key === key);
  if (i < 0) return s;
  const next = fn(s.pages[i]);
  if (next === s.pages[i]) return s;
  const pages = s.pages.slice();
  pages[i] = next;
  return commit(s, pages, extra, tag);
}

function annotExists(pages, sel) {
  return !!sel && !!pages.find((p) => p.key === sel.key)?.annots?.some((x) => x.id === sel.id);
}

function prune(selected, pages) {
  const keys = new Set(pages.map((p) => p.key));
  return new Set([...selected].filter((k) => keys.has(k)));
}

export function reducer(s, a) {
  switch (a.type) {
    case 'open':
      return {
        ...initialState, mode: s.mode, zoom: s.zoom,
        sources: a.sources, pages: a.pages, file: a.file, dirty: a.pages.length > 0 && !a.file,
      };

    case 'add': {
      const at = Math.min(a.at ?? s.pages.length, s.pages.length);
      const pages = [...s.pages.slice(0, at), ...a.pages, ...s.pages.slice(at)];
      return commit(s, pages, {
        sources: [...s.sources, ...a.sources],
        selected: new Set(a.pages.map((p) => p.key)),
        anchor: a.pages[0]?.key ?? null,
      });
    }

    case 'rotate':
      if (!a.keys.size) return s;
      return commit(s, s.pages.map((p) => (a.keys.has(p.key) ? { ...p, rot: (p.rot + a.delta + 4) % 4 } : p)));

    case 'delete': {
      if (!a.keys.size) return s;
      const pages = s.pages.filter((p) => !a.keys.has(p.key));
      return commit(s, pages, {
        selected: new Set(), anchor: null, annotSel: annotExists(pages, s.annotSel) ? s.annotSel : null,
        current: Math.min(s.current, Math.max(0, pages.length - 1)),
      });
    }

    case 'move': {
      // Mueve las páginas de a.keys para que queden insertadas antes de la posición a.to
      const moving = s.pages.filter((p) => a.keys.has(p.key));
      if (!moving.length) return s;
      const before = s.pages.slice(0, a.to).filter((p) => a.keys.has(p.key)).length;
      const rest = s.pages.filter((p) => !a.keys.has(p.key));
      const at = a.to - before;
      const pages = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
      if (pages.every((p, i) => p === s.pages[i])) return s;
      return commit(s, pages);
    }

    case 'select': {
      const { key, how } = a; // how: 'single' | 'toggle' | 'range'
      if (how === 'toggle') {
        const selected = new Set(s.selected);
        selected.has(key) ? selected.delete(key) : selected.add(key);
        return { ...s, selected, anchor: key };
      }
      if (how === 'range' && s.anchor) {
        const i = s.pages.findIndex((p) => p.key === s.anchor);
        const j = s.pages.findIndex((p) => p.key === key);
        if (i >= 0 && j >= 0) {
          const [from, to] = i < j ? [i, j] : [j, i];
          return { ...s, selected: new Set(s.pages.slice(from, to + 1).map((p) => p.key)) };
        }
      }
      return { ...s, selected: new Set([key]), anchor: key };
    }

    case 'addAnnot': {
      // a: { key, annot }. La anotación nueva queda seleccionada.
      const annot = { ...a.annot, id: a.annot.id ?? newAnnotId() };
      return editPage(s, a.key, (p) => ({ ...p, annots: [...(p.annots ?? []), annot] }),
        { annotSel: { key: a.key, id: annot.id } });
    }

    case 'updateAnnot': {
      // a: { key, id, changes, group? }. Con group, los cambios seguidos sobre la misma anotación
      // (un arrastre, escribir el texto de una nota) se deshacen de una vez.
      return editPage(s, a.key, (p) => {
        const i = (p.annots ?? []).findIndex((x) => x.id === a.id);
        if (i < 0) return p;
        const annots = p.annots.slice();
        annots[i] = { ...annots[i], ...a.changes, id: a.id };
        return { ...p, annots };
      }, {}, a.group ? `annot:${a.key}:${a.id}` : null);
    }

    case 'duplicateAnnot': {
      // a: { key, id }. Copia un poco desplazada (abajo a la derecha), que queda seleccionada.
      const src = s.pages.find((p) => p.key === a.key)?.annots.find((x) => x.id === a.id);
      if (!src) return s;
      const { id: _old, ...rest } = moveAnnot(src, 0.02, 0.02, 0);
      const copy = { ...rest, id: newAnnotId() };
      return editPage(s, a.key, (p) => ({ ...p, annots: [...p.annots, copy] }), { annotSel: { key: a.key, id: copy.id } });
    }

    case 'reorderAnnot':
      // a: { key, id, to: 'front' | 'back' }. Lo de después se dibuja encima.
      return editPage(s, a.key, (p) => {
        const i = p.annots.findIndex((x) => x.id === a.id);
        if (i < 0) return p;
        const rest = p.annots.filter((x) => x.id !== a.id);
        const annots = a.to === 'front' ? [...rest, p.annots[i]] : [p.annots[i], ...rest];
        return annots.every((x, j) => x === p.annots[j]) ? p : { ...p, annots };
      });

    case 'removeAnnot':
      return editPage(s, a.key, (p) => {
        const annots = (p.annots ?? []).filter((x) => x.id !== a.id);
        return annots.length === (p.annots ?? []).length ? p : { ...p, annots };
      }, { annotSel: s.annotSel?.key === a.key && s.annotSel?.id === a.id ? null : s.annotSel });

    case 'setTextEdit':
      // a: { key, objIndex, text, from }. Volver al texto original quita la edición.
      return editPage(s, a.key, (p) => {
        const edits = { ...(p.textEdits ?? {}) };
        const prev = edits[a.objIndex]?.text ?? a.from;
        if (prev === a.text) return p;
        if (a.text === a.from) delete edits[a.objIndex];
        else edits[a.objIndex] = { text: a.text, from: a.from };
        return { ...p, textEdits: edits };
      });

    case 'endGroup':
      // Fin de un arrastre o de escribir en un campo: el siguiente cambio será otro paso de deshacer.
      return s.lastTag === null ? s : { ...s, lastTag: null };

    case 'selectAnnot':
      // a: { key, id }, o sin key para quitar la selección
      return { ...s, annotSel: a.key ? { key: a.key, id: a.id } : null };

    case 'setField':
      // a: { key, annotIndex, value }. Escribir seguido en el mismo campo es un solo paso de deshacer.
      return editPage(s, a.key, (p) => {
        if (p.fields?.[a.annotIndex] === a.value) return p;
        return { ...p, fields: { ...(p.fields ?? {}), [a.annotIndex]: a.value } };
      }, {}, `field:${a.key}:${a.annotIndex}`);

    case 'setOutline':
      // a: { outline }. Índice creado desde un índice impreso (o editado); null vuelve al de los PDF.
      return a.outline === s.outline ? s : commit(s, s.pages, { outline: a.outline });

    case 'setOcr':
      // a: { key, words, job }. Capa de texto del OCR de una página (src/ocr/layer.js). Todas las páginas de una
      // misma tanda (job) son un solo paso de deshacer.
      return editPage(s, a.key, (p) => ({ ...p, ocr: a.words }), {}, a.job ? `ocr:${a.job}` : null);

    case 'selectAll':
      return { ...s, selected: new Set(s.pages.map((p) => p.key)) };

    case 'clearSelection':
      return s.selected.size ? { ...s, selected: new Set(), anchor: null } : s;

    case 'undo': {
      if (!s.past.length) return s;
      const { pages, outline } = s.past[s.past.length - 1];
      return {
        ...s, pages, outline, past: s.past.slice(0, -1), future: [{ pages: s.pages, outline: s.outline }, ...s.future], dirty: true, lastTag: null,
        selected: prune(s.selected, pages), annotSel: annotExists(pages, s.annotSel) ? s.annotSel : null,
      };
    }

    case 'redo': {
      if (!s.future.length) return s;
      const [{ pages, outline }, ...future] = s.future;
      return {
        ...s, pages, outline, past: [...s.past, { pages: s.pages, outline: s.outline }], future, dirty: true, lastTag: null,
        selected: prune(s.selected, pages), annotSel: annotExists(pages, s.annotSel) ? s.annotSel : null,
      };
    }

    case 'saved':
      return { ...s, dirty: false, file: a.file };
    case 'setSecurity':
      return { ...s, security: a.security, dirty: true };
    case 'sourceSecurity':
      // Permisos desbloqueados con la contraseña de propietario: no es un cambio del documento.
      return { ...s, sources: s.sources.map((src) => (src.docId === a.docId ? { ...src, security: a.security } : src)) };
    case 'mode':
      return { ...s, mode: a.mode };
    case 'zoom':
      return { ...s, zoom: Math.min(4, Math.max(0.25, a.zoom)) };
    case 'current':
      return s.current === a.index ? s : { ...s, current: a.index };
    default:
      return s;
  }
}

/** Páginas sobre las que actúan las herramientas: la selección, o la página actual al leer. */
export function targetKeys(s) {
  if (s.selected.size) return s.selected;
  if (s.mode === 'read' && s.pages[s.current]) return new Set([s.pages[s.current].key]);
  return new Set();
}
