// Marcadores desde un índice impreso y enlaces del PDF, en la app real.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { tempDir, copyFixture, launch, footer, toolbarButton, readWhenChanged, engine, confirmDialog } from './helpers.mjs';

const titles = (nodes) => nodes.map((n) => [n.title, n.pageIndex, titles(n.children)]);

test('indice-impreso.pdf: detectar, revisar, crear, deshacer y guardar los marcadores', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'indice-impreso.pdf');
  const original = await readFile(file);
  const { app, win, errors } = await launch(dir, [file]);

  await win.getByRole('tab', { name: 'Leer' }).click();
  await win.getByRole('tab', { name: 'Marcadores' }).click();
  await expect(win.getByText('Este PDF no tiene índice')).toBeVisible();
  await expect(win.getByText('La página 3 parece un índice.')).toBeVisible();
  await win.getByRole('button', { name: 'Crear índice desde la página 3' }).click();

  const dlg = win.getByRole('dialog', { name: 'Crear índice' });
  const rows = dlg.getByRole('list', { name: 'Entradas del índice' }).getByRole('listitem');
  await expect(rows).toHaveCount(12);
  // Portada sin numerar: la página impresa 1 es la 2 del PDF; los títulos lo confirman.
  await expect(dlg.getByLabel('La página impresa 1 es la')).toHaveValue('2');
  await expect(dlg.getByText(/Calculado: \d+ de 12 títulos están en su página/)).toBeVisible();
  await expect(dlg.getByLabel('Título de la entrada 7')).toHaveValue('2.3 TAREAS EXCLUIDAS DEL ALCANCE DEL PROYECTO Y OTRAS CONSIDERACIONES');
  await expect(dlg.getByLabel('Página de «2.3 TAREAS EXCLUIDAS DEL ALCANCE DEL PROYECTO Y OTRAS CONSIDERACIONES»')).toHaveValue('6');

  // Revisar: cambiar un título, quitar la entrada del propio índice y bajar de nivel «3 PLAN DE PROYECTO».
  await dlg.getByLabel('Título de la entrada 1', { exact: true }).fill('Información general');
  await dlg.getByRole('button', { name: 'Quitar «ÍNDICE»' }).click();
  await expect(rows).toHaveCount(11);
  await dlg.getByRole('button', { name: 'Bajar de nivel «3 PLAN DE PROYECTO»' }).click();
  // Una página fuera del documento no deja crear.
  await dlg.getByLabel('Página de «5 CONDICIONES»').fill('40');
  await expect(dlg.getByText('Hay 1 entrada por corregir.')).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Crear índice' })).toBeDisabled();
  await dlg.getByLabel('Página de «5 CONDICIONES»').fill('8');
  await dlg.getByRole('button', { name: 'Crear índice' }).click();
  await expect(dlg).toBeHidden();
  await expect(win.getByText('Índice creado con 11 marcadores.', { exact: false })).toBeVisible();

  const tree = win.getByRole('tree', { name: 'Marcadores' });
  const item = (name) => tree.getByRole('treeitem', { name: new RegExp(`^${name}`) });
  await expect(item('Información general')).toBeVisible();
  await item('5 CONDICIONES').click();
  await expect(footer(win)).toContainText('Página 8 de 8');
  await item('2 DESCRIPCIÓN').locator('button').click();
  await item('2.2 FLUJO').click();
  await expect(footer(win)).toContainText('Página 5 de 8');

  // Deshacer quita el índice creado; rehacer lo devuelve.
  await win.keyboard.press('Control+z');
  await expect(win.getByText('Este PDF no tiene índice')).toBeVisible();
  await win.keyboard.press('Control+y');
  await expect(item('Información general')).toBeVisible();

  // Guardar: los marcadores quedan en el archivo con su jerarquía y su página real.
  await toolbarButton(win, /^Guardar \(/).click();
  const saved = await readWhenChanged(file, original);
  const core = await engine();
  const d = core.open(saved);
  const bm = titles(core.bookmarks(d.docId));
  expect(bm[0]).toEqual(['Información general', 1, []]);
  expect(bm[2]).toEqual(['2 DESCRIPCIÓN Y ALCANCE', 3, [
    ['2.1 ESTRUCTURA ORGANIZATIVA', 3, []], ['2.2 FLUJO DE TRASLADO', 4, []],
    ['2.3 TAREAS EXCLUIDAS DEL ALCANCE DEL PROYECTO Y OTRAS CONSIDERACIONES', 5, []],
    ['3 PLAN DE PROYECTO', 5, []]]]); // bajado un nivel: queda dentro de «2», junto a 2.3
  expect(bm.at(-1)).toEqual(['5 CONDICIONES', 7, []]);
  expect(bm.length).toBe(5);
  core.close(d.docId);

  // Editar el índice creado: el diálogo lo trae tal cual.
  await win.getByRole('button', { name: 'Editar el índice' }).click();
  const edit = win.getByRole('dialog', { name: 'Editar índice' });
  await expect(edit.getByRole('listitem')).toHaveCount(11);
  await edit.getByRole('button', { name: 'Cancelar' }).click();
  expect(errors).toEqual([]);
  await app.close();
});

test('enlaces.pdf: los internos saltan a su página, los web piden confirmación', async () => {
  const dir = await tempDir();
  const { app, win, errors } = await launch(dir, [await copyFixture(dir, 'enlaces.pdf')]);
  await app.evaluate(() => { globalThis.__opened = []; globalThis.__spiderPdfLinkHook = (u) => { globalThis.__opened.push(u); }; });
  await win.getByRole('tab', { name: 'Leer' }).click();

  const link = (name) => win.getByRole('button', { name });
  const clickLink = async (name) => {
    await link(name).scrollIntoViewIfNeeded();
    const b = await link(name).boundingBox();
    await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await win.mouse.down();
    await win.mouse.up();
  };
  await expect(link('Enlace a la página 3 del original')).toBeAttached();

  // Cursor de mano al pasar por encima.
  await link('Enlace a la página 3 del original').scrollIntoViewIfNeeded();
  const b = await link('Enlace a la página 3 del original').boundingBox();
  await win.mouse.move(b.x - 20, b.y + b.height / 2);
  await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await expect(win.locator('[style*="cursor: pointer"]').first()).toBeAttached();

  await clickLink('Enlace a la página 3 del original');
  await expect(footer(win)).toContainText('Página 3 de 3');
  // Con el teclado: el enlace es un botón enfocable.
  await link('Enlace a la página 2 del original').focus();
  await win.keyboard.press('Enter');
  await expect(footer(win)).toContainText('Página 2 de 3');

  // Web: pide confirmación; «Cancelar» no abre nada, «Abrir» sí.
  await clickLink('Enlace a https://example.com/spiderpdf');
  await expect(confirmDialog(win)).toContainText('https://example.com/spiderpdf');
  await confirmDialog(win).getByRole('button', { name: 'Cancelar' }).click();
  expect(await app.evaluate(() => globalThis.__opened)).toEqual([]);
  await clickLink('Enlace a https://example.com/spiderpdf');
  await confirmDialog(win).getByRole('button', { name: 'Abrir' }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__opened)).toEqual(['https://example.com/spiderpdf']);

  // Arrastrar desde un enlace no lo sigue (para poder seleccionar cerca sin saltar).
  await link('Enlace a la página 3 del original').scrollIntoViewIfNeeded();
  const c = await link('Enlace a la página 3 del original').boundingBox();
  await win.mouse.move(c.x + 4, c.y + c.height / 2);
  await win.mouse.down();
  await win.mouse.move(c.x + 60, c.y + c.height / 2 + 30, { steps: 5 });
  await win.mouse.up();
  await expect(footer(win)).not.toContainText('Página 3 de 3');

  // Si su página se eliminó, lo dice.
  await win.getByRole('tab', { name: 'Organizar' }).click();
  await win.locator('main ul > li').nth(1).click();
  await win.getByRole('button', { name: 'Eliminar (Supr)' }).click();
  await win.getByRole('tab', { name: 'Leer' }).click();
  await clickLink('Enlace a la página 2 del original');
  await expect(win.getByText('Ese enlace lleva a una página que ya no está en el documento.')).toBeVisible();
  expect(errors).toEqual([]);
  await app.close();
});
