// Utilidades de las pruebas e2e: lanzar la app real, copiar fixtures, sustituir diálogos nativos.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, copyFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
export const { verifyPdfSignatures } = require('../../electron/sigverify.cjs');

/**
 * SPIDERPDF_E2E_EXE=ruta de SpiderPDF.exe (p. ej. release/win-unpacked): las pruebas usan la app EMPAQUETADA, con
 * --user-data-dir en la carpeta temporal (nunca el perfil real). Ahí no existen los ganchos de prueba (impresora,
 * compartir, enlaces, actualizaciones…) ni e2e.log: las pruebas que los usan fallan por eso.
 */
export const PACKAGED_EXE = process.env.SPIDERPDF_E2E_EXE || null;

/** Carpeta temporal para una prueba. */
export const tempDir = () => mkdtemp(path.join(os.tmpdir(), 'spiderpdf-e2e-'));

/** Copia un fixture a dir (las pruebas nunca abren test/fixtures directamente). */
export async function copyFixture(dir, name, as = name) {
  const to = path.join(dir, as);
  await copyFile(path.join(ROOT, 'test', 'fixtures', name), to);
  return to;
}

/**
 * Arranca la app de verdad (proceso principal, preload y la interfaz de dist/), con su propia carpeta
 * de datos (SPIDERPDF_USER_DATA): no choca con otra ventana abierta ni toca las preferencias del usuario.
 * files: PDFs que se abren al arrancar (como un doble clic). extraEnv: variables añadidas (p. ej.
 * SPIDERPDF_LEGACY_DATA). lang: idioma del sistema que ve la app (--lang de Chromium); por defecto español, el de
 * las pruebas; con otro, la espera inicial no busca textos. → { app, win, errors }
 */
export async function launch(dir, files = [], extraEnv = {}, { lang = 'es-ES', spanish = lang.startsWith('es') } = {}) {
  const env = { ...process.env, SPIDERPDF_USER_DATA: path.join(dir, 'datos-app'), ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE; // VS Code la define y convierte Electron en Node
  delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch(PACKAGED_EXE
    ? { executablePath: PACKAGED_EXE, args: [`--user-data-dir=${env.SPIDERPDF_USER_DATA}`, `--lang=${lang}`, ...files], env, timeout: 60_000 }
    : { args: [`--lang=${lang}`, ROOT, ...files], cwd: ROOT, env, timeout: 60_000 });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  // El aviso de cambios sin guardar al cerrar es nativo y bloquearía la prueba: se acepta solo.
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; });
  // App empaquetada: no hay ganchos de prueba. Red de seguridad para que nada salga del equipo ni de la ventana:
  // ni impresora, ni navegador, ni programas, ni el Explorador (una prueba sin saltar fallaría, pero sin efectos).
  if (PACKAGED_EXE) {
    await app.evaluate(({ shell, webContents }) => {
      shell.openExternal = async () => {};
      shell.openPath = async () => '';
      shell.showItemInFolder = () => {};
      const proto = Object.getPrototypeOf(webContents.getAllWebContents()[0]);
      proto.print = (_o, cb) => cb?.(false, 'bloqueado en las pruebas con la app empaquetada');
    });
  }
  if (!spanish) await expect(win.locator('footer')).toBeVisible({ timeout: 30_000 }); // otro idioma: sin buscar textos
  else if (files.length) await expect(win.locator('footer')).toContainText(/\d+ páginas?/, { timeout: 30_000 });
  else await expect(win.getByText('Abre un PDF para empezar')).toBeVisible({ timeout: 30_000 });
  return { app, win, errors };
}

/**
 * Un solo documento con varios PDF unidos: arranca con el primero y añade los demás con «Añadir PDF», sin nada
 * seleccionado. (Abrir varios a la vez los pone cada uno en su pestaña.) → lo mismo que launch.
 */
export async function launchMerged(dir, files, ...rest) {
  const r = await launch(dir, [files[0]], ...rest);
  await stubOpen(r.app, files.slice(1));
  await r.win.keyboard.press('Control+Shift+O');
  await expect(r.win.getByText(/^Se añadieron? \d+ páginas?\.$/)).toBeVisible();
  await r.win.keyboard.press('Escape'); // «Añadir» deja seleccionadas las añadidas: como si se hubieran abierto juntos
  await expect(r.win.getByText(/^\d+ de \d+ seleccionadas?$/)).toHaveCount(0);
  return r;
}

/** Pestañas de documentos (barra de pestañas). */
export const docTabs = (win) => win.getByRole('tablist', { name: 'Documentos abiertos' }).getByRole('tab');

/** El diálogo «Abrir» nativo devuelve estos archivos. */
export const stubOpen = (app, files) => app.evaluate(({ dialog }, f) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f });
}, files);

/** El diálogo «Guardar como» nativo devuelve esta ruta. */
export const stubSaveAs = (app, file) => app.evaluate(({ dialog }, f) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
}, file);

export const footer = (win) => win.locator('footer');
export const sigButton = (win) => win.locator('footer button[aria-haspopup="dialog"]');
export const thumbs = (win) => win.locator('main ul > li');
export const toolbarButton = (win, title) => win.locator('header').getByTitle(title);
export const confirmDialog = (win) => win.getByRole('alertdialog');

/** El aviso de firma se VE: existe, es visible y no está recortado a casi nada. */
export async function expectSigStatus(win, text) {
  const b = sigButton(win);
  await expect(b).toContainText(text);
  await expect(b).toBeVisible();
  const box = await b.boundingBox();
  expect(box.width, 'el aviso de firma está recortado').toBeGreaterThan(120);
}

/** Espera a que el archivo cambie y lo lee. */
export async function readWhenChanged(file, before) {
  for (let i = 0; i < 100; i++) {
    const now = await readFile(file).catch(() => null);
    if (now && (!before || !now.equals(before))) return now;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`El archivo no cambió: ${file}`);
}

/** Motor PDFium en Node, para comprobar lo que guarda la app. */
let core;
export async function engine() {
  if (core) return core;
  const { init } = await import('@embedpdf/pdfium');
  const { PdfCore } = await import('../../src/engine/pdfium-core.js');
  const pdfium = await init({ wasmBinary: await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  pdfium.PDFiumExt_Init();
  core = new PdfCore(pdfium);
  return core;
}
