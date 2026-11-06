import { useEffect, useRef, useState } from 'react';
import { FileDown, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useModal } from './PasswordDialog.jsx';
import { REDUCE_LEVELS, sizeChange, worthSaving } from '../reduce.js';
import { useT } from '../i18n/index.js';

/**
 * «Reducir tamaño»: al abrir y al cambiar de nivel se calcula de verdad (el resultado se guarda tal cual), así el
 * tamaño que se muestra es el que tendrá el archivo. run(level, onProgress) → { promise, cancel };
 * before: tamaño actual (null = el del documento compuesto). notices: avisos (firma, contraseña). onSave(bytes, level).
 */
export default function ReduceDialog({ initialLevel = 'balanced', before, notices = [], run, onCancel, onSave }) {
  const t = useT();
  const ref = useRef(null);
  const [level, setLevel] = useState(REDUCE_LEVELS[initialLevel] ? initialLevel : 'balanced'); // Preferencias → calidad
  const [results, setResults] = useState({}); // nivel → { running, progress } | { bytes, before, reduced } | { error }
  const jobs = useRef({});
  useModal(ref, onCancel);

  useEffect(() => {
    if (results[level]) return;
    let alive = true;
    setResults((r) => ({ ...r, [level]: { running: true, progress: null } }));
    Promise.resolve(run(level, (p) => alive && setResults((r) => ({ ...r, [level]: { running: true, progress: p } })))).then((j) => {
      jobs.current[level] = j;
      return j.promise;
    }).then(
      (res) => alive && setResults((r) => ({ ...r, [level]: { bytes: res.bytes, before: before ?? res.composed, reduced: res.reduced } })),
      (e) => alive && setResults((r) => ({ ...r, [level]: e?.cancelled ? undefined : { error: e?.message ?? String(e) } })),
    );
    const lvl = level;
    return () => {
      // Se cambió de nivel antes de terminar: se cancela y, si se vuelve a él, se calcula de nuevo.
      alive = false;
      jobs.current[lvl]?.cancel?.();
      setResults((r) => (r[lvl]?.running ? { ...r, [lvl]: undefined } : r));
    };
  }, [level]); // eslint-disable-line react-hooks/exhaustive-deps
  // Al cerrar, se cancela lo que siga calculándose.
  useEffect(() => () => Object.values(jobs.current).forEach((j) => j?.cancel?.()), []);

  const cur = results[level];
  const ready = cur && cur.bytes;
  const worth = ready && worthSaving(cur.before, cur.bytes.length);

  const progressText = (p) => {
    if (!p) return t('dialogs.reduce.preparing');
    if (p.phase === 'scan') return t('dialogs.reduce.scanning', { done: p.done, total: p.total });
    if (p.phase === 'images') return t('dialogs.reduce.reducing', { done: p.done, total: p.total });
    if (p.phase === 'optimize') return t('dialogs.reduce.optimizing');
    return t('dialogs.reduce.preparing');
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={onCancel} />
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reducir-titulo"
        onSubmit={(e) => { e.preventDefault(); if (worth) onSave(cur.bytes, level); }}
        className="motion-pop relative flex max-h-full w-[480px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-ink" aria-hidden="true"><FileDown size={16} strokeWidth={1.75} /></span>
          <h2 id="reducir-titulo" className="text-base font-semibold tracking-tight">{t('dialogs.reduce.title')}</h2>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-5 text-sm">
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-medium text-muted">{t('dialogs.reduce.level')}</legend>
            {Object.entries(REDUCE_LEVELS).map(([id, l]) => (
              <label key={id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors ${level === id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover'}`}>
                <input type="radio" name="reducir-nivel" value={id} checked={level === id} onChange={() => setLevel(id)} data-autofocus={level === id || undefined} className="mt-1 accent-[var(--accent)]" />
                <span>
                  <span className={`block font-medium ${level === id ? 'text-accent-ink' : ''}`}>{l.label}</span>
                  <span className="block text-xs text-muted">{l.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted">{t('dialogs.reduce.note')}</p>

          <div role="status" aria-live="polite" className="min-h-14 rounded-xl bg-hover px-4 py-3">
            {!cur || cur.running ? (
              <span className="flex items-center gap-2 text-muted">
                <LoaderCircle size={16} strokeWidth={1.75} className="spin" aria-hidden="true" />
                {progressText(cur?.progress)}
              </span>
            ) : cur.error ? (
              <span className="text-danger">{t('dialogs.reduce.failed', { error: cur.error })}</span>
            ) : (
              <>
                <span className="tabnum block text-lg font-semibold tracking-tight" data-testid="reducir-tamano">{sizeChange(cur.before, cur.bytes.length)}</span>
                <span className="block text-xs text-muted">
                  {worth
                    ? cur.reduced ? t('dialogs.reduce.images', { count: cur.reduced }) : t('dialogs.reduce.onlyOptimized')
                    : t('dialogs.reduce.notWorth')}
                </span>
              </>
            )}
          </div>
          {notices.length > 0 && (
            <ul className="space-y-1.5">
              {notices.map((n) => (
                <li key={n.text} className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs ${n.tone === 'danger' ? 'bg-danger-soft text-danger-ink' : 'bg-accent-soft text-accent-ink'}`}>
                  <TriangleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden="true" />
                  {n.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onCancel} className="h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98]">{t('dialogs.common.cancel')}</button>
          <button
            type="submit"
            disabled={!worth}
            className="h-9 rounded-lg bg-inverse px-4 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {t('dialogs.reduce.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
