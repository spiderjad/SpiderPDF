// Publicar una versión (build/release.cjs): el borrador se crea antes de subir, y no se pisa una ya publicada.
// Con un fetch simulado (no toca GitHub).  Ejecutar: node test/release.test.js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prepareDraft } = require('../build/release.cjs');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok -', name); };

/** GitHub simulado: devuelve estas releases y apunta las llamadas. */
function fakeGitHub(releases) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push([opts.method ?? 'GET', url.replace('https://api.github.com', ''), opts.body ? JSON.parse(opts.body) : null, opts.headers.Authorization]);
    const body = opts.method === 'POST' ? { id: 7, html_url: 'https://github.com/x/y/releases/7' } : releases;
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  return { fetch, calls };
}
const base = { owner: 'spiderjad', repo: 'SpiderPDF', version: '0.3.0', token: 'tok' };

await t('sin release de esa versión: crea el borrador (no pre-release) antes de subir nada', async () => {
  const gh = fakeGitHub([{ id: 1, tag_name: 'v0.2.0', draft: false }]);
  const r = await prepareDraft({ ...base, fetch: gh.fetch });
  assert.deepEqual(r, { id: 7, html_url: 'https://github.com/x/y/releases/7', created: true });
  assert.deepEqual(gh.calls, [
    ['GET', '/repos/spiderjad/SpiderPDF/releases?per_page=100', null, 'Bearer tok'],
    ['POST', '/repos/spiderjad/SpiderPDF/releases', { tag_name: 'v0.3.0', name: 'SpiderPDF 0.3.0', draft: true, prerelease: false }, 'Bearer tok'],
  ]);
});

await t('si ya hay un borrador de esa versión, se usa ese (no se crea otro)', async () => {
  const gh = fakeGitHub([{ id: 5, tag_name: 'v0.3.0', draft: true, html_url: 'u' }]);
  assert.deepEqual(await prepareDraft({ ...base, fetch: gh.fetch }), { id: 5, html_url: 'u', created: false });
  assert.equal(gh.calls.length, 1);
});

await t('si esa versión ya está publicada: error (hay que subir la versión)', async () => {
  const gh = fakeGitHub([{ id: 5, tag_name: 'v0.3.0', draft: false }]);
  await assert.rejects(prepareDraft({ ...base, fetch: gh.fetch }), /ya está publicada/);
});

await t('un error de GitHub se explica (código y respuesta)', async () => {
  const fetch = async () => ({ ok: false, status: 401, text: async () => 'Bad credentials' });
  await assert.rejects(prepareDraft({ ...base, fetch }), /401.*Bad credentials/);
});

console.log(`\n${passed} pruebas de publicar versiones superadas.`);
