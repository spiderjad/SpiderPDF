// «Dividir PDF» en la app real: cada N páginas, intervalos, marcadores, tamaño máximo y página por página; carpeta,
// patrón de nombre, vista previa, archivos que ya existen y «Mostrar en la carpeta».
import { test, expect } from '@playwright/test';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { tempDir, copyFixture, launch, stubOpen, footer, engine, PACKAGED_EXE } from './helpers.mjs';

const dialog = (win) => win.getByRole('dialog', { name: 'Dividir PDF' });

async function openSplit(win) {
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Archivo' }).click();
  await win.getByRole('menu', { name: 'Archivo' }).getByRole('menuitem', { name: 'Dividir PDF…' }).click();
  await expect(dialog(win)).toBeVisible();
  return dialog(win);
}
/** Filas de la vista previa: [archivo, páginas(, tamaño)]. */
const rows = (d) => d.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent)));
async function pagesOf(file) {
  const core = await engine();
  const doc = core.open(await readFile(file));
  const n = doc.pages.length;
  core.close(doc.docId);
  return n;
}

test('cada N páginas (por defecto 2): vista previa, archivos con el patrón en la carpeta del original y «Mostrar en la carpeta»', async () => {
  const dir = await tempDir();
  const contrato = await copyFixture(dir, 'contrato.pdf'); // 5 páginas
  test.skip(!!PACKAGED_EXE, 'Usa el gancho de «Mostrar en la carpeta», que la app empaquetada no tiene.');
  const { app, win, errors } = await launch(dir, [contrato]);
  await app.evaluate(() => {
    globalThis.__revealed = [];
    globalThis.__spiderPdfRevealHook = (p) => { globalThis.__revealed.push(p); };
  });

  let d = await openSplit(win);
  await expect(d.getByRole('radio', { name: 'Cada' })).toBeChecked();
  await expect(d.getByLabel('Páginas por archivo')).toHaveValue('2');
  await expect(d.getByLabel('Carpeta de destino')).toHaveValue(dir);
  await expect(d.getByLabel('Nombre de los archivos')).toHaveValue('{name}_{n}.pdf');
  await expect(d.getByTestId('dividir-cuantos')).toHaveText('Saldrán 3 archivos');
  expect(await rows(d)).toEqual([['contrato_1.pdf', '1-2'], ['contrato_2.pdf', '3-4'], ['contrato_3.pdf', '5']]);
  await d.getByLabel('Páginas por archivo').fill('0');
  await expect(d.getByRole('alert')).toHaveText('Escribe un número de páginas, por ejemplo 2.');
  await expect(d.getByRole('button', { name: 'Dividir' })).toBeDisabled();
  await d.getByLabel('Páginas por archivo').fill('2');
  await d.getByRole('button', { name: 'Dividir' }).click();
  await expect(dialog(win)).toHaveCount(0);

  await expect(win.getByText(`Se crearon 3 archivos en «${path.basename(dir)}».`)).toBeVisible();
  await win.getByRole('button', { name: 'Mostrar en la carpeta' }).click();
  expect(await app.evaluate(() => globalThis.__revealed)).toEqual([path.join(dir, 'contrato_1.pdf')]);
  for (const [name, n] of [['contrato_1.pdf', 2], ['contrato_2.pdf', 2], ['contrato_3.pdf', 1]]) expect(await pagesOf(path.join(dir, name))).toBe(n);
  await expect(footer(win)).not.toContainText('Cambios sin guardar'); // el documento no cambia

  // Otra vez: recuerda el modo y avisa de los que ya existen.
  d = await openSplit(win);
  await expect(d.getByText('ya existe')).toHaveCount(3);
  await expect(d.getByText('Ya hay 3 archivos con esos nombres en la carpeta: se reemplazarán.')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Dividir y reemplazar' })).toBeEnabled();

  // Intervalos: un archivo por intervalo y aviso de las páginas que se quedan fuera.
  await d.getByRole('radio', { name: 'Por intervalos' }).check();
  await d.getByLabel('Intervalos', { exact: true }).fill('1-2, 4-');
  expect(await rows(d)).toEqual([['contrato_1.pdfya existe', '1-2'], ['contrato_2.pdfya existe', '4-5']]);
  await expect(d.getByText('La página 3 no va en ningún archivo.')).toBeVisible();
  await d.getByLabel('Intervalos', { exact: true }).fill('1-2, 6');
  await expect(d.getByRole('alert')).toHaveText('El documento tiene 5 páginas.');
  await d.getByLabel('Intervalos', { exact: true }).fill('1-2, 4-');
  // Patrón: tiene que dar un nombre distinto a cada archivo.
  await d.getByLabel('Nombre de los archivos').fill('{name}');
  await expect(d.getByRole('alert')).toHaveText('Incluye {n} o {pages} para que cada archivo tenga su nombre.');
  await expect(d.getByRole('button', { name: /^Dividir/ })).toBeDisabled();
  await d.getByLabel('Nombre de los archivos').fill('trozo {pages}');
  expect(await rows(d)).toEqual([['trozo 1-2.pdf', '1-2'], ['trozo 4-5.pdf', '4-5']]);
  await d.getByRole('button', { name: 'Dividir', exact: true }).click();
  await expect(win.getByText(`Se crearon 2 archivos en «${path.basename(dir)}».`)).toBeVisible();
  expect(await pagesOf(path.join(dir, 'trozo 1-2.pdf'))).toBe(2);
  expect(await pagesOf(path.join(dir, 'trozo 4-5.pdf'))).toBe(2);
  expect(errors).toEqual([]);
  await app.close();
});

test('por marcadores ({title}); página por página en otra pestaña; un nombre igual a un PDF abierto no se permite', async () => {
  const dir = await tempDir();
  const indice = await copyFixture(dir, 'indice.pdf'); // 6 páginas; marcadores principales en las páginas 1, 3 y 6
  const hoja = await copyFixture(dir, 'anexo.pdf', 'hoja1.pdf'); // 2 páginas
  const { app, win } = await launch(dir, [indice]);

  let d = await openSplit(win);
  await d.getByRole('radio', { name: 'Por marcadores' }).check();
  await expect(d.getByText('Un archivo por marcador principal (hay 3).')).toBeVisible();
  await d.getByLabel('Nombre de los archivos').fill('{title}');
  expect(await rows(d)).toEqual([['1. Introducción.pdf', '1-2'], ['2. Propuesta.pdf', '3-5'], ['3. Presupuesto y condiciones.pdf', '6']]);
  await d.getByRole('button', { name: 'Dividir', exact: true }).click();
  await expect(win.getByText(/^Se crearon 3 archivos/)).toBeVisible();
  expect(await pagesOf(path.join(dir, '2. Propuesta.pdf'))).toBe(3);

  // Otra pestaña: hoja1.pdf, página por página con «hoja{n}» → el primero sería el propio hoja1.pdf.
  await stubOpen(app, [hoja]);
  await win.keyboard.press('Control+O');
  await expect(footer(win)).toContainText('hoja1.pdf');
  d = await openSplit(win);
  await expect(d.getByRole('radio', { name: 'Por marcadores' })).toBeDisabled(); // este no tiene
  await d.getByRole('radio', { name: 'Página por página' }).check();
  await d.getByLabel('Nombre de los archivos').fill('hoja{n}');
  await expect(d.getByText('«hoja1.pdf» es un PDF abierto: cambia el nombre o la carpeta.')).toBeVisible();
  await expect(d.getByRole('button', { name: /^Dividir/ })).toBeDisabled();
  await d.getByLabel('Nombre de los archivos').fill('hoja-{n}');
  expect(await rows(d)).toEqual([['hoja-1.pdf', '1'], ['hoja-2.pdf', '2']]);
  await d.getByRole('button', { name: 'Dividir', exact: true }).click();
  await expect(win.getByText(/^Se crearon 2 archivos/)).toBeVisible();
  expect(await pagesOf(path.join(dir, 'hoja-2.pdf'))).toBe(1);
  expect(await pagesOf(hoja)).toBe(2); // el original, intacto
  await app.close();
});

test('por tamaño máximo: se calcula de verdad y ningún archivo pasa del máximo', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'escaneos.pdf');
  await writeFile(file, await noisePdf(8)); // 8 páginas de unos 45 KB
  const { app, win } = await launch(dir, [file]);

  const d = await openSplit(win);
  await d.getByRole('radio', { name: 'Por tamaño máximo' }).check();
  await d.getByLabel('Tamaño máximo de cada archivo').fill('0,05');
  await expect(d.getByRole('alert')).toHaveText('Escribe un tamaño en MB, como mínimo 0,1.');
  await d.getByLabel('Tamaño máximo de cada archivo').fill('0,1');
  await expect(d.getByTestId('dividir-cuantos')).toHaveText(/^Saldrán \d+ archivos$/, { timeout: 30_000 });
  const preview = await rows(d);
  expect(preview.length).toBeGreaterThan(2);
  expect(preview.length).toBeLessThan(8);
  expect(preview.every((r) => r.length === 3 && / KB$/.test(r[2]))).toBe(true); // con su tamaño
  await d.getByRole('button', { name: 'Dividir', exact: true }).click();
  await expect(win.getByText(new RegExp(`^Se crearon ${preview.length} archivos`))).toBeVisible();

  let pages = 0;
  for (let i = 1; i <= preview.length; i++) {
    const out = path.join(dir, `escaneos_${i}.pdf`);
    expect((await stat(out)).size).toBeLessThanOrEqual(0.1 * 1024 * 1024);
    pages += await pagesOf(out);
  }
  expect(pages).toBe(8);
  await app.close();
});

/** PDF de n páginas con una imagen de ruido cada una (no se comprime: el tamaño es predecible). */
async function noisePdf(n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const img = await doc.embedPng(noisePng(120, 120, i + 1));
    const p = doc.addPage([595, 842]);
    p.drawImage(img, { x: 100, y: 300, width: 360, height: 360 });
  }
  return doc.save();
}

function noisePng(w, h, seed) {
  let x = seed * 7919 + 1; // xorshift32: cada imagen distinta y sin patrones que se compriman
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) for (let i = 0; i < w * 3; i++) raw[y * (1 + w * 3) + 1 + i] = rnd() >>> 24;
  const table = Array.from({ length: 256 }, (_, k) => { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
