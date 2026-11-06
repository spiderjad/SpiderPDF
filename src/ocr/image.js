// Imágenes en escala de grises para el OCR: { w, h, data: Uint8Array } (0 negro, 255 blanco). Puro: se prueba en Node
// (test/ocr.test.js) y lo usa el worker de PDFium para preparar cada página.

/** RGBA (o BGRA: el gris casi no cambia) → gris. */
export function toGray(pixels, w, h) {
  const data = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    data[i] = (pixels[j] * 77 + pixels[j + 1] * 150 + pixels[j + 2] * 29) >> 8;
  }
  return { w, h, data };
}

/** Reduce por promedio de bloques hasta que el ancho y el alto quepan en max. → { w, h, data, k } (k = factor). */
export function downscale(img, max) {
  const k = Math.max(1, Math.ceil(Math.max(img.w, img.h) / max));
  if (k === 1) return { ...img, k: 1 };
  const w = Math.floor(img.w / k);
  const h = Math.floor(img.h / k);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < k; dy++) {
        const row = (y * k + dy) * img.w + x * k;
        for (let dx = 0; dx < k; dx++) s += img.data[row + dx];
      }
      data[y * w + x] = Math.round(s / (k * k));
    }
  }
  return { w, h, data, k };
}

/**
 * Gira la imagen deg grados (positivo = sentido horario, como se ve en pantalla) alrededor de su centro, en un
 * lienzo que la contiene entera (nada se recorta); lo que queda fuera se rellena de blanco. Los múltiplos de 90
 * son exactos. → { w, h, data, back } con back(x, y) = punto de la imagen original que corresponde a (x, y).
 */
export function rotate(img, deg) {
  const q = ((Math.round(deg / 90) % 4) + 4) % 4;
  if (Math.abs(deg - Math.round(deg / 90) * 90) < 1e-9) return rotate90(img, q);
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const w = Math.ceil(Math.abs(img.w * cos) + Math.abs(img.h * sin));
  const h = Math.ceil(Math.abs(img.w * sin) + Math.abs(img.h * cos));
  const cx0 = img.w / 2; const cy0 = img.h / 2;
  const cx = w / 2; const cy = h / 2;
  // Punto del lienzo nuevo → original: girar -deg alrededor de los centros.
  const back = (x, y) => {
    const dx = x - cx; const dy = y - cy;
    return [cx0 + dx * cos + dy * sin, cy0 - dx * sin + dy * cos];
  };
  const data = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = back(x + 0.5, y + 0.5);
      const fx = sx - 0.5; const fy = sy - 0.5;
      const x0 = Math.floor(fx); const y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= img.w || y0 + 1 >= img.h) continue;
      const ax = fx - x0; const ay = fy - y0;
      const p = y0 * img.w + x0;
      const top = img.data[p] * (1 - ax) + img.data[p + 1] * ax;
      const bot = img.data[p + img.w] * (1 - ax) + img.data[p + img.w + 1] * ax;
      data[y * w + x] = Math.round(top * (1 - ay) + bot * ay);
    }
  }
  return { w, h, data, back };
}

/** Giro exacto en cuartos de vuelta (q: 0-3, sentido horario). */
export function rotate90(img, q) {
  const { w: W, h: H } = img;
  if (q === 0) return { ...img, back: (x, y) => [x, y] };
  const w = q % 2 ? H : W;
  const h = q % 2 ? W : H;
  const data = new Uint8Array(w * h);
  // back: punto del resultado → original (las coordenadas son continuas: bordes en 0 y en w/h).
  const back = q === 1 ? (x, y) => [y, H - x] : q === 2 ? (x, y) => [W - x, H - y] : (x, y) => [W - y, x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = back(x + 0.5, y + 0.5);
      data[y * w + x] = img.data[Math.floor(sy) * W + Math.floor(sx)];
    }
  }
  return { w, h, data, back };
}

/** Recorte rectangular (en píxeles). */
export function crop(img, x0, y0, x1, y1) {
  const X0 = Math.max(0, Math.floor(x0)); const Y0 = Math.max(0, Math.floor(y0));
  const X1 = Math.min(img.w, Math.ceil(x1)); const Y1 = Math.min(img.h, Math.ceil(y1));
  const w = Math.max(1, X1 - X0); const h = Math.max(1, Y1 - Y0);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) data.set(img.data.subarray((Y0 + y) * img.w + X0, (Y0 + y) * img.w + X0 + w), y * w);
  return { w, h, data };
}

/** Imagen PGM (P5): Tesseract (Leptonica) la lee directamente, sin comprimir ni pasar por un canvas. */
export function toPgm(img) {
  const head = new TextEncoder().encode(`P5\n${img.w} ${img.h}\n255\n`);
  const out = new Uint8Array(head.length + img.data.length);
  out.set(head);
  out.set(img.data, head.length);
  return out;
}
