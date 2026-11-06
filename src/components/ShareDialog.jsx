import { useId, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Copy, FolderOpen, LoaderCircle, Mail, MessageCircle, Share2, Sparkles, TriangleAlert } from 'lucide-react';
import { useModal } from './PasswordDialog.jsx';

export const SHARE_TARGETS = [
  { id: 'whatsapp', label: 'WhatsApp', hint: 'Copia y abre WhatsApp', icon: MessageCircle },
  { id: 'ai', label: 'Enviar a IA', hint: 'Copia y abre {ai}', icon: Sparkles },
  { id: 'mail', label: 'Correo', hint: 'Con el PDF adjunto', icon: Mail },
  { id: 'copy', label: 'Copiar archivo', hint: 'Para pegarlo con Ctrl+V', icon: Copy },
  { id: 'reveal', label: 'Mostrar en el Explorador', hint: 'La carpeta con el PDF', icon: FolderOpen },
];

/**
 * «Compartir»: el documento tal como está (o las páginas seleccionadas), con un nombre editable y, si se quiere,
 * sin información oculta. onShare(target, { name, scope, hidden }) → promesa con { ok, text } para mostrar aquí.
 *   name: nombre propuesto; total / selected: páginas; notices: avisos (firma, redacción, contraseña) según las opciones.
 */
export default function ShareDialog({ name: initialName, total, selected, notices, aiName = 'Claude', onShare, onClose }) {
  const ref = useRef(null);
  const nameId = useId();
  const [name, setName] = useState(initialName);
  const [scope, setScope] = useState('all');
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(null); // destino en curso
  const [result, setResult] = useState(null); // { ok, text }
  useModal(ref, () => { if (!busy) onClose(); });

  const opts = { name: name.trim() || initialName, scope, hidden };
  const list = notices(opts);

  async function go(target) {
    if (busy) return;
    setBusy(target);
    setResult(null);
    try {
      setResult(await onShare(target, opts));
    } catch (e) {
      setResult({ ok: false, text: `No se pudo compartir: ${e?.message ?? e}` });
    } finally {
      setBusy(null);
    }
  }

  const radio = (value, label, disabled = false) => (
    <label className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${scope === value ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-hover'} ${disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
      <input type="radio" name="compartir-alcance" value={value} checked={scope === value} disabled={disabled} onChange={() => setScope(value)} className="accent-[var(--accent)]" />
      {label}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={() => { if (!busy) onClose(); }} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compartir-titulo"
        className="motion-pop relative flex max-h-full w-[520px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-ink" aria-hidden="true"><Share2 size={16} strokeWidth={1.75} /></span>
          <h2 id="compartir-titulo" className="text-base font-semibold tracking-tight">Compartir</h2>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-5 text-sm">
          <div>
            <label htmlFor={nameId} className="mb-1.5 block text-xs font-medium text-muted">Nombre del archivo</label>
            <input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-autofocus
              spellCheck={false}
              className="h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm outline-none transition-colors focus:border-accent"
            />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-muted">Qué compartir</legend>
            <div className="flex gap-2">
              {radio('all', `Todo el documento (${total})`)}
              {radio('selection', `Páginas seleccionadas (${selected})`, !selected)}
            </div>
          </fieldset>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" checked={hidden} onChange={() => setHidden((v) => !v)} className="mt-1 accent-[var(--accent)]" />
            <span>
              <span className="block font-medium">Quitar información oculta</span>
              <span className="block text-xs text-muted">Metadatos (autor, título…), notas, adjuntos y formularios interactivos. Lo que se ve en las páginas no cambia.</span>
            </span>
          </label>
          {list.length > 0 && (
            <ul className="space-y-1.5">
              {list.map((n) => (
                <li key={n.text} className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs ${n.tone === 'danger' ? 'bg-danger-soft text-danger-ink' : 'bg-accent-soft text-accent-ink'}`}>
                  <TriangleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden="true" />
                  {n.text}
                </li>
              ))}
            </ul>
          )}

          <div role="group" aria-label="Destino" className="grid grid-cols-2 gap-2 [&>button:last-child:nth-child(odd)]:col-span-2">
            {SHARE_TARGETS.map(({ id, label, hint, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                disabled={!!busy}
                className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition-[background-color,border-color,scale] hover:border-accent hover:bg-accent-soft active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover text-ink" aria-hidden="true">
                  {busy === id ? <LoaderCircle size={18} strokeWidth={1.75} className="spin" /> : <Icon size={18} strokeWidth={1.75} />}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{label}</span>
                  <span className="block truncate text-xs text-muted">{hint.replace('{ai}', aiName)}</span>
                </span>
              </button>
            ))}
          </div>

          <p role="status" aria-live="polite" className="min-h-5">
            {busy && <span className="text-muted">Preparando la copia…</span>}
            {!busy && result && (
              <span className={`flex items-start gap-2 ${result.ok ? 'text-ink' : 'text-danger'}`}>
                {result.ok
                  ? <CircleCheck size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                  : <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />}
                {result.text}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="text-xs text-muted">La copia se borra al cerrar SpiderPDF.</span>
          <button type="button" onClick={onClose} disabled={!!busy} className="h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98] disabled:opacity-50">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
