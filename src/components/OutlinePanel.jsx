import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText, ListTree, Pencil, Wand2 } from 'lucide-react';
import { pdf } from '../engine/client.js';
import { mapOutline, mapCustomOutline, activeId, visibleNodes } from '../outline.js';
import { textLines, findTocPages } from '../toc.js';
import { useT } from '../i18n/index.js';

const TOC_SCAN = 15; // un índice impreso está al principio: se miran las primeras páginas

/**
 * Pestaña «Marcadores» del panel de Leer: el índice de los PDF abiertos como árbol plegable.
 * Cada marcador lleva a la posición ACTUAL de su página (tras reordenar o eliminar); si su página
 * se eliminó, sale en gris y desactivado. Con varios PDFs unidos, un grupo por archivo.
 * Teclado (patrón «tree» de ARIA): flechas, Inicio/Fin, Intro o Espacio para ir.
 * custom: índice creado en la app (state.outline), que sustituye al de los PDF. Sin índice, se busca una
 * página de índice impreso entre las primeras y se ofrece crearlo (onCreateToc(posiciones), onEditToc()).
 */
export default function OutlinePanel({ pages, current, onGo, custom = null, onCreateToc, onEditToc, canEdit = true, editWhy }) {
  const t = useT();
  const docKey = [...new Set(pages.map((p) => p.docId))].filter((d) => d != null).join(',');
  const [trees, setTrees] = useState(null);
  useEffect(() => {
    let alive = true;
    const ids = docKey.split(',').filter(Boolean).map(Number);
    Promise.all(ids.map((d) => pdf.bookmarks(d).catch(() => []).then((tree) => [d, tree])))
      .then((list) => { if (alive) setTrees(new Map(list)); });
    return () => { alive = false; };
  }, [docKey]);

  const names = useMemo(() => new Map(pages.map((p) => [p.docId, p.source])), [pages]);
  const nodes = useMemo(
    () => (custom ? mapCustomOutline(pages, custom) : trees ? mapOutline(pages, trees, names) : null),
    [pages, trees, names, custom],
  );

  // Sin índice: ¿alguna de las primeras páginas es un índice impreso? → posiciones (vacío = ninguna).
  const empty = !!nodes && !nodes.length;
  const scanKey = empty ? pages.slice(0, TOC_SCAN).map((p) => p.key).join(',') : '';
  const [tocPages, setTocPages] = useState(null);
  useEffect(() => {
    if (!scanKey) return undefined;
    let alive = true;
    setTocPages(null);
    const first = pages.slice(0, TOC_SCAN);
    Promise.all(first.map((p) => pdf.pageChars(p).then(textLines).catch(() => null)))
      .then((lines) => { if (alive) setTocPages(findTocPages(lines)); });
    return () => { alive = false; };
  }, [scanKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Plegado: los grupos de archivo empiezan abiertos; los marcadores con hijos, cerrados.
  const [toggled, setToggled] = useState(() => new Set());
  const isOpen = (n) => (n.group ? !toggled.has(n.id) : toggled.has(n.id));
  const expanded = useMemo(() => {
    const out = new Set();
    const walk = (list) => list?.forEach((n) => { if (isOpen(n)) out.add(n.id); walk(n.children); });
    walk(nodes);
    return out;
  }, [nodes, toggled]);
  const toggle = (id) => setToggled((s) => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });

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
    const found = tocPages?.length ? tocPages : null;
    const off = !canEdit || !onCreateToc;
    return (
      <div className="flex flex-1 flex-col items-center px-4 pt-10 text-center">
        <span className="mb-3 grid size-10 place-items-center rounded-xl bg-hover text-muted" aria-hidden="true">
          <ListTree size={18} strokeWidth={1.75} />
        </span>
        <p role="status" className="text-sm font-medium">{many ? t('reader.outline.noneMany') : t('reader.outline.noneOne')}</p>
        {found ? (
          <>
            <p className="mt-1 text-xs text-muted">
              {found.length > 1 ? t('reader.outline.foundRange', { from: found[0] + 1, to: found.at(-1) + 1 }) : t('reader.outline.foundOne', { n: found[0] + 1 })}
            </p>
            <button
              type="button"
              onClick={() => !off && onCreateToc(found)}
              aria-disabled={off || undefined}
              title={off ? editWhy : undefined}
              className={`mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverse px-3 text-sm font-medium text-on-inverse transition hover:bg-inverse-hover active:scale-[0.98] ${off ? 'pointer-events-none opacity-50' : ''}`}
            >
              <Wand2 size={16} strokeWidth={1.75} aria-hidden="true" />
              {t('reader.outline.createFrom', { n: found[0] + 1 })}
            </button>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted">{tocPages ? t('reader.outline.usePagesTab') : t('reader.outline.searching')}</p>
        )}
        {tocPages && (
          <button
            type="button"
            onClick={() => !off && onCreateToc([])}
            aria-disabled={off || undefined}
            title={off ? editWhy : undefined}
            className={`mt-2 h-8 rounded-lg px-2 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink ${off ? 'pointer-events-none opacity-50' : ''}`}
          >
            {found ? t('reader.outline.useOther') : t('reader.outline.createFromPage')}
          </button>
        )}
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
    <>
    <div
      ref={treeRef}
      role="tree"
      aria-label={t('reader.sidebar.outlineTab')}
      tabIndex={0}
      aria-activedescendant={focused ? rowId(focused) : undefined}
      onKeyDown={onKeyDown}
      className="desk-scroll group/tree flex-1 overflow-y-auto p-1.5 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
    >
      {visible.map(({ node: n, depth }) => {
        const isActive = n.id === active;
        const off = n.pos < 0;
        const open = expanded.has(n.id);
        const why = n.missing ? t('reader.outline.pageDeleted') : off && !n.group ? t('reader.outline.noPage') : n.title;
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
    {custom && (
      <div className="flex shrink-0 items-center gap-1 border-t border-line px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{t('reader.outline.customFooter')}</span>
        <button
          type="button"
          onClick={() => canEdit && onEditToc?.()}
          aria-disabled={!canEdit || undefined}
          aria-label={t('reader.outline.editToc')}
          title={canEdit ? t('reader.outline.editToc') : editWhy}
          className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-hover ${canEdit ? '' : 'pointer-events-none opacity-50'}`}
        >
          <Pencil size={14} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
          {t('reader.outline.edit')}
        </button>
      </div>
    )}
    </>
  );
}

const rowId = (id) => `bm-${id.replace(/\//g, '-')}`;
