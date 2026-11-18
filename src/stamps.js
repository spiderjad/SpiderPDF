// Sellos (herramienta «Sello» en Leer). Puro: se prueba en Node (test/stamps.test.js); el dibujo está en stampDraw.js.
//
// Un sello es una anotación { type: 'stamp', rect, k, angle, src, label, author?, flat? }:
//   rect   caja del sello sin su giro libre, en fracciones de página sin rotar (como las firmas)
//   k      giro de la página en pantalla al colocarlo (se ve derecho con ese giro)
//   angle  giro libre en grados, en el sentido de las agujas del reloj (tal como se ve)
//   src    la imagen del sello (PNG con transparencia, data URL): lo mismo se ve en pantalla y se guarda en el PDF
//   flat   «Fijar en la página»: se guarda como contenido de la página en vez de como anotación /Stamp
// Las definiciones (lo que se elige en el diálogo y se recuerda en «Recientes») son:
//   { kind: 'preset', id } · { kind: 'text', text, color, meta } · { kind: 'image', src, wPt, hPt }

import { t } from './i18n/index.js';
import { rectFromDisplay } from './geometry.js';

/** Sellos predefinidos: etiqueta (clave de traducción) y color de tinta. */
export const STAMP_PRESETS = [
  { id: 'received', label: 'core.stamp.received', color: '#1D4ED8' },
  { id: 'paid', label: 'core.stamp.paid', color: '#15803D' },
  { id: 'approved', label: 'core.stamp.approved', color: '#0F766E' },
  { id: 'posted', label: 'core.stamp.posted', color: '#6D28D9' },
  { id: 'rejected', label: 'core.stamp.rejected', color: '#B91C1C' },
  { id: 'copy', label: 'core.stamp.copy', color: '#4B5563' },
];

/** Colores para los sellos de texto propio: [hex, clave del nombre]. Son colores del sello (contenido), no de la interfaz. */
export const STAMP_COLORS = [
  ['#B91C1C', 'core.color.red'], ['#1D4ED8', 'core.color.blue'], ['#15803D', 'core.color.green'],
  ['#6D28D9', 'core.color.violet'], ['#374151', 'core.color.black'],
];

export const TEXT_MAX = 40;
const preset = (id) => STAMP_PRESETS.find((p) => p.id === id) ?? null;

/** «18/11/2026 13:45» (fecha y hora como se escriben en ese idioma, separadas por un espacio). */
export function formatStampDate(date, locale) {
  const day = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  return `${day} ${time}`;
}

/** Nombre del sello (para el aviso, la lista de recientes y /Contents en el PDF). */
export function stampName(def) {
  if (def.kind === 'preset') return t(preset(def.id)?.label ?? 'core.stamp.received');
  if (def.kind === 'text') return def.text.trim();
  return t('core.stamp.imageName');
}

/**
 * Lo que dice un sello de texto: título en mayúsculas y, en los predefinidos (o si se pide), fecha, hora y nombre.
 * → { title, sub, color }
 */
export function stampLines(def, { date = new Date(), user = '', locale } = {}) {
  const p = def.kind === 'preset' ? preset(def.id) : null;
  const title = (p ? t(p.label) : String(def.text ?? '')).trim().slice(0, TEXT_MAX).toLocaleUpperCase(locale);
  const meta = p ? true : def.meta !== false;
  const sub = meta ? [formatStampDate(date, locale), String(user ?? '').trim()].filter(Boolean).join(' · ') : '';
  return { title, sub, color: p?.color ?? def.color ?? STAMP_COLORS[0][0] };
}

/**
 * Caja de un sello colocado con su centro donde se hizo clic (x, y en fracciones de la página tal como se ve),
 * de wPt × hPt puntos, sin salirse. dispW, dispH: tamaño de la página en pantalla (en puntos); R: su giro. → rect
 */
export function placeRect([x, y], { wPt, hPt }, { dispW, dispH, R }) {
  let w = wPt / dispW;
  let h = hPt / dispH;
  const fit = Math.min(1, 0.9 / w, 0.9 / h); // más grande que la página: se reduce
  w *= fit;
  h *= fit;
  const cx = Math.min(1 - w / 2, Math.max(w / 2, x));
  const cy = Math.min(1 - h / 2, Math.max(h / 2, y));
  return rectFromDisplay({ x: cx - w / 2, y: cy - h / 2, w, h }, R);
}

/** Ángulo entre -180 (incluido) y 180 (sin incluir). */
export const normalizeAngle = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
/** Ángulo redondeado a pasos de step grados (5 por defecto). */
export const snapAngle = (deg, step = 5) => normalizeAngle(Math.round(deg / step) * step);

// --- Recientes (localStorage «spiderpdf:sellos») -------------------------------------------------------
const KEY = 'spiderpdf:sellos';
const MAX_RECENT = 6;
const MAX_BYTES = 400_000; // por imagen, para no llenar el almacenamiento

const stampKey = (d) => (d.kind === 'preset' ? `p:${d.id}` : d.kind === 'text' ? `t:${d.text.trim().toLowerCase()}:${d.color}:${d.meta !== false}` : `i:${d.src}`);
function valid(d) {
  if (d?.kind === 'preset') return !!preset(d.id);
  if (d?.kind === 'text') return typeof d.text === 'string' && !!d.text.trim() && d.text.length <= TEXT_MAX && /^#[0-9a-f]{6}$/i.test(d.color ?? '');
  if (d?.kind === 'image') return typeof d.src === 'string' && d.src.startsWith('data:image/') && d.src.length <= MAX_BYTES && d.wPt > 0 && d.hPt > 0;
  return false;
}

export function loadRecentStamps(storage) {
  try {
    const list = JSON.parse(storage?.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(valid).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Pone un sello el primero de los recientes (sin repetir) y guarda. → la lista nueva */
export function rememberStamp(storage, def) {
  if (!valid(def)) return loadRecentStamps(storage);
  const list = [def, ...loadRecentStamps(storage).filter((d) => stampKey(d) !== stampKey(def))].slice(0, MAX_RECENT);
  try { storage?.setItem(KEY, JSON.stringify(list)); } catch { /* almacenamiento lleno o bloqueado */ }
  return list;
}
