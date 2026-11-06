import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { FilePlus2, FolderOpen, CircleCheck, CircleAlert, FileText, LoaderCircle, LockKeyhole, ScanText, X } from 'lucide-react';
import { useDelayed } from './useDelayed.js';
import { reducer, initialState, pagesFrom, targetKeys } from './state.js';
import { rectFromDisplay, fromDisplay } from './geometry.js';
import { nearestRun, defaultStyle, FAMILIES, LINE_HEIGHT } from './textbox.js';
import { newAnnotId } from './state.js';
import { pageTurn } from './components/AnnotShapes.jsx';
import TextFormatBar from './components/TextFormatBar.jsx';
import { redactConflicts, conflictMessage } from './conflicts.js';
import { planSave, replacesOriginal, replacesSigned, signedSources, replaceOriginalWarning, signedWarning } from './savePlan.js';
import { incrementalPlan, reasonText, editPolicy, allowedTools, allows } from './signed.js';
import { blankPage, blankSize, imagePage, insertIndex, referencePage } from './insertPages.js';
import { printScale } from './print.js';
import { PAPERS, PRINT_BATCH, sheetLayout } from './printLayout.js';
import PrintDialog from './components/PrintDialog.jsx';
import NewDocumentDialog from './components/NewDocumentDialog.jsx';
import OcrDialog from './components/OcrDialog.jsx';
import { ocrPage, OCR_DPI } from './ocr/run.js';
import { dropCovered } from './ocr/layer.js';
import { newDocumentPages } from './newDocument.js';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import PasswordDialog from './components/PasswordDialog.jsx';
import ProtectDialog from './components/ProtectDialog.jsx';
import ShareDialog from './components/ShareDialog.jsx';
import ReduceDialog from './components/ReduceDialog.jsx';
import TocDialog from './components/TocDialog.jsx';
import ExcelDialog from './components/ExcelDialog.jsx';
import WordDialog from './components/WordDialog.jsx';
import { sizeChange } from './reduce.js';
import { hasRedactions, dirOf, joinPath, samePath } from './savePlan.js';
import { sharePlan, shareName, shareResult, AI_PROVIDERS } from './share.js';
import PreferencesDialog from './components/PreferencesDialog.jsx';
import { loadPrefs, savePrefs, outputFolder } from './prefs.js';
import { canChangeSecurity, choicesFrom, allAllowed } from './security.js';
import SignatureStatus from './components/SignatureStatus.jsx';
import { pdf } from './engine/client.js';
import { desktop, fileToEntry, DESKTOP_API } from './desktop.js';
import Toolbar from './components/Toolbar.jsx';
import TitleBar from './components/TitleBar.jsx';
import AppIcon from './components/AppIcon.jsx';
import AnnotToolbar, { TOOLS } from './components/AnnotToolbar.jsx';
import SignatureDialog from './components/SignatureDialog.jsx';
import { displaySize } from './components/PageImage.jsx';
import { menuModel, findByKey } from './menu.js';
import OrganizeView from './components/OrganizeView.jsx';
import ReaderView from './components/ReaderView.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import SearchBar, { useSearch } from './components/SearchBar.jsx';
import { selectedText } from './textGeom.js';
import { t, useT, setLang, resolveLang, getLang } from './i18n/index.js';

/** Acciones que chocan con una tarea en curso (abrir, guardar…): se ignoran mientras dure. */
const BLOCKED_WHILE_BUSY = new Set(['exportExcel', 'exportWord', 'reduce', 'share', 'protect', 'unprotect', 'unlock', 'new', 'ocr', 'open', 'openRecent', 'print', 'add','insertBlank', 'insertImage', 'save', 'saveAs', 'extract', 'delete', 'rotateLeft', 'rotateRight', 'undo', 'redo', 'selectAll']);

const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const baseName = (name) => name.replace(/\.pdf$/i, '');

// En macOS el menú es el nativo del sistema; en Windows, Linux y el navegador lo dibuja la app.
const customMenu = desktop.platform !== 'darwin';

const systemLanguages = () => [...(globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? 'es'])];

export default function App() {
  useT(); // vuelve a pintar todo al cambiar de idioma (Preferencias → Idioma)
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  const prefsRef = useRef(null); // preferencias (se asigna al leerlas, más abajo): para las funciones de guardar y exportar
  stateRef.current = state;
  const readerRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [fileOver, setFileOver] = useState(false);
  const [tool, setTool] = useState('select');
  const [colors, setColors] = useState({ highlight: '#FFD400', ink: '#1F3A93', note: '#FFD400' });
  const [sigOpen, setSigOpen] = useState(false);
  // «Crear índice» desde un índice impreso: { tocPages: [posiciones], initial? (editar el creado) } o null.
  const [tocDialog, setTocDialog] = useState(null);
  const [exportKind, setExportKind] = useState(null); // 'excel' | 'word': diálogo de exportar abierto
  const afterOcr = useRef(null); // 'word': al terminar el OCR pedido desde «Exportar a Word», se vuelve a él
  // Tarea larga en curso: { kind: 'open' | 'save' | 'extract', done, total, index?, count?, name? }
  const [task, setTask] = useState(null);
  const cancelOpen = useRef(null);
  const [engineReady, setEngineReady] = useState(false);
  useEffect(() => { pdf.ready().then(() => setEngineReady(true)).catch(() => setEngineReady(true)); }, []);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [textSel, setTextSel] = useState(null); // { key, a, b }: texto seleccionado en una página (Leer)
  const textSelRef = useRef(null);
  textSelRef.current = textSel;
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef(null);
  const [conflicts, setConflicts] = useState(() => new Map()); // pageKey -> { annots: Set, texts: Set }
  const seenConflicts = useRef(new Set());

  // action = { label, run }: botón en el aviso (p. ej. «Abrir en Excel» tras exportar); dura más para dar tiempo.
  const notify = useCallback((text, kind = 'info', action = null) => setToast({ text, kind, action, id: Date.now() }), []);
  // Confirmación con varias salidas: ask({ title, message, icon, actions }) → id de la acción o null.
  const [dialog, setDialog] = useState(null);
  const ask = (opts) => new Promise((resolve) => setDialog({ ...opts, resolve }));
  // Pedir una contraseña con reintentos: attempt(pw) → { value } si vale, { error } si no. → value, o null si se cancela.
  // La contraseña solo pasa por aquí de camino al worker: no se guarda en el estado ni en ningún registro.
  const [pwDialog, setPwDialog] = useState(null);
  const askPassword = (opts) => new Promise((resolve) => setPwDialog({ ...opts, resolve }));

  // Integridad de las firmas digitales, por documento de partida: docId → [firmas] | 'pending' | 'unavailable'.
  // La comprueba el proceso principal (electron/sigverify.cjs); en el navegador no está disponible.
  const [sigReports, setSigReports] = useState(() => new Map());
  // Nunca debe impedir abrir el PDF. Si el preload o el proceso principal son de una versión anterior
  // (en desarrollo no se recargan solos), el estado lo dice en vez de fallar en silencio.
  const verifySource = useCallback((docId, bytes) => {
    const set = (v) => setSigReports((m) => new Map(m).set(docId, v));
    set('pending');
    Promise.resolve()
      .then(() => {
        if (typeof desktop.verifySignatures !== 'function') throw Object.assign(new Error('sin verifySignatures'), { outdated: true });
        return desktop.verifySignatures(bytes);
      })
      .then((r) => set(Array.isArray(r) ? r : 'unavailable'))
      .catch((e) => set(e?.outdated || /No handler registered/i.test(String(e?.message))
        ? 'outdated'
        : [{ status: 'unknown', reason: t('core.app.sigCheckFailed', { error: e?.message ?? e }) }]));
  }, []);

  // Interfaz, preload y proceso principal deben ser de la misma versión (ver DESKTOP_API en desktop.js).
  useEffect(() => {
    Promise.resolve()
      .then(() => (desktop.apiVersion === DESKTOP_API ? desktop.mainApiVersion?.() : desktop.apiVersion))
      .catch(() => null)
      .then((v) => { if (v !== DESKTOP_API) notify(t('core.app.outdated'), 'error'); });
  }, [notify]);

  // Firmas de certificación (DocMDP): qué se puede editar. Toda acción del usuario pasa por act().
  const policy = useMemo(() => editPolicy(state.sources), [state.sources, getLang()]); // eslint-disable-line react-hooks/exhaustive-deps -- el aviso va en el idioma actual
  const policyRef = useRef(policy);
  policyRef.current = policy;
  const act = useCallback((a) => {
    if (allows(policyRef.current, a, stateRef.current)) dispatch(a);
    else notify(policyRef.current.notice, 'error');
  }, [notify]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' || toast.action ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Tras exportar a Excel o Word: el diálogo se cierra y el aviso ofrece abrir el archivo con su programa.
  const exported = useCallback((saved, label) => {
    setExportKind(null);
    notify(t('core.app.exported', { name: saved.name }), 'info', saved.path ? {
      label,
      run: async () => {
        const r = await desktop.exportOpen?.(saved.path).catch((e) => ({ ok: false, message: e.message }));
        if (!r?.ok) notify(r?.message ?? t('core.app.openFileFailed'), 'error');
      },
    } : null);
  }, [notify]);

  // Enlaces del PDF que no resuelve la vista de lectura: webs (con confirmación) y páginas que ya no están.
  const followLink = useCallback(async ({ uri, missing }) => {
    if (missing) { notify(t('core.link.missing')); return; }
    if (!uri) return;
    let shown = uri;
    try { const u = new URL(uri); if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) throw new Error(); shown = u.href; } catch {
      notify(t('core.link.blocked'), 'error');
      return;
    }
    const ok = await ask({
      title: shown.startsWith('mailto:') ? t('core.link.mailTitle') : t('core.link.openTitle'),
      message: `${shown}\n\n${shown.startsWith('mailto:') ? t('core.link.opensInMail') : t('core.link.opensInBrowser')}`,
      icon: 'link',
      actions: [{ id: 'open', label: t('core.common.open'), kind: 'primary' }],
    });
    if (ok !== 'open') return;
    if (typeof desktop.openLink !== 'function') { notify(t('core.link.outdated'), 'error'); return; }
    try {
      const r = await desktop.openLink(shown);
      if (!r?.ok) notify(r?.message ?? t('core.link.failed'), 'error');
    } catch (e) {
      notify(t('core.link.failedWhy', { error: e.message }), 'error');
    }
  }, [notify]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Cargar archivos -----------------------------------------------------
  async function load(entries) {
    const sources = [];
    const pages = [];
    const errors = [];
    let cancelled = false;
    cancelOpen.current = null;
    for (const [i, e] of entries.entries()) {
      if (cancelled) break;
      if (e.error) { errors.push(`«${e.name}»: ${e.error}`); continue; }
      try {
        setTask({ kind: 'open', index: i + 1, count: entries.length, name: e.name, done: 0, total: 0 });
        const onProgress = (p) => setTask((t) => (t?.kind === 'open' ? { ...t, ...p } : t));
        const tryOpen = (pw) => {
          const j = pdf.openJob(e.bytes, pw, onProgress, pw === '' ? e.known : undefined);
          cancelOpen.current = () => { cancelled = true; j.cancel(); };
          return j.promise;
        };
        let opened;
        try {
          opened = await tryOpen('');
        } catch (err) {
          if (!err.needsPassword) throw err;
          // Protegido: se pide la contraseña (con reintentos) hasta que vale o se cancela.
          setTask(null);
          opened = await askPassword({
            title: t('core.open.protectedTitle'),
            name: e.name,
            message: t('core.open.protectedMessage'),
            submitLabel: t('core.common.open'),
            attempt: (pw) => tryOpen(pw).then((value) => ({ value }), (x) => {
              if (x.wrongPassword) return { error: t('core.open.wrongPassword') };
              throw x;
            }),
          });
          if (!opened) continue; // canceló: ese archivo no se abre (sin mensaje de error)
        }
        const { docId, pages: sizes, hasForm, signed, mdp, security } = opened;
        const src = { docId, name: baseName(e.name), path: e.path, hasForm, signed, mdp, security, pageCount: sizes.length, size: e.bytes.length };
        if (signed > 0) verifySource(docId, e.bytes);
        sources.push(src);
        pages.push(...pagesFrom(src, sizes));
      } catch (err) {
        if (err.cancelled) { cancelled = true; break; }
        errors.push(`«${e.name}»: ${err.message}`);
      }
    }
    cancelOpen.current = null;
    setTask(null);
    if (cancelled) {
      sources.forEach((src) => pdf.close(src.docId));
      notify(t('core.open.cancelled'));
      return { sources: [], pages: [], cancelled: true };
    }
    if (errors.length) notify(errors.join(' '), 'error');
    return { sources, pages };
  }

  async function openEntries(entries) {
    if (!entries?.length) return;
    const s = stateRef.current;
    if (s.dirty && s.pages.length) {
      const ok = await ask({
        title: t('core.unsaved.title'),
        message: t('core.unsaved.openMessage'),
        actions: [{ id: 'open', label: t('core.unsaved.openAnyway'), kind: 'danger' }],
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { sources, pages } = await load(entries);
      if (!sources.length) return;
      s.sources.forEach((src) => pdf.close(src.docId));
      const single = entries.length === 1 && entries[0].path;
      dispatch({ type: 'open', sources, pages, file: single ? { path: entries[0].path, name: entries[0].name } : null });
      setTool('select');
      rememberRecent(sources);
      const certified = editPolicy(sources);
      if (certified.notice) notify(certified.notice);
      else if (sources.length > 1) notify(t('core.open.merged', { count: sources.length }));
    } finally {
      setBusy(false);
    }
  }

  async function addEntries(entries, at) {
    if (!entries?.length) return;
    if (!stateRef.current.pages.length) return openEntries(entries);
    if (!policyRef.current.pages) { notify(policyRef.current.notice, 'error'); return; }
    setBusy(true);
    try {
      const loaded = await load(entries);
      // Un PDF protegido que no permite combinar páginas no se puede añadir a otro.
      const locked = loaded.sources.filter((src) => !editPolicy([src]).pages);
      locked.forEach((src) => pdf.close(src.docId));
      if (locked.length) notify(t('core.add.locked', { names: locked.map((x) => `«${x.name}»`).join(', ') }), 'error');
      const sources = loaded.sources.filter((src) => !locked.includes(src));
      const pages = loaded.pages.filter((p) => sources.some((src) => src.docId === p.docId));
      if (!pages.length) return;
      dispatch({ type: 'add', sources, pages, at });
      rememberRecent(sources);
      notify(t('core.add.done', { count: pages.length }));
    } finally {
      setBusy(false);
    }
  }

  // --- Archivos recientes (la lista la guarda el proceso principal) -------------------
  const [recents, setRecents] = useState([]);
  useEffect(() => {
    Promise.resolve().then(() => desktop.recents?.()).then((l) => setRecents(l ?? [])).catch(() => {});
    return desktop.onRecents?.((l) => setRecents(l ?? [])) ?? undefined;
  }, []);

  /** Apunta en recientes los PDF con ruta (abiertos o guardados). Nunca molesta si falla. */
  function rememberRecent(list) {
    for (const src of list) if (src.path) Promise.resolve().then(() => desktop.addRecent?.(src.path)).catch(() => {});
  }

  async function openRecent(filePath) {
    let r;
    try { r = await desktop.openRecent(filePath); } catch (e) { notify(t('core.recent.failed', { error: e.message }), 'error'); return; }
    if (r?.missing) { notify(t('core.recent.missing', { name: r.name }), 'error'); return; }
    await openEntries(r.entries);
  }

  async function dropFiles(fileList, at) {
    const files = [...fileList].filter(isPdf);
    if (!files.length) { if (fileList.length) notify(t('core.add.onlyPdf'), 'error'); return; }
    const entries = await Promise.all(files.map(fileToEntry));
    return stateRef.current.pages.length ? addEntries(entries, at) : openEntries(entries);
  }

  // --- Elementos encima de zonas a redactar ------------------------------------
  /** Conflictos de una lista de páginas: [{ page, kind, id }] (pide los textos solo si hay textos editados). */
  async function findConflicts(pages) {
    const out = [];
    for (const p of pages) {
      if (!p.annots.some((a) => a.type === 'redact')) continue;
      const runs = Object.keys(p.textEdits ?? {}).length ? await pdf.textRuns(p.docId, p.index).catch(() => []) : [];
      for (const c of redactConflicts(p, runs)) out.push({ page: p, ...c });
    }
    return out;
  }

  // Marcar los elementos en conflicto y avisar cuando aparece uno nuevo (al colocarlo o moverlo encima).
  useEffect(() => {
    let alive = true;
    findConflicts(state.pages).then((list) => {
      if (!alive) return;
      const map = new Map();
      const now = new Set();
      let fresh = null;
      for (const c of list) {
        if (!map.has(c.page.key)) map.set(c.page.key, { annots: new Set(), texts: new Set() });
        map.get(c.page.key)[c.kind === 'text' ? 'texts' : 'annots'].add(c.id);
        const id = `${c.page.key}:${c.kind}:${c.id}`;
        now.add(id);
        if (!seenConflicts.current.has(id)) fresh ??= c;
      }
      seenConflicts.current = now;
      setConflicts(map);
      if (fresh) notify(conflictMessage(fresh.kind), 'error');
    });
    return () => { alive = false; };
  }, [state.pages]);

  // --- Guardar ---------------------------------------------------------------
  async function save({ asNew = false, extract = false } = {}) {
    const s = stateRef.current;
    const list = extract ? s.pages.filter((p) => s.selected.has(p.key)) : s.pages;
    if (!list.length) {
      notify(extract ? t('core.save.selectFirst') : t('core.save.noPages'), 'error');
      return;
    }
    // Con redacciones nunca se escribe sobre el original: siempre se pregunta dónde (ver src/savePlan.js).
    // Un PDF firmado digitalmente tampoco se sobrescribe sin confirmarlo.
    const plan = planSave({ file: s.file, sources: s.sources, pages: list, asNew, extract, dirty: s.dirty, outDir: prefsRef.current.outputDir });
    if (plan.skip) { notify(t('core.save.nothing')); return; }
    const zones = list.reduce((n, p) => n + p.annots.filter((a) => a.type === 'redact').length, 0);
    if (zones) {
      const over = (await findConflicts(list)).length;
      const extra = over ? `\n\n${t('core.redact.overlap', { count: over })}` : '';
      const ok = await ask({
        title: t('core.redact.title'),
        message: t('core.redact.message', { count: zones }) + extra,
        actions: [{ id: 'go', label: t('core.redact.go'), kind: 'danger' }],
      });
      if (!ok) return;
    }
    // PDF firmado: si los cambios lo permiten se guarda como revisión incremental (la firma sigue valiendo);
    // si hay que reescribir el archivo, la firma se rompe y se explica por qué.
    const signedSrc = s.sources.find((src) => src.signed > 0 && list.some((p) => p.docId === src.docId));
    const inc = signedSrc ? incrementalPlan(list, signedSrc, { security: !!s.security }) : null;
    const rewriteWhy = inc && !inc.incremental
      ? `${signedWarning()}\n\n${t('core.signed.rewriteWhy', { reason: reasonText(inc.reasons) })}`
      : signedWarning();
    let target = plan.path;
    let defaultPath = plan.defaultPath;
    let overwriteOk = false;
    if (plan.confirmSigned) {
      const choice = await ask(inc?.incremental ? {
        title: t('core.signed.incTitle'),
        message: t('core.signed.incMessage'),
        icon: 'signed',
        actions: [{ id: 'over', label: t('core.common.save'), kind: 'primary' }, { id: 'copy', label: t('core.common.saveAs'), kind: 'ghost' }],
      } : {
        title: t('core.signed.overTitle'),
        message: `${rewriteWhy}\n\n${t('core.signed.overAdvice')}`,
        icon: 'signed',
        actions: [{ id: 'copy', label: t('core.common.saveAs'), kind: 'primary' }, { id: 'over', label: t('core.signed.overwrite'), kind: 'danger' }],
      });
      if (!choice) return;
      if (choice === 'copy') { target = null; defaultPath = plan.copyPath; } else overwriteOk = true;
    }
    target ??= await desktop.chooseSavePath({ defaultPath });
    if (!target) return;
    // Si en «Guardar como» se elige un original (redactado, o firmado y sin poder guardar en incremental), confirmación aparte.
    const overRedacted = plan.redacted && replacesOriginal(plan, target);
    const overSigned = !overwriteOk && !inc?.incremental && replacesSigned(plan, target);
    if (overRedacted || overSigned) {
      const ok = await ask({
        title: t('core.replace.title'),
        message: [overRedacted && replaceOriginalWarning(), overSigned && rewriteWhy].filter(Boolean).join('\n\n'),
        icon: overSigned && !overRedacted ? 'signed' : 'alert',
        actions: [{ id: 'replace', label: t('core.replace.go'), kind: 'danger' }],
      });
      if (!ok) return;
    }

    setBusy(true);
    try {
      setTask({ kind: extract ? 'extract' : 'save', done: 0, total: list.length });
      const security = s.security?.kind === 'set' ? { token: s.security.token } : s.security?.kind === 'remove' ? { remove: true } : undefined;
      const { bytes, warnings, incremental } = await pdf.compose(list, (p) => setTask((t) => (t ? { ...t, ...p } : t)), { security, outline: s.outline });
      setTask((t) => (t ? { ...t, done: t.total, writing: true } : t));
      const res = await desktop.savePdf({ bytes, path: target, suggestedName: target.split(/[\\/]/).pop() });
      if (!res) return;
      if (res.path) rememberRecent([{ path: res.path }]);
      // La ventana pasa a trabajar con lo guardado: el estado de las firmas es el del archivo nuevo.
      if (signedSrc && !extract && !plan.redacted) verifySource(signedSrc.docId, bytes);
      if (plan.redacted && !extract) {
        // La ventana pasa a trabajar con la copia redactada (lo guardado), no con el original.
        // Si está protegido, el worker lo abre con las contraseñas que ya conoce (no se vuelven a pedir).
        const known = { docIds: s.sources.map((x) => x.docId), token: s.security?.token };
        const { sources, pages } = await load([{ name: res.name, path: res.path, bytes, known }]);
        if (sources.length) {
          s.sources.forEach((src) => pdf.close(src.docId));
          dispatch({ type: 'open', sources, pages, file: { path: res.path, name: res.name } });
          setTool('select');
        }
      } else if (!extract) dispatch({ type: 'saved', file: res });
      const done = extract
        ? t('core.save.extracted', { name: res.name, count: list.length })
        : plan.redacted ? t('core.save.redacted', { name: res.name })
          : incremental ? t('core.save.incremental', { name: res.name }) : t('core.save.done', { name: res.name });
      if (warnings?.length) notify(t('core.save.withWarnings', { done, warnings: warnings.join(' ') }), 'error');
      else notify(done);
    } catch (e) {
      notify(t('core.save.failed', { error: e.message }), 'error');
    } finally {
      setTask(null);
      setBusy(false);
    }
  }

  // --- Nuevo documento (Ctrl+N) --------------------------------------------------------
  // Páginas en blanco que no vienen de ningún PDF; al guardar, compose() parte de un documento vacío.
  const [newOpen, setNewOpen] = useState(false);
  async function createDocument(opts) {
    setNewOpen(false);
    const s = stateRef.current;
    if (s.dirty && s.pages.length) {
      const ok = await ask({
        title: t('core.unsaved.title'),
        message: t('core.unsaved.newMessage'),
        actions: [{ id: 'new', label: t('core.unsaved.newAnyway'), kind: 'danger' }],
      });
      if (!ok) return;
    }
    s.sources.forEach((src) => pdf.close(src.docId));
    const pages = newDocumentPages(opts);
    dispatch({ type: 'open', sources: [], pages, file: null });
    dispatch({ type: 'mode', mode: 'read' });
    setTool('select');
    notify(t('core.new.done', { count: pages.length }));
  }

  // --- OCR: reconocer texto en páginas escaneadas ------------------------------------------
  // Al abrir, el worker mira qué páginas son solo imagen (scanned: docId → Set de índices) y se ofrece reconocerlas.
  // Cada página: render a 300 ppp en gris → enderezar si está torcida o girada → Tesseract (su propio worker, con
  // los idiomas de la app) → capa de texto en page.ocr (se deshace como el resto; se escribe al guardar).
  const [scanned, setScanned] = useState(() => new Map());
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrHidden, setOcrHidden] = useState(false); // el aviso de páginas escaneadas, cerrado a mano
  const ocrJob = useRef(null);
  useEffect(() => {
    let alive = true;
    for (const src of state.sources) {
      if (scanned.has(src.docId)) continue;
      setScanned((m) => new Map(m).set(src.docId, new Set()));
      pdf.imageOnlyPages(src.docId).then((list) => alive && setScanned((m) => new Map(m).set(src.docId, new Set(list))));
    }
    return () => { alive = false; };
  }, [state.sources]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setOcrHidden(false), [state.file, state.sources.length]);
  const isScanned = (p) => p.docId != null && !!scanned.get(p.docId)?.has(p.index);
  const ocrPending = state.pages.filter((p) => isScanned(p) && !p.ocr?.length);
  const ocrTargets = state.pages.filter((p) => p.docId != null);

  async function runOcr({ scope, langs }) {
    setOcrOpen(false);
    const list = (scope === 'scanned' ? ocrPending : ocrTargets).map((p) => p.key);
    if (!list.length) return;
    const job = { id: Date.now(), cancelled: false };
    ocrJob.current = job;
    setBusy(true);
    setTask({ kind: 'ocr', done: 0, total: list.length, loading: true, cancel: () => { job.cancelled = true; setTask((t) => (t ? { ...t, cancelling: true } : t)); } });
    let recognizer = null;
    let done = 0;
    let found = 0;
    try {
      const { createRecognizer } = await import('./ocr/service.js');
      recognizer = await createRecognizer(langs);
      setTask((t) => (t ? { ...t, loading: false } : t));
      for (const key of list) {
        if (job.cancelled) break;
        const page = stateRef.current.pages.find((p) => p.key === key);
        if (!page) { done++; continue; } // se eliminó mientras tanto
        const gray = await pdf.ocrGray(page.docId, page.index, OCR_DPI);
        const res = await ocrPage(gray, { dpi: gray.dpi, R: page.rot0, recognize: recognizer.recognize, isCancelled: () => job.cancelled });
        let words = res.words;
        if (!isScanned(page)) {
          // Página con texto («todo el documento»): no se duplica lo que ya se podía buscar.
          const c = await pdf.textChars(page.docId, page.index);
          const odd = page.rot0 % 2 === 1;
          words = dropCovered(words, c.boxes, odd ? page.height : page.width, odd ? page.width : page.height);
        }
        if (words.length) { dispatch({ type: 'setOcr', key, words, job: job.id }); found++; }
        done++;
        setTask((t) => (t ? { ...t, done } : t));
      }
      if (job.cancelled) notify(done ? t('core.ocr.cancelledKept', { done, total: list.length }) : t('core.ocr.cancelled'));
      else if (!found) notify(t('core.ocr.nothing'), 'error');
      else notify(t('core.ocr.done', { count: found }));
    } catch (e) {
      if (!e?.cancelled) notify(t('core.ocr.failed', { error: e?.message ?? e }), 'error');
      else notify(t('core.ocr.cancelled'));
    } finally {
      recognizer?.terminate();
      ocrJob.current = null;
      setTask(null);
      setBusy(false);
      // Pedido desde «Exportar a Word»: se vuelve a él con el texto ya reconocido.
      const back = afterOcr.current;
      afterOcr.current = null;
      if (back && !job.cancelled) setExportKind(back);
    }
  }

  // --- Contraseñas ------------------------------------------------------------------
  // El PDF base (el que más páginas aporta) decide la protección del resultado, como en compose().
  const [protectOpen, setProtectOpen] = useState(false);
  function baseSource(s = stateRef.current) {
    const counts = new Map();
    for (const p of s.pages) if (p.docId != null) counts.set(p.docId, (counts.get(p.docId) ?? 0) + 1);
    const id = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    return s.sources.find((src) => src.docId === id) ?? null;
  }
  /** ¿Quedará protegido al guardar? */
  function willBeProtected(s = stateRef.current) {
    if (s.security?.kind === 'set') return true;
    if (s.security?.kind === 'remove') return false;
    return !!baseSource(s)?.security?.encrypted;
  }

  /** Pide la contraseña de permisos de los PDF que tienen restricciones. → true si ya no queda ninguno con ellas. */
  async function unlockPermissions() {
    const locked = stateRef.current.sources.filter((src) => src.security?.encrypted && !src.security.owner && !allAllowed(src.security.perms));
    for (const src of locked) {
      const sec = await askPassword({
        title: t('core.unlock.title'),
        name: `${src.name}.pdf`,
        message: t('core.unlock.message'),
        label: t('core.unlock.label'),
        submitLabel: t('core.unlock.submit'),
        attempt: (pw) => pdf.unlockOwner(src.docId, pw).then((r) => (r.unlocked ? { value: r } : { error: t('core.unlock.wrong') })),
      });
      if (!sec) return false;
      const { unlocked, ...security } = sec;
      dispatch({ type: 'sourceSecurity', docId: src.docId, security });
    }
    if (locked.length) notify(locked.length === 1 ? t('core.unlock.doneOne') : t('core.unlock.doneMany'));
    return true;
  }

  /** Cambiar o quitar la protección del base exige su contraseña de permisos (salvo que la de abrir ya lo permita todo). */
  async function ensureCanChange() {
    const base = baseSource();
    if (canChangeSecurity(base?.security)) return true;
    return unlockPermissions();
  }

  async function protect(opts) {
    setProtectOpen(false);
    const old = stateRef.current.security?.token;
    const token = await pdf.setProtection(opts);
    if (old) pdf.dropProtection(old);
    dispatch({ type: 'setSecurity', security: { kind: 'set', token, perms: opts.perms, separateOwner: opts.separateOwner } });
    notify(t('core.protect.set'));
  }

  async function unprotect() {
    const s = stateRef.current;
    if (!willBeProtected(s)) return;
    if (!(await ensureCanChange())) return;
    if (s.security?.token) pdf.dropProtection(s.security.token);
    const baseEncrypted = !!baseSource(s)?.security?.encrypted;
    dispatch({ type: 'setSecurity', security: baseEncrypted ? { kind: 'remove' } : null });
    notify(baseEncrypted ? t('core.protect.removeOnSave') : t('core.protect.notAnymore'));
  }

  // --- Compartir ------------------------------------------------------------------
  // La copia se prepara (compose, o el archivo tal cual si no hay cambios) en la carpeta temporal del proceso
  // principal, que se borra al cerrar; se reutiliza mientras no cambien el documento ni las opciones.
  const [shareOpen, setShareOpen] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  prefsRef.current = prefs;
  // Idioma (Preferencias → Idioma, o el del sistema): la interfaz ya lo tiene desde main.jsx; aquí se aplica al
  // cambiarlo y se avisa al motor (sus errores y avisos) y al proceso principal (diálogos nativos, menú de macOS).
  const lang = resolveLang(prefs.lang, systemLanguages());
  useEffect(() => {
    setLang(lang, systemLanguages());
    pdf.setLang(lang, systemLanguages()).catch(() => {});
    desktop.setLang?.(lang);
  }, [lang]);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const prepared = useRef(null); // { key, pages, id }

  async function shareTo(target, opts) {
    const s = stateRef.current;
    const plan = sharePlan(s, opts, { protectedNow: willBeProtected(s) });
    if (!plan.pages.length) return { ok: false, text: t('core.share.noPages') };
    const key = JSON.stringify([opts.name, opts.scope, opts.hidden, [...s.selected]]);
    let id = prepared.current?.key === key && prepared.current.pages === s.pages && prepared.current.outline === s.outline && prepared.current.security === s.security ? prepared.current.id : null;
    if (!id) {
      let res;
      if (plan.original) {
        res = await desktop.sharePrepare({ from: s.file.path, name: opts.name });
      } else {
        const security = s.security?.kind === 'set' ? { token: s.security.token } : s.security?.kind === 'remove' ? { remove: true } : undefined;
        const { bytes } = await pdf.compose(plan.pages, null, { security, hidden: opts.hidden, outline: s.outline });
        res = await desktop.sharePrepare({ bytes, name: opts.name });
      }
      id = res.id;
      prepared.current = { key, pages: s.pages, outline: s.outline, security: s.security, id };
    }
    const call = { whatsapp: desktop.shareWhatsApp, ai: desktop.shareAi, mail: desktop.shareMail, copy: desktop.shareCopyFile, reveal: desktop.shareReveal }[target];
    if (typeof call !== 'function') return { ok: false, text: t('core.share.outdated') };
    const arg = target === 'mail' ? opts.name.replace(/\.pdf$/i, '') : target === 'ai' ? prefs.ai : undefined;
    const r = await call(id, arg);
    return shareResult(target, r);
  }

  // --- Reducir tamaño --------------------------------------------------------------
  // El diálogo calcula de verdad cada nivel (worker: compose → imágenes → qpdf) y muestra «antes → después»;
  // «Guardar copia…» escribe esos mismos bytes. Antes = el archivo en disco si no hay cambios; si no, lo compuesto.
  const [reduceOpen, setReduceOpen] = useState(false);
  const securityArg = (s) => (s.security?.kind === 'set' ? { token: s.security.token } : s.security?.kind === 'remove' ? { remove: true } : undefined);
  function reduceNotices(s) {
    const out = [];
    if (hasRedactions(s.pages)) out.push({ tone: 'danger', text: t('core.reduce.noticeRedact') });
    if (signedSources(s).length) out.push({ tone: 'danger', text: t('core.reduce.noticeSigned') });
    if (willBeProtected(s)) out.push({ tone: 'info', text: t('core.reduce.noticePassword') });
    return out;
  }
  async function saveReduced(bytes) {
    const s = stateRef.current;
    const original = s.file?.path ?? s.sources.find((x) => x.path)?.path ?? null;
    const base = (s.file?.name ?? s.sources[0]?.name ?? 'documento').replace(/\.pdf$/i, '');
    const target = await desktop.chooseSavePath({ defaultPath: joinPath(outputFolder(prefsRef.current, dirOf(original)), t('core.reduce.fileName', { base })) });
    if (!target) return;
    if (s.sources.some((x) => x.path && samePath(x.path, target))) {
      const ok = await ask({
        title: t('core.replace.title'),
        message: t('core.reduce.replaceMessage'),
        actions: [{ id: 'replace', label: t('core.replace.go'), kind: 'danger' }],
      });
      if (!ok) return;
    }
    setReduceOpen(false);
    const res = await desktop.savePdf({ bytes, path: target, suggestedName: target.split(/[\\/]/).pop() });
    if (!res) return;
    if (res.path) rememberRecent([{ path: res.path }]);
    const before = !s.dirty && s.file && s.sources.length === 1 ? s.sources[0].size : null;
    notify(before ? t('core.reduce.savedChange', { name: res.name, change: sizeChange(before, bytes.length) }) : t('core.reduce.saved', { name: res.name }));
  }

  // --- Imprimir -------------------------------------------------------------------
  // Ctrl+P abre el diálogo propio (PrintDialog). Al imprimir: cada página, tal como está (giros, notas, firmas,
  // campos, texto editado; las redacciones pendientes en negro), se renderiza a 300 ppp en JPEG y se manda al
  // proceso principal con su caja en la hoja (sheetLayout); allí se imprime por lotes. Las páginas sin cambios
  // se renderizan directamente de su PDF; si alguna tiene cambios, se compone antes (como al guardar).
  const [printOpen, setPrintOpen] = useState(false);

  async function runPrint(o) {
    setPrintOpen(false);
    const list = o.pages;
    if (!list.length) return;
    const paper = PAPERS[o.paper];
    setBusy(true);
    setTask({ kind: 'print', done: 0, total: list.length });
    let tmpDoc = null;
    let job = null;
    const off = desktop.onPrintProgress?.((p) => setTask((t) => (t ? { ...t, phase: 'send', done: p.done, total: p.total } : t)));
    try {
      const edited = list.some((p) => p.docId == null || p.annots.length || Object.keys(p.fields ?? {}).length || Object.keys(p.textEdits ?? {}).length);
      let sources; // [{ docId, index, rot, w, h }] página a renderizar y su tamaño en pantalla
      if (edited) {
        const { bytes } = await pdf.compose(list);
        const opened = await pdf.open(bytes, '', { docIds: stateRef.current.sources.map((x) => x.docId) });
        tmpDoc = opened.docId;
        sources = opened.pages.map((p, index) => ({ docId: tmpDoc, index, rot: 0, w: p.width, h: p.height }));
      } else {
        sources = list.map((p) => { const d = displaySize(p); return { docId: p.docId, index: p.index, rot: p.rot, w: d.w, h: d.h }; });
      }
      job = await desktop.printBegin({
        title: stateRef.current.file?.name ?? 'Documento', paper: { w: paper.w, h: paper.h, size: paper.electron },
        deviceName: o.deviceName, copies: o.copies, color: o.color, duplex: o.duplex, system: o.system, batch: PRINT_BATCH,
      });
      for (const [i, s] of sources.entries()) {
        const jpg = await pdf.renderJpeg(s.docId, s.index, printScale(s.w, s.h), s.rot, !o.color);
        await desktop.printPage(job, { jpg, box: sheetLayout(s.w, s.h, paper, { fit: o.fit, autoRotate: o.autoRotate }) });
        setTask((t) => (t ? { ...t, done: i + 1 } : t));
      }
      setTask((t) => (t ? { ...t, phase: 'send', done: 0, total: 0 } : t));
      const r = await desktop.printRun(job);
      job = null;
      if (r?.ok) notify(t('core.print.sent', { count: list.length }));
      else if (!r?.cancelled && r?.error) notify(t('core.print.failed', { error: r.error }), 'error');
    } catch (e) {
      notify(t('core.print.failed', { error: e.message }), 'error');
    } finally {
      off?.();
      if (job) desktop.printCancel?.(job);
      if (tmpDoc) pdf.close(tmpDoc);
      setTask(null);
      setBusy(false);
    }
  }

  // --- Insertar imágenes como páginas ------------------------------------------
  /** Elegir imágenes con el selector del sistema (también vale en Electron: input de archivo). */
  function pickImages() {
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg', multiple: true });
      input.onchange = () => resolve([...input.files]);
      input.click();
    });
  }

  async function insertImages(files) {
    if (!files?.length) return;
    const ok = files.filter((f) => /^image\/(png|jpeg)$/.test(f.type) || /\.(png|jpe?g)$/i.test(f.name));
    if (ok.length < files.length) notify(t('core.insert.onlyImages'), 'error');
    const pages = [];
    for (const f of ok) {
      try {
        const bmp = await createImageBitmap(f);
        pages.push(imagePage({ blob: f, pxW: bmp.width, pxH: bmp.height, name: f.name }));
        bmp.close();
      } catch {
        notify(t('core.insert.unreadable', { name: f.name }), 'error');
      }
    }
    if (!pages.length) return;
    act({ type: 'add', pages, sources: [], at: insertIndex(stateRef.current) });
    notify(t('core.insert.done', { count: pages.length }));
  }

  // --- Comandos (menú, barra de herramientas y teclado) -----------------------
  function run(cmd, arg) {
    const s = stateRef.current;
    if (busyRef.current && BLOCKED_WHILE_BUSY.has(cmd)) return;
    const zoomStep = (dir) => {
      const next = dir > 0 ? ZOOM_STEPS.find((z) => z > s.zoom + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < s.zoom - 0.001);
      if (next) dispatch({ type: 'zoom', zoom: next });
    };
    switch (cmd) {
      case 'open': desktop.openPdfs().then(openEntries); break;
      case 'add':
        if (!policyRef.current.pages) { notify(policyRef.current.notice, 'error'); break; }
        desktop.openPdfs().then((e) => addEntries(e));
        break;
      case 'share': if (s.pages.length) setShareOpen(true); break;
      case 'reduce':
        if (!s.pages.length) break;
        if (!policyRef.current.content) { notify(policyRef.current.notice, 'error'); break; }
        setReduceOpen(true);
        break;
      case 'exportExcel':
      case 'exportWord':
        if (!s.pages.length) break;
        if (!policyRef.current.copy) { notify(policyRef.current.notice, 'error'); break; }
        setExportKind(cmd === 'exportWord' ? 'word' : 'excel');
        break;
      case 'prefs': setPrefsOpen(true); break;
      case 'protect':
        if (!s.pages.length) break;
        ensureCanChange().then((ok) => ok && setProtectOpen(true));
        break;
      case 'unprotect': unprotect(); break;
      case 'unlock': unlockPermissions(); break;
      case 'save': save(); break;
      case 'saveAs': save({ asNew: true }); break;
      case 'extract':
        // Extraer de un PDF certificado crea una copia con la certificación rota: no se permite.
        if (!policyRef.current.pages) { notify(policyRef.current.notice, 'error'); break; }
        save({ extract: true });
        break;
      case 'new': setNewOpen(true); break;
      case 'ocr': if (ocrTargets.length) setOcrOpen(true); break;
      case 'print':
        if (!s.pages.length) break;
        if (!policyRef.current.print) { notify(policyRef.current.notice, 'error'); break; }
        setPrintOpen(true);
        break;
      case 'openRecent': if (typeof arg === 'string') openRecent(arg); break;
      case 'clearRecents':
        Promise.resolve().then(() => desktop.clearRecents?.()).then(() => notify(t('core.recent.cleared'))).catch(() => {});
        break;
      case 'duplicate':
        if (s.annotSel) act({ type: 'duplicateAnnot', key: s.annotSel.key, id: s.annotSel.id });
        break;
      case 'insertBlank': {
        const page = blankPage(blankSize(referencePage(s)));
        act({ type: 'add', pages: [page], sources: [], at: insertIndex(s) });
        break;
      }
      case 'insertImage':
        if (!policyRef.current.pages) { notify(policyRef.current.notice, 'error'); break; }
        pickImages().then(insertImages);
        break;
      case 'undo': dispatch({ type: 'undo' }); break;
      case 'redo': dispatch({ type: 'redo' }); break;
      case 'selectAll': dispatch({ type: 'selectAll' }); break;
      case 'rotateLeft': act({ type: 'rotate', keys: targetKeys(s), delta: -1 }); break;
      case 'rotateRight': act({ type: 'rotate', keys: targetKeys(s), delta: 1 }); break;
      case 'delete': act({ type: 'delete', keys: targetKeys(s) }); break;
      case 'organize': dispatch({ type: 'mode', mode: 'organize' }); break;
      case 'read': if (s.pages.length) dispatch({ type: 'mode', mode: 'read' }); break;
      case 'zoomIn': if (s.mode === 'read') zoomStep(1); break;
      case 'zoomOut': if (s.mode === 'read') zoomStep(-1); break;
      case 'zoomFit': if (s.mode === 'read') readerRef.current?.fitWidth(); break;
      case 'copy': copySelection(); break;
      case 'find':
        if (!s.pages.length) break;
        if (s.mode !== 'read') dispatch({ type: 'mode', mode: 'read' });
        setSearchOpen(true);
        setTimeout(() => { searchInput.current?.focus(); searchInput.current?.select(); }, 0);
        break;
      default: break;
    }
  }
  const runRef = useRef(run);
  runRef.current = run;

  const openRef = useRef(openEntries);
  openRef.current = openEntries;

  // El menú nativo (macOS) manda un comando o { cmd, arg } (p. ej. abrir un reciente).
  useEffect(() => desktop.onMenu((m) => (typeof m === 'string' ? runRef.current(m) : runRef.current(m?.cmd, m?.arg))), []);
  // PDFs abiertos desde el sistema (doble clic, "Abrir con…", icono del Dock).
  useEffect(() => desktop.onFiles((entries) => openRef.current(entries)), []);
  useEffect(() => { desktop.pendingFiles().then((e) => openRef.current(e)); }, []);

  // --- Texto nuevo (cuadros de texto) ---------------------------------------------
  // El cuadro que se escribe: { key, id }. Uno a la vez, en cualquier página.
  const [editingBox, setEditingBox] = useState(null);
  const editingRef = useRef(null);
  editingRef.current = editingBox;

  // Bloques de texto ya leídos, por página: el cuadro se crea al instante (sin perder las primeras teclas).
  const runsKnown = useRef(new Map()); // "docId:index" → runs
  const runsFor = (page) => (page.docId == null ? Promise.resolve([]) : pdf.textRuns(page.docId, page.index)
    .then((r) => { runsKnown.current.set(`${page.docId}:${page.index}`, r); return r; })
    .catch(() => []));
  // Con «Texto nuevo» elegida, se leen ya los de la página actual y sus vecinas.
  useEffect(() => {
    if (tool !== 'textbox') return;
    const s = stateRef.current;
    for (const i of [s.current - 1, s.current, s.current + 1]) if (s.pages[i]) runsFor(s.pages[i]);
  }, [tool, state.current]);

  /**
   * Crea un cuadro donde se hizo clic (una línea, hasta el margen) o con el rectángulo arrastrado, con la
   * fuente, tamaño y color del texto del PDF más cercano, y empieza a escribir en él. Se crea en el acto;
   * si los bloques de texto de la página aún no habían llegado, el estilo se ajusta al llegar (mismo paso
   * de deshacer que lo que se escriba).
   */
  function createTextBox(page, d, click) {
    const R = pageTurn(page);
    const { h: Hd } = displaySize(page);
    const [u, v] = fromDisplay(click ? d.x : d.x + d.w / 2, click ? d.y : d.y + d.h / 2, R);
    const [pw, ph] = (page.rot0 ?? 0) % 2 ? [page.height, page.width] : [page.width, page.height];
    const build = (runs) => {
      const style = defaultStyle(nearestRun(runs, u, v, pw, ph));
      const lineH = (style.size * LINE_HEIGHT) / Hd;
      const disp = click
        ? { x: d.x, y: Math.max(0, d.y - lineH / 2), w: Math.max(0.12, Math.min(0.5, 0.97 - d.x)), h: lineH }
        : { ...d, h: Math.max(d.h, lineH) };
      if (disp.x + disp.w > 1) disp.w = 1 - disp.x;
      return { style, rect: rectFromDisplay(disp, R) };
    };
    const known = page.docId == null ? [] : runsKnown.current.get(`${page.docId}:${page.index}`);
    const id = newAnnotId();
    act({ type: 'addAnnot', key: page.key, annot: { id, type: 'textbox', k: R, text: '', ...build(known ?? []) } });
    setEditingBox({ key: page.key, id });
    if (!known) {
      runsFor(page).then((runs) => {
        if (!runs.length) return;
        act({ type: 'updateAnnot', key: page.key, id, changes: build(runs), group: true });
      });
    }
  }

  /**
   * Termina de escribir: un cuadro vacío se quita; si va con la fuente del PDF y le faltan letras, se usa la
   * incluida más parecida y se avisa. Todo lo escrito queda en un solo paso de deshacer.
   */
  async function finishTextBox(key, id) {
    if (editingRef.current?.key !== key || editingRef.current?.id !== id) return;
    setEditingBox(null);
    editingRef.current = null;
    const s = stateRef.current;
    const page = s.pages.find((p) => p.key === key);
    const a = page?.annots.find((x) => x.id === id);
    if (!a) return;
    if (!a.text.trim()) { dispatch({ type: 'removeAnnot', key, id }); dispatch({ type: 'endGroup' }); return; }
    await checkTextFont(page, a, true);
    dispatch({ type: 'endGroup' });
  }

  /** ¿Tiene la fuente del PDF todas las letras del cuadro? Marca fallback y avisa si no. */
  async function checkTextFont(page, a, group = false) {
    if (!a.style.usePdf || !a.style.pdf || page.docId == null || !a.text.trim()) {
      if (a.fallback) act({ type: 'updateAnnot', key: page.key, id: a.id, changes: { fallback: false }, group });
      return;
    }
    const { missing } = await pdf.checkGlyphs(page.docId, page.index, a.style.pdf.objIndex, a.text).catch(() => ({ missing: [] }));
    const fallback = missing.length > 0;
    if (fallback !== !!a.fallback) act({ type: 'updateAnnot', key: page.key, id: a.id, changes: { fallback }, group });
    if (fallback) {
      const letters = missing.slice(0, 5).map((c) => `«${c}»`).join(', ');
      notify(t('core.textbox.fallback', { font: a.style.pdf.name, letters, family: FAMILIES[a.style.family].label }));
    }
  }

  /** Cuadro de texto seleccionado (para la barra de formato). */
  const selBox = (() => {
    const sel = state.annotSel;
    if (!sel) return null;
    const page = state.pages.find((p) => p.key === sel.key);
    const a = page?.annots.find((x) => x.id === sel.id);
    return a?.type === 'textbox' ? { page, a } : null;
  })();

  function setBoxStyle(changes) {
    if (!selBox) return;
    const { page, a } = selBox;
    act({ type: 'updateAnnot', key: page.key, id: a.id, changes: { style: { ...a.style, ...changes } } });
  }

  function setBoxFont(value) {
    if (!selBox) return;
    const { page, a } = selBox;
    if (value === 'pdf') {
      const next = { ...a, style: { ...a.style, usePdf: true }, fallback: false };
      act({ type: 'updateAnnot', key: page.key, id: a.id, changes: { style: next.style, fallback: false } });
      checkTextFont(page, next);
    } else {
      act({ type: 'updateAnnot', key: page.key, id: a.id, changes: { style: { ...a.style, usePdf: false, family: value } } });
    }
  }

  // --- Firma: el modal entrega un PNG transparente; se centra en la página actual --------
  function placeSignature({ src, width, height }) {
    setSigOpen(false);
    const s = stateRef.current;
    const page = s.pages[s.current];
    if (!page) return;
    const R = ((page.rot0 ?? 0) + page.rot) % 4;
    const ds = displaySize(page);
    // 30 % del ancho de la página (o menos si la firma es muy alta), centrada.
    let w = 0.3;
    let h = (w * ds.w * height) / (ds.h * width);
    if (h > 0.4) { w *= 0.4 / h; h = 0.4; }
    const disp = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    act({ type: 'addAnnot', key: page.key, annot: { type: 'image', rect: rectFromDisplay(disp, R), k: R, src } });
    setTool('select');
    notify(t('core.signature.placed'));
  }

  // --- Buscar y copiar texto ------------------------------------------------------
  const search = useSearch(state.pages, searchOpen && state.mode === 'read' && state.pages.length > 0);
  const searchView = useMemo(() => {
    const byKey = new Map();
    for (const h of search.hits) {
      if (!byKey.has(h.key)) byKey.set(h.key, []);
      byKey.get(h.key).push(h);
    }
    return { byKey, currentHit: search.hits[search.current] ?? null, imagePages: search.imagePages };
  }, [search.hits, search.current, search.imagePages]);
  // Al cambiar de resultado, llevarlo a la vista.
  useEffect(() => {
    const hit = search.hits[search.current];
    if (hit) readerRef.current?.scrollToHit(hit);
  }, [search.current, search.hits.length > 0]);
  // La selección de texto se suelta al cambiar de herramienta, de vista o de páginas.
  useEffect(() => { setTextSel(null); }, [tool, state.mode, state.pages]);

  async function copySelection() {
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName)) { document.execCommand('copy'); return; }
    const sel = textSelRef.current;
    if (!sel || sel.a === sel.b) return;
    if (!policyRef.current.copy) { notify(policyRef.current.notice, 'error'); return; }
    const page = stateRef.current.pages.find((p) => p.key === sel.key);
    if (!page) return;
    const chars = await pdf.pageChars(page);
    const text = selectedText(chars.text, Math.min(sel.a, sel.b), Math.max(sel.a, sel.b));
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.cssText = 'position:fixed;top:-1000px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    notify(t('core.copy.done'));
  }

  // --- Menú -------------------------------------------------------------------
  const menu = useMemo(() => menuModel({ dev: import.meta.env.DEV, web: desktop.platform === 'web', recents }), [recents, getLang()]); // eslint-disable-line react-hooks/exhaustive-deps -- etiquetas en el idioma actual
  const hasTargetsNow = targetKeys(state).size > 0;
  const has = state.pages.length > 0;
  const idle = !busy;
  const enabled = {
    // Con una tarea en curso (abrir, guardar…) se desactiva lo que chocaría con ella (ver BLOCKED_WHILE_BUSY).
    open: idle, copy: !!textSel && textSel.a !== textSel.b, find: state.pages.length > 0,
    add: idle && has && policy.pages, insertBlank: idle && has && policy.pages, insertImage: idle && has && policy.pages, save: idle && has, saveAs: idle && has, extract: idle && state.selected.size > 0 && policy.pages,
    undo: idle && state.past.length > 0, redo: idle && state.future.length > 0, selectAll: idle && has, duplicate: !!state.annotSel,
    rotateLeft: idle && hasTargetsNow && policy.pages, rotateRight: idle && hasTargetsNow && policy.pages,
    delete: idle && hasTargetsNow && (policy.pages || !!state.annotSel),
    new: idle, ocr: idle && ocrTargets.length > 0 && policy.content, print: idle && has && policy.print,
    share: idle && has, exportExcel: idle && has && policy.copy, exportWord: idle && has && policy.copy, reduce: idle && has && policy.content, protect: idle && has, unprotect: idle && has && willBeProtected(state),
    unlock: idle && state.sources.some((src) => src.security?.encrypted && !src.security.owner && !allAllowed(src.security.perms)), openRecent: idle, clearRecents: true, none: false,
    organize: has, read: has, zoomIn: has && state.mode === 'read', zoomOut: has && state.mode === 'read', zoomFit: has && state.mode === 'read',
  };
  const isEnabled = (it) => !!it.role || (enabled[it.cmd] ?? true);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const isEnabledRef = useRef(isEnabled);
  isEnabledRef.current = isEnabled;
  const command = (it) => (it.role ? desktop.menuRole(it.role) : runRef.current(it.cmd, it.arg));

  // Teclado. En macOS los atajos con Cmd los gestiona el menú nativo; en el resto salen de menu.json.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [role="menubar"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return; // con un diálogo abierto no hay atajos globales
      const s = stateRef.current;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (s.annotSel) act({ type: 'removeAnnot', key: s.annotSel.key, id: s.annotSel.id });
        else runRef.current('delete');
        return;
      }
      if (e.key === 'Escape') {
        if (s.annotSel) dispatch({ type: 'selectAnnot' });
        else if (textSelRef.current) setTextSel(null);
        else if (toolRef.current !== 'select') setTool('select');
        else dispatch({ type: 'clearSelection' });
        return;
      }
      if (!customMenu) return;
      const it = findByKey(menu, e);
      if (!it) return;
      e.preventDefault();
      if (isEnabledRef.current(it)) command(it);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  // Evita que soltar un archivo fuera de las zonas previstas abra el PDF en la ventana.
  useEffect(() => {
    const block = (e) => e.preventDefault();
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => { window.removeEventListener('dragover', block); window.removeEventListener('drop', block); };
  }, []);

  // Título de ventana y aviso de cambios sin guardar al cerrar.
  const docName = state.file?.name ?? (state.pages.length ? t('core.app.untitled') : null);
  useEffect(() => {
    desktop.setTitle(docName ? `${state.dirty && desktop.platform !== 'darwin' ? '● ' : ''}${docName} – SpiderPDF` : 'SpiderPDF');
    desktop.setDirty(state.dirty);
  }, [docName, state.dirty]);

  const showOpening = useDelayed(task?.kind === 'open');
  const showSaving = useDelayed(task?.kind === 'save' || task?.kind === 'extract' || task?.kind === 'print' || task?.kind === 'ocr');
  const preparing = useDelayed(!engineReady);
  const savingLabel = task?.kind === 'save' ? t('core.task.saving') : task?.kind === 'extract' ? t('core.task.extracting') : null;
  const hasTargets = targetKeys(state).size > 0;
  const empty = !state.pages.length;
  const tools = useMemo(() => allowedTools(policy), [policy]);
  // Herramienta que la certificación del PDF no permite: de vuelta a Seleccionar.
  useEffect(() => { if (!tools.has(tool)) setTool('select'); }, [tools, tool]);
  const sigGroups = signedSources(state).map((src) => ({ name: src.name, sigs: sigReports.get(src.docId) ?? 'pending' }));

  return (
    <div className="flex h-full flex-col">
      {customMenu && (
        <TitleBar model={menu} title={docName} dirty={state.dirty} isEnabled={isEnabled} onCommand={command} />
      )}
      <Toolbar state={state} hasTargets={hasTargets} busy={busy} run={run} savingLabel={savingLabel} canPages={policy.pages} canExport={policy.copy} />
      {state.mode === 'read' && !empty && (
        <AnnotToolbar
          allowed={tools}
          lockedHint={policy.notice}
          tool={tool}
          onTool={(t) => { if (t === 'signature') setSigOpen(true); else setTool(t); }}
          colors={colors}
          onColor={(t, hex) => setColors((c) => ({ ...c, [t]: hex }))}
        >
          {selBox && (
            <TextFormatBar
              annot={selBox.a}
              onStyle={setBoxStyle}
              onFont={setBoxFont}
              onDuplicate={() => act({ type: 'duplicateAnnot', key: selBox.page.key, id: selBox.a.id })}
              onOrder={(to) => act({ type: 'reorderAnnot', key: selBox.page.key, id: selBox.a.id, to })}
            />
          )}
        </AnnotToolbar>
      )}
      {sigOpen && <SignatureDialog onPlace={placeSignature} onClose={() => setSigOpen(false)} />}
      {printOpen && <PrintDialog state={state} onCancel={() => setPrintOpen(false)} onPrint={runPrint} />}
      {newOpen && <NewDocumentDialog onCancel={() => setNewOpen(false)} onCreate={createDocument} />}
      {shareOpen && (
        <ShareDialog
          name={shareName(state.file?.name ?? null)}
          total={state.pages.length}
          selected={state.selected.size}
          notices={(o) => sharePlan(state, o, { protectedNow: willBeProtected(state) }).notices}
          aiName={AI_PROVIDERS[prefs.ai]}
          onShare={shareTo}
          onClose={() => setShareOpen(false)}
        />
      )}
      {reduceOpen && (
        <ReduceDialog
          initialLevel={prefs.quality}
          before={!state.dirty && state.file && state.sources.length === 1 ? state.sources[0].size : null}
          notices={reduceNotices(state)}
          run={(level, onProgress) => pdf.reduceJob(state.pages, { level, security: securityArg(state), docIds: state.sources.map((x) => x.docId), outline: state.outline }, onProgress)}
          onCancel={() => setReduceOpen(false)}
          onSave={saveReduced}
        />
      )}
      {prefsOpen && (
        <PreferencesDialog
          prefs={prefs}
          onCancel={() => setPrefsOpen(false)}
          onSave={(p) => {
            const saved = savePrefs(p);
            setLang(resolveLang(saved.lang, systemLanguages()), systemLanguages()); // ya en este pintado (el aviso, también)
            setPrefs(saved);
            setPrefsOpen(false);
            notify(t('core.prefs.saved'));
          }}
        />
      )}
      {protectOpen && (
        <ProtectDialog
          initial={state.security?.kind === 'set' ? choicesFrom(state.security.perms) : undefined}
          onCancel={() => setProtectOpen(false)}
          onProtect={protect}
        />
      )}
      {pwDialog && (
        <PasswordDialog
          title={pwDialog.title}
          name={pwDialog.name}
          message={pwDialog.message}
          label={pwDialog.label}
          submitLabel={pwDialog.submitLabel}
          onCancel={() => { setPwDialog(null); pwDialog.resolve(null); }}
          onSubmit={async (pw) => {
            let r;
            try { r = await pwDialog.attempt(pw); } catch (e) { setPwDialog(null); pwDialog.resolve(null); notify(e.message, 'error'); return null; }
            if (r.error) return r.error;
            setPwDialog(null);
            pwDialog.resolve(r.value);
            return null;
          }}
        />
      )}
      {exportKind === 'word' && (
        <WordDialog
          pages={state.pages}
          scannedPending={ocrPending.length}
          onCancel={() => setExportKind(null)}
          onOcr={() => { setExportKind(null); afterOcr.current = 'word'; setOcrOpen(true); }}
          onExport={async ({ layout, images, pageBreaks }) => {
            if (typeof desktop.exportSave !== 'function') throw new Error(t('core.app.restart'));
            const s = stateRef.current;
            const base = (s.file?.name ?? s.sources[0]?.name ?? 'documento').replace(/.pdf$/i, '');
            const [docx, { buildDocx }] = await Promise.all([import('docx'), import('./export/docx.js')]);
            const bytes = await buildDocx(docx, layout, { title: base, images, pageBreaks, author: prefsRef.current.userName });
            const from = s.file?.path ?? s.sources.find((x) => x.path)?.path;
            const saved = await desktop.exportSave({ bytes, kind: 'docx', defaultPath: joinPath(outputFolder(prefsRef.current, dirOf(from)), `${base}.docx`) });
            if (saved) exported(saved, t('core.export.openWord'));
            return saved;
          }}
        />
      )}
      {exportKind === 'excel' && (
        <ExcelDialog
          pages={state.pages}
          onCancel={() => setExportKind(null)}
          onExport={async ({ tables, mode }) => {
            if (typeof desktop.exportSave !== 'function') throw new Error(t('core.app.restart'));
            const s = stateRef.current;
            const base = (s.file?.name ?? s.sources[0]?.name ?? 'documento').replace(/.pdf$/i, '');
            const { default: ExcelJS } = await import('exceljs');
            const { buildXlsx } = await import('./export/xlsx.js');
            const bytes = await buildXlsx(ExcelJS, tables, { mode, title: base, author: prefsRef.current.userName });
            const from = s.file?.path ?? s.sources.find((x) => x.path)?.path;
            const saved = await desktop.exportSave({ bytes, kind: 'xlsx', defaultPath: joinPath(outputFolder(prefsRef.current, dirOf(from)), `${base}.xlsx`) });
            if (saved) exported(saved, t('core.export.openExcel'));
            return saved;
          }}
        />
      )}
      {tocDialog && (
        <TocDialog
          pages={state.pages}
          tocPages={tocDialog.tocPages}
          initial={tocDialog.initial ?? null}
          onCancel={() => setTocDialog(null)}
          onCreate={(tree) => {
            const editing = !!tocDialog.initial;
            setTocDialog(null);
            const count = (nodes) => nodes.reduce((k, x) => k + 1 + count(x.children), 0);
            act({ type: 'setOutline', outline: tree });
            notify(editing ? t('core.toc.updated') : t('core.toc.created', { count: count(tree) }));
          }}
        />
      )}
      {ocrOpen && <OcrDialog scanned={ocrPending.length} total={ocrTargets.length} onCancel={() => { afterOcr.current = null; setOcrOpen(false); }} onRun={runOcr} />}
      {!empty && ocrPending.length > 0 && !ocrHidden && !busy && policy.content && (
        <OcrBanner count={ocrPending.length} onRun={() => run('ocr')} onClose={() => setOcrHidden(true)} />
      )}
      {dialog && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          icon={dialog.icon}
          actions={dialog.actions}
          onClose={(id) => { setDialog(null); dialog.resolve(id); }}
        />
      )}

      <main className="relative min-h-0 flex-1">
        {empty ? (
          <EmptyState
            busy={busy}
            preparing={preparing}
            fileOver={fileOver}
            onOpen={() => run('open')}
            onNew={() => run('new')}
            onDragOver={(e) => { e.preventDefault(); setFileOver(true); }}
            onDragLeave={() => setFileOver(false)}
            onDrop={(e) => { e.preventDefault(); setFileOver(false); dropFiles(e.dataTransfer.files); }}
          />
        ) : state.mode === 'organize' ? (
          <ErrorBoundary name={t('core.toolbar.organize')} resetKey={state.mode}>
          <OrganizeView
            state={state}
            dispatch={act}
            canPages={policy.pages}
            onAdd={() => run('add')}
            onDropFiles={dropFiles}
            onOpenPage={(i) => { dispatch({ type: 'current', index: i }); dispatch({ type: 'mode', mode: 'read' }); }}
          />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary name={t('core.toolbar.read')} resetKey={state.mode}>
            <ReaderView
              ref={readerRef} state={state} dispatch={act} tool={tool} colors={colors} conflicts={conflicts} policy={policy}
              textSel={textSel} onTextSel={setTextSel}
              search={searchOpen ? searchView : null}
              textBoxes={{
                editingBox,
                onEditBox: (key, id) => setEditingBox({ key, id }),
                onDoneBox: finishTextBox,
                onCreateTextBox: createTextBox,
              }}
              onLink={followLink}
              outlineProps={{
                custom: state.outline,
                canEdit: policy.pages,
                editWhy: policy.notice,
                onCreateToc: (tocPages) => setTocDialog({ tocPages }),
                onEditToc: () => setTocDialog({ tocPages: [], initial: state.outline }),
              }}
            />
          </ErrorBoundary>
        )}

        {searchOpen && state.mode === 'read' && !empty && (
          <SearchBar search={search} total={state.pages.length} inputRef={searchInput} onClose={() => setSearchOpen(false)} />
        )}

        {showOpening && <OpeningCard task={task} onCancel={() => cancelOpen.current?.()} />}

        {toast && (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`motion-pop absolute bottom-5 left-1/2 flex max-w-[560px] -translate-x-1/2 items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-pop ${toast.kind === 'error' ? 'border-danger/30 bg-danger-soft text-danger-ink' : 'border-line bg-panel text-ink'}`}
          >
            {toast.kind === 'error'
              ? <CircleAlert size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
              : <CircleCheck size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />}
            <span>{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => { const a = toast.action; setToast(null); a.run(); }}
                className="-my-1 -mr-1.5 h-8 shrink-0 rounded-lg px-2.5 font-medium text-accent-ink transition-[background-color,scale] hover:bg-accent-soft active:scale-[0.98]"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </main>

      <StatusBar state={state} docName={docName} tool={tool} task={showSaving ? task : null} sigGroups={sigGroups} policy={policy} locked={!empty && willBeProtected(state)} />
    </div>
  );
}

function EmptyState({ busy, preparing, fileOver, onOpen, onNew, ...drop }) {
  const t = useT();
  return (
    <div {...drop} className="grid h-full place-items-center bg-desk p-8">
      <div className={`flex w-full max-w-[440px] flex-col items-center rounded-2xl border-2 border-dashed px-8 py-10 text-center transition-colors ${fileOver ? 'border-accent bg-accent-soft' : 'border-line-strong bg-panel/60'}`}>
        <AppIcon size={88} alt="SpiderPDF" className={`mb-6 transition-transform duration-150 ease-out ${fileOver ? 'scale-110' : ''}`} />
        <h1 className="text-xl font-semibold tracking-tight">{fileOver ? t('core.empty.drop') : t('core.empty.title')}</h1>
        <p className="mt-2 text-muted">
          {t('core.empty.hint')}
        </p>
        {preparing ? (
          <p role="status" className="mt-6 flex h-9 items-center gap-2 text-sm text-muted">
            <LoaderCircle size={16} strokeWidth={1.75} className="spin" aria-hidden="true" />
            {t('core.empty.preparing')}
          </p>
        ) : (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={onOpen}
              disabled={busy}
              className="flex h-9 items-center gap-2 rounded-lg bg-inverse px-3.5 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              <FolderOpen size={16} strokeWidth={1.75} />
              {busy ? t('core.empty.opening') : t('core.empty.open')}
            </button>
            <button
              type="button"
              onClick={onNew}
              disabled={busy}
              className="flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-[background-color,scale] hover:bg-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              <FilePlus2 size={16} strokeWidth={1.75} className="text-muted" />
              {t('core.empty.new')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Aviso bajo la barra de herramientas: hay páginas escaneadas cuyo texto no se puede buscar. */
function OcrBanner({ count, onRun, onClose }) {
  const t = useT();
  return (
    <div role="status" className="flex shrink-0 items-center gap-3 border-b border-line bg-accent-soft px-4 py-2 text-sm text-accent-ink">
      <ScanText size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {t('core.ocrBanner.text', { count })}
      </span>
      <button
        type="button"
        onClick={onRun}
        className="h-8 shrink-0 rounded-lg bg-inverse px-3 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98]"
      >
        {t('core.ocrBanner.run')}
      </button>
      <button type="button" onClick={onClose} aria-label={t('core.ocrBanner.close')} title={t('core.ocrBanner.close')} className="grid size-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-accent/10">
        <X size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** Barra fina de progreso (determinada si hay total). */
function ProgressBar({ done, total, className = '' }) {
  const pct = total ? Math.round((100 * done) / total) : null;
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total || undefined}
      aria-valuenow={total ? done : undefined}
      className={`relative block h-1.5 overflow-hidden rounded-full bg-hover ${className}`}
    >
      <span
        className={`absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-150 ${pct === null ? 'w-1/3 opacity-60' : ''}`}
        style={pct === null ? undefined : { width: `${pct}%` }}
      />
    </span>
  );
}

/** Tarjeta de «Abriendo…» en la zona de trabajo (solo si tarda más de 300 ms). */
function OpeningCard({ task, onCancel }) {
  const t = useT();
  if (!task) return null;
  const many = task.count > 1;
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-desk/75 p-6 backdrop-blur-[1px]">
      <div role="status" aria-live="polite" aria-busy="true" className="motion-pop w-full max-w-[400px] rounded-2xl border border-line bg-panel p-5 shadow-pop">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink" aria-hidden="true">
            <FileText size={20} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">{many ? t('core.opening.many', { index: task.index, count: task.count }) : t('core.opening.one')}</p>
            <p className="truncate text-base font-semibold tracking-tight" title={task.name}>{task.name}</p>
          </div>
        </div>
        <ProgressBar done={task.done} total={task.total} className="mt-4" />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="tabnum text-xs text-muted">
            {task.total ? t('core.opening.pages', { done: task.done, total: task.total }) : t('core.opening.file')}
          </span>
          <button type="button" onClick={onCancel} className="v-btn-secondary v-btn--sm">
            {t('core.common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBar({ state, docName, tool, task, sigGroups, policy, locked }) {
  const t = useT();
  const n = state.pages.length;
  let hint = '';
  let pageInfo = '';
  if (n && state.mode === 'read') {
    const h = TOOLS.find((x) => x.id === tool)?.hint;
    if (h && tool !== 'select') hint = t(h);
    pageInfo = t('core.status.pageOf', { n: state.current + 1, total: n });
  } else if (!policy.pages) hint = '';
  else if (state.selected.size > 1) hint = t('core.status.dragSelected', { count: state.selected.size });
  else if (n) hint = t('core.status.dragHint');
  const saving = task?.kind === 'extract' ? 'core.task.extracting' : 'core.task.saving';
  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-4 border-t border-line bg-panel px-3.5 text-xs text-muted">
      <span className="min-w-0 shrink truncate">
        {docName && <span className="font-medium text-ink">{docName}</span>}
        {n > 0 && <span className="tabnum ml-3">{t('core.status.pages', { count: n })}</span>}
        {locked && (
          <span className="ml-3 inline-flex items-center gap-1" title={policy.level === 'protected' ? policy.notice : t('core.status.protectedTitle')}>
            <LockKeyhole size={12} strokeWidth={1.75} className="text-accent" aria-hidden="true" />{t('core.status.protected')}
          </span>
        )}
        {state.dirty && <span className="ml-3 inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />{t('core.status.unsaved')}</span>}
      </span>
      {sigGroups.length > 0 && (
        <span role="status" className="-ml-4 flex min-w-0 flex-1 items-center">
          <SignatureStatus groups={sigGroups} policy={policy} />
        </span>
      )}
      <span className="flex min-w-0 items-center gap-3">
        {task ? (
          <span role="status" className="flex items-center gap-2.5">
            <ProgressBar done={task.done} total={task.total} className="w-32" />
            <span className="tabnum whitespace-nowrap">
              {task.kind === 'ocr'
                ? task.cancelling ? t('core.task.cancelling') : task.loading ? t('core.task.ocrLoading') : t('core.task.ocrPage', { n: Math.min(task.done + 1, task.total), total: task.total })
                : task.kind === 'print'
                ? task.phase === 'send'
                  ? (task.total ? t('core.task.printSending', { done: task.done, total: task.total }) : t('core.task.printSendingNoTotal'))
                  : t('core.task.printPreparing', { done: task.done, total: task.total })
                : task.writing
                  ? t(`${saving}Writing`)
                  : t(`${saving}Page`, { n: Math.min(task.done + 1, task.total), total: task.total })}
            </span>
            {task.cancel && !task.cancelling && (
              <button type="button" onClick={task.cancel} className="v-btn-ghost v-btn--sm">{t('core.common.cancel')}</button>
            )}
          </span>
        ) : hint && <span className="truncate">{hint}</span>}
        {pageInfo && (
          <>
            {(hint || task) && <span className="h-3.5 w-px shrink-0 bg-line" aria-hidden="true" />}
            <span className="tabnum shrink-0 whitespace-nowrap">{pageInfo}</span>
          </>
        )}
      </span>
    </footer>
  );
}
