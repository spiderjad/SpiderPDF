// Archivos recientes en la app real: Archivo → Abrir reciente, persistencia, archivo borrado y «Borrar lista».
import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tempDir, copyFixture, launch, stubOpen, footer, toolbarButton } from './helpers.mjs';

const recentsFile = (dir) => path.join(dir, 'datos-app', 'recientes.json');
const readRecents = async (dir) => JSON.parse(await readFile(recentsFile(dir), 'utf8')).map((r) => r.name);

/** Abre Archivo → Abrir reciente y devuelve el submenú. */
async function recentMenu(win) {
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: 'Abrir reciente' }).hover();
  const sub = win.getByRole('menu', { name: 'Abrir reciente' });
  await expect(sub).toBeVisible();
  return sub;
}

test('los últimos abiertos aparecen en Abrir reciente, persisten, se registran en el sistema y se abren', async () => {
  const dir = await tempDir();
  const contrato = await copyFixture(dir, 'contrato.pdf');
  const indice = await copyFixture(dir, 'indice.pdf');

  let { app, win } = await launch(dir, [contrato]);
  // Espía de app.addRecentDocument (lista de accesos directos de Windows / Dock de macOS).
  await app.evaluate(({ app: a }) => {
    globalThis.__added = [];
    const orig = a.addRecentDocument.bind(a);
    a.addRecentDocument = (p) => { globalThis.__added.push(p); orig(p); };
  });
  await stubOpen(app, [indice]);
  await toolbarButton(win, /^Abrir \(/).click();
  await expect(footer(win)).toContainText('indice.pdf');
  expect(await app.evaluate(() => globalThis.__added)).toEqual([indice]);
  await expect.poll(() => readRecents(dir)).toEqual(['indice.pdf', 'contrato.pdf']);

  let sub = await recentMenu(win);
  await expect(sub.getByRole('menuitem')).toHaveText(['indice.pdf', 'contrato.pdf', 'Borrar lista']);
  await win.keyboard.press('Escape');
  await app.close();

  // Otra sesión: la lista sigue ahí y abre el archivo.
  ({ app, win } = await launch(dir));
  sub = await recentMenu(win);
  await sub.getByRole('menuitem', { name: 'contrato.pdf' }).click();
  await expect(footer(win)).toContainText('contrato.pdf');
  await expect(footer(win)).toContainText('5 páginas');
  await expect.poll(() => readRecents(dir)).toEqual(['contrato.pdf', 'indice.pdf']);
  await app.close();
});

test('un reciente que ya no existe: aviso y se quita; «Borrar lista» la vacía', async () => {
  const dir = await tempDir();
  const contrato = await copyFixture(dir, 'contrato.pdf');
  const indice = await copyFixture(dir, 'indice.pdf');
  let { app, win } = await launch(dir, [indice]);
  await expect.poll(() => readRecents(dir).catch(() => [])).toEqual(['indice.pdf']); // escrito antes de cerrar
  await app.close();
  ({ app, win } = await launch(dir, [contrato]));
  await expect.poll(() => readRecents(dir)).toEqual(['contrato.pdf', 'indice.pdf']);
  const log = await readFile(path.join(dir, 'datos-app', 'e2e.log'), 'utf8');
  if (/reintento/.test(log)) console.log('REINTENTOS', log.split('\n').filter((l) => /reintento|no se pudo/.test(l)).join('\n'));

  await rm(indice);
  let sub = await recentMenu(win);
  await sub.getByRole('menuitem', { name: 'indice.pdf' }).click();
  await expect(win.getByText('«indice.pdf» ya no existe o se movió. Se quitó de la lista de recientes.')).toBeVisible();
  await expect(footer(win)).toContainText('contrato.pdf'); // sigue el documento abierto
  await expect.poll(() => readRecents(dir)).toEqual(['contrato.pdf']);

  sub = await recentMenu(win);
  await expect(sub.getByRole('menuitem')).toHaveText(['contrato.pdf', 'Borrar lista']);
  await sub.getByRole('menuitem', { name: 'Borrar lista' }).click();
  await expect.poll(() => readRecents(dir)).toEqual([]);
  sub = await recentMenu(win);
  await expect(sub.getByRole('menuitem')).toHaveText(['Sin archivos recientes']);
  await expect(sub.getByRole('menuitem', { name: 'Sin archivos recientes' })).toHaveAttribute('aria-disabled', 'true');
  await app.close();
});
