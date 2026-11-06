import { useEffect, useRef, useState } from 'react';
import { Search, ChevronUp, ChevronDown, X, ImageOff } from 'lucide-react';
import { pdf } from '../engine/client.js';
import { normalizeQuery } from '../textGeom.js';
import { useDelayed } from '../useDelayed.js';

/**
 * Búsqueda en todo el documento: página a página en el worker (la interfaz no se bloquea),
 * con los resultados apareciendo según llegan. Cambiar la consulta cancela la búsqueda anterior.
 * hits: [{ key, page, start, end, rects }] en orden de lectura.
 */
export function useSearch(pages, open) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState([]);
  const [current, setCurrent] = useState(-1);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [imagePages, setImagePages] = useState([]); // números de página (desde 1) sin texto
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  // Solo cambia si cambian las páginas o su orden (no al anotar ni girar: el texto es el mismo).
  const signature = pages.map((p) => `${p.key}:${p.docId}:${p.index}`).join('|');

  useEffect(() => {
    setHits([]);
    setCurrent(-1);
    setImagePages([]);
    setProgress({ done: 0, total: 0 });
    if (!open || !normalizeQuery(query)) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      const list = pagesRef.current;
      const found = [];
      const images = [];
      for (let i = 0; i < list.length && alive; i++) {
        const p = list[i];
        let r = null;
        try { r = await pdf.pageSearch(p, query); } catch { /* página dañada: se salta */ }
        if (!alive) return;
        if (r && !r.hasText) images.push(i + 1);
        for (const m of r?.matches ?? []) found.push({ key: p.key, page: i, ...m });
        setHits([...found]);
        setImagePages([...images]);
        setProgress({ done: i + 1, total: list.length });
        if (found.length) setCurrent((c) => (c < 0 ? 0 : c));
      }
    }, 180); // esperar a que se deje de escribir
    return () => { alive = false; clearTimeout(timer); };
  }, [open, query, signature]);

  const step = (d) => setCurrent((c) => (hits.length ? (c + d + hits.length) % hits.length : -1));
  return {
    query, setQuery, hits, current, progress, imagePages,
    next: () => step(1), prev: () => step(-1),
    searching: progress.total > 0 && progress.done < progress.total,
  };
}

/** Lista legible de páginas: «3», «3 y 5», «3, 5 y 8». */
function pageList(nums) {
  if (nums.length === 1) return String(nums[0]);
  return `${nums.slice(0, -1).join(', ')} y ${nums.at(-1)}`;
}

export function imagePagesMessage(nums, total) {
  if (!nums.length) return null;
  if (nums.length === total) return total === 1 ? 'Esta página es una imagen; la búsqueda necesitará OCR.' : 'Este documento son imágenes; la búsqueda necesitará OCR.';
  return nums.length === 1
    ? `La página ${nums[0]} es una imagen; la búsqueda necesitará OCR.`
    : `Las páginas ${pageList(nums.slice(0, 6))}${nums.length > 6 ? ' (y más)' : ''} son imágenes; la búsqueda necesitará OCR.`;
}

/** Barra de búsqueda flotante, arriba a la derecha de la vista Leer. */
export default function SearchBar({ search, total, onClose, inputRef }) {
  const { query, setQuery, hits, current, searching, progress, imagePages, next, prev } = search;
  const has = normalizeQuery(query).length > 0;
  const showProgress = useDelayed(has && searching);
  let counter = '';
  if (has) {
    if (hits.length) counter = `${current + 1} de ${hits.length}`;
    else counter = searching ? '' : 'Sin resultados';
  }
  const note = has ? imagePagesMessage(imagePages, total) : null;

  return (
    <div role="search" className="motion-pop absolute right-6 top-3 z-30 w-[360px] rounded-xl border border-line bg-panel p-1.5 shadow-pop">
      <div className="flex items-center gap-1">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 focus-within:bg-hover">
          <Search size={16} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            aria-label="Buscar en el documento"
            placeholder="Buscar en el documento"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? prev() : next(); }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none select-text placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
          <span className="tabnum shrink-0 text-xs text-muted" aria-live="polite">{counter}</span>
        </label>
        <BarButton label="Anterior (Mayús+Intro)" icon={ChevronUp} onClick={prev} disabled={!hits.length} />
        <BarButton label="Siguiente (Intro)" icon={ChevronDown} onClick={next} disabled={!hits.length} />
        <BarButton label="Cerrar (Esc)" icon={X} onClick={onClose} />
      </div>
      {showProgress && (
        <p role="status" className="tabnum mx-1 mt-1 flex items-center gap-2 px-1.5 text-xs text-muted">
          <span className="relative block h-1 w-16 overflow-hidden rounded-full bg-hover" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.round((100 * progress.done) / Math.max(1, progress.total))}%` }} />
          </span>
          Buscando… página {Math.min(progress.done + 1, progress.total)} de {progress.total}
        </p>
      )}
      {note && (
        <p className="mx-1 mt-1.5 flex items-start gap-2 rounded-lg bg-hover px-2.5 py-2 text-xs text-muted">
          <ImageOff size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
          {note}
        </p>
      )}
    </div>
  );
}

function BarButton({ label, icon: Icon, ...props }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...props}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-ink transition-[background-color,scale] hover:bg-hover active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}
