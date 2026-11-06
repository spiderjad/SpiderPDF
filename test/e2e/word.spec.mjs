// Exportar a Word en la app real: botón «Exportar» → Word, vista previa, documento con estilos de Word, abrir en
// Word (sustituido) y el camino de las páginas escaneadas (OCR primero y vuelta al diálogo).
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { tempDir, copyFixture, launch, stubSaveAs } from './helpers.mjs';

const exportMenu = async (win) => {
  await win.locator('header').getByRole('button', { name: 'Exportar' }).click();
  return win.getByRole('menu', { name: 'Exportar' });
};
const docText = (xml) => (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((m) => m.replace(/<[^>]+>/g, '')).join('');

test('informe: vista previa, opciones, .docx con títulos, listas, tabla e imágenes, abrir en Word', async () => {
  const dir = await tempDir();
  const { app, win, errors } = await launch(dir, [await copyFixture(dir, 'informe.pdf')]);
  await app.evaluate(() => { globalThis.__opened = []; globalThis.__spiderPdfOpenPathHook = async (p) => { globalThis.__opened.push(p); return ''; }; });

  // Menú con teclado: flecha abajo abre, el primero es Word.
  const btn = win.locator('header').getByRole('button', { name: 'Exportar' });
  await btn.focus();
  await win.keyboard.press('ArrowDown');
  const menu = win.getByRole('menu', { name: 'Exportar' });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await expect(menu.getByRole('menuitem').first()).toContainText('Documento de Word');
  await win.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(btn).toBeFocused();

  await (await exportMenu(win)).getByRole('menuitem', { name: /Documento de Word/ }).click();
  const dlg = win.getByRole('dialog', { name: 'Exportar a Word' });
  const found = dlg.getByRole('list', { name: 'Contenido encontrado' });
  await expect(found).toBeVisible({ timeout: 20_000 });
  await expect(found.getByRole('listitem')).toHaveText(['5títulos', '6párrafos', '2listas', '1tabla', '2imágenes']);

  // Vista previa: el título como encabezado, la lista, la tabla y las dos imágenes.
  const preview = dlg.getByLabel('Vista previa del documento');
  await expect(preview.getByRole('heading', { name: 'Informe trimestral de ventas' })).toBeVisible();
  await expect(preview.getByRole('heading', { name: '1.1 Canales' })).toBeVisible();
  await expect(preview.getByRole('listitem')).toHaveCount(6);
  await expect(preview.getByRole('table')).toContainText('47.152,00');
  await expect(preview.locator('img')).toHaveCount(2);
  await expect(preview).toContainText('calendario de suministro más estable');
  await dlg.getByLabel('Incluir las imágenes').uncheck();
  await expect(preview.locator('img')).toHaveCount(0);
  await dlg.getByLabel('Incluir las imágenes').check();

  const out = path.join(dir, 'informe.docx');
  await stubSaveAs(app, out);
  await dlg.getByRole('button', { name: 'Exportar…' }).click();
  await expect(dlg).toHaveCount(0);
  const toast = win.getByRole('status').filter({ hasText: 'Exportado «informe.docx».' });
  await expect(toast).toBeVisible();

  const zip = await JSZip.loadAsync(await readFile(out));
  const xml = await zip.file('word/document.xml').async('string');
  const styles = (xml.match(/<w:pStyle w:val="([^"]+)"\/>/g) ?? []).map((m) => m.match(/w:val="([^"]+)"/)[1]).filter((s) => s !== 'ListParagraph');
  expect(styles).toEqual(['Title', 'Heading1', 'Heading2', 'Heading1', 'Heading1']);
  expect(docText(xml)).toContain('Tiendas tradicionales y charcuterías de barrio, con un crecimiento sostenido durante todo el trimestre gracias a las nuevas rutas.');
  expect((xml.match(/<w:numPr>/g) ?? []).length).toBe(6);
  expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(1);
  expect((xml.match(/<pic:pic/g) ?? []).length).toBe(2);
  // En la app las imágenes van como PNG (el logo, con transparencia) y JPEG (la foto).
  const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/') && !f.endsWith('/'));
  expect(media.map((f) => path.extname(f)).sort()).toEqual(['.jpg', '.png']);

  await toast.getByRole('button', { name: 'Abrir en Word' }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__opened.length)).toBe(1);
  expect(path.basename(await app.evaluate(() => globalThis.__opened[0]))).toBe('informe.docx');
  expect(errors).toEqual([]);
  await app.close();
});

test('página escaneada: «Reconocer el texto primero», OCR y vuelta al diálogo con el texto', async () => {
  test.setTimeout(180_000);
  const dir = await tempDir();
  const { app, win, errors } = await launch(dir, [await copyFixture(dir, 'albaran-escaneado.pdf')]);
  // Archivo → Exportar a Word…
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: 'Exportar a Word…' }).click();
  let dlg = win.getByRole('dialog', { name: 'Exportar a Word' });
  await expect(dlg).toContainText('3 páginas son escaneadas y todavía no tienen texto');
  await expect(dlg.getByRole('list', { name: 'Contenido encontrado' }).getByRole('listitem').last()).toHaveText('3imágenes');
  await dlg.getByRole('button', { name: 'Reconocer el texto primero' }).click();

  const ocr = win.getByRole('dialog', { name: 'Reconocer texto (OCR)' });
  await ocr.getByRole('button', { name: 'Reconocer' }).click();
  dlg = win.getByRole('dialog', { name: 'Exportar a Word' });
  await expect(dlg).toBeVisible({ timeout: 150_000 });
  await expect(dlg).not.toContainText('son escaneadas');
  const preview = dlg.getByLabel('Vista previa del documento');
  await expect(preview).toContainText(/Tornillos hexagonales/i, { timeout: 20_000 });
  await expect(preview.locator('img')).toHaveCount(0); // la imagen de la página la sustituye su texto

  const out = path.join(dir, 'albaran.docx');
  await stubSaveAs(app, out);
  await dlg.getByRole('button', { name: 'Exportar…' }).click();
  await expect(win.getByRole('status').filter({ hasText: 'Exportado «albaran.docx».' })).toBeVisible();
  const xml = await (await JSZip.loadAsync(await readFile(out))).file('word/document.xml').async('string');
  expect(docText(xml)).toMatch(/Pe[ñn]alba/);
  expect(errors).toEqual([]);
  await app.close();
});
