import { useEffect, useState } from 'react';
import { FAMILIES } from '../textbox.js';
import { registerFamilies } from '../fonts.js';
import { wmPlacements, imageBox } from '../watermark.js';

// Medidas de la tinta del texto (en em) con la fuente incluida, para centrarlo y colocar el mosaico como el motor
// (que las saca de los contornos de las letras). Con caché por fuente y texto.
const metrics = new Map();
let ctx = null;
const cssFont = (wm) => `${wm.bold ? 700 : 400} 100px "${FAMILIES[wm.family]?.css ?? FAMILIES.sans.css}"`;

function measure(wm, text) {
  const font = cssFont(wm);
  const key = `${font}|${text}`;
  if (metrics.has(key)) return metrics.get(key);
  ctx ??= (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas')).getContext('2d');
  ctx.font = font;
  const m = ctx.measureText(text);
  const out = {
    left: m.actualBoundingBoxLeft / 100, right: m.actualBoundingBoxRight / 100,
    ascent: m.actualBoundingBoxAscent / 100, descent: m.actualBoundingBoxDescent / 100,
  };
  metrics.set(key, out);
  return out;
}

/** Vuelve a pintar cuando la fuente de la marca ya está cargada (antes, las medidas serían las de otra). */
function useFontReady(wm) {
  const [, setTick] = useState(0);
  const font = wm?.kind === 'text' ? cssFont(wm) : null;
  useEffect(() => {
    if (!font || typeof document === 'undefined' || !document.fonts) return undefined;
    registerFamilies();
    let alive = true;
    document.fonts.load(font).then(() => {
      if (!alive) return;
      for (const k of metrics.keys()) if (k.startsWith(font)) metrics.delete(k);
      setTick((n) => n + 1);
    }).catch(() => {});
    return () => { alive = false; };
  }, [font]);
}

/**
 * Marca de agua de una página (src/watermark.js) en SVG, encima del canvas de la página. Detrás del contenido se
 * simula multiplicando (el texto oscuro del PDF queda por encima); al guardar va de verdad debajo.
 *   wm; wPts × hPts: tamaño visible de la página en puntos; W × H: en píxeles.
 */
export default function WatermarkLayer({ wm, wPts, hPts, W, H }) {
  useFontReady(wm);
  if (!wm) return null;
  const k = W / wPts; // píxeles por punto
  let box;
  let draw;
  if (wm.kind === 'image') {
    if (!wm.image?.src) return null;
    const b = imageBox(wm, wPts);
    box = b;
    draw = <image href={wm.image.src} x={(-b.w / 2) * k} y={(-b.h / 2) * k} width={b.w * k} height={b.h * k} preserveAspectRatio="none" />;
  } else {
    const text = String(wm.text ?? '').trim();
    if (!text) return null;
    const m = measure(wm, text);
    const size = wm.size;
    box = { w: (m.left + m.right) * size, h: (m.ascent + m.descent) * size };
    const cx = ((m.right - m.left) / 2) * size;
    const cy = ((m.descent - m.ascent) / 2) * size;
    draw = (
      <text
        x={-cx * k} y={-cy * k} fontSize={size * k} fontWeight={wm.bold ? 700 : 400}
        fontFamily={`"${FAMILIES[wm.family]?.css ?? FAMILIES.sans.css}", sans-serif`} fill={wm.color}
        style={{ whiteSpace: 'pre' }}
      >
        {text}
      </text>
    );
  }
  const { angle, centers } = wmPlacements(wm, { W: wPts, H: hPts }, box);
  return (
    <svg
      width={W} height={H} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true"
      data-watermark={wm.kind === 'image' ? 'image' : wm.text} data-copies={centers.length} data-layer={wm.layer}
      style={{ mixBlendMode: wm.layer === 'back' ? 'multiply' : undefined }}
    >
      <g opacity={wm.opacity}>
        {centers.map(([x, y], i) => (
          // eslint-disable-next-line react/no-array-index-key
          <g key={i} transform={`translate(${x * k} ${y * k}) rotate(${-angle})`}>{draw}</g>
        ))}
      </g>
    </svg>
  );
}
