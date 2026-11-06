import { useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, LoaderCircle } from 'lucide-react';

/**
 * Campo de contraseña con «Mostrar». El valor solo vive en el estado de este componente: nunca se guarda ni se
 * registra, y desaparece al cerrar el diálogo.
 */
export function PasswordInput({ id, value, onChange, invalid, describedBy, autoFocus, autoComplete = 'off', label }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        data-autofocus={autoFocus || undefined}
        autoComplete={autoComplete}
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`h-9 w-full rounded-lg border bg-panel pl-3 pr-24 text-sm outline-none transition-colors focus:border-accent ${invalid ? 'border-danger' : 'border-line'}`}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={`${shown ? 'Ocultar' : 'Mostrar'} ${label ?? 'la contraseña'}`}
        className="absolute inset-y-1 right-1 flex items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink"
      >
        {shown ? <EyeOff size={14} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={14} strokeWidth={1.75} aria-hidden="true" />}
        {shown ? 'Ocultar' : 'Mostrar'}
      </button>
    </div>
  );
}

/** Foco atrapado y Esc para cerrar (como el resto de diálogos). */
export function useModal(ref, onCancel) {
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('[data-autofocus]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRef.current(); return; }
      if (e.key !== 'Tab') return;
      const els = [...ref.current.querySelectorAll('button:not([disabled]), input:not([disabled])')];
      const first = els[0]; const last = els.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [ref]);
}

/**
 * Pedir una contraseña, con reintentos: onSubmit(pw) → promesa con un mensaje de error (contraseña incorrecta: el
 * diálogo sigue abierto, con el campo vacío y el foco en él) o null (correcta: quien llama lo cierra).
 *   title, name (archivo), message, label, submitLabel, onCancel
 */
export default function PasswordDialog({ title, name, message, label = 'Contraseña', submitLabel = 'Abrir', onSubmit, onCancel }) {
  const ref = useRef(null);
  const inputId = useId();
  const errorId = useId();
  const [pw, setPw] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  useModal(ref, onCancel);

  async function submit(e) {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    const err = await onSubmit(pw);
    setBusy(false);
    if (err) {
      setError(err);
      setTries((n) => n + 1);
      setPw('');
      ref.current?.querySelector('input')?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={onCancel} />
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pw-titulo"
        onSubmit={submit}
        className="motion-pop relative w-[420px] max-w-full rounded-2xl border border-line bg-panel p-5 shadow-pop"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink" aria-hidden="true">
            <KeyRound size={20} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="pw-titulo" className="text-base font-semibold tracking-tight">{title}</h2>
            {name && <p className="truncate text-sm font-medium" title={name}>{name}</p>}
            {message && <p className="mt-1 text-sm text-muted">{message}</p>}
          </div>
        </div>
        <label htmlFor={inputId} className="mt-4 mb-1.5 block text-xs font-medium text-muted">{label}</label>
        <PasswordInput id={inputId} value={pw} onChange={(v) => { setPw(v); }} invalid={!!error} describedBy={error ? errorId : undefined} autoFocus label={`la ${label.toLowerCase()}`} />
        <p id={errorId} role={error ? 'alert' : undefined} className={`mt-1.5 min-h-5 text-xs ${error ? 'text-danger' : 'text-muted'}`}>
          {error ? `${error}${tries > 1 ? ` (${tries} intentos)` : ''}` : 'Distingue mayúsculas y minúsculas.'}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98]">Cancelar</button>
          <button
            type="submit"
            disabled={!pw || busy}
            className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-[background-color,scale] hover:bg-accent/90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {busy && <LoaderCircle size={16} strokeWidth={1.75} className="spin" aria-hidden="true" />}
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
