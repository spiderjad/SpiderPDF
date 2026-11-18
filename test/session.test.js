// Pestañas de las ventanas en el proceso principal (electron/session.cjs).  Ejecutar: node test/session.test.js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { FILE, MAX_TABS, cleanWindow, sanitize, owners, load, save, clear } = require('../electron/session.cjs');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok -', name); };

await t('una ventana: solo PDF con ruta absoluta, sin repetir (Windows: sin distinguir mayúsculas) y «active» dentro', () => {
  const w = cleanWindow({ tabs: ['C:\\a.pdf', 'relativo.pdf', 'C:\\b.txt', 'c:/A.PDF', 'C:\\b.pdf', 42], active: 1 }, true);
  assert.deepEqual(w, { tabs: ['C:\\a.pdf', 'C:\\b.pdf'], active: 1 });
  assert.equal(cleanWindow({ tabs: ['C:\\a.pdf'], active: 5 }, true).active, 0);
  assert.equal(cleanWindow({ tabs: ['C:\\a.pdf'], active: '0; rm' }, true).active, 0);
  assert.deepEqual(cleanWindow(null, true), { tabs: [], active: 0 });
  const many = cleanWindow({ tabs: Array.from({ length: 80 }, (_, i) => `C:\\f${i}.pdf`) }, true);
  assert.equal(many.tabs.length, MAX_TABS);
});

await t('un JSON tocado a mano: sin ventanas vacías ni basura', () => {
  assert.deepEqual(sanitize({ windows: [{ tabs: [] }, { tabs: ['C:\\x.pdf'] }, 'nada'] }, true), { windows: [{ tabs: ['C:\\x.pdf'], active: 0 }] });
  assert.deepEqual(sanitize('[]', true), { windows: [] });
  assert.deepEqual(sanitize(null, true), { windows: [] });
});

await t('owners: los archivos ya abiertos van a su ventana; los demás, libres', () => {
  const windows = [{ id: 1, tabs: ['C:\\Docs\\a.pdf'] }, { id: 2, tabs: ['C:\\Docs\\b.pdf', 'C:\\Docs\\c.pdf'] }];
  const r = owners(['c:/docs/B.pdf', 'C:\\Docs\\nuevo.pdf', 'C:\\Docs\\a.pdf', 'C:\\Docs\\c.pdf'], windows, true);
  assert.deepEqual([...r.owned], [[2, ['c:/docs/B.pdf', 'C:\\Docs\\c.pdf']], [1, ['C:\\Docs\\a.pdf']]]);
  assert.deepEqual(r.free, ['C:\\Docs\\nuevo.pdf']);
  assert.deepEqual(owners(['/u/A.pdf'], [{ id: 1, tabs: ['/u/a.pdf'] }], false).free, ['/u/A.pdf'], 'en Mac/Linux las mayúsculas cuentan');
});

await t('guardar, leer y borrar en disco; un archivo dañado no rompe nada', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spiderpdf-sesion-'));
  assert.deepEqual(await load(dir), { windows: [] });
  const a = path.join(dir, 'a.pdf');
  const b = path.join(dir, 'b.pdf');
  await save(dir, { windows: [{ tabs: [a, b], active: 1 }, { tabs: [] }] });
  assert.deepEqual(await load(dir), { windows: [{ tabs: [a, b], active: 1 }] });
  assert.ok(JSON.parse(await readFile(path.join(dir, FILE), 'utf8')).windows);
  await clear(dir);
  await assert.rejects(access(path.join(dir, FILE)));
  await clear(dir); // no existe: no falla
  await writeFile(path.join(dir, FILE), '{ roto');
  assert.deepEqual(await load(dir), { windows: [] });
});

console.log(`\nsesión: ${passed} pruebas correctas`);
