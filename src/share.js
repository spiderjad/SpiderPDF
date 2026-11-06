// Compartir: qué se comparte y qué avisar. Puro (sin DOM); se prueba en Node (test/share.test.js).
import { hasRedactions } from './savePlan.js';
import { incrementalPlan } from './signed.js';

/** Nombre propuesto para la copia: el del documento, o «documento». */
export function shareName(docName) {
  const base = String(docName ?? '').replace(/\.pdf$/i, '').trim();
  return `${base && base !== 'Documento sin guardar' ? base : 'documento'}.pdf`;
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
  if (hasRedactions(pages)) notices.push({ tone: 'danger', text: 'Las zonas a redactar se aplican en la copia: lo que hay debajo no se podrá recuperar.' });
  const signed = sources.find((s) => s.signed > 0 && pages.some((p) => p.docId === s.docId));
  if (signed && !original) {
    const inc = incrementalPlan(pages, signed, { security: !!security });
    if (hidden || !inc.incremental) notices.push({ tone: 'danger', text: 'La firma digital no será válida en la copia que compartes.' });
    else notices.push({ tone: 'info', text: 'Tus cambios van como revisión nueva: la firma digital sigue siendo válida.' });
  }
  if (protectedNow) notices.push({ tone: 'info', text: 'La copia va protegida con contraseña, como el documento.' });
  return { pages, original, notices };
}

/** IA de «Enviar a IA» (la elegida en Preferencias). */
export const AI_PROVIDERS = { claude: 'Claude', chatgpt: 'ChatGPT' };

/** Texto para mostrar tras compartir. target: whatsapp | ai | mail | copy | reveal; r: respuesta del proceso principal. */
export function shareResult(target, r) {
  if (target === 'ai') {
    const name = AI_PROVIDERS[r?.provider] ?? 'la IA';
    if (!r?.ok) return { ok: false, text: r?.message ?? `No se pudo abrir ${name}.` };
    if (!r.copied) return { ok: false, text: `Se abrió ${name}, pero no se pudo copiar el PDF. Usa «Mostrar en el Explorador» y arrástralo.` };
    return { ok: true, text: `${r.desktop ? `${name} está abierto` : `Se abrió ${name} en el navegador`}. Pega con Ctrl+V y escribe tu pregunta.` };
  }
  if (target === 'whatsapp') {
    if (!r?.ok) return { ok: false, text: r?.message ?? 'No se pudo abrir WhatsApp.' };
    if (r.desktop) {
      return r.copied
        ? { ok: true, text: 'WhatsApp está abierto. Elige el chat y pega con Ctrl+V.' }
        : { ok: false, text: 'Se abrió WhatsApp, pero no se pudo copiar el PDF. Usa «Mostrar en el Explorador» y arrástralo al chat.' };
    }
    return { ok: true, text: 'WhatsApp no está instalado: se abrió WhatsApp Web en el navegador y la carpeta con el PDF. Arrastra el archivo al chat.' };
  }
  if (target === 'mail') {
    if (r?.ok) return { ok: true, text: 'Se abrió un correo nuevo con el PDF adjunto.' };
    if (r?.code === 'cancelado') return { ok: true, text: 'Se canceló el correo.' };
    if (r?.code === 'sin-cliente') {
      return { ok: false, text: 'Tu programa de correo no admite adjuntar desde otras aplicaciones (por ejemplo, el Outlook nuevo). Usa «Copiar archivo» y pégalo en el correo con Ctrl+V.' };
    }
    return { ok: false, text: r?.message ?? 'No se pudo abrir el correo.' };
  }
  if (target === 'copy') {
    return r?.ok
      ? { ok: true, text: 'PDF copiado. Pégalo con Ctrl+V en un correo, un chat o una carpeta.' }
      : { ok: false, text: r?.message ?? 'No se pudo copiar el PDF.' };
  }
  return r?.ok ? { ok: true, text: 'Se abrió la carpeta con el PDF.' } : { ok: false, text: r?.message ?? 'No se pudo abrir la carpeta.' };
}
