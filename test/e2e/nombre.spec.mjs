// Nombre e icono de SpiderPDF en la app real: proceso principal, ventana, barra de título y estado vacío.
import { test, expect } from '@playwright/test';
import { tempDir, copyFixture, launch } from './helpers.mjs';

test('se llama SpiderPDF y lleva su icono (ventana, barra de título y estado vacío)', async () => {
  const dir = await tempDir();
  const { app, win, errors } = await launch(dir);

  const main = await app.evaluate(({ app: a, BrowserWindow, nativeImage }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const file = `${a.getAppPath()}/build/${process.platform === 'win32' ? 'icon.ico' : 'icon.png'}`;
    const icon = process.platform !== 'darwin' ? nativeImage.createFromPath(file) : null;
    return { name: a.getName(), title: w.getTitle(), userData: a.getPath('userData'), iconEmpty: icon ? icon.isEmpty() : null };
  });
  expect(main.name).toBe('SpiderPDF');
  expect(main.title).toBe('SpiderPDF');
  if (main.iconEmpty !== null) expect(main.iconEmpty).toBe(false); // el .ico/.png que usa la ventana se puede leer

  // Barra de título (Windows/Linux) y estado vacío: el icono se carga (no es una imagen rota).
  const loaded = (img) => img.evaluate((el) => el.complete && el.naturalWidth > 0);
  if (process.platform !== 'darwin') {
    const corner = win.locator('.titlebar img').first();
    await expect(corner).toBeVisible();
    expect(await loaded(corner)).toBe(true);
    await expect(win.locator('.titlebar-title')).toHaveText('SpiderPDF');
  }
  const big = win.getByRole('img', { name: 'SpiderPDF' });
  await expect(big).toBeVisible();
  expect(await loaded(big)).toBe(true);
  expect((await big.boundingBox()).width).toBe(88);

  // Con un documento abierto, el título es «nombre – SpiderPDF».
  await app.close();
  const dir2 = await tempDir();
  const second = await launch(dir2, [await copyFixture(dir2, 'contrato.pdf')]);
  await expect.poll(() => second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()))
    .toBe('contrato.pdf – SpiderPDF');
  expect(errors).toEqual([]);
  await second.app.close();
});
