// Preferencias de la app (Editar → Preferencias…), en localStorage «spiderpdf:prefs». Todo en try/catch: sin
// almacenamiento, valen las de por defecto.
//   ai: la IA de «Enviar a IA».
//   userName: tu nombre; va como autor de lo que exportas a Word y Excel.
//   outputDir: carpeta donde se proponen los archivos nuevos (Guardar como, Extraer, Reducir, Exportar); '' = la
//     carpeta del PDF original, como antes.
//   quality: nivel de «Reducir tamaño» que sale elegido al abrirlo (claves de REDUCE_LEVELS).
//   lang: idioma de la interfaz: 'auto' (el del sistema), 'es', 'en' o 'ca' (src/i18n).
import { REDUCE_LEVELS } from './reduce.js';

const STORE = 'spiderpdf:prefs';
export const NAME_MAX = 80;
export const DEFAULT_PREFS = { ai: 'claude', userName: '', outputDir: '', quality: 'balanced', lang: 'auto' };
const LANG_PREFS = new Set(['auto', 'es', 'en', 'ca']);
const AI = new Set(['claude', 'chatgpt']);

/** Solo valores conocidos: lo que haya en el almacenamiento no puede meter otra cosa. */
export function normalizePrefs(p) {
  const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
  return {
    ai: AI.has(p?.ai) ? p.ai : DEFAULT_PREFS.ai,
    userName: text(p?.userName, NAME_MAX),
    outputDir: text(p?.outputDir, 1024),
    quality: Object.hasOwn(REDUCE_LEVELS, p?.quality ?? '') ? p.quality : DEFAULT_PREFS.quality,
    lang: LANG_PREFS.has(p?.lang) ? p.lang : DEFAULT_PREFS.lang,
  };
}

export function loadPrefs() {
  try { return normalizePrefs(JSON.parse(localStorage.getItem(STORE) ?? '{}')); } catch { return { ...DEFAULT_PREFS }; }
}

export function savePrefs(p) {
  const n = normalizePrefs(p);
  try { localStorage.setItem(STORE, JSON.stringify(n)); } catch { /* sin almacenamiento */ }
  return n;
}

/** Carpeta para un archivo nuevo: la de salida si está elegida; si no, la del original. */
export const outputFolder = (prefs, originalDir) => prefs?.outputDir || originalDir;
