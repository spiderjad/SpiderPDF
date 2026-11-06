// Marcadores (bloque 1) en la app real con indice.pdf.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { tempDir, copyFixture, launch, footer, toolbarButton, readWhenChanged, engine } from './helpers.mjs';

test('indice.pdf: árbol, salto a la página, marcador desactivado al quitar su página y guardado', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'indice.pdf');
  const original = await readFile(file);
  const { app, win, errors } = await launch(dir, [file]);

  await win.getByRole('tab', { name: 'Leer' }).click();
  await win.getByRole('tab', { name: 'Marcadores' }).click();
  const tree = win.getByRole('tree', { name: 'Marcadores' });
  const item = (name) => tree.getByRole('treeitem', { name: new RegExp(`^${name}`) });
  for (const t of ['1. Introducción', '2. Propuesta', '3. Presupuesto y condiciones', 'Web del proyecto']) await expect(item(t)).toBeVisible();

  await item('3. Presupuesto').click();
  await expect(footer(win)).toContainText('Página 6 de 6');
  await expect(item('3. Presupuesto')).toHaveAttribute('aria-selected', 'true');

  // Desplegar 2. Propuesta → 2.1 Fases e ir a «Fase B» (página 5).
  await item('2. Propuesta').locator('button').click();
  await item('2.1 Fases').locator('button').click();
  await item('Fase B').click();
  await expect(footer(win)).toContainText('Página 5 de 6');

  // Quitar esa página: su marcador queda en gris y desactivado.
  await win.getByRole('button', { name: 'Eliminar (Supr)' }).click();
  await expect(footer(win)).toContainText('5 páginas');
  await expect(item('Fase B')).toHaveAttribute('aria-disabled', 'true');
  await item('3. Presupuesto').click();
  await expect(footer(win)).toContainText('Página 5 de 5');

  // Guardar: el índice se conserva con el nuevo orden y sin el marcador de la página quitada.
  await toolbarButton(win, /^Guardar \(/).click();
  const saved = await readWhenChanged(file, original);
  const core = await engine();
  const d = core.open(saved);
  const titles = (nodes) => nodes.map((n) => [n.title, n.pageIndex, titles(n.children)]);
  expect(titles(core.bookmarks(d.docId))).toEqual([
    ['1. Introducción', 0, [['1.1 Objetivo', 0, []], ['1.2 Alcance', 1, []]]],
    ['2. Propuesta', 2, [['2.1 Fases', 3, [['Fase A: análisis', 3, []]]]]],
    ['3. Presupuesto y condiciones', 4, []],
  ]);
  core.close(d.docId);
  expect(errors).toEqual([]);
  await app.close();
});

test('un PDF sin índice lo dice y la pestaña sigue accesible', async () => {
  const dir = await tempDir();
  const { app, win } = await launch(dir, [await copyFixture(dir, 'contrato.pdf')]);
  await win.getByRole('tab', { name: 'Leer' }).click();
  await win.getByRole('tab', { name: 'Marcadores' }).click();
  await expect(win.getByText('Este PDF no tiene índice')).toBeVisible();
  await win.getByRole('tab', { name: 'Páginas' }).click();
  await expect(win.getByRole('listbox', { name: 'Páginas' })).toBeVisible();
  await app.close();
});
