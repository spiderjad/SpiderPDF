import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText, ListTree } from 'lucide-react';
import { pdf } from '../engine/client.js';
import { mapOutline, activeId, visibleNodes } from '../outline.js';

/**
 * Pestaña «Marcadores» del panel de Leer: el índice de los PDF abiertos como árbol plegable.
 * Cada marcador lleva a la posición ACTUAL de su página (tras reordenar o eliminar); si su página
 * se eliminó, sale en gris y desactivado. Con varios PDFs unidos, un grupo por archivo.
 * Teclado (patrón «tree» de ARIA): flechas, Inicio/Fin, Intro o Espacio para ir.
 */
export default function OutlinePanel({ pages, current, onGo }) {
  const docKey = [...new Set(pages.map((p) => p.docId))].filter((d) => d != null).join(',');
  const [trees, setTrees] = useState(null);
  useEffect(() => {
    let alive = true;
    const ids = docKey.split(',').filter(Boolean).map(Number);
    Promise.all(ids.map((d) => pdf.bookmarks(d).catch(() => []).then((t) => [d, t])))
      .then((list) => { if (alive) setTrees(new Map(list)); });
    return () => { alive = false; };
  }, [docKey]);

  const names = useMemo(() => new Map(pages.map((p) => [p.docId, p.source])), [pages]);
  const nodes = useMemo(() => (trees ? mapOutline(pages, trees, names) : null), [pages, trees, names]);

  // Plegado: los grupos de archivo empiezan abiertos; los marcadores con hijos, cerrados.
  const [toggled, setToggled] = useState(() => new Set());
  const isOpen = (n) => (n.group ? !toggled.has(n.id) : toggled.has(n.id));
  const expanded = useMemo(() => {
    const out = new Set();
    const walk = (list) => list?.forEach((n) => { if (isOpen(n)) out.add(n.id); walk(n.children); });
    walk(nodes);
    return out;
  }, [nodes, toggled]);
  const toggle = (id) => setToggled((s) => { const t = new Set(s); t.has(id) ? t.delete(id) : t.add(id); return t; });

  // Marcador elegido con un clic: sigue marcado mientras se esté en su página (varios pueden compartirla).
  const [picked, setPicked] = useState(null);
  const visible = useMemo(() => (nodes ? visibleNodes(nodes, expanded) : []), [nodes, expanded]);
  const pickedShown = picked && picked.pos === current && visible.some((v) => v.node.id === picked.id);
  const active = !nodes ? null : pickedShown ? picked.id : activeId(nodes, current, expanded);

  const [focusId, setFocusId] = useState(null);
  const focused = visible.find((v) => v.node.id === focusId) ? focusId : active ?? visible[0]?.node.id ?? null;
  const treeRef = useRef(null);

  useEffect(() => {
    if (active) treeRef.current?.querySelector(`[data-id="${CSS.escape(active)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  useEffect(() => {
    if (focusId) treeRef.current?.querySelector(`[data-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusId]);

  const go = (n) => {
    if (n.pos < 0) { if (n.children.length) toggle(n.id); return; }
    setPicked({ id: n.id, pos: n.pos });
    onGo(n.pos);
  };

  if (!nodes) return <div className="flex-1" aria-busy="true" />;

  if (!nodes.length) {
    const many = docKey.includes(',');
    return (
      <div role="status" className="flex flex-1 flex-col items-center px-4 pt-10 text-center">
        <span className="mb-3 grid size-10 place-items-center rounded-xl bg-hover text-muted" aria-hidden="true">
          <ListTree size={18} strokeWidth={1.75} />
        </span>
        <p className="text-sm font-medium">{many ? 'Estos PDFs no tienen índice' : 'Este PDF no tiene índice'}</p>
        <p className="mt-1 text-xs text-muted">Usa la pestaña Páginas para moverte por el documento.</p>
      </div>
    );
  }

  const onKeyDown = (e) => {
    const i = visible.findIndex((v) => v.node.id === focused);
    const cur = visible[i];
    if (!cur) return;
    const n = cur.node;
    const parentOf = () => {
      for (let k = i - 1; k >= 0; k--) if (visible[k].depth < cur.depth) return visible[k].node.id;
      return null;
    };
    let next = null;
    switch (e.key) {
      case 'ArrowDown': next = visible[Math.min(visible.length - 1, i + 1)].node.id; break;
      case 'ArrowUp': next = visible[Math.max(0, i - 1)].node.id; break;
      case 'Home': next = visible[0].node.id; break;
      case 'End': next = visible[visible.length - 1].node.id; break;
      case 'ArrowRight':
        if (n.children.length && !expanded.has(n.id)) toggle(n.id);
        else if (n.children.length) next = n.children[0].id;
        break;
      case 'ArrowLeft':
        if (n.children.length && expanded.has(n.id)) toggle(n.id);
        else next = parentOf();
        break;
      case 'Enter':
      case ' ':
        go(n);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next) setFocusId(next);
  };

  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label="Marcadores"
      tabIndex={0}
      aria-activedescendant={focused ? rowId(focused) : undefined}
      onKeyDown={onKeyDown}
      className="desk-scroll group/tree flex-1 overflow-y-auto p-1.5 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
    >
      {visible.map(({ node: n, depth }) => {
        const isActive = n.id === active;
        const off = n.pos < 0;
        const open = expanded.has(n.id);
        const why = n.missing ? 'Su página se eliminó' : off && !n.group ? 'No lleva a ninguna página de este documento' : n.title;
        return (
          <div
            key={n.id}
            id={rowId(n.id)}
            data-id={n.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={n.children.length ? open : undefined}
            aria-selected={isActive}
            aria-disabled={off && !n.children.length ? true : undefined}
            title={why}
            onClick={() => { setFocusId(n.id); go(n); }}
            style={{ paddingLeft: 4 + depth * 14 }}
            className={[
              'flex min-h-8 items-center gap-1 rounded-lg py-1 pr-2 text-sm transition-colors',
              n.id === focused ? 'group-focus-visible/tree:outline group-focus-visible/tree:outline-2 group-focus-visible/tree:-outline-offset-2 group-focus-visible/tree:outline-accent' : '',
              isActive ? 'bg-accent-soft font-medium text-accent-ink' : off ? '' : 'hover:bg-hover',
              off ? 'cursor-default text-muted' : 'cursor-pointer',
              n.missing ? 'opacity-60' : '',
            ].join(' ')}
          >
            {n.children.length ? (
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={(e) => { e.stopPropagation(); setFocusId(n.id); toggle(n.id); }}
                className="grid size-5 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink"
              >
                <ChevronRight size={14} strokeWidth={1.75} className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
              </button>
            ) : <span className="size-5 shrink-0" aria-hidden="true" />}
            {n.group && <FileText size={14} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden="true" />}
            <span className={`min-w-0 flex-1 truncate ${n.group ? 'font-semibold' : ''} ${n.missing ? 'line-through decoration-1' : ''}`}>{n.title}</span>
            {n.pos >= 0 && <span className={`tabnum shrink-0 text-xs ${isActive ? 'text-accent' : 'text-muted'}`}>{n.pos + 1}</span>}
          </div>
        );
      })}
    </div>
  );
}

const rowId = (id) => `bm-${id.replace(/\//g, '-')}`;
