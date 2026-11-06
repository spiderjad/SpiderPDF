import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { rectFromDisplay } from '../geometry.js';
import { boxPx } from './AnnotShapes.jsx';
import { pdfFontFamily, registerFamilies, textboxCss } from '../fonts.js';

/**
 * Cuadros de texto nuevo de una página en Leer (por encima de las firmas). Se ven como saldrán; el que se
 * edita es un textarea con el mismo aspecto, que crece hacia abajo al escribir. Esc o clic fuera terminan
 * (onDone). Con Seleccionar se mueven (onBoxDown); con «Texto nuevo», un clic edita el cuadro.
 */
export default function TextBoxes({ page, W, H, R, pxPerPt, tool, editingId, onEdit, onDone, onBoxDown, dispatch }) {
  useEffect(() => { registerFamilies(); }, []);
  return page.annots.filter((a) => a.type === 'textbox').map((a) => (
    <TextBox
      key={a.id}
      a={a} page={page} W={W} H={H} R={R} pxPerPt={pxPerPt} tool={tool}
      editing={editingId === a.id}
      onEdit={onEdit} onDone={onDone} onBoxDown={onBoxDown} dispatch={dispatch}
    />
  ));
}

function TextBox({ a, page, W, H, R, pxPerPt, tool, editing, onEdit, onDone, onBoxDown, dispatch }) {
  const ref = useRef(null);
  const [pdfFamily, setPdfFamily] = useState(null);
  const pdfObj = a.style.usePdf ? a.style.pdf?.objIndex : undefined;
  useEffect(() => {
    if (pdfObj === undefined || page.docId == null) { setPdfFamily(null); return undefined; }
    let alive = true;
    pdfFontFamily(page.docId, page.index, pdfObj).then((n) => { if (alive) setPdfFamily(n); });
    return () => { alive = false; };
  }, [page.docId, page.index, pdfObj]);

  const b = boxPx(a.rect, R, W, H);
  const turn = (((R - (a.k ?? 0)) % 4) + 4) % 4; // si la página se giró después, el cuadro gira con ella
  const [w, h] = turn % 2 ? [b.h, b.w] : [b.w, b.h];
  const frame = {
    position: 'absolute', left: b.x + b.w / 2 - w / 2, top: b.y + b.h / 2 - h / 2, width: w, height: h,
    transform: turn ? `rotate(${turn * 90}deg)` : undefined, transformOrigin: 'center',
  };
  const css = textboxCss(a, pxPerPt, pdfFamily);

  // Al escribir, el cuadro crece hacia abajo para que quepa el texto (si se ve en su orientación).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!editing || !el || turn !== 0) return;
    if (el.scrollHeight > h + 1) {
      const disp = { x: b.x / W, y: b.y / H, w: b.w / W, h: Math.min(1 - b.y / H, el.scrollHeight / H) };
      dispatch({ type: 'updateAnnot', key: page.key, id: a.id, changes: { rect: rectFromDisplay(disp, R) }, group: true });
    }
  });

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  if (editing) {
    return (
      <textarea
        ref={ref}
        aria-label="Texto del cuadro"
        value={a.text}
        spellCheck
        onChange={(e) => dispatch({ type: 'updateAnnot', key: page.key, id: a.id, changes: { text: e.target.value }, group: true })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(page.key, a.id); }
          e.stopPropagation(); // Supr, Ctrl+D… dentro del texto no son atajos de la app
        }}
        onBlur={() => onDone(page.key, a.id)}
        onPointerDown={(e) => e.stopPropagation()}
        className="textbox-editing"
        style={{ ...frame, ...css, background: 'transparent', border: 0, margin: 0, padding: 0, resize: 'none', overflow: 'hidden', outline: '1px dashed var(--accent)', outlineOffset: 2 }}
      />
    );
  }
  const interactive = tool === 'select' || tool === 'textbox';
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={`Cuadro de texto: ${a.text}`}
      data-textbox={a.id}
      onPointerDown={(e) => onBoxDown(e, a)}
      onDoubleClick={() => onEdit(page.key, a.id)}
      style={{ ...frame, ...css, pointerEvents: interactive ? 'auto' : 'none', cursor: tool === 'select' ? 'move' : 'text', userSelect: 'none' }}
    >
      {a.text}
    </div>
  );
}
