import { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { renderPage, scaleFor } from '../engine/client.js';
import { createTurns, drawLatest } from '../renderDraw.js';

/** Tamaño visible de una página en puntos, teniendo en cuenta la rotación del usuario. */
export function displaySize(page) {
  return page.rot % 2 ? { w: page.height, h: page.width } : { w: page.width, h: page.height };
}

const COMPACT_BELOW = 180; // px de ancho: por debajo, el aviso de error es solo un icono

/**
 * Dibuja una página en un canvas; solo la renderiza cuando está cerca de la vista.
 * Mientras no hay imagen, un esqueleto con la proporción exacta de la página (el diseño no salta);
 * al llegar, la imagen se funde encima. Solo cuenta el ÚLTIMO render pedido: un render obsoleto
 * que falle no marca la página como rota (ver src/renderDraw.js).
 */
export default function PageImage({ page, cssWidth, rootRef }) {
  const canvasRef = useRef(null);
  const turns = useRef(createTurns());
  const [visible, setVisible] = useState(false);
  const [drawn, setDrawn] = useState(false);   // ya hay alguna imagen en el canvas
  const [failed, setFailed] = useState(false);
  const { w, h } = displaySize(page);
  const cssHeight = Math.round((cssWidth * h) / w);
  const compact = cssWidth < COMPACT_BELOW;

  useEffect(() => {
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: rootRef?.current ?? null,
      rootMargin: '800px',
    });
    io.observe(canvasRef.current);
    return () => io.disconnect();
  }, [rootRef]);

  // Otra página u otro giro: la imagen anterior ya no vale.
  useEffect(() => { setDrawn(false); }, [page.docId, page.index, page.rot, page.created]);

  useEffect(() => {
    if (!visible) return;
    const turn = turns.current.next();
    setFailed(false); // cada render nuevo empieza sin aviso
    const scale = scaleFor(w, cssWidth);
    drawLatest(
      turn,
      (fresh) => renderPage(page, scale, { fresh }),
      (bmp) => {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext('2d');
        // Primero comprobar que se puede dibujar (un bitmap cerrado lanza aquí), luego cambiar el tamaño.
        if (!(bmp.width > 0)) throw new Error('bitmap cerrado');
        c.width = bmp.width;
        c.height = bmp.height;
        ctx.drawImage(bmp, 0, 0);
      },
    ).then((r) => {
      if (r === 'drawn' && turn.current()) { setDrawn(true); setFailed(false); }
    }).catch((e) => {
      if (!turn.current()) return; // error de un render que ya no importa
      console.warn('[SpiderPDF] No se pudo mostrar la página', page.index + 1, e);
      setFailed(true);
    });
  }, [visible, page.docId, page.index, page.rot, page.created, w, cssWidth]);

  return (
    <div className="relative" style={{ width: cssWidth, height: cssHeight }} aria-busy={!drawn && !failed}>
      {!drawn && <div className="paper-skeleton absolute inset-0" aria-hidden="true" />}
      <canvas
        ref={canvasRef}
        className={`paper block h-full w-full transition-opacity duration-150 ${drawn ? 'opacity-100' : 'opacity-0'}`}
      />
      {failed && !drawn && (compact ? (
        <span
          role="img"
          aria-label="No se pudo mostrar esta página"
          title="No se pudo mostrar esta página"
          className="absolute inset-0 grid place-items-center text-[#6C6C75]"
        >
          <ImageOff size={18} strokeWidth={1.75} />
        </span>
      ) : (
        <p role="status" className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-[#6C6C75] [text-wrap:balance]">
          No se pudo mostrar esta página
        </p>
      ))}
    </div>
  );
}
