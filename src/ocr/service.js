// Tesseract.js en la interfaz: su propio Web Worker con el núcleo WebAssembly y los idiomas que lleva la app (ocr/,
// ver OCR_FILES en vite.config.js). Nunca se descarga nada: todas las rutas son locales y la CSP (connect-src
// 'self') lo impediría de todos modos. Sin caché en IndexedDB (cacheMethod: 'none'): los datos ya están en la app.
import { createWorker } from 'tesseract.js';

export { OCR_LANGS } from './langs.js';

const asset = (name) => new URL(`ocr/${name}`, document.baseURI).href;

/**
 * Crea un reconocedor para esos idiomas. → { recognize(pgm) → datos con blocks, terminate() }.
 * Tarda un par de segundos la primera vez (carga el núcleo y los idiomas); se reutiliza para todas las páginas.
 */
export async function createRecognizer(langs) {
  const worker = await createWorker(langs, 1 /* OEM.LSTM_ONLY */, {
    workerPath: asset('worker.min.js'),
    corePath: asset('tesseract-core-simd-lstm.wasm.js'),
    langPath: asset('').replace(/\/$/, ''),
    workerBlobURL: false,
    cacheMethod: 'none',
    gzip: true,
  });
  return {
    recognize: async (pgm) => (await worker.recognize(pgm, {}, { blocks: true, text: false })).data,
    terminate: () => worker.terminate(),
  };
}
