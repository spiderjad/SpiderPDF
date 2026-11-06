import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer, SlidersHorizontal } from 'lucide-react';
import { desktop } from '../desktop.js';
import PageImage, { displaySize } from './PageImage.jsx';
import { AnnotPreview } from './AnnotShapes.jsx';
import { PAPERS, resolvePages, sheetLayout, sheetCount, supportsDuplex, needsSystemDialog } from '../printLayout.js';
import { useT } from '../i18n/index.js';

const STORE = 'spiderpdf:imprimir';
const PREVIEW_W = 360; // px de ancho del papel en la vista previa

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}; } catch { return {}; }
}
function savePrefs(o) {
  const { printer, paper, color, duplex, fit, autoRotate } = o;
  try { localStorage.setItem(STORE, JSON.stringify({ printer, paper, color, duplex, fit, autoRotate })); } catch { /* sin almacenamiento */ }
}

/**
 * Diálogo de impresión propio (como el de Acrobat): vista previa de las hojas tal como saldrán, impresora,
 * copias, intervalo, color, doble cara, papel, ajuste y orientación automática. onPrint(opciones) imprime
 * directamente en la impresora elegida; onPrint({ ..., system: true }) abre el diálogo del sistema
 * («Configuración avanzada»). Recuerda la última impresora y las preferencias.
 */
export default function PrintDialog({ state, onCancel, onPrint }) {
  const t = useT();
  const ref = useRef(null);
  const [o, setO] = useState(() => {
    const p = loadPrefs();
    return {
      printer: p.printer ?? '',
      copies: 1,
      range: state.selected.size && state.selected.size < state.pages.length ? 'selection' : 'all',
      custom: '',
      color: p.color ?? true,
      duplex: p.duplex ?? 'simplex',
      fit: p.fit === 'actual' ? 'actual' : 'fit',
      autoRotate: p.autoRotate ?? true,
      paper: PAPERS[p.paper] ? p.paper : 'A4',
    };
  });
  const set = (patch) => setO((x) => ({ ...x, ...patch }));
  const [printers, setPrinters] = useState(null); // null = cargando
  const [sheet, setSheet] = useState(0);

  // Impresoras: la última usada si sigue instalada; si no, la predeterminada.
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => desktop.printers?.() ?? []).catch(() => []).then((list) => {
      if (!alive) return;
      setPrinters(list);
      setO((x) => (list.some((p) => p.name === x.printer) ? x : { ...x, printer: (list.find((p) => p.isDefault) ?? list[0])?.name ?? '' }));
    });
    return () => { alive = false; };
  }, []);

  // Foco atrapado, Esc para cancelar, foco devuelto al cerrar.
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('[data-autofocus]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
      if (e.key !== 'Tab') return;
      const els = [...ref.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
      const first = els[0];
      const last = els.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onCancel]);

  const printer = printers?.find((p) => p.name === o.printer);
  const duplexOk = supportsDuplex(printer);
  const duplex = duplexOk ? o.duplex : 'simplex';
  const resolved = resolvePages(state, o.range, o.custom);
  const pages = resolved.pages ?? [];
  const copies = Math.max(1, Math.min(999, Math.round(Number(o.copies)) || 1));
  const paper = PAPERS[o.paper];
  const total = pages.length;
  const at = Math.min(sheet, Math.max(0, total - 1));
  const noPrinters = printers !== null && printers.length === 0 && desktop.platform !== 'web';
  const canPrint = total > 0 && !resolved.error && !noPrinters && printers !== null;

  const settings = (system = false) => ({
    pages, copies, color: o.color, duplex, fit: o.fit, autoRotate: o.autoRotate, paper: o.paper,
    deviceName: printer?.name ?? '', system,
  });
  // Impresoras virtuales (PDF, XPS, OneNote): preguntan dónde guardar y solo pueden hacerlo con el diálogo de Windows.
  const viaSystem = needsSystemDialog(printer);
  const submit = (system) => {
    savePrefs(o);
    onPrint(settings(system || viaSystem));
  };

  // Sin useMemo: así se vuelve a traducir al cambiar de idioma (la cuenta es trivial).
  const count = (() => {
    const n = total;
    const s = sheetCount(n, copies, duplex);
    return `${t('dialogs.print.pages', { count: n })} · ${t('dialogs.print.sheets', { count: s })}${copies > 1 ? ` (${t('dialogs.print.copiesN', { count: copies })})` : ''}`;
  })();

  const curIndex = state.current + 1;
  const radio = (value, label, disabled = false) => (
    <label className={`flex items-center gap-2 ${disabled ? 'opacity-50' : ''}`}>
      <input type="radio" name="rango" value={value} checked={o.range === value} disabled={disabled} onChange={() => { set({ range: value }); setSheet(0); }} className="accent-[var(--accent)]" />
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
        aria-label={t('dialogs.print.title')}
        className="motion-pop relative flex max-h-full w-[920px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent-ink" aria-hidden="true"><Printer size={16} strokeWidth={1.75} /></span>
          <h2 className="text-base font-semibold tracking-tight">{t('dialogs.print.title')}</h2>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Vista previa */}
          <section aria-label={t('dialogs.common.preview')} className="flex w-[440px] shrink-0 flex-col items-center gap-3 overflow-hidden bg-desk px-6 py-5">
            <Sheet page={pages[at]} paper={paper} fit={o.fit} autoRotate={o.autoRotate} gray={!o.color} />
            <div className="flex items-center gap-2 text-sm">
              <NavButton label={t('dialogs.print.prevSheet')} disabled={at <= 0} onClick={() => setSheet(at - 1)}><ChevronLeft size={16} strokeWidth={1.75} /></NavButton>
              <span className="tabnum min-w-28 text-center text-muted-desk" aria-live="polite">{total ? t('dialogs.print.sheetOf', { n: at + 1, total }) : t('dialogs.print.noPages')}</span>
              <NavButton label={t('dialogs.print.nextSheet')} disabled={at >= total - 1} onClick={() => setSheet(at + 1)}><ChevronRight size={16} strokeWidth={1.75} /></NavButton>
            </div>
            <p className="tabnum text-xs text-muted-desk">{count}</p>
          </section>

          {/* Opciones */}
          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
            <Field label={t('dialogs.print.printer')} htmlFor="imp-impresora">
              <select
                id="imp-impresora"
                data-autofocus
                value={o.printer}
                disabled={!printers?.length}
                onChange={(e) => set({ printer: e.target.value })}
                className="h-9 w-full rounded-lg border border-line bg-panel px-2.5 disabled:opacity-60"
              >
                {printers === null && <option value="">{t('dialogs.print.searching')}</option>}
                {printers?.length === 0 && <option value="">{desktop.platform === 'web' ? t('dialogs.print.browserChooses') : t('dialogs.print.noPrinters')}</option>}
                {printers?.map((p) => <option key={p.name} value={p.name}>{p.isDefault ? t('dialogs.print.defaultPrinter', { name: p.displayName }) : p.displayName}</option>)}
              </select>
              {viaSystem && <p className="mt-1.5 text-xs text-muted">{t('dialogs.print.viaSystem')}</p>}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label={t('dialogs.print.copies')} htmlFor="imp-copias">
                <input id="imp-copias" type="number" min={1} max={999} value={o.copies} onChange={(e) => set({ copies: e.target.value })} className="tabnum h-9 w-full rounded-lg border border-line bg-panel px-2.5" />
              </Field>
              <Field label={t('dialogs.print.paper')} htmlFor="imp-papel">
                <select id="imp-papel" value={o.paper} onChange={(e) => set({ paper: e.target.value })} className="h-9 w-full rounded-lg border border-line bg-panel px-2.5">
                  {Object.entries(PAPERS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                </select>
              </Field>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-xs font-medium text-muted">{t('dialogs.common.pages')}</legend>
              {radio('all', t('dialogs.print.all', { n: state.pages.length }))}
              {radio('current', t('dialogs.print.current', { n: curIndex }), state.mode !== 'read')}
              {radio('selection', t('dialogs.print.selection', { n: state.selected.size }), !state.selected.size)}
              <div className="flex items-center gap-2">
                {radio('custom', t('dialogs.common.pages'))}
                <input
                  aria-label={t('dialogs.print.range')}
                  placeholder="1-3, 5"
                  value={o.custom}
                  onFocus={() => set({ range: 'custom' })}
                  onChange={(e) => { set({ custom: e.target.value, range: 'custom' }); setSheet(0); }}
                  aria-invalid={o.range === 'custom' && !!resolved.error}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2.5 aria-[invalid=true]:border-danger"
                />
              </div>
              {o.range === 'custom' && resolved.error && o.custom && <p role="alert" className="text-xs text-danger">{resolved.error}</p>}
            </fieldset>

            <div className="space-y-4">
              <Field label={t('dialogs.print.color')}>
                <Segmented value={o.color ? 'color' : 'bn'} onChange={(v) => set({ color: v === 'color' })} options={[['color', t('dialogs.print.color')], ['bn', t('dialogs.print.gray')]]} label={t('dialogs.print.color')} />
              </Field>
              <Field label={t('dialogs.print.sides')} htmlFor="imp-caras">
                <select
                  id="imp-caras"
                  value={duplex}
                  disabled={!duplexOk}
                  title={duplexOk ? undefined : t('dialogs.print.noDuplex')}
                  onChange={(e) => set({ duplex: e.target.value })}
                  className="h-9 w-full rounded-lg border border-line bg-panel px-2.5 disabled:opacity-60"
                >
                  <option value="simplex">{t('dialogs.print.simplex')}</option>
                  <option value="longEdge">{t('dialogs.print.longEdge')}</option>
                  <option value="shortEdge">{t('dialogs.print.shortEdge')}</option>
                </select>
              </Field>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-xs font-medium text-muted">{t('dialogs.common.size')}</legend>
              <Segmented value={o.fit} onChange={(v) => set({ fit: v })} options={[['fit', t('dialogs.print.fit')], ['actual', t('dialogs.print.actual')]]} label={t('dialogs.common.size')} />
              <label className="mt-2 flex items-start gap-2">
                <input type="checkbox" checked={o.autoRotate} onChange={(e) => set({ autoRotate: e.target.checked })} className="mt-1 accent-[var(--accent)]" />
                <span>{t('dialogs.print.autoRotate')}</span>
              </label>
            </fieldset>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={!total || !!resolved.error}
            className="mr-auto flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-50"
          >
            <SlidersHorizontal size={16} strokeWidth={1.75} />
            {t('dialogs.print.advanced')}
          </button>
          <button type="button" onClick={onCancel} className="h-9 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98]">{t('dialogs.common.cancel')}</button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={!canPrint}
            className="h-9 rounded-lg bg-inverse px-4 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {t('dialogs.print.title')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Una hoja de la vista previa: el papel y la página colocada como saldrá (misma cuenta que al imprimir). */
function Sheet({ page, paper, fit, autoRotate, gray }) {
  const k = PREVIEW_W / paper.w; // px por punto
  const W = PREVIEW_W;
  const H = Math.round(paper.h * k);
  if (!page) return <div className="paper bg-white" style={{ width: W, height: H }} />;
  const d = displaySize(page);
  const box = sheetLayout(d.w, d.h, paper, { fit, autoRotate });
  // La página (en su orientación de pantalla) mide d.w × d.h · scale; girada, se gira alrededor del centro.
  const pw = d.w * box.scale * k;
  const ph = d.h * box.scale * k;
  const cx = (box.x + box.w / 2) * k;
  const cy = (box.y + box.h / 2) * k;
  return (
    <div className="paper relative overflow-hidden bg-white" style={{ width: W, height: H, filter: gray ? 'grayscale(1)' : undefined }} data-testid="hoja">
      <div
        className="absolute"
        style={{ left: cx - pw / 2, top: cy - ph / 2, width: pw, height: ph, transform: box.rotate ? 'rotate(90deg)' : undefined }}
        data-rotate={box.rotate}
      >
        <PageImage page={page} cssWidth={Math.round(pw)} />
        <AnnotPreview page={page} cssWidth={Math.round(pw)} />
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, children }) {
  return (
    <div>
      {htmlFor ? <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted">{label}</label> : <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>}
      {children}
    </div>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-hover p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`h-8 min-w-0 flex-1 truncate rounded-md px-2 text-sm font-medium transition-colors ${value === v ? 'bg-panel text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function NavButton({ label, children, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} {...props} className="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40">
      {children}
    </button>
  );
}
