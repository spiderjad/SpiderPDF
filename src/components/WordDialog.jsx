import { useEffect, useMemo, useRef, useState } from 'react';
import { Heading, Pilcrow, List, Table2, Image as ImageIcon, ScanText, FileText } from 'lucide-react';
import { scanDocument } from '../export/scanDoc.js';
import { layoutDocument, isBlackish, isNumericCell, numericColumns } from '../export/docLayout.js';
import { hasHeader, numberStyle } from '../tables.js';
import { useDelayed } from '../useDelayed.js';
import { WordBadge } from './FileBadges.jsx';
import { useT } from '../i18n/index.js';

/**
 * «Exportar a Word»: lee las páginas (texto, aspecto de las letras, tablas e imágenes), enseña cómo quedará el
 * documento y lo genera. onExport({ layout, images, pageBreaks }) → guardado (quien lo abrió cierra el diálogo);
 * scannedPending: páginas escaneadas sin texto todavía → onOcr() las reconoce antes de exportar.
 */
export default function WordDialog({ pages, scannedPending = 0, onCancel, onExport, onOcr }) {
  const t = useT();
  const ref = useRef(null);
  const [scan, setScan] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: pages.length });
  const [pageBreaks, setPageBreaks] = useState(true);
  const [withImages, setWithImages] = useState(true);
  const [state, setState] = useState(null); // null | 'saving' | { error }
  const loading = !scan;
  const showLoading = useDelayed(loading);

  useEffect(() => {
    let cancelled = false;
    scanDocument(pages, { onProgress: (p) => !cancelled && setProgress(p), isCancelled: () => cancelled })
      .then((s) => { if (!cancelled) setScan(s); })
      .catch(() => { if (!cancelled) setScan({ pages: [], images: new Map() }); });
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

  const layout = useMemo(() => (scan?.pages.length ? layoutDocument(scan.pages) : null), [scan]);
  const counts = useMemo(() => {
    const c = { heading: 0, paragraph: 0, list: 0, table: 0, image: 0 };
    for (const b of layout?.pages.flat() ?? []) c[b.type === 'title' ? 'heading' : b.type] += 1;
    return c;
  }, [layout]);
  const empty = layout && !layout.pages.some((bs) => bs.length);

  // URLs de las imágenes para la vista previa (se liberan al cerrar).
  const urls = useMemo(() => {
    const m = new Map();
    for (const [im, { type, bytes }] of scan?.images ?? []) m.set(im, URL.createObjectURL(new Blob([bytes], { type: type === 'png' ? 'image/png' : 'image/jpeg' })));
    return m;
  }, [scan]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  async function exportNow() {
    if (!layout) return;
    setState('saving');
    try {
      await onExport({ layout, images: withImages ? scan.images : new Map(), pageBreaks });
      setState(null); // cancelado en el diálogo de guardar (si se guardó, el diálogo ya se ha cerrado)
    } catch (e) {
      setState({ error: e.message });
    }
  }

  const stats = [
    { icon: Heading, n: counts.heading, key: 'export.word.statHeading' },
    { icon: Pilcrow, n: counts.paragraph, key: 'export.word.statParagraph' },
    { icon: List, n: counts.list, key: 'export.word.statList' },
    { icon: Table2, n: counts.table, key: 'export.word.statTable' },
    { icon: ImageIcon, n: counts.image, key: 'export.word.statImage' },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={onCancel} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="word-titulo"
        className="motion-pop relative flex h-[min(760px,100%)] w-[1000px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <WordBadge size={32} />
          <div className="min-w-0">
            <h2 id="word-titulo" className="text-base font-semibold tracking-tight">{t('export.word.title')}</h2>
            <p className="text-xs text-muted">{t('export.word.subtitle')}</p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[280px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-4">
            <section aria-labelledby="word-contenido">
              <h3 id="word-contenido" className="mb-2 text-xs font-medium text-muted">{t('export.word.found')}</h3>
              {loading ? (
                <div role="status" aria-busy="true" className={`space-y-2 text-sm text-muted transition-opacity ${showLoading ? 'opacity-100' : 'opacity-0'}`}>
                  <p>{t('export.word.reading', { done: progress.done, total: progress.total })}</p>
                  <div className="h-1 overflow-hidden rounded-full bg-hover">
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
                  </div>
                </div>
              ) : (
                <ul aria-label={t('export.word.found')} className="grid grid-cols-2 gap-1.5">
                  {stats.map(({ icon: Icon, n, key }) => (
                    <li key={key} className={`flex items-center gap-1.5 rounded-lg border border-line px-2 py-2 text-sm ${n ? '' : 'text-muted'}`}>
                      <Icon size={16} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden="true" />
                      <span className="tabnum font-medium">{n}</span>
                      <span className="whitespace-nowrap text-xs text-muted">{t(key, { count: n })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="word-opciones" className="space-y-2.5">
              <h3 id="word-opciones" className="text-xs font-medium text-muted">{t('export.word.options')}</h3>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" checked={pageBreaks} onChange={(e) => setPageBreaks(e.target.checked)} className="mt-1 accent-[var(--accent)]" data-autofocus />
                <span>{t('export.word.pageBreaks')}</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
                <span>{t('export.word.images')}</span>
              </label>
            </section>

            {scannedPending > 0 && (
              <section className="rounded-xl border border-line bg-accent-soft p-3 text-sm text-accent-ink">
                <p className="flex items-start gap-2">
                  <ScanText size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{t('export.word.scanned', { count: scannedPending })}</span>
                </p>
                <button
                  type="button"
                  onClick={onOcr}
                  className="mt-2 h-8 w-full rounded-lg bg-inverse px-3 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98]"
                >
                  {t('export.word.ocrFirst')}
                </button>
              </section>
            )}

            <p className="mt-auto text-xs text-muted">
              {t('export.word.stylesNote')}
            </p>
          </aside>

          <div className="desk-scroll min-w-0 flex-1 overflow-auto bg-desk p-6">
            {layout && !empty && <Preview layout={layout} urls={withImages ? urls : null} pageBreaks={pageBreaks} />}
            {empty && (
              <div role="status" className="grid h-full place-items-center text-center">
                <div>
                  <span className="mx-auto mb-3 grid size-10 place-items-center rounded-xl bg-panel text-muted" aria-hidden="true"><FileText size={18} strokeWidth={1.75} /></span>
                  <p className="text-sm font-medium">{t('export.word.emptyTitle')}</p>
                  <p className="mt-1 max-w-sm text-xs text-muted-desk">{t('export.word.emptyHelp')}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <div role="status" className="min-w-0 flex-1 text-sm">
            {state?.error ? <span className="text-danger-ink">{t('export.common.error', { error: state.error })}</span>
              : layout && !empty ? <span className="text-xs text-muted">{t('export.word.approx')}</span> : null}
          </div>
          <button type="button" onClick={onCancel} className="h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98]">
            {t('export.common.cancel')}
          </button>
          <button
            type="button"
            onClick={exportNow}
            disabled={loading || empty || state === 'saving'}
            className="h-9 rounded-lg bg-inverse px-4 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {state === 'saving' ? t('export.common.exporting') : t('export.common.export')}
          </button>
        </div>
      </div>
    </div>
  );
}

const MAX_PREVIEW_BLOCKS = 160;

/** El documento como se verá en Word (aproximado): una hoja blanca con los bloques. */
function Preview({ layout, urls, pageBreaks }) {
  const t = useT();
  const { body, headings } = layout;
  const scale = 1.15; // puntos → píxeles de la vista previa (si no cabe, la hoja se estrecha y el texto se reparte)
  let shown = 0;
  const runs = (rs) => rs.map((r, i) => (
    <span
      key={i}
      style={{
        fontWeight: r.style.bold ? 600 : undefined,
        fontStyle: r.style.italic ? 'italic' : undefined,
        color: isBlackish(r.style.color) ? undefined : `#${r.style.color.toString(16).padStart(6, '0')}`,
        fontSize: Math.abs(r.style.size - body.size) > 0.6 ? `${(r.style.size / body.size).toFixed(2)}em` : undefined,
        whiteSpace: r.text.includes('\t') ? 'pre-wrap' : undefined,
      }}
    >
      {r.text.replaceAll('\t', '    ')}
    </span>
  ));
  const block = (b, k) => {
    if (b.type === 'title' || b.type === 'heading') {
      const size = (b.type === 'title' ? headings.title : headings.levels[b.level - 1]) ?? body.size;
      return (
        <p key={k} role="heading" aria-level={b.type === 'title' ? 1 : b.level + 1} className="mb-[0.4em] mt-[0.8em] font-semibold leading-tight" style={{ fontSize: `${(size / body.size).toFixed(2)}em`, textAlign: b.align }}>
          {runs(b.runs.map((r) => ({ ...r, style: { ...r.style, size: body.size, bold: false } })))}
        </p>
      );
    }
    if (b.type === 'paragraph') return <p key={k} className="mb-[0.5em]" style={{ textAlign: b.align, paddingLeft: b.indent ? b.indent * scale : undefined }}>{runs(b.runs)}</p>;
    if (b.type === 'list') {
      const Tag = b.ordered ? 'ol' : 'ul';
      return <Tag key={k} className={`mb-[0.5em] pl-[2em] ${b.ordered ? 'list-decimal' : 'list-disc'}`}>{b.items.map((it, i) => <li key={i}>{runs(it.runs)}</li>)}</Tag>;
    }
    if (b.type === 'table') {
      const head = hasHeader(b.rows, numberStyle(b.rows));
      const numeric = numericColumns(b.rows, head);
      return (
        <table key={k} className="mb-[0.8em] w-full border-collapse text-[0.9em]">
          <tbody>
            {b.rows.map((r, ri) => (
              <tr key={ri} className={head && ri === 0 ? 'bg-[#F5F0FF] font-semibold' : ''}>
                {r.map((c, ci) => (
                  <td key={ci} className={`border border-[#BFBFC6] px-1.5 py-0.5 align-top ${(head && ri === 0 ? numeric[ci] : isNumericCell(c)) ? 'tabnum text-right' : ''}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (b.type === 'image') {
      const url = urls?.get(b.image);
      if (!url) return null;
      return (
        <div key={k} className="mb-[0.5em]" style={{ textAlign: b.align }}>
          <img src={url} alt="" className="inline-block max-w-full" style={{ width: b.width * scale }} />
        </div>
      );
    }
    return null;
  };
  return (
    <div
      aria-label={t('export.word.previewLabel')}
      className="paper mx-auto bg-white text-[#121216]"
      style={{ width: layout.pageSize.W * scale, maxWidth: '100%', padding: `${48}px ${layout.margins.right * scale}px 48px ${layout.margins.left * scale}px`, fontSize: body.size * scale, lineHeight: 1.35 }}
    >
      {layout.header?.length > 0 && <Running label={t('export.word.header')} blocks={layout.header} runs={runs} className="mb-6 border-b" />}
      {layout.pages.map((bs, pi) => {
        if (shown >= MAX_PREVIEW_BLOCKS) return null;
        const list = bs.slice(0, MAX_PREVIEW_BLOCKS - shown);
        shown += list.length;
        return (
          <div key={pi}>
            {pi > 0 && (
              <div className="my-6 flex items-center gap-2 text-[11px] text-[#6C6C75]" aria-hidden="true">
                <span className={`h-px flex-1 ${pageBreaks ? 'bg-[#C4C4CA]' : 'border-t border-dashed border-[#E7E7E9]'}`} />
                {pageBreaks ? t('export.word.pageBreak', { n: pi + 1 }) : t('export.word.pageContinues', { n: pi + 1 })}
                <span className={`h-px flex-1 ${pageBreaks ? 'bg-[#C4C4CA]' : 'border-t border-dashed border-[#E7E7E9]'}`} />
              </div>
            )}
            {list.map(block)}
          </div>
        );
      })}
      {shown >= MAX_PREVIEW_BLOCKS && <p className="mt-4 text-xs text-[#6C6C75]">{t('export.word.previewMore')}</p>}
      {layout.footer?.length > 0 && <Running label={t('export.word.footer')} blocks={layout.footer} runs={runs} className="mt-6 border-t" />}
    </div>
  );
}

/** Encabezado o pie de página (se repite en todas las páginas de Word): en gris, con su etiqueta al pasar el ratón. */
function Running({ label, blocks, runs, className }) {
  const t = useT();
  return (
    <div aria-label={label} title={t('export.word.running', { label })} className={`border-dashed border-[#C4C4CA] py-1.5 text-[0.85em] text-[#6C6C75] ${className}`}>
      {blocks.map((b, i) => <p key={i} style={{ textAlign: b.align }}>{runs(b.runs.map((r) => ({ ...r, style: { ...r.style, color: 0 } })))}</p>)}
    </div>
  );
}
