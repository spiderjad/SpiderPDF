// Preferencias en la app real: nombre, carpeta de salida (diálogo de carpetas sustituido), calidad de compresión,
// Guardar y Cancelar; y que se usan: Guardar como y Exportar proponen la carpeta, Reducir sale con la calidad
// elegida y el Excel exportado lleva el nombre como autor.
import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { tempDir, copyFixture, launch, stubOpen } from './helpers.mjs';

/** El diálogo «Guardar como» nativo apunta qué ruta propuso la app y devuelve `answer` (null = cancelar). */
const watchSaveDialog = (app, answer) => app.evaluate(({ dialog }, a) => {
  globalThis.__proposed = [];
  dialog.showSaveDialog = async (_w, opts) => {
    globalThis.__proposed.push(opts?.defaultPath ?? null);
    return a ? { canceled: false, filePath: a } : { canceled: true };
  };
}, answer);
const proposed = (app) => app.evaluate(() => globalThis.__proposed);

test('preferencias: guardar, cancelar, validar y usarlas al guardar, reducir y exportar', async () => {
  const dir = await tempDir();
  const salida = path.join(dir, 'Salida PDF');
  await mkdir(salida);
  const { app, win, errors } = await launch(dir, [await copyFixture(dir, 'factura.pdf')]);
  const prefs = win.getByRole('dialog', { name: 'Preferencias' });
  const open = async () => { await win.keyboard.press('Control+,'); await expect(prefs).toBeVisible(); };

  // Por defecto: sin nombre, la carpeta del original y «Equilibrado». El foco empieza en el nombre.
  await open();
  const name = prefs.getByLabel('Tu nombre');
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('');
  const folder = prefs.getByLabel('Carpeta de salida por defecto');
  await expect(folder).toHaveValue('');
  await expect(folder).toHaveAttribute('placeholder', 'La del PDF original');
  await expect(prefs.getByLabel('Calidad de compresión')).toHaveValue('balanced');

  // Cancelar no guarda nada.
  await name.fill('Alguien');
  await prefs.getByRole('button', { name: 'Cancelar' }).click();
  await expect(prefs).toHaveCount(0);
  await open();
  await expect(prefs.getByLabel('Tu nombre')).toHaveValue('');

  // Nombre demasiado largo: error accesible y Guardar desactivado.
  await name.fill('x'.repeat(90));
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(prefs.getByText('Como mucho 80 caracteres.')).toBeVisible();
  await expect(prefs.getByRole('button', { name: 'Guardar' })).toBeDisabled();

  // Rellenar y guardar.
  await name.fill('Diego Pennisi');
  await stubOpen(app, [salida]);
  await prefs.getByRole('button', { name: 'Elegir…' }).click();
  await expect(prefs.getByLabel('Carpeta de salida por defecto')).toHaveValue(salida);
  await prefs.getByLabel('Calidad de compresión').selectOption({ label: 'Mínimo tamaño' });
  await expect(prefs.getByText('Imágenes a 96 ppp.', { exact: false })).toBeVisible();
  await prefs.getByRole('button', { name: 'Guardar' }).click();
  await expect(prefs).toHaveCount(0);
  await expect(win.getByRole('status').filter({ hasText: 'Preferencias guardadas.' })).toBeVisible();

  // Al volver a abrir, están; Esc cierra sin cambiar nada.
  await open();
  await expect(prefs.getByLabel('Tu nombre')).toHaveValue('Diego Pennisi');
  await expect(prefs.getByLabel('Carpeta de salida por defecto')).toHaveValue(salida);
  await expect(prefs.getByLabel('Calidad de compresión')).toHaveValue('small');
  await win.keyboard.press('Escape');
  await expect(prefs).toHaveCount(0);

  // Guardar como: propone la carpeta de salida (no la del original).
  await watchSaveDialog(app, null);
  await win.keyboard.press('Control+Shift+S');
  await expect.poll(() => proposed(app)).toEqual([path.join(salida, 'factura.pdf')]);

  // Reducir tamaño: sale elegida la calidad de Preferencias.
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: 'Reducir tamaño…' }).click();
  const reduce = win.getByRole('dialog', { name: 'Reducir tamaño' });
  await expect(reduce.getByRole('radio', { name: /Mínimo tamaño/ })).toBeChecked();
  await reduce.getByRole('button', { name: 'Cancelar' }).click();

  // Exportar a Excel: en la carpeta de salida y con el nombre como autor.
  const out = path.join(salida, 'tablas.xlsx');
  await watchSaveDialog(app, out);
  await win.locator('header').getByRole('button', { name: 'Exportar' }).click();
  await win.getByRole('menu', { name: 'Exportar' }).getByRole('menuitem', { name: /Libro de Excel/ }).click();
  await win.getByRole('dialog', { name: 'Exportar a Excel' }).getByRole('button', { name: 'Exportar…' }).click();
  await expect(win.getByRole('status').filter({ hasText: 'Exportado «tablas.xlsx».' })).toBeVisible();
  expect(await proposed(app)).toEqual([path.join(salida, 'factura.xlsx')]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await readFile(out));
  expect(wb.creator).toBe('Diego Pennisi');

  // Quitar la carpeta: vuelve a ser la del original.
  await open();
  await prefs.getByRole('button', { name: 'Quitar la carpeta de salida' }).click();
  await expect(prefs.getByLabel('Carpeta de salida por defecto')).toHaveValue('');
  await prefs.getByRole('button', { name: 'Guardar' }).click();
  await watchSaveDialog(app, null);
  await win.keyboard.press('Control+Shift+S');
  await expect.poll(() => proposed(app)).toEqual([path.join(dir, 'factura.pdf')]);

  expect(errors).toEqual([]);
  await app.close();
});
