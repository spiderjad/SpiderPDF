// Pestañas en la app real: abrir varios PDF, cambiar y cerrar con el teclado, aviso al cerrar con cambios, abrir
// desde el Explorador con la app abierta, arrastrar una pestaña a otra ventana y recordar las pestañas.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT, tempDir, copyFixture, launch, stubOpen, footer, confirmDialog, docTabs, thumbs, readWhenChanged, engine,
} from './helpers.mjs';

const require = createRequire(import.meta.url);
const ELECTRON = require('electron'); // ruta del ejecutable

/** Como un doble clic en el Explorador con la app ya abierta: otra instancia que pasa los archivos a la primera. */
function openFromExplorer(dir, files) {
  const env = { ...process.env, SPIDERPDF_USER_DATA: path.join(dir, 'datos-app') };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  return new Promise((resolve, reject) => {
    const p = spawn(ELECTRON, ['--lang=es-ES', ROOT, ...files], { cwd: ROOT, env, stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', resolve); // sin el candado de instancia única, sale en el acto
  });
}

const tabNames = (win) => docTabs(win).evaluateAll((els) => els.map((e) => e.textContent));
const sessionFile = (dir) => path.join(dir, 'datos-app', 'sesion.json');
const readSession = async (dir) => JSON.parse(await readFile(sessionFile(dir), 'utf8'));

test('varios PDF a la vez, cada uno en su pestaña; Ctrl+Tab, Ctrl+T, Ctrl+W; uno ya abierto no se duplica', async () => {
  const dir = await tempDir();
  const contrato = await copyFixture(dir, 'contrato.pdf');
  const anexo = await copyFixture(dir, 'anexo.pdf');
  const indice = await copyFixture(dir, 'indice.pdf');
  const { app, win, errors } = await launch(dir, [contrato, anexo]);

  await expect(docTabs(win)).toHaveCount(2);
  expect(await tabNames(win)).toEqual(['contrato.pdf', 'anexo.pdf']);
  await expect(docTabs(win).nth(1)).toHaveAttribute('aria-selected', 'true'); // el último abierto, activo
  await expect(footer(win)).toContainText('anexo.pdf');
  await expect(footer(win)).toContainText('2 páginas');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('anexo.pdf – SpiderPDF');

  await win.keyboard.press('Control+Tab');
  await expect(footer(win)).toContainText('contrato.pdf');
  await expect(footer(win)).toContainText('5 páginas');
  await win.keyboard.press('Control+Shift+Tab');
  await expect(footer(win)).toContainText('anexo.pdf');

  // Ctrl+T: pestaña vacía a la derecha; «Abrir» la usa.
  await win.keyboard.press('Control+T');
  await expect(docTabs(win)).toHaveCount(3);
  await expect(docTabs(win).nth(2)).toHaveText('Nueva pestaña');
  await expect(win.getByText('Abre un PDF para empezar')).toBeVisible();
  await stubOpen(app, [indice]);
  await win.keyboard.press('Control+O');
  await expect(footer(win)).toContainText('indice.pdf');
  expect(await tabNames(win)).toEqual(['contrato.pdf', 'anexo.pdf', 'indice.pdf']);

  // Abrir otra vez uno que ya está en una pestaña: no se duplica, se pasa a ella.
  await stubOpen(app, [contrato.toUpperCase()]); // Windows: sin distinguir mayúsculas
  await win.keyboard.press('Control+O');
  await expect(win.getByText('«contrato.pdf» ya estaba abierto.')).toBeVisible();
  await expect(docTabs(win)).toHaveCount(3);
  await expect(docTabs(win).nth(0)).toHaveAttribute('aria-selected', 'true');

  // Ctrl+W cierra la activa (sin cambios: sin preguntar) y pasa a la de su derecha.
  await win.keyboard.press('Control+W');
  expect(await tabNames(win)).toEqual(['anexo.pdf', 'indice.pdf']);
  await expect(footer(win)).toContainText('anexo.pdf');
  // La × de otra pestaña la cierra sin cambiar la activa.
  await win.getByRole('button', { name: 'Cerrar «indice.pdf»' }).click();
  expect(await tabNames(win)).toEqual(['anexo.pdf']);
  // Teclado en la barra: flechas entre pestañas.
  await win.keyboard.press('Control+T');
  await docTabs(win).nth(1).focus();
  await win.keyboard.press('ArrowLeft');
  await expect(docTabs(win).nth(0)).toBeFocused();
  await expect(docTabs(win).nth(0)).toHaveAttribute('aria-selected', 'true');
  // Arrastrar en la barra cambia el orden.
  const a = await docTabs(win).nth(0).boundingBox();
  const b = await docTabs(win).nth(1).boundingBox();
  await win.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await win.mouse.down();
  await win.mouse.move(b.x + b.width - 10, b.y + b.height / 2, { steps: 8 });
  await win.mouse.up();
  expect(await tabNames(win)).toEqual(['Nueva pestaña', 'anexo.pdf']);
  expect(errors).toEqual([]);
  await app.close();
});

test('cerrar una pestaña con cambios pregunta (Cancelar, Cerrar sin guardar, Guardar); al cerrar la ventana, cuántos documentos', async () => {
  const dir = await tempDir();
  const contrato = await copyFixture(dir, 'contrato.pdf');
  const anexo = await copyFixture(dir, 'anexo.pdf');
  const { app, win } = await launch(dir, [contrato, anexo]);
  const original = await readFile(contrato);

  // Cambios en las dos: girar la primera página de cada una.
  for (const i of [0, 1]) {
    await docTabs(win).nth(i).click();
    await thumbs(win).nth(0).click();
    await win.keyboard.press('Control+R');
  }
  await expect(docTabs(win).nth(0)).toHaveAccessibleName('contrato.pdf, cambios sin guardar');
  await expect(docTabs(win).nth(1)).toHaveAccessibleName('anexo.pdf, cambios sin guardar');

  // Cerrar la ventana: el aviso nativo cuenta los documentos con cambios (aquí se cancela).
  await app.evaluate(({ dialog }) => {
    globalThis.__avisos = [];
    dialog.showMessageBoxSync = (_w, o) => { globalThis.__avisos.push(o.message); return 1; };
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => app.evaluate(() => globalThis.__avisos)).toEqual(['Hay cambios sin guardar en 2 documentos']);
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; }); // si algo falla, la app se puede cerrar
  await expect(docTabs(win)).toHaveCount(2);

  // Cerrar la pestaña con cambios: primero Cancelar, luego «Cerrar sin guardar».
  await docTabs(win).nth(0).click();
  await win.keyboard.press('Control+W');
  await expect(confirmDialog(win)).toContainText('¿Guardar los cambios de «contrato.pdf»?');
  await confirmDialog(win).getByRole('button', { name: 'Cancelar' }).click();
  await expect(docTabs(win)).toHaveCount(2);
  await win.keyboard.press('Control+W');
  await confirmDialog(win).getByRole('button', { name: 'Cerrar sin guardar' }).click();
  expect(await tabNames(win)).toEqual(['anexo.pdf']);
  expect((await readFile(contrato)).equals(original)).toBe(true); // no se tocó

  // La otra: «Guardar» guarda y cierra; queda una pestaña vacía.
  const before = await readFile(anexo);
  await win.getByRole('button', { name: 'Cerrar «anexo.pdf»' }).click();
  await confirmDialog(win).getByRole('button', { name: 'Guardar', exact: true }).click();
  const saved = await readWhenChanged(anexo, before);
  await expect(docTabs(win)).toHaveCount(1);
  await expect(docTabs(win).nth(0)).toHaveText('Nueva pestaña');
  const core = await engine();
  const doc = core.open(saved);
  expect(doc.pages[0].rot0).toBe(1);
  core.close(doc.docId);
  // Sin cambios ya no hay aviso al cerrar.
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => { throw new Error('no debía preguntar'); }; });
  await app.close();
});

test('abrir desde el Explorador con la app abierta: pestaña nueva; si ya estaba abierto, pasa a esa pestaña', async () => {
  const dir = await tempDir();
  const contrato = await copyFixture(dir, 'contrato.pdf');
  const anexo = await copyFixture(dir, 'anexo.pdf');
  const { app, win } = await launch(dir, [contrato]);
  await thumbs(win).nth(0).click();
  await win.keyboard.press('Control+R'); // con cambios: no se reemplaza ni se pregunta

  await openFromExplorer(dir, [anexo]);
  await expect(docTabs(win)).toHaveCount(2);
  await expect(footer(win)).toContainText('anexo.pdf');
  await expect(docTabs(win).nth(0)).toHaveAccessibleName('contrato.pdf, cambios sin guardar');

  await openFromExplorer(dir, [contrato]);
  await expect(footer(win)).toContainText('contrato.pdf');
  await expect(docTabs(win)).toHaveCount(2);
  await expect(footer(win)).toContainText('Cambios sin guardar'); // la misma pestaña, con sus cambios
  await app.close();
});

test('arrastrar una pestaña fuera la abre en otra ventana con sus cambios; también desde Ver con el teclado', async () => {
  const dir = await tempDir();
  const contrato = await copyFixture(dir, 'contrato.pdf');
  const anexo = await copyFixture(dir, 'anexo.pdf');
  const indice = await copyFixture(dir, 'indice.pdf');
  const { app, win, errors } = await launch(dir, [contrato, anexo]);

  // contrato: girar la página 2 y dejar seleccionada la 3.
  await docTabs(win).nth(0).click();
  await thumbs(win).nth(1).click();
  await win.keyboard.press('Control+R');
  await thumbs(win).nth(2).click();

  const box = await docTabs(win).nth(0).boundingBox();
  const opened = app.waitForEvent('window');
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width / 2 + 30, box.y + 120, { steps: 6 });
  await expect(win.getByText('Suelta para abrirla en una ventana nueva')).toBeVisible();
  await win.mouse.move(box.x + box.width / 2 + 60, box.y + 220, { steps: 6 });
  await win.mouse.up();
  const win2 = await opened;
  const errors2 = [];
  win2.on('pageerror', (e) => errors2.push(e.message));

  await expect(footer(win2)).toContainText('contrato.pdf', { timeout: 30_000 });
  await expect(footer(win2)).toContainText('Cambios sin guardar');
  await expect(docTabs(win2)).toHaveCount(1);
  await expect(thumbs(win2).nth(2)).toHaveAttribute('data-selected', 'true'); // la selección viaja
  await expect(docTabs(win)).toHaveCount(1);
  expect(await tabNames(win)).toEqual(['anexo.pdf']);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length)).toBe(2);

  // Guardar en la ventana nueva escribe el giro hecho en la otra.
  const before = await readFile(contrato);
  await win2.keyboard.press('Control+S');
  const saved = await readWhenChanged(contrato, before);
  const core = await engine();
  const doc = core.open(saved);
  expect(doc.pages.map((p) => p.rot0)).toEqual([0, 1, 0, 0, 0]);
  core.close(doc.docId);
  await expect(footer(win2)).not.toContainText('Cambios sin guardar');

  // Con una sola pestaña no se puede mover; con dos, Ver → «Mover la pestaña a una ventana nueva».
  await win2.getByRole('menubar').getByRole('menuitem', { name: 'Ver' }).click();
  await expect(win2.getByRole('menuitem', { name: 'Mover la pestaña a una ventana nueva' })).toHaveAttribute('aria-disabled', 'true');
  await win2.keyboard.press('Escape'); // cierra el menú
  await win2.keyboard.press('Escape'); // y sale de la barra de menús
  await stubOpen(app, [indice]);
  await win2.keyboard.press('Control+O');
  await expect(docTabs(win2)).toHaveCount(2);
  const third = app.waitForEvent('window');
  await win2.getByRole('menubar').getByRole('menuitem', { name: 'Ver' }).click();
  await win2.getByRole('menuitem', { name: 'Mover la pestaña a una ventana nueva' }).click();
  const win3 = await third;
  await expect(footer(win3)).toContainText('indice.pdf', { timeout: 30_000 });
  await expect(docTabs(win2)).toHaveCount(1);

  // Un PDF abierto en otra ventana: «Abrir» lo muestra allí en vez de abrirlo dos veces.
  await stubOpen(app, [anexo]);
  await win3.keyboard.press('Control+O');
  const log = path.join(dir, 'datos-app', 'e2e.log');
  await expect.poll(async () => (await readFile(log, 'utf8')).includes(`ya abierto en otra ventana: ${anexo}`)).toBe(true);
  await expect(docTabs(win3)).toHaveCount(1);
  expect(await tabNames(win3)).toEqual(['indice.pdf']);
  expect([...errors, ...errors2]).toEqual([]);
  await app.close();
});

test('Preferencias → recordar las pestañas: se vuelven a abrir (también las de otra ventana); desactivado, no', async () => {
  const dir = await tempDir();
  const contrato = await copyFixture(dir, 'contrato.pdf');
  const anexo = await copyFixture(dir, 'anexo.pdf');
  const indice = await copyFixture(dir, 'indice.pdf');
  let { app, win } = await launch(dir, [contrato, anexo, indice]);

  await win.keyboard.press('Control+,');
  const prefs = win.getByRole('dialog', { name: 'Preferencias' });
  await prefs.getByRole('checkbox', { name: 'Volver a abrir las pestañas de la última vez' }).check();
  await prefs.getByRole('button', { name: 'Guardar' }).click();
  await docTabs(win).nth(1).click(); // activa: anexo
  // indice, a otra ventana.
  await docTabs(win).nth(2).click();
  const opened = app.waitForEvent('window');
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Ver' }).click();
  await win.getByRole('menuitem', { name: 'Mover la pestaña a una ventana nueva' }).click();
  const win2 = await opened;
  await expect(footer(win2)).toContainText('indice.pdf', { timeout: 30_000 });
  await docTabs(win).nth(1).click();
  await expect.poll(() => readSession(dir).catch(() => null)).toEqual({
    windows: [{ tabs: [contrato, anexo], active: 1 }, { tabs: [indice], active: 0 }],
  });
  await app.close();

  ({ app, win } = await launch(dir, [], {}, { spanish: false }));
  await expect(docTabs(win)).toHaveCount(2, { timeout: 30_000 });
  expect(await tabNames(win)).toEqual(['contrato.pdf', 'anexo.pdf']);
  await expect(footer(win)).toContainText('anexo.pdf'); // la que estaba activa
  await expect.poll(() => app.windows().length).toBe(2); // la otra ventana, también
  const w2 = app.windows().find((w) => w !== win);
  await expect(footer(w2)).toContainText('indice.pdf', { timeout: 30_000 });

  // Desactivarlo borra lo recordado: la próxima vez no se abre nada.
  await win.keyboard.press('Control+,');
  await win.getByRole('dialog', { name: 'Preferencias' }).getByRole('checkbox', { name: 'Volver a abrir las pestañas de la última vez' }).uncheck();
  await win.getByRole('dialog', { name: 'Preferencias' }).getByRole('button', { name: 'Guardar' }).click();
  await expect.poll(() => existsSync(sessionFile(dir))).toBe(false);
  await app.close();
  ({ app, win } = await launch(dir));
  await expect(docTabs(win)).toHaveCount(1);
  await expect(docTabs(win).nth(0)).toHaveText('Nueva pestaña');
  await app.close();
});
