import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import PageImage, { displaySize } from './PageImage.jsx';
import { AnnotPreview } from './AnnotShapes.jsx';
import OutlinePanel from './OutlinePanel.jsx';
import { useT } from '../i18n/index.js';

const STORE = 'spiderpdf:panel';
const MIN_W = 160;
const MAX_W = 320;
const DEFAULT_W = 200;
const DRAG_TYPE = 'application/x-pdf-pages'; // el mismo tipo que en Organizar
const clampW = (w) => Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    return { width: clampW(Number(p.width) || DEFAULT_W), collapsed: !!p.collapsed, tab: p.tab === 'outline' ? 'outline' : 'pages' };
  } catch {
    return { width: DEFAULT_W, collapsed: false, tab: 'pages' };
  }
}

/** Qué marcar en la fila: redacciones pendientes y cualquier otro cambio sobre la página. */
function marks(page) {
  const redact = page.annots.some((a) => a.type === 'redact');
  const other = page.annots.some((a) => a.type !== 'redact')
    || Object.keys(page.textEdits ?? {}).length > 0 || Object.keys(page.fields ?? {}).length > 0 || page.ocr?.length > 0;
  return { redact, other };
}

/**
 * Panel lateral de Leer: pestañas «Páginas» y «Marcadores», plegable y redimensionable
 * (recuerda ancho y plegado). Las miniaturas se pueden arrastrar para reordenar y, con el foco
 * en la lista, las flechas cambian de página.
 */
export default function PageSidebar({ pages, current, onGo, onMove, outlineProps }) {
  const t = useT();
  const [prefs, setPrefs] = useState(loadPrefs);
  const listRef = useRef(null);
  const dragKey = useRef(null);
  const [dropAt, setDropAt] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch { /* sin almacenamiento: no se recuerda */ }
  }, [prefs]);

  // Mantener visible la fila de la página actual.
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current, prefs.collapsed, prefs.tab]);

  if (prefs.collapsed) {
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center gap-2 border-r border-line bg-panel py-2">
        <button
          type="button"
          title={t('reader.sidebar.show')}
          aria-label={t('reader.sidebar.show')}
          onClick={() => setPrefs((p) => ({ ...p, collapsed: false }))}
          className="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover"
        >
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        </button>
        <span className="tabnum text-xs font-semibold text-accent" aria-label={t('reader.sidebar.pageN', { n: current + 1 })}>{current + 1}</span>
      </aside>
    );
  }

  const thumbW = prefs.width - 44; // márgenes de la lista y de la fila, y la barra de scroll

  const onKeyDown = (e) => {
    const go = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: pages.length - 1 }[e.key];
    if (go === undefined) return;
    e.preventDefault();
    onGo(Math.min(pages.length - 1, Math.max(0, go)));
  };

  // --- Arrastrar para reordenar (la página arrastrada; en Leer no hay selección múltiple) ---
  const isInternal = (e) => e.dataTransfer.types.includes(DRAG_TYPE);
  const onRowDragOver = (e, i) => {
    if (!isInternal(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
    e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (e) => {
    if (!isInternal(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (onMove && dragKey.current && dropAt !== null) onMove(dragKey.current, dropAt);
    dragKey.current = null;
    setDropAt(null);
  };

  // --- Redimensionar arrastrando el borde (o con flechas sobre el borde) ---
  const startResize = (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = prefs.width;
    const move = (ev) => setPrefs((p) => ({ ...p, width: clampW(w0 + ev.clientX - x0) }));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <aside className="relative flex shrink-0 flex-col border-r border-line bg-panel" style={{ width: prefs.width }}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-1.5">
        <div
          role="tablist"
          aria-label={t('reader.sidebar.label')}
          className="flex min-w-0 flex-1 rounded-lg bg-hover p-0.5"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const tab = prefs.tab === 'pages' ? 'outline' : 'pages';
            setPrefs((p) => ({ ...p, tab }));
            e.currentTarget.querySelector(`[data-tab="${tab}"]`)?.focus();
          }}
        >
          {[['pages', t('reader.sidebar.pagesTab')], ['outline', t('reader.sidebar.outlineTab')]].map(([id, label]) => {
            const on = prefs.tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                data-tab={id}
                aria-selected={on}
                aria-controls={`panel-${id}`}
                tabIndex={on ? 0 : -1}
                title={label}
                onClick={() => setPrefs((p) => ({ ...p, tab: id }))}
                className={`h-7 min-w-0 flex-auto truncate rounded-md px-1.5 text-xs font-medium transition-colors ${on ? 'bg-panel text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          title={t('reader.sidebar.collapse')}
          aria-label={t('reader.sidebar.collapse')}
          onClick={() => setPrefs((p) => ({ ...p, collapsed: true }))}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <PanelLeftClose size={16} strokeWidth={1.75} />
        </button>
      </div>

      {prefs.tab === 'outline' ? (
        <div id="panel-outline" role="tabpanel" aria-labelledby="tab-outline" className="flex min-h-0 flex-1 flex-col">
          <OutlinePanel pages={pages} current={current} onGo={onGo} {...outlineProps} />
        </div>
      ) : (
      <div
        ref={listRef}
        id="panel-pages"
        aria-labelledby="tab-pages"
        role="listbox"
        aria-label={t('reader.sidebar.pagesTab')}
        aria-activedescendant={pages[current] ? `thumb-${pages[current].key}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDragOver={(e) => { if (isInternal(e)) { e.preventDefault(); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropAt(null); }}
        onDrop={onDrop}
        className="desk-scroll flex-1 overflow-y-auto p-2 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
      >
        {pages.map((page, i) => {
          const active = i === current;
          const m = marks(page);
          const { w, h } = displaySize(page);
          const cssWidth = Math.round(Math.min(thumbW, (thumbW * 1.42 * w) / h)); // apaisadas: a lo ancho
          return (
            <div
              key={page.key}
              id={`thumb-${page.key}`}
              data-row={i}
              role="option"
              aria-selected={active}
              aria-label={`${t('reader.sidebar.pageN', { n: i + 1 })}${m.redact ? t('reader.sidebar.withRedactions') : ''}${m.other ? t('reader.sidebar.withChanges') : ''}`}
              draggable={!!onMove}
              onDragStart={(e) => { dragKey.current = page.key; e.dataTransfer.setData(DRAG_TYPE, '1'); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => { dragKey.current = null; setDropAt(null); }}
              onDragOver={(e) => onRowDragOver(e, i)}
              onClick={() => onGo(i)}
              className={`group relative mb-1 flex cursor-pointer flex-col items-center gap-1.5 rounded-lg px-2 pb-1.5 pt-2.5 transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-hover'}`}
            >
              {dropAt === i && <span className="absolute -top-[3px] left-2 right-2 h-[3px] rounded-full bg-accent" aria-hidden="true" />}
              {dropAt === i + 1 && i === pages.length - 1 && <span className="absolute -bottom-[3px] left-2 right-2 h-[3px] rounded-full bg-accent" aria-hidden="true" />}

              <span className="relative">
                <PageImage page={page} cssWidth={cssWidth} rootRef={listRef} />
                <AnnotPreview page={page} cssWidth={cssWidth} />
              </span>

              <span className="flex items-center gap-1.5">
                <span className={`tabnum text-xs ${active ? 'font-semibold text-accent' : 'text-muted'}`}>{i + 1}</span>
                {m.redact && <span className="size-1.5 rounded-full bg-danger" title={t('reader.sidebar.dotRedact')} aria-hidden="true" />}
                {m.other && <span className="size-1.5 rounded-full bg-accent" title={t('reader.sidebar.dotChanges')} aria-hidden="true" />}
              </span>
            </div>
          );
        })}
      </div>
      )}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('reader.sidebar.width')}
        aria-valuemin={MIN_W}
        aria-valuemax={MAX_W}
        aria-valuenow={prefs.width}
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={() => setPrefs((p) => ({ ...p, width: DEFAULT_W }))}
        onKeyDown={(e) => {
          const d = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
          if (d) { e.preventDefault(); setPrefs((p) => ({ ...p, width: clampW(p.width + d) })); }
        }}
        title={t('reader.sidebar.resizeHint')}
        className="absolute -right-[3px] top-0 z-10 h-full w-1.5 cursor-col-resize outline-none transition-colors hover:bg-accent/30 focus-visible:bg-accent/40"
      />
    </aside>
  );
}
