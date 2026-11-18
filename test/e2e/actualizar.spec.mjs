// Actualizaciones en la app real con un autoUpdater simulado (globalThis.__spiderPdfUpdateHook, solo sin empaquetar):
// búsqueda al arrancar, descarga en segundo plano, botón «Reiniciar para actualizar», aviso de cambios sin guardar y
// Preferencias (buscar ahora, última versión, error, desactivar la búsqueda automática). No hay red ni instalador.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, tempDir, copyFixture, launch, stubOpen, footer, confirmDialog, thumbs, PACKAGED_EXE } from './helpers.mjs';

test.skip(!!PACKAGED_EXE, 'Usa ganchos de prueba que la app empaquetada no tiene (allí haría cosas de verdad).');

// La versión instalada es la de package.json; la «nueva» del simulado, una que siempre es mayor.
const CURRENT = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version;
const NEXT = '99.0.0';

/**
 * autoUpdater simulado. mode: 'new' (hay NEXT: avisa y empieza a descargar, 40 %), 'latest' o 'offline'.
 * Lo que pasa queda en globalThis.__au (checks, installs); __au.finish() termina la descarga.
 */
const fakeUpdater = (app, mode) => app.evaluate((_, [m, current, next]) => {
  const listeners = {};
  const au = {
    checks: 0,
    installs: [],
    on(ev, fn) { (listeners[ev] ??= []).push(fn); return au; },
    emit(ev, ...args) { for (const fn of listeners[ev] ?? []) fn(...args); },
    async checkForUpdates() {
      au.checks++;
      au.emit('checking-for-update');
      if (globalThis.__auMode === 'offline') throw new Error('net::ERR_INTERNET_DISCONNECTED\n    at …');
      if (globalThis.__auMode === 'latest') { au.emit('update-not-available', { version: current }); return; }
      au.emit('update-available', { version: next });
      au.emit('download-progress', { percent: 40.7 });
    },
    finish() { au.emit('download-progress', { percent: 100 }); au.emit('update-downloaded', { version: next }); },
    quitAndInstall(...args) { au.installs.push(args); },
  };
  globalThis.__auMode = m;
  globalThis.__au = au;
  globalThis.__spiderPdfUpdateHook = au;
}, [mode, CURRENT, NEXT]);
const au = (app) => app.evaluate(() => ({ checks: globalThis.__au.checks, installs: globalThis.__au.installs }));
const tabBar = (win) => win.locator('.pt-bar');

test('al arrancar busca y descarga; botón «Reiniciar para actualizar»; con cambios sin guardar pregunta antes', async () => {
  const dir = await tempDir();
  const contrato = await copyFixture(dir, 'contrato.pdf');
  const { app, win, errors } = await launch(dir);
  await fakeUpdater(app, 'new');
  await win.reload(); // arranque con el actualizador simulado ya puesto
  await expect(win.getByText('Abre un PDF para empezar')).toBeVisible();

  await expect(tabBar(win).getByRole('status')).toHaveText(`Descargando la versión ${NEXT}… 40 %`);
  expect((await au(app)).checks).toBe(1);
  await app.evaluate(() => globalThis.__au.finish());
  await expect(win.getByText(`Hay una versión nueva (${NEXT}): reinicia para actualizar.`)).toBeVisible();
  const button = tabBar(win).getByRole('button', { name: 'Reiniciar para actualizar' });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('title', `La versión ${NEXT} está descargada. Al reiniciar se instala y la app se vuelve a abrir.`);

  // Un documento con cambios: reiniciar pregunta (Cancelar no instala; «Reiniciar sin guardar», sí).
  await stubOpen(app, [contrato]);
  await win.keyboard.press('Control+O');
  await expect(footer(win)).toContainText('contrato.pdf');
  await thumbs(win).nth(0).click();
  await win.keyboard.press('Control+R');
  await expect(footer(win)).toContainText('Cambios sin guardar');
  await button.click();
  await expect(confirmDialog(win)).toContainText('Tienes cambios sin guardar en 1 documento. Si reinicias ahora, se perderán.');
  await confirmDialog(win).getByRole('button', { name: 'Cancelar' }).click();
  expect((await au(app)).installs).toEqual([]);
  await button.click();
  await confirmDialog(win).getByRole('button', { name: 'Reiniciar sin guardar' }).click();
  await expect.poll(async () => (await au(app)).installs).toEqual([[true, true]]); // en silencio y volviendo a abrir
  const log = await readFile(path.join(dir, 'datos-app', 'e2e.log'), 'utf8');
  expect(log).toContain(`actualizar: reiniciar e instalar ${NEXT}`);
  expect(errors).toEqual([]);
  await app.close(); // ya confirmado: sin volver a preguntar por los cambios
});

test('Preferencias: versión instalada, «Buscar ahora», última versión, sin conexión y desactivar la búsqueda al abrir', async () => {
  const dir = await tempDir();
  const { app, win } = await launch(dir);
  await fakeUpdater(app, 'latest');
  await win.reload();
  await expect.poll(async () => (await au(app)).checks).toBe(1); // la automática, al arrancar

  await win.keyboard.press('Control+,');
  const prefs = win.getByRole('dialog', { name: 'Preferencias' });
  const status = prefs.getByRole('status');
  await expect(status).toHaveText('Tienes la última versión.');
  await expect(prefs.getByText(`Versión ${CURRENT}. Las versiones nuevas se descargan de GitHub y se instalan al reiniciar.`)).toBeVisible();
  await expect(tabBar(win).getByRole('button', { name: 'Reiniciar para actualizar' })).toHaveCount(0);

  // Sin conexión: el error se ve aquí (al arrancar no molesta con avisos).
  await app.evaluate(() => { globalThis.__auMode = 'offline'; });
  await prefs.getByRole('button', { name: 'Buscar ahora' }).click();
  await expect(status).toHaveText('No se pudo buscar: net::ERR_INTERNET_DISCONNECTED');
  await app.evaluate(() => { globalThis.__auMode = 'latest'; });
  await prefs.getByRole('button', { name: 'Buscar ahora' }).click();
  await expect(status).toHaveText('Tienes la última versión.');
  expect((await au(app)).checks).toBe(3);

  // Desactivado: al volver a arrancar ya no busca sola.
  await prefs.getByRole('checkbox', { name: 'Buscar actualizaciones al abrir la aplicación' }).uncheck();
  await prefs.getByRole('button', { name: 'Guardar' }).click();
  await win.reload();
  await expect(win.getByText('Abre un PDF para empezar')).toBeVisible();
  await win.waitForTimeout(1500);
  expect((await au(app)).checks).toBe(3);
  await app.close();
});

test('sin el actualizador simulado (desarrollo): Preferencias dice que solo va en la app instalada', async () => {
  const dir = await tempDir();
  const { app, win } = await launch(dir);
  await win.keyboard.press('Control+,');
  const prefs = win.getByRole('dialog', { name: 'Preferencias' });
  await expect(prefs.getByRole('status')).toHaveText('Solo en la aplicación instalada para Windows.');
  await expect(prefs.getByRole('button', { name: 'Buscar ahora' })).toBeDisabled();
  await expect(prefs.getByRole('checkbox', { name: 'Buscar actualizaciones al abrir la aplicación' })).toBeDisabled();
  await app.close();
});

test('el electron-updater de verdad se carga en el proceso principal (sin empaquetar no busca nada)', async () => {
  const dir = await tempDir();
  const { app } = await launch(dir);
  const r = await app.evaluate(async ({ app: a }) => {
    const { createRequire } = process.mainModule.require('node:module');
    const { autoUpdater } = createRequire(`${a.getAppPath()}/package.json`)('electron-updater'); // como lo carga main.cjs
    autoUpdater.logger = null;
    return { kind: autoUpdater.constructor.name, result: (await autoUpdater.checkForUpdates()) ?? null };
  });
  expect(r).toEqual({ kind: 'NsisUpdater', result: null });
  await app.close();
});
