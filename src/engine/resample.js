// Reducir imágenes para «Reducir tamaño»: media de áreas (cada píxel nuevo es la media exacta de los que cubre), que
// es lo correcto para reducir: sin el aliasing de tomar un píxel de cada tantos. Puro: worker y Node (pruebas).

/**
 * src: Uint8Array RGBA (w×h). → Uint8Array RGBA (W×H), con W ≤ w y H ≤ h.
 * Separable: primero en horizontal y luego en vertical, con pesos fraccionarios en los bordes de cada celda.
 */
export function downscaleRGBA(src, w, h, W, H) {
  if (W >= w && H >= h) return src;
  const tmp = new Float32Array(W * h * 4);
  const sx = w / W;
  for (let x = 0; x < W; x++) {
    const x0 = x * sx;
    const x1 = x0 + sx;
    for (let i = Math.floor(x0); i < Math.min(w, Math.ceil(x1)); i++) {
      const wt = Math.min(x1, i + 1) - Math.max(x0, i);
      if (wt <= 0) continue;
      for (let y = 0; y < h; y++) {
        const s = (y * w + i) * 4;
        const d = (y * W + x) * 4;
        tmp[d] += src[s] * wt; tmp[d + 1] += src[s + 1] * wt; tmp[d + 2] += src[s + 2] * wt; tmp[d + 3] += src[s + 3] * wt;
      }
    }
  }
  const out = new Uint8Array(W * H * 4);
  const sy = h / H;
  const norm = 1 / (sx * sy);
  for (let y = 0; y < H; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    const acc = new Float32Array(W * 4);
    for (let j = Math.floor(y0); j < Math.min(h, Math.ceil(y1)); j++) {
      const wt = Math.min(y1, j + 1) - Math.max(y0, j);
      if (wt <= 0) continue;
      const row = j * W * 4;
      for (let k = 0; k < W * 4; k++) acc[k] += tmp[row + k] * wt;
    }
    const o = y * W * 4;
    for (let k = 0; k < W * 4; k++) out[o + k] = Math.min(255, Math.round(acc[k] * norm));
  }
  return out;
}

/**
 * Tamaño reducido para que una imagen de w×h píxeles que se ve a currentDpi quede a dpi. null si no hace falta (con un
 * margen del 15 %: no se toca una imagen que ya está casi a la resolución pedida).
 */
export function targetSize(w, h, currentDpi, dpi) {
  if (!(currentDpi > dpi * 1.15)) return null;
  const k = dpi / currentDpi;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}
