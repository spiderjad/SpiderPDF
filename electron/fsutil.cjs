// Escritura de archivos robusta en Windows (proceso principal).
'use strict';
const fs = require('node:fs/promises');

// En Windows, sustituir un archivo con rename falla de forma pasajera (EPERM, EACCES, EBUSY) si en ese
// instante otro proceso lo tiene abierto: el antivirus, el indexador, OneDrive o quien lo esté leyendo.
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * rename con reintentos (hasta ~3 s) ante esos errores pasajeros. onRetry(err, intento) para registrarlos.
 * Cualquier otro error, o si no se consigue, se lanza.
 */
async function renameWithRetry(from, to, { tries = 12, onRetry } = {}) {
  for (let i = 1; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      if (!TRANSIENT.has(e.code) || i >= tries) throw e;
      onRetry?.(e, i);
      await new Promise((r) => setTimeout(r, Math.min(50 * i, 500)));
    }
  }
}

/** Escritura atómica: temporal en la misma carpeta + rename con reintentos; si falla, se borra el temporal. */
async function writeAtomic(file, data, opts) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, data);
  try {
    await renameWithRetry(tmp, file, opts);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

module.exports = { renameWithRetry, writeAtomic };
