// npm run release:win (después de compilar la interfaz y el ayudante): sube la versión de package.json a un BORRADOR de
// release en GitHub (instalador, .blockmap y latest.yml). Las copias instaladas no la ven hasta que Diego la publica.
// Necesita GH_TOKEN (con la sesión de GitHub CLI: $env:GH_TOKEN = (gh auth token)). Ver docs/publicar-version.md.
//
// Por qué no basta con «electron-builder --publish always»: si la release aún no existe, sube los archivos a la vez y
// a veces crea DOS borradores y los reparte (pasó con la 0.2.0). Aquí se crea antes el borrador y electron-builder sube
// a ese. Lo de la API de GitHub va en prepareDraft (probado con un fetch simulado en test/release.test.js).
// El texto de la release (lo que se ve en la página de descarga) es la sección de la versión en docs/novedades.md.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

/** Sección «## <versión>» de docs/novedades.md (sin el título), o null si no está. */
function notesFor(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim() || null;
}

/**
 * Borrador de la release de esa versión: el que ya hay, o uno nuevo. Si ya está publicada, error (hay que subir la
 * versión: las copias instaladas solo se actualizan a una mayor). → { id, html_url, created }
 */
async function prepareDraft({ owner, repo, version, token, body = null, fetch: f = fetch }) {
  const tag = `v${version}`;
  const api = async (url, opts = {}) => {
    const r = await f(`https://api.github.com/repos/${owner}/${repo}${url}`, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'spiderpdf-release', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!r.ok) throw new Error(`GitHub respondió ${r.status} a ${opts.method ?? 'GET'} ${url}: ${await r.text()}`);
    return r.json();
  };
  const existing = (await api('/releases?per_page=100')).find((r) => r.tag_name === tag);
  if (existing && !existing.draft) throw new Error(`La ${tag} ya está publicada. Sube «version» en package.json antes de publicar otra.`);
  if (existing) {
    // Con tag_name: un borrador cuya etiqueta aún no existe la pierde («untagged-…») si se edita sin ella.
    if (body != null) await api(`/releases/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ tag_name: tag, body }) });
    return { id: existing.id, html_url: existing.html_url, created: false };
  }
  const made = await api('/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, name: `SpiderPDF ${version}`, draft: true, prerelease: false, ...(body != null ? { body } : {}) }) });
  return { id: made.id, html_url: made.html_url, created: true };
}

async function main() {
  const root = path.join(__dirname, '..');
  const pkg = require(path.join(root, 'package.json'));
  const { owner, repo } = pkg.build.publish.find((p) => p.provider === 'github');
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('Falta GH_TOKEN. En PowerShell: $env:GH_TOKEN = (gh auth token)');
  const body = notesFor(fs.readFileSync(path.join(root, 'docs', 'novedades.md'), 'utf8'), pkg.version);
  if (!body) throw new Error(`Falta la sección «## ${pkg.version}» en docs/novedades.md (es el texto de la página de descarga).`);
  const draft = await prepareDraft({ owner, repo, version: pkg.version, token, body });
  console.log(`${draft.created ? 'Borrador creado' : 'Borrador existente'}: v${pkg.version}`);
  const r = spawnSync('npx', ['electron-builder', '--win', '--publish', 'always'], { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error('electron-builder falló');
  console.log(`\nListo. Pruébalo y publícalo (sin marcar «pre-release»): https://github.com/${owner}/${repo}/releases`);
}

if (require.main === module) main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });

module.exports = { prepareDraft, notesFor };
