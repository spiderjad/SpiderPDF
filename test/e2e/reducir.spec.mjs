// «Reducir tamaño» en la app real: niveles calculados de verdad, «antes → después», guardar la copia; PDF firmado
// (aviso de la firma; sin imágenes, solo se ordena el archivo).
import { test, expect } from '@playwright/test';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import jpeg from 'jpeg-js';
import { tempDir, copyFixture, launch, stubSaveAs, footer, engine } from './helpers.mjs';

const dialog = (win) => win.getByRole('dialog', { name: 'Reducir tamaño' });
const status = (win) => dialog(win).getByRole('status');

async function openReduce(win) {
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: 'Reducir tamaño…' }).click();
}

/** PDF de 2 páginas con una foto de 2400×1800 px a 600 ppp y texto. */
async function photoPdf(file) {
  const W = 2400; const H = 1800; const px = Buffer.alloc(W * H * 4);
  let seed = 3;
  for (let i = 0; i < W * H; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const x = i % W; const y = (i / W) | 0;
    px[i * 4] = (x / 10 + (seed % 30)) & 255; px[i * 4 + 1] = (y / 8) & 255; px[i * 4 + 2] = (x ^ y) & 255; px[i * 4 + 3] = 255;
  }
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const img = await doc.embedJpg(jpeg.encode({ data: px, width: W, height: H }, 92).data);
  for (let p = 0; p < 2; p++) {
    const pg = doc.addPage([595, 842]);
    pg.drawText(`Informe de obra, página ${p + 1}`, { x: 60, y: 780, size: 18, font });
    pg.drawImage(img, { x: 60, y: 300, width: 288, height: 216 });
  }
  await writeFile(file, await doc.save());
}

test('foto a 600 ppp: los tres niveles con «antes → después» y se guarda la copia', async () => {
  test.setTimeout(120_000);
  const dir = await tempDir();
  const file = path.join(dir, 'informe.pdf');
  await photoPdf(file);
  const before = (await stat(file)).size;
  const { app, win, errors } = await launch(dir, [file]);
  await openReduce(win);
  const d = dialog(win);
  await expect(d.getByRole('radio', { name: /Equilibrado/ })).toBeChecked();
  await expect(d).toContainText('El texto y los dibujos no cambian');
  const size = d.getByTestId('reducir-tamano');
  await expect(size).toHaveText(/^[\d,]+ MB → [\d,]+ KB \(−\d+ %\)$/, { timeout: 60_000 });
  await expect(d).toContainText('1 imagen reducida.');
  const balanced = await size.textContent();
  expect(balanced.startsWith((before / 1024 / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).replace(/,0$/, ''))).toBe(true);

  // Mínimo tamaño: más pequeño; Alta calidad: más grande; volver a Equilibrado no recalcula.
  const kb = (s) => Number(s.match(/→ ([\d,.]+) KB/)[1].replace(/\./g, '').replace(',', '.'));
  await d.getByRole('radio', { name: /Mínimo tamaño/ }).check();
  await expect(size).not.toHaveText(balanced, { timeout: 60_000 });
  const small = await size.textContent();
  await d.getByRole('radio', { name: /Alta calidad/ }).check();
  await expect(size).not.toHaveText(small, { timeout: 60_000 });
  const high = await size.textContent();
  expect(kb(small)).toBeLessThan(kb(balanced));
  expect(kb(balanced)).toBeLessThan(kb(high));
  await d.getByRole('radio', { name: /Equilibrado/ }).check();
  await expect(size).toHaveText(balanced);

  const out = path.join(dir, 'informe (reducido).pdf');
  await stubSaveAs(app, out);
  await d.getByRole('button', { name: 'Guardar copia…' }).click();
  await expect(dialog(win)).toHaveCount(0);
  await expect.poll(() => existsSync(out), { timeout: 20_000 }).toBe(true);
  await expect(win.getByText(/Guardado «informe \(reducido\)\.pdf»: .* → .*\(−\d+ %\)\./)).toBeVisible();
  const saved = await readFile(out);
  expect(saved.length).toBeLessThan(before / 5);
  const core = await engine();
  const r = core.open(saved);
  expect(r.pages.length).toBe(2);
  expect(core.pageText(r.docId, 1)).toContain('Informe de obra, página 2');
  core.close(r.docId);
  // El documento abierto no cambia (se guardó una copia).
  await expect(footer(win)).toContainText('informe.pdf');
  expect(errors).toEqual([]);
  await app.close();
});

test('PDF firmado y sin imágenes: aviso de la firma; solo se ordena el archivo', async () => {
  const dir = await tempDir();
  const { app, win } = await launch(dir, [await copyFixture(dir, 'firmado.pdf')]);
  await openReduce(win);
  const d = dialog(win);
  await expect(d).toContainText('La firma digital no será válida en la copia reducida.');
  await expect(status(win)).toContainText('Solo se ordenó el archivo: no había imágenes que reducir.', { timeout: 60_000 });
  await expect(d.getByTestId('reducir-tamano')).toHaveText(/KB → .* KB \(−\d+ %\)/);
  await win.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await app.close();
});
