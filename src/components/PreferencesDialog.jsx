import { useEffect, useRef, useState } from 'react';
import { AI_PROVIDERS } from '../share.js';
import { REDUCE_LEVELS } from '../reduce.js';
import { NAME_MAX } from '../prefs.js';
import { desktop } from '../desktop.js';
import { useT, LANG_NAMES, detectLang } from '../i18n/index.js';
import './PreferencesDialog.css';

/**
 * Editar → Preferencias… (Ctrl+,): idioma, tu nombre, la carpeta de salida por defecto, la calidad de «Reducir
 * tamaño» y la IA de «Enviar a IA». onSave(prefs) guarda (src/prefs.js); onCancel no cambia nada.
 * Hecha con spider-ui (clases v-*, guía en node_modules/spider-ui/GUIDE.md): v-dialog (<dialog> nativo modal, que
 * atrapa el foco y cierra con Esc). Lo propio (solo disposición) en PreferencesDialog.css con el prefijo cfg-.
 */
export default function PreferencesDialog({ prefs, onCancel, onSave }) {
  const t = useT();
  const ref = useRef(null);
  const [lang, setLangPref] = useState(prefs.lang ?? 'auto');
  const [userName, setUserName] = useState(prefs.userName ?? '');
  const [outputDir, setOutputDir] = useState(prefs.outputDir ?? '');
  const [quality, setQuality] = useState(prefs.quality ?? 'balanced');
  const [ai, setAi] = useState(prefs.ai);
  const [picking, setPicking] = useState(false);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  // Abrir como modal (el resto de la ventana queda inerte); Esc → Cancelar; al cerrar, el foco vuelve a donde estaba.
  useEffect(() => {
    const dlg = ref.current;
    const prev = document.activeElement;
    dlg.showModal();
    dlg.querySelector('#prefs-nombre')?.focus(); // showModal enfoca el primer campo (Idioma); se empieza por el nombre
    const onCancelEvent = (e) => { e.preventDefault(); cancelRef.current(); };
    dlg.addEventListener('cancel', onCancelEvent);
    return () => {
      dlg.removeEventListener('cancel', onCancelEvent);
      if (dlg.open) dlg.close();
      prev?.focus?.();
    };
  }, []);

  const nameTooLong = userName.trim().length > NAME_MAX;
  const canPick = typeof desktop.chooseFolder === 'function';
  const system = LANG_NAMES[detectLang([...(navigator.languages ?? [navigator.language])])];

  async function pickFolder() {
    setPicking(true);
    try {
      const dir = await desktop.chooseFolder({ defaultPath: outputDir || undefined });
      if (dir) setOutputDir(dir);
    } finally {
      setPicking(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    if (nameTooLong) return;
    onSave({ ...prefs, lang, userName, outputDir, quality, ai });
  }

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby="prefs-titulo"
      className="v-app v-dialog"
      onPointerDown={(e) => { if (e.target === ref.current) onCancel(); }} // clic fuera (en el fondo)
    >
      <form onSubmit={submit} noValidate>
        <header className="v-card__header">
          <h2 id="prefs-titulo" className="v-card__title">{t('core.prefs.title')}</h2>
        </header>

        <div className="v-card__body">
          <div className="v-field">
            <label className="v-label" htmlFor="prefs-idioma">{t('core.prefs.language')}</label>
            <select id="prefs-idioma" className="v-input" value={lang} onChange={(e) => setLangPref(e.target.value)} aria-describedby="prefs-idioma-ayuda">
              <option value="auto">{t('core.prefs.languageAuto', { lang: system })}</option>
              {Object.entries(LANG_NAMES).map(([id, name]) => <option key={id} value={id} lang={id}>{name}</option>)}
            </select>
            <p className="v-help" id="prefs-idioma-ayuda">{t('core.prefs.languageHelp')}</p>
          </div>

          <div className="v-field">
            <label className="v-label" htmlFor="prefs-nombre">{t('core.prefs.name')}</label>
            <input
              id="prefs-nombre"
              className="v-input"
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder={t('core.prefs.namePlaceholder')}
              autoComplete="name"
              aria-invalid={nameTooLong}
              aria-describedby="prefs-nombre-ayuda"
            />
            {nameTooLong
              ? <p className="v-error" id="prefs-nombre-ayuda">{t('core.prefs.nameTooLong', { max: NAME_MAX })}</p>
              : <p className="v-help" id="prefs-nombre-ayuda">{t('core.prefs.nameHelp')}</p>}
          </div>

          <div className="v-field">
            <label className="v-label" htmlFor="prefs-carpeta">{t('core.prefs.folder')}</label>
            <div className="cfg-row">
              <input
                id="prefs-carpeta"
                className="v-input cfg-path"
                type="text"
                readOnly
                value={outputDir}
                placeholder={t('core.prefs.folderOriginal')}
                title={outputDir || undefined}
                aria-describedby="prefs-carpeta-ayuda"
              />
              <button
                type="button"
                className="v-btn-secondary"
                onClick={pickFolder}
                disabled={!canPick || picking}
                title={canPick ? undefined : t('core.prefs.desktopOnly')}
              >
                {t('core.prefs.choose')}
              </button>
              {outputDir && (
                <button type="button" className="v-btn-secondary" onClick={() => setOutputDir('')} aria-label={t('core.prefs.folderRemoveLabel')} title={t('core.prefs.folderRemoveTitle')}>
                  {t('core.prefs.folderRemove')}
                </button>
              )}
            </div>
            <p className="v-help" id="prefs-carpeta-ayuda">{t('core.prefs.folderHelp')}</p>
          </div>

          <div className="v-field">
            <label className="v-label" htmlFor="prefs-calidad">{t('core.prefs.quality')}</label>
            <select id="prefs-calidad" className="v-input" value={quality} onChange={(e) => setQuality(e.target.value)} aria-describedby="prefs-calidad-ayuda">
              {Object.entries(REDUCE_LEVELS).map(([id, l]) => <option key={id} value={id}>{l.label}</option>)}
            </select>
            <p className="v-help" id="prefs-calidad-ayuda">{t('core.prefs.qualityHelp', { hint: REDUCE_LEVELS[quality].hint })}</p>
          </div>

          <fieldset className="v-field cfg-fieldset" aria-describedby="prefs-ia-ayuda">
            <legend className="v-label">{t('core.prefs.ai')}</legend>
            <div className="cfg-options">
              {Object.entries(AI_PROVIDERS).map(([id, name]) => (
                <label key={id} className="cfg-option">
                  <input type="radio" name="prefs-ia" value={id} checked={ai === id} onChange={() => setAi(id)} />
                  {name}
                </label>
              ))}
            </div>
            <p className="v-help" id="prefs-ia-ayuda">{t('core.prefs.aiHelp')}</p>
          </fieldset>
        </div>

        <footer className="v-card__footer">
          <button type="button" className="v-btn-secondary" onClick={onCancel}>{t('core.common.cancel')}</button>
          <button type="submit" className="v-btn-primary" disabled={nameTooLong}>{t('core.common.save')}</button>
        </footer>
      </form>
    </dialog>
  );
}
