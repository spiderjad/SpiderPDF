// Compartir en la app real: copiar el archivo (portapapeles de verdad, con el ayudante en C#), Mostrar en el
// Explorador, WhatsApp, Enviar a IA (con Preferencias) y correo; copia con cambios, selección e información oculta
// quitada; la carpeta temporal se borra al cerrar. Lo que sale de la app (abrir enlaces, el Explorador, el correo)
// se sustituye con __spiderPdfShareHook; correo y compartir de verdad se prueban a mano.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tempDir, copyFixture, launch, toolbarButton, engine } from './helpers.mjs';

const dialog = (win) => win.getByRole('dialog', { name: 'Compartir' });
const target = (win, name) => dialog(win).getByRole('group', { name: 'Destino' }).getByRole('button', { name: new RegExp(`^${name}`) });

/** Sustituye lo que sale de la app; installed: protocolos con app de escritorio. → lista de llamadas (se lee con calls()). */
async function hookShare(app, { installed = [], mail = { ok: true } } = {}) {
  await app.evaluate((_e, o) => {
    const calls = [];
    globalThis.__spiderPdfShareCalls = calls;
    globalThis.__spiderPdfShareHook = {
      installed: o.installed,
      openExternal: async (u) => { calls.push(['open', u]); },
      reveal: (p) => { calls.push(['reveal', p]); },
      mail: async (id, subject) => { calls.push(['mail', subject]); return o.mail; },
    };
  }, { installed, mail });
}
const calls = (app) => app.evaluate(() => globalThis.__spiderPdfShareCalls);

/** Archivos del portapapeles de Windows (CF_HDROP), como los vería quien pegue. */
const clipboardFiles = () => execFileSync('powershell', ['-NoProfile', '-STA', '-Command',
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -A System.Windows.Forms; [Windows.Forms.Clipboard]::GetFileDropList()'], { encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean);

test('sin cambios: copiar el archivo (el original tal cual), Explorador, WhatsApp, IA y correo', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'contrato.pdf');
  const { app, win, errors } = await launch(dir, [file]);
  await hookShare(app, { installed: ['whatsapp://', 'claude://'], mail: { ok: false, code: 'sin-cliente', message: 'x' } });

  await toolbarButton(win, /^Compartir/).click();
  const d = dialog(win);
  await expect(d.getByLabel('Nombre del archivo')).toHaveValue('contrato.pdf');
  await expect(d.getByRole('radio', { name: 'Todo el documento (5)' })).toBeChecked();
  await expect(d.getByRole('radio', { name: /Páginas seleccionadas/ })).toBeDisabled();

  // Copiar archivo: en el portapapeles como archivo, idéntico al original.
  await target(win, 'Copiar archivo').click();
  await expect(d.getByRole('status')).toHaveText('PDF copiado. Pégalo con Ctrl+V en un correo, un chat o una carpeta.');
  const [copied] = clipboardFiles();
  expect(path.basename(copied)).toBe('contrato.pdf');
  expect(copied).toContain('SpiderPDF-compartir-');
  expect((await readFile(copied)).equals(await readFile(file))).toBe(true);

  await target(win, 'Mostrar en el Explorador').click();
  await expect(d.getByRole('status')).toHaveText('Se abrió la carpeta con el PDF.');
  await target(win, 'WhatsApp').click();
  await expect(d.getByRole('status')).toHaveText('WhatsApp está abierto. Elige el chat y pega con Ctrl+V.');
  await target(win, 'Enviar a IA').click();
  await expect(d.getByRole('status')).toHaveText('Claude está abierto. Pega con Ctrl+V y escribe tu pregunta.');
  await target(win, 'Correo').click();
  await expect(d.getByRole('status')).toContainText('Usa «Copiar archivo»');
  // La misma copia para todo (no se vuelve a preparar).
  expect(await calls(app)).toEqual([['reveal', copied], ['open', 'whatsapp://'], ['open', 'claude://'], ['mail', 'contrato']]);

  // Preferencias: ChatGPT, sin app instalada → su web.
  await win.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await win.keyboard.press('Control+,');
  const prefs = win.getByRole('dialog', { name: 'Preferencias' });
  await expect(prefs.getByRole('radio', { name: 'Claude' })).toBeChecked();
  await prefs.getByRole('radio', { name: 'ChatGPT' }).check();
  await prefs.getByRole('button', { name: 'Guardar' }).click();
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: 'Compartir…' }).click();
  await expect(target(win, 'Enviar a IA')).toContainText('Copia y abre ChatGPT');
  await target(win, 'Enviar a IA').click();
  await expect(d.getByRole('status')).toHaveText('Se abrió ChatGPT en el navegador. Pega con Ctrl+V y escribe tu pregunta.');
  expect((await calls(app)).at(-1)).toEqual(['open', 'https://chatgpt.com/']);
  expect(errors).toEqual([]);

  const folder = path.dirname(path.dirname(copied));
  await app.close();
  expect(existsSync(folder), 'la carpeta temporal se borra al cerrar').toBe(false);
});

test('con cambios: solo la selección, sin información oculta y nombre propio; WhatsApp sin instalar abre la web', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'formulario.pdf');
  const { app, win } = await launch(dir, [file, await copyFixture(dir, 'contrato.pdf')]);
  await hookShare(app, { installed: [] });
  // Dos PDF unidos (sin archivo propio); se seleccionan las páginas 2 y 3 y se gira la 2.
  const thumbs = win.locator('main ul > li');
  await thumbs.nth(1).click();
  await thumbs.nth(2).click({ modifiers: ['Control'] });
  await win.keyboard.press('Control+R');

  await toolbarButton(win, /^Compartir/).click();
  const d = dialog(win);
  await expect(d.getByRole('radio', { name: /^Todo el documento/ })).toBeChecked(); // por defecto, todo
  await d.getByRole('radio', { name: 'Páginas seleccionadas (2)' }).check();
  await d.getByLabel('Nombre del archivo').fill('para: Juan/Pedro');
  await d.getByRole('checkbox', { name: /Quitar información oculta/ }).check();
  await target(win, 'WhatsApp').click();
  await expect(d.getByRole('status')).toContainText('WhatsApp no está instalado: se abrió WhatsApp Web');
  const c = await calls(app);
  expect(c[0]).toEqual(['open', 'https://web.whatsapp.com/']);
  const shared = c[1][1];
  expect(path.basename(shared)).toBe('Pedro.pdf'); // sin rutas ni caracteres prohibidos
  const [copied] = clipboardFiles();
  expect(copied).toBe(shared);

  const core = await engine();
  const r = core.open(await readFile(shared));
  expect(r.pages.length).toBe(2);
  expect(r.hasForm).toBe(false); // sin formulario interactivo
  core.close(r.docId);
  await app.close();
});
