// Pestañas de las ventanas (proceso principal). Cada ventana informa de sus pestañas con archivo ({ tabs: [ruta],
// active }) cada vez que cambian; con eso:
//   - un PDF que llega del Explorador (o de «Abrir» en otra ventana) y ya está abierto se muestra donde está, en vez
//     de abrirlo dos veces (owners);
//   - con Preferencias → «Recordar las pestañas abiertas», se guardan en <userData>/sesion.json para la próxima vez:
//     { windows: [{ tabs: [ruta], active }] }, en el orden en que se abrieron las ventanas.
// Las funciones de lista son puras (test/session.test.js); load/save/clear tocan el disco.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { writeAtomic } = require('./fsutil.cjs');
const { samePath } = require('./recents.cjs');

const FILE = 'sesion.json';
const MAX_WINDOWS = 10;
const MAX_TABS = 50; // por ventana

const isPdfPath = (p) => typeof p === 'string' && path.isAbsolute(p) && /\.pdf$/i.test(p);

/** Una ventana tal como la manda la interfaz (o como venga del JSON): solo rutas de PDF absolutas, sin repetir. */
function cleanWindow(w, win) {
  const tabs = [];
  for (const p of Array.isArray(w?.tabs) ? w.tabs : []) {
    if (isPdfPath(p) && !tabs.some((x) => samePath(x, p, win))) tabs.push(p);
    if (tabs.length >= MAX_TABS) break;
  }
  const n = Number(w?.active);
  return { tabs, active: Number.isInteger(n) && n >= 0 && n < tabs.length ? n : 0 };
}

/** Solo entradas válidas (el JSON lo puede haber tocado cualquiera); sin ventanas vacías. */
function sanitize(data, win) {
  const list = Array.isArray(data?.windows) ? data.windows : [];
  return { windows: list.map((w) => cleanWindow(w, win)).filter((w) => w.tabs.length).slice(0, MAX_WINDOWS) };
}

/**
 * ¿Qué ventana tiene ya abierto cada archivo? windows: [{ id, tabs: [ruta] }]. → { owned: Map id → [rutas], free: [rutas] }
 */
function owners(paths, windows, win) {
  const owned = new Map();
  const free = [];
  for (const p of paths) {
    const w = windows.find((x) => x.tabs.some((t) => samePath(t, p, win)));
    if (w) owned.set(w.id, [...(owned.get(w.id) ?? []), p]);
    else free.push(p);
  }
  return { owned, free };
}

async function load(dir, win) {
  try {
    return sanitize(JSON.parse(await fs.readFile(path.join(dir, FILE), 'utf8')), win);
  } catch {
    return { windows: [] }; // no existe o está dañado
  }
}

async function save(dir, session, opts) {
  await fs.mkdir(dir, { recursive: true });
  await writeAtomic(path.join(dir, FILE), JSON.stringify(sanitize(session), null, 2), opts);
}

async function clear(dir) {
  await fs.rm(path.join(dir, FILE), { force: true });
}

module.exports = { FILE, MAX_WINDOWS, MAX_TABS, isPdfPath, cleanWindow, sanitize, owners, load, save, clear };
