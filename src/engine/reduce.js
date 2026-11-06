// «Reducir tamaño» completo, sobre los bytes de un PDF (ya compuesto con los cambios del documento). Sin DOM: el worker
// pasa su codificador JPEG (OffscreenCanvas) y las pruebas el de jpeg-js.
//   1. PDFium: reduce y recomprime las imágenes que pasan de la resolución del nivel (PdfCore.reduceImages).
//   2. qpdf: reescribe sin objetos sueltos (las imágenes originales), con flujos de objetos y Flate al máximo (sin
//      pérdida). Si el PDF está protegido, qpdf conserva la misma protección (le basta la contraseña con que se abrió).
import { REDUCE_LEVELS } from '../reduce.js';

export const QPDF_OPTIMIZE = ['--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9'];

/**
 * passwords: las que se prueban para abrir (la primera que valga). → { bytes, images, reduced }
 * Si el resultado no es más pequeño, devuelve los bytes de entrada.
 */
export async function reducePdf(core, bytes, { level = 'balanced', passwords = [''], encode, qpdf, onProgress, isCancelled }) {
  let doc = null;
  let pw = '';
  for (const p of passwords) {
    try { doc = core.open(bytes, p); pw = p; break; } catch (e) { if (!e.needsPassword) throw e; }
  }
  if (!doc) throw new Error('No se pudo abrir el PDF para reducirlo.');
  try {
    const entry = core.entry(doc.docId);
    const r = await core.reduceImages(entry, REDUCE_LEVELS[level], encode, { onProgress, isCancelled });
    const withImages = r.reduced ? core.save(entry.handle) : bytes;
    onProgress?.({ phase: 'optimize', done: 0, total: 1 });
    const out = await qpdf.run([...(pw ? [`--password=${pw}`] : []), ...QPDF_OPTIMIZE, '/in.pdf', '/out.pdf'], { 'in.pdf': withImages }, 'out.pdf');
    return { bytes: out.length < bytes.length ? out : bytes, images: r.images, reduced: r.reduced };
  } finally {
    core.close(doc.docId);
  }
}
