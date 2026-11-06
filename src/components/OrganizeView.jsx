import { useRef, useState } from 'react';
import { RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import PageImage, { displaySize } from './PageImage.jsx';
import { AnnotPreview } from './AnnotShapes.jsx';

const DRAG_TYPE = 'application/x-pdf-pages';
const CELL_W = 168;
const CELL_H = 224;

const isInternal = (e) => e.dataTransfer.types.includes(DRAG_TYPE);

function fitWidth(page) {
  const { w, h } = displaySize(page);
  return Math.round(Math.min(CELL_W, (CELL_H * w) / h));
}

function dragLabel(count) {
  const el = document.createElement('div');
  el.textContent = `${count} páginas`;
  Object.assign(el.style, {
    position: 'fixed', top: '-100px', padding: '6px 10px', borderRadius: '8px',
    background: 'var(--accent)', color: 'var(--on-accent)', font: '500 13px var(--font-sans)',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 0);
  return el;
}

/** canPages: false en un PDF certificado (no se pueden mover, girar, quitar ni añadir páginas). */
export default function OrganizeView({ state, dispatch, onDropFiles, onOpenPage, canPages = true }) {
  const scrollRef = useRef(null);
  const [dropAt, setDropAt] = useState(null);
  const multiSource = new Set(state.pages.map((p) => p.docId)).size > 1;

  const select = (e, key) => {
    const how = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single';
    dispatch({ type: 'select', key, how });
  };

  const onDragStart = (e, page) => {
    let count = state.selected.size;
    if (!state.selected.has(page.key)) {
      dispatch({ type: 'select', key: page.key, how: 'single' });
      count = 1;
    }
    e.dataTransfer.setData(DRAG_TYPE, '1');
    e.dataTransfer.effectAllowed = 'move';
    if (count > 1) e.dataTransfer.setDragImage(dragLabel(count), 0, 0);
  };

  const onItemDragOver = (e, i) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
    e.dataTransfer.dropEffect = isInternal(e) ? 'move' : 'copy';
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canPages) { // App comprueba el permiso y explica por qué no se añaden
      setDropAt(null);
      if (!isInternal(e)) onDropFiles(e.dataTransfer.files);
      return;
    }
    const at = dropAt ?? state.pages.length;
    setDropAt(null);
    if (isInternal(e)) dispatch({ type: 'move', keys: state.selected, to: at });
    else onDropFiles(e.dataTransfer.files, at);
  };

  const pageAction = (e, type, key, delta) => {
    e.stopPropagation();
    dispatch({ type, keys: new Set([key]), delta });
  };

  return (
    <div
      ref={scrollRef}
      className="desk-scroll h-full overflow-auto bg-desk"
      onClick={(e) => e.target === e.currentTarget && dispatch({ type: 'clearSelection' })}
      onDragOver={(e) => { e.preventDefault(); if (!isInternal(e) && canPages) setDropAt(state.pages.length); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropAt(null); }}
      onDrop={onDrop}
    >
      <ul
        className="flex flex-wrap content-start gap-x-9 gap-y-8 px-10 py-9"
        onClick={(e) => e.target === e.currentTarget && dispatch({ type: 'clearSelection' })}
      >
        {state.pages.map((page, i) => {
          const selected = state.selected.has(page.key);
          const last = i === state.pages.length - 1;
          return (
            <li
              key={page.key}
              className="group relative flex flex-col items-center"
              style={{ width: CELL_W }}
              draggable={canPages}
              onDragStart={(e) => onDragStart(e, page)}
              onDragEnd={() => setDropAt(null)}
              onDragOver={(e) => (canPages ? onItemDragOver(e, i) : e.preventDefault())}
              onClick={(e) => select(e, page.key)}
              onDoubleClick={() => onOpenPage(i)}
              aria-selected={selected}
            >
              {dropAt === i && <span className="absolute -left-[20px] top-0 h-[224px] w-1 rounded-full bg-accent" />}
              {dropAt === i + 1 && last && <span className="absolute -right-[20px] top-0 h-[224px] w-1 rounded-full bg-accent" />}

              <div className="flex items-end justify-center" style={{ width: CELL_W, height: CELL_H }}>
                <div
                  className={`relative rounded-[2px] outline-offset-[5px] ${selected ? 'outline-2 outline-accent' : ''}`}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onOpenPage(i)}
                >
                  <PageImage page={page} cssWidth={fitWidth(page)} rootRef={scrollRef} />
                  <AnnotPreview page={page} cssWidth={fitWidth(page)} />
                  <div className={`absolute inset-x-0 bottom-2 flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${canPages ? '' : 'hidden'}`}>
                    <ThumbButton label={`Girar la página ${i + 1} a la izquierda`} onClick={(e) => pageAction(e, 'rotate', page.key, -1)}><RotateCcw size={15} strokeWidth={1.75} /></ThumbButton>
                    <ThumbButton label={`Girar la página ${i + 1} a la derecha`} onClick={(e) => pageAction(e, 'rotate', page.key, 1)}><RotateCw size={15} strokeWidth={1.75} /></ThumbButton>
                    <ThumbButton label={`Eliminar la página ${i + 1}`} onClick={(e) => pageAction(e, 'delete', page.key)}><Trash2 size={15} strokeWidth={1.75} /></ThumbButton>
                  </div>
                </div>
              </div>

              <span className={`tabnum mt-3 min-w-7 rounded-full px-2 text-center text-sm leading-6 ${selected ? 'bg-accent font-semibold text-on-accent' : 'font-medium text-ink'}`}>
                {i + 1}
              </span>
              {multiSource && (
                <span className="mt-0.5 max-w-full truncate text-[12px] text-muted-desk" title={page.source}>
                  {page.docId == null ? page.source : `${page.source}, p. ${page.index + 1}`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ThumbButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      className="grid size-7 place-items-center rounded-md bg-overlay/85 text-white shadow-card transition-[background-color,scale] hover:bg-overlay active:scale-[0.95]"
    >
      {children}
    </button>
  );
}
