// Actualizaciones automáticas (electron/updater.cjs) con un autoUpdater simulado.  Ejecutar: node test/updater.test.js
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createUpdater, shortMessage, AUTO_EVERY } = require('../electron/updater.cjs');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok -', name); };

/** Como el autoUpdater de electron-updater: checkForUpdates emite los eventos de lo que encuentre. */
function fakeUpdater(script) {
  const au = new EventEmitter();
  au.checks = 0;
  au.installs = [];
  au.checkForUpdates = async () => {
    au.checks++;
    au.emit('checking-for-update');
    await script(au);
  };
  au.quitAndInstall = (...args) => au.installs.push(args);
  return au;
}

await t('versión nueva: se descarga en segundo plano (con su avance) y queda lista para instalar', async () => {
  const seen = [];
  const au = fakeUpdater(async (u) => {
    u.emit('update-available', { version: '0.2.0' });
    for (const percent of [10.4, 10.9, 55, 100]) u.emit('download-progress', { percent });
    u.emit('update-downloaded', { version: '0.2.0' });
  });
  const up = createUpdater({ autoUpdater: au, enabled: true, current: '0.1.0', onChange: (s) => seen.push(s) });
  assert.equal(au.autoDownload, true);
  assert.equal(au.autoInstallOnAppQuit, true);
  assert.deepEqual(up.state, { status: 'idle', current: '0.1.0' });
  assert.equal(up.install(), false, 'sin descargar no se instala');
  const s = await up.check();
  assert.deepEqual(s, { status: 'ready', current: '0.1.0', version: '0.2.0' });
  assert.deepEqual(seen.map((x) => [x.status, x.percent]), [
    ['checking', undefined], ['downloading', 0], ['downloading', 10], ['downloading', 55], ['downloading', 100], ['ready', undefined],
  ], 'el avance solo avisa cuando cambia el número entero');
  // Lista: no se vuelve a buscar; instalar = cerrar, instalar en silencio y volver a abrir.
  await up.check();
  assert.equal(au.checks, 1);
  assert.equal(up.install(), true);
  assert.deepEqual(au.installs, [[true, true]]);
});

await t('sin versión nueva: «latest»; la automática no se repite antes de 4 horas (varias ventanas), la manual sí', async () => {
  let clock = 1000;
  const au = fakeUpdater(async (u) => u.emit('update-not-available', { version: '0.1.0' }));
  const up = createUpdater({ autoUpdater: au, enabled: true, current: '0.1.0', now: () => clock });
  assert.equal((await up.check({ auto: true })).status, 'latest');
  await up.check({ auto: true });
  assert.equal(au.checks, 1);
  await up.check();
  assert.equal(au.checks, 2, 'la manual siempre busca');
  clock += AUTO_EVERY;
  await up.check({ auto: true });
  assert.equal(au.checks, 3);
});

await t('errores (sin conexión): estado «error» con un mensaje corto; una descarga lista no se pierde', async () => {
  const logs = [];
  const au = fakeUpdater(async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED\n    at SimpleURLLoaderWrapper…'); });
  const up = createUpdater({ autoUpdater: au, enabled: true, current: '0.1.0', log: (...a) => logs.push(a.join(' ')) });
  assert.deepEqual(await up.check(), { status: 'error', current: '0.1.0', message: 'net::ERR_INTERNET_DISCONNECTED' });
  // El evento «error» del autoUpdater, igual (y se apunta en el registro).
  au.emit('update-downloaded', { version: '0.3.0' });
  au.emit('error', new Error('otro fallo'));
  assert.equal(up.state.status, 'ready');
  assert.deepEqual(logs, ['actualizaciones: error otro fallo']);
  assert.equal(shortMessage(new Error('x'.repeat(300))).length, 158);
});

await t('donde no se puede (desarrollo, macOS): «unsupported», no busca ni instala', async () => {
  const up = createUpdater({ autoUpdater: null, enabled: false, current: '0.1.0' });
  assert.deepEqual(await up.check(), { status: 'unsupported', current: '0.1.0' });
  assert.equal(up.install(), false);
});

console.log(`\n${passed} pruebas de actualizaciones superadas.`);
