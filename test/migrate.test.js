// Datos de la versión anterior (electron/migrate.cjs y src/storageMigration.js).  Ejecutar: node test/migrate.test.js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateStorage } from '../src/storageMigration.js';

const require = createRequire(import.meta.url);
const { migrateLegacyData, MARKER, STORAGE, STORAGE_BACKUP } = require('../electron/migrate.cjs');
const { mergeRecents, FILE } = require('../electron/recents.cjs');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok -', name); };
const tmp = () => mkdtemp(path.join(os.tmpdir(), 'spiderpdf-migrar-'));
const abs = (name) => path.resolve(os.tmpdir(), name);
const entry = (name, at) => ({ path: abs(name), name, openedAt: at });

/** Carpeta «PDF Editor» de ejemplo: recientes y una base de Local Storage (con su candado LOCK). */
async function legacy(dir, list = [entry('viejo.pdf', 1), entry('comun.pdf', 2)]) {
  await writeFile(path.join(dir, FILE), JSON.stringify(list));
  await mkdir(path.join(dir, STORAGE, 'leveldb'), { recursive: true });
  await writeFile(path.join(dir, STORAGE, 'leveldb', '000003.log'), 'firmas antiguas');
  await writeFile(path.join(dir, STORAGE, 'leveldb', 'LOCK'), '');
}

await t('carpeta nueva vacía: trae recientes y Local Storage (sin el candado LOCK) y deja el marcador', async () => {
  const from = await tmp(); const to = path.join(await tmp(), 'SpiderPDF');
  await legacy(from);
  const r = migrateLegacyData(from, to);
  assert.equal(r.done, true); assert.equal(r.storage, true); assert.equal(r.recents, 2); assert.equal(r.error, undefined);
  assert.deepEqual(JSON.parse(await readFile(path.join(to, FILE), 'utf8')).map((x) => x.name), ['viejo.pdf', 'comun.pdf']);
  assert.equal(await readFile(path.join(to, STORAGE, 'leveldb', '000003.log'), 'utf8'), 'firmas antiguas');
  assert.equal(existsSync(path.join(to, STORAGE, 'leveldb', 'LOCK')), false);
  assert.equal(existsSync(path.join(to, MARKER)), true);
});

await t('ya se había abierto SpiderPDF: combina los recientes (los nuevos primero) y aparta su Local Storage', async () => {
  const from = await tmp(); const to = await tmp();
  await legacy(from);
  await writeFile(path.join(to, FILE), JSON.stringify([entry('nuevo.pdf', 9), entry('comun.pdf', 8)]));
  await mkdir(path.join(to, STORAGE), { recursive: true });
  await writeFile(path.join(to, STORAGE, 'hoy.log'), 'ajustes de hoy');
  const r = migrateLegacyData(from, to);
  assert.equal(r.recents, 1); // solo «viejo.pdf» es nuevo
  assert.deepEqual(JSON.parse(await readFile(path.join(to, FILE), 'utf8')).map((x) => x.name), ['nuevo.pdf', 'comun.pdf', 'viejo.pdf']);
  assert.equal(await readFile(path.join(to, STORAGE_BACKUP, 'hoy.log'), 'utf8'), 'ajustes de hoy');
  assert.equal(await readFile(path.join(to, STORAGE, 'leveldb', '000003.log'), 'utf8'), 'firmas antiguas');
});

await t('solo una vez (marcador), y sin carpeta antigua no hace nada ni crea nada', async () => {
  const from = await tmp(); const to = await tmp();
  await legacy(from);
  assert.equal(migrateLegacyData(from, to).done, true);
  await writeFile(path.join(to, FILE), JSON.stringify([entry('otro.pdf', 5)]));
  assert.equal(migrateLegacyData(from, to).done, false);
  assert.deepEqual(JSON.parse(await readFile(path.join(to, FILE), 'utf8')).map((x) => x.name), ['otro.pdf']);
  const empty = await tmp();
  assert.equal(migrateLegacyData(path.join(empty, 'no-existe'), empty).done, false);
  assert.equal(migrateLegacyData(undefined, empty).done, false);
  assert.deepEqual(await readdir(empty), []);
});

await t('la carpeta antigua no se modifica', async () => {
  const from = await tmp(); const to = await tmp();
  await legacy(from);
  const before = await readFile(path.join(from, FILE), 'utf8');
  migrateLegacyData(from, to);
  assert.equal(await readFile(path.join(from, FILE), 'utf8'), before);
  assert.equal(existsSync(path.join(from, STORAGE, 'leveldb', 'LOCK')), true);
  assert.equal(existsSync(path.join(from, MARKER)), false);
});

await t('mergeRecents: sin repetir (Windows sin distinguir mayúsculas) y como mucho 10', () => {
  const a = [{ path: 'C:\\A\\uno.pdf' }], b = [{ path: 'c:/a/UNO.pdf' }, { path: 'C:\\A\\dos.pdf' }];
  assert.deepEqual(mergeRecents(a, b, true).map((r) => r.path), ['C:\\A\\uno.pdf', 'C:\\A\\dos.pdf']);
  const many = Array.from({ length: 12 }, (_, i) => ({ path: `C:\\f${i}.pdf` }));
  assert.equal(mergeRecents([], many, true).length, 10);
});

await t('localStorage: pdf-editor:* pasa a spiderpdf:* sin pisar lo que ya haya', () => {
  const m = new Map([['pdf-editor:firmas', '[1]'], ['pdf-editor:panel', '{"w":250}'], ['spiderpdf:panel', '{"w":200}']]);
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  assert.equal(migrateStorage(storage), 1);
  assert.equal(m.get('spiderpdf:firmas'), '[1]');
  assert.equal(m.get('spiderpdf:panel'), '{"w":200}');
  assert.equal(migrateStorage(storage), 0); // repetir no cambia nada
  const broken = { getItem: () => { throw new Error('bloqueado'); } };
  assert.equal(migrateStorage(broken), 0);
  assert.equal(migrateStorage(undefined), 0);
});

console.log(`\n${passed} pruebas de migración superadas.`);
