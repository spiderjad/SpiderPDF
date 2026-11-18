import { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw, Pin, Copy, ChevronDown, Trash2 } from 'lucide-react';
import { useT } from '../i18n/index.js';

/**
 * Sello seleccionado (en la barra de herramientas de Leer): girar 15° a cada lado, «Fijar en la página», aplicar a
 * otras páginas (todas o las seleccionadas) y quitar. El giro libre y el tamaño, también con las asas sobre la página.
 *   annot; pages: nº de páginas; selected: nº de páginas seleccionadas;
 *   onRotate(grados), onFlat(bool), onApply('all' | 'selected'), onRemove()
 */
export default function StampBar({ annot, pages, selected, canFlat = true, onRotate, onFlat, onApply, onRemove }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);

  const btn = (label, Icon, onClick, extra = {}) => (
    <button type="button" aria-label={label} title={extra.title ?? label} onClick={onClick} className="v-btn-icon v-btn--sm" {...extra}>
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
  const apply = (which) => { setOpen(false); onApply(which); };

  return (
    <div role="toolbar" aria-label={t('reader.stamp.toolbar')} className="ml-2 flex min-w-0 items-center gap-1 border-l border-line pl-3">
      {btn(t('reader.stamp.rotateLeft'), RotateCcw, () => onRotate(-15))}
      {btn(t('reader.stamp.rotateRight'), RotateCw, () => onRotate(15))}
      {btn(t('reader.stamp.flat'), Pin, () => onFlat(!annot.flat), {
        'aria-pressed': !!annot.flat, title: canFlat ? t('reader.stamp.flatHint') : undefined, disabled: !canFlat,
      })}
      <div ref={wrap} className="relative">
        <button
          type="button" className="v-btn-ghost v-btn--sm" aria-haspopup="menu" aria-expanded={open}
          onClick={() => setOpen((o) => !o)} disabled={pages < 2}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
        >
          <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('reader.stamp.applyTo')}
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {open && (
          <div role="menu" aria-label={t('reader.stamp.applyTo')} className="v-menu motion-pop absolute left-0 top-[calc(100%+4px)] z-50 min-w-60">
            <button type="button" role="menuitem" className="v-menu__item" onClick={() => apply('all')}>
              <span className="v-menu__label">{t('reader.stamp.applyAll', { count: pages })}</span>
            </button>
            <button type="button" role="menuitem" className="v-menu__item" aria-disabled={!selected || undefined} disabled={!selected} onClick={() => apply('selected')}>
              <span className="v-menu__label">{t('reader.stamp.applySelected', { count: selected })}</span>
            </button>
          </div>
        )}
      </div>
      {btn(t('reader.stamp.remove'), Trash2, onRemove)}
    </div>
  );
}
