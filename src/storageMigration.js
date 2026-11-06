// Claves de localStorage de la versión anterior («PDF Editor»): pdf-editor:* → spiderpdf:*.
// El proceso principal ya trajo la base de datos de la carpeta antigua (electron/migrate.cjs); aquí solo se copian
// los valores a las claves nuevas, si las nuevas no existen. Las antiguas se dejan (no estorban).
export const LEGACY_KEYS = ['firmas', 'panel', 'imprimir'];

/** → número de claves copiadas. Nunca lanza (almacenamiento bloqueado o lleno). */
export function migrateStorage(storage) {
  let n = 0;
  for (const k of LEGACY_KEYS) {
    try {
      const old = storage?.getItem(`pdf-editor:${k}`);
      if (old != null && storage.getItem(`spiderpdf:${k}`) == null) {
        storage.setItem(`spiderpdf:${k}`, old);
        n++;
      }
    } catch { /* sin almacenamiento: nada que hacer */ }
  }
  return n;
}
