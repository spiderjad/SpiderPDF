import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { useT } from '../i18n/index.js';

/**
 * Menú del clic derecho sobre una página (o la tecla de menú / Mayús+F10 con la página enfocada): «Copiar como
 * imagen». Se coloca junto al puntero sin salirse de la ventana; Esc o un clic fuera lo cierran y el foco vuelve.
 * spider-ui: v-menu, v-menu__item.
 */
export default function PageMenu({ x, y, label, canCopy = true, onCopyImage, onClose }) {
  const t = useT();
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const closeRef = useRef(onClose); // sin volver a montar los avisos (ni mover el foco) en cada repintado
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);

  useEffect(() => {
    const prev = document.activeElement;
    ref.current.querySelector('[role="menuitem"]:not([disabled])')?.focus();
    const onClose = () => closeRef.current();
    const away = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const keys = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', keys, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', keys, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      if (prev?.isConnected) prev.focus?.();
    };
  }, []);

  return (
    <div ref={ref} role="menu" aria-label={label} className="v-menu motion-pop fixed z-[60] min-w-52" style={pos}>
      <button type="button" role="menuitem" className="v-menu__item" disabled={!canCopy} onClick={onCopyImage}>
        <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="v-menu__label">{t('core.copyImage')}</span>
      </button>
    </div>
  );
}
