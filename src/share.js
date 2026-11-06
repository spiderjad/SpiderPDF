// Compartir: qué se comparte y qué avisar. Puro (sin DOM); se prueba en Node (test/share.test.js).
import { hasRedactions } from './savePlan.js';
import { incrementalPlan } from './signed.js';
import { t } from './i18n/index.js';

/** Nombre propuesto para la copia: el del documento, o «documento». */
export function shareName(docName) {
  const base = String(docName ?? '').replace(/\.pdf$/i, '').trim();
  return `${base || t('dialogs.defaultDocName')}.pdf`; // sin archivo (documento nuevo o unido): «documento.pdf»
}

/**
 * Plan para compartir. state: { file, sources, pages, selected, dirty, security }; opts: { scope, hidden };
 * protectedNow: el resultado lleva contraseña (ver willBeProtected en App.jsx).
 * → { pages, original, notices: [{ text, tone }] }
 *   original: se comparte el archivo tal cual está en disco (sin cambios, todo, sin limpiar): así una firma digital
 *   sigue intacta y el archivo es idéntico al que se abrió.
 */
export function sharePlan(state, { scope = 'all', hidden = false } = {}, { protectedNow = false } = {}) {
  const { file, sources = [], pages: all = [], selected = new Set(), dirty = false, security = null } = state;
  const pages = scope === 'selection' ? all.filter((p) => selected.has(p.key)) : all;
  const original = !dirty && !!file?.path && scope === 'all' && !hidden && !security;
  const notices = [];
  if (hasRedactions(pages)) notices.push({ tone: 'danger', text: t('dialogs.share.noticeRedact') });
  const signed = sources.find((s) => s.signed > 0 && pages.some((p) => p.docId === s.docId));
  if (signed && !original) {
    const inc = incrementalPlan(pages, signed, { security: !!security });
    if (hidden || !inc.incremental) notices.push({ tone: 'danger', text: t('dialogs.share.noticeSigBroken') });
    else notices.push({ tone: 'info', text: t('dialogs.share.noticeSigKept') });
  }
  if (protectedNow) notices.push({ tone: 'info', text: t('dialogs.share.noticeProtected') });
  return { pages, original, notices };
}

/** IA de «Enviar a IA» (la elegida en Preferencias). */
export const AI_PROVIDERS = { claude: 'Claude', chatgpt: 'ChatGPT' };

/** Texto para mostrar tras compartir. target: whatsapp | ai | mail | copy | reveal; r: respuesta del proceso principal. */
export function shareResult(target, r) {
  if (target === 'ai') {
    const name = AI_PROVIDERS[r?.provider] ?? t('dialogs.share.theAi');
    if (!r?.ok) return { ok: false, text: r?.message ?? t('dialogs.share.aiOpenFailed', { name }) };
    if (!r.copied) return { ok: false, text: t('dialogs.share.aiNotCopied', { name }) };
    return { ok: true, text: t(r.desktop ? 'dialogs.share.aiDesktop' : 'dialogs.share.aiBrowser', { name }) };
  }
  if (target === 'whatsapp') {
    if (!r?.ok) return { ok: false, text: r?.message ?? t('dialogs.share.whatsappFailed') };
    if (r.desktop) {
      return r.copied
        ? { ok: true, text: t('dialogs.share.whatsappOpen') }
        : { ok: false, text: t('dialogs.share.whatsappNotCopied') };
    }
    return { ok: true, text: t('dialogs.share.whatsappWeb') };
  }
  if (target === 'mail') {
    if (r?.ok) return { ok: true, text: t('dialogs.share.mailOpen') };
    if (r?.code === 'cancelado') return { ok: true, text: t('dialogs.share.mailCancelled') };
    if (r?.code === 'sin-cliente') {
      return { ok: false, text: t('dialogs.share.mailNoClient') };
    }
    return { ok: false, text: r?.message ?? t('dialogs.share.mailFailed') };
  }
  if (target === 'copy') {
    return r?.ok
      ? { ok: true, text: t('dialogs.share.copyOk') }
      : { ok: false, text: r?.message ?? t('dialogs.share.copyFailed') };
  }
  return r?.ok ? { ok: true, text: t('dialogs.share.revealOk') } : { ok: false, text: r?.message ?? t('dialogs.share.revealFailed') };
}
