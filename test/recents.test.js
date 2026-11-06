// Archivos recientes (electron/recents.cjs).  Ejecutar: node test/recents.test.js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { MAX, FILE, addRecent, removeRecent, sanitize, load, save } = require('../electron/recents.cjs');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok -', name); };
const WIN = 'C:\\Docs\\contrato.pdf';

await t('el último abierto va primero, con su nombre, y no se repite (Windows: sin distinguir mayúsculas ni barras)', () => {
  let l = addRecent([], WIN, 1, true);
  l = addRecent(l, 'C:\\Docs\\anexo.pdf', 2, true);
  l = addRecent(l, 'c:/docs/CONTRATO.pdf', 3, true);
  assert.deepEqual(l.map((r) => [r.name, r.openedAt]), [['CONTRATO.pdf', 3], ['anexo.pdf', 2]]);
});

await t('en Mac/Linux las mayúsculas sí distinguen archivos', () => {
  const l = addRecent(addRecent([], '/u/a.pdf', 1, false), '/u/A.pdf', 2, false);
  assert.equal(l.length, 2);
});

await t(`como mucho ${MAX}`, () => {
  let l = [];
  for (let i = 0; i < 15; i++) l = addRecent(l, `C:\\Docs\\f${i}.pdf`, i, true);
  assert.equal(l.length, MAX);
  assert.equal(l[0].name, 'f14.pdf');
  assert.equal(l.at(-1).name, 'f5.pdf');
});

await t('quitar uno', () => {
  const l = removeRecent(addRecent(addRecent([], WIN, 1, true), 'C:\\x.pdf', 2, true), 'c:\\docs\\contrato.pdf', true);
  assert.deepEqual(l.map((r) => r.name), ['x.pdf']);
});

await t('un JSON tocado a mano: solo entradas válidas (PDF, ruta absoluta)', () => {
  const abs = path.resolve('a.pdf');
  assert.deepEqual(sanitize({ no: 'lista' }), []);
  assert.deepEqual(sanitize([null, { path: 3 }, { path: 'relativo.pdf' }, { path: path.resolve('x.txt') }, { path: abs, openedAt: '7' }]).map((r) => [r.path, r.openedAt]), [[abs, 7]]);
});

await t('guardar y cargar del disco; un archivo dañado o que no existe da una lista vacía', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'recientes-'));
  assert.deepEqual(await load(dir), []);
  const l = addRecent([], path.resolve('doc.pdf'), 5);
  await save(dir, l);
  assert.deepEqual(await load(dir), l);
  await writeFile(path.join(dir, FILE), '{ roto');
  assert.deepEqual(await load(dir), []);
  assert.ok((await readFile(path.join(dir, FILE), 'utf8')).startsWith('{'));
});

await t('escritura atómica: si Windows bloquea el archivo un instante (EPERM), se reintenta y se escribe', async () => {
  const fsp = require('node:fs/promises');
  const { writeAtomic } = require('../electron/fsutil.cjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atomico-'));
  const file = path.join(dir, 'x.json');
  await writeFile(file, 'viejo');
  const real = fsp.rename;
  let fails = 2;
  const retries = [];
  fsp.rename = async (...a) => { if (fails-- > 0) throw Object.assign(new Error('bloqueado'), { code: 'EPERM' }); return real(...a); };
  try {
    await writeAtomic(file, 'nuevo', { onRetry: (e, i) => retries.push(`${e.code}#${i}`) });
  } finally {
    fsp.rename = real;
  }
  assert.equal(await readFile(file, 'utf8'), 'nuevo');
  assert.deepEqual(retries, ['EPERM#1', 'EPERM#2']);
  // Un error que no es pasajero no se reintenta y no deja el temporal.
  fsp.rename = async () => { throw Object.assign(new Error('no existe'), { code: 'ENOENT' }); };
  try {
    await assert.rejects(writeAtomic(file, 'otro'), /no existe/);
  } finally {
    fsp.rename = real;
  }
  const { readdir } = fsp;
  assert.deepEqual(await readdir(dir), ['x.json']);
});

console.log(`\n${passed} pruebas de recientes superadas.`);
