import { useEffect, useRef, useState } from 'react';
import { Plus, X, RotateCw, Download } from 'lucide-react';
import { useT } from '../i18n/index.js';
import { formatAccel } from '../menu.js';
import './TabBar.css';

/** Distancia (px) por encima o por debajo de la barra a partir de la cual soltar una pestaña la abre en otra ventana. */
const DETACH_DISTANCE = 40;

/**
 * Barra de pestañas: un documento por pestaña. Clic (o pulsar) activa; la × o el botón central del ratón cierran;
 * arrastrar en horizontal cambia el orden; arrastrarla fuera de la barra (arriba o abajo) y soltar la abre en otra
 * ventana (onDetach). Teclado: flechas, Inicio y Fin cambian de pestaña; Supr cierra la que tiene el foco.
 * Soltar PDFs sobre la barra los abre, cada uno en su pestaña.
 * A la derecha, si hay una versión nueva: su descarga y luego el botón «Reiniciar para actualizar» (onInstall).
 *   tabs: [{ id, title, tip, dirty }]; update: estado de electron/updater.cjs (o null)
 */
export default function TabBar({ tabs, active, busy, canDetach, update, onActivate, onClose, onNew, onMove, onDetach, onDropFiles, onInstall }) {
  const t = useT();
  const listRef = useRef(null);
  const drag = useRef(null); // { id, pointerId, x0, y0, started, out }
  const [ghost, setGhost] = useState(null); // { id, x, y }: pestaña arrastrada fuera de la barra
  const [fileOver, setFileOver] = useState(false);

  // La pestaña activa siempre a la vista (si hay más de las que caben, la lista se desplaza).
  useEffect(() => {
    listRef.current?.querySelector(`[data-tab-id="${active}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);

  const endDrag = () => { drag.current = null; setGhost(null); };

  function onPointerDown(e, id) {
    if (e.button === 1) { e.preventDefault(); return; } // botón central: se cierra al soltar (auxclick)
    if (e.button !== 0 || e.target.closest('.pt-close')) return;
    if (busy) return;
    onActivate(id);
    drag.current = { id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, out: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.started && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
    d.started = true;
    const box = listRef.current.getBoundingClientRect();
    const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight;
    d.out = canDetach && tabs.length > 1 && (outside || e.clientY < box.top - DETACH_DISTANCE || e.clientY > box.bottom + DETACH_DISTANCE);
    if (d.out) { setGhost({ id: d.id, x: e.clientX, y: e.clientY }); return; }
    setGhost(null);
    // Dentro de la barra: el orden sigue al puntero (la pestaña pasa a la posición de la que tiene debajo).
    const els = [...listRef.current.querySelectorAll('[data-tab-id]')];
    const to = els.findIndex((el) => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right; });
    const from = els.findIndex((el) => el.dataset.tabId === d.id);
    if (to >= 0 && to !== from) onMove(d.id, to);
  }

  function onPointerUp(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    endDrag();
    if (d.started && d.out) onDetach(d.id, { x: e.screenX, y: e.screenY });
  }

  function onListKey(e) {
    const ids = tabs.map((x) => x.id);
    const i = ids.indexOf(document.activeElement?.closest('[data-tab-id]')?.dataset.tabId ?? active);
    let next = null;
    if (e.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft') next = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids.at(-1);
    else if (e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); onClose(ids[i]); return; }
    else if (e.key === 'Escape' && drag.current) { e.stopPropagation(); endDrag(); return; }
    if (!next) return;
    e.preventDefault();
    e.stopPropagation(); // que no lleguen a los atajos globales (p. ej. Supr = eliminar páginas)
    if (!busy) onActivate(next);
    listRef.current.querySelector(`[data-tab-id="${next}"] [role="tab"]`)?.focus();
  }

  const isFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const dragged = ghost && tabs.find((x) => x.id === ghost.id);

  return (
    <div
      className="pt-bar"
      data-drop={fileOver || undefined}
      onDragOver={(e) => { if (!isFiles(e)) return; e.preventDefault(); setFileOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFileOver(false); }}
      onDrop={(e) => { if (!isFiles(e)) return; e.preventDefault(); setFileOver(false); onDropFiles(e.dataTransfer.files); }}
    >
      <div ref={listRef} role="tablist" aria-label={t('core.tabs.list')} className="pt-list" onKeyDown={onListKey}>
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              data-active={isActive || undefined}
              data-out={(ghost?.id === tab.id) || undefined}
              className="pt-tab"
              title={tab.tip}
              onPointerDown={(e) => onPointerDown(e, tab.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={endDrag}
              onLostPointerCapture={() => { if (drag.current && !drag.current.started) drag.current = null; }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(tab.id); } }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={tab.dirty ? t('core.tabs.labelDirty', { name: tab.title }) : tab.title}
                tabIndex={isActive ? 0 : -1}
                className="pt-main"
              >
                {tab.dirty && <span className="pt-dot" aria-hidden="true" />}
                <span className="pt-title">{tab.title}</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                className="pt-close"
                aria-label={t('core.tabs.closeNamed', { name: tab.title })}
                title={`${t('core.tabs.close')} (${formatAccel('CmdOrCtrl+W')})`}
                disabled={busy}
                onClick={() => onClose(tab.id)}
              >
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="v-btn-icon v-btn--sm pt-new"
        aria-label={t('core.tabs.new')}
        title={`${t('core.tabs.new')} (${formatAccel('CmdOrCtrl+T')})`}
        disabled={busy}
        onClick={onNew}
      >
        <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {update?.status === 'downloading' && (
        <span className="pt-update pt-update--muted" role="status">
          <Download size={14} strokeWidth={1.75} aria-hidden="true" />
          {t('core.update.downloading', { version: update.version, percent: update.percent ?? 0 })}
        </span>
      )}
      {update?.status === 'ready' && (
        <button
          type="button"
          className="pt-update"
          title={t('core.update.readyTitle', { version: update.version })}
          disabled={busy}
          onClick={onInstall}
        >
          <RotateCw size={14} strokeWidth={1.75} aria-hidden="true" />
          {t('core.update.restartButton')}
        </button>
      )}
      {dragged && (
        <div className="pt-ghost" style={{ left: ghost.x + 12, top: ghost.y + 12 }} role="status">
          {dragged.title}
          <span className="pt-ghost__hint">{t('core.tabs.dropToDetach')}</span>
        </div>
      )}
    </div>
  );
}
