// Cómo guardar (sin DOM; se prueba en Node).
// Regla: un documento con redacciones nunca se guarda directamente sobre el original.
import { t } from './i18n/index.js';

const baseName = (name = '') => name.replace(/\.pdf$/i, '');
const isWindowsPath = (p) => /^[a-z]:[\\/]/i.test(p) || p.includes('\\');

/** Carpeta de una ruta (con su separador), o '' si no tiene. */
export function dirOf(path) {
  if (!path) return '';
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(0, i) : '';
}

/** Une carpeta y nombre con el separador que ya usa la carpeta. */
export function joinPath(dir, name) {
  if (!dir) return name;
  const sep = isWindowsPath(dir) ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : `${dir}${sep}${name}`;
}

/** ¿Dos rutas son el mismo archivo? En Windows no distingue mayúsculas ni / de \. */
export function samePath(a, b) {
  if (!a || !b) return false;
  const win = isWindowsPath(a) || isWindowsPath(b);
  const norm = (p) => {
    let s = p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    if (win) s = s.toLowerCase();
    return s;
  };
  return norm(a) === norm(b);
}

export const hasRedactions = (pages) => pages.some((p) => (p.annots ?? []).some((a) => a.type === 'redact'));

/**
 * Plan de guardado.
 *   path: ruta para escribir directamente (sin diálogo), o null si hay que preguntar.
 *   defaultPath: ruta propuesta en el diálogo (la carpeta de salida de Preferencias, outDir; si no hay, la del original).
 *   originals: rutas de los PDF de partida (para avisar si se va a reemplazar uno).
 */
export function planSave({ file, sources = [], pages, asNew = false, extract = false, dirty = true, outDir = '' }) {
  const redacted = hasRedactions(pages);
  const signedOriginals = sources.filter((s) => s.signed > 0 && s.path).map((s) => s.path);
  const originalPath = file?.path ?? sources.find((s) => s.path)?.path ?? null;
  let base = file ? baseName(file.name) : (sources[0]?.name ?? t('dialogs.defaultDocName'));
  let suggestedName;
  if (extract) suggestedName = t('dialogs.savePlan.extractName', { base });
  else if (redacted) {
    // no encadenar «(redactado) (redactado)» (ni en el idioma actual ni en español)
    for (const tail of new Set([' (redactado)', baseName(t('dialogs.savePlan.redactedName', { base: '' }))])) {
      if (base.endsWith(tail)) { base = base.slice(0, -tail.length); break; }
    }
    suggestedName = t('dialogs.savePlan.redactedName', { base });
  } else suggestedName = `${base}.pdf`;
  const direct = !extract && !asNew && !redacted && file?.path;
  const overSigned = !!direct && signedOriginals.some((p) => samePath(p, file.path));
  return {
    redacted,
    path: direct ? file.path : null,
    suggestedName,
    defaultPath: joinPath(outDir || dirOf(originalPath), suggestedName),
    originals: [file?.path, ...sources.map((s) => s.path)].filter(Boolean),
    signedOriginals,
    // Guardar encima de un PDF firmado: sin cambios no se escribe nada (reescribirlo ya rompería la firma);
    // con cambios, antes se pregunta y se propone guardar una copia.
    skip: overSigned && !dirty,
    confirmSigned: overSigned && dirty,
    copyPath: joinPath(outDir || dirOf(originalPath), t('dialogs.savePlan.modifiedName', { base })),
  };
}

/** ¿El destino elegido reemplazaría uno de los PDF originales? */
export function replacesOriginal(plan, target) {
  return plan.originals.some((o) => samePath(o, target));
}

/** ¿El destino elegido es uno de los PDF de partida firmados digitalmente? */
export function replacesSigned(plan, target) {
  return plan.signedOriginals.some((o) => samePath(o, target));
}

/** PDF de partida firmados que aún aportan páginas al documento (los que muestra la barra de estado). */
export function signedSources({ sources = [], pages = [] }) {
  const used = new Set(pages.map((p) => p.docId));
  return sources.filter((s) => s.signed > 0 && used.has(s.docId));
}

/** Avisos de las confirmaciones al guardar, en el idioma actual. */
export const replaceOriginalWarning = () => t('dialogs.savePlan.replaceOriginal');
export const signedWarning = () => t('dialogs.savePlan.signedWarning');
