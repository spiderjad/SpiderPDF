// npm run web:deploy: compila la versión web (npm run web:build → dist-web/) y la sube por FTP a Hostinger
// (https://pdf.spiderjad.com). Ver docs/publicar-version.md («La web»).
//
// Antes de subir nada comprueba que el instalador de ESTA versión ya está publicado en GitHub: el botón «Descargar
// para Windows» de la web enlaza a él (src/site.js), y la web y el .exe tienen que ir a la par.
// Sube con curl (viene con Windows 10/11) por FTPS (FTP con TLS), primero todo menos index.html y al final index.html:
// mientras dura, la web sigue funcionando con la versión anterior. Los archivos antiguos de assets/ no se borran
// (los nombres llevan huella; no molestan).
//
// Datos (variables de entorno; la contraseña nunca en archivos ni en la línea de órdenes: curl la recibe por stdin):
//   SPIDERPDF_FTP_HOST      servidor (p. ej. ftp.spiderjad.com)
//   SPIDERPDF_FTP_USER      usuario FTP
//   SPIDERPDF_FTP_PASSWORD  contraseña
//   SPIDERPDF_FTP_DIR       carpeta de la web en el servidor (p. ej. /domains/spiderjad.com/public_html/pdf)
//   SPIDERPDF_FTP_PLAIN=1   solo si el servidor no admite TLS (la contraseña viajaría sin cifrar)
// Opciones: --dry-run (lista lo que subiría, sin conectar ni comprobar GitHub).
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist-web');

/** Archivos de dir (rutas relativas con /), index.html al final. */
function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  walk(dir, '');
  const last = out.filter((f) => f === 'index.html');
  return [...out.filter((f) => f !== 'index.html').sort(), ...last];
}

/** URL FTP de un archivo: carpeta remota + ruta relativa, cada trozo codificado. */
function remoteUrl(host, dir, rel) {
  const parts = [...String(dir || '/').split('/'), ...rel.split('/')].filter(Boolean).map(encodeURIComponent);
  return `ftp://${host}/${parts.join('/')}`;
}

/** Texto entre comillas para un archivo de configuración de curl. */
const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Configuración de curl (se le pasa por stdin con -K -): credenciales y un par upload-file/url por archivo. */
function curlConfig({ host, user, password, dir, plain }, files, localDir) {
  const lines = [`user = ${quote(`${user}:${password}`)}`, 'ftp-create-dirs', 'fail', 'show-error', 'silent', 'disable-epsv'];
  if (!plain) lines.push('ssl-reqd');
  for (const rel of files) {
    lines.push(`upload-file = ${quote(path.join(localDir, ...rel.split('/')))}`);
    lines.push(`url = ${quote(remoteUrl(host, dir, rel))}`);
  }
  return `${lines.join('\n')}\n`;
}

/** ¿Está publicado el instalador de esa versión? (GitHub responde 302 a la descarga si existe; 404 si es borrador). */
async function installerPublished(url, f = fetch) {
  const r = await f(url, { method: 'HEAD', redirect: 'manual' });
  return r.status === 302 || r.status === 200;
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const { installerUrl } = await import('../src/site.js');
  const url = installerUrl(pkg.version);

  const env = process.env;
  const cfg = { host: env.SPIDERPDF_FTP_HOST, user: env.SPIDERPDF_FTP_USER, password: env.SPIDERPDF_FTP_PASSWORD, dir: env.SPIDERPDF_FTP_DIR, plain: env.SPIDERPDF_FTP_PLAIN === '1' };
  if (!dry) {
    const missing = ['HOST', 'USER', 'PASSWORD', 'DIR'].filter((k) => !env[`SPIDERPDF_FTP_${k}`]);
    if (missing.length) throw new Error(`Faltan variables: ${missing.map((k) => `SPIDERPDF_FTP_${k}`).join(', ')}. Ver docs/publicar-version.md.`);
    if (!(await installerPublished(url))) {
      throw new Error(`El instalador de la ${pkg.version} no está publicado en GitHub (${url}).\n`
        + 'Publica antes la release (npm run release:win y «Publish release»): la web enlaza a ese .exe.');
    }
    console.log(`Instalador publicado: ${url}`);
  }

  const b = spawnSync('npx', ['vite', 'build', '--mode', 'web'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (b.status !== 0) throw new Error('No se pudo compilar la web.');
  const files = listFiles(OUT);
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  if (!html.includes('rel="canonical"')) throw new Error('dist-web/index.html sin las etiquetas de la web: ¿se compiló con --mode web?');

  if (dry) {
    console.log(`\nSubiría ${files.length} archivos${cfg.host && cfg.dir ? ` a ${remoteUrl(cfg.host, cfg.dir, '')}` : ''}:`);
    for (const f of files) console.log(`  ${f}`);
    return;
  }
  const index = files.length - 1; // index.html, el último: la web cambia de versión de golpe
  for (const [label, part] of [['archivos', files.slice(0, index)], ['index.html', files.slice(index)]]) {
    console.log(`Subiendo ${part.length} ${label}…`);
    const r = spawnSync('curl', ['-K', '-'], { input: curlConfig(cfg, part, OUT), stdio: ['pipe', 'inherit', 'inherit'] });
    if (r.status !== 0) throw new Error(`curl falló (código ${r.status}). La web sigue con la versión anterior${label === 'index.html' ? ' salvo los archivos nuevos' : ''}.`);
  }
  console.log(`\nListo: https://pdf.spiderjad.com (versión ${pkg.version}).`);
}

if (require.main === module) main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });

module.exports = { listFiles, remoteUrl, curlConfig, installerPublished };
