// Herramienta «Borrar» en la app real: quitar una imagen del PDF (una firma escaneada) con un clic, dejar una zona en
// blanco arrastrando, deshacer y guardar (lo borrado ya no está en el archivo).
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { tempDir, launch, footer, readWhenChanged, engine } from './helpers.mjs';
import { pngRGB } from '../forensics.js';

const tool = (win, name) => win.getByRole('toolbar', { name: 'Herramientas de anotación' }).getByRole('button', { name, exact: true });
const page0 = (win) => win.locator('[data-i="0"]');
/** Punto de la página 1 en coordenadas PDF (puntos desde abajo a la izquierda). */
async function atPt(win, x, y) {
  const b = await page0(win).boundingBox();
  return [b.x + (x / 595) * b.width, b.y + (1 - y / 842) * b.height];
}

test('quitar una firma escaneada con un clic y dejar una zona en blanco; deshacer; al guardar ya no están', async () => {
  const dir = await tempDir();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const firma = await doc.embedPng(pngRGB(120, 40, () => [20, 40, 160]));
  const logo = await doc.embedPng(pngRGB(60, 60, () => [200, 30, 30]));
  const p = doc.addPage([595, 842]);
  p.drawText('Firmado: Juan Garcia', { x: 60, y: 700, size: 14, font });
  p.drawImage(firma, { x: 60, y: 600, width: 180, height: 60 });
  p.drawImage(logo, { x: 450, y: 740, width: 60, height: 60 });
  const file = path.join(dir, 'firmado-a-mano.pdf');
  const original = await doc.save();
  await writeFile(file, original);

  const { app, win, errors } = await launch(dir, [file]);
  await win.getByRole('tab', { name: 'Leer' }).click();
  await tool(win, 'Borrar').click();
  await expect(footer(win)).toContainText('Haz clic en una imagen del PDF (una firma, un logo) para quitarla');
  // Las imágenes que se pueden quitar, también con el teclado.
  await expect(win.getByRole('button', { name: /^Quitar la imagen \d$/ })).toHaveCount(2);

  // Sobre la firma: se marca; clic: se quita (queda en blanco hasta guardar).
  await win.mouse.move(...await atPt(win, 150, 630));
  await expect(win.getByText('Clic para quitar esta imagen')).toBeVisible();
  await win.mouse.down();
  await win.mouse.up();
  await expect(page0(win).locator('[data-erase="image"]')).toHaveCount(1);
  await expect(win.getByRole('button', { name: /^Quitar la imagen \d$/ })).toHaveCount(1);
  await expect(footer(win)).toContainText('Cambios sin guardar');

  // Arrastrar sobre «Juan Garcia»: esa zona quedará en blanco.
  await win.mouse.move(...await atPt(win, 120, 722));
  await win.mouse.down();
  await win.mouse.move(...await atPt(win, 240, 690), { steps: 5 });
  await win.mouse.up();
  await expect(page0(win).locator('[data-erase="zone"]')).toHaveCount(1);
  // Deshacer y rehacer la zona.
  await win.keyboard.press('Control+Z');
  await expect(page0(win).locator('[data-erase="zone"]')).toHaveCount(0);
  await win.keyboard.press('Control+Y');
  await expect(page0(win).locator('[data-erase="zone"]')).toHaveCount(1);

  await win.keyboard.press('Control+S');
  const saved = await readWhenChanged(file, Buffer.from(original));
  const core = await engine();
  const d = core.open(saved);
  expect(core.imageObjects(d.docId, 0)).toHaveLength(1); // queda el logo
  const text = core.pageText(d.docId, 0);
  expect(text).toContain('Firmado:');
  expect(text).not.toContain('Juan');
  core.close(d.docId);
  expect(errors).toEqual([]);
  await app.close();
});
