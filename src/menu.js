// Menú de la app (Windows, Linux y navegador). El contenido sale de electron/menu.json,
// el mismo archivo con el que macOS construye su menú nativo.
import MENU from '../electron/menu.json' with { type: 'json' };

const isMac = () => typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

/**
 * Submenú «Abrir reciente»: un elemento por archivo (cmd openRecent, arg = ruta) y «Borrar lista»;
 * vacío, un aviso desactivado.
 */
export function recentItems(recents = []) {
  if (!recents.length) return [{ label: 'Sin archivos recientes', cmd: 'none' }];
  return [
    ...recents.map((r) => ({ label: r.name, cmd: 'openRecent', arg: r.path, title: r.path })),
    { sep: true },
    { label: 'Borrar lista', cmd: 'clearRecents' },
  ];
}

/**
 * Menús listos para dibujar: sin elementos de desarrollo en producción ni acciones de ventana en el navegador.
 * recents: archivos recientes para el submenú (en el navegador no hay, y el submenú no aparece).
 */
export function menuModel({ dev = false, web = false, recents = [] } = {}) {
  return MENU.map((menu) => {
    const items = menu.items
      .filter((it) => (it === '-' || !it.dev || dev) && !(web && it.role) && !(web && it.submenu === 'recents'))
      .map((it) => {
        if (it === '-' || it.sep) return { sep: true };
        if (it.submenu === 'recents') return { label: it.label, items: recentItems(recents) };
        return { ...it, ...(isMac() ? it.mac ?? {} : {}) };
      });
    // Quitar separadores sobrantes (al principio, al final o repetidos).
    const clean = items.filter((it, i) => !it.sep || (i > 0 && i < items.length - 1 && !items[i - 1].sep));
    return { label: menu.label, items: clean };
  });
}

/** "CmdOrCtrl+Shift+O" → "Ctrl+Mayús+O" (o "⌘⇧O" en Mac). */
export function formatAccel(accel) {
  if (!accel) return '';
  const mac = isMac();
  const names = mac
    ? { CmdOrCtrl: '⌘', Cmd: '⌘', Ctrl: '⌃', Shift: '⇧', Alt: '⌥', Plus: '+' }
    : { CmdOrCtrl: 'Ctrl', Cmd: 'Ctrl', Ctrl: 'Ctrl', Shift: 'Mayús', Alt: 'Alt', Plus: '+' };
  const parts = splitAccel(accel).map((p) => names[p] ?? p.toUpperCase());
  return parts.join(mac ? '' : '+');
}

function splitAccel(accel) {
  // "CmdOrCtrl+-" y "CmdOrCtrl+Plus": la última parte es la tecla.
  const i = accel.lastIndexOf('+', accel.length - 2);
  return i < 0 ? [accel] : [...accel.slice(0, i).split('+'), accel.slice(i + 1)];
}

/** ¿Este evento de teclado corresponde al atajo? */
export function matchAccel(accel, e) {
  const parts = splitAccel(accel);
  const key = parts.pop();
  const wantCtrl = parts.some((p) => p === 'CmdOrCtrl' || p === 'Ctrl' || p === 'Cmd');
  const wantShift = parts.includes('Shift');
  const wantAlt = parts.includes('Alt');
  if (wantCtrl !== (e.ctrlKey || e.metaKey) || wantAlt !== e.altKey) return false;
  if (key === 'Plus') return e.key === '+' || e.key === '='; // con o sin Mayús según el teclado
  if (wantShift !== e.shiftKey) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}

/** Busca el elemento del menú cuyo atajo coincide con la tecla pulsada. */
export function findByKey(model, e) {
  for (const menu of model) {
    for (const it of menu.items) if (it.accel && matchAccel(it.accel, e)) return it;
  }
  return null;
}
