// Compila los programas nativos de Windows con el csc.exe de .NET Framework 4.8, que trae Windows: sin SDK ni
// dependencias. Solo en Windows; en otro sistema no hace nada. Se ejecuta antes de empaquetar y de las e2e.
//   electron/helper/SpiderPdfHelper.cs → build/helper/SpiderPdfHelper.exe (ayudante; va a resources/helper/)
//   electron/helper/SpiderPdfCli.cs    → build/helper/SpiderPDF.com (lanzador de consola; va junto a SpiderPDF.exe)
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') process.exit(0);

const root = path.resolve(__dirname, '..', '..');
const icon = path.join(root, 'build', 'icon.ico');
const windir = process.env.WINDIR || 'C:\\Windows';
const csc = ['Framework64', 'Framework'].map((f) => path.join(windir, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')).find((p) => fs.existsSync(p));
if (!csc) { console.error('No se encontró csc.exe de .NET Framework 4.8.'); process.exit(1); }

const TARGETS = [
  { src: 'SpiderPdfHelper.cs', out: 'SpiderPdfHelper.exe', kind: 'winexe', refs: ['/r:System.Windows.Forms.dll'] },
  { src: 'SpiderPdfCli.cs', out: 'SpiderPDF.com', kind: 'exe', refs: [] },
];

for (const t of TARGETS) {
  const src = path.join(root, 'electron', 'helper', t.src);
  const out = path.join(__dirname, t.out);
  // Sin cambios en el código: no se recompila.
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs && !process.argv.includes('--force')) continue;
  const args = ['/nologo', `/target:${t.kind}`, '/optimize+', '/platform:anycpu', `/out:${out}`,
    ...t.refs, ...(fs.existsSync(icon) ? [`/win32icon:${icon}`] : []), src];
  const r = spawnSync(csc, args, { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`No se pudo compilar ${t.src}.`); process.exit(r.status ?? 1); }
  console.log(`Compilado: ${path.relative(root, out)}`);
}
