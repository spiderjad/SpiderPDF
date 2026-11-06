// Datos de la versión anterior («PDF Editor», antes de llamarse SpiderPDF). La carpeta de datos sale del nombre
// de la app, así que con el nombre nuevo empezaba vacía. Una sola vez (marcador migracion.json) se traen:
//   - recientes.json: se combina con la lista nueva (la nueva primero, sin repetir).
//   - Local Storage/ (firmas guardadas y preferencias de panel e impresión): no se puede mezclar archivo a archivo
//     (es una base LevelDB), así que, si ya hay uno, se aparta como «Local Storage (antes de migrar)» y se copia el
//     antiguo. La interfaz pasa después las claves pdf-editor:* a spiderpdf:* (src/storageMigration.js).
// Se ejecuta en el proceso principal antes de abrir ninguna ventana (nadie tiene abierta la base todavía) y después
// del candado de instancia única. Nunca modifica la carpeta antigua. Síncrono: son unos pocos KB.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const recents = require('./recents.cjs');

const MARKER = 'migracion.json';
const STORAGE = 'Local Storage';
const STORAGE_BACKUP = 'Local Storage (antes de migrar)';

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/**
 * Trae los datos de fromDir a toDir si no se hizo ya. → { done: false } si no había nada que hacer, o
 * { done: true, recents: n, storage: bool } con lo que se trajo. Los errores no impiden arrancar: se devuelven en error.
 */
function migrateLegacyData(fromDir, toDir, now = new Date()) {
  const marker = path.join(toDir, MARKER);
  if (!fromDir || fs.existsSync(marker) || !fs.existsSync(fromDir)) return { done: false };
  const result = { done: true, from: fromDir, at: now.toISOString(), recents: 0, storage: false };
  try {
    fs.mkdirSync(toDir, { recursive: true });

    const oldList = recents.sanitize(readJson(path.join(fromDir, recents.FILE)));
    if (oldList.length) {
      const newList = recents.sanitize(readJson(path.join(toDir, recents.FILE)));
      const merged = recents.mergeRecents(newList, oldList);
      fs.writeFileSync(path.join(toDir, recents.FILE), JSON.stringify(merged, null, 2));
      result.recents = merged.length - newList.length;
    }

    const oldStorage = path.join(fromDir, STORAGE);
    if (fs.existsSync(oldStorage)) {
      const target = path.join(toDir, STORAGE);
      if (fs.existsSync(target)) {
        fs.rmSync(path.join(toDir, STORAGE_BACKUP), { recursive: true, force: true });
        fs.renameSync(target, path.join(toDir, STORAGE_BACKUP));
      }
      // LOCK es el candado de LevelDB de la otra carpeta: no se copia.
      fs.cpSync(oldStorage, target, { recursive: true, filter: (src) => path.basename(src) !== 'LOCK' });
      result.storage = true;
    }
  } catch (e) {
    result.error = e.message;
  }
  try { fs.writeFileSync(marker, JSON.stringify(result, null, 2)); } catch { /* sin marcador se reintenta la próxima vez */ }
  return result;
}

module.exports = { MARKER, STORAGE, STORAGE_BACKUP, migrateLegacyData };
