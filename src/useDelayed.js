import { useEffect, useState } from 'react';

/** Regla de la app: ningún indicador de carga si la operación dura menos de esto (no parpadea). */
export const LOADING_DELAY = 300;

/** true solo cuando `active` lleva al menos `ms` siendo true. Vuelve a false en cuanto termina. */
export function useDelayed(active, ms = LOADING_DELAY) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) { setShown(false); return undefined; }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return active && shown;
}
