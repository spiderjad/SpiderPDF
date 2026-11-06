import { useEffect, useRef, useState } from 'react';
import { ScanText } from 'lucide-react';
import { OCR_LANGS } from '../ocr/langs.js';
import { useT } from '../i18n/index.js';

const STORE = 'spiderpdf:ocr';

function loadLangs() {
  try {
    const l = JSON.parse(localStorage.getItem(STORE) ?? '{}')?.langs;
    const ok = Array.isArray(l) ? l.filter((c) => OCR_LANGS.some((x) => x.code === c)) : [];
    return ok.length ? ok : OCR_LANGS.map((x) => x.code);
  } catch {
    return OCR_LANGS.map((x) => x.code);
  }
}

/**
 * «Reconocer texto (OCR)»: las páginas escaneadas o todo el documento, y los idiomas (recuerda los elegidos).
 * scanned: número de páginas escaneadas sin reconocer; total: páginas que se pueden reconocer (las que vienen de un
 * PDF). onRun({ scope: 'scanned' | 'all', langs }).
 */
export default function OcrDialog({ scanned, total, onCancel, onRun }) {
  const t = useT();
  const ref = useRef(null);
  const [scope, setScope] = useState(scanned ? 'scanned' : 'all');
  const [langs, setLangs] = useState(loadLangs);

  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('[data-autofocus]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
      if (e.key !== 'Tab') return;
      const els = [...ref.current.querySelectorAll('button:not([disabled]), input:not([disabled])')];
      const first = els[0]; const last = els.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onCancel]);

  const toggle = (code) => setLangs((l) => (l.includes(code) ? l.filter((c) => c !== code) : OCR_LANGS.map((x) => x.code).filter((c) => c === code || l.includes(c))));
  const count = scope === 'scanned' ? scanned : total;
  const valid = langs.length > 0 && count > 0;

  function submit(e) {
    e.preventDefault();
    if (!valid) return;
    try { localStorage.setItem(STORE, JSON.stringify({ langs })); } catch { /* sin almacenamiento */ }
    onRun({ scope, langs });
  }

  const option = (value, label, hint, disabled = false) => (
    <label className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors ${scope === value ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover'} ${disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
      <input
        type="radio"
        name="ocr-alcance"
        value={value}
        checked={scope === value}
        disabled={disabled}
        data-autofocus={scope === value || undefined}
        onChange={() => setScope(value)}
        className="mt-1 accent-[var(--accent)]"
      />
      <span>
        <span className={`block font-medium ${scope === value ? 'text-accent-ink' : ''}`}>{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={onCancel} />
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ocr-titulo"
        onSubmit={submit}
        className="motion-pop relative flex max-h-full w-[480px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-ink" aria-hidden="true"><ScanText size={16} strokeWidth={1.75} /></span>
          <h2 id="ocr-titulo" className="text-base font-semibold tracking-tight">{t('dialogs.ocr.title')}</h2>
        </div>
        <div className="space-y-5 overflow-y-auto px-5 py-5 text-sm">
          <p className="text-muted">{t('dialogs.ocr.intro')}</p>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-medium text-muted">{t('dialogs.common.pages')}</legend>
            {option('scanned', t('dialogs.ocr.scanned', { n: scanned }), t('dialogs.ocr.scannedHint'), !scanned)}
            {option('all', t('dialogs.common.wholeDoc', { n: total }), t('dialogs.ocr.allHint'))}
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-muted">{t('dialogs.ocr.langs')}</legend>
            <div className="flex flex-wrap gap-2">
              {OCR_LANGS.map((l) => (
                <label key={l.code} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors ${langs.includes(l.code) ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-hover'}`}>
                  <input type="checkbox" checked={langs.includes(l.code)} onChange={() => toggle(l.code)} className="accent-[var(--accent)]" />
                  {l.label}
                </label>
              ))}
            </div>
            {!langs.length && <p role="alert" className="mt-1.5 text-xs text-danger">{t('dialogs.ocr.noLang')}</p>}
            {langs.length > 0 && <p className="mt-1.5 text-xs text-muted">{t('dialogs.ocr.fewerFaster')}</p>}
          </fieldset>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onCancel} className="h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98]">{t('dialogs.common.cancel')}</button>
          <button
            type="submit"
            disabled={!valid}
            className="h-9 rounded-lg bg-inverse px-4 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {t('dialogs.ocr.run')}
          </button>
        </div>
      </form>
    </div>
  );
}
