import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  DEFAULT_PATTERN, everyGroups, parseEvery, parseRanges, leftOut, bookmarkGroups, parseMb, patternError, fileNames, pagesLabel,
} from '../split.js';
import { formatSize } from '../reduce.js';
import { joinPath, samePath } from '../savePlan.js';
import { useT } from '../i18n/index.js';
import './SplitDialog.css';

const STORE = 'spiderpdf:dividir'; // modo, N, MB y patrón de la última vez
const PREVIEW_ROWS = 8;

function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    return {
      mode: ['every', 'ranges', 'bookmarks', 'size', 'page'].includes(v.mode) ? v.mode : 'every',
      every: /^\d{1,5}$/.test(v.every ?? '') ? v.every : '2',
      maxMb: /^\d{1,5}([.,]\d{1,3})?$/.test(v.maxMb ?? '') ? v.maxMb : '5',
      pattern: typeof v.pattern === 'string' && v.pattern.trim() ? v.pattern.slice(0, 200) : DEFAULT_PATTERN,
    };
  } catch {
    return { mode: 'every', every: '2', maxMb: '5', pattern: DEFAULT_PATTERN };
  }
}

/** «4, 9-10»: páginas sueltas y seguidas, para avisar de las que no van en ningún archivo. */
function pageList(positions) {
  const out = [];
  for (let i = 0; i < positions.length; i++) {
    let j = i;
    while (j + 1 < positions.length && positions[j + 1] === positions[j] + 1) j++;
    out.push(j > i ? `${positions[i] + 1}-${positions[j] + 1}` : String(positions[i] + 1));
    i = j;
  }
  return out.join(', ');
}

/**
 * Archivo → Dividir PDF…: cada N páginas, por intervalos, por marcadores de primer nivel, por tamaño máximo o página
 * por página; carpeta de destino y patrón de nombre; vista previa de los archivos que saldrán (con los que ya existen).
 * El tamaño máximo se calcula de verdad (runSize compone cada trozo; esos bytes son los que se guardan).
 *   count, docName, defaultFolder, canPickFolder, chooseFolder(), openPaths (no se pueden reemplazar), notices,
 *   loadMarks() → Promise<[{ title, pos }]>, runSize(maxBytes, onProgress) → { promise, cancel },
 *   filesExist(paths) → Promise<[rutas]>, onCancel, onSplit({ groups, names, targets, folder, mode, warnings }).
 * spider-ui: v-dialog (<dialog> modal nativo), v-field, v-input, v-table, v-banner, v-btn-*. Disposición en
 * SplitDialog.css (prefijo dv-).
 */
export default function SplitDialog({
  count, docName, defaultFolder = '', canPickFolder, chooseFolder, openPaths = [], notices = [],
  loadMarks, runSize, filesExist, onCancel, onSplit,
}) {
  const t = useT();
  const ref = useRef(null);
  const initial = useMemo(loadSettings, []);
  const [mode, setMode] = useState(initial.mode);
  const [every, setEvery] = useState(initial.every);
  const [ranges, setRanges] = useState('');
  const [maxMb, setMaxMb] = useState(initial.maxMb);
  const [pattern, setPattern] = useState(initial.pattern);
  const [folder, setFolder] = useState(defaultFolder);
  const [marks, setMarks] = useState(null); // null = leyendo
  const [sized, setSized] = useState(null); // { max, running, progress } | { max, groups, warnings } | { max, error }
  const [existing, setExisting] = useState([]);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  // Modal nativo (el resto de la ventana queda inerte); Esc → Cancelar; al cerrar, el foco vuelve a donde estaba.
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

  useEffect(() => {
    let alive = true;
    Promise.resolve().then(loadMarks).then((m) => alive && setMarks(m ?? []), () => alive && setMarks([]));
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Grupos según el modo (el de tamaño, cuando termina de calcularse).
  const size = mode === 'size' ? parseMb(maxMb) : null;
  const plan = (() => {
    if (mode === 'every') {
      const r = parseEvery(every, count);
      return r.error ? { error: r.error } : { groups: everyGroups(count, r.n) };
    }
    if (mode === 'page') return { groups: everyGroups(count, 1) };
    if (mode === 'ranges') return parseRanges(ranges, count);
    if (mode === 'bookmarks') {
      if (!marks) return { loading: t('dialogs.split.bookmarksLoading') };
      const groups = bookmarkGroups(count, marks);
      return groups.length ? { groups } : { error: t('dialogs.split.bookmarksNone') };
    }
    if (size.error) return { error: size.error };
    if (sized?.max !== size.bytes || sized.running) {
      const p = sized?.max === size.bytes ? sized.progress : null;
      return { loading: t('dialogs.split.sizeCalculating', { done: p?.done ?? 0, total: count }) };
    }
    return sized.error ? { error: t('dialogs.split.failed', { error: sized.error }) } : { groups: sized.groups };
  })();

  // Tamaño máximo: se calcula al dejar de escribir; cambiarlo o cerrar cancela el cálculo en curso.
  useEffect(() => {
    if (mode !== 'size' || !size?.bytes || sized?.max === size.bytes) return undefined;
    const max = size.bytes;
    let job = null;
    let alive = true;
    const timer = setTimeout(async () => {
      setSized({ max, running: true, progress: null });
      try {
        job = await runSize(max, (p) => alive && setSized((s) => (s?.max === max && s.running ? { ...s, progress: p } : s)));
        const res = await job.promise;
        if (alive) setSized({ max, groups: res.groups, warnings: res.warnings ?? [] });
      } catch (e) {
        if (alive) setSized(e?.cancelled ? null : { max, error: e?.message ?? String(e) });
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
      job?.cancel?.();
      setSized((s) => (s?.max === max && s.running ? null : s));
    };
  }, [mode, size?.bytes]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = plan.groups ?? [];
  const patternErr = patternError(pattern, mode);
  const names = useMemo(() => fileNames(pattern, groups, { name: docName }), [pattern, groups, docName]);
  const targets = useMemo(() => names.map((n) => (folder ? joinPath(folder, n) : n)), [names, folder]);
  // Con un patrón que no vale, los nombres no cuentan (el error del patrón ya lo dice).
  const isOriginal = folder && !patternErr ? targets.find((p) => openPaths.some((o) => samePath(o, p))) : null;

  // Los que ya existen en la carpeta (se avisa y el botón dice «Dividir y reemplazar»).
  const targetsKey = folder && !patternErr ? JSON.stringify(targets) : '';
  useEffect(() => {
    if (!targetsKey) { setExisting([]); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      Promise.resolve().then(() => filesExist(JSON.parse(targetsKey))).then((l) => alive && setExisting(l ?? []), () => alive && setExisting([]));
    }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [targetsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const exists = (p) => existing.some((x) => samePath(x, p));
  const existingCount = targets.filter(exists).length;

  const needFolder = canPickFolder && !folder;
  const ready = groups.length > 0 && !patternErr && !isOriginal && !needFolder;
  const missing = mode === 'ranges' && plan.groups ? leftOut(plan.groups, count) : [];
  const over = mode === 'size' && plan.groups ? plan.groups.filter((g) => g.over).map((g) => g.from) : [];
  const withSize = mode === 'size' && !!plan.groups;

  async function pickFolder() {
    const dir = await chooseFolder({ defaultPath: folder || undefined });
    if (dir) setFolder(dir);
  }

  function submit(e) {
    e.preventDefault();
    if (!ready) return;
    try { localStorage.setItem(STORE, JSON.stringify({ mode, every, maxMb, pattern })); } catch { /* sin almacenamiento */ }
    onSplit({ groups, names, targets, folder, mode, warnings: withSize ? sized.warnings : [] });
  }

  const noteId = 'dv-nota';
  const note = (forMode) => {
    if (mode !== forMode) return null;
    if (plan.error) return <p className="v-error dv-note" id={noteId} role="alert">{plan.error}</p>;
    if (forMode === 'ranges') return <p className="v-help dv-note" id={noteId}>{t('dialogs.split.rangesHelp')}</p>;
    if (forMode === 'bookmarks' && marks?.length) return <p className="v-help dv-note" id={noteId}>{t('dialogs.split.bookmarksHelp', { count: groups.length })}</p>;
    return null;
  };
  const Mode = ({ id, label, children, disabled = false }) => (
    <div className="dv-mode" data-checked={mode === id || undefined} aria-disabled={disabled || undefined}>
      <input type="radio" name="dv-modo" id={`dv-modo-${id}`} value={id} checked={mode === id} disabled={disabled} onChange={() => setMode(id)} />
      <label htmlFor={`dv-modo-${id}`}>{label}</label>
      {children}
      {note(id)}
    </div>
  );
  const invalid = (forMode) => (mode === forMode && !!plan.error) || undefined;

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby="dv-titulo"
      className="v-app v-dialog dv-dialog"
      onPointerDown={(e) => { if (e.target === ref.current) onCancel(); }}
    >
      <form onSubmit={submit} noValidate>
        <header className="v-card__header">
          <h2 id="dv-titulo" className="v-card__title">{t('dialogs.split.title')}</h2>
        </header>

        <div className="v-card__body">
          <fieldset className="dv-modes">
            <legend className="v-label">{t('dialogs.split.mode')}</legend>
            {Mode({
              id: 'every',
              label: t('dialogs.split.everyBefore'),
              children: (
                <>
                  <input
                    className="v-input dv-num" inputMode="numeric" value={every} aria-label={t('dialogs.split.everyLabel')}
                    aria-invalid={invalid('every')} aria-describedby={mode === 'every' ? noteId : undefined}
                    onChange={(e) => setEvery(e.target.value)} onFocus={() => setMode('every')}
                  />
                  <span>{t('dialogs.split.everyAfter')}</span>
                </>
              ),
            })}
            {Mode({
              id: 'ranges',
              label: t('dialogs.split.ranges'),
              children: (
                <input
                  className="v-input dv-wide" value={ranges} placeholder="1-3, 4-8, 9-" aria-label={t('dialogs.split.rangesLabel')}
                  aria-invalid={invalid('ranges')} aria-describedby={mode === 'ranges' ? noteId : undefined}
                  onChange={(e) => setRanges(e.target.value)} onFocus={() => setMode('ranges')}
                />
              ),
            })}
            {Mode({ id: 'bookmarks', label: t('dialogs.split.bookmarks'), disabled: marks !== null && !marks.length })}
            {Mode({
              id: 'size',
              label: t('dialogs.split.size'),
              children: (
                <>
                  <input
                    className="v-input dv-num" inputMode="decimal" value={maxMb} aria-label={t('dialogs.split.sizeLabel')}
                    aria-invalid={invalid('size')} aria-describedby={mode === 'size' ? noteId : undefined}
                    onChange={(e) => setMaxMb(e.target.value)} onFocus={() => setMode('size')}
                  />
                  <span className="dv-unit">{t('dialogs.split.sizeUnit')}</span>
                </>
              ),
            })}
            {Mode({ id: 'page', label: t('dialogs.split.page') })}
          </fieldset>

          <div className="v-field">
            <label className="v-label" htmlFor="dv-carpeta">{t('dialogs.split.folder')}</label>
            <div className="dv-row">
              <input
                id="dv-carpeta" className="v-input dv-path" type="text" readOnly value={folder}
                placeholder={canPickFolder ? t('dialogs.split.folderNone') : ''} title={folder || undefined}
                aria-invalid={needFolder || undefined} aria-describedby={canPickFolder ? undefined : 'dv-carpeta-ayuda'}
              />
              <button type="button" className="v-btn-secondary" onClick={pickFolder} disabled={!canPickFolder}>{t('dialogs.split.folderChoose')}</button>
            </div>
            {!canPickFolder && <p className="v-help" id="dv-carpeta-ayuda">{t('dialogs.split.folderBrowser')}</p>}
          </div>

          <div className="v-field">
            <label className="v-label" htmlFor="dv-patron">{t('dialogs.split.pattern')}</label>
            <input
              id="dv-patron" className="v-input" type="text" value={pattern} spellCheck={false}
              onChange={(e) => setPattern(e.target.value)} aria-invalid={!!patternErr} aria-describedby="dv-patron-ayuda"
            />
            {patternErr
              ? <p className="v-error" id="dv-patron-ayuda" role="alert">{patternErr}</p>
              : (
                <p className="v-help dv-vars" id="dv-patron-ayuda">
                  <span><code>{'{n}'}</code> {t('dialogs.split.varN')}</span>
                  <span><code>{'{name}'}</code> {t('dialogs.split.varName')}</span>
                  <span><code>{'{pages}'}</code> {t('dialogs.split.varPages')}</span>
                  {mode === 'bookmarks' && <span><code>{'{title}'}</code> {t('dialogs.split.varTitle')}</span>}
                </p>
              )}
          </div>

          <section className="dv-preview" aria-labelledby="dv-vista" aria-live="polite">
            {plan.loading ? (
              <p className="dv-status" role="status" id="dv-vista">
                <LoaderCircle size={16} strokeWidth={1.75} className="spin" aria-hidden="true" />
                {plan.loading}
              </p>
            ) : groups.length > 0 && (
              <>
                <h3 className="dv-preview__head" id="dv-vista" data-testid="dividir-cuantos">{t('dialogs.split.preview', { count: groups.length })}</h3>
                <div className="v-table-wrap">
                  <table className="v-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('dialogs.split.colFile')}</th>
                        <th scope="col">{t('dialogs.split.colPages')}</th>
                        {withSize && <th scope="col">{t('dialogs.split.colSize')}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {groups.slice(0, PREVIEW_ROWS).map((g, i) => (
                        <tr key={`${names[i]}-${g.from}`}>
                          <td>
                            {names[i]}
                            {exists(targets[i]) && <span className="v-badge v-badge--warning dv-tag">{t('dialogs.split.existsTag')}</span>}
                          </td>
                          <td>{pagesLabel(g)}</td>
                          {withSize && <td>{formatSize(g.size)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {groups.length > PREVIEW_ROWS && <p className="dv-more">{t('dialogs.split.more', { count: groups.length - PREVIEW_ROWS })}</p>}
              </>
            )}
          </section>

          <div className="dv-notices">
            {isOriginal && <p className="v-banner v-banner--danger" role="alert">{t('dialogs.split.isOriginal', { name: isOriginal.split(/[\\/]/).pop() })}</p>}
            {!isOriginal && existingCount > 0 && <p className="v-banner v-banner--warning">{t('dialogs.split.exists', { count: existingCount })}</p>}
            {missing.length > 0 && <p className="v-banner v-banner--info">{t('dialogs.split.leftOut', { count: missing.length, pages: pageList(missing) })}</p>}
            {over.length > 0 && <p className="v-banner v-banner--info">{t('dialogs.split.sizeOver', { count: over.length, pages: pageList(over), max: formatSize(size.bytes) })}</p>}
            {notices.map((n) => (
              <p key={n.text} className={`v-banner ${n.tone === 'danger' ? 'v-banner--danger' : 'v-banner--info'}`}>{n.text}</p>
            ))}
          </div>
        </div>

        <footer className="v-card__footer">
          <button type="button" className="v-btn-secondary" onClick={onCancel}>{t('dialogs.common.cancel')}</button>
          <button type="submit" className={existingCount && !isOriginal ? 'v-btn-danger' : 'v-btn-primary'} disabled={!ready}>
            {existingCount && !isOriginal ? t('dialogs.split.runReplace') : t('dialogs.split.run')}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
