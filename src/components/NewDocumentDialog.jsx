import { useEffect, useRef, useState } from 'react';
import { FilePlus2, Minus, Plus } from 'lucide-react';
import { Field, Segmented } from './PrintDialog.jsx';
import { PAGE_SIZES, MAX_NEW_PAGES, DEFAULT_NEW_DOC, clampCount, newPageSize } from '../newDocument.js';
import { useT } from '../i18n/index.js';

const STORE = 'spiderpdf:nuevo';
const PREVIEW_BOX = 168; // px: la página más grande (A3 en vertical) cabe en este cuadrado

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {};
    return { size: PAGE_SIZES[p.size] ? p.size : DEFAULT_NEW_DOC.size, landscape: !!p.landscape, count: DEFAULT_NEW_DOC.count };
  } catch {
    return { ...DEFAULT_NEW_DOC };
  }
}

/**
 * «Nuevo documento»: tamaño (A4, Carta, A3), orientación y número de páginas, con una vista previa a escala.
 * Recuerda el tamaño y la orientación. onCreate({ size, landscape, count }).
 */
export default function NewDocumentDialog({ onCancel, onCreate }) {
  const t = useT();
  const ref = useRef(null);
  const [o, setO] = useState(loadPrefs);
  const set = (patch) => setO((x) => ({ ...x, ...patch }));
  const count = clampCount(o.count);
  const valid = String(o.count).trim() !== '' && Number(o.count) >= 1 && Number(o.count) <= MAX_NEW_PAGES;

  // Foco atrapado, Esc para cancelar, foco devuelto al cerrar (como los otros diálogos).
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('[data-autofocus]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
      if (e.key !== 'Tab') return;
      const els = [...ref.current.querySelectorAll('button:not([disabled]), input:not([disabled])')];
      const first = els[0];
      const last = els.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onCancel]);

  function submit(e) {
    e?.preventDefault();
    if (!valid) return;
    try { localStorage.setItem(STORE, JSON.stringify({ size: o.size, landscape: o.landscape })); } catch { /* sin almacenamiento */ }
    onCreate({ size: o.size, landscape: o.landscape, count });
  }

  const step = (d) => set({ count: clampCount(count + d) });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={onCancel} />
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nuevo-titulo"
        onSubmit={submit}
        className="motion-pop relative flex max-h-full w-[640px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-ink" aria-hidden="true"><FilePlus2 size={16} strokeWidth={1.75} /></span>
          <h2 id="nuevo-titulo" className="text-base font-semibold tracking-tight">{t('dialogs.newDoc.title')}</h2>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <section aria-label={t('dialogs.common.preview')} className="flex shrink-0 flex-col items-center justify-center gap-3 bg-desk px-6 py-6 sm:w-[240px]">
            <Preview size={o.size} landscape={o.landscape} count={count} />
            <p className="tabnum text-center text-xs text-muted-desk" aria-live="polite">
              {t('dialogs.newDoc.pages', { count })} · {PAGE_SIZES[o.size].label} {o.landscape ? t('dialogs.newDoc.landscapeLower') : t('dialogs.newDoc.portraitLower')}
            </p>
          </section>

          <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 text-sm">
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-muted">{t('dialogs.common.size')}</legend>
              <div role="radiogroup" aria-label={t('dialogs.common.size')} className="grid grid-cols-3 gap-2">
                {Object.entries(PAGE_SIZES).map(([k, s], i) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={o.size === k}
                    data-autofocus={o.size === k || undefined}
                    tabIndex={o.size === k ? 0 : -1}
                    onClick={() => set({ size: k })}
                    onKeyDown={(e) => {
                      const keys = Object.keys(PAGE_SIZES);
                      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
                      if (!d) return;
                      e.preventDefault();
                      const next = keys[(i + d + keys.length) % keys.length];
                      set({ size: next });
                      e.currentTarget.parentElement.querySelector(`[data-size="${next}"]`)?.focus();
                    }}
                    data-size={k}
                    className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${o.size === k ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover'}`}
                  >
                    <span className={`font-medium ${o.size === k ? 'text-accent-ink' : ''}`}>{s.label}</span>
                    <span className="tabnum whitespace-nowrap text-xs text-muted">{s.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <Field label={t('dialogs.newDoc.orientation')}>
              <Segmented
                label={t('dialogs.newDoc.orientation')}
                value={o.landscape ? 'h' : 'v'}
                onChange={(v) => set({ landscape: v === 'h' })}
                options={[['v', t('dialogs.newDoc.portrait')], ['h', t('dialogs.newDoc.landscape')]]}
              />
            </Field>

            <Field label={t('dialogs.common.pages')} htmlFor="nuevo-paginas">
              <div className="flex items-center gap-1.5">
                <StepButton label={t('dialogs.newDoc.fewer')} disabled={count <= 1} onClick={() => step(-1)}><Minus size={16} strokeWidth={1.75} /></StepButton>
                <input
                  id="nuevo-paginas"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_NEW_PAGES}
                  value={o.count}
                  onChange={(e) => set({ count: e.target.value })}
                  onBlur={() => set({ count })}
                  aria-invalid={!valid}
                  className="no-spin tabnum h-9 w-16 rounded-lg border border-line bg-panel px-2.5 text-center aria-[invalid=true]:border-danger"
                />
                <StepButton label={t('dialogs.newDoc.more')} disabled={count >= MAX_NEW_PAGES} onClick={() => step(1)}><Plus size={16} strokeWidth={1.75} /></StepButton>
              </div>
              {!valid && <p role="alert" className="mt-1.5 text-xs text-danger">{t('dialogs.newDoc.invalidCount', { max: MAX_NEW_PAGES })}</p>}
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onCancel} className="h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98]">{t('dialogs.common.cancel')}</button>
          <button
            type="submit"
            disabled={!valid}
            className="h-9 rounded-lg bg-inverse px-4 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {t('dialogs.newDoc.create')}
          </button>
        </div>
      </form>
    </div>
  );
}

/** La página a escala (todas comparten escala: A3 se ve más grande que A4); con varias, un taco de hojas. */
function Preview({ size, landscape, count }) {
  const a3 = PAGE_SIZES.A3;
  const k = PREVIEW_BOX / Math.max(a3.width, a3.height);
  const { width, height } = newPageSize(size, landscape);
  const w = Math.round(width * k);
  const h = Math.round(height * k);
  const behind = Math.min(count - 1, 2);
  return (
    <div className="grid place-items-center" style={{ width: PREVIEW_BOX + 12, height: PREVIEW_BOX + 12 }} data-testid="vista-nuevo">
      <div className="relative transition-[width,height] duration-150 ease-out" style={{ width: w, height: h }}>
        {Array.from({ length: behind }, (_, i) => (
          <div key={i} className="paper absolute bg-white" style={{ width: w, height: h, left: (behind - i) * 5, top: (behind - i) * 5 }} />
        ))}
        <div className="paper absolute inset-0 bg-white" data-w={Math.round(width)} data-h={Math.round(height)} />
      </div>
    </div>
  );
}

function StepButton({ label, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-lg text-muted transition-[background-color,scale] hover:bg-hover hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      {...props}
    >
      {children}
    </button>
  );
}
