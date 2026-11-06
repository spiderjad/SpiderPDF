// Idiomas en la app real: el del sistema (--lang de Chromium = idioma de Windows), el elegido en Preferencias
// (cambia al momento y se recuerda) y los diálogos nativos del proceso principal en el mismo idioma.
import { test, expect } from '@playwright/test';
import { tempDir, copyFixture, launch } from './helpers.mjs';

const menubar = (win) => win.getByRole('menubar');
const header = (win) => win.locator('header');

/** El diálogo «Guardar como» nativo apunta su título y se cancela. */
const watchSaveTitle = (app) => app.evaluate(({ dialog }) => {
  globalThis.__saveTitles = [];
  dialog.showSaveDialog = async (_w, opts) => { globalThis.__saveTitles.push(opts?.title); return { canceled: true }; };
});

for (const [lang, file, open, organize, pages, saveTitle] of [
  ['en-US', 'File', 'Open', 'Organize', '5 pages', 'Save PDF'],
  ['ca-ES', 'Fitxer', 'Obre', 'Organitza', '5 pàgines', 'Desa el PDF'],
  ['fr-FR', 'File', 'Open', 'Organize', '5 pages', 'Save PDF'], // idioma que no tenemos → inglés
]) {
  test(`sistema en ${lang}: interfaz, menú, barra de estado y diálogos nativos`, async () => {
    const dir = await tempDir();
    const { app, win, errors } = await launch(dir, [await copyFixture(dir, 'contrato.pdf')], {}, { lang });
    await expect(menubar(win).getByRole('menuitem').first()).toHaveText(file);
    await expect(header(win).getByRole('button', { name: open, exact: true })).toBeVisible();
    await expect(header(win).getByRole('tab', { name: organize })).toHaveAttribute('aria-selected', 'true');
    await expect(win.locator('footer')).toContainText(pages);
    expect(await win.evaluate(() => document.documentElement.lang)).toBe(lang.slice(0, 2) === 'ca' ? 'ca' : 'en');
    await watchSaveTitle(app);
    await win.keyboard.press('Control+Shift+S');
    await expect.poll(() => app.evaluate(() => globalThis.__saveTitles)).toEqual([saveTitle]);
    expect(errors).toEqual([]);
    await app.close();
  });
}

test('Preferencias → Idioma: cambia al momento, se recuerda y vuelve a «Automático»', async () => {
  const dir = await tempDir();
  const files = [await copyFixture(dir, 'contrato.pdf')];
  let { app, win, errors } = await launch(dir, files); // sistema en español
  await expect(menubar(win).getByRole('menuitem').first()).toHaveText('Archivo');

  await win.keyboard.press('Control+,');
  let prefs = win.getByRole('dialog', { name: 'Preferencias' });
  await expect(prefs.getByLabel('Idioma')).toHaveValue('auto');
  await expect(prefs.getByLabel('Idioma').locator('option').first()).toHaveText('Automático: el del sistema (Español)');
  await prefs.getByLabel('Idioma').selectOption('ca');
  await prefs.getByRole('button', { name: 'Guardar' }).click();
  await expect(menubar(win).getByRole('menuitem').first()).toHaveText('Fitxer');
  await expect(header(win).getByRole('button', { name: 'Desa' })).toBeVisible();
  await expect(win.getByRole('status').filter({ hasText: 'S’han desat les preferències.' })).toBeVisible();
  // El proceso principal también: el diálogo de guardar sale en catalán.
  await watchSaveTitle(app);
  await win.keyboard.press('Control+Shift+S');
  await expect.poll(() => app.evaluate(() => globalThis.__saveTitles)).toEqual(['Desa el PDF']);
  await app.close();

  // Al volver a abrir, sigue en catalán aunque el sistema esté en español.
  ({ app, win, errors } = await launch(dir, files, {}, { lang: 'es-ES', spanish: false }));
  await expect(menubar(win).getByRole('menuitem').first()).toHaveText('Fitxer');
  await win.keyboard.press('Control+,');
  prefs = win.getByRole('dialog', { name: 'Preferències' });
  await prefs.getByLabel('Idioma').selectOption('auto');
  await prefs.getByRole('button', { name: 'Desa' }).click();
  await expect(menubar(win).getByRole('menuitem').first()).toHaveText('Archivo');
  expect(errors).toEqual([]);
  await app.close();
});
