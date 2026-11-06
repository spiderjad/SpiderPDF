// Datos de la versión anterior («PDF Editor») en la app real: recientes y firmas guardadas pasan a SpiderPDF.
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tempDir, copyFixture, launch } from './helpers.mjs';

// Una firma mínima válida (PNG de 1×1) como las que guarda el diálogo de firma.
const SIG = { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' };

test('la primera vez trae los recientes y las firmas guardadas de la carpeta de «PDF Editor»; la segunda, nada', async () => {
  // 1) «PDF Editor»: una ventana con su carpeta de datos, la firma guardada con la clave antigua y un reciente.
  const oldDir = await tempDir();
  const pdf = await copyFixture(oldDir, 'contrato.pdf');
  const old = await launch(oldDir);
  await old.win.evaluate((v) => localStorage.setItem('pdf-editor:firmas', v), JSON.stringify([SIG]));
  await old.app.close(); // al cerrar, Chromium escribe la base de localStorage en disco
  const legacy = path.join(oldDir, 'datos-app');
  await writeFile(path.join(legacy, 'recientes.json'), JSON.stringify([{ path: pdf, name: 'contrato.pdf', openedAt: 1 }]));
  expect(existsSync(path.join(legacy, 'Local Storage'))).toBe(true);

  // 2) SpiderPDF, carpeta nueva: arranca con lo de antes.
  const dir = await tempDir();
  const { app, win, errors } = await launch(dir, [], { SPIDERPDF_LEGACY_DATA: legacy });
  expect(await win.evaluate(() => localStorage.getItem('spiderpdf:firmas'))).toBe(JSON.stringify([SIG]));
  expect((await win.evaluate(() => window.desktop.recents())).map((r) => r.name)).toEqual(['contrato.pdf']);
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: 'Abrir reciente' }).hover();
  await expect(win.getByRole('menu', { name: 'Abrir reciente' }).getByRole('menuitem')).toHaveText(['contrato.pdf', 'Borrar lista']);
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');

  const marker = JSON.parse(await readFile(path.join(dir, 'datos-app', 'migracion.json'), 'utf8'));
  expect(marker).toMatchObject({ done: true, storage: true, recents: 1 });
  expect(errors).toEqual([]);

  // 3) Segunda vez: no vuelve a migrar (borrar la lista no la recupera).
  await win.evaluate(() => window.desktop.clearRecents());
  await app.close();
  const again = await launch(dir, [], { SPIDERPDF_LEGACY_DATA: legacy });
  expect(await again.win.evaluate(() => window.desktop.recents())).toEqual([]);
  // La carpeta antigua sigue igual.
  expect(JSON.parse(await readFile(path.join(legacy, 'recientes.json'), 'utf8'))[0].name).toBe('contrato.pdf');
  await again.app.close();
});
