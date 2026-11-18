import { useEffect, useRef, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { STAMP_PRESETS, STAMP_COLORS, TEXT_MAX, stampLines, stampName, loadRecentStamps } from '../stamps.js';
import { renderStamp, imageStamp } from '../stampDraw.js';
import { useT, getLocale } from '../i18n/index.js';
import './StampDialog.css';

/** Aspecto de un sello (para la vista previa y para ponerlo): imagen ya hecha, o dibujado con la fecha de ahora. */
async function look(def, user) {
  if (def.kind === 'image') return { src: def.src, wPt: def.wPt, hPt: def.hPt };
  return renderStamp(stampLines(def, { date: new Date(), user, locale: getLocale() }));
}

/**
 * Herramienta «Sello»: recientes, predefinidos (con fecha, hora y el nombre de Preferencias), texto propio y una
 * imagen (logo o sello escaneado, con el fondo blanco quitado). onChoose(def, { src, wPt, hPt }) y luego se hace clic
 * en la página para ponerlo. spider-ui: v-dialog (<dialog> modal nativo), v-field, v-input, v-btn-*; disposición en
 * StampDialog.css (prefijo st-).
 */
export default function StampDialog({ user = '', onChoose, onCancel }) {
  const t = useT();
  const ref = useRef(null);
  const fileRef = useRef(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const [recent] = useState(() => loadRecentStamps(globalThis.localStorage));
  const [previews, setPreviews] = useState({}); // clave → { src, wPt, hPt }
  const [text, setText] = useState('');
  const [color, setColor] = useState(STAMP_COLORS[0][0]);
  const [meta, setMeta] = useState(true);
  const [own, setOwn] = useState(null); // vista previa del texto propio
  const [file, setFile] = useState(null);
  const [removeWhite, setRemoveWhite] = useState(true);
  const [image, setImage] = useState(null); // { src, wPt, hPt } | { error }

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

  // Vistas previas de los predefinidos y los recientes (con la fecha y el nombre de ahora).
  useEffect(() => {
    let alive = true;
    const defs = [...STAMP_PRESETS.map((p) => ['p:' + p.id, { kind: 'preset', id: p.id }]), ...recent.map((d, i) => ['r:' + i, d])];
    (async () => {
      for (const [key, def] of defs) {
        const l = await look(def, user).catch(() => null);
        if (!alive) return;
        if (l) setPreviews((m) => ({ ...m, [key]: l }));
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ownDef = { kind: 'text', text: text.trim(), color, meta };
  useEffect(() => {
    if (!text.trim()) { setOwn(null); return undefined; }
    let alive = true;
    look(ownDef, user).then((l) => alive && setOwn(l), () => {});
    return () => { alive = false; };
  }, [text, color, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!file) return undefined;
    let alive = true;
    imageStamp(file, { removeWhite }).then((l) => alive && setImage(l), () => alive && setImage({ error: true }));
    return () => { alive = false; };
  }, [file, removeWhite]);

  const choose = async (def, l) => onChoose(def, l ?? await look(def, user));
  const Tile = ({ def, k }) => {
    const p = previews[k];
    return (
      <button type="button" className="st-tile" aria-label={stampName(def)} title={stampName(def)} onClick={() => choose(def, p)}>
        {p ? <img src={p.src} alt="" /> : <span className="st-tile__name">{stampName(def)}</span>}
      </button>
    );
  };

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby="st-titulo"
      className="v-app v-dialog st-dialog"
      onPointerDown={(e) => { if (e.target === ref.current) onCancel(); }}
    >
      <header className="v-card__header">
        <h2 id="st-titulo" className="v-card__title">{t('dialogs.stamp.title')}</h2>
      </header>
      <div className="v-card__body">
        {recent.length > 0 && (
          <section className="st-section" aria-labelledby="st-recientes">
            <h3 className="v-label" id="st-recientes">{t('dialogs.stamp.recent')}</h3>
            <div className="st-grid">{recent.map((d, i) => <Tile key={`r${i}`} def={d} k={`r:${i}`} />)}</div>
          </section>
        )}

        <section className="st-section" aria-labelledby="st-predefinidos">
          <h3 className="v-label" id="st-predefinidos">{t('dialogs.stamp.presets')}</h3>
          <div className="st-grid">{STAMP_PRESETS.map((p) => <Tile key={p.id} def={{ kind: 'preset', id: p.id }} k={`p:${p.id}`} />)}</div>
          {!user.trim() && <p className="v-help">{t('dialogs.stamp.noName')}</p>}
        </section>

        <section className="st-section" aria-labelledby="st-propio">
          <h3 className="v-label" id="st-propio">{t('dialogs.stamp.custom')}</h3>
          <div className="st-row">
            <input
              className="v-input st-text" type="text" value={text} maxLength={TEXT_MAX}
              aria-label={t('dialogs.stamp.customLabel')} placeholder={t('dialogs.stamp.customPlaceholder')}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="st-colors" role="radiogroup" aria-label={t('dialogs.stamp.color')}>
              {STAMP_COLORS.map(([hex, name]) => (
                <button
                  key={hex} type="button" role="radio" aria-checked={color === hex} aria-label={t(name)} title={t(name)}
                  className="st-swatch" style={{ background: hex }} onClick={() => setColor(hex)}
                />
              ))}
            </div>
          </div>
          <label className="st-check">
            <input type="checkbox" checked={meta} onChange={(e) => setMeta(e.target.checked)} />
            {t('dialogs.stamp.meta')}
          </label>
          <div className="st-row st-row--end">
            {own && <img className="st-preview" src={own.src} alt="" />}
            <button type="button" className="v-btn-secondary v-btn--sm" disabled={!own} onClick={() => choose(ownDef, own)}>{t('dialogs.stamp.use')}</button>
          </div>
        </section>

        <section className="st-section" aria-labelledby="st-imagen">
          <h3 className="v-label" id="st-imagen">{t('dialogs.stamp.image')}</h3>
          <p className="v-help st-help">{t('dialogs.stamp.imageHelp')}</p>
          <div className="st-row">
            <button type="button" className="v-btn-secondary v-btn--sm" onClick={() => fileRef.current?.click()}>
              <ImageUp size={16} strokeWidth={1.75} aria-hidden="true" />
              {t('dialogs.stamp.chooseImage')}
            </button>
            <input
              ref={fileRef} type="file" accept="image/png,image/jpeg" hidden data-testid="sello-imagen"
              onChange={(e) => { setImage(null); setFile(e.target.files?.[0] ?? null); }}
            />
            <label className="st-check">
              <input type="checkbox" checked={removeWhite} onChange={(e) => setRemoveWhite(e.target.checked)} />
              {t('dialogs.stamp.removeWhite')}
            </label>
          </div>
          {image?.error && <p className="v-error" role="alert">{t('dialogs.stamp.imageFailed')}</p>}
          {image?.src && (
            <div className="st-row st-row--end">
              <img className="st-preview checker" src={image.src} alt="" />
              <button type="button" className="v-btn-secondary v-btn--sm" onClick={() => choose({ kind: 'image', ...image }, image)}>{t('dialogs.stamp.useImage')}</button>
            </div>
          )}
        </section>
      </div>
      <footer className="v-card__footer">
        <button type="button" className="v-btn-secondary" onClick={onCancel}>{t('dialogs.common.cancel')}</button>
      </footer>
    </dialog>
  );
}
