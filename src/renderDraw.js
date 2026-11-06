// Dibujar el render de una página sin falsos errores (sin DOM; se prueba en Node).
//
// Por qué existe: la caché de renders cierra (ImageBitmap.close) los bitmaps que expulsa, y un mismo
// componente pide renders nuevos al cambiar el zoom o el tamaño. Antes, cualquier fallo marcaba la página
// como «No se pudo mostrar» aunque fuera de un render ya obsoleto o de un bitmap recién cerrado, y el aviso
// no se quitaba hasta otro render correcto.

/** Un bitmap cerrado mide 0 × 0. */
export const isClosed = (bmp) => !bmp || !(bmp.width > 0) || !(bmp.height > 0);

/**
 * Turnos de render: cada petición recibe un turno y solo el último cuenta.
 *   const t = turns.next(); … if (!t.current()) return;
 */
export function createTurns() {
  let last = 0;
  return {
    next() {
      const id = ++last;
      return { current: () => id === last };
    },
  };
}

/**
 * Pide un render y lo dibuja. Si el bitmap llega cerrado o falla al dibujarlo por estar cerrado,
 * pide UNA vez un render nuevo (fuera de la caché).
 *   get(fresh)  → Promise<ImageBitmap>   draw(bmp) → dibuja (puede lanzar)
 * Devuelve 'drawn' | 'stale' (ya no es el último turno) y lanza el error si el último turno falla.
 */
export async function drawLatest(turn, get, draw) {
  let bmp = await get(false);
  if (!turn.current()) return 'stale';
  for (let attempt = 0; ; attempt++) {
    if (isClosed(bmp)) {
      if (attempt > 0) throw new Error('El render llegó cerrado dos veces.');
      bmp = await get(true);
      if (!turn.current()) return 'stale';
      continue;
    }
    try {
      draw(bmp);
      return 'drawn';
    } catch (e) {
      if (attempt > 0 || !isClosed(bmp)) throw e;
      bmp = await get(true);
      if (!turn.current()) return 'stale';
    }
  }
}
