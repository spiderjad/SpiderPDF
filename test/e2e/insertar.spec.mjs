// Insertar páginas (bloque 3) en la app real: página en blanco e imagen, deshacer y guardar.
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pngRGB } from '../forensics.js';
import { tempDir, copyFixture, launch, thumbs, toolbarButton, readWhenChanged, engine } from './helpers.mjs';

test('insertar página en blanco e imagen tras la selección, deshacer, rehacer y guardar', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'contrato.pdf');
  const original = await readFile(file);
  // Imagen de 300 × 150 px: a 150 ppp, una página de 144 × 72 pt.
  const png = path.join(dir, 'plano.png');
  await writeFile(png, pngRGB(300, 150, (x) => (x < 150 ? [200, 30, 30] : [30, 30, 200])));
  const { app, win, errors } = await launch(dir, [file]);

  const insert = toolbarButton(win, 'Insertar páginas nuevas tras la selección');
  const menuItem = (name) => win.getByRole('menu', { name: 'Insertar' }).getByRole('menuitem', { name: new RegExp(name) });
  const labels = () => thumbs(win).evaluateAll((lis) => lis.map((li) => li.innerText.split('\n').slice(1).join(' ')));

  await thumbs(win).nth(1).click(); // página 2
  await insert.click();
  await menuItem('Página en blanco').click();
  await expect(thumbs(win)).toHaveCount(6);

  await insert.click();
  const [chooser] = await Promise.all([win.waitForEvent('filechooser'), menuItem('Imagen como página').click()]);
  await chooser.setFiles(png);
  await expect(thumbs(win)).toHaveCount(7);
  expect((await labels()).slice(0, 4)).toEqual(['contrato, p. 1', 'contrato, p. 2', 'Página en blanco', 'plano']);

  await win.getByRole('button', { name: /^Deshacer/ }).click();
  await expect(thumbs(win)).toHaveCount(6);
  await win.getByRole('button', { name: 'Rehacer' }).click();
  await expect(thumbs(win)).toHaveCount(7);

  await toolbarButton(win, /^Guardar \(/).click();
  const saved = await readWhenChanged(file, original);
  const core = await engine();
  const d = core.open(saved);
  const sizes = d.pages.map((p) => [Math.round(p.width), Math.round(p.height)]);
  expect(sizes).toEqual([[595, 842], [595, 842], [595, 842], [144, 72], [595, 842], [595, 842], [595, 842]]);
  const img = core.render(d.docId, 3, 1);
  const at = (u) => [...img.pixels.slice((Math.floor(img.height / 2) * img.width + Math.floor(u * img.width)) * 4).slice(0, 3)];
  expect(at(0.25)[0]).toBeGreaterThan(150); // mitad izquierda roja
  expect(at(0.75)[2]).toBeGreaterThan(150); // mitad derecha azul
  core.close(d.docId);
  expect(errors).toEqual([]);
  await app.close();
});
