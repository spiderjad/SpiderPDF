// Editar → Marca de agua… en la app real: texto (predefinido), color, opacidad, mosaico, detrás, un intervalo de
// páginas, vista previa, deshacer; al guardar, trazos marcados como de SpiderPDF (no es texto). Imagen. Quitar las
// marcas de agua de un PDF que ya las trae.
import { test, expect } from '@playwright/test';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tempDir, copyFixture, launch, readWhenChanged, engine, stubOpen, docTabs } from './helpers.mjs';
import { pngRGB } from '../forensics.js';

async function menu(win, top, item) {
  await win.getByRole('menubar').getByRole('menuitem', { name: top }).click();
  await win.getByRole('menu', { name: top }).getByRole('menuitem', { name: item }).click();
}
const dialog = (win) => win.getByRole('dialog', { name: 'Marca de agua' });

/** Marcas de agua de un PDF guardado: páginas, tipo de objeto de cada una, si va detrás y el texto de la página 1. */
async function inspect(file) {
  const core = await engine();
  const d = core.open(await readFile(file));
  try {
    const pages = core.watermarkPages(d.docId);
    const detail = pages.map((i) => {
      const pg = core.m.FPDF_LoadPage(core.doc(d.docId), i);
      const objs = core.watermarkObjects(pg);
      const back = core.isWatermark(core.m.FPDFPage_GetObject(pg, 0));
      const types = [...new Set(objs.map((o) => core.m.FPDFPageObj_GetType(o)))];
      core.m.FPDF_ClosePage(pg);
      return { copies: objs.length, back, types };
    });
    return { pages, detail, text: core.pageText(d.docId, 0) };
  } finally {
    core.close(d.docId);
  }
}

test('marca de agua de texto: vista previa, mosaico detrás en un intervalo, deshacer, guardar (trazos marcados) y quitarla después', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'contrato.pdf'); // 5 páginas
  const original = await readFile(file);
  const { app, win, errors } = await launch(dir, [file]);

  await menu(win, 'Editar', 'Marca de agua…');
  await expect(dialog(win)).toBeVisible();
  const dlg = dialog(win);
  // Por defecto: «BORRADOR», en diagonal, centrada; ya se ve en la vista previa.
  await expect(dlg.getByLabel('Texto de la marca')).toHaveValue('BORRADOR');
  await expect(dlg.getByRole('radio', { name: 'Diagonal' })).toHaveAttribute('aria-checked', 'true');
  const preview = dlg.getByTestId('marca-vista-previa');
  await expect(preview.locator('[data-watermark="BORRADOR"]')).toHaveAttribute('data-copies', '1');

  // Confidencial, rojo, 50 %, en mosaico y detrás del contenido, en las páginas 1 a 3.
  await dlg.getByRole('button', { name: 'Confidencial' }).click();
  await expect(dlg.getByLabel('Texto de la marca')).toHaveValue('CONFIDENCIAL');
  await dlg.getByRole('radio', { name: 'Rojo' }).click();
  await dlg.getByLabel('Opacidad').fill('50');
  await expect(dlg.locator('output[for="wm-opacidad"]')).toHaveText('50 %');
  await dlg.getByRole('radio', { name: 'En mosaico' }).click();
  await dlg.getByRole('radio', { name: 'Detrás del contenido' }).click();
  await expect(dlg.getByText('Detrás no se ve en las páginas escaneadas')).toBeVisible();
  const tiles = Number(await preview.locator('[data-watermark="CONFIDENCIAL"]').getAttribute('data-copies'));
  expect(tiles).toBeGreaterThan(5);
  await expect(preview.locator('[data-watermark="CONFIDENCIAL"]')).toHaveAttribute('data-layer', 'back');
  // Intervalo mal escrito: no deja aplicar y lo dice.
  await dlg.getByLabel('Páginas del intervalo').fill('1-9');
  await expect(dlg.getByRole('alert')).toContainText('5');
  await expect(dlg.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
  await dlg.getByLabel('Páginas del intervalo').fill('1-3');
  await dlg.getByRole('button', { name: 'Aplicar' }).click();
  await expect(dialog(win)).toHaveCount(0);
  await expect(win.getByText('Marca de agua en 3 páginas.')).toBeVisible();

  // En las miniaturas, solo en las tres primeras; deshacer y rehacer.
  const marked = win.locator('main [data-watermark="CONFIDENCIAL"]');
  await expect(marked).toHaveCount(3);
  await win.keyboard.press('Control+Z');
  await expect(marked).toHaveCount(0);
  await win.keyboard.press('Control+Y');
  await expect(marked).toHaveCount(3);

  // Guardar: en el PDF, trazos (no texto) marcados como marca de agua, detrás de todo, solo en esas páginas.
  await win.keyboard.press('Control+S');
  const saved = await readWhenChanged(file, original);
  const outFile = path.join(dir, 'con-marca.pdf');
  await writeFile(outFile, saved);
  const r = await inspect(outFile);
  expect(r.pages).toEqual([0, 1, 2]);
  for (const p of r.detail) expect(p).toMatchObject({ back: true, types: [2] });
  expect(r.detail[0].copies).toBeGreaterThan(5);
  expect(r.text).not.toMatch(/CONFIDENCIAL/);

  // Se recuerda lo último al volver a abrir el diálogo.
  await menu(win, 'Editar', 'Marca de agua…');
  await expect(dialog(win).getByLabel('Texto de la marca')).toHaveValue('CONFIDENCIAL');
  await expect(dialog(win).getByRole('radio', { name: 'En mosaico' })).toHaveAttribute('aria-checked', 'true');
  await win.keyboard.press('Escape');
  await expect(dialog(win)).toHaveCount(0);

  // Otro PDF que ya trae marcas de agua de SpiderPDF: el diálogo lo dice y las quita (del archivo, al guardar).
  const other = path.join(dir, 'ya-marcado.pdf');
  await copyFile(outFile, other);
  await stubOpen(app, [other]);
  await win.keyboard.press('Control+O');
  await expect(docTabs(win)).toHaveCount(2);
  await menu(win, 'Editar', 'Marca de agua…');
  await expect(dialog(win).getByText('Este documento tiene marca de agua de SpiderPDF en 3 páginas.')).toBeVisible();
  await dialog(win).getByRole('button', { name: 'Quitar las marcas de agua' }).click();
  await expect(dialog(win)).toHaveCount(0);
  await expect(win.getByText('Marcas de agua quitadas.')).toBeVisible();
  const before = await readFile(other);
  await win.keyboard.press('Control+S');
  await readWhenChanged(other, before);
  expect((await inspect(other)).pages).toEqual([]);
  // Deshacer vuelve a dejarlas (y se ven otra vez en el archivo al guardar).
  await win.keyboard.press('Control+Z');
  const before2 = await readFile(other);
  await win.keyboard.press('Control+S');
  await readWhenChanged(other, before2);
  expect((await inspect(other)).pages).toEqual([0, 1, 2]);

  expect(errors).toEqual([]);
  await app.close();
});

test('marca de agua de imagen: el logo (sin el fondo blanco) centrado en todas las páginas; delante', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'contrato.pdf');
  const original = await readFile(file);
  const logo = path.join(dir, 'logo.png');
  await writeFile(logo, pngRGB(120, 80, (x, y) => (x > 20 && x < 100 && y > 15 && y < 65 ? [30, 60, 180] : [255, 255, 255])));
  const { app, win, errors } = await launch(dir, [file]);

  await menu(win, 'Editar', 'Marca de agua…');
  const dlg = dialog(win);
  await dlg.getByRole('radio', { name: 'Imagen' }).click();
  await expect(dlg.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
  await dlg.getByTestId('marca-imagen').setInputFiles(logo);
  await expect(dlg.getByTestId('marca-vista-previa').locator('[data-watermark="image"]')).toHaveCount(1);
  await dlg.getByLabel('Ancho (de la página)').fill('30');
  await expect(dlg.locator('output[for="wm-escala"]')).toHaveText('30 %');
  await dlg.getByRole('radio', { name: 'Centrada' }).click();
  await dlg.getByRole('radio', { name: 'Delante del contenido' }).click();
  await dlg.getByRole('button', { name: 'Aplicar' }).click();
  await expect(win.getByText('Marca de agua en 5 páginas.')).toBeVisible();
  await expect(win.locator('main [data-watermark="image"]')).toHaveCount(5);

  await win.keyboard.press('Control+S');
  const saved = await readWhenChanged(file, original);
  const out = path.join(dir, 'salida.pdf');
  await writeFile(out, saved);
  const r = await inspect(out);
  expect(r.pages).toEqual([0, 1, 2, 3, 4]);
  for (const p of r.detail) expect(p).toMatchObject({ copies: 1, back: false, types: [3] });
  expect(errors).toEqual([]);
  await app.close();
});
