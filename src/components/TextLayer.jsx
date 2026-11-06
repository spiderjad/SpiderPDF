import { useEffect, useRef, useState } from 'react';
import { pdf } from '../engine/client.js';
import { boxPx } from './AnnotShapes.jsx';
import { toDisplay } from '../geometry.js';
import { useT } from '../i18n/index.js';

/** Familia CSS parecida a la fuente del PDF (solo para la vista previa; al guardar se usa una estándar). */
function cssFont(name = '') {
  const n = name.toLowerCase();
  const family = /courier|mono|consol/.test(n) ? '"Courier New", Courier, monospace'
    : /times|georgia|garamond|roman|cambria|minion|serif/.test(n) && !/sans/.test(n) ? '"Times New Roman", Times, serif'
      : 'Helvetica, Arial, sans-serif';
  return {
    fontFamily: family,
    fontWeight: /bold|black|heavy|semibold|demi/.test(n) ? 700 : 400,
    fontStyle: /italic|oblique/.test(n) ? 'italic' : 'normal',
  };
}

const ASCENT = 0.87; // con line-height 1.2em, la línea base queda a 0,87em del borde superior

/**
 * Posición en pantalla de un bloque: se ancla en el inicio de su línea base y se gira desde ahí
 * (giro de la página + inclinación propia del texto). Devuelve también su ancho sin girar.
 */
function placement(run, R, W, H) {
  const b = boxPx(run.rect, R, W, H);
  const deg = R * 90 - (run.angle * 180) / Math.PI;
  const k = ((Math.round(deg / 90) % 4) + 4) % 4;
  // origin: inicio de la línea base. Si falta (motor antiguo en el worker), la esquina inferior izquierda de la caja.
  const [ox, oy] = toDisplay(...(run.origin ?? [run.rect[0], run.rect[3]]), R);
  return { x: ox * W, y: oy * H, w: k % 2 ? b.h : b.w, deg };
}

/**
 * Texto existente de una página: con la herramienta Texto se elige un bloque y se reescribe.
 * Los bloques cambiados se ven siempre (tapan el original hasta que se guarda).
 */
export default function TextLayer({ page, W, H, R, pxPerPt, active, conflicts, dispatch }) {
  const t = useT();
  const [runs, setRuns] = useState([]);
  const [editing, setEditing] = useState(null); // objIndex
  const edits = page.textEdits ?? {};
  const hasEdits = Object.keys(edits).length > 0;

  useEffect(() => {
    if (!active && !hasEdits) return undefined;
    let alive = true;
    pdf.textRuns(page.docId, page.index).then((r) => alive && setRuns(r)).catch(() => {});
    return () => { alive = false; };
  }, [active, hasEdits, page.docId, page.index]);

  useEffect(() => { if (!active) setEditing(null); }, [active]);

  const commit = (run, text) => {
    setEditing(null);
    dispatch({ type: 'setTextEdit', key: page.key, objIndex: run.objIndex, text, from: run.text });
  };

  return runs.filter((r) => !r.invisible).map((run) => {
    const edit = edits[run.objIndex];
    const { x, y, w, deg } = placement(run, R, W, H);
    const fontPx = run.ptSize * pxPerPt;
    const boxH = fontPx * 1.2;
    const frame = {
      left: x, top: y - ASCENT * fontPx, width: w, height: boxH,
      transform: deg ? `rotate(${deg}deg)` : undefined,
      transformOrigin: `0px ${ASCENT * fontPx}px`,
    };
    const textStyle = { ...cssFont(run.fontName), fontSize: fontPx, color: run.color, lineHeight: `${boxH}px` };

    if (editing === run.objIndex) {
      return (
        <TextEditor
          key={run.objIndex}
          initial={edit?.text ?? run.text}
          style={{ ...frame, ...textStyle, minWidth: w, width: Math.max(w, ((edit?.text ?? run.text).length + 4) * fontPx * 0.55) }}
          onCommit={(text) => commit(run, text)}
          onCancel={() => setEditing(null)}
        />
      );
    }
    return (
      <div key={run.objIndex} className="absolute" style={{ ...frame, pointerEvents: active ? 'auto' : 'none' }}>
        {edit && (
          <div
            className="absolute inset-y-0 -left-px overflow-visible whitespace-pre rounded-[2px] bg-white pr-1"
            style={{ ...textStyle, minWidth: w + 2, ...(conflicts?.has(run.objIndex) ? { boxShadow: '0 0 0 1.5px var(--danger)' } : null) }}
          >
            {edit.text}
          </div>
        )}
        {active && (
          <button
            type="button"
            aria-label={t('reader.text.editAria', { text: edit?.text ?? run.text })}
            title={t('reader.text.editTitle')}
            onClick={() => setEditing(run.objIndex)}
            className="absolute -inset-0.5 rounded-sm transition-colors hover:bg-[#7C3BED]/10 hover:ring-1 hover:ring-[#7C3BED]"
          />
        )}
      </div>
    );
  });
}

function TextEditor({ initial, style, onCommit, onCancel }) {
  const t = useT();
  const ref = useRef(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (save) => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(ref.current.value);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      aria-label={t('reader.text.input')}
      defaultValue={initial}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      className="pdf-text-edit absolute"
      style={style}
    />
  );
}
