// Compartir: plan (qué se comparte, el original tal cual o una copia, avisos), textos y nombre seguro.  npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sharePlan, shareName, shareResult } from '../src/share.js';
import { normalizePrefs, outputFolder, NAME_MAX } from '../src/prefs.js';

const require = createRequire(import.meta.url);
const { safeName, createShare } = require('../electron/share.cjs');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

const page = (key, docId, index, annots = []) => ({ key, docId, index, annots });
const base = {
  file: { path: 'C:\docs\contrato.pdf', name: 'contrato.pdf' },
  sources: [{ docId: 1, name: 'contrato', pageCount: 3, signed: 0 }],
  pages: [page('a', 1, 0), page('b', 1, 1), page('c', 1, 2)],
  selected: new Set(['b']),
  dirty: false,
  security: null,
};

t('sin cambios, todo y sin limpiar: se comparte el archivo tal cual', () => {
  const p = sharePlan(base, { scope: 'all' });
  assert.equal(p.original, true);
  assert.equal(p.pages.length, 3);
  assert.deepEqual(p.notices, []);
});

t('con cambios, la selección, «quitar información oculta» o una contraseña nueva: una copia compuesta', () => {
  assert.equal(sharePlan({ ...base, dirty: true }, {}).original, false);
  const sel = sharePlan(base, { scope: 'selection' });
  assert.deepEqual([sel.original, sel.pages.map((p) => p.key)], [false, ['b']]);
  assert.equal(sharePlan(base, { hidden: true }).original, false);
  assert.equal(sharePlan({ ...base, security: { kind: 'remove' } }, {}).original, false);
  assert.equal(sharePlan({ ...base, file: null }, {}).original, false);
});

t('avisos: redacción, firma digital (intacta o no) y contraseña', () => {
  const red = { ...base, dirty: true, pages: [page('a', 1, 0, [{ type: 'redact' }]), page('b', 1, 1), page('c', 1, 2)] };
  assert.match(sharePlan(red, {}).notices[0].text, /zonas a redactar/);
  const signed = { ...base, sources: [{ ...base.sources[0], signed: 1 }] };
  assert.deepEqual(sharePlan(signed, {}).notices, [], 'el original tal cual: la firma sigue');
  assert.match(sharePlan({ ...signed, dirty: true }, {}).notices[0].text, /revisión nueva/); // anotar: incremental
  assert.equal(sharePlan(signed, { scope: 'selection' }).notices[0].tone, 'danger'); // faltan páginas
  assert.equal(sharePlan({ ...signed, dirty: true }, { hidden: true }).notices[0].tone, 'danger');
  assert.match(sharePlan(base, {}, { protectedNow: true }).notices[0].text, /contraseña/);
});

t('textos del resultado: WhatsApp (escritorio y web), correo (cancelado, sin cliente), copiar y carpeta', () => {
  assert.equal(shareResult('whatsapp', { ok: true, desktop: true, copied: true }).text, 'WhatsApp está abierto. Elige el chat y pega con Ctrl+V.');
  assert.match(shareResult('whatsapp', { ok: true, desktop: false }).text, /WhatsApp Web.*Arrastra el archivo/);
  assert.equal(shareResult('whatsapp', { ok: true, desktop: true, copied: false }).ok, false);
  assert.equal(shareResult('mail', { ok: true }).ok, true);
  assert.equal(shareResult('mail', { ok: false, code: 'cancelado' }).text, 'Se canceló el correo.');
  assert.match(shareResult('mail', { ok: false, code: 'sin-cliente' }).text, /Outlook nuevo.*Copiar archivo/);
  assert.match(shareResult('copy', { ok: true }).text, /Ctrl\+V/);
  assert.equal(shareResult('copy', { ok: false, message: 'x' }).text, 'x');
  assert.equal(shareResult('reveal', { ok: true }).text, 'Se abrió la carpeta con el PDF.');
});

t('nombres: el del documento; seguros para Windows (sin rutas, reservados ni caracteres prohibidos)', () => {
  assert.equal(shareName('contrato.pdf'), 'contrato.pdf');
  assert.equal(shareName(null), 'documento.pdf');
  assert.equal(safeName(String.raw`..\..\Windows\system32\x`), 'x.pdf');
  assert.equal(safeName('../../etc/y.pdf'), 'y.pdf');
  assert.equal(safeName('b:c*?"<>|d.PDF'), 'b c d.pdf');
  assert.equal(safeName('CON'), 'CON_.pdf');
  assert.equal(safeName('   '), 'documento.pdf');
  assert.equal(safeName('Año € ñ'), 'Año € ñ.pdf');
});

t('Enviar a IA: textos según app o web, y si se copió', () => {
  assert.equal(shareResult('ai', { ok: true, desktop: true, copied: true, provider: 'claude' }).text, 'Claude está abierto. Pega con Ctrl+V y escribe tu pregunta.');
  assert.equal(shareResult('ai', { ok: true, desktop: false, copied: true, provider: 'chatgpt' }).text, 'Se abrió ChatGPT en el navegador. Pega con Ctrl+V y escribe tu pregunta.');
  assert.equal(shareResult('ai', { ok: true, desktop: true, copied: false, provider: 'claude' }).ok, false);
});

t('preferencias: por defecto Claude; solo valores conocidos', () => {
  const D = { ai: 'claude', userName: '', outputDir: '', quality: 'balanced', lang: 'auto', restoreTabs: false, autoUpdate: true };
  assert.deepEqual(normalizePrefs({}), D);
  assert.deepEqual(normalizePrefs({ ai: 'chatgpt' }), { ...D, ai: 'chatgpt' });
  assert.deepEqual(normalizePrefs({ ai: 'https://malo', extra: 1 }), D);
  assert.deepEqual(normalizePrefs(null), D);
});

t('preferencias: nombre, carpeta de salida y calidad de compresión', () => {
  const p = normalizePrefs({ userName: '  Diego Pennisi\n', outputDir: 'C:\\Users\\Diego\\Documentos\\PDF', quality: 'small' });
  assert.equal(p.userName, 'Diego Pennisi');
  assert.equal(p.outputDir, 'C:\\Users\\Diego\\Documentos\\PDF');
  assert.equal(p.quality, 'small');
  assert.equal(normalizePrefs({ userName: 'x'.repeat(200) }).userName.length, NAME_MAX);
  assert.equal(normalizePrefs({ userName: 42, outputDir: {}, quality: 'máxima' }).quality, 'balanced');
  assert.equal(normalizePrefs({ quality: 'toString' }).quality, 'balanced', 'solo claves propias de REDUCE_LEVELS');
  assert.equal(normalizePrefs({ lang: 'ca' }).lang, 'ca');
  assert.equal(normalizePrefs({ lang: 'fr' }).lang, 'auto');
  // Recordar las pestañas: solo con true de verdad (desactivado por defecto).
  assert.equal(normalizePrefs({ restoreTabs: true }).restoreTabs, true);
  assert.equal(normalizePrefs({ restoreTabs: 'sí' }).restoreTabs, false);
  // Buscar actualizaciones: activado salvo que se desactive.
  assert.equal(normalizePrefs({ autoUpdate: false }).autoUpdate, false);
  assert.equal(normalizePrefs({ autoUpdate: 'no' }).autoUpdate, true);
  // Carpeta para un archivo nuevo: la de salida o, si no hay, la del original.
  assert.equal(outputFolder({ outputDir: 'D:\\Salida' }, 'C:\\Docs'), 'D:\\Salida');
  assert.equal(outputFolder({ outputDir: '' }, 'C:\\Docs'), 'C:\\Docs');
});

// macOS (simulado: el portapapeles, el menú Compartir y `open` de Electron/macOS se sustituyen).
const macShare = async ({ mailApp = 'Mail' } = {}) => {
  const calls = [];
  const share = createShare({
    platform: 'darwin',
    app: { isPackaged: false, getApplicationNameForProtocol: (u) => (u === 'mailto:' ? mailApp : '') },
    shell: { openExternal: async (u) => calls.push(['open', u]), showItemInFolder: (p) => calls.push(['reveal', p]) },
    clipboard: { writeBuffer: (type, buf) => calls.push(['clip', type, buf.toString()]) },
    ShareMenu: class { constructor(o) { calls.push(['menu', o.filePaths]); } popup(o) { calls.push(['popup', !!o.window]); } },
    run: async (cmd, args) => { calls.push(['run', cmd, ...args]); return { ok: true }; },
  });
  const { id, name } = await share.prepare({ bytes: new Uint8Array([37, 80, 68, 70]), name: 'Factura & cía' });
  return { share, id, name, calls, cleanup: () => share.cleanup() };
};

const pending = [];
const ta = (name, fn) => pending.push([name, fn]);

ta('macOS: «Copiar archivo» pone el PDF en el portapapeles como archivo (como el Finder), sin el ayudante', async () => {
  const { share, id, calls, cleanup } = await macShare();
  try {
    assert.deepEqual(await share.copyFile(id), { ok: true });
    const [plist, url] = calls.filter((c) => c[0] === 'clip');
    assert.equal(plist[1], 'NSFilenamesPboardType');
    assert.match(plist[2], /<string>.*Factura &amp; cía\.pdf<\/string>/);
    assert.equal(url[1], 'public.file-url');
    assert.match(url[2], /^file:\/\/.*Factura%20&%20c%C3%ADa\.pdf$/);
  } finally { cleanup(); }
});

ta('macOS: «Correo» abre el programa de correo predeterminado con el PDF adjunto; sin programa, «sin-cliente»', async () => {
  const a = await macShare({ mailApp: '/Applications/Microsoft Outlook.app' });
  try {
    assert.deepEqual(await a.share.mail(a.id, 'Factura'), { ok: true });
    const run = a.calls.find((c) => c[0] === 'run');
    assert.deepEqual(run.slice(1, 4), ['open', '-a', 'Microsoft Outlook']);
    assert.match(run[4], /Factura & cía\.pdf$/);
  } finally { a.cleanup(); }
  const b = await macShare({ mailApp: '' });
  try { assert.equal((await b.share.mail(b.id)).code, 'sin-cliente'); } finally { b.cleanup(); }
});

ta('macOS: «Más opciones» abre el menú Compartir del sistema con el PDF; WhatsApp copia sin el ayudante', async () => {
  const { share, id, calls, cleanup } = await macShare();
  try {
    assert.deepEqual(share.system(id, {}), { ok: true });
    assert.match(calls.find((c) => c[0] === 'menu')[1][0], /Factura & cía\.pdf$/);
    assert.deepEqual(calls.find((c) => c[0] === 'popup'), ['popup', true]);
    const w = await share.whatsapp(id);
    assert.equal(w.copied, true);
  } finally { cleanup(); }
  const win = createShare({ platform: 'win32', app: { isPackaged: false, getApplicationNameForProtocol: () => '' }, shell: {} });
  assert.equal(win.system('x').code, 'no-disponible', 'en Windows no existe');
  assert.deepEqual(shareResult('system', { ok: true }), { ok: true, text: 'Elige en el menú dónde compartirlo.' });
});

for (const [name, fn] of pending) { await fn(); passed++; console.log(`  ok - ${name}`); }

console.log(`\n${passed} pruebas superadas.`);
