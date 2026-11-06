// Genera los iconos de SpiderPDF a partir de los SVG de esta carpeta (npm run icons).
// Electron dibuja cada tamaño directamente desde el vector (sin reescalar un mapa de bits):
//   16-32 px  ← spiderpdf-icon-small.svg (trazos más gruesos, se leen a tamaño pequeño)
//   ≥ 48 px   ← spiderpdf-icon.svg
// Salidas: icon.ico (Windows: 16, 24, 32, 48, 64 y 256), icon.icns (macOS: 16 a 1024), icon.png (256, ventana en Linux)
// y spiderpdf-icon-1024.png (el SVG es la fuente; el PNG se rehace para que no quede desfasado).
// Los dibujos de partida que entregó Diego están en build/original/.
// Sin dependencias: ICO e ICNS llevan las imágenes en PNG (Windows Vista+ y macOS 10.7+ las admiten).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const svg = (name) => `data:image/svg+xml;base64,${fs.readFileSync(path.join(DIR, name)).toString('base64')}`;
const SMALL = svg('spiderpdf-icon-small.svg');
const NORMAL = svg('spiderpdf-icon.svg');
const source = (px) => (px <= 32 ? SMALL : NORMAL);

async function renderAll(win, sizes) {
  const out = new Map();
  for (const px of sizes) {
    const dataUrl = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image();
      img.src = ${JSON.stringify(source(px))};
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = ${px};
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, ${px}, ${px});
      return c.toDataURL('image/png');
    })()`);
    out.set(px, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  return out;
}

function ico(pngs) {
  const sizes = [...pngs.keys()];
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icono
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((px, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(px >= 256 ? 0 : px, e); // 0 = 256
    header.writeUInt8(px >= 256 ? 0 : px, e + 1);
    header.writeUInt16LE(1, e + 4); // planos
    header.writeUInt16LE(32, e + 6); // bits por píxel
    header.writeUInt32LE(pngs.get(px).length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs.get(px).length;
  });
  return Buffer.concat([header, ...sizes.map((px) => pngs.get(px))]);
}

// Tipos ICNS con PNG: icp4 16, icp5 32, icp6 64, ic07 128, ic08 256, ic09 512, ic10 1024 (512@2x),
// ic11 32 (16@2x), ic12 64 (32@2x), ic13 256 (128@2x), ic14 512 (256@2x).
const ICNS_TYPES = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];

function icns(pngs) {
  const chunks = ICNS_TYPES.map(([type, px]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(8 + pngs.get(px).length, 4);
    return Buffer.concat([head, pngs.get(px)]);
  });
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4);
  return Buffer.concat([head, ...chunks]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL('about:blank');
  const pngs = await renderAll(win, [16, 24, 32, 48, 64, 128, 256, 512, 1024]);
  const icoSizes = [16, 24, 32, 48, 64, 256];
  fs.writeFileSync(path.join(DIR, 'icon.ico'), ico(new Map(icoSizes.map((px) => [px, pngs.get(px)]))));
  fs.writeFileSync(path.join(DIR, 'icon.icns'), icns(pngs));
  fs.writeFileSync(path.join(DIR, 'icon.png'), pngs.get(256));
  fs.writeFileSync(path.join(DIR, 'spiderpdf-icon-1024.png'), pngs.get(1024));
  console.log(`icon.ico (${icoSizes.join(', ')}), icon.icns (16-1024), icon.png (256) en ${DIR}`);
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
