// «Reducir tamaño»: niveles y textos. Puro (sin DOM); lo usan la interfaz y el motor (test/reduce.test.js).

/** dpi: resolución máxima de las imágenes según cómo se ven en la página; quality: JPEG (0-1). */
export const REDUCE_LEVELS = {
  high: { label: 'Alta calidad', dpi: 300, quality: 0.85, hint: 'Imágenes a 300 ppp como mucho. Para imprimir.' },
  balanced: { label: 'Equilibrado', dpi: 150, quality: 0.75, hint: 'Imágenes a 150 ppp. Para enviar y leer en pantalla.' },
  small: { label: 'Mínimo tamaño', dpi: 96, quality: 0.6, hint: 'Imágenes a 96 ppp. Para adjuntar donde el tamaño importa.' },
};

const num = (n, digits) => n.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** «12,4 MB», «850 KB», «900 bytes» (KB y MB de 1024, como el Explorador de Windows). Desde 1000 KB, en MB. */
export function formatSize(bytes) {
  if (bytes >= 1000 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${num(mb, mb < 100 ? 1 : 0).replace(/,0$/, '')} MB`; // «12,4 MB», «25 MB»
  }
  if (bytes >= 1024) return `${num(Math.round(bytes / 1024), 0)} KB`;
  return `${bytes} bytes`;
}

/** «12,4 MB → 3,1 MB (−75 %)». Si no baja, el porcentaje no se muestra. */
export function sizeChange(before, after) {
  const pct = before > 0 ? Math.round((100 * (before - after)) / before) : 0;
  return `${formatSize(before)} → ${formatSize(after)}${pct > 0 ? ` (−${pct} %)` : ''}`;
}

/** ¿Merece la pena guardar? Al menos un 1 % menos. */
export const worthSaving = (before, after) => after < before * 0.99;
