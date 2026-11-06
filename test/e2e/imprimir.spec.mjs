// Imprimir en la app real con el diálogo propio. La impresora no se puede automatizar: en las pruebas (solo
// sin empaquetar) el proceso principal imprime a PDF (printToPDF) cada lote y apunta las opciones con las que
// habría llamado a webContents.print(); aquí se comprueban ambas cosas.
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { tempDir, copyFixture, launch, footer, engine } from './helpers.mjs';
import { PAPERS, sheetLayout } from '../../src/printLayout.js';

const PRINTERS = [
  { name: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF', isDefault: true },
  { name: 'Oficina', displayName: 'Impresora de la oficina' },
];

/**
 * Impresoras de prueba y printToPDF en vez de imprimir; opciones y PDFs (en base64) en globalThis.
 * keep: false → de cada PDF solo se apunta cuántas páginas tiene (con cientos de páginas, devolver los PDF
 * enteros por la conexión de depuración la tumba).
 */
const hookPrint = (app, { printers = PRINTERS, keep = true } = {}) => app.evaluate((_, { list, keepPdf }) => {
  globalThis.__printOpts = [];
  globalThis.__printed = [];
  globalThis.__spiderPdfPrintersHook = async () => list;
  globalThis.__spiderPdfPrintHook = async (wc, options) => {
    globalThis.__printOpts.push(options);
    const pdf = await wc.printToPDF({ preferCSSPageSize: true, printBackground: true });
    globalThis.__printed.push(keepPdf ? pdf.toString('base64') : (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length);
    return { ok: true };
  };
}, { list: printers, keepPdf: keep });
const printed = (app) => app.evaluate(() => ({ opts: globalThis.__printOpts, pdfs: globalThis.__printed }));

async function dragOnPage(win, i, [u0, v0], [u1, v1]) {
  const page = win.locator(`[data-i="${i}"]`);
  await page.scrollIntoViewIfNeeded();
  const b = await page.boundingBox();
  await win.mouse.move(b.x + u0 * b.width, b.y + v0 * b.height);
  await win.mouse.down();
  await win.mouse.move(b.x + u1 * b.width, b.y + v1 * b.height, { steps: 5 });
  await win.mouse.up();
}

const dialog = (win) => win.getByRole('dialog', { name: 'Imprimir' });

test('el diálogo propio: vista previa, impresora, copias, color, doble cara; hojas A4 con las apaisadas giradas y sin recortes', async () => {
  const dir = await tempDir();
  // contrato (5 verticales) + anexo (2 apaisadas), unidos.
  const { app, win, errors } = await launch(dir, [await copyFixture(dir, 'contrato.pdf'), await copyFixture(dir, 'anexo.pdf')]);
  await hookPrint(app);
  expect(await app.evaluate(({ app: a }) => a.getName())).toBe('SpiderPDF');

  // Leer: zona a redactar en la página 2 y resaltado en la 3.
  await win.getByRole('tab', { name: 'Leer' }).click();
  await win.getByRole('button', { name: 'Redactar', exact: true }).click();
  await dragOnPage(win, 1, [0.3, 0.4], [0.7, 0.5]);
  await win.getByRole('button', { name: 'Resaltar', exact: true }).click();
  await dragOnPage(win, 2, [0.1, 0.6], [0.9, 0.65]);
  await win.keyboard.press('Escape');

  await win.keyboard.press('Control+P');
  const dlg = dialog(win);
  await expect(dlg).toBeVisible();
  const printer = dlg.getByLabel('Impresora');
  await expect(printer).toHaveValue('Microsoft Print to PDF'); // la predeterminada
  await expect(dlg.getByLabel('Caras')).toBeDisabled(); // una impresora PDF no imprime a doble cara
  await expect(dlg).toContainText('al imprimir se abrirá el diálogo de Windows'); // pregunta dónde guardar
  await expect(dlg).toContainText('Hoja 1 de 7');
  await expect(dlg).toContainText('7 páginas · 7 hojas');

  // Vista previa navegable: la hoja 6 (apaisada) sale girada; sin «girar», no.
  for (let i = 0; i < 5; i++) await dlg.getByRole('button', { name: 'Hoja siguiente' }).click();
  await expect(dlg).toContainText('Hoja 6 de 7');
  await expect(dlg.locator('[data-rotate]')).toHaveAttribute('data-rotate', '90');
  await dlg.getByLabel('Girar las páginas apaisadas para aprovechar el papel').uncheck();
  await expect(dlg.locator('[data-rotate]')).toHaveAttribute('data-rotate', '0');
  await dlg.getByLabel('Girar las páginas apaisadas para aprovechar el papel').check();

  // Otra impresora: doble cara disponible; 2 copias, blanco y negro.
  await printer.selectOption('Oficina');
  await expect(dlg.getByLabel('Caras')).toBeEnabled();
  await dlg.getByLabel('Caras').selectOption('longEdge');
  await dlg.getByLabel('Copias').fill('2');
  await dlg.getByRole('radio', { name: 'Blanco y negro' }).click();
  await expect(dlg).toContainText('7 páginas · 8 hojas (2 copias)');
  await dlg.getByRole('button', { name: 'Imprimir', exact: true }).click();
  await expect(win.getByText('Se enviaron 7 páginas a imprimir.')).toBeVisible({ timeout: 60_000 });

  const { opts, pdfs } = await printed(app);
  expect(opts).toHaveLength(1);
  expect(opts[0]).toMatchObject({ silent: true, deviceName: 'Oficina', copies: 2, color: false, duplexMode: 'longEdge', pageSize: 'A4', landscape: false });

  // Las 7 hojas son A4 en vertical; nada se sale del área con margen (sin recortes).
  const core = await engine();
  const d = core.open(Buffer.from(pdfs[0], 'base64'));
  expect(d.pages).toHaveLength(7);
  for (const p of d.pages) {
    expect(Math.abs(p.width - PAPERS.A4.w)).toBeLessThan(2);
    expect(Math.abs(p.height - PAPERS.A4.h)).toBeLessThan(2);
  }
  const img = (i) => core.render(d.docId, i, 0.5);
  const inkBox = (r) => {
    let [x0, y0, x1, y1] = [r.width, r.height, 0, 0];
    for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
      const o = (y * r.width + x) * 4;
      if (r.pixels[o] < 235 || r.pixels[o + 1] < 235 || r.pixels[o + 2] < 235) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    return [x0, y0, x1, y1];
  };
  for (let i = 0; i < 7; i++) {
    const r = img(i);
    const [x0, y0, x1, y1] = inkBox(r);
    expect(x0, `hoja ${i + 1}: recortada por la izquierda`).toBeGreaterThan(3);
    expect(y0, `hoja ${i + 1}: recortada por arriba`).toBeGreaterThan(3);
    expect(x1, `hoja ${i + 1}: recortada por la derecha`).toBeLessThan(r.width - 3);
    expect(y1, `hoja ${i + 1}: recortada por abajo`).toBeLessThan(r.height - 3);
  }
  // La hoja 6 (apaisada, girada): la tinta ocupa más alto que ancho.
  const [ax0, ay0, ax1, ay1] = inkBox(img(5));
  expect(ay1 - ay0).toBeGreaterThan(ax1 - ax0);
  // Redacción pendiente en negro y resaltado, en su sitio de la hoja (misma cuenta que la vista previa).
  const at = (i, u, v) => {
    const box = sheetLayout(595, 842, PAPERS.A4);
    const r = img(i);
    const x = Math.floor(((box.x + u * box.w) / PAPERS.A4.w) * r.width);
    const y = Math.floor(((box.y + v * box.h) / PAPERS.A4.h) * r.height);
    const o = (y * r.width + x) * 4;
    return [r.pixels[o], r.pixels[o + 1], r.pixels[o + 2]];
  };
  expect(Math.max(...at(1, 0.5, 0.45))).toBeLessThan(40);
  const [hr, hg, hb] = at(2, 0.5, 0.625); // en blanco y negro el amarillo es un gris claro, no blanco
  expect(hr < 250 && Math.abs(hr - hb) < 25, `resaltado en gris: ${[hr, hg, hb]}`).toBe(true);
  core.close(d.docId);
  expect(errors).toEqual([]);
  await app.close();
});

test('intervalo «2, 6-7», selección preelegida y «Configuración avanzada» con el diálogo del sistema', async () => {
  const dir = await tempDir();
  const { app, win } = await launch(dir, [await copyFixture(dir, 'contrato.pdf'), await copyFixture(dir, 'anexo.pdf')]);
  await hookPrint(app);

  // Con selección, el intervalo empieza en «Selección».
  await win.locator('main ul > li').nth(0).click();
  await win.locator('main ul > li').nth(2).click({ modifiers: ['Control'] });
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: /^Imprimir/ }).click();
  const dlg = dialog(win);
  await expect(dlg.getByRole('radio', { name: 'Selección (2)' })).toBeChecked();
  await expect(dlg).toContainText('2 páginas · 2 hojas');

  // Intervalo escrito: error explicado y luego válido.
  const range = dlg.getByLabel('Intervalo de páginas');
  await range.fill('2, 9');
  await expect(dlg.getByRole('alert')).toContainText('7 páginas');
  await expect(dlg.getByRole('button', { name: 'Imprimir', exact: true })).toBeDisabled();
  await range.fill('2, 6-7');
  await expect(dlg).toContainText('3 páginas · 3 hojas');

  await dlg.getByRole('button', { name: 'Configuración avanzada de la impresora…' }).click();
  await expect(win.getByText('Se enviaron 3 páginas a imprimir.')).toBeVisible({ timeout: 60_000 });
  const { opts, pdfs } = await printed(app);
  expect(opts).toHaveLength(1);
  expect(opts[0].silent).toBe(false); // el diálogo del sistema, con la impresora elegida
  expect(opts[0].deviceName).toBe('Microsoft Print to PDF');
  const core = await engine();
  const d = core.open(Buffer.from(pdfs[0], 'base64'));
  expect(d.pages).toHaveLength(3);
  core.close(d.docId);
  await app.close();
});

test('PDF grande (300 páginas): por lotes, con progreso, sin que la memoria crezca con las páginas', async () => {
  test.setTimeout(300_000);
  const dir = await tempDir();
  const big = await PDFDocument.create();
  const font = await big.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 300; i++) {
    const p = big.addPage(i % 10 === 9 ? [842, 595] : [595, 842]);
    p.drawText(`Página ${i + 1}`, { x: 60, y: p.getHeight() - 80, size: 28, font });
    for (let l = 0; l < 30; l++) p.drawText('Línea de texto para que la página tenga contenido real que imprimir.', { x: 60, y: p.getHeight() - 130 - l * 16, size: 10, font });
  }
  const file = path.join(dir, 'grande-300.pdf');
  await writeFile(file, await big.save());
  const { app, win } = await launch(dir, [file]);
  await hookPrint(app, { keep: false });

  const sample =() => app.evaluate(({ app: a }) => a.getAppMetrics().reduce((s, m) => s + m.memory.workingSetSize, 0) / 1024);
  const t0 = Date.now();
  await win.keyboard.press('Control+P');
  await dialog(win).getByLabel('Impresora').selectOption('Oficina'); // física: en silencio y por lotes
  await dialog(win).getByRole('button', { name: 'Imprimir', exact: true }).click();
  await expect(footer(win)).toContainText(/Preparando impresión… \d+ de 300/);
  // Muestras de memoria con su fase: «preparando» (página n de 300) o «enviando» (lote k de 13).
  const during = [];
  const phases = new Set();
  for (;;) {
    const text = await footer(win).innerText();
    const prep = text.match(/Preparando impresión… (\d+) de 300/);
    const send = text.match(/Enviando a la impresora… (\d+) de (\d+)/);
    if (prep && Number(prep[1]) >= 100) phases.add('preparando');
    if (send) phases.add('enviando');
    during.push({ mb: await sample(), prep: prep ? Number(prep[1]) : null, send: send ? Number(send[1]) : null });
    if (await win.getByText('Se enviaron 300 páginas a imprimir.').isVisible()) break;
    expect(Date.now() - t0, 'demasiado lento').toBeLessThan(240_000);
    await win.waitForTimeout(500);
  }
  const { opts, pdfs } = await printed(app);
  expect(opts.length).toBe(Math.ceil(300 / 24)); // por lotes
  expect(pdfs.reduce((s, n) => s + n, 0)).toBe(300); // páginas de todos los lotes
  expect([...phases]).toContain('preparando');
  // La memoria no crece con las páginas. Se compara cada fase consigo misma (preparar no se parece a enviar)
  // y con medianas: los picos dependen de cuándo pasa el recolector. Antes del arreglo, 100 páginas = 2,7 GB.
  const median = (xs) => { const v = xs.map((x) => x.mb).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
  const peak = Math.max(...during.map((x) => x.mb));
  const prepEarly = median(during.filter((x) => x.prep >= 20 && x.prep <= 120));
  const prepLate = median(during.filter((x) => x.prep >= 200));
  const sendEarly = median(during.filter((x) => x.send >= 1 && x.send <= 5));
  const sendLate = median(during.filter((x) => x.send >= 9));
  console.log(`300 páginas: ${Math.round((Date.now() - t0) / 1000)} s; pico ${Math.round(peak)} MB; preparando ${Math.round(prepEarly)} → ${Math.round(prepLate)} MB; enviando ${Math.round(sendEarly)} → ${Math.round(sendLate)} MB`);
  expect(peak, 'pico de memoria').toBeLessThan(2500);
  expect(prepLate, 'la memoria crece al preparar').toBeLessThan(prepEarly * 1.3);
  if (Number.isFinite(sendEarly) && Number.isFinite(sendLate)) expect(sendLate, 'la memoria crece al enviar').toBeLessThan(sendEarly * 1.3);
  await app.close();
});
