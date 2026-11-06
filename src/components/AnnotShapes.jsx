import { useEffect, useState } from 'react';
import { toDisplay, rectToDisplay } from '../geometry.js';
import { pdf } from '../engine/client.js';
import { displaySize } from './PageImage.jsx';
import { textboxCss } from '../fonts.js';

export const NOTE_PT = 20; // tamaño del icono de nota en el PDF (ver pdfium-core addAnnot)

/** Orden de dibujo, de abajo arriba: la redacción siempre encima de todo. */
// Firmas y texto nuevo comparten capa (son contenido): entre ellos manda el orden de la lista (traer al frente…).
export const LAYER = { highlight: 0, ink: 1, note: 2, image: 3, textbox: 3, redact: 9 };
export const byLayer = (a, b) => (LAYER[a.type] ?? 5) - (LAYER[b.type] ?? 5);

/** Giro total de la página en pantalla (el que trae el PDF + el del usuario). */
export const pageTurn = (page) => ((page.rot0 ?? 0) + page.rot) % 4;

/** Caja en píxeles de un rectángulo en fracciones sin rotar. */
export function boxPx(rect, R, W, H) {
  const d = rectToDisplay(rect, R);
  return { x: d.x * W, y: d.y * H, w: d.w * W, h: d.h * H };
}

/**
 * Una anotación en SVG, en el sistema de la página mostrada (W x H px, giro R).
 * Lo comparten la capa editable de Leer y las miniaturas. Las props extra van al elemento exterior.
 *   hitArea: añade a la tinta un trazo invisible ancho para poder cogerla con el ratón.
 *   svgNotes: pinta las notas como un cuadrado (en Leer se pintan como botones HTML).
 *   hatchId: id del patrón rayado para las zonas a redactar; sin él se pintan en negro (miniaturas).
 */
export function AnnotShape({ a, W, H, R, pxPerPt, hitArea = false, svgNotes = false, hatchId = null, style, ...props }) {
  const px = (u, v) => { const [x, y] = toDisplay(u, v, R); return [x * W, y * H]; };

  if (a.type === 'highlight') {
    const b = boxPx(a.rect, R, W, H);
    return <rect {...props} x={b.x} y={b.y} width={b.w} height={b.h} fill={a.color} fillOpacity={0.4} style={{ mixBlendMode: 'multiply', ...style }} />;
  }
  if (a.type === 'redact') {
    const b = boxPx(a.rect, R, W, H);
    // Miniaturas: tal como quedará al guardar.
    if (!hatchId) return <rect {...props} style={style} x={b.x} y={b.y} width={b.w} height={b.h} fill="#000" />;
    // Leer: rayado suave (se ve lo de debajo para revisarlo); al pasar el ratón, negro como quedará.
    return (
      <g {...props} className="redact-zone" style={style}>
        <rect className="redact-fill" x={b.x} y={b.y} width={b.w} height={b.h} fill={`url(#${hatchId})`} />
        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" style={{ stroke: 'var(--danger)' }} strokeWidth={1.5} />
      </g>
    );
  }
  if (a.type === 'ink') {
    const width = (a.width ?? 2) * pxPerPt;
    return (
      <g {...props} style={style}>
        {a.strokes.map((s, i) => {
          const pts = [];
          for (let j = 0; j < s.length; j += 2) pts.push(px(s[j], s[j + 1]).join(','));
          const d = pts.join(' ');
          return (
            <g key={i}>
              {hitArea && <polyline points={d} fill="none" stroke="transparent" strokeWidth={Math.max(12, width)} strokeLinecap="round" />}
              <polyline points={d} fill="none" stroke={a.color} strokeWidth={Math.max(0.6, width)} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}
      </g>
    );
  }
  if (a.type === 'image') {
    // La firma se colocó derecha con la página girada k cuartos; si ahora se ve con R, gira la diferencia.
    const b = boxPx(a.rect, R, W, H);
    const turn = (((R - (a.k ?? 0)) % 4) + 4) % 4;
    const [iw, ih] = turn % 2 ? [b.h, b.w] : [b.w, b.h];
    return (
      <g {...props} style={style} transform={`translate(${b.x + b.w / 2} ${b.y + b.h / 2}) rotate(${turn * 90})`}>
        <rect x={-iw / 2} y={-ih / 2} width={iw} height={ih} fill="transparent" />
        <image href={a.src} x={-iw / 2} y={-ih / 2} width={iw} height={ih} preserveAspectRatio="none" />
      </g>
    );
  }
  if (a.type === 'textbox') {
    // Miniaturas y vista previa de impresión (en Leer se pinta con TextBoxes.jsx, editable).
    const b = boxPx(a.rect, R, W, H);
    const turn = (((R - (a.k ?? 0)) % 4) + 4) % 4;
    const [iw, ih] = turn % 2 ? [b.h, b.w] : [b.w, b.h];
    return (
      <g {...props} style={style} transform={`translate(${b.x + b.w / 2} ${b.y + b.h / 2}) rotate(${turn * 90})`}>
        <foreignObject x={-iw / 2} y={-ih / 2} width={iw} height={ih} style={{ overflow: 'visible' }}>
          <div xmlns="http://www.w3.org/1999/xhtml" style={{ ...textboxCss(a, pxPerPt), width: iw }}>{a.text}</div>
        </foreignObject>
      </g>
    );
  }
  if (a.type === 'note' && svgNotes) {
    const [x, y] = px(...a.at);
    const s = Math.max(4, NOTE_PT * pxPerPt);
    return <rect {...props} style={style} x={x} y={y} width={s} height={s} rx={s * 0.2} fill={a.color ?? '#FFD400'} stroke="rgb(0 0 0 / 0.3)" strokeWidth={0.5} />;
  }
  return null;
}

/**
 * Vista previa de solo lectura (miniaturas): anotaciones y valores de formulario cambiados.
 * Va encima del canvas de PageImage, en un contenedor con position: relative.
 */
export function AnnotPreview({ page, cssWidth }) {
  const edited = page.fields && Object.keys(page.fields).length > 0;
  const [fields, setFields] = useState(null);

  useEffect(() => {
    if (!edited || !page.hasForm) return undefined;
    let alive = true;
    pdf.fields(page.docId, page.index).then((f) => alive && setFields(f)).catch(() => {});
    return () => { alive = false; };
  }, [edited, page.docId, page.index, page.hasForm]);

  if (!page.annots?.length && !edited) return null;

  const R = pageTurn(page);
  const { w: wPts, h: hPts } = displaySize(page);
  const W = cssWidth;
  const H = Math.round((cssWidth * hPts) / wPts);
  const pxPerPt = W / wPts;

  return (
    <svg width={W} height={H} className="pointer-events-none absolute inset-0" aria-hidden="true">
      {[...page.annots].sort(byLayer).map((a) => <AnnotShape key={a.id} a={a} W={W} H={H} R={R} pxPerPt={pxPerPt} svgNotes />)}
      {fields?.map((f) => {
        if (!(f.annotIndex in page.fields)) return null;
        const v = page.fields[f.annotIndex];
        const text = f.type === 'checkbox' || f.type === 'radio' ? (v ? '✓' : '')
          : f.type === 'combo' || f.type === 'list' ? (f.options[v] ?? '')
            : f.password ? '•'.repeat(String(v).length) : String(v);
        const b = boxPx(f.rect, R, W, H);
        const [w, h] = R % 2 ? [b.h, b.w] : [b.w, b.h];
        const center = f.type === 'checkbox' || f.type === 'radio';
        return (
          <g key={f.annotIndex} transform={`translate(${b.x + b.w / 2} ${b.y + b.h / 2}) rotate(${R * 90})`}>
            <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#fff" />
            <text
              x={center ? 0 : -w / 2 + Math.min(2, w * 0.05)}
              y={h * 0.2}
              textAnchor={center ? 'middle' : 'start'}
              fontSize={Math.max(1, h * 0.6)}
              fill="#121216"
              fontFamily="Inter Variable, sans-serif"
            >
              {text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
