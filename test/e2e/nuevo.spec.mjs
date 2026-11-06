// «Nuevo documento» (Ctrl+N) en la app real: tamaño, orientación, páginas, guardar y cambios sin guardar.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tempDir, launch, footer, stubSaveAs, toolbarButton, confirmDialog, engine } from './helpers.mjs';

const dialog = (win) => win.getByRole('dialog', { name: 'Nuevo documento' });

test('desde el estado vacío: Carta horizontal de 3 páginas, se guarda con ese tamaño y recuerda la elección', async () => {
  const dir = await tempDir();
  const { app, win, errors } = await launch(dir);
  await win.getByRole('button', { name: 'Nuevo documento' }).click();
  const d = dialog(win);
  await expect(d).toBeVisible();
  // Por defecto: A4 vertical, 1 página.
  await expect(d.getByRole('radio', { name: /^A4/ })).toHaveAttribute('aria-checked', 'true');
  await expect(d.getByRole('radio', { name: 'Vertical' })).toHaveAttribute('aria-checked', 'true');
  await expect(d.getByLabel('Páginas')).toHaveValue('1');
  await expect(d.getByRole('radio', { name: /^A4/ })).toBeFocused();

  await d.getByRole('radio', { name: /^Carta/ }).click();
  await d.getByRole('radio', { name: 'Horizontal' }).click();
  await d.getByRole('button', { name: 'Una página más' }).click();
  await d.getByRole('button', { name: 'Una página más' }).click();
  await expect(d.getByText('3 páginas · Carta horizontal')).toBeVisible();
  const preview = d.locator('[data-testid="vista-nuevo"] [data-w]');
  await expect(preview).toHaveAttribute('data-w', '792');
  await expect(preview).toHaveAttribute('data-h', '612');
  // Un número fuera de rango desactiva «Crear».
  await d.getByLabel('Páginas').fill('0');
  await expect(d.getByRole('button', { name: 'Crear' })).toBeDisabled();
  await expect(d.getByRole('alert')).toHaveText('Escribe un número de 1 a 500.');
  await d.getByLabel('Páginas').fill('3');
  await d.getByRole('button', { name: 'Crear' }).click();

  await expect(dialog(win)).toHaveCount(0);
  await expect(footer(win)).toContainText('3 páginas');
  await expect(footer(win)).toContainText('Documento sin guardar');
  await expect(win.getByRole('tab', { name: 'Leer' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()))
    .toBe('● Documento sin guardar – SpiderPDF');

  // Guardar pide dónde (no hay archivo) y escribe un PDF de 3 páginas Carta horizontal.
  const out = path.join(dir, 'nuevo.pdf');
  await stubSaveAs(app, out);
  await toolbarButton(win, /^Guardar \(/).click();
  await expect.poll(() => existsSync(out), { timeout: 20_000 }).toBe(true);
  await expect(footer(win)).toContainText('nuevo.pdf');
  const core = await engine();
  const doc = core.open(await readFile(out));
  expect(doc.pages.map((p) => [Math.round(p.width), Math.round(p.height)])).toEqual([[792, 612], [792, 612], [792, 612]]);
  core.close(doc.docId);

  // Ctrl+N recuerda Carta horizontal (las páginas vuelven a 1).
  await win.keyboard.press('Control+N');
  await expect(dialog(win).getByRole('radio', { name: /^Carta/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog(win).getByRole('radio', { name: 'Horizontal' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog(win).getByLabel('Páginas')).toHaveValue('1');
  await win.keyboard.press('Escape');
  await expect(dialog(win)).toHaveCount(0);
  expect(errors).toEqual([]);
  await app.close();
});

test('con cambios sin guardar pide confirmación; flechas para elegir el tamaño e Intro para crear', async () => {
  const dir = await tempDir();
  const { app, win } = await launch(dir);
  await win.keyboard.press('Control+N');
  await dialog(win).getByRole('button', { name: 'Crear' }).click(); // A4 vertical, 1 página
  await expect(footer(win)).toContainText('1 página');

  await win.keyboard.press('Control+N');
  const d = dialog(win);
  await expect(d.getByRole('radio', { name: /^A4/ })).toBeFocused();
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('ArrowRight');
  await expect(d.getByRole('radio', { name: /^A3/ })).toHaveAttribute('aria-checked', 'true');
  await d.getByLabel('Páginas').fill('2');
  await d.getByLabel('Páginas').press('Enter');

  // El documento anterior no está guardado: confirmación aparte.
  await expect(confirmDialog(win)).toContainText('Si creas un documento nuevo, se perderán los cambios de este.');
  await confirmDialog(win).getByRole('button', { name: 'Cancelar' }).click();
  await expect(footer(win)).toContainText('1 página');

  await win.keyboard.press('Control+N');
  await dialog(win).getByLabel('Páginas').fill('2');
  await dialog(win).getByRole('button', { name: 'Crear' }).click();
  await confirmDialog(win).getByRole('button', { name: 'Crear sin guardar' }).click();
  await expect(footer(win)).toContainText('2 páginas');
  // A3 vertical en pantalla: más alta que ancha y más grande que un A4.
  const box = await win.locator('[data-i="0"]').boundingBox();
  expect(box.height / box.width).toBeCloseTo(420 / 297, 2);
  await app.close();
});
