import { useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { useModal } from './PasswordDialog.jsx';
import { AI_PROVIDERS } from '../share.js';

/** Editar → Preferencias…: por ahora, la IA de «Enviar a IA». */
export default function PreferencesDialog({ prefs, onCancel, onSave }) {
  const ref = useRef(null);
  const [ai, setAi] = useState(prefs.ai);
  useModal(ref, onCancel);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={onCancel} />
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prefs-titulo"
        onSubmit={(e) => { e.preventDefault(); onSave({ ...prefs, ai }); }}
        className="motion-pop relative w-[420px] max-w-full overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-ink" aria-hidden="true"><Settings size={16} strokeWidth={1.75} /></span>
          <h2 id="prefs-titulo" className="text-base font-semibold tracking-tight">Preferencias</h2>
        </div>
        <div className="px-5 py-5 text-sm">
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-muted">IA para «Enviar a IA»</legend>
            <div className="flex gap-2">
              {Object.entries(AI_PROVIDERS).map(([id, label], i) => (
                <label key={id} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${ai === id ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-hover'}`}>
                  <input type="radio" name="prefs-ia" value={id} checked={ai === id} onChange={() => setAi(id)} data-autofocus={ai === id || undefined} className="accent-[var(--accent)]" />
                  {label}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted">Se abre su app de escritorio si está instalada; si no, la web. SpiderPDF no envía nada: el PDF se copia y lo pegas tú.</p>
          </fieldset>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onCancel} className="h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98]">Cancelar</button>
          <button type="submit" className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-[background-color,scale] hover:bg-accent/90 active:scale-[0.98]">Guardar</button>
        </div>
      </form>
    </div>
  );
}
