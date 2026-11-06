// «Reducir tamaño»: niveles y textos. Puro (sin DOM); lo usan la interfaz y el motor (test/reduce.test.js).
import { t, getLocale } from './i18n/index.js';

/** dpi: resolución máxima de las imágenes según cómo se ven en la página; quality: JPEG (0-1). */
export const REDUCE_LEVELS = {
  // label y hint se traducen al leerlos (getters): el idioma se elige después de cargar los módulos.
  high: { get label() { return t('dialogs.reduce.high'); }, dpi: 300, quality: 0.85, get hint() { return t('dialogs.reduce.highHint'); } },
  balanced: { get label() { return t('dialogs.reduce.balanced'); }, dpi: 150, quality: 0.75, get hint() { return t('dialogs.reduce.balancedHint'); } },
  small: { get label() { return t('dialogs.reduce.small'); }, dpi: 96, quality: 0.6, get hint() { return t('dialogs.reduce.smallHint'); } },
};

const num = (n, digits) => n.toLocaleString(getLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** «12,4 MB», «850 KB», «900 bytes» (KB y MB de 1024, como el Explorador de Windows). Desde 1000 KB, en MB. */
export function formatSize(bytes) {
  if (bytes >= 1000 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${num(mb, mb < 100 ? 1 : 0).replace(/[.,]0$/, '')} MB`; // «12,4 MB», «25 MB»
  }
  if (bytes >= 1024) return `${num(Math.round(bytes / 1024), 0)} KB`;
  return `${bytes} bytes`;
}

/** «12,4 MB → 3,1 MB (−75 %)». Si no baja, el porcentaje no se muestra. */
export function sizeChange(before, after) {
  const pct = before > 0 ? Math.round((100 * (before - after)) / before) : 0;
  return pct > 0 ? t('dialogs.reduce.change', { before: formatSize(before), after: formatSize(after), pct }) : `${formatSize(before)} → ${formatSize(after)}`;
}

/** ¿Merece la pena guardar? Al menos un 1 % menos. */
export const worthSaving = (before, after) => after < before * 0.99;
