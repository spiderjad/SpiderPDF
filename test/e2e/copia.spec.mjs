// «Descargar» (Guardar una copia) en la app real: el documento con sus cambios va a otro archivo; el original y la
// pestaña no cambian.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tempDir, copyFixture, launch, footer, thumbs, engine, stubSaveAs } from './helpers.mjs';

test('Descargar: guarda una copia con los cambios; el original y la pestaña siguen igual; elegir el original no vale', async () => {
  const dir = await tempDir();
  const contrato = await copyFixture(dir, 'contrato.pdf');
  const original = await readFile(contrato);
  const { app, win, errors } = await launch(dir, [contrato]);
  await thumbs(win).nth(0).click();
  await win.keyboard.press('Control+R');
  await expect(footer(win)).toContainText('Cambios sin guardar');

  const copia = path.join(dir, 'contrato (copia).pdf');
  await app.evaluate(({ dialog }, f) => {
    globalThis.__proposed = null;
    dialog.showSaveDialog = async (_w, o) => { globalThis.__proposed = o.defaultPath; return { canceled: false, filePath: f }; };
  }, copia);
  await win.locator('header').getByRole('button', { name: 'Descargar' }).click();
  await expect(win.getByText('Copia guardada en «contrato (copia).pdf». El original no ha cambiado.')).toBeVisible();
  expect(await app.evaluate(() => globalThis.__proposed)).toBe(copia); // propone «(copia)» junto al original

  const core = await engine();
  const d = core.open(await readFile(copia));
  expect(d.pages.map((p) => p.rot0)).toEqual([1, 0, 0, 0, 0]);
  core.close(d.docId);
  expect((await readFile(contrato)).equals(original)).toBe(true);
  // La pestaña sigue siendo el original, con sus cambios sin guardar.
  await expect(footer(win)).toContainText('contrato.pdf');
  await expect(footer(win)).toContainText('Cambios sin guardar');

  // Desde el menú, y eligiendo el propio original: no lo toca.
  await stubSaveAs(app, contrato);
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: 'Guardar una copia…' }).click();
  await expect(win.getByText('Ese es el archivo original: «Guardar una copia» no lo cambia. Elige otro nombre.')).toBeVisible();
  expect((await readFile(contrato)).equals(original)).toBe(true);
  expect(errors).toEqual([]);
  await app.close();
});
