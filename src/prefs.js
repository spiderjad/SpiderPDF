// Preferencias de la app (Editar → Preferencias…), en localStorage «spiderpdf:prefs». Todo en try/catch: sin
// almacenamiento, valen las de por defecto.
const STORE = 'spiderpdf:prefs';
export const DEFAULT_PREFS = { ai: 'claude' };
const AI = new Set(['claude', 'chatgpt']);

/** Solo valores conocidos: lo que haya en el almacenamiento no puede meter otra cosa. */
export function normalizePrefs(p) {
  return { ai: AI.has(p?.ai) ? p.ai : DEFAULT_PREFS.ai };
}

export function loadPrefs() {
  try { return normalizePrefs(JSON.parse(localStorage.getItem(STORE) ?? '{}')); } catch { return { ...DEFAULT_PREFS }; }
}

export function savePrefs(p) {
  const n = normalizePrefs(p);
  try { localStorage.setItem(STORE, JSON.stringify(n)); } catch { /* sin almacenamiento */ }
  return n;
}
