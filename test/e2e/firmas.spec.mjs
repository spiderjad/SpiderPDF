// Firmas digitales en la app real: estado en la barra, panel, certificación y versiones desfasadas.
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  tempDir, copyFixture, launch, stubOpen, footer, sigButton, expectSigStatus, verifyPdfSignatures, toolbarButton,
} from './helpers.mjs';

test('firmado.pdf: «Firma intacta» visible en la barra y el panel con firmante y fecha', async () => {
  const dir = await tempDir();
  const { app, win, errors } = await launch(dir, [await copyFixture(dir, 'firmado.pdf')]);
  await expectSigStatus(win, 'Firma intacta. Identidad del firmante sin verificar.');
  await sigButton(win).click();
  const panel = win.getByRole('dialog', { name: 'Firmas digitales' });
  await expect(panel).toContainText('Firma de prueba');
  await expect(panel).toContainText(/\d{4}, \d{1,2}:\d{2}/); // fecha y hora
  await win.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
  await app.close();
});

test('copia rota (un byte cambiado dentro de lo firmado): «Firma rota» en rojo', async () => {
  const dir = await tempDir();
  const broken = await readFile(await copyFixture(dir, 'firmado.pdf'));
  expect(broken.subarray(0, 10).toString('latin1')).toBe('%PDF-1.7\n%');
  broken[11] ^= 1; // la línea binaria del encabezado (%âãÏÓ): el PDF se abre igual, el resumen ya no coincide
  const file = path.join(dir, 'rota.pdf');
  await writeFile(file, broken);
  expect(verifyPdfSignatures(broken)[0].status).toBe('broken');

  const { app, win } = await launch(dir, [file]);
  await expectSigStatus(win, 'Firma rota: el documento se modificó después de firmar.');
  await expect(sigButton(win)).toHaveClass(/text-danger/);
  await sigButton(win).click();
  await expect(win.getByRole('dialog', { name: 'Firmas digitales' })).toContainText('no coincide');
  await app.close();
});

test('dos-firmas.pdf: el peor estado en la barra y las dos firmas en el panel', async () => {
  const dir = await tempDir();
  const { app, win } = await launch(dir, [await copyFixture(dir, 'dos-firmas.pdf')]);
  await expectSigStatus(win, 'Firma intacta. Se añadieron cambios después de firmar.');
  await sigButton(win).click();
  const panel = win.getByRole('dialog', { name: 'Firmas digitales' });
  await expect(panel).toContainText('Firma de prueba');
  await expect(panel).toContainText('Segundo firmante');
  await app.close();
});

test('certificado.pdf (P=2): aviso al abrir, solo se rellenan formularios', async () => {
  const dir = await tempDir();
  const { app, win } = await launch(dir, [await copyFixture(dir, 'certificado.pdf')]);
  await expectSigStatus(win, 'Firma intacta');
  await expect(win.getByText('Este PDF está certificado: solo admite rellenar sus formularios.').first()).toBeVisible();
  await expect(footer(win).getByLabel('Certificado')).toBeVisible();
  await expect(toolbarButton(win, 'Insertar páginas nuevas tras la selección')).toBeDisabled();

  await win.getByRole('tab', { name: 'Leer' }).click();
  await expect(win.getByRole('button', { name: 'Resaltar', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(win.getByRole('button', { name: 'Firma', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(win.getByRole('button', { name: 'Girar a la derecha' })).toBeDisabled();
  const field = win.locator('input.pdf-field[aria-label="razon_social"]');
  await field.fill('Talleres Ribas SL');
  await expect(field).toHaveValue('Talleres Ribas SL');
  await expect(footer(win)).toContainText('Cambios sin guardar');
  await app.close();
});

test('proceso principal de una versión anterior: el PDF se abre igual y se pide reiniciar', async () => {
  const dir = await tempDir();
  const { app, win } = await launch(dir);
  const file = await copyFixture(dir, 'firmado.pdf');
  await app.evaluate(({ ipcMain }) => ipcMain.removeHandler('pdf:verifySignatures')); // como un main sin la comprobación
  await stubOpen(app, [file]);
  await win.getByRole('button', { name: 'Abrir PDF' }).click();
  await expect(footer(win)).toContainText('5 páginas');
  await expectSigStatus(win, 'cierra la aplicación y vuelve a abrirla');
  await app.close();
});

test('interfaz, preload y proceso principal hablan la misma versión del IPC', async () => {
  const dir = await tempDir();
  const { app, win } = await launch(dir);
  const v = await win.evaluate(async () => [window.desktop.apiVersion, await window.desktop.mainApiVersion()]);
  expect(v[0]).toBe(v[1]);
  await expect(win.getByText('se actualizó mientras estaba abierta')).toHaveCount(0);
  await app.close();
});
