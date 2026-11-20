// Versión web: enlaces (src/site.js) y subida por FTP (build/web-deploy.cjs), sin conectar a nada.
// Ejecutar: node test/webdeploy.test.js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installerUrl, NEWS_URL } from '../src/site.js';

const require = createRequire(import.meta.url);
const { listFiles, remoteUrl, curlConfig, installerPublished } = require('../build/web-deploy.cjs');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok -', name); };

await t('enlace al instalador de esa versión (nombre de electron-builder) y a las novedades', () => {
  assert.equal(installerUrl('1.1.0'), 'https://github.com/spiderjad/SpiderPDF/releases/download/v1.1.0/SpiderPDF-Setup-1.1.0.exe');
  assert.equal(NEWS_URL, 'https://github.com/spiderjad/SpiderPDF/blob/main/docs/novedades.md');
});

await t('los archivos de la web, ordenados, con index.html el último', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spiderpdf-web-'));
  await mkdir(path.join(dir, 'assets'));
  await mkdir(path.join(dir, 'ocr'));
  for (const f of ['index.html', 'robots.txt', 'assets/index-abc.js', 'ocr/spa.traineddata.gz', 'favicon.svg']) await writeFile(path.join(dir, f), 'x');
  assert.deepEqual(listFiles(dir), ['assets/index-abc.js', 'favicon.svg', 'ocr/spa.traineddata.gz', 'robots.txt', 'index.html']);
});

await t('URL FTP: carpeta remota + ruta, codificada y sin barras de más', () => {
  assert.equal(remoteUrl('ftp.x.com', '/domains/x.com/public_html/pdf/', 'assets/a b.js'), 'ftp://ftp.x.com/domains/x.com/public_html/pdf/assets/a%20b.js');
  assert.equal(remoteUrl('ftp.x.com', '/', 'index.html'), 'ftp://ftp.x.com/index.html');
});

await t('configuración de curl: TLS obligatorio, contraseña con comillas y barras bien escapada, un par por archivo', () => {
  const cfg = curlConfig({ host: 'h', user: 'u@x', password: 'p"a\\ss', dir: '/web' }, ['assets/a.js', 'index.html'], 'C:\\dist');
  const lines = cfg.trim().split('\n');
  assert.equal(lines[0], 'user = "u@x:p\\"a\\\\ss"');
  assert.ok(lines.includes('ssl-reqd'));
  assert.ok(lines.includes('ftp-create-dirs'));
  assert.deepEqual(lines.filter((l) => l.startsWith('url')), ['url = "ftp://h/web/assets/a.js"', 'url = "ftp://h/web/index.html"']);
  assert.equal(lines.filter((l) => l.startsWith('upload-file')).length, 2);
  assert.ok(!curlConfig({ host: 'h', user: 'u', password: 'p', dir: '/', plain: true }, [], 'd').includes('ssl-reqd'));
});

await t('instalador publicado: 302 sí; 404 (borrador o no existe) no', async () => {
  const fake = (status) => async (url, opts) => { assert.equal(opts.method, 'HEAD'); assert.equal(opts.redirect, 'manual'); return { status }; };
  assert.equal(await installerPublished('u', fake(302)), true);
  assert.equal(await installerPublished('u', fake(404)), false);
});

console.log(`\n${passed} pruebas de la versión web superadas.`);
