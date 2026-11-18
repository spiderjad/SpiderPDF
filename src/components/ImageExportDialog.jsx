import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IMAGE_DPIS, EXT, defaultImagePattern, docVar, imagePatternError, imageNames, parseDpi, pixelSize,
  loadImagePrefs, saveImagePrefs,
} from '../imageExport.js';
import { wmTargets } from '../watermark.js';
import { joinPath, samePath } from '../savePlan.js';
import { displaySize } from './PageImage.jsx';
import Choice from './Choice.jsx';
import { useT, formatNumber } from '../i18n/index.js';
import './ImageExportDialog.css';

const PREVIEW_ROWS = 6;

/**
 * Archivo → Exportar como imagen…: PNG o JPG (con su calidad), 72, 150, 300 ppp o la que se escriba; todas las páginas,
 * un intervalo o las seleccionadas; un archivo por página en la carpeta elegida con un patrón de nombre
 * («{documento}_p{n}»). Lista los archivos que saldrán y avisa de los que ya existen.
 *   pages, selected (Set de claves), docName, defaultFolder, canPickFolder, chooseFolder(), filesExist(paths),
 *   notices (avisos: zonas a redactar…), onCancel, onExport({ keys, format, quality, dpi, folder, names, targets }).
 * spider-ui: v-dialog (<dialog> modal nativo), v-field, v-input, v-segmented (Choice), v-table, v-banner, v-btn-*.
 * Disposición en ImageExportDialog.css (prefijo ie-).
 */
export default function ImageExportDialog({
  pages, selected = new Set(), docName, defaultFolder = '', canPickFolder, chooseFolder, filesExist, notices = [], onCancel, onExport,
}) {
  const t = useT();
  const ref = useRef(null);
  const initial = useMemo(() => loadImagePrefs(globalThis.localStorage), []);
  const [format, setFormat] = useState(initial.format);
  const [quality, setQuality] = useState(initial.quality);
  const [dpiChoice, setDpiChoice] = useState(initial.dpi);
  const [custom, setCustom] = useState(initial.custom);
  const [pattern, setPattern] = useState(initial.pattern || defaultImagePattern());
  const [mode, setMode] = useState(selected.size > 1 ? 'selection' : 'all');
  const [range, setRange] = useState('');
  const [folder, setFolder] = useState(defaultFolder);
  const [existing, setExisting] = useState([]);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const dlg = ref.current;
    const prev = document.activeElement;
    dlg.showModal();
    const onCancelEvent = (e) => { e.preventDefault(); cancelRef.current(); };
    dlg.addEventListener('cancel', onCancelEvent);
    return () => {
      dlg.removeEventListener('cancel', onCancelEvent);
      if (dlg.open) dlg.close();
      prev?.focus?.();
    };
  }, []);

  const dpi = dpiChoice === 'custom' ? parseDpi(custom) : { dpi: dpiChoice };
  const targetsOf = useMemo(() => wmTargets(pages, mode, { range, selected }), [pages, mode, range, selected]);
  const keys = targetsOf.keys ?? [];
  const positions = useMemo(() => {
    const set = new Set(keys);
    return pages.map((p, i) => (set.has(p.key) ? i + 1 : 0)).filter(Boolean);
  }, [pages, keys]);
  const patternErr = imagePatternError(pattern);
  const names = useMemo(() => (patternErr ? [] : imageNames(pattern, positions, { name: docName, format })), [pattern, positions, docName, format, patternErr]);
  const targets = useMemo(() => (folder ? names.map((n) => joinPath(folder, n)) : []), [folder, names]);

  // Los que ya existen (con espera al escribir el patrón).
  useEffect(() => {
    if (!targets.length) { setExisting([]); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      filesExist(targets).then((found) => { if (alive) setExisting(found ?? []); }).catch(() => {});
    }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [targets, filesExist]);
  const exists = (p) => existing.some((x) => samePath(x, p));
  const existingCount = targets.filter(exists).length;

  // Tamaño de la primera imagen (para ver qué supone cada resolución).
  const first = pages[positions[0] - 1];
  const size = first && dpi.dpi ? (() => { const d = displaySize(first); return pixelSize(d.w, d.h, dpi.dpi); })() : null;

  const rangeError = mode === 'range' && targetsOf.error && targetsOf.error !== 'selection' ? targetsOf.error : '';
  const ready = !!keys.length && !targetsOf.error && !patternErr && !!dpi.dpi && (!!folder || !canPickFolder);

  async function pickFolder() {
    const dir = await chooseFolder({ defaultPath: folder || undefined });
    if (dir) setFolder(dir);
  }

  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    saveImagePrefs(globalThis.localStorage, { format, quality, dpi: dpiChoice, custom, pattern });
    onExport({ keys, format, quality, dpi: dpi.dpi, folder, names, targets });
  };
  const pct = (v) => `${formatNumber(Math.round(v * 100))} %`;

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby="ie-titulo"
      className="v-app v-dialog ie-dialog"
      onPointerDown={(e) => { if (e.target === ref.current) onCancel(); }}
    >
      <form onSubmit={submit} noValidate>
        <header className="v-card__header">
          <h2 id="ie-titulo" className="v-card__title">{t('dialogs.img.title')}</h2>
        </header>

        <div className="v-card__body ie-body">
          <div className="ie-row ie-row--fields">
            <div className="v-field">
              <span className="v-label">{t('dialogs.img.format')}</span>
              <Choice label={t('dialogs.img.format')} value={format} onChange={setFormat} options={[['png', 'PNG'], ['jpeg', 'JPG']]} />
            </div>
            {format === 'jpeg' && (
              <div className="v-field ie-grow">
                <label className="v-label" htmlFor="ie-calidad">{t('dialogs.img.quality')}</label>
                <div className="ie-row">
                  <input
                    id="ie-calidad" className="ie-range" type="range" min={50} max={100} step={5} value={Math.round(quality * 100)}
                    onChange={(e) => setQuality(Number(e.target.value) / 100)}
                  />
                  <output htmlFor="ie-calidad" className="ie-unit">{pct(quality)}</output>
                </div>
              </div>
            )}
          </div>
          <p className="v-help ie-help">{format === 'png' ? t('dialogs.img.pngHelp') : t('dialogs.img.jpgHelp')}</p>

          <div className="v-field">
            <span className="v-label">{t('dialogs.img.resolution')}</span>
            <div className="ie-row">
              <Choice
                label={t('dialogs.img.resolution')} value={dpiChoice} onChange={setDpiChoice}
                options={[...IMAGE_DPIS.map((d) => [d, t('dialogs.img.dpi', { dpi: d })]), ['custom', t('dialogs.img.custom')]]}
              />
              {dpiChoice === 'custom' && (
                <>
                  <input
                    className="v-input ie-num" inputMode="numeric" value={custom} aria-label={t('dialogs.img.customLabel')}
                    aria-invalid={!!dpi.error || undefined} onChange={(e) => setCustom(e.target.value)}
                  />
                  <span className="ie-unit">{t('dialogs.img.dpiUnit')}</span>
                </>
              )}
            </div>
            {dpi.error ? <p className="v-error" role="alert">{dpi.error}</p> : size && (
              <p className="v-help">
                {t('dialogs.img.pixels', { page: positions[0], w: formatNumber(size.width), h: formatNumber(size.height) })}
                {size.capped && ` ${t('dialogs.img.capped', { dpi: size.dpi })}`}
              </p>
            )}
          </div>

          <fieldset className="ie-pages">
            <legend className="v-label">{t('dialogs.wm.pages')}</legend>
            <label className="ie-check">
              <input type="radio" name="ie-paginas" checked={mode === 'all'} onChange={() => setMode('all')} />
              {t('dialogs.wm.pagesAll', { count: pages.length })}
            </label>
            <div className="ie-row">
              <label className="ie-check">
                <input type="radio" name="ie-paginas" checked={mode === 'range'} onChange={() => setMode('range')} />
                {t('dialogs.wm.pagesRange')}
              </label>
              <input
                className="v-input ie-range-text" type="text" value={range} placeholder="1-3, 5" aria-label={t('dialogs.wm.pagesRangeLabel')}
                aria-invalid={!!rangeError || undefined} onFocus={() => setMode('range')} onChange={(e) => { setRange(e.target.value); setMode('range'); }}
              />
            </div>
            {rangeError && <p className="v-error" role="alert">{rangeError}</p>}
            <label className="ie-check" aria-disabled={!selected.size || undefined}>
              <input type="radio" name="ie-paginas" checked={mode === 'selection'} disabled={!selected.size} onChange={() => setMode('selection')} />
              {t('dialogs.wm.pagesSelection', { count: selected.size })}
            </label>
          </fieldset>

          {canPickFolder && (
            <div className="v-field">
              <label className="v-label" htmlFor="ie-carpeta">{t('dialogs.split.folder')}</label>
              <div className="ie-row ie-row--nowrap">
                <input id="ie-carpeta" className="v-input ie-path" type="text" readOnly value={folder} title={folder} />
                <button type="button" className="v-btn-secondary" onClick={pickFolder}>{t('dialogs.split.folderChoose')}</button>
              </div>
            </div>
          )}

          <div className="v-field">
            <label className="v-label" htmlFor="ie-patron">{t('dialogs.split.pattern')}</label>
            <div className="ie-row ie-row--nowrap">
              <input
                id="ie-patron" className="v-input" type="text" value={pattern} spellCheck={false} aria-describedby="ie-patron-ayuda"
                aria-invalid={!!patternErr || undefined} onChange={(e) => setPattern(e.target.value)}
              />
              <span className="ie-unit">.{EXT[format]}</span>
            </div>
            {patternErr
              ? <p className="v-error" id="ie-patron-ayuda" role="alert">{patternErr}</p>
              : <p className="v-help ie-vars" id="ie-patron-ayuda"><code>{docVar()}</code> {t('dialogs.img.varDocHelp')} · <code>{'{n}'}</code> {t('dialogs.img.varNHelp')}</p>}
          </div>

          {names.length > 0 && (
            <div className="ie-preview">
              <p className="ie-preview__head">{t('dialogs.img.files', { count: names.length })}</p>
              <ul className="ie-files">
                {names.slice(0, PREVIEW_ROWS).map((n, i) => (
                  <li key={n}>
                    <span className="ie-file">{n}</span>
                    {targets[i] && exists(targets[i]) && <span className="v-badge v-badge--warning">{t('dialogs.split.existsTag')}</span>}
                  </li>
                ))}
              </ul>
              {names.length > PREVIEW_ROWS && <p className="ie-more">{t('dialogs.split.more', { count: names.length - PREVIEW_ROWS })}</p>}
            </div>
          )}
          <div className="ie-notices">
            {existingCount > 0 && <p className="v-banner v-banner--warning">{t('dialogs.img.exists', { count: existingCount })}</p>}
            {notices.map((n) => <p key={n} className="v-banner v-banner--info">{n}</p>)}
          </div>
        </div>

        <footer className="v-card__footer">
          <button type="button" className="v-btn-secondary" onClick={onCancel}>{t('dialogs.common.cancel')}</button>
          <button type="submit" className={existingCount ? 'v-btn-danger' : 'v-btn-primary'} disabled={!ready}>
            {existingCount ? t('dialogs.img.runReplace') : t('dialogs.img.run', { count: names.length || keys.length })}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

