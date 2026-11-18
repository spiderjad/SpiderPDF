// Tema de la interfaz (Preferencias → Tema): 'auto' sigue al sistema; 'light' y 'dark' lo fuerzan.
// spider-ui cambia sus colores con data-theme en <html>; en Electron, además, nativeTheme.themeSource (lo pide
// desktop.setTheme): así cambian también la barra de título de Windows, los diálogos nativos y prefers-color-scheme.
import { desktop } from './desktop.js';

export function applyTheme(theme, root = globalThis.document?.documentElement) {
  if (root) {
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
  }
  try { desktop.setTheme?.(theme); } catch { /* preload antiguo */ }
}
