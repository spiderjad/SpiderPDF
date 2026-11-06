import { useEffect, useMemo, useRef, useState } from 'react';
import { IndentDecrease, IndentIncrease, ListTree, Plus, Trash2 } from 'lucide-react';
import { pdf } from '../engine/client.js';
import { textLines, tocEntries, guessOffset, targetIndex, treeFromLevels, levelsFromTree } from '../toc.js';
import { mapCustomOutline } from '../outline.js';
import { useDelayed } from '../useDelayed.js';
import { useT } from '../i18n/index.js';

const MAX_LEVEL = 6;
let rowSeq = 0;
const newRow = (r) => ({ id: `r${++rowSeq}`, page: null, printed: null, roman: false, ...r });

/**
 * «Crear índice» desde una página de índice impreso: detecta las entradas, su nivel y el desfase entre el
 * número impreso y la página del PDF, y deja revisarlo todo (título, nivel, página, quitar y añadir) antes de
 * crear los marcadores.
 *   pages: páginas del estado. tocPages: posiciones de la página (o páginas) de índice detectadas ([] = elegir).
 *   initial: índice creado antes (state.outline) para editarlo en vez de detectar.
 *   onCreate(árbol [{ title, key, children }]).
 */
export default function TocDialog({ pages, tocPages = [], initial = null, onCancel, onCreate }) {
  const t = useT();
  const ref = useRef(null);
  const n = pages.length;
  const [tocAt, setTocAt] = useState(tocPages.length ? String(tocPages[0] + 1) : '');
  const [firstAt, setFirstAt] = useState('1'); // «La página impresa 1 es la página … del PDF»
  const [auto, setAuto] = useState(null); // { offset, matched, of } del cálculo automático
  const [rows, setRows] = useState(() => (initial
    ? levelsFromTree(mapCustomOutline(pages, initial)).map((r) => newRow({ title: r.title, level: r.level, page: r.pos >= 0 ? r.pos + 1 : '' }))
    : []));
  const [status, setStatus] = useState(initial ? 'ready' : tocPages.length ? 'loading' : 'pick');
  const [progress, setProgress] = useState(null);
  const showLoading = useDelayed(status === 'loading');
  const offset = Number(firstAt) - 1;

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

  // Detectar al elegir la página del índice (y al abrir con una detectada). Un índice de varias páginas: la
  // elegida y las que la siguen mientras lo parezcan.
  const tocPos = Number(tocAt) - 1;
  const tocValid = Number.isInteger(tocPos) && tocPos >= 0 && tocPos < n;
  const skipFirst = useRef(!!initial); // al editar no se detecta hasta que se cambie la página
  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return undefined; }
    if (!tocValid) { if (!initial) setStatus('pick'); return undefined; }
    let alive = true;
    setStatus('loading');
    const timer = setTimeout(async () => {
      const linesOf = (i) => pdf.pageChars(pages[i]).then(textLines).catch(() => []);
      const tocList = [tocPos];
      let entries = tocEntries(await linesOf(tocPos)).entries;
      for (let i = tocPos + 1; i < n && alive; i++) {
        const more = tocEntries(await linesOf(i));
        if (more.score < 3) break;
        tocList.push(i);
        entries = entries.concat(more.entries);
      }
      if (!alive) return;
      if (!entries.length) { setRows([]); setStatus('none'); return; }
      const texts = [];
      for (let i = 0; i < n && alive; i++) {
        texts.push((await pdf.pageChars(pages[i]).catch(() => ({ text: '' }))).text);
        if (i % 10 === 0) setProgress({ done: i + 1, total: n });
      }
      if (!alive) return;
      const g = guessOffset(entries, texts, tocList);
      setAuto({ ...g, of: entries.filter((e) => !e.roman).length });
      setFirstAt(String(g.offset + 1));
      setRows(entries.map((e) => newRow({ title: e.title, level: e.level, printed: e.printed, roman: e.roman })));
      setProgress(null);
      setStatus('ready');
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [tocAt]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Página del PDF (desde 1) de una fila: la escrita a mano o la impresa con el desfase. */
  const pageOf = (r) => (r.page !== null ? Number(r.page) : r.printed != null ? targetIndex(r, offset) + 1 : NaN);
  const problems = useMemo(() => rows.map((r) => {
    if (!r.title.trim()) return t('export.toc.errTitle');
    const p = pageOf(r);
    if (!Number.isInteger(p) || p < 1 || p > n) return t('export.toc.errPage', { max: n });
    return null;
  }), [rows, offset, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = problems.filter(Boolean).length;
  const offsetValid = Number.isInteger(offset) && offset > -n && offset < n;
  const canCreate = status === 'ready' && rows.length > 0 && !bad && offsetValid;

  const update = (id, changes) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const remove = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  const shift = (i, d) => setRows((rs) => rs.map((r, j) => {
    if (j !== i) return r;
    const max = Math.min(MAX_LEVEL, (rs[i - 1]?.level ?? 0) + 1);
    return { ...r, level: Math.max(1, Math.min(max, r.level + d)) };
  }));
  // Entrada nueva al final, en la página de la última (para que se pueda escribir el título y ajustarla).
  const add = () => {
    setRows((rs) => {
      const last = rs.length ? pageOf(rs.at(-1)) : NaN;
      return [...rs, newRow({ title: '', level: 1, page: String(Number.isInteger(last) && last >= 1 && last <= n ? last : 1) })];
    });
    setStatus('ready');
    requestAnimationFrame(() => ref.current?.querySelector('ol li:last-child input[type="text"]')?.focus());
  };

  function create() {
    if (!canCreate) return;
    onCreate(treeFromLevels(rows.map((r) => ({ title: r.title.trim(), level: r.level, key: pages[pageOf(r) - 1].key }))));
  }

  const numInput = 'tabnum h-8 w-16 rounded-lg border border-line bg-panel px-2 text-right text-sm outline-none transition-colors focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent';
  const iconBtn = 'grid size-7 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={onCancel} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="toc-titulo"
        className="motion-pop relative flex max-h-full w-[680px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-ink" aria-hidden="true"><ListTree size={16} strokeWidth={1.75} /></span>
          <h2 id="toc-titulo" className="text-base font-semibold tracking-tight">{initial ? t('export.toc.titleEdit') : t('export.toc.titleCreate')}</h2>
        </div>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-line px-5 py-4 text-sm">
          <label className="flex items-center gap-2">
            <span>{t('export.toc.tocPage')}</span>
            <input
              type="number" min={1} max={n} inputMode="numeric"
              value={tocAt}
              data-autofocus={!tocPages.length && !initial ? true : undefined}
              onChange={(e) => setTocAt(e.target.value)}
              aria-invalid={tocAt !== '' && !tocValid}
              className={numInput}
            />
          </label>
          <label className="flex items-center gap-2">
            <span>{t('export.toc.firstBefore')}</span>
            <input
              type="number" min={1} max={n} inputMode="numeric"
              value={firstAt}
              onChange={(e) => setFirstAt(e.target.value)}
              aria-invalid={!offsetValid}
              aria-describedby="toc-desfase"
              className={numInput}
            />
            <span>{t('export.toc.firstAfter')}</span>
          </label>
          <p id="toc-desfase" className="w-full text-xs text-muted">
            {auto && auto.matched > 0 && offset === auto.offset
              ? t('export.toc.computed', { matched: auto.matched, of: auto.of })
              : t('export.toc.offsetHelp')}
          </p>
        </div>

        <div className="desk-scroll min-h-[220px] flex-1 overflow-y-auto px-3 py-2" aria-busy={status === 'loading'}>
          {status === 'loading' && (
            <p role="status" className={`px-2 py-8 text-center text-sm text-muted transition-opacity ${showLoading ? 'opacity-100' : 'opacity-0'}`}>
              {progress ? t('export.toc.searchingPages', { done: progress.done, total: progress.total }) : t('export.toc.searchingEntries')}
            </p>
          )}
          {status === 'pick' && <p className="px-2 py-8 text-center text-sm text-muted">{t('export.toc.pick')}</p>}
          {status === 'none' && (
            <p role="status" className="px-2 py-8 text-center text-sm text-muted">
              {t('export.toc.none', { page: tocAt })}
            </p>
          )}
          {status === 'ready' && (
            <ol aria-label={t('export.toc.entries')} className="space-y-1">
              {rows.map((r, i) => {
                const problem = problems[i];
                const page = pageOf(r);
                return (
                  <li key={r.id} className="flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-hover/60" style={{ paddingLeft: 4 + (r.level - 1) * 18 }}>
                    <button type="button" className={iconBtn} onClick={() => shift(i, -1)} disabled={r.level <= 1} aria-label={t('export.toc.levelUpLabel', { title: r.title })} title={t('export.toc.levelUp')}>
                      <IndentDecrease size={16} strokeWidth={1.75} />
                    </button>
                    <button type="button" className={iconBtn} onClick={() => shift(i, 1)} disabled={r.level >= Math.min(MAX_LEVEL, (rows[i - 1]?.level ?? 0) + 1)} aria-label={t('export.toc.levelDownLabel', { title: r.title })} title={t('export.toc.levelDown')}>
                      <IndentIncrease size={16} strokeWidth={1.75} />
                    </button>
                    <input
                      type="text"
                      value={r.title}
                      onChange={(e) => update(r.id, { title: e.target.value })}
                      aria-label={t('export.toc.entryTitle', { n: i + 1 })}
                      aria-invalid={!r.title.trim() || undefined}
                      data-autofocus={i === 0 && (tocPages.length || initial) ? true : undefined}
                      className={`h-8 min-w-0 flex-1 rounded-lg border bg-panel px-2 text-sm outline-none transition-colors focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent ${r.level === 1 ? 'font-medium' : ''} ${!r.title.trim() ? 'border-danger' : 'border-transparent hover:border-line'}`}
                    />
                    {r.printed != null && r.page === null && (
                      <span className="tabnum shrink-0 text-xs text-muted" title={t('export.toc.printedHint')}>{r.roman ? t('export.toc.roman') : t('export.toc.printed', { n: r.printed })}</span>
                    )}
                    <input
                      type="number" min={1} max={n} inputMode="numeric"
                      value={r.page !== null ? r.page : Number.isFinite(page) ? page : ''}
                      onChange={(e) => update(r.id, { page: e.target.value })}
                      aria-label={t('export.toc.pageLabel', { title: r.title })}
                      aria-invalid={!!problem && r.title.trim() !== '' ? true : undefined}
                      title={problem ?? t('export.toc.pdfPage', { n: page })}
                      className={`${numInput} ${problem && r.title.trim() ? 'border-danger' : ''}`}
                    />
                    <button type="button" className={iconBtn} onClick={() => remove(r.id)} aria-label={t('export.toc.removeLabel', { title: r.title })} title={t('export.toc.remove')}>
                      <Trash2 size={16} strokeWidth={1.75} />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={add}
            disabled={status !== 'ready' && status !== 'none'}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus size={16} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
            {t('export.toc.add')}
          </button>
          <span role="status" className="min-w-0 flex-1 truncate text-xs text-muted">
            {status === 'ready' && (bad ? t('export.toc.bad', { count: bad }) : t('export.toc.count', { count: rows.length }))}
          </span>
          <button type="button" onClick={onCancel} className="h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98]">{t('export.common.cancel')}</button>
          <button
            type="button"
            onClick={create}
            disabled={!canCreate}
            className="h-9 rounded-lg bg-inverse px-4 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {initial ? t('export.toc.apply') : t('export.toc.titleCreate')}
          </button>
        </div>
      </div>
    </div>
  );
}
