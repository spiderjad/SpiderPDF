// Herramienta «Texto nuevo» en la app real: fuente del texto cercano, letras que faltan, formato y guardado.
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { tempDir, copyFixture, launch, footer, toolbarButton, readWhenChanged, engine, ROOT } from './helpers.mjs';

const pageBox = async (win, i = 0) => {
  const p = win.locator(`[data-i="${i}"]`);
  await p.scrollIntoViewIfNeeded();
  return p.boundingBox();
};
const at = async (win, u, v, i = 0) => { const b = await pageBox(win, i); return [b.x + u * b.width, b.y + v * b.height]; };
const tool = (win, name) => win.getByRole('toolbar', { name: 'Herramientas de anotación' }).getByRole('button', { name, exact: true });
const editor = (win) => win.getByRole('textbox', { name: 'Texto del cuadro' });
const save = async (win) => toolbarButton(win, /^Guardar \(/).click();

test('clic junto al título: escribe con la fuente del PDF (Helvetica) y se guarda como texto real', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'contrato.pdf');
  const original = await readFile(file);
  const { app, win, errors } = await launch(dir, [file]);
  await win.getByRole('tab', { name: 'Leer' }).click();
  await tool(win, 'Texto nuevo').click();
  await expect(footer(win)).toContainText('Haz clic donde quieras escribir');

  // Debajo del cuerpo de texto (Helvetica 10,5 pt), a la izquierda.
  const [x, y] = await at(win, 0.12, 0.55);
  await win.mouse.click(x, y);
  await expect(editor(win)).toBeFocused();
  await win.keyboard.type('Ñandú ¿€?');
  await win.keyboard.press('Escape');
  await expect(editor(win)).toHaveCount(0);
  await expect(win.locator('[data-textbox]')).toHaveText('Ñandú ¿€?');
  // Barra de formato: la fuente del PDF, su tamaño.
  const bar = win.getByRole('toolbar', { name: 'Formato del texto' });
  await expect(bar.getByLabel('Fuente')).toHaveValue('pdf');
  await expect(bar.getByLabel('Fuente').locator('option:checked')).toHaveText('Helvetica (del PDF)');
  await expect(bar.getByLabel('Tamaño en puntos')).toHaveValue('10.5');

  await save(win);
  const saved = await readWhenChanged(file, original);
  const core = await engine();
  const d = core.open(saved);
  expect(core.pageText(d.docId, 0)).toContain('Ñandú ¿€?'); // texto real: se selecciona y se busca
  const run = core.textRuns(d.docId, 0).find((r) => r.text.includes('Ñandú'));
  expect(run.fontName).toBe('Helvetica');
  expect(Math.abs(run.ptSize - 10.5)).toBeLessThan(0.1);
  expect(run.rect[0]).toBeGreaterThan(0.1); // donde se hizo clic
  expect(Math.abs((run.rect[1] + run.rect[3]) / 2 - 0.55)).toBeLessThan(0.02);
  core.close(d.docId);
  expect(errors).toEqual([]);
  await app.close();
});

test('junto al título azul en negrita: el cuadro toma su fuente, tamaño, color y negrita (también al guardar)', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'formulario.pdf');
  const original = await readFile(file);
  // El título de formulario.pdf: Helvetica-Bold, 22 pt, #1f2959 (las etiquetas de debajo: Helvetica 11 pt, #333333).
  const core = await engine();
  const d0 = core.open(original);
  const title = core.textRuns(d0.docId, 0).find((r) => r.text.startsWith('Solicitud'));
  core.close(d0.docId);
  expect([title.fontName, title.ptSize, title.color]).toEqual(['Helvetica-Bold', 22, '#1f2959']);

  const { app, win, errors } = await launch(dir, [file]);
  await win.getByRole('tab', { name: 'Leer' }).click();
  await tool(win, 'Texto nuevo').click();
  const [x, y] = await at(win, 0.3, 0.115); // justo debajo del título, más cerca de él que de «Razón social»
  await win.mouse.click(x, y);
  await expect(editor(win)).toBeFocused();
  await win.keyboard.type('Revisado');
  await win.keyboard.press('Escape');

  const bar = win.getByRole('toolbar', { name: 'Formato del texto' });
  await expect(bar.getByLabel('Fuente')).toHaveValue('pdf');
  await expect(bar.getByLabel('Tamaño en puntos')).toHaveValue('22');
  await expect(bar.getByLabel('Color del texto')).toHaveValue('#1f2959');
  await expect(bar.getByRole('button', { name: 'Negrita' })).toHaveAttribute('aria-pressed', 'true');
  await expect(win.locator('[data-textbox]')).toHaveCSS('color', 'rgb(31, 41, 89)');

  await save(win);
  const saved = await readWhenChanged(file, original);
  const d = core.open(saved);
  const run = core.textRuns(d.docId, 0).find((r) => r.text.includes('Revisado'));
  expect([run.fontName, Math.round(run.ptSize), run.color]).toEqual(['Helvetica-Bold', 22, '#1f2959']);
  core.close(d.docId);
  expect(errors).toEqual([]);
  await app.close();
});

test('si la fuente del PDF no tiene alguna letra: aviso corto y la incluida más parecida (Noto Serif)', async () => {
  const dir = await tempDir();
  // Un PDF con Noto Serif incrustada en subconjunto: solo las letras de «Hola mundo».
  const src = await PDFDocument.create();
  src.registerFontkit(fontkit);
  const serif = await src.embedFont(await readFile(path.join(ROOT, 'node_modules/@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf')), { subset: true });
  src.addPage([595, 842]).drawText('Hola mundo', { x: 60, y: 760, size: 18, font: serif });
  const file = path.join(dir, 'subconjunto.pdf');
  await writeFile(file, await src.save());
  const original = await readFile(file);
  const { app, win } = await launch(dir, [file]);
  await win.getByRole('tab', { name: 'Leer' }).click();
  await tool(win, 'Texto nuevo').click();

  const [x, y] = await at(win, 0.1, 0.15);
  await win.mouse.click(x, y);
  await win.keyboard.type('Hola ñandú €');
  await win.keyboard.press('Escape');
  await expect(win.getByText('no tiene «ñ», «ú», «€»: se usa Noto Serif, la más parecida.')).toBeVisible();
  const bar = win.getByRole('toolbar', { name: 'Formato del texto' });
  await expect(bar.getByLabel('Fuente')).toHaveValue('serif');

  await save(win);
  const saved = await readWhenChanged(file, original);
  const core = await engine();
  const d = core.open(saved);
  expect(core.pageText(d.docId, 0)).toContain('Hola ñandú €');
  core.close(d.docId);
  await app.close();
});

test('formato, arrastrar para hacer el cuadro, mover, duplicar (Ctrl+D), borrar y deshacer', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'contrato.pdf');
  const original = await readFile(file);
  const { app, win } = await launch(dir, [file]);
  await win.getByRole('tab', { name: 'Leer' }).click();
  await tool(win, 'Texto nuevo').click();

  // Arrastrar: un cuadro con ese ancho; el texto se parte en líneas.
  const [x0, y0] = await at(win, 0.15, 0.6);
  const [x1, y1] = await at(win, 0.45, 0.65);
  await win.mouse.move(x0, y0);
  await win.mouse.down();
  await win.mouse.move(x1, y1, { steps: 5 });
  await win.mouse.up();
  await win.keyboard.type('Texto en varias líneas dentro de un cuadro estrecho');
  await win.keyboard.press('Escape');

  // Formato: JetBrains Mono, 14 pt, negrita, color, centrado.
  const bar = win.getByRole('toolbar', { name: 'Formato del texto' });
  await bar.getByLabel('Fuente').selectOption('mono');
  await bar.getByLabel('Tamaño en puntos').fill('14');
  await bar.getByRole('button', { name: 'Negrita' }).click();
  await bar.getByLabel('Color del texto').fill('#c0392b');
  await bar.getByRole('radio', { name: 'Centrar' }).click();
  await expect(win.locator('[data-textbox]')).toHaveCSS('font-weight', '700');

  // Mover con Seleccionar.
  await tool(win, 'Seleccionar').click();
  const box = win.locator('[data-textbox]');
  const b = await box.boundingBox();
  await win.mouse.move(b.x + 10, b.y + 5);
  await win.mouse.down();
  await win.mouse.move(b.x + 10, b.y + 85, { steps: 6 });
  await win.mouse.up();
  const moved = await box.boundingBox();
  expect(moved.y - b.y).toBeGreaterThan(60);

  // Duplicar, borrar y deshacer.
  await win.keyboard.press('Control+D');
  await expect(win.locator('[data-textbox]')).toHaveCount(2);
  await win.keyboard.press('Delete');
  await expect(win.locator('[data-textbox]')).toHaveCount(1);
  await win.getByRole('button', { name: /^Deshacer/ }).click();
  await expect(win.locator('[data-textbox]')).toHaveCount(2);

  await save(win);
  const saved = await readWhenChanged(file, original);
  const core = await engine();
  const d = core.open(saved);
  const runs = core.textRuns(d.docId, 0).filter((r) => r.fontName.includes('JetBrains'));
  expect(runs.length).toBeGreaterThanOrEqual(4); // dos cuadros de dos o más líneas
  expect(runs.every((r) => /Bold/.test(r.fontName) && r.color === '#c0392b' && Math.abs(r.ptSize - 14) < 0.1)).toBe(true);
  const text = core.pageText(d.docId, 0).replace(/\s+/g, ' ');
  expect(text).toContain('Texto en varias líneas dentro de un cuadro estrecho');
  core.close(d.docId);
  await app.close();
});
