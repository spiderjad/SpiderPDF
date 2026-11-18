import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import {
  WM_PRESETS, WM_COLORS, WM_FAMILIES, WM_ROTATIONS, WM_TEXT_MAX, WM_SIZE, normalizeWm, wmReady, wmTargets,
  loadWmPrefs, saveWmPrefs,
} from '../watermark.js';
import { FAMILIES } from '../textbox.js';
import { imageStamp } from '../stampDraw.js';
import PageImage, { displaySize } from './PageImage.jsx';
import WatermarkLayer from './WatermarkLayer.jsx';
import { useT, formatNumber } from '../i18n/index.js';
import './WatermarkDialog.css';

const PREVIEW_W = 300; // ancho de la vista previa, en px

/** Grupo de opciones con aspecto de control segmentado (radio: flechas para cambiar, como los nativos). */
function Choice({ label, value, options, onChange, disabled = false }) {
  const keys = options.map((o) => o[0]);
  const move = (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = keys[(keys.indexOf(value) + d + keys.length) % keys.length];
    onChange(next);
    e.currentTarget.parentElement.querySelector(`[data-value="${next}"]`)?.focus();
  };
  return (
    <div className="v-segmented wm-seg" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id} type="button" role="radio" aria-checked={value === id} data-value={id} tabIndex={value === id ? 0 : -1}
          className="v-segmented__item" disabled={disabled} onClick={() => onChange(id)} onKeyDown={move}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * Editar → Marca de agua…: texto (Borrador, Copia, Confidencial o libre) o imagen; fuente, tamaño, color, opacidad,
 * giro, centrada o en mosaico, delante o detrás; páginas (todas, intervalo o selección); vista previa en vivo.
 * Si el documento ya tiene marcas de agua de SpiderPDF (o pendientes), lo dice y permite quitarlas.
 *   pages, current (índice), selected (Set de claves), existing (Set de claves con marcas de agua guardadas, o null
 *   mientras se buscan), onApply({ keys, watermark }), onRemove(), onCancel.
 * spider-ui: v-dialog (<dialog> modal nativo), v-field, v-input, v-segmented, v-banner, v-btn-*. Disposición en
 * WatermarkDialog.css (prefijo wm-).
 */
export default function WatermarkDialog({ pages, current = 0, selected = new Set(), existing = null, onApply, onRemove, onCancel }) {
  const t = useT();
  const ref = useRef(null);
  const fileRef = useRef(null);
  const [wm, setWm] = useState(() => {
    const w = loadWmPrefs(globalThis.localStorage);
    return w.text ? w : { ...w, text: t('core.wm.preset.draft').toLocaleUpperCase() };
  });
  const [mode, setMode] = useState(selected.size > 1 ? 'selection' : 'all');
  const [range, setRange] = useState('');
  const [removeWhite, setRemoveWhite] = useState(true);
  const [imgFile, setImgFile] = useState(null);
  const [imgError, setImgError] = useState('');
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const set = (patch) => setWm((w) => normalizeWm({ ...w, ...patch }));

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

  // Imagen: se prepara (reducida y, si se pide, sin el fondo blanco) al elegirla y al cambiar la casilla.
  useEffect(() => {
    if (!imgFile) return undefined;
    let alive = true;
    imageStamp(imgFile, { removeWhite }).then(
      (look) => { if (alive) { setImgError(''); set({ image: { src: look.src, pxW: look.wPt, pxH: look.hPt } }); } },
      () => { if (alive) setImgError(t('dialogs.wm.imageError')); },
    );
    return () => { alive = false; };
  }, [imgFile, removeWhite]); // eslint-disable-line react-hooks/exhaustive-deps

  const targets = useMemo(() => wmTargets(pages, mode, { range, selected }), [pages, mode, range, selected]);
  const keys = targets.keys ?? [];
  const pending = pages.filter((p) => p.watermark).length;
  const saved = existing?.size ?? 0;
  const replaces = keys.some((k) => existing?.has(k) || pages.find((p) => p.key === k)?.watermark);
  const ready = wmReady(wm) && !targets.error;

  // Vista previa: la primera página a la que se aplica (o la actual), sin las marcas de agua que se sustituyen.
  const previewPage = useMemo(() => {
    const p = pages.find((x) => x.key === keys[0]) ?? pages[current] ?? pages[0];
    return p && existing?.has(p.key) ? { ...p, stripWm: true } : p;
  }, [pages, keys, current, existing]);
  const d = previewPage ? displaySize(previewPage) : { w: 1, h: 1 };
  const pw = d.w >= d.h ? PREVIEW_W : Math.round((PREVIEW_W * d.w) / d.h);
  const ph = Math.round((pw * d.h) / d.w);

  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    saveWmPrefs(globalThis.localStorage, wm);
    onApply({ keys, watermark: normalizeWm(wm) });
  };

  const rangeError = mode === 'range' && targets.error && targets.error !== 'selection' ? targets.error : '';
  const pct = (v) => `${formatNumber(Math.round(v * 100))} %`;

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby="wm-titulo"
      className="v-app v-dialog wm-dialog"
      onPointerDown={(e) => { if (e.target === ref.current) onCancel(); }}
    >
      <form onSubmit={submit} noValidate>
        <header className="v-card__header">
          <h2 id="wm-titulo" className="v-card__title">{t('dialogs.wm.title')}</h2>
        </header>

        <div className="v-card__body wm-body">
          <div className="wm-options">
            <div className="v-field">
              <span className="v-label" id="wm-tipo">{t('dialogs.wm.kind')}</span>
              <Choice
                label={t('dialogs.wm.kind')} value={wm.kind} onChange={(kind) => set({ kind })}
                options={[['text', t('dialogs.wm.kindText')], ['image', t('dialogs.wm.kindImage')]]}
              />
            </div>

            {wm.kind === 'text' ? (
              <>
                <div className="v-field">
                  <label className="v-label" htmlFor="wm-texto">{t('dialogs.wm.text')}</label>
                  <input
                    id="wm-texto" className="v-input" type="text" value={wm.text} maxLength={WM_TEXT_MAX}
                    aria-invalid={!wm.text.trim() || undefined} aria-describedby="wm-texto-ayuda"
                    onChange={(e) => set({ text: e.target.value })}
                  />
                  <div className="wm-presets" id="wm-texto-ayuda">
                    {WM_PRESETS.map((p) => (
                      <button key={p.id} type="button" className="v-btn-ghost v-btn--sm" onClick={() => set({ text: t(p.key).toLocaleUpperCase() })}>
                        {t(p.key)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="v-field">
                  <span className="v-label">{t('dialogs.wm.font')}</span>
                  <div className="wm-row">
                    <Choice
                      label={t('dialogs.wm.font')} value={wm.family} onChange={(family) => set({ family })}
                      options={WM_FAMILIES.map((f) => [f, FAMILIES[f].label])}
                    />
                    <label className="wm-check">
                      <input type="checkbox" checked={wm.bold} onChange={(e) => set({ bold: e.target.checked })} />
                      {t('dialogs.wm.bold')}
                    </label>
                  </div>
                </div>
                <div className="wm-row wm-row--fields">
                  <div className="v-field">
                    <label className="v-label" htmlFor="wm-tamano">{t('dialogs.wm.size')}</label>
                    <div className="wm-row">
                      <input
                        id="wm-tamano" className="v-input wm-num" type="number" min={WM_SIZE.min} max={WM_SIZE.max} value={wm.size}
                        onChange={(e) => set({ size: e.target.value })}
                      />
                      <span className="wm-unit">pt</span>
                    </div>
                  </div>
                  <div className="v-field">
                    <span className="v-label">{t('dialogs.stamp.color')}</span>
                    <div className="wm-colors" role="radiogroup" aria-label={t('dialogs.stamp.color')}>
                      {WM_COLORS.map(([hex, name]) => (
                        <button
                          key={hex} type="button" role="radio" aria-checked={wm.color === hex} aria-label={t(name)} title={t(name)}
                          className="wm-swatch" style={{ background: hex }} onClick={() => set({ color: hex })}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="v-field">
                  <span className="v-label">{t('dialogs.wm.image')}</span>
                  <div className="wm-row">
                    <button type="button" className="v-btn-secondary" onClick={() => fileRef.current?.click()}>
                      <ImagePlus size={16} strokeWidth={1.75} aria-hidden="true" />
                      {wm.image ? t('dialogs.wm.imageChange') : t('dialogs.wm.imageChoose')}
                    </button>
                    {wm.image && <img className="wm-thumb checker" src={wm.image.src} alt="" />}
                  </div>
                  <input
                    ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden data-testid="marca-imagen"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) setImgFile(f); e.target.value = ''; }}
                  />
                  {imgError && <p className="v-error" role="alert">{imgError}</p>}
                  <label className="wm-check">
                    <input type="checkbox" checked={removeWhite} onChange={(e) => setRemoveWhite(e.target.checked)} />
                    {t('dialogs.stamp.removeWhite')}
                  </label>
                </div>
                <div className="v-field">
                  <label className="v-label" htmlFor="wm-escala">{t('dialogs.wm.scale')}</label>
                  <div className="wm-row">
                    <input
                      id="wm-escala" className="wm-range" type="range" min={5} max={100} step={5} value={Math.round(wm.scale * 100)}
                      onChange={(e) => set({ scale: Number(e.target.value) / 100 })}
                    />
                    <output htmlFor="wm-escala" className="wm-unit">{pct(wm.scale)}</output>
                  </div>
                </div>
              </>
            )}

            <div className="v-field">
              <label className="v-label" htmlFor="wm-opacidad">{t('dialogs.wm.opacity')}</label>
              <div className="wm-row">
                <input
                  id="wm-opacidad" className="wm-range" type="range" min={5} max={100} step={5} value={Math.round(wm.opacity * 100)}
                  onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
                />
                <output htmlFor="wm-opacidad" className="wm-unit">{pct(wm.opacity)}</output>
              </div>
            </div>

            <div className="v-field">
              <span className="v-label">{t('dialogs.wm.rotation')}</span>
              <div className="wm-row">
                <Choice
                  label={t('dialogs.wm.rotation')} value={wm.rotation} onChange={(rotation) => set({ rotation })}
                  options={WM_ROTATIONS.map((r) => [r, t(`dialogs.wm.rotation.${r}`)])}
                />
                {wm.rotation === 'custom' && (
                  <>
                    <input
                      className="v-input wm-num" type="number" min={-180} max={180} value={wm.angle}
                      aria-label={t('dialogs.wm.angle')} onChange={(e) => set({ angle: e.target.value })}
                    />
                    <span className="wm-unit">°</span>
                  </>
                )}
              </div>
            </div>

            <div className="wm-row wm-row--fields">
              <div className="v-field">
                <span className="v-label">{t('dialogs.wm.position')}</span>
                <Choice
                  label={t('dialogs.wm.position')} value={wm.position} onChange={(position) => set({ position })}
                  options={[['center', t('dialogs.wm.center')], ['tile', t('dialogs.wm.tile')]]}
                />
              </div>
              <div className="v-field">
                <span className="v-label">{t('dialogs.wm.layer')}</span>
                <Choice
                  label={t('dialogs.wm.layer')} value={wm.layer} onChange={(layer) => set({ layer })}
                  options={[['front', t('dialogs.wm.front')], ['back', t('dialogs.wm.back')]]}
                />
              </div>
            </div>
            {wm.layer === 'back' && <p className="v-help wm-help">{t('dialogs.wm.backHelp')}</p>}

            <fieldset className="wm-pages">
              <legend className="v-label">{t('dialogs.wm.pages')}</legend>
              <label className="wm-check">
                <input type="radio" name="wm-paginas" checked={mode === 'all'} onChange={() => setMode('all')} />
                {t('dialogs.wm.pagesAll', { count: pages.length })}
              </label>
              <div className="wm-row">
                <label className="wm-check">
                  <input type="radio" name="wm-paginas" checked={mode === 'range'} onChange={() => setMode('range')} />
                  {t('dialogs.wm.pagesRange')}
                </label>
                <input
                  className="v-input wm-range-text" type="text" value={range} placeholder="1-3, 5" aria-label={t('dialogs.wm.pagesRangeLabel')}
                  aria-invalid={!!rangeError || undefined} onFocus={() => setMode('range')} onChange={(e) => { setRange(e.target.value); setMode('range'); }}
                />
              </div>
              {rangeError && <p className="v-error" role="alert">{rangeError}</p>}
              <label className="wm-check" aria-disabled={!selected.size || undefined}>
                <input type="radio" name="wm-paginas" checked={mode === 'selection'} disabled={!selected.size} onChange={() => setMode('selection')} />
                {t('dialogs.wm.pagesSelection', { count: selected.size })}
              </label>
            </fieldset>
          </div>

          <div className="wm-side">
            <p className="v-label wm-preview-label">
              {previewPage ? t('dialogs.wm.preview', { page: pages.indexOf(pages.find((p) => p.key === previewPage.key)) + 1 }) : ''}
            </p>
            {previewPage && (
              <div className="wm-preview" style={{ width: pw, height: ph }} data-testid="marca-vista-previa">
                <PageImage page={previewPage} cssWidth={pw} />
                {wmReady(wm) && <WatermarkLayer wm={wm} wPts={d.w} hPts={d.h} W={pw} H={ph} />}
              </div>
            )}
            {(saved > 0 || pending > 0) && (
              <div className="v-banner v-banner--info wm-existing">
                <p>{saved > 0 ? t('dialogs.wm.existing', { count: saved }) : t('dialogs.wm.pending', { count: pending })}</p>
                {replaces && <p>{t('dialogs.wm.replaces')}</p>}
                <button type="button" className="v-btn-secondary v-btn--sm" onClick={onRemove}>{t('dialogs.wm.remove')}</button>
              </div>
            )}
            {existing == null && <p className="v-help">{t('dialogs.wm.searching')}</p>}
          </div>
        </div>

        <footer className="v-card__footer">
          <button type="button" className="v-btn-secondary" onClick={onCancel}>{t('dialogs.common.cancel')}</button>
          <button type="submit" className="v-btn-primary" disabled={!ready}>{t('dialogs.wm.apply')}</button>
        </footer>
      </form>
    </dialog>
  );
}
