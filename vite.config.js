import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const require = createRequire(import.meta.url);
const PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// OCR (Tesseract.js, Apache 2.0): el worker, el núcleo WebAssembly (SIMD, solo LSTM) y los idiomas van dentro de la
// app con nombre fijo en ocr/ (Tesseract pide «<langPath>/<idioma>.traineddata.gz»). Nada se descarga al usarlo.
// Los datos de idioma son tessdata «best_int» (Apache 2.0) de los paquetes @tesseract.js-data.
export const OCR_FILES = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'spa.traineddata.gz': '@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz',
  'cat.traineddata.gz': '@tesseract.js-data/cat/4.0.0_best_int/cat.traineddata.gz',
  'eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
const ocrSource = (name) => readFileSync(require.resolve(OCR_FILES[name]));

function ocrAssets() {
  return {
    name: 'spiderpdf-ocr-assets',
    configureServer(server) {
      server.middlewares.use('/ocr/', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0]);
        if (!OCR_FILES[name]) return next();
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(ocrSource(name));
      });
    },
    generateBundle() {
      for (const name of Object.keys(OCR_FILES)) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: ocrSource(name) });
    },
  };
}

// Versión web (https://pdf.spiderjad.com, «vite build --mode web» = npm run web:build → dist-web/, se sube por FTP con
// npm run web:deploy): la misma interfaz, con lo que necesita una página pública (descripción para buscadores, Open
// Graph, iconos, robots.txt y sitemap.xml) y, en la app, «Descargar para Windows» (__WEB__). Los archivos fijos están
// en web/public; el <head> y el sitemap se generan aquí. La app de escritorio no lleva nada de esto.
export const SITE = 'https://pdf.spiderjad.com/';
const WEB_DESCRIPTION = 'Editor de PDF online y gratuito: une, ordena, gira y divide páginas, anota, firma, rellena formularios, '
  + 'edita texto, censura, reconoce texto (OCR) y exporta a Word y Excel. Todo se procesa en tu navegador, sin subir '
  + 'tus archivos a ningún servidor. También para Windows.';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function webSite() {
  const ld = {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: 'SpiderPDF', url: SITE,
    applicationCategory: 'BusinessApplication', operatingSystem: 'Web, Windows', inLanguage: ['es', 'en', 'ca'],
    softwareVersion: PKG.version, description: WEB_DESCRIPTION, offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
  };
  return {
    name: 'spiderpdf-web-site',
    transformIndexHtml(html) {
      const head = [
        '<link rel="icon" href="/favicon.ico" sizes="any" />',
        '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
        '<meta name="theme-color" content="#6A35E8" />',
        `<meta name="description" content="${esc(WEB_DESCRIPTION)}" />`,
        `<link rel="canonical" href="${SITE}" />`,
        '<meta property="og:type" content="website" />',
        '<meta property="og:site_name" content="SpiderPDF" />',
        '<meta property="og:title" content="SpiderPDF · Editor de PDF online" />',
        `<meta property="og:description" content="${esc(WEB_DESCRIPTION)}" />`,
        `<meta property="og:url" content="${SITE}" />`,
        `<meta property="og:image" content="${SITE}og-image.png" />`,
        '<meta property="og:locale" content="es_ES" />',
        '<meta name="twitter:card" content="summary" />',
        `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
      ].map((l) => `    ${l}`).join('\n');
      return html
        .replace('<title>SpiderPDF</title>', '<title>SpiderPDF · Editor de PDF online, privado y gratuito</title>')
        .replace('</head>', `${head}\n  </head>`);
    },
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      const sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        `  <url>\n    <loc>${SITE}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`,
        '</urlset>',
        '',
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ocrAssets(), ...(mode === 'web' ? [webSite()] : [])],
  define: { __APP_VERSION__: JSON.stringify(PKG.version), __WEB__: JSON.stringify(mode === 'web') },
  publicDir: mode === 'web' ? 'web/public' : false,
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@embedpdf/pdfium'] },
  server: { port: 5173, strictPort: true },
  build: { target: 'chrome130', outDir: mode === 'web' ? 'dist-web' : 'dist', emptyOutDir: true },
}));
