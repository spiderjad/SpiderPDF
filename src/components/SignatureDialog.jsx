import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Eraser, Upload, PenLine, ImageUp } from 'lucide-react';
import {
  removeBackground, alphaBounds, padBounds, strokeWidth, catmullRomSegments, MIN_POINT_DIST,
  loadRecent, rememberSignature, forgetSignature,
} from '../signature.js';
import { useT } from '../i18n/index.js';

const PAD_W = 520;
const PAD_H = 200;
const INKS = [['#121216', 'reader.sig.inkBlack'], ['#1F3A93', 'reader.sig.inkBlue']]; // [color, clave del nombre]
const BASE_W = 2.5; // grosor base del trazo, en px del lienzo
const store = (() => { try { return window.localStorage; } catch { return undefined; } })();

/**
 * Modal de firma: dibujarla o subir una imagen (con el fondo quitado y recortada),
 * y reutilizar las últimas. onPlace({ src, width, height }) recibe un PNG transparente.
 */
export default function SignatureDialog({ onPlace, onClose }) {
  const t = useT();
  const [tab, setTab] = useState('draw');
  const [recent, setRecent] = useState(() => loadRecent(store));
  const [remember, setRemember] = useState(true);
  const [result, setResult] = useState(null); // { src, width, height } listo para colocar
  const dialogRef = useRef(null);

  // Foco dentro del diálogo, Esc para cerrar, Tab sin salir de él; al cerrar, el foco vuelve donde estaba.
  useEffect(() => {
    const prev = document.activeElement;
    dialogRef.current?.querySelector('[data-autofocus]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const els = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]')];
      if (!els.length) return;
      const first = els[0]; const last = els.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onClose]);

  const place = (sig, save = remember) => {
    if (save) setRecent(rememberSignature(store, sig));
    onPlace(sig);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="motion-pop absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onPointerDown={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sig-title"
        className="motion-pop relative flex max-h-full w-[600px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 id="sig-title" className="text-lg font-semibold tracking-tight">{t('reader.sig.title')}</h2>
            <p className="mt-0.5 text-xs text-muted">{t('reader.sig.intro')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('reader.common.close')} className="-mr-2 -mt-1 rounded-lg p-1.5 text-muted transition-colors hover:bg-hover hover:text-ink">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {recent.length > 0 && (
            <section aria-label={t('reader.sig.recent')} className="mb-5">
              <h3 className="mb-2 text-xs font-medium text-muted">{t('reader.sig.recent')}</h3>
              <ul className="flex flex-wrap gap-2">
                {recent.map((s) => (
                  <li key={s.src} className="group relative">
                    <button
                      type="button"
                      onClick={() => place(s, true)}
                      title={t('reader.sig.use')}
                      className="grid h-14 w-32 place-items-center rounded-lg border border-line bg-white p-1.5 transition-colors hover:border-accent"
                    >
                      <img src={s.src} alt={t('reader.sig.savedAlt')} className="max-h-full max-w-full object-contain" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecent(forgetSignature(store, s.src))}
                      aria-label={t('reader.sig.forget')}
                      title={t('reader.sig.forget')}
                      className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-line bg-panel text-muted opacity-0 shadow-card transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100"
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div role="tablist" aria-label={t('reader.sig.how')} className="mb-4 inline-flex rounded-lg bg-hover p-0.5">
            {[['draw', t('reader.sig.draw'), PenLine], ['upload', t('reader.sig.upload'), ImageUp]].map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                data-autofocus={id === 'draw' ? '' : undefined}
                onClick={() => { setTab(id); setResult(null); }}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors ${tab === id ? 'bg-panel text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink'}`}
              >
                <Icon size={15} strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>

          {tab === 'draw' ? <DrawPad onChange={setResult} /> : <UploadPad onChange={setResult} />}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            {t('reader.sig.remember')}
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-line px-3.5 text-sm font-medium transition-colors hover:bg-hover">
              {t('reader.sig.cancel')}
            </button>
            <button
              type="button"
              disabled={!result}
              onClick={() => place(result)}
              className="h-9 rounded-lg bg-inverse px-3.5 text-sm font-medium text-on-inverse transition-[background-color,scale] hover:bg-inverse-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {t('reader.sig.place')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Dibujar ---------------------------------------------------------------------------------
function DrawPad({ onChange }) {
  const t = useT();
  const canvasRef = useRef(null);
  const strokes = useRef([]);   // [[{ x, y, w }]] en px CSS
  const current = useRef(null);
  const [ink, setInk] = useState(INKS[1][0]);
  const [empty, setEmpty] = useState(true);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const redraw = (color = ink) => {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PAD_W, PAD_H);
    for (const s of strokes.current) drawStroke(ctx, s, color);
  };

  useLayoutEffect(() => {
    const c = canvasRef.current;
    c.width = PAD_W * dpr;
    c.height = PAD_H * dpr;
    redraw();
  }, []);

  // Al cambiar el color se repinta todo y se vuelve a exportar.
  useEffect(() => { redraw(ink); if (strokes.current.length) onChange(exportPad(strokes.current, ink, dpr)); }, [ink]);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PAD_W, y: ((e.clientY - r.top) / r.height) * PAD_H, t: e.timeStamp };
  };

  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { canvasRef.current.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
    const p = pos(e);
    const pen = e.pointerType === 'pen' && e.pressure > 0;
    current.current = { pts: [{ x: p.x, y: p.y, w: pen ? BASE_W * (0.5 + e.pressure) : BASE_W }], last: p, pending: null };
    strokes.current.push(current.current.pts);
    setEmpty(false);
    redraw();
  };

  const addPoint = (s, ev, force = false) => {
    const p = pos(ev);
    const dist = Math.hypot(p.x - s.last.x, p.y - s.last.y);
    if (dist < MIN_POINT_DIST && !force) { s.pending = ev; return; } // filtrar puntos demasiado cercanos
    if (dist === 0) return;
    const speed = dist / Math.max(1, p.t - s.last.t);
    const target = ev.pointerType === 'pen' && ev.pressure > 0 ? BASE_W * (0.5 + ev.pressure) : strokeWidth(speed, BASE_W);
    s.pts.push({ x: p.x, y: p.y, w: s.pts.at(-1).w * 0.7 + target * 0.3 }); // grosor suavizado
    s.last = p;
    s.pending = null;
  };

  const move = (e) => {
    const s = current.current;
    if (!s) return;
    // Eventos agrupados: con trackpad y lápiz llegan varios puntos por frame.
    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    const events = coalesced?.length ? coalesced : [e.nativeEvent];
    for (const ev of events) addPoint(s, ev);
    redraw();
  };

  const up = (e) => {
    const s = current.current;
    if (!s) return;
    if (e?.clientX !== undefined) addPoint(s, e.nativeEvent ?? e, true); // el final del trazo no se pierde
    else if (s.pending) addPoint(s, s.pending, true);
    redraw();
    current.current = null;
    onChange(exportPad(strokes.current, ink, dpr));
  };

  const clear = () => {
    strokes.current = [];
    setEmpty(true);
    redraw();
    onChange(null);
  };

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-line bg-white">
        <canvas
          ref={canvasRef}
          aria-label={t('reader.sig.padLabel')}
          className="block h-auto w-full cursor-crosshair touch-none"
          style={{ aspectRatio: `${PAD_W} / ${PAD_H}` }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
        <div className="pointer-events-none absolute inset-x-8 bottom-12 border-b border-dashed border-[#C4C4CA]" />
        {empty && (
          <p className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-sm text-[#6C6C75]">{t('reader.sig.signHere')}</p>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div role="radiogroup" aria-label={t('reader.sig.inkColor')} className="flex items-center gap-1.5">
          {INKS.map(([hex, name]) => (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={ink === hex}
              onClick={() => setInk(hex)}
              className={`flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm transition-colors ${ink === hex ? 'bg-accent-soft font-medium text-accent-ink ring-1 ring-inset ring-accent/15' : 'hover:bg-hover'}`}
            >
              <span className="size-3.5 rounded-full" style={{ background: hex }} />
              {t(name)}
            </button>
          ))}
        </div>
        <button type="button" onClick={clear} disabled={empty} className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-50">
          <Eraser size={16} strokeWidth={1.75} className="text-muted" />
          {t('reader.sig.clear')}
        </button>
      </div>
    </div>
  );
}

/** Trazo suavizado: Catmull-Rom (pasa por todos los puntos) dibujada como Bézier, con grosor variable. */
function drawStroke(ctx, pts, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (const s of catmullRomSegments(pts)) {
    ctx.beginPath();
    ctx.lineWidth = s.w;
    ctx.moveTo(...s.from);
    ctx.bezierCurveTo(...s.c1, ...s.c2, ...s.to);
    ctx.stroke();
  }
}

/** Pinta los trazos en alta resolución y recorta al contenido. */
function exportPad(strokes, color, dpr) {
  const k = Math.max(2, dpr);
  const c = document.createElement('canvas');
  c.width = PAD_W * k;
  c.height = PAD_H * k;
  const ctx = c.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  for (const s of strokes) drawStroke(ctx, s, color);
  return cropToContent(c, ctx.getImageData(0, 0, c.width, c.height), Math.round(6 * k));
}

function cropToContent(canvas, img, pad) {
  const b = alphaBounds(img);
  if (!b) return null;
  const r = padBounds(b, pad, img.width, img.height);
  const out = document.createElement('canvas');
  out.width = r.w;
  out.height = r.h;
  out.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return { src: out.toDataURL('image/png'), width: r.w, height: r.h };
}

// --- Subir imagen ------------------------------------------------------------------------------
function UploadPad({ onChange }) {
  const t = useT();
  const [source, setSource] = useState(null);  // { canvas, data } imagen original reducida
  const [removeBg, setRemoveBg] = useState(true);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!source) return;
    const img = removeBg ? removeBackground(source.data) : source.data;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    const sig = cropToContent(c, img, 4);
    setPreview(sig);
    onChange(sig);
    if (!sig) setError(t('reader.sig.noSignature'));
  }, [source, removeBg]);

  const load = async (file) => {
    setError(null);
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) { setError(t('reader.sig.badType')); return; }
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      setSource({ data: ctx.getImageData(0, 0, c.width, c.height) });
    } catch {
      setError(t('reader.sig.readError'));
    }
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); load(e.dataTransfer.files[0]); }}
        className={`checker grid min-h-[200px] place-items-center rounded-xl border-2 border-dashed p-4 transition-colors ${over ? 'border-accent bg-accent-soft' : 'border-line-strong'}`}
      >
        {preview ? (
          <img src={preview.src} alt={t('reader.sig.previewAlt')} className="max-h-40 max-w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center text-center">
            <Upload size={22} strokeWidth={1.75} className="mb-2 text-muted" />
            <p className="text-sm">{t('reader.sig.dropHint')}</p>
            <p className="mt-0.5 text-xs text-muted">{t('reader.sig.dropTip')}</p>
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { load(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          {t('reader.sig.removeBg')}
        </label>
        <button type="button" onClick={() => inputRef.current?.click()} className="flex h-8 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium transition-colors hover:bg-hover">
          <ImageUp size={16} strokeWidth={1.75} className="text-muted" />
          {t('reader.sig.choose')}
        </button>
      </div>
    </div>
  );
}
