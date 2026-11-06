// Archivos recientes (proceso principal). La lista vive en <userData>/recientes.json:
// [{ path, name, openedAt }], el más reciente primero, como mucho MAX. Las funciones de lista son
// puras (se prueban en Node, test/recents.test.js); load/save tocan el disco.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { writeAtomic } = require('./fsutil.cjs');

const MAX = 10;
const FILE = 'recientes.json';

/** ¿Dos rutas son el mismo archivo? En Windows no distingue mayúsculas ni / de \. */
function samePath(a, b, win = process.platform === 'win32') {
  const norm = (p) => {
    let s = String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    if (win) s = s.toLowerCase();
    return s;
  };
  return norm(a) === norm(b);
}

/** Pone el archivo el primero (sin repetirlo) y deja como mucho MAX. */
function addRecent(list, filePath, now = Date.now(), win) {
  const name = path.basename(filePath);
  const rest = list.filter((r) => !samePath(r.path, filePath, win));
  return [{ path: filePath, name, openedAt: now }, ...rest].slice(0, MAX);
}

function removeRecent(list, filePath, win) {
  return list.filter((r) => !samePath(r.path, filePath, win));
}

/** Solo entradas válidas (el JSON lo puede haber tocado cualquiera). */
function sanitize(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((r) => r && typeof r.path === 'string' && /\.pdf$/i.test(r.path) && path.isAbsolute(r.path))
    .map((r) => ({ path: r.path, name: path.basename(r.path), openedAt: Number(r.openedAt) || 0 }))
    .slice(0, MAX);
}

/** Une dos listas: primero a, luego lo de b que no esté en a; como mucho MAX. */
function mergeRecents(a, b, win) {
  return [...a, ...b.filter((r) => !a.some((x) => samePath(x.path, r.path, win)))].slice(0, MAX);
}

async function load(dir) {
  try {
    return sanitize(JSON.parse(await fs.readFile(path.join(dir, FILE), 'utf8')));
  } catch {
    return []; // no existe o está dañado: se empieza de cero
  }
}

/** Escritura atómica (temporal + rename con reintentos, ver fsutil.cjs). */
async function save(dir, list, opts) {
  await fs.mkdir(dir, { recursive: true });
  await writeAtomic(path.join(dir, FILE), JSON.stringify(list, null, 2), opts);
}

module.exports = { MAX, FILE, samePath, addRecent, removeRecent, mergeRecents, sanitize, load, save };
