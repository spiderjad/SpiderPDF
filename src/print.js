// Imprimir (puro, probado en test/print.test.js). Las páginas se renderizan a 300 ppp; una página muy
// grande (planos A0…) se limita en píxeles para no agotar la memoria.
export const PRINT_DPI = 300;
export const MAX_PRINT_PIXELS = 40e6; // ≈ A2 a 300 ppp

/** Píxeles por punto para imprimir una página de w × h puntos. */
export function printScale(w, h) {
  const ideal = PRINT_DPI / 72;
  return Math.min(ideal, Math.sqrt(MAX_PRINT_PIXELS / (w * h)));
}

