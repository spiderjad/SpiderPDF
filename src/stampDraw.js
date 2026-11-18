// Dibujo de los sellos con el canvas del navegador. La imagen que sale de aquí es la que se ve en pantalla y la que se
// guarda en el PDF (como apariencia de la anotación /Stamp): se ve igual en todas partes. Lo puro está en stamps.js.
import { removeBackground, alphaBounds, padBounds } from './signature.js';

/** Píxeles por punto de la imagen del sello: 4 = 288 ppp, nítido también impreso. */
export const PX_PER_PT = 4;
const FONT = '"Inter Variable", Inter, "Segoe UI", Arial, sans-serif';

/**
 * Sello de texto con estilo de sello de goma: doble borde redondeado del color, título en mayúsculas y, debajo, la
 * línea pequeña (fecha, hora y nombre). → { src (PNG data URL), wPt, hPt }
 */
export async function renderStamp({ title, sub, color }) {
  try { await document.fonts?.load(`800 ${20 * PX_PER_PT}px "Inter Variable"`); } catch { /* sin la fuente: la del sistema */ }
  const S = PX_PER_PT;
  const titlePt = 20; const subPt = 7.5; const padX = 12; const padY = 7; const gap = 3.5;
  const outer = 2.4; const inner = 0.9; const inset = 3.2;
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  const measure = (font, spacing, text) => { ctx.font = font; ctx.letterSpacing = `${spacing}px`; return text ? ctx.measureText(text).width / S : 0; };
  const titleFont = `800 ${titlePt * S}px ${FONT}`;
  const subFont = `600 ${subPt * S}px ${FONT}`;
  const tw = measure(titleFont, 1.4 * S, title);
  const sw = measure(subFont, 0.3 * S, sub);
  const wPt = Math.max(tw, sw) + 2 * (padX + inset + outer);
  const hPt = titlePt * 0.78 + (sub ? gap + subPt * 0.8 : 0) + 2 * (padY + inset + outer);
  c.width = Math.ceil(wPt * S);
  c.height = Math.ceil(hPt * S);
  ctx = c.getContext('2d');
  ctx.globalAlpha = 0.92;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  const box = (off, width, radius) => {
    ctx.lineWidth = width * S;
    ctx.beginPath();
    ctx.roundRect((off + width / 2) * S, (off + width / 2) * S, c.width - 2 * (off + width / 2) * S, c.height - 2 * (off + width / 2) * S, radius * S);
    ctx.stroke();
  };
  box(0, outer, 6);
  box(outer + inset - inner, inner, 3.5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const top = outer + inset + padY;
  ctx.font = titleFont;
  ctx.letterSpacing = `${1.4 * S}px`;
  const titleBase = (top + titlePt * 0.78) * S;
  ctx.fillText(title, c.width / 2 + 0.7 * S, titleBase); // el espaciado se añade también tras la última letra
  if (sub) {
    ctx.font = subFont;
    ctx.letterSpacing = `${0.3 * S}px`;
    ctx.fillText(sub, c.width / 2 + 0.15 * S, titleBase + (gap + subPt * 0.8) * S);
  }
  return { src: c.toDataURL('image/png'), wPt: c.width / S, hPt: c.height / S };
}

/**
 * Sello de imagen (un logo o el sello de la empresa escaneado): reducida si es enorme, con el fondo blanco quitado si
 * se pide y recortada a lo visible. Tamaño inicial: 140 pt de ancho (o 90 de alto). → { src, wPt, hPt }
 */
export async function imageStamp(file, { removeWhite = true } = {}) {
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    let img = ctx.getImageData(0, 0, w, h);
    if (removeWhite) img = removeBackground(img);
    const b = alphaBounds(img);
    if (!b) throw new Error('vacía');
    const crop = padBounds(b, 2, w, h);
    const out = document.createElement('canvas');
    out.width = crop.w;
    out.height = crop.h;
    const tmp = new ImageData(new Uint8ClampedArray(img.data), w, h);
    out.getContext('2d').putImageData(tmp, -crop.x, -crop.y);
    const scale = Math.min(140 / crop.w, 90 / crop.h);
    return { src: out.toDataURL('image/png'), wPt: crop.w * scale, hPt: crop.h * scale };
  } finally {
    bmp.close();
  }
}
