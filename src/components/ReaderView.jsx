import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import PageImage, { displaySize } from './PageImage.jsx';
import PageOverlay from './PageOverlay.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { pageTurn } from './AnnotShapes.jsx';
import PageSidebar from './PageSidebar.jsx';
import { rectToDisplay } from '../geometry.js';

const PT_TO_PX = 96 / 72; // 100 % = tamaño real en pantalla

export default function ReaderView({ state, dispatch, ref, tool, colors, conflicts, textSel, onTextSel, search, policy, textBoxes }) {
  const scrollRef = useRef(null);
  const pageEls = useRef([]);
  const ratios = useRef(new Map());
  const currentRef = useRef(state.current);
  currentRef.current = state.current;

  // Durante un salto (marcador, miniatura) el desplazamiento suave pasa por otras páginas: la página
  // actual se queda en la de destino hasta que termina, para que Eliminar o Girar no actúen sobre una
  // página de paso. Se suelta al acabar (scrollend), si el usuario toma el control o, por si acaso, a 1,5 s.
  const jumping = useRef(null);
  const endJump = () => { clearTimeout(jumping.current?.timer); jumping.current = null; };
  const goTo = (i, behavior = 'auto') => {
    const el = pageEls.current[i];
    if (!el) return;
    if (behavior === 'smooth') {
      endJump();
      jumping.current = { timer: setTimeout(endJump, 1500) };
    }
    el.scrollIntoView({ block: 'start', behavior });
  };
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return undefined;
    const userTakesOver = () => endJump();
    sc.addEventListener('scrollend', endJump);
    sc.addEventListener('wheel', userTakesOver, { passive: true });
    sc.addEventListener('pointerdown', userTakesOver);
    sc.addEventListener('keydown', userTakesOver);
    return () => {
      endJump();
      sc.removeEventListener('scrollend', endJump);
      sc.removeEventListener('wheel', userTakesOver);
      sc.removeEventListener('pointerdown', userTakesOver);
      sc.removeEventListener('keydown', userTakesOver);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    fitWidth() {
      const el = scrollRef.current;
      if (!el || !state.pages.length) return;
      const widest = Math.max(...state.pages.map((p) => displaySize(p).w));
      dispatch({ type: 'zoom', zoom: (el.clientWidth - 72) / (widest * PT_TO_PX) });
    },
    /** Lleva a la vista un resultado de búsqueda: su página y la línea, a un tercio de la altura. */
    scrollToHit(hit) {
      const el = scrollRef.current;
      const pageEl = pageEls.current[hit.page];
      const page = state.pages[hit.page];
      if (!el || !pageEl || !page) return;
      const d = rectToDisplay(hit.rects[0] ?? [0, 0, 0, 0], pageTurn(page));
      const top = pageEl.offsetTop + (d.y + d.h / 2) * pageEl.offsetHeight - el.clientHeight / 3;
      const left = pageEl.offsetLeft + (d.x + d.w / 2) * pageEl.offsetWidth - el.clientWidth / 2;
      el.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'smooth' });
    },
  }), [state.pages, dispatch]);

  // Al entrar en modo lectura, ir a la página actual.
  useEffect(() => { goTo(currentRef.current); }, []);

  // Al cambiar el zoom, mantener la página actual a la vista.
  useLayoutEffect(() => { goTo(currentRef.current); }, [state.zoom]);

  // Página actual = la más visible.
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) ratios.current.set(Number(e.target.dataset.i), e.intersectionRatio);
      if (jumping.current) return; // en pleno salto: manda la página de destino
      let best = currentRef.current;
      let max = -1;
      for (const [i, r] of ratios.current) if (r > max) { max = r; best = i; }
      if (max > 0) dispatch({ type: 'current', index: best });
    }, { root: scrollRef.current, threshold: [0, 0.25, 0.5, 0.75, 1] });
    pageEls.current.forEach((el) => el && io.observe(el));
    ratios.current.clear();
    return () => io.disconnect();
  }, [state.pages, state.zoom, dispatch]);


  return (
    <div className="flex h-full">
      <PageSidebar
        pages={state.pages}
        current={state.current}
        onGo={(i) => { dispatch({ type: 'current', index: i }); goTo(i, 'smooth'); }}
        onMove={policy?.pages === false ? null : (key, to) => dispatch({ type: 'move', keys: new Set([key]), to })}
      />

      <div ref={scrollRef} className="desk-scroll flex-1 overflow-auto bg-desk">
        <div className="flex flex-col items-center-safe gap-6 px-9 py-8">
          {state.pages.map((page, i) => {
            const cssWidth = Math.round(displaySize(page).w * PT_TO_PX * state.zoom);
            return (
              <div key={page.key} data-i={i} ref={(el) => { pageEls.current[i] = el; }} className="relative scroll-mt-6">
                <PageImage page={page} cssWidth={cssWidth} rootRef={scrollRef} />
                <ErrorBoundary name="capa de la página" fallback="silent" resetKey={page}>
                <PageOverlay
                  page={page}
                  cssWidth={cssWidth}
                  tool={tool}
                  color={colors[tool]}
                  annotSel={state.annotSel}
                  conflicts={conflicts?.get(page.key)}
                  dispatch={dispatch}
                  textSel={textSel}
                  onTextSel={onTextSel}
                  searchHits={search?.byKey.get(page.key)}
                  currentHit={search?.currentHit?.key === page.key ? search.currentHit : null}
                  scanned={!!search?.imagePages.includes(i + 1)}
                  canFill={policy?.forms !== false}
                  {...textBoxes}
                />
                </ErrorBoundary>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
