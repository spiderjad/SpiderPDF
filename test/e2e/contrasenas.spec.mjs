// Contraseñas en la app real: abrir PDFs protegidos (con «Mostrar» y reintentos), respetar sus permisos,
// desbloquearlos, proteger (AES-256), quitar la contraseña y redactar uno protegido sin perder la protección.
// Las contraseñas nunca se guardan: al final se buscan en la carpeta de datos de la app y en su registro.
import { test, expect } from '@playwright/test';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tempDir, launch, footer, stubOpen, stubSaveAs, toolbarButton, confirmDialog, engine, copyFixture } from './helpers.mjs';
import { permsFor } from '../../src/security.js';

const OPEN_PW = 'abrir-Ñu1';
const OWNER_PW = 'permisos-€2';
const pwDialog = (win) => win.getByRole('dialog', { name: /Este PDF está protegido|Desbloquear permisos/ });

/** Copia de contrato.pdf protegida (contraseña de abrir y de permisos; perms: lo que permite la de abrir). */
async function protectedCopy(dir, name, perms) {
  const core = await engine();
  const src = await copyFixture(dir, 'contrato.pdf', `base-${name}`);
  const d = core.open(await readFile(src));
  const bytes = core.compose(d.pages.map((_, i) => ({ docId: d.docId, index: i, rot: 0 })), null, { security: { user: OPEN_PW, owner: OWNER_PW, perms } });
  core.close(d.docId);
  const file = path.join(dir, name);
  await writeFile(file, bytes);
  return file;
}

async function menu(win, top, item) {
  await win.getByRole('menubar').getByRole('menuitem', { name: top }).click();
  return win.getByRole('menu', { name: top }).getByRole('menuitem', { name: item });
}

/** Seguridad del archivo guardado, probando cada contraseña. */
async function securityOf(file, pw) {
  const core = await engine();
  try {
    const r = core.open(await readFile(file), pw);
    const text = core.pageText(r.docId, 0);
    core.close(r.docId);
    return { ...r.security, text };
  } catch (e) {
    return e.wrongPassword ? 'incorrecta' : e.needsPassword ? 'pide' : e.message;
  }
}

/** Busca un texto en todos los archivos de una carpeta (en UTF-8 y UTF-16). */
async function findInFiles(dir, needle) {
  const hits = [];
  const walk = async (d) => {
    for (const name of await readdir(d).catch(() => [])) {
      const f = path.join(d, name);
      const s = await stat(f).catch(() => null);
      if (!s) continue;
      if (s.isDirectory()) await walk(f);
      else {
        const b = await readFile(f).catch(() => Buffer.alloc(0));
        if (b.includes(Buffer.from(needle, 'utf8')) || b.includes(Buffer.from(needle, 'utf16le'))) hits.push(f);
      }
    }
  };
  await walk(dir);
  return hits;
}

test('abrir un PDF protegido: «Mostrar», contraseña incorrecta y reintento; cancelar no abre nada', async () => {
  const dir = await tempDir();
  const file = await protectedCopy(dir, 'protegido.pdf', permsFor({}));
  const { app, win, errors } = await launch(dir);
  await stubOpen(app, [file]);

  // Cancelar: no se abre y no hay mensaje de error.
  await win.keyboard.press('Control+O');
  await expect(pwDialog(win)).toBeVisible();
  await expect(pwDialog(win)).toContainText('protegido.pdf');
  await win.keyboard.press('Escape');
  await expect(pwDialog(win)).toHaveCount(0);
  await expect(win.getByText('Abre un PDF para empezar')).toBeVisible();
  await expect(win.getByRole('alert')).toHaveCount(0);

  await win.keyboard.press('Control+O');
  const d = pwDialog(win);
  const input = d.getByRole('textbox', { name: 'Contraseña', exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill('mal');
  await d.getByRole('button', { name: 'Mostrar la contraseña' }).click();
  await expect(input).toHaveAttribute('type', 'text');
  await d.getByRole('button', { name: 'Ocultar la contraseña' }).click();
  await expect(input).toHaveAttribute('type', 'password');
  await d.getByRole('button', { name: 'Abrir' }).click();
  await expect(d.getByRole('alert')).toHaveText('La contraseña no es correcta. Vuelve a intentarlo.');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await input.fill('otra');
  await input.press('Enter');
  await expect(d.getByRole('alert')).toContainText('(2 intentos)');
  await input.fill(OPEN_PW);
  await input.press('Enter');
  await expect(pwDialog(win)).toHaveCount(0);
  await expect(footer(win)).toContainText('5 páginas');
  await expect(footer(win)).toContainText('Protegido');
  expect(errors).toEqual([]);
  await app.close();
});

test('permisos: con la contraseña de abrir no se puede editar, imprimir ni copiar; con la de permisos, sí', async () => {
  const dir = await tempDir();
  const file = await protectedCopy(dir, 'restringido.pdf', permsFor({ print: false, copy: false, edit: false }));
  const { app, win, errors } = await launch(dir);
  await stubOpen(app, [file]);
  await win.keyboard.press('Control+O');
  await pwDialog(win).getByRole('textbox', { name: 'Contraseña', exact: true }).fill(OPEN_PW);
  await pwDialog(win).getByRole('button', { name: 'Abrir' }).click();
  await expect(win.getByText('no permite editar, imprimir ni copiar')).toBeVisible();

  // Imprimir y las acciones de páginas, desactivadas; en Leer solo «Seleccionar».
  await expect(await menu(win, 'Archivo', /^Imprimir/)).toHaveAttribute('aria-disabled', 'true');
  await win.keyboard.press('Escape');
  await expect(await menu(win, 'Editar', 'Girar a la derecha')).toHaveAttribute('aria-disabled', 'true');
  await win.keyboard.press('Escape');
  await win.getByRole('tab', { name: 'Leer' }).click();
  await expect(win.getByRole('button', { name: 'Resaltar', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(win.getByRole('button', { name: 'Redactar', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await win.keyboard.press('Control+P');
  await expect(win.getByRole('dialog', { name: 'Imprimir' })).toHaveCount(0);

  // Desbloquear con la contraseña de permisos (primero una mala).
  await (await menu(win, 'Archivo', 'Desbloquear permisos…')).click();
  const d = pwDialog(win);
  await d.getByRole('textbox', { name: 'Contraseña de permisos', exact: true }).fill(OPEN_PW);
  await d.getByRole('button', { name: 'Desbloquear' }).click();
  await expect(d.getByRole('alert')).toHaveText('La contraseña de permisos no es correcta.');
  await d.getByRole('textbox', { name: 'Contraseña de permisos', exact: true }).fill(OWNER_PW);
  await d.getByRole('button', { name: 'Desbloquear' }).click();
  await expect(win.getByText('Permisos desbloqueados')).toBeVisible();
  await expect(win.getByRole('button', { name: 'Resaltar', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(await menu(win, 'Archivo', /^Imprimir/)).not.toHaveAttribute('aria-disabled', 'true');
  await win.keyboard.press('Escape');
  await expect(footer(win)).not.toContainText('Cambios sin guardar'); // desbloquear no cambia el documento
  expect(errors).toEqual([]);
  await app.close();
});

test('proteger un PDF: AES-256 con permisos; guardar otra vez la conserva; quitar la contraseña', async () => {
  const dir = await tempDir();
  const file = await copyFixture(dir, 'contrato.pdf');
  const { app, win, errors } = await launch(dir, [file]);

  await (await menu(win, 'Archivo', 'Proteger con contraseña…')).click();
  const d = win.getByRole('dialog', { name: 'Proteger con contraseña' });
  await expect(d.getByRole('textbox', { name: 'Contraseña para abrir', exact: true })).toBeFocused();
  await d.getByRole('textbox', { name: 'Contraseña para abrir', exact: true }).fill(OPEN_PW);
  await d.getByRole('button', { name: 'Proteger' }).click();
  await expect(d.getByRole('alert')).toHaveText('Las contraseñas no coinciden.');
  await d.locator('input[type="password"]').nth(1).fill(OPEN_PW);
  // Sin imprimir: hace falta una contraseña de permisos distinta.
  await d.getByRole('checkbox', { name: /Imprimir/ }).uncheck();
  await d.getByRole('textbox', { name: 'Contraseña de permisos', exact: true }).fill(OPEN_PW);
  await d.locator('input[type="password"]').nth(3).fill(OPEN_PW);
  await d.getByRole('button', { name: 'Proteger' }).click();
  await expect(d.getByRole('alert')).toHaveText('La contraseña de permisos tiene que ser distinta de la de abrir.');
  await d.getByRole('textbox', { name: 'Contraseña de permisos', exact: true }).fill(OWNER_PW);
  await d.locator('input[type="password"]').nth(3).fill(OWNER_PW);
  await d.getByRole('button', { name: 'Proteger' }).click();
  await expect(d).toHaveCount(0);
  await expect(footer(win)).toContainText('Protegido');
  await expect(footer(win)).toContainText('Cambios sin guardar');

  await toolbarButton(win, /^Guardar \(/).click();
  await expect(footer(win)).not.toContainText('Cambios sin guardar', { timeout: 20_000 });
  expect(await securityOf(file, '')).toBe('pide');
  expect(await securityOf(file, 'mal')).toBe('incorrecta');
  const u = await securityOf(file, OPEN_PW);
  expect([u.encrypted, u.revision, u.owner, u.perms]).toEqual([true, 6, false, permsFor({ print: false })]);
  expect(u.text).toContain('Contrato de suministro');
  expect((await securityOf(file, OWNER_PW)).owner).toBe(true);
  expect((await readFile(file)).toString('latin1')).toMatch(/\/AESV3/);

  // Un cambio y guardar otra vez: sigue protegido igual.
  await win.keyboard.press('Control+R');
  await toolbarButton(win, /^Guardar \(/).click();
  await expect(footer(win)).not.toContainText('Cambios sin guardar', { timeout: 20_000 });
  expect((await securityOf(file, OPEN_PW)).perms).toBe(permsFor({ print: false }));

  // Quitar la contraseña (aún no está protegido en memoria: deja de protegerse) y guardar.
  await (await menu(win, 'Archivo', 'Quitar la contraseña')).click();
  await expect(footer(win)).not.toContainText('Protegido');
  await toolbarButton(win, /^Guardar \(/).click();
  await expect(footer(win)).not.toContainText('Cambios sin guardar', { timeout: 20_000 });
  expect((await securityOf(file, '')).encrypted).toBe(false);
  expect(errors).toEqual([]);
  await app.close();

  // Nada de las contraseñas en la carpeta de datos ni en el registro de la app.
  expect(await findInFiles(path.join(dir, 'datos-app'), OPEN_PW)).toEqual([]);
  expect(await findInFiles(path.join(dir, 'datos-app'), OWNER_PW)).toEqual([]);
});

test('quitar la contraseña de un PDF abierto con ella', async () => {
  const dir = await tempDir();
  const file = await protectedCopy(dir, 'protegido.pdf', permsFor({}));
  const { app, win } = await launch(dir);
  await stubOpen(app, [file]);
  await win.keyboard.press('Control+O');
  await pwDialog(win).getByRole('textbox', { name: 'Contraseña', exact: true }).fill(OPEN_PW);
  await pwDialog(win).getByRole('button', { name: 'Abrir' }).click();
  await expect(footer(win)).toContainText('Protegido');
  // La de abrir lo permite todo: no pide la de permisos.
  await (await menu(win, 'Archivo', 'Quitar la contraseña')).click();
  await expect(win.getByText('Se quitará la contraseña al guardar.')).toBeVisible();
  await expect(footer(win)).not.toContainText('Protegido');
  await toolbarButton(win, /^Guardar \(/).click();
  await expect(footer(win)).not.toContainText('Cambios sin guardar', { timeout: 20_000 });
  const s = await securityOf(file, '');
  expect(s.encrypted).toBe(false);
  expect(s.text).toContain('Contrato de suministro');
  expect((await readFile(file)).toString('latin1')).not.toMatch(/\/Encrypt|\/AESV3/);
  await app.close();
  expect(await findInFiles(path.join(dir, 'datos-app'), OPEN_PW)).toEqual([]);
});

test('redactar un PDF protegido: la copia queda protegida con la misma configuración y se reabre sin pedirla', async () => {
  const dir = await tempDir();
  const perms = permsFor({ print: false, copy: false });
  const file = await protectedCopy(dir, 'protegido.pdf', perms);
  const { app, win, errors } = await launch(dir);
  await stubOpen(app, [file]);
  await win.keyboard.press('Control+O');
  await pwDialog(win).getByRole('textbox', { name: 'Contraseña', exact: true }).fill(OPEN_PW);
  await pwDialog(win).getByRole('button', { name: 'Abrir' }).click();
  await expect(footer(win)).toContainText('5 páginas');

  // Zona sobre el título de la página 1 («Contrato de suministro»).
  await win.getByRole('tab', { name: 'Leer' }).click();
  await win.getByRole('button', { name: 'Redactar', exact: true }).click();
  const page = win.locator('[data-i="0"]');
  const b = await page.boundingBox();
  await win.mouse.move(b.x + 0.05 * b.width, b.y + 0.04 * b.height);
  await win.mouse.down();
  await win.mouse.move(b.x + 0.95 * b.width, b.y + 0.12 * b.height, { steps: 5 });
  await win.mouse.up();
  await win.keyboard.press('Escape');

  const out = path.join(dir, 'protegido (redactado).pdf');
  await stubSaveAs(app, out);
  await toolbarButton(win, /^Guardar \(/).click();
  await confirmDialog(win).getByRole('button', { name: 'Redactar y guardar' }).click();
  await expect.poll(() => existsSync(out), { timeout: 30_000 }).toBe(true);
  // La ventana pasa a la copia sin volver a pedir la contraseña.
  await expect(footer(win)).toContainText('protegido (redactado).pdf', { timeout: 30_000 });
  await expect(pwDialog(win)).toHaveCount(0);
  await expect(footer(win)).toContainText('Protegido');

  expect(await securityOf(out, '')).toBe('pide');
  const u = await securityOf(out, OPEN_PW);
  expect([u.encrypted, u.revision, u.owner, u.perms]).toEqual([true, 6, false, perms]);
  expect(u.text).not.toContain('Contrato de suministro');
  const o = await securityOf(out, OWNER_PW);
  expect([o.owner, o.userPerms]).toEqual([true, perms]);
  expect(errors).toEqual([]);
  await app.close();
  expect(await findInFiles(path.join(dir, 'datos-app'), OPEN_PW)).toEqual([]);
});
