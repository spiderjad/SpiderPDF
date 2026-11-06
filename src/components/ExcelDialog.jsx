import { useEffect, useMemo, useRef, useState } from 'react';
import { Table2 } from 'lucide-react';
import { ExcelBadge } from './FileBadges.jsx';
import { scanTables } from '../export/scan.js';
import { joinContinued, numberStyle, displayCell, hasHeader } from '../tables.js';
import { useDelayed } from '../useDelayed.js';
import { useT } from '../i18n/index.js';

const PREVIEW_ROWS = 40;
const pagesLabel = (t, pages) => (pages.length > 1 ? t('export.excel.pageRange', { from: pages[0], to: pages.at(-1) }) : t('export.excel.pageOne', { page: pages[0] }));

/**
 * «Exportar a Excel»: busca las tablas de todas las páginas (con rejilla o por la alineación del texto), las
 * enseña para elegir cuáles van y cómo (una hoja por tabla o por página; unir las que siguen en la página
 * siguiente), y genera el libro. onExport({ tables, mode }) → { name, path } | null; al guardar, quien lo abrió
 * cierra el diálogo (y ofrece abrir el archivo en el aviso).
 */
export default function ExcelDialog({ pages, onCancel, onExport }) {
  const t = useT();
  const ref = useRef(null);
  const [found, setFound] = useState(null); // tablas por página (sin unir)
  const [progress, setProgress] = useState({ done: 0, total: pages.length });
  const [join, setJoin] = useState(true);
  const [mode, setMode] = useState('table');
  const [off, setOff] = useState(() => new Set()); // tablas que no se exportan (por su id)
  const [shown, setShown] = useState(0);
  const [state, setState] = useState(null); // null | 'saving' | { error }
  const loading = !found;
  const showLoading = useDelayed(loading);

  useEffect(() => {
    let cancelled = false;
    scanTables(pages, { onProgress: (p) => !cancelled && setProgress(p), isCancelled: () => cancelled })
      .then((list) => { if (!cancelled) setFound(list); })
      .catch(() => { if (!cancelled) setFound([]); });
    return () => { cancelled = true; };
  }, [pages]);

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

  const tables = useMemo(() => {
    if (!found) return [];
    const list = join ? joinContinued(found) : found.map((tb) => ({ ...tb, pages: [tb.page] }));
    return list.map((tb, i) => ({ ...tb, id: `${tb.pages.join('-')}:${tb.box.map((v) => v.toFixed(3)).join(',')}:${i}` }));
  }, [found, join]);
  const chosen = tables.filter((tb) => !off.has(tb.id));
  const cur = tables[Math.min(shown, tables.length - 1)];
  const toggle = (id) => setOff((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const multiPage = found?.length && new Set(found.map((tb) => tb.page)).size > 1;

  async function exportNow() {
    if (!chosen.length) return;
    setState('saving');
    try {
      await onExport({ tables: chosen, mode });
      setState(null); // cancelado en el diálogo de guardar (si se guardó, el diálogo ya se ha cerrado)
    } catch (e) {
      setState({ error: e.message });
    }
  }

  const radio = (value, label) => (
    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${mode === value ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-hover'}`}>
      <input type="radio" name="excel-hojas" checked={mode === value} onChange={() => setMode(value)} className="accent-[var(--accent)]" />
      {label}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={onCancel} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="excel-titulo"
        className="motion-pop relative flex h-[min(720px,100%)] w-[1000px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <ExcelBadge size={32} />
          <div className="min-w-0">
            <h2 id="excel-titulo" className="text-base font-semibold tracking-tight">{t('export.excel.title')}</h2>
            <p className="text-xs text-muted">{t('export.excel.subtitle')}</p>
          </div>
        </div>

        {loading ? (
          <div role="status" aria-busy="true" className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted">
            <span className={`transition-opacity ${showLoading ? 'opacity-100' : 'opacity-0'}`}>{t('export.excel.loading', { done: progress.done, total: progress.total })}</span>
            <div className={`h-1 w-56 overflow-hidden rounded-full bg-hover transition-opacity ${showLoading ? 'opacity-100' : 'opacity-0'}`}>
              <div className="h-full bg-accent transition-[width]" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
            </div>
          </div>
        ) : !tables.length ? (
          <div role="status" className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <span className="mb-3 grid size-10 place-items-center rounded-xl bg-hover text-muted" aria-hidden="true"><Table2 size={18} strokeWidth={1.75} /></span>
            <p className="text-sm font-medium">{t('export.excel.noneTitle')}</p>
            <p className="mt-1 max-w-sm text-xs text-muted">{t('export.excel.noneHelp')}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-5 py-3">
              <fieldset className="flex items-center gap-2">
                <legend className="sr-only">{t('export.excel.sheetsLegend')}</legend>
                <span className="text-xs font-medium text-muted">{t('export.excel.sheets')}</span>
                {radio('table', t('export.excel.perTable'))}
                {radio('page', t('export.excel.perPage'))}
              </fieldset>
              {multiPage && (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={join} onChange={(e) => setJoin(e.target.checked)} className="accent-[var(--accent)]" />
                  {t('export.excel.join')}
                </label>
              )}
            </div>
            <div className="flex min-h-0 flex-1">
              <ul aria-label={t('export.excel.listLabel')} className="desk-scroll w-[270px] shrink-0 space-y-1 overflow-y-auto border-r border-line p-2">
                {tables.map((tb, i) => {
                  const on = !off.has(tb.id);
                  const active = cur?.id === tb.id;
                  return (
                    <li key={tb.id} className={`flex items-start gap-2 rounded-lg px-2 py-2 transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-hover'}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(tb.id)}
                        aria-label={t('export.excel.include', { n: i + 1 })}
                        className="mt-0.5 accent-[var(--accent)]"
                        data-autofocus={i === 0 || undefined}
                      />
                      <button type="button" onClick={() => setShown(i)} aria-current={active || undefined} className="min-w-0 flex-1 text-left">
                        <span className={`block text-sm font-medium ${active ? 'text-accent-ink' : ''}`}>{t('export.excel.table', { n: i + 1 })}</span>
                        <span className="block text-xs text-muted">{t('export.excel.size', { pages: pagesLabel(t, tb.pages), rows: tb.rows.length, cols: tb.rows[0].length })}</span>
                        <span className="block truncate text-xs text-muted">{tb.rows[0].filter(Boolean).join(' · ')}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {cur && <Preview table={cur} index={tables.indexOf(cur)} />}
            </div>
          </>
        )}

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <div role="status" className="min-w-0 flex-1 text-sm">
            {state?.error ? (
              <span className="text-danger-ink">{t('export.common.error', { error: state.error })}</span>
            ) : !loading && tables.length ? (
              <span className="text-xs text-muted">{t('export.excel.footer', { tables: t('export.excel.chosen', { count: chosen.length }) })}</span>
            ) : null}
          </div>
          <button type="button" onClick={onCancel} className="h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98]">
            {t('export.common.cancel')}
          </button>
          <button
            type="button"
            onClick={exportNow}
            disabled={loading || !chosen.length || state === 'saving'}
            className="h-9 rounded-lg bg-inverse px-4 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {state === 'saving' ? t('export.common.exporting') : t('export.common.export')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Vista previa de una tabla como se verá en Excel: cabecera en negrita, números y fechas a la derecha. */
function Preview({ table, index }) {
  const t = useT();
  const style = numberStyle(table.rows);
  const header = hasHeader(table.rows, style);
  const rows = table.rows.slice(0, PREVIEW_ROWS + (header ? 1 : 0));
  return (
    <div className="desk-scroll min-w-0 flex-1 overflow-auto bg-desk p-4">
      <table aria-label={t('export.excel.previewLabel', { n: index + 1 })} className="border-collapse bg-panel text-xs shadow-card">
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className={header && ri === 0 ? 'bg-accent-soft font-semibold text-accent-ink' : ''}>
              <th scope="row" className="tabnum border border-line bg-hover px-1.5 text-right font-normal text-muted">{ri + 1}</th>
              {r.map((c, ci) => {
                const d = header && ri === 0 ? { text: c, align: 'left' } : displayCell(c, style);
                return (
                  <td key={ci} className={`max-w-[260px] border border-line px-2 py-1 align-top ${d.align === 'right' ? 'tabnum text-right whitespace-nowrap' : ''}`}>
                    {d.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > rows.length && <p className="mt-2 text-xs text-muted-desk">{t('export.excel.moreRows', { count: table.rows.length - rows.length })}</p>}
    </div>
  );
}
