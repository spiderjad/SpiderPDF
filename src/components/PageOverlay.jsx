import { useEffect, useId, useRef, useState } from 'react';
import { GripHorizontal, StickyNote, Trash2 } from 'lucide-react';
import {
  toDisplay, fromDisplay, rectToDisplay, rectFromDisplay, moveAnnot, annotBounds,
} from '../geometry.js';
import { pdf } from '../engine/client.js';
import { displaySize } from './PageImage.jsx';
import { AnnotShape, NOTE_PT, boxPx, pageTurn } from './AnnotShapes.jsx';
import TextLayer from './TextLayer.jsx';
import TextBoxes from './TextBoxes.jsx';
import { caretAt, charIndexAt, wordAt, lineRects } from '../textGeom.js';

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const RESIZABLE = new Set(['image', 'redact', 'highlight', 'textbox']);
const CORNERS = ['nw', 'ne', 'sw', 'se'];
const NO_CONFLICTS = { annots: new Set(), texts: new Set() };

/**
 * Capa sobre una página en modo Leer. Orden de abajo arriba (lo de arriba tapa lo de abajo):
 *   1. resaltados y tinta (SVG base, que además recibe el dibujo)
 *   2. notas   3. firmas y texto nuevo   4. texto editado   5. campos de formulario
 *   6. zonas a redactar, avisos de conflicto, selección y asas (siempre encima)
 * Trabaja en fracciones de pantalla y guarda en fracciones sin rotar.
 */
export default function PageOverlay({
  page, cssWidth, tool, color, annotSel, conflicts = NO_CONFLICTS, dispatch,
  textSel, onTextSel, searchHits = [], currentHit = null, scanned = false, canFill = true,
  editingBox = null, onEditBox, onDoneBox, onCreateTextBox,
}) {
  const R = pageTurn(page);
  const { w: wPts, h: hPts } = displaySize(page);
  const W = cssWidth;
  const H = Math.round((cssWidth * hPts) / wPts);
  const pxPerPt = W / wPts;
  const hatchId = `hatch-${useId().replace(/:/g, '')}`;

  const svgRef = useRef(null);
  const drag = useRef(null);
  const [draft, setDraft] = useState(null);
  const [fields, setFields] = useState([]);
  // Texto con cajas por carácter: se pide cuando la página se acerca a la vista (y al pasar el ratón).
  const [chars, setChars] = useState(null);
  const charsRef = useRef(null);
  charsRef.current = chars;
  const rootRef = useRef(null);
  const [textCursor, setTextCursor] = useState(false);
  const loadChars = () => {
    if (charsRef.current) return Promise.resolve(charsRef.current);
    return pdf.pageChars(page).then((c) => { charsRef.current = c; setChars(c); return c; }).catch(() => null);
  };
  useEffect(() => {
    setChars(null);
    charsRef.current = null;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { loadChars(); io.disconnect(); } }, { rootMargin: '600px' });
    if (rootRef.current) io.observe(rootRef.current);
    return () => io.disconnect();
  }, [page.docId, page.index, page.ocr]); // page.ocr: al reconocer el texto (OCR) se puede seleccionar

  useEffect(() => {
    if (!page.hasForm) return undefined;
    let alive = true;
    pdf.fields(page.docId, page.index).then((f) => alive && setFields(f)).catch(() => {});
    return () => { alive = false; };
  }, [page.docId, page.index, page.hasForm]);

  const selectedId = annotSel?.key === page.key ? annotSel.id : null;
  const drawing = tool === 'highlight' || tool === 'ink' || tool === 'note' || tool === 'redact' || tool === 'textbox';
  const editingId = editingBox?.key === page.key ? editingBox.id : null;
  const rectTool = (t) => t === 'highlight' || t === 'redact';

  const pt = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  };

  // --- Dibujar con las herramientas -------------------------------------------
  const onBackgroundDown = (e) => {
    if (e.button !== 0) return;
    const p = pt(e);
    if (tool === 'select') {
      if (annotSel) dispatch({ type: 'selectAnnot' });
      const start = fromDisplay(...p, R);
      const c = charsRef.current;
      if (!c) {
        // Aún no han llegado los caracteres: el arrastre empieza en cuanto lleguen.
        e.preventDefault();
        try { svgRef.current.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
        drag.current = { mode: 'textsel', anchor: null, start };
        loadChars().then((ch) => {
          const g = drag.current;
          if (!ch || g?.mode !== 'textsel' || g.anchor !== null) return;
          g.anchor = caretAt(ch.boxes, ch.generated, ...g.start);
          if (g.anchor < 0) { drag.current = null; onTextSel?.(null); return; }
          onTextSel?.({ key: page.key, a: g.anchor, b: g.last ?? g.anchor });
        });
        return;
      }
      const caret = caretAt(c.boxes, c.generated, ...start);
      if (caret < 0) { onTextSel?.(null); return; }
      e.preventDefault();
      try { svgRef.current.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
      drag.current = { mode: 'textsel', anchor: caret };
      onTextSel?.({ key: page.key, a: caret, b: caret });
      return;
    }
    if (!drawing) return;
    e.preventDefault();
    e.stopPropagation();
    // Texto nuevo: un clic fuera del cuadro que se está escribiendo solo termina (no crea otro).
    if (tool === 'textbox' && editingBox) { onDoneBox?.(editingBox.key, editingBox.id); return; }
    if (tool === 'note') {
      dispatch({ type: 'addAnnot', key: page.key, annot: { type: 'note', at: fromDisplay(...p, R), text: '', color } });
      return;
    }
    try { svgRef.current.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
    // El borrador vive en la referencia (siempre al día) y se copia al estado para pintarlo.
    const first = tool === 'ink' ? { pts: [...p] } : { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
    drag.current = { mode: tool, start: p, draft: first };
    setDraft(first);
  };

  // --- Seleccionar, mover y redimensionar -----------------------------------------
  const onAnnotDown = (e, a, mode = 'move', corner = null) => {
    if (tool === 'redact' && a.type === 'redact') { onBackgroundDown(e); return; } // dibujar otra zona encima
    const can = tool === 'select' || (tool === 'textbox' && a.type === 'textbox');
    if (!can || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    dispatch({ type: 'selectAnnot', key: page.key, id: a.id });
    try { svgRef.current.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
    const d = a.rect ? rectToDisplay(a.rect, R) : null;
    drag.current = { mode, corner, start: pt(e), annot: a, rect: d, moved: false };
  };

  // Cuadro de texto: con «Texto nuevo» un clic lo edita; con Seleccionar se mueve (doble clic, editar).
  const onBoxDown = (e, a) => {
    if (tool === 'textbox' && e.button === 0) {
      e.stopPropagation();
      e.preventDefault();
      dispatch({ type: 'selectAnnot', key: page.key, id: a.id });
      onEditBox?.(page.key, a.id);
      return;
    }
    onAnnotDown(e, a);
  };

  const onMove = (e) => {
    const g = drag.current;
    if (!g) {
      // Cursor de texto sobre las letras (solo con Seleccionar).
      if (tool === 'select' && chars) {
        const over = charIndexAt(chars.boxes, chars.generated, ...fromDisplay(...pt(e), R)) >= 0;
        if (over !== textCursor) setTextCursor(over);
      }
      return;
    }
    const p = pt(e);
    if (g.mode === 'textsel') {
      const c = charsRef.current;
      if (!c) return;
      const caret = caretAt(c.boxes, c.generated, ...fromDisplay(...p, R));
      if (caret < 0) return;
      g.last = caret;
      if (g.anchor === null) g.anchor = caretAt(c.boxes, c.generated, ...g.start);
      if (g.anchor >= 0) onTextSel?.({ key: page.key, a: g.anchor, b: caret });
      return;
    }
    if (rectTool(g.mode) || g.mode === 'textbox') { g.draft = { ...g.draft, x1: p[0], y1: p[1] }; setDraft(g.draft); }
    else if (g.mode === 'ink') { g.draft = { pts: [...g.draft.pts, ...p] }; setDraft(g.draft); }
    else if (g.mode === 'move') {
      const dx = p[0] - g.start[0]; const dy = p[1] - g.start[1];
      if (!g.moved && Math.hypot(dx * W, dy * H) < 3) return;
      g.moved = true;
      const { id, ...changes } = moveAnnot(g.annot, dx, dy, R);
      dispatch({ type: 'updateAnnot', key: page.key, id: g.annot.id, changes, group: true });
    } else if (g.mode === 'resize') {
      // La esquina opuesta queda fija. Las firmas mantienen su proporción.
      const r = g.rect;
      const ax = g.corner.includes('w') ? r.x + r.w : r.x;
      const ay = g.corner[0] === 'n' ? r.y + r.h : r.y;
      const sx = g.corner.includes('w') ? -1 : 1;
      const sy = g.corner[0] === 'n' ? -1 : 1;
      let wPx = Math.max(8, (p[0] - ax) * sx * W);
      let hPx = Math.max(8, (p[1] - ay) * sy * H);
      if (g.annot.type === 'image') {
        const aspect = (r.h * H) / (r.w * W);
        hPx = wPx * aspect;
      }
      // Sin salirse de la página.
      wPx = Math.min(wPx, (sx > 0 ? 1 - ax : ax) * W);
      hPx = Math.min(hPx, (sy > 0 ? 1 - ay : ay) * H);
      if (g.annot.type === 'image') wPx = Math.min(wPx, hPx * ((r.w * W) / (r.h * H)));
      const w = wPx / W; const h = hPx / H;
      const disp = { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
      g.moved = true;
      dispatch({ type: 'updateAnnot', key: page.key, id: g.annot.id, changes: { rect: rectFromDisplay(disp, R) }, group: true });
    }
  };

  const onUp = (e) => {
    const g = drag.current;
    if (g && e?.clientX !== undefined && (rectTool(g.mode) || g.mode === 'ink' || g.mode === 'textsel' || g.mode === 'textbox')) onMove(e); // incluir el punto final
    drag.current = null;
    if (!g) return;
    if (g.mode === 'textsel') return;
    const draft = g.draft;
    if (rectTool(g.mode) && draft) {
      const disp = { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) };
      if (disp.w * W >= 4 && disp.h * H >= 4) {
        const rect = rectFromDisplay(disp, R);
        dispatch({ type: 'addAnnot', key: page.key, annot: g.mode === 'redact' ? { type: 'redact', rect } : { type: 'highlight', rect, color } });
      }
    } else if (g.mode === 'textbox' && draft) {
      // Arrastrar: el cuadro con ese tamaño. Clic: un cuadro de una línea donde se hizo clic.
      const disp = { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) };
      const click = disp.w * W < 8 || disp.h * H < 8;
      onCreateTextBox?.(page, click ? { x: draft.x0, y: draft.y0 } : disp, click);
    } else if (g.mode === 'ink' && draft && draft.pts.length >= 4) {
      const stroke = [];
      for (let i = 0; i < draft.pts.length; i += 2) stroke.push(...fromDisplay(draft.pts[i], draft.pts[i + 1], R));
      dispatch({ type: 'addAnnot', key: page.key, annot: { type: 'ink', strokes: [stroke], color, width: 2 } });
    } else if (g.moved) {
      dispatch({ type: 'endGroup' });
    }
    setDraft(null);
  };

  // --- Pintar -------------------------------------------------------------------------------
  const px = (u, v) => { const [x, y] = toDisplay(u, v, R); return [x * W, y * H]; };
  const box = (rect) => boxPx(rect, R, W, H);
  const notePx = Math.max(18, NOTE_PT * pxPerPt);
  const interactive = tool === 'select' ? 'auto' : 'none';
  const shape = (a, extra = {}) => (
    <AnnotShape
      key={a.id}
      a={a} W={W} H={H} R={R} pxPerPt={pxPerPt}
      hitArea
      onPointerDown={(e) => onAnnotDown(e, a)}
      style={{ pointerEvents: interactive, cursor: tool === 'select' ? 'move' : undefined }}
      {...extra}
    />
  );
  const byType = (t) => page.annots.filter((a) => a.type === t);

  /** Caja en pantalla de una anotación (para selección y avisos). */
  const annotBox = (a) => {
    if (a.type === 'note') { const [x, y] = px(...a.at); return { x, y, w: notePx, h: notePx }; }
    return box(a.type === 'ink' ? annotBounds(a) : a.rect);
  };

  const selAnnot = selectedId ? page.annots.find((a) => a.id === selectedId) : null;
  const mySel = textSel?.key === page.key && chars ? textSel : null;
  const selRects = mySel && mySel.a !== mySel.b
    ? lineRects(chars.boxes, chars.generated, Math.min(mySel.a, mySel.b), Math.max(mySel.a, mySel.b))
    : [];
  const selBox = selAnnot ? annotBox(selAnnot) : null;
  const HANDLE = 7;

  return (
    <div
      className="absolute inset-0"
      style={{ cursor: tool === 'textbox' ? 'text' : drawing ? 'crosshair' : textCursor ? 'text' : undefined }}
      ref={rootRef}
      onPointerEnter={() => { loadChars(); }}
    >
      {/* 1. Resaltados y tinta. Este SVG recibe también el dibujo y los arrastres. */}
      <svg
        ref={svgRef}
        width={W}
        height={H}
        className="absolute inset-0 touch-none"
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={(e) => {
          // Doble clic: la palabra entera.
          if (tool !== 'select' || !chars) return;
          const i = charIndexAt(chars.boxes, chars.generated, ...fromDisplay(...pt(e), R));
          if (i < 0) return;
          const [a, b] = wordAt(chars.text, i);
          onTextSel?.({ key: page.key, a, b });
        }}
      >
        {byType('highlight').map((a) => shape(a))}
        {byType('ink').map((a) => shape(a))}
      </svg>

      {/* 2. Notas */}
      {byType('note').map((a) => {
        const [x, y] = px(...a.at);
        return (
          <button
            key={a.id}
            type="button"
            aria-label={a.text ? `Nota: ${a.text}` : 'Nota vacía'}
            title={a.text || 'Nota'}
            onPointerDown={(e) => onAnnotDown(e, a)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onClick={() => dispatch({ type: 'selectAnnot', key: page.key, id: a.id })}
            className="absolute grid place-items-center rounded-md border border-black/25 text-[#121216] shadow-card"
            style={{ left: x, top: y, width: notePx, height: notePx, background: a.color ?? '#FFD400', pointerEvents: drawing ? 'none' : 'auto' }}
          >
            <StickyNote size={Math.round(notePx * 0.6)} strokeWidth={1.75} />
          </button>
        );
      })}

      {/* 3. Firmas */}
      <svg width={W} height={H} className="pointer-events-none absolute inset-0">
        {byType('image').map((a) => shape(a))}
      </svg>

      {/* 3b. Texto nuevo (contenido, como las firmas) */}
      <TextBoxes
        page={page} W={W} H={H} R={R} pxPerPt={pxPerPt} tool={tool}
        editingId={editingId} onEdit={onEditBox} onDone={onDoneBox} onBoxDown={onBoxDown} dispatch={dispatch}
      />

      {/* 4. Texto existente (editado) */}
      <TextLayer page={page} W={W} H={H} R={R} pxPerPt={pxPerPt} active={tool === 'text'} conflicts={conflicts.texts} dispatch={dispatch} />

      {/* 5. Campos de formulario: no estorban mientras se dibuja. */}
      {fields.map((f) => (
        <FieldInput key={f.annotIndex} field={canFill ? f : { ...f, readOnly: true }} page={page} b={box(f.rect)} R={R} disabled={drawing || tool === 'text'} dispatch={dispatch} />
      ))}

      {/* 6. Zonas a redactar, avisos, selección y borradores: siempre encima. */}
      <svg width={W} height={H} className="pointer-events-none absolute inset-0 touch-none">
        <defs>
          <pattern id={hatchId} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" style={{ stroke: 'var(--danger)' }} strokeWidth="2.5" strokeOpacity="0.18" />
          </pattern>
        </defs>

        {searchHits.map((h) => h.rects.map((r, i) => {
          const b = box(r);
          const cur = h === currentHit;
          return (
            <rect
              key={`s-${h.start}-${i}`}
              x={b.x - 1} y={b.y - 1} width={b.w + 2} height={b.h + 2} rx={2}
              fill={cur ? 'var(--accent)' : '#FFD400'} fillOpacity={cur ? 0.32 : 0.42}
              style={{ mixBlendMode: 'multiply', ...(cur ? { stroke: 'var(--accent)' } : null) }}
              strokeWidth={cur ? 1.5 : 0}
            />
          );
        }))}
        {selRects.map((r, i) => {
          const b = box(r);
          return <rect key={`t-${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill="var(--accent)" fillOpacity={0.28} />;
        })}

        {byType('redact').map((a) => shape(a, {
          hatchId,
          style: { pointerEvents: tool === 'select' || tool === 'redact' ? 'auto' : 'none', cursor: tool === 'select' ? 'move' : undefined },
        }))}

        {/* Lo que el usuario dejó encima de una zona: borde de aviso. */}
        {page.annots.filter((a) => conflicts.annots.has(a.id)).map((a) => {
          const b = annotBox(a);
          // Un poco por fuera del contorno de selección (1,5 px), para que se vean los dos.
          return <rect key={`c-${a.id}`} x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} rx={2} fill="none" style={{ stroke: 'var(--danger)' }} strokeWidth={1.5} />;
        })}

        {selBox && (
          <g>
            <rect x={selBox.x - 1.5} y={selBox.y - 1.5} width={selBox.w + 3} height={selBox.h + 3} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth={1} />
            {(tool === 'select' || (tool === 'textbox' && selAnnot.type === 'textbox')) && RESIZABLE.has(selAnnot.type) && CORNERS.map((c) => (
              <rect
                key={c}
                x={(c.includes('w') ? selBox.x - 1.5 : selBox.x + selBox.w + 1.5) - HANDLE / 2}
                y={(c[0] === 'n' ? selBox.y - 1.5 : selBox.y + selBox.h + 1.5) - HANDLE / 2}
                width={HANDLE} height={HANDLE}
                fill="#fff" style={{ stroke: 'var(--accent)', pointerEvents: 'auto', cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize' }}
                strokeWidth={1}
                onPointerDown={(e) => onAnnotDown(e, selAnnot, 'resize', c)}
              />
            ))}
          </g>
        )}

        {draft && 'x0' in draft && (
          <rect
            x={Math.min(draft.x0, draft.x1) * W} y={Math.min(draft.y0, draft.y1) * H}
            width={Math.abs(draft.x1 - draft.x0) * W} height={Math.abs(draft.y1 - draft.y0) * H}
            {...(tool === 'textbox'
              ? { fill: 'none', style: { stroke: 'var(--accent)' }, strokeWidth: 1, strokeDasharray: '4 3' }
              : tool === 'redact'
              ? { fill: `url(#${hatchId})`, style: { stroke: 'var(--danger)' }, strokeWidth: 1.5 }
              : { fill: color, fillOpacity: 0.4, style: { mixBlendMode: 'multiply' } })}
          />
        )}
        {draft?.pts && (
          <polyline
            points={draft.pts.reduce((acc, n, i) => acc + (i % 2 ? `,${n * H} ` : `${n * W}`), '')}
            fill="none" stroke={color} strokeWidth={2 * pxPerPt} strokeLinecap="round" strokeLinejoin="round"
          />
        )}
      </svg>

      {scanned && (
        <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-panel px-2.5 py-1 text-xs text-muted shadow-card">
          Esta página es una imagen; la búsqueda necesitará OCR
        </span>
      )}

      {/* Etiqueta de la zona seleccionada y editor de la nota: por encima de todo. */}
      {selAnnot?.type === 'redact' && (
        <span
          className="pointer-events-none absolute whitespace-nowrap rounded-md border border-danger/30 bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium leading-4 text-danger-ink shadow-card"
          style={{ left: selBox.x - 1.5, top: selBox.y > 26 ? selBox.y - 24 : selBox.y + selBox.h + 6 }}
        >
          Se borrará al guardar
        </span>
      )}
      {/* Asa para mover el cuadro de texto mientras se escribe (con «Texto nuevo» el clic edita). */}
      {selAnnot?.type === 'textbox' && tool === 'textbox' && (
        <button
          type="button"
          aria-label="Mover el cuadro de texto"
          title="Arrastra para mover el cuadro"
          onPointerDown={(e) => onAnnotDown(e, selAnnot, 'move')}
          onPointerMove={onMove}
          onPointerUp={onUp}
          className="absolute grid h-5 w-8 cursor-move place-items-center rounded-md border border-line bg-panel text-muted shadow-card"
          style={{ left: selBox.x - 1.5, top: Math.max(0, selBox.y - 26) }}
        >
          <GripHorizontal size={14} strokeWidth={1.75} />
        </button>
      )}
      {selAnnot?.type === 'note' && (
        <div className="absolute" style={{ left: selBox.x, top: selBox.y }}>
          <NoteEditor annot={selAnnot} pageKey={page.key} dispatch={dispatch} alignRight={selBox.x > W - 250} offset={notePx} />
        </div>
      )}
    </div>
  );
}

function NoteEditor({ annot, pageKey, dispatch, alignRight, offset }) {
  const ref = useRef(null);
  useEffect(() => { if (!annot.text) ref.current?.focus(); }, []); // nota nueva: escribir directamente
  return (
    <div
      className="motion-pop absolute z-20 w-60 rounded-xl border border-line bg-panel p-2 shadow-pop"
      style={{ top: offset + 6, ...(alignRight ? { right: 0 } : { left: 0 }) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <label className="sr-only" htmlFor={`note-${annot.id}`}>Texto de la nota</label>
      <textarea
        id={`note-${annot.id}`}
        ref={ref}
        rows={4}
        value={annot.text ?? ''}
        placeholder="Escribe la nota…"
        onChange={(e) => dispatch({ type: 'updateAnnot', key: pageKey, id: annot.id, changes: { text: e.target.value }, group: true })}
        onBlur={() => dispatch({ type: 'endGroup' })}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); dispatch({ type: 'selectAnnot' }); } }}
        className="block w-full resize-none rounded-lg border border-line bg-panel px-2.5 py-2 text-sm text-ink outline-none select-text placeholder:text-muted focus:border-accent"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => dispatch({ type: 'removeAnnot', key: pageKey, id: annot.id })}
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
        >
          <Trash2 size={16} strokeWidth={1.75} />
          Eliminar nota
        </button>
      </div>
    </div>
  );
}

function FieldInput({ field: f, page, b, R, disabled, dispatch }) {
  const edited = page.fields?.[f.annotIndex];
  const set = (value) => dispatch({ type: 'setField', key: page.key, annotIndex: f.annotIndex, value });
  const end = () => dispatch({ type: 'endGroup' });
  // El campo gira con la página: se dibuja con su tamaño sin rotar y se gira R cuartos de vuelta.
  const [w, h] = R % 2 ? [b.h, b.w] : [b.w, b.h];
  const style = {
    left: b.x + b.w / 2 - w / 2, top: b.y + b.h / 2 - h / 2, width: w, height: h,
    transform: R ? `rotate(${R * 90}deg)` : undefined,
    fontSize: Math.max(10, Math.min(16, h * 0.6)),
    pointerEvents: disabled ? 'none' : 'auto',
  };
  const common = { className: 'pdf-field absolute', style, disabled: f.readOnly, 'aria-label': f.name, title: f.name };

  if (f.type === 'checkbox' || f.type === 'radio') {
    return (
      <label {...common} className="pdf-field absolute grid place-items-center">
        <input
          type="checkbox"
          aria-label={f.name}
          checked={edited ?? f.checked}
          disabled={f.readOnly}
          onChange={(e) => set(e.target.checked)}
          className="size-[70%] accent-[#7C3BED]"
        />
      </label>
    );
  }
  if (f.type === 'combo' || f.type === 'list') {
    return (
      <select {...common} value={edited ?? f.selected} onChange={(e) => set(Number(e.target.value))}>
        {f.selected < 0 && edited === undefined && <option value={-1}>—</option>}
        {f.options.map((o, i) => <option key={i} value={i}>{o}</option>)}
      </select>
    );
  }
  const Tag = f.multiline ? 'textarea' : 'input';
  return (
    <Tag
      {...common}
      type={f.multiline ? undefined : f.password ? 'password' : 'text'}
      value={edited ?? f.value}
      onChange={(e) => set(e.target.value)}
      onBlur={end}
    />
  );
}
