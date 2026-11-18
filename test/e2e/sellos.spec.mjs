// Herramienta «Sello» en la app real: predefinidos con fecha y nombre, texto propio, imagen, recientes; colocar con un
// clic, girar, escalar, aplicar a todas las páginas, fijar en la página; al guardar, anotaciones /Stamp con apariencia.
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tempDir, copyFixture, launch, footer, readWhenChanged, engine } from './helpers.mjs';
import { pngRGB } from '../forensics.js';

const tool = (win, name) => win.getByRole('toolbar', { name: 'Herramientas de anotación' }).getByRole('button', { name, exact: true });
const stampDialog = (win) => win.getByRole('dialog', { name: 'Sello' });
const pageEl = (win, i) => win.locator(`[data-i="${i}"]`);
const stampsOn = (win, i, name) => pageEl(win, i).locator(name ? `[data-stamp="${name}"]` : '[data-stamp]');

async function clickOnPage(win, i, u, v) {
  await pageEl(win, i).evaluate((el) => el.scrollIntoView({ block: 'start' })); // la página arriba: v hasta ~0,6 se ve
  await win.waitForTimeout(200);
  const b = await pageEl(win, i).boundingBox();
  await win.mouse.click(b.x + u * b.width, b.y + v * b.height);
}

/** Anotaciones de una página guardada: [{ subtype, contents, author, hasAP, w, h }] y nº de objetos de contenido. */
function inspect(core, docId, index) {
  const pg = core.m.FPDF_LoadPage(core.doc(docId), index);
  const annots = [];
  for (let i = 0; i < core.m.FPDFPage_GetAnnotCount(pg); i++) {
    const an = core.m.FPDFPage_GetAnnot(pg, i);
    const [l, top, r, bottom] = core.withMem(16, (p) => (core.m.FPDFAnnot_GetRect(an, p) ? core.floats(p, 4) : [0, 0, 0, 0]));
    const str = (k) => core.readWide((buf, len) => core.m.FPDFAnnot_GetStringValue(an, k, buf, len));
    annots.push({ subtype: core.m.FPDFAnnot_GetSubtype(an), contents: str('Contents'), author: str('T'), hasAP: core.m.FPDFAnnot_GetAP(an, 0, 0, 0) > 2, w: r - l, h: top - bottom });
    core.m.FPDFPage_CloseAnnot(an);
  }
  const objects = core.m.FPDFPage_CountObjects(pg);
  core.m.FPDF_ClosePage(pg);
  return { annots, objects };
}

test('sellos: predefinido con fecha y nombre, girar, escalar, a todas las páginas, fijar, texto propio e imagen; se guardan como /Stamp', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'contrato.pdf'); // 5 páginas
  const original = await readFile(file);
  const logo = path.join(dir, 'logo.png');
  await writeFile(logo, pngRGB(120, 80, (x, y) => (x > 20 && x < 100 && y > 15 && y < 65 ? [30, 60, 180] : [255, 255, 255])));
  const { app, win, errors } = await launch(dir, [file]);

  // Tu nombre (sale en los sellos).
  await win.keyboard.press('Control+,');
  const prefs = win.getByRole('dialog', { name: 'Preferencias' });
  await prefs.getByLabel('Tu nombre').fill('Diego Pennisi');
  await prefs.getByRole('button', { name: 'Guardar' }).click();

  await win.getByRole('tab', { name: 'Leer' }).click();
  await tool(win, 'Sello').click();
  await expect(stampDialog(win)).toBeVisible();
  await expect(stampDialog(win).getByRole('button', { name: 'Pagado' })).toBeVisible();
  await expect(stampDialog(win).getByRole('button', { name: 'Contabilizado' })).toBeVisible();
  await stampDialog(win).getByRole('button', { name: 'Pagado' }).click();
  await expect(stampDialog(win)).toHaveCount(0);
  await expect(footer(win)).toContainText('Haz clic donde quieras poner el sello «Pagado». Esc para cancelar.');
  await clickOnPage(win, 0, 0.5, 0.3);
  await expect(stampsOn(win, 0, 'Pagado')).toHaveCount(1);
  await expect(footer(win)).toContainText('Cambios sin guardar');

  // Barra del sello: girar con los botones y con el asa; escalar desde una esquina.
  const bar = win.getByRole('toolbar', { name: 'Sello' });
  await bar.getByRole('button', { name: 'Girar 15° a la derecha' }).click();
  await bar.getByRole('button', { name: 'Girar 15° a la derecha' }).click();
  await expect(stampsOn(win, 0, 'Pagado')).toHaveAttribute('data-angle', '30');
  await bar.getByRole('button', { name: 'Girar 15° a la izquierda' }).click();
  await expect(stampsOn(win, 0, 'Pagado')).toHaveAttribute('data-angle', '15');
  const before = await stampsOn(win, 0, 'Pagado').boundingBox();
  const handle = pageEl(win, 0).locator('[data-handle="scale"]').last();
  const hb = await handle.boundingBox();
  await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await win.mouse.down();
  await win.mouse.move(hb.x + 60, hb.y + 30, { steps: 6 });
  await win.mouse.up();
  const after = await stampsOn(win, 0, 'Pagado').boundingBox();
  expect(after.width).toBeGreaterThan(before.width * 1.2);
  const rot = await pageEl(win, 0).locator('[data-handle="rotate"] circle').boundingBox();
  await win.mouse.move(rot.x + rot.width / 2, rot.y + rot.height / 2);
  await win.mouse.down();
  await win.mouse.move(rot.x + 120, rot.y + 60, { steps: 6 });
  await win.mouse.up();
  const angle = Number(await stampsOn(win, 0, 'Pagado').getAttribute('data-angle'));
  expect(angle).toBeGreaterThan(30);
  expect(angle % 5).toBe(0);

  // A todas las páginas (un paso de deshacer).
  await bar.getByRole('button', { name: 'Aplicar a…' }).click();
  await win.getByRole('menuitem', { name: 'Todas las páginas (5)' }).click();
  await expect(win.getByText('Sello puesto en 4 páginas más.')).toBeVisible();
  await expect(win.locator('[data-i] [data-stamp="Pagado"]')).toHaveCount(5);
  await win.keyboard.press('Control+Z');
  await expect(win.locator('[data-i] [data-stamp="Pagado"]')).toHaveCount(1);
  await win.keyboard.press('Control+Y');
  await expect(win.locator('[data-i] [data-stamp="Pagado"]')).toHaveCount(5);

  // El de la primera página, fijado en la página.
  await stampsOn(win, 0, 'Pagado').click();
  await bar.getByRole('button', { name: 'Fijar en la página' }).click();
  await expect(bar.getByRole('button', { name: 'Fijar en la página' })).toHaveAttribute('aria-pressed', 'true');

  // Texto propio, verde, en la página 2.
  await win.keyboard.press('Escape');
  await tool(win, 'Sello').click();
  await stampDialog(win).getByLabel('Texto del sello').fill('Revisado');
  await stampDialog(win).getByRole('radio', { name: 'Verde' }).click();
  await stampDialog(win).getByRole('button', { name: 'Usar este sello' }).click();
  await clickOnPage(win, 1, 0.3, 0.45);
  await expect(stampsOn(win, 1, 'Revisado')).toHaveCount(1);

  // Imagen (logo con fondo blanco, que se quita), en la página 3.
  await win.keyboard.press('Escape');
  await tool(win, 'Sello').click();
  await stampDialog(win).getByTestId('sello-imagen').setInputFiles(logo);
  await stampDialog(win).getByRole('button', { name: 'Usar esta imagen' }).click();
  await clickOnPage(win, 2, 0.7, 0.5);
  await expect(stampsOn(win, 2, 'Imagen')).toHaveCount(1);

  // Recientes: los últimos usados, el último primero.
  await win.keyboard.press('Escape');
  await tool(win, 'Sello').click();
  const recent = stampDialog(win).getByRole('region', { name: 'Recientes' });
  await expect(recent.getByRole('button')).toHaveCount(3);
  await expect(recent.getByRole('button').nth(1)).toHaveAccessibleName('Revisado');
  await expect(recent.getByRole('button').nth(2)).toHaveAccessibleName('Pagado');
  await win.keyboard.press('Escape');
  await expect(stampDialog(win)).toHaveCount(0);

  // Guardar: /Stamp con apariencia, su nombre y autor; el fijado, en el contenido.
  await win.keyboard.press('Control+S');
  const saved = await readWhenChanged(file, original);
  const core = await engine();
  const d = core.open(saved);
  const pages = [0, 1, 2, 3, 4].map((i) => inspect(core, d.docId, i));
  core.close(d.docId);
  expect(pages[0].annots).toEqual([]); // fijado: sin anotación…
  expect(pages[0].objects).toBeGreaterThan(inspectOriginalObjects); // …y con una imagen más en la página
  for (const i of [1, 2, 3, 4]) {
    const pagado = pages[i].annots.filter((a) => a.contents === 'Pagado');
    expect(pagado).toHaveLength(1);
    expect(pagado[0]).toMatchObject({ subtype: 13, author: 'Diego Pennisi', hasAP: true });
  }
  expect(pages[1].annots.map((a) => a.contents).sort()).toEqual(['Pagado', 'Revisado']);
  expect(pages[2].annots.map((a) => a.contents).sort()).toEqual(['Imagen', 'Pagado']);
  expect(errors).toEqual([]);
  await app.close();
});

// Objetos de contenido de la primera página de contrato.pdf antes de nada (para ver que el sello fijado añade uno).
let inspectOriginalObjects = 0;
test.beforeAll(async () => {
  const core = await engine();
  const { ROOT } = await import('./helpers.mjs');
  const d = core.open(await readFile(path.join(ROOT, 'test', 'fixtures', 'contrato.pdf')));
  inspectOriginalObjects = inspect(core, d.docId, 0).objects;
  core.close(d.docId);
});
