// Compila el ayudante nativo (electron/helper/SpiderPdfHelper.cs) con el csc.exe de .NET Framework 4.8, que trae
// Windows: sin SDK ni dependencias. Salida: build/helper/SpiderPdfHelper.exe (electron-builder lo copia a
// resources/helper/). Solo en Windows; en otro sistema no hace nada. Se ejecuta antes de empaquetar y de las e2e.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') process.exit(0);

const root = path.resolve(__dirname, '..', '..');
const src = path.join(root, 'electron', 'helper', 'SpiderPdfHelper.cs');
const out = path.join(__dirname, 'SpiderPdfHelper.exe');
const icon = path.join(root, 'build', 'icon.ico');
const windir = process.env.WINDIR || 'C:\\Windows';
const csc = ['Framework64', 'Framework'].map((f) => path.join(windir, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')).find((p) => fs.existsSync(p));
if (!csc) { console.error('No se encontró csc.exe de .NET Framework 4.8.'); process.exit(1); }

// Sin cambios en el código: no se recompila.
if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs && !process.argv.includes('--force')) process.exit(0);

const args = ['/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', `/out:${out}`,
  '/r:System.Windows.Forms.dll', ...(fs.existsSync(icon) ? [`/win32icon:${icon}`] : []), src];
const r = spawnSync(csc, args, { stdio: 'inherit' });
if (r.status !== 0) { console.error('No se pudo compilar el ayudante.'); process.exit(r.status ?? 1); }
console.log(`Ayudante compilado: ${path.relative(root, out)}`);
