import { useEffect, useRef } from 'react';
import { Printer, ShieldAlert, TriangleAlert } from 'lucide-react';

/**
 * Confirmación con varias salidas (window.confirm solo tiene Aceptar/Cancelar).
 *   actions: [{ id, label, kind: 'primary' | 'danger' | 'ghost' }]; la primera recibe el foco.
 *   onClose(id) — id de la acción, o null si se cancela (Esc, clic fuera o «Cancelar»).
 * Accesible: aria-modal, foco atrapado y devuelto al cerrar.
 */
export default function ConfirmDialog({ title, message, icon = 'alert', actions, onClose }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('[data-autofocus]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(null); return; }
      if (e.key !== 'Tab') return;
      const els = [...ref.current.querySelectorAll('button')];
      const first = els[0];
      const last = els.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, []);

  const Icon = icon === 'signed' ? ShieldAlert : icon === 'print' ? Printer : TriangleAlert;
  const iconTone = icon === 'print' ? 'bg-accent-soft text-accent-ink' : 'bg-danger-soft text-danger-ink';
  const style = {
    primary: 'bg-accent text-on-accent hover:bg-accent/90',
    danger: 'border border-danger/40 text-danger-ink hover:bg-danger-soft',
    ghost: 'hover:bg-hover',
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={() => onClose(null)} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
        className="motion-pop relative w-[440px] max-w-full rounded-2xl border border-line bg-panel p-5 shadow-pop"
      >
        <div className="flex items-start gap-3">
          <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${iconTone}`} aria-hidden="true">
            <Icon size={20} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="text-base font-semibold tracking-tight">{title}</h2>
            <p id="confirm-text" className="mt-1 whitespace-pre-line text-sm text-muted">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onClose(null)} className={`h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] active:scale-[0.98] ${style.ghost}`}>
            Cancelar
          </button>
          {[...actions].reverse().map((a, i) => (
            <button
              key={a.id}
              type="button"
              data-autofocus={i === actions.length - 1 ? '' : undefined}
              onClick={() => onClose(a.id)}
              className={`h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] active:scale-[0.98] ${style[a.kind ?? 'ghost']}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
