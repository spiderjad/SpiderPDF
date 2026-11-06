// PDFs firmados digitalmente: qué se puede editar y cómo guardar sin romper la firma.
// Puro (sin DOM): lo usan la interfaz y el motor, y se prueba en Node (test/signed.test.js).
//
// Una firma cubre los bytes del archivo tal como estaban al firmar (su ByteRange). Un guardado
// INCREMENTAL añade los cambios al final como una revisión nueva y deja esos bytes intactos: la firma
// sigue siendo válida para su revisión. Si hay que reescribir el archivo (quitar, reordenar o añadir
// páginas, redactar), los bytes cambian y la firma deja de verificar.
// Una firma de CERTIFICACIÓN (DocMDP) además limita lo que se puede cambiar: P=1 nada, P=2 rellenar
// formularios y firmar, P=3 lo anterior y anotar.

import { hasRedactions } from './savePlan.js';
import { permsPolicy, permsNotice } from './security.js';
import { t } from './i18n/index.js';

/** Motivos por los que hay que reescribir el archivo, como se explican en el diálogo (claves de i18n). */
export const REWRITE_REASONS = {
  added: 'reader.signed.reasonAdded',
  inserted: 'reader.signed.reasonInserted',
  deleted: 'reader.signed.reasonDeleted',
  moved: 'reader.signed.reasonMoved',
  redact: 'reader.signed.reasonRedact',
  security: 'reader.signed.reasonSecurity',
};

/**
 * ¿Se puede guardar como revisión incremental del PDF firmado? pages: páginas a guardar
 * ({ docId, index, annots }); source: { docId, pageCount }. → { incremental, reasons: [clave] }
 */
export function incrementalPlan(pages, source, { security } = {}) {
  const reasons = [];
  if (security) reasons.push('security');
  if (pages.some((p) => p.docId != null && p.docId !== source.docId)) reasons.push('added');
  if (pages.some((p) => p.docId == null)) reasons.push('inserted');
  const idx = pages.filter((p) => p.docId === source.docId).map((p) => p.index);
  if (new Set(idx).size < source.pageCount) reasons.push('deleted');
  if (idx.some((v, i) => i > 0 && v < idx[i - 1])) reasons.push('moved');
  if (hasRedactions(pages)) reasons.push('redact');
  return { incremental: reasons.length === 0, reasons };
}

/** Une los motivos en una frase: «has quitado páginas y hay zonas que redactar». */
export function reasonText(reasons) {
  const list = reasons.map((r) => REWRITE_REASONS[r]).filter(Boolean).map((k) => t(k));
  return list.length > 1 ? t('reader.common.listAnd', { list: list.slice(0, -1).join(', '), last: list.at(-1) }) : list[0] ?? '';
}

// --- Integridad (la comprueba el proceso principal: electron/sigverify.cjs) -----------------------
/**
 * Tono y texto de cada estado (text: en el idioma actual, se traduce al leerlo). La identidad del firmante
 * (confianza, revocación) no se comprueba aún.
 */
const status = (rank, tone, key) => ({ rank, tone, key, get text() { return t(key); } });
export const SIG_STATUS = {
  intact: status(0, 'neutral', 'reader.signed.intact'),
  modified: status(1, 'neutral', 'reader.signed.modified'),
  unknown: status(2, 'warn', 'reader.signed.unknown'),
  broken: status(3, 'danger', 'reader.signed.broken'),
  pending: status(-1, 'neutral', 'reader.signed.pending'),
  unavailable: status(-1, 'neutral', 'reader.signed.unavailable'),
  outdated: status(-1, 'warn', 'reader.signed.outdated'),
};

/** El peor estado de una lista de firmas ([{ status }]); el de la barra de estado. */
export function worstStatus(sigs) {
  return sigs.reduce((w, s) => (SIG_STATUS[s.status].rank > SIG_STATUS[w].rank ? s.status : w), sigs[0]?.status ?? 'pending');
}

const FULL = { level: 'full', pages: true, annots: true, forms: true, content: true, print: true, copy: true, notice: null };
const KEYS = ['pages', 'annots', 'forms', 'content', 'print', 'copy'];

/**
 * Qué permite el documento: lo más restrictivo de las certificaciones (DocMDP) y de los permisos de los PDF
 * protegidos con contraseña (abiertos con la de abrir) de sus PDF de partida.
 *   print   imprimir
 *   copy    copiar texto
 */
export function editPolicy(sources = []) {
  const mdp = mdpPolicy(sources);
  const perms = sources.map((s) => permsPolicy(s.security)).filter(Boolean);
  if (!perms.length) return mdp;
  const p = Object.fromEntries(KEYS.map((k) => [k, perms.every((x) => x[k])]));
  if (KEYS.every((k) => p[k])) return mdp;
  const merged = Object.fromEntries(KEYS.map((k) => [k, mdp[k] && p[k]]));
  return { ...merged, level: 'protected', notice: mdp.notice ?? permsNotice(p), perms: p };
}

/**
 * Qué permite editar el documento según las firmas de certificación de sus PDF de partida.
 *   pages   girar, quitar, mover y añadir páginas
 *   annots  resaltar, lápiz y notas
 *   forms   rellenar campos
 *   content cambiar el contenido de la página: texto, firma gráfica (es contenido, no anotación) y redactar
 */
function mdpPolicy(sources) {
  const ps = sources.map((s) => s.mdp).filter((p) => p >= 1 && p <= 3);
  if (!ps.length) return FULL;
  const p = Math.min(...ps);
  const base = { pages: false, content: false, print: true, copy: true };
  if (p === 1) return { ...base, level: 'locked', annots: false, forms: false, notice: t('reader.signed.mdpLocked') };
  if (p === 2) return { ...base, level: 'forms', annots: false, forms: true, notice: t('reader.signed.mdpForms') };
  return { ...base, level: 'annots', annots: true, forms: true, notice: t('reader.signed.mdpAnnots') };
}

/** Herramientas de Leer que permite la política (ids de AnnotToolbar). */
export function allowedTools(policy) {
  return new Set(['select',
    ...(policy.annots ? ['highlight', 'ink', 'note'] : []),
    ...(policy.content ? ['signature', 'textbox', 'text', 'redact'] : [])]);
}

const PAGE_ACTIONS = new Set(['rotate', 'delete', 'move', 'add']);
// Firma gráfica, texto nuevo y zonas a redactar cambian el contenido de la página; el resto son anotaciones.
const annotKind = (type) => (type === 'image' || type === 'redact' || type === 'textbox' ? 'content' : 'annots');

/** ¿La política permite esta acción del reducer? state: para saber el tipo de una anotación existente. */
export function allows(policy, a, state) {
  if (policy.level === 'full') return true;
  if (PAGE_ACTIONS.has(a.type)) return policy.pages;
  if (a.type === 'setOutline') return policy.pages; // el índice es del documento, como el orden de las páginas
  if (a.type === 'setField') return policy.forms;
  if (a.type === 'setTextEdit' || a.type === 'setOcr') return policy.content; // la capa del OCR es texto de la página
  if (a.type === 'addAnnot') return policy[annotKind(a.annot.type)];
  if (a.type === 'updateAnnot' || a.type === 'removeAnnot') {
    const annot = state?.pages.find((p) => p.key === a.key)?.annots.find((x) => x.id === a.id);
    return !annot || policy[annotKind(annot.type)];
  }
  return true; // selección, vista, deshacer…
}
