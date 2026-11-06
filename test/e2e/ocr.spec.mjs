// OCR en la app real: aviso de páginas escaneadas, reconocer (con páginas torcidas y de lado), buscar, seleccionar y
// copiar, deshacer, guardar con la capa de texto y cancelar. Todo local: ninguna petición sale de la app.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { tempDir, copyFixture, launch, footer, toolbarButton, readWhenChanged, engine } from './helpers.mjs';

const banner = (win) => win.getByRole('status').filter({ hasText: /imágenes escaneadas|imagen escaneada/ }); // plural o singular
const dialog = (win) => win.getByRole('dialog', { name: 'Reconocer texto (OCR)' });
const searchBox = (win) => win.getByRole('searchbox');

/** Peticiones que no son de la propia app (app:// o el servidor local de desarrollo): no debe haber ninguna. */
function watchRequests(win) {
  const external = [];
  win.on('request', (r) => { if (!/^(app|data|blob|devtools):/.test(r.url()) && !r.url().startsWith('http://localhost')) external.push(r.url()); });
  return external;
}

test('albarán escaneado: aviso, reconocer, buscar, seleccionar y copiar, deshacer y guardar con la capa de texto', async () => {
  test.setTimeout(180_000);
  const dir = await tempDir();
  const file = await copyFixture(dir, 'albaran-escaneado.pdf');
  const original = await readFile(file);
  const { app, win, errors } = await launch(dir, [file]);
  const external = watchRequests(win);

  // Al abrir: aviso con las 3 páginas escaneadas; sin OCR, buscar no encuentra nada.
  await expect(banner(win)).toContainText('3 páginas son imágenes escaneadas');
  await win.getByRole('tab', { name: 'Leer' }).click();
  await win.keyboard.press('Control+F');
  await searchBox(win).fill('tornillos');
  await expect(win.getByText(/es una imagen|son imágenes/).first()).toBeVisible();
  await win.keyboard.press('Escape');

  // Reconocer las páginas escaneadas, con los tres idiomas.
  await banner(win).getByRole('button', { name: 'Reconocer texto (OCR)' }).click();
  const d = dialog(win);
  await expect(d.getByRole('radio', { name: /Páginas escaneadas \(3\)/ })).toBeChecked();
  for (const l of ['Español', 'Català', 'English']) await expect(d.getByRole('checkbox', { name: l })).toBeChecked();
  await d.getByRole('button', { name: 'Reconocer' }).click();
  await expect(footer(win)).toContainText(/Reconociendo texto… página \d de 3|Preparando el reconocimiento/, { timeout: 30_000 });
  await expect(win.getByText('Texto reconocido en 3 páginas.', { exact: false })).toBeVisible({ timeout: 120_000 });
  await expect(banner(win)).toHaveCount(0);
  await expect(footer(win)).toContainText('Cambios sin guardar');

  // Buscar: en las tres páginas (recta, torcida y de lado), sin distinguir tildes.
  await win.keyboard.press('Control+F');
  await searchBox(win).fill('tornillos');
  await expect(win.getByText('1 de 3')).toBeVisible({ timeout: 20_000 });
  await searchBox(win).fill('penalba');
  await expect(win.getByText('1 de 3')).toBeVisible({ timeout: 20_000 });
  await win.keyboard.press('Escape');

  // Seleccionar con doble clic sobre «Tornillos» (página 1) y copiar.
  const page = win.locator('[data-i="0"]');
  await page.scrollIntoViewIfNeeded();
  const b = await page.boundingBox();
  await win.mouse.dblclick(b.x + 0.14 * b.width, b.y + 0.243 * b.height);
  await win.keyboard.press('Control+C');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Tornillos');

  // Deshacer quita el texto reconocido de una vez (vuelve el aviso); rehacer lo devuelve.
  await win.getByRole('button', { name: /^Deshacer/ }).click();
  await expect(banner(win)).toBeVisible();
  await win.getByRole('button', { name: /^Rehacer/ }).click();
  await expect(banner(win)).toHaveCount(0);

  // Guardar: la capa de texto queda en el PDF (texto real en las tres páginas) y la página se ve igual.
  await toolbarButton(win, /^Guardar \(/).click();
  const saved = await readWhenChanged(file, original);
  const core = await engine();
  const before = core.open(original);
  const after = core.open(saved);
  for (let i = 0; i < 3; i++) {
    expect(core.pageText(after.docId, i)).toMatch(/Tornillos hexagonales M8/);
    expect(core.searchPage(after.docId, i, 'lliurament').matches.length).toBe(1);
    const same = Buffer.compare(Buffer.from(core.render(before.docId, i, 0.5, 0).pixels), Buffer.from(core.render(after.docId, i, 0.5, 0).pixels));
    expect(same, `página ${i + 1} se ve igual`).toBe(0);
  }
  expect(core.imageOnlyPages(after.docId)).toEqual([]); // ya no son «solo imagen»: tienen texto
  core.close(before.docId); core.close(after.docId);

  expect(external, 'nada se descarga').toEqual([]);
  expect(errors).toEqual([]);
  await app.close();
});

test('cancelar a mitad: se conserva lo reconocido hasta entonces y se puede volver a reconocer el resto', async () => {
  test.setTimeout(180_000);
  const dir = await tempDir();
  const file = await copyFixture(dir, 'albaran-escaneado.pdf');
  const { app, win } = await launch(dir, [file]);
  await banner(win).getByRole('button', { name: 'Reconocer texto (OCR)' }).click();
  await dialog(win).getByRole('checkbox', { name: 'Català' }).uncheck();
  await dialog(win).getByRole('checkbox', { name: 'English' }).uncheck();
  await dialog(win).getByRole('button', { name: 'Reconocer' }).click();
  await expect(footer(win)).toContainText('Reconociendo texto… página 2 de 3', { timeout: 60_000 });
  await footer(win).getByRole('button', { name: 'Cancelar' }).click();
  await expect(win.getByText(/OCR cancelado/)).toBeVisible({ timeout: 60_000 });
  await expect(footer(win)).not.toContainText('Reconociendo');
  // Queda al menos una página por reconocer: el aviso vuelve con las que faltan.
  await expect(banner(win)).toContainText(/página|páginas/);
  await expect(banner(win)).not.toContainText('3 páginas');
  // Los idiomas elegidos se recuerdan.
  await banner(win).getByRole('button', { name: 'Reconocer texto (OCR)' }).click();
  await expect(dialog(win).getByRole('checkbox', { name: 'Español' })).toBeChecked();
  await expect(dialog(win).getByRole('checkbox', { name: 'Català' })).not.toBeChecked();
  await win.keyboard.press('Escape');
  await app.close();
});
