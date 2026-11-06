import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const require = createRequire(import.meta.url);

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

export default defineConfig({
  plugins: [react(), tailwindcss(), ocrAssets()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@embedpdf/pdfium'] },
  server: { port: 5173, strictPort: true },
  build: { target: 'chrome130', outDir: 'dist', emptyOutDir: true },
});
