// Archivo → Exportar como imagen… y clic derecho → «Copiar como imagen», en la app real: PNG y JPG, resolución (y
// la que va escrita dentro del archivo), intervalo, patrón de nombre, archivos que ya existen, páginas giradas y con
// cambios (marca de agua), portapapeles del sistema (también con el teclado).
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import jpegjs from 'jpeg-js';
import { tempDir, copyFixture, launch } from './helpers.mjs';
import { readDpi } from '../../src/imageExport.js';

async function menu(win, top, item) {
  await win.getByRole('menubar').getByRole('menuitem', { name: top }).click();
  await win.getByRole('menu', { name: top }).getByRole('menuitem', { name: item }).click();
}
const dialog = (win) => win.getByRole('dialog', { name: 'Exportar como imagen' });
// La imagen del portapapeles tal como la ve Windows (lo que pega Word o Paint): «ancho x alto» o vacío.
const windowsClipboardImage = () => execFileSync('powershell', ['-NoProfile', '-STA', '-Command',
  'Add-Type -A System.Windows.Forms; $i = [Windows.Forms.Clipboard]::GetImage(); if ($i) { "$($i.Width)x$($i.Height)" }'], { encoding: 'utf8' }).trim();
const pngSize = (b) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });
/** Píxeles claramente rojos de una imagen (leída con Electron, en el proceso principal). */
const redPixels = (app, file) => app.evaluate(({ nativeImage }, f) => {
  const img = nativeImage.createFromPath(f);
  const px = img.toBitmap(); // BGRA
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 2] > 180 && px[i + 1] < 90 && px[i] < 90) n++;
  return n;
}, file);

test('exportar como imagen: PNG a 72 ppp de un intervalo, JPG a 100 ppp con otro nombre, los que ya existen, página girada y con marca de agua', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'contrato.pdf'); // 5 páginas A4
  const { app, win, errors } = await launch(dir, [file]);

  await menu(win, 'Archivo', 'Exportar como imagen…');
  const dlg = dialog(win);
  await expect(dlg).toBeVisible();
  // Por defecto: PNG, 150 ppp, todas, en la carpeta del PDF, «{documento}_p{n}».
  await expect(dlg.getByRole('radio', { name: 'PNG' })).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.getByRole('radio', { name: '150 ppp' })).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.getByLabel('Carpeta de destino')).toHaveValue(dir);
  await expect(dlg.getByLabel('Nombre de los archivos')).toHaveValue('{documento}_p{n}');
  await expect(dlg.getByText('Saldrán 5 imágenes')).toBeVisible();
  await expect(dlg.getByText('contrato_p1.png')).toBeVisible();
  await expect(dlg.getByText('Página 1: 1240 × 1754 píxeles.')).toBeVisible();

  // 72 ppp, páginas 2 y 3.
  await dlg.getByRole('radio', { name: '72 ppp' }).click();
  await expect(dlg.getByText('Página 1: 595 × 842 píxeles.')).toBeVisible();
  await dlg.getByLabel('Páginas del intervalo').fill('2-3');
  await expect(dlg.getByText('Saldrán 2 imágenes')).toBeVisible();
  await dlg.getByRole('button', { name: 'Exportar 2 imágenes' }).click();
  await expect(win.getByText(`Exportadas 2 imágenes en «${path.basename(dir)}».`)).toBeVisible();
  for (const n of [2, 3]) {
    const b = await readFile(path.join(dir, `contrato_p${n}.png`));
    expect(pngSize(b)).toEqual({ width: 595, height: 842 });
    expect(readDpi(b)).toBe(72);
  }

  // JPG al 80 %, 100 ppp escritos a mano, otro patrón, todas.
  await menu(win, 'Archivo', 'Exportar como imagen…');
  await expect(dlg.getByRole('radio', { name: '72 ppp' })).toHaveAttribute('aria-checked', 'true'); // se recuerda
  await dlg.getByRole('radio', { name: 'JPG' }).click();
  await dlg.getByLabel('Calidad').fill('80');
  await dlg.getByRole('radio', { name: 'Otra' }).click();
  await dlg.getByLabel('Resolución en ppp').fill('700');
  await expect(dlg.getByRole('alert')).toContainText('entre 36 y 600 ppp');
  await dlg.getByLabel('Resolución en ppp').fill('100');
  await dlg.getByRole('radio', { name: /^Todas/ }).click();
  await dlg.getByLabel('Nombre de los archivos').fill('{documento}');
  await expect(dlg.getByRole('alert')).toContainText('{n}');
  await dlg.getByLabel('Nombre de los archivos').fill('pag-{n}');
  await expect(dlg.getByText('pag-1.jpg')).toBeVisible();
  await dlg.getByRole('button', { name: 'Exportar 5 imágenes' }).click();
  await expect(win.getByText(`Exportadas 5 imágenes en «${path.basename(dir)}».`)).toBeVisible();
  for (let n = 1; n <= 5; n++) {
    const b = await readFile(path.join(dir, `pag-${n}.jpg`));
    expect(readDpi(b)).toBe(100);
    const img = jpegjs.decode(b, { useTArray: true });
    expect([img.width, img.height]).toEqual([826, 1169]);
  }

  // Otra vez lo mismo: avisa de que ya existen y el botón lo dice.
  await menu(win, 'Archivo', 'Exportar como imagen…');
  await expect(dlg.getByText('5 archivos ya existen y se reemplazarán.')).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Exportar y reemplazar' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancelar' }).click();

  // Página 1 girada (sin componer) y página 2 con una marca de agua roja (compuesta, como al imprimir).
  await win.getByRole('button', { name: 'Girar la página 1 a la derecha' }).click();
  await menu(win, 'Editar', 'Marca de agua…');
  const wm = win.getByRole('dialog', { name: 'Marca de agua' });
  await wm.getByRole('radio', { name: 'Rojo' }).click();
  await wm.getByLabel('Opacidad').fill('100');
  await wm.getByLabel('Páginas del intervalo').fill('2');
  await wm.getByRole('button', { name: 'Aplicar' }).click();
  await menu(win, 'Archivo', 'Exportar como imagen…');
  await dlg.getByRole('radio', { name: 'PNG' }).click();
  await dlg.getByRole('radio', { name: '72 ppp' }).click();
  await dlg.getByLabel('Páginas del intervalo').fill('1-3');
  await dlg.getByLabel('Nombre de los archivos').fill('cambios_{n}');
  await dlg.getByRole('button', { name: 'Exportar 3 imágenes' }).click();
  await expect(win.getByText('Exportadas 3 imágenes', { exact: false })).toBeVisible();
  expect(pngSize(await readFile(path.join(dir, 'cambios_1.png')))).toEqual({ width: 842, height: 595 });
  expect(await redPixels(app, path.join(dir, 'cambios_2.png'))).toBeGreaterThan(500);
  expect(await redPixels(app, path.join(dir, 'cambios_3.png'))).toBe(0);
  expect(errors).toEqual([]);
  await app.close();
});

test('copiar como imagen: clic derecho sobre una página (y con el teclado) → PNG en el portapapeles a 150 ppp', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'contrato.pdf');
  const { app, win, errors } = await launch(dir, [file]);
  // Lo que hay en el portapapeles: el PNG que ve Electron y el mapa de bits que ve cualquier programa de Windows.
  const clipboardSize = () => app.evaluate(async ({ clipboard }) => {
    const items = await clipboard.read();
    const item = items.find((i) => i.types.includes('image/png'));
    if (!item) return null;
    const b = Buffer.from(await (await item.getType('image/png')).arrayBuffer());
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  });
  await app.evaluate(({ clipboard }) => clipboard.clear());

  // Ratón: clic derecho sobre la miniatura de la página 1 (Organizar).
  await win.locator('[data-page-key]').first().click({ button: 'right' });
  const pageMenu = win.getByRole('menu', { name: 'Página 1' });
  await expect(pageMenu).toBeVisible();
  await expect(pageMenu.getByRole('menuitem', { name: 'Copiar como imagen' })).toBeFocused();
  await pageMenu.getByRole('menuitem', { name: 'Copiar como imagen' }).click();
  await expect(win.getByText('Página 1 copiada como imagen.')).toBeVisible();
  await expect.poll(clipboardSize).toEqual({ width: 1240, height: 1754 });
  expect(windowsClipboardImage()).toBe('1240x1754');

  // Esc lo cierra sin hacer nada.
  await win.locator('[data-page-key]').nth(1).click({ button: 'right' });
  await expect(win.getByRole('menu', { name: 'Página 2' })).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(win.getByRole('menu', { name: 'Página 2' })).toHaveCount(0);

  // Teclado: la página 3 enfocada, Mayús+F10 e Intro. En Leer, con la página girada: apaisada.
  await win.getByRole('button', { name: 'Girar la página 3 a la derecha' }).click();
  await win.locator('[data-page-key]').nth(2).focus();
  await win.keyboard.press('Shift+F10');
  await expect(win.getByRole('menu', { name: 'Página 3' })).toBeVisible();
  await win.keyboard.press('Enter');
  await expect(win.getByText('Página 3 copiada como imagen.')).toBeVisible();
  await expect.poll(clipboardSize).toEqual({ width: 1754, height: 1240 });

  // También desde Leer (sobre la página grande) y desde el menú Editar.
  await win.getByRole('tab', { name: 'Leer' }).click();
  await win.locator('[data-i="0"]').click({ button: 'right', position: { x: 100, y: 100 } });
  await win.getByRole('menu', { name: 'Página 1' }).getByRole('menuitem', { name: 'Copiar como imagen' }).click();
  await expect(win.getByText('Página 1 copiada como imagen.')).toBeVisible();
  await app.evaluate(({ clipboard }) => clipboard.clear());
  await menu(win, 'Editar', 'Copiar la página como imagen');
  await expect(win.getByText('Página 1 copiada como imagen.')).toBeVisible();
  await expect.poll(clipboardSize).toEqual({ width: 1240, height: 1754 });
  expect(errors).toEqual([]);
  await app.close();
});
