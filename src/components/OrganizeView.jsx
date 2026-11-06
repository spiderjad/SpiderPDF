import { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw, Trash2, Check, Plus, CheckCheck, X, Rows3, Grid2x2, Grid3x3 } from 'lucide-react';
import PageImage, { displaySize } from './PageImage.jsx';
import { AnnotPreview } from './AnnotShapes.jsx';
import { useT } from '../i18n/index.js';
import './OrganizeView.css';

const DRAG_TYPE = 'application/x-pdf-pages';
const isInternal = (e) => e.dataTransfer.types.includes(DRAG_TYPE);

/** Tamaños de miniatura (ancho × alto de la celda en px). Se recuerda en localStorage «spiderpdf:organizar». */
const SIZES = { s: [120, 160], m: [168, 224], l: [232, 310] };
const STORE = 'spiderpdf:organizar';
const loadSize = () => { try { const s = JSON.parse(localStorage.getItem(STORE) ?? '{}').size; return SIZES[s] ? s : 'm'; } catch { return 'm'; } };
const saveSize = (size) => { try { localStorage.setItem(STORE, JSON.stringify({ size })); } catch { /* sin almacenamiento */ } };

/** Color de cada PDF de origen cuando hay varios (tokens de spider-ui). */
const SOURCE_COLORS = ['var(--sp-primary)', 'var(--sp-accent)', 'var(--sp-success)', 'var(--sp-danger)', 'var(--sp-warning)', 'var(--sp-text-secondary)'];

function dragLabel(text) {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed', top: '-100px', padding: '6px 10px', borderRadius: '6px',
    background: 'var(--sp-inverse)', color: 'var(--sp-on-inverse)', font: '500 13px var(--sp-font)',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 0);
  return el;
}

/**
 * Organizar: las páginas como fichas (spider-ui). Clic selecciona (Mayús = intervalo, Ctrl = añadir); la casilla de
 * cada ficha añade o quita sin perder la selección; doble clic o Intro la abre en Leer; arrastrar reordena (también
 * PDF desde el Explorador). Teclado: flechas e Inicio/Fin entre fichas, Espacio marca. Barra superior: resumen,
 * seleccionar todo / quitar selección y tamaño de las miniaturas.
 * canPages: false en un PDF certificado (no se pueden mover, girar, quitar ni añadir páginas).
 */
export default function OrganizeView({ state, dispatch, onDropFiles, onOpenPage, onAdd, canPages = true }) {
  const t = useT();
  const scrollRef = useRef(null);
  const listRef = useRef(null);
  const [dropAt, setDropAt] = useState(null);
  const [size, setSize] = useState(loadSize);
  useEffect(() => saveSize(size), [size]);
  const [CELL_W, CELL_H] = SIZES[size];

  const docOrder = [...new Set(state.pages.map((p) => p.docId))];
  const multiSource = docOrder.length > 1;
  const total = state.pages.length;
  const nSel = state.selected.size;

  const fitWidth = (page) => {
    const { w, h } = displaySize(page);
    return Math.round(Math.min(CELL_W, (CELL_H * w) / h));
  };

  const select = (e, key) => {
    const how = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single';
    dispatch({ type: 'select', key, how });
  };

  const onDragStart = (e, page) => {
    let count = nSel;
    if (!state.selected.has(page.key)) {
      dispatch({ type: 'select', key: page.key, how: 'single' });
      count = 1;
    }
    e.dataTransfer.setData(DRAG_TYPE, '1');
    e.dataTransfer.effectAllowed = 'move';
    if (count > 1) e.dataTransfer.setDragImage(dragLabel(t('core.organize.dragCount', { count })), 0, 0);
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
    const at = dropAt ?? total;
    setDropAt(null);
    if (isInternal(e)) dispatch({ type: 'move', keys: state.selected, to: at });
    else onDropFiles(e.dataTransfer.files, at);
  };

  const pageAction = (e, type, key, delta) => {
    e.stopPropagation();
    dispatch({ type, keys: new Set([key]), delta });
  };

  // Teclado entre fichas: flechas (arriba y abajo, una fila), Inicio/Fin, Espacio marca, Intro abre.
  const onTileKey = (e, i, page) => {
    const tiles = [...(listRef.current?.querySelectorAll('[data-tile]') ?? [])];
    const perRow = Math.max(1, tiles.filter((el) => el.offsetTop === tiles[0]?.offsetTop).length);
    const go = (j) => { e.preventDefault(); tiles[Math.max(0, Math.min(tiles.length - 1, j))]?.focus(); };
    switch (e.key) {
      case 'ArrowRight': go(i + 1); break;
      case 'ArrowLeft': go(i - 1); break;
      case 'ArrowDown': go(i + perRow); break;
      case 'ArrowUp': go(i - perRow); break;
      case 'Home': go(0); break;
      case 'End': go(tiles.length - 1); break;
      case ' ': e.preventDefault(); dispatch({ type: 'select', key: page.key, how: e.shiftKey ? 'range' : 'toggle' }); break;
      case 'Enter': e.preventDefault(); onOpenPage(i); break;
      default:
    }
  };

  return (
    <div className="og-root">
      <div className="v-toolbar v-toolbar--sub og-bar">
        <p className="og-summary" role="status">
          {nSel > 0
            ? t('core.organize.selected', { count: nSel, total })
            : multiSource ? t('core.organize.summaryDocs', { count: total, docs: docOrder.length }) : t('core.organize.summary', { count: total })}
        </p>
        {nSel > 0 ? (
          <button type="button" className="v-btn-ghost v-btn--sm" onClick={() => dispatch({ type: 'clearSelection' })}>
            <X size={14} strokeWidth={1.75} aria-hidden="true" />{t('core.organize.clearSelection')}
          </button>
        ) : null}
        {nSel < total && (
          <button type="button" className="v-btn-ghost v-btn--sm" onClick={() => dispatch({ type: 'selectAll' })}>
            <CheckCheck size={14} strokeWidth={1.75} aria-hidden="true" />{t('core.organize.selectAll')}
          </button>
        )}
        <span className="v-toolbar__spacer" />
        <span className="og-size-label" id="og-size">{t('core.organize.thumbSize')}</span>
        <div className="v-segmented" role="group" aria-labelledby="og-size">
          {[['s', Grid3x3, 'core.organize.sizeSmall'], ['m', Grid2x2, 'core.organize.sizeMedium'], ['l', Rows3, 'core.organize.sizeLarge']].map(([id, I, key]) => (
            <button key={id} type="button" aria-pressed={size === id} aria-label={t(key)} title={t(key)} onClick={() => setSize(id)} className="v-segmented__item og-size">
              <I size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="desk-scroll og-scroll"
        onClick={(e) => e.target === e.currentTarget && dispatch({ type: 'clearSelection' })}
        onDragOver={(e) => { e.preventDefault(); if (!isInternal(e) && canPages) setDropAt(total); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropAt(null); }}
        onDrop={onDrop}
      >
        <div className="og-grid" style={{ '--og-cell-w': `${CELL_W}px`, '--og-cell-h': `${CELL_H}px` }} onClick={(e) => e.target === e.currentTarget && dispatch({ type: 'clearSelection' })}>
          <ul ref={listRef} role="list" aria-label={t('core.organize.pages')} className="og-list">
            {state.pages.map((page, i) => {
              const selected = state.selected.has(page.key);
              const last = i === total - 1;
              const color = SOURCE_COLORS[docOrder.indexOf(page.docId) % SOURCE_COLORS.length];
              const w = fitWidth(page);
              return (
                <li
                  key={page.key}
                  role="listitem"
                  className="og-tile"
                  data-selected={selected || undefined}
                  draggable={canPages}
                  onDragStart={(e) => onDragStart(e, page)}
                  onDragEnd={() => setDropAt(null)}
                  onDragOver={(e) => (canPages ? onItemDragOver(e, i) : e.preventDefault())}
                  onClick={(e) => select(e, page.key)}
                  onDoubleClick={() => onOpenPage(i)}
                >
                  {dropAt === i && <span className="og-insert og-insert--before" aria-hidden="true" />}
                  {dropAt === i + 1 && last && <span className="og-insert og-insert--after" aria-hidden="true" />}

                  <div className="og-cell">
                    <div
                      className="og-page"
                      data-tile
                      tabIndex={0}
                      aria-label={t('core.organize.pageN', { n: i + 1 })}
                      onKeyDown={(e) => onTileKey(e, i, page)}
                    >
                      <PageImage page={page} cssWidth={w} rootRef={scrollRef} />
                      <AnnotPreview page={page} cssWidth={w} />
                      <div className={`og-actions ${canPages ? '' : 'og-hidden'}`}>
                        <ThumbButton label={t('core.organize.rotateLeft', { n: i + 1 })} onClick={(e) => pageAction(e, 'rotate', page.key, -1)}><RotateCcw size={15} strokeWidth={1.75} /></ThumbButton>
                        <ThumbButton label={t('core.organize.rotateRight', { n: i + 1 })} onClick={(e) => pageAction(e, 'rotate', page.key, 1)}><RotateCw size={15} strokeWidth={1.75} /></ThumbButton>
                        <ThumbButton label={t('core.organize.delete', { n: i + 1 })} onClick={(e) => pageAction(e, 'delete', page.key)}><Trash2 size={15} strokeWidth={1.75} /></ThumbButton>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={t('core.organize.check', { n: i + 1 })}
                    title={t('core.organize.check', { n: i + 1 })}
                    tabIndex={-1}
                    className="og-check"
                    onClick={(e) => { e.stopPropagation(); dispatch({ type: 'select', key: page.key, how: e.shiftKey ? 'range' : 'toggle' }); }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {selected && <Check size={12} strokeWidth={2.5} aria-hidden="true" />}
                  </button>

                  <span className="og-num tabnum">{i + 1}</span>
                  {multiSource && (
                    <span className="og-source" title={page.source}>
                      <span className="og-dot" style={{ background: color }} aria-hidden="true" />
                      {page.docId == null ? page.source : t('core.organize.source', { name: page.source, n: page.index + 1 })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {canPages && (
            <button type="button" className="og-add" onClick={onAdd} title={t('core.toolbar.addTitle')}>
              <span className="og-add-icon" aria-hidden="true"><Plus size={20} strokeWidth={1.75} /></span>
              <span className="og-add-title">{t('core.organize.addTitle')}</span>
              <span className="og-add-hint">{t('core.organize.addHint')}</span>
            </button>
          )}
        </div>
      </div>
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
      className="og-thumb-btn"
    >
      {children}
    </button>
  );
}
