// Guardar un PDF firmado desde la app real: revisión incremental o reescritura (con su aviso).
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  tempDir, copyFixture, launch, stubSaveAs, footer, expectSigStatus, verifyPdfSignatures,
  toolbarButton, confirmDialog, thumbs, readWhenChanged,
} from './helpers.mjs';

test('anotar y Guardar: revisión incremental, el original intacto al principio y la firma verifica', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'firmado.pdf');
  const original = await readFile(file);
  const { app, win } = await launch(dir, [file]);

  await win.getByRole('tab', { name: 'Leer' }).click();
  await win.getByRole('button', { name: 'Nota', exact: true }).click();
  const page = win.locator('[data-i="0"]');
  await page.click({ position: { x: 300, y: 300 } });
  await win.keyboard.press('Escape');
  await expect(footer(win)).toContainText('Cambios sin guardar');

  await toolbarButton(win, /^Guardar \(/).click();
  const dlg = confirmDialog(win);
  await expect(dlg).toContainText('¿Guardar en el PDF firmado?');
  await expect(dlg).toContainText('revisión nueva');
  await dlg.getByRole('button', { name: 'Guardar', exact: true }).click();

  const saved = await readWhenChanged(file, original);
  expect(saved.length).toBeGreaterThan(original.length);
  expect(saved.subarray(0, original.length).equals(original), 'los bytes firmados cambiaron').toBe(true);
  const [sig] = verifyPdfSignatures(saved);
  expect(sig.byteRange[2] + sig.byteRange[3]).toBe(original.length); // el ByteRange cubre justo el original
  expect(sig.status).toBe('modified'); // verifica, con cambios después
  await expect(win.getByText('como revisión nueva. La firma sigue siendo válida.')).toBeVisible();
  await expectSigStatus(win, 'Firma intacta. Se añadieron cambios después de firmar.');
  await app.close();
});

test('quitar una página: el diálogo explica por qué se rompe la firma; «Guardar como…» deja el original', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'firmado.pdf');
  const original = await readFile(file);
  const copy = path.join(dir, 'firmado (modificado).pdf');
  const { app, win } = await launch(dir, [file]);

  await thumbs(win).nth(1).click();
  await win.getByRole('button', { name: 'Eliminar (Supr)' }).click();
  await expect(thumbs(win)).toHaveCount(4);

  await toolbarButton(win, /^Guardar \(/).click();
  const dlg = confirmDialog(win);
  await expect(dlg).toContainText('¿Guardar encima del original firmado?');
  await expect(dlg).toContainText('has quitado páginas');
  await stubSaveAs(app, copy);
  await dlg.getByRole('button', { name: 'Guardar como…' }).click();

  const saved = await readWhenChanged(copy);
  expect(verifyPdfSignatures(saved)[0].status).toBe('broken'); // la copia reescrita ya no verifica
  expect((await readFile(file)).equals(original), 'el original firmado no se toca').toBe(true);
  await expectSigStatus(win, 'Firma rota: el documento se modificó después de firmar.');
  await app.close();
});

test('firmado sin cambios: Guardar no escribe nada', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'firmado.pdf');
  const original = await readFile(file);
  const { app, win } = await launch(dir, [file]);
  await toolbarButton(win, /^Guardar \(/).click();
  await expect(win.getByText('No hay cambios que guardar. La firma digital sigue intacta.')).toBeVisible();
  expect((await readFile(file)).equals(original)).toBe(true);
  await app.close();
});
