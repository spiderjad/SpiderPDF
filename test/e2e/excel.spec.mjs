// Exportar a Excel en la app real: factura (con rejilla) + albarán de dos páginas (sin líneas), unidos.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { tempDir, copyFixture, launch, stubSaveAs } from './helpers.mjs';

test('factura y albarán: vista previa, opciones, libro con números y fechas reales, abrir en Excel', async () => {
  const dir = await tempDir();
  const files = [await copyFixture(dir, 'factura.pdf'), await copyFixture(dir, 'albaran-lineas.pdf')];
  const { app, win, errors } = await launch(dir, files);
  await app.evaluate(() => { globalThis.__opened = []; globalThis.__spiderPdfOpenPathHook = async (p) => { globalThis.__opened.push(p); return ''; }; });

  // Desde el botón «Exportar» de la barra: Word arriba y Excel debajo.
  await win.locator('header').getByRole('button', { name: 'Exportar' }).click();
  const menu = win.getByRole('menu', { name: 'Exportar' });
  await expect(menu.getByRole('menuitem')).toHaveText([/Documento de Word\s*\.docx/, /Libro de Excel\s*\.xlsx/]);
  await menu.getByRole('menuitem', { name: /Libro de Excel/ }).click();
  const dlg = win.getByRole('dialog', { name: 'Exportar a Excel' });
  const list = dlg.getByRole('list', { name: 'Tablas encontradas' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').nth(0)).toContainText('Página 1 · 9 filas × 6 columnas');
  // El albarán sigue en la página siguiente: unido, con la cabecera repetida quitada.
  await expect(list.getByRole('listitem').nth(1)).toContainText('Páginas 2-3 · 13 filas × 6 columnas');

  // Vista previa: como se verá en Excel (importe con miles y decimales, fecha).
  const preview = dlg.getByRole('table', { name: 'Vista previa de la tabla 1' });
  await expect(preview).toContainText('10.625,00');
  await list.getByRole('button', { name: /Tabla 2/ }).click();
  await expect(dlg.getByRole('table', { name: 'Vista previa de la tabla 2' })).toContainText('15/01/2027');
  await expect(dlg.getByRole('table', { name: 'Vista previa de la tabla 2' })).toContainText('Chorizo ibérico loncheado 100 g en bandeja de atmósfera protectora');

  // Sin unir: tres tablas.
  await dlg.getByLabel('Unir las tablas que siguen en la página siguiente').uncheck();
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await dlg.getByLabel('Unir las tablas que siguen en la página siguiente').check();

  const out = path.join(dir, 'tablas.xlsx');
  await stubSaveAs(app, out);
  await dlg.getByRole('button', { name: 'Exportar…' }).click();
  // Al exportar se cierra la ventana; el aviso ofrece abrirlo en Excel.
  await expect(dlg).toHaveCount(0);
  const toast = win.getByRole('status').filter({ hasText: 'Exportado «tablas.xlsx».' });
  await expect(toast).toBeVisible();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await readFile(out));
  expect(wb.worksheets.map((w) => w.name)).toEqual(['Tabla 1 (pág. 1)', 'Tabla 2 (págs. 2-3)']);
  const f = wb.worksheets[0];
  expect(f.getCell('B1').value).toBe('Descripción');
  expect(f.getCell('C2').value).toBe(120);
  expect(f.getCell('F8').value).toBe(10625);
  const a = wb.worksheets[1];
  expect(a.rowCount).toBe(13);
  expect(a.getCell('D2').value).toBeInstanceOf(Date);
  expect(a.getCell('F2').value).toBe(21.6);

  await toast.getByRole('button', { name: 'Abrir en Excel' }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__opened.length)).toBe(1);
  expect(path.basename(await app.evaluate(() => globalThis.__opened[0]))).toBe('tablas.xlsx');

  // Una hoja por página (desde el menú Archivo).
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: 'Exportar a Excel…' }).click();
  const out2 = path.join(dir, 'por-pagina.xlsx');
  await stubSaveAs(app, out2);
  await dlg.getByLabel('Una por página').check();
  await dlg.getByRole('button', { name: 'Exportar…' }).click();
  await expect(win.getByRole('status').filter({ hasText: 'Exportado «por-pagina.xlsx».' })).toBeVisible();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(await readFile(out2));
  expect(wb2.worksheets.map((w) => w.name)).toEqual(['Página 1', 'Página 2']);

  // Cancelar el diálogo de guardar: la ventana sigue abierta.
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: 'Exportar a Excel…' }).click();
  await stubSaveAs(app, null);
  await dlg.getByRole('button', { name: 'Exportar…' }).click();
  await expect(dlg.getByRole('button', { name: 'Exportar…' })).toBeEnabled();
  await dlg.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dlg).toHaveCount(0);
  expect(errors).toEqual([]);
  await app.close();
});

test('un PDF sin tablas lo dice', async () => {
  const dir = await tempDir();
  const { app, win } = await launch(dir, [await copyFixture(dir, 'contrato.pdf')]);
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: 'Exportar a Excel…' }).click();
  await expect(win.getByRole('dialog', { name: 'Exportar a Excel' }).getByText('No se encontraron tablas')).toBeVisible();
  await expect(win.getByRole('button', { name: 'Exportar…' })).toBeDisabled();
  await app.close();
});
