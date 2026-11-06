// Integridad de firmas digitales (electron/sigverify.cjs, proceso principal).  Ejecutar: node test/sigverify.test.js
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { init } from '@embedpdf/pdfium';
import { PdfCore } from '../src/engine/pdfium-core.js';
import { contrato } from './make-fixtures.js';
import { signPdf, selfSignedCert, addSignatureIncremental } from './sign-pdf.js';
import { worstStatus } from '../src/signed.js';

const require = createRequire(import.meta.url);
const { verifyPdfSignatures, pdfDate } = require('../electron/sigverify.cjs');
const pdfium = await init({ wasmBinary: await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
pdfium.PDFiumExt_Init();
const core = new PdfCore(pdfium);

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };
const one = (bytes) => { const r = verifyPdfSignatures(bytes); assert.equal(r.length, 1, JSON.stringify(r)); return r[0]; };

const orig = new Uint8Array(await readFile('test/fixtures/firmado.pdf'));

t('firmado.pdf intacto: verifica, con el nombre del certificado y la fecha de firma', () => {
  const s = one(orig);
  assert.equal(s.status, 'intact', s.reason);
  assert.equal(s.name, 'Firma de prueba');
  assert.ok(Math.abs(Date.parse(s.date) - Date.now()) < 400 * 86400000, s.date);
  assert.equal(s.subFilter, 'adbe.pkcs7.detached');
});

t('copia con un byte cambiado dentro de lo firmado: rota (el resumen no coincide)', () => {
  const b = orig.slice();
  b[300] ^= 1;
  const s = one(b);
  assert.equal(s.status, 'broken');
  assert.match(s.reason, /resumen/);
});

t('copia guardada con reescritura completa (reordenar): rota (el ByteRange ya no cuadra)', () => {
  const S = core.open(orig);
  const out = core.compose(S.pages.map((_, i) => ({ docId: S.docId, index: i, rot: 0 })).reverse());
  core.close(S.docId);
  const s = one(out);
  assert.equal(s.status, 'broken');
});

t('copia con guardado incremental (una nota): intacta, con cambios después de firmar', () => {
  const S = core.open(orig);
  const out = core.compose(S.pages.map((_, i) => ({ docId: S.docId, index: i, rot: 0, annots: i === 1 ? [{ type: 'note', at: [0.5, 0.5], text: 'Visto' }] : undefined })));
  core.close(S.docId);
  assert.equal(core.incremental, true);
  const s = one(out);
  assert.equal(s.status, 'modified', s.reason);
  assert.equal(s.name, 'Firma de prueba');
});

const plain = await contrato();

{
  const s = one(await signPdf(plain, undefined, { corrupt: true }));
  t('firma criptográfica corrupta (el resumen sí coincide): rota, no verifica con la clave del certificado', () => {
    assert.equal(s.status, 'broken');
    assert.match(s.reason, /no verifica/);
  });
}
{
  const s = one(await signPdf(plain, selfSignedCert('Diego Pennisi Ñandú', { ec: true })));
  t('certificado ECDSA P-256 y nombre con caracteres españoles: verifica', () => {
    assert.equal(s.status, 'intact', s.reason);
    assert.equal(s.name, 'Diego Pennisi Ñandú');
  });
}
{
  const s = one(await signPdf(plain, undefined, { mdp: 2 }));
  t('firma de certificación (DocMDP): también verifica', () => assert.equal(s.status, 'intact', s.reason));
}

{
  const two = await addSignatureIncremental(orig);
  const sigs = verifyPdfSignatures(two);
  t('dos firmas, la segunda añadida en incremental: PDFium las cuenta y el original queda intacto', () => {
    assert.ok(Buffer.from(two.subarray(0, orig.length)).equals(Buffer.from(orig)));
    const D = core.open(two);
    assert.equal(D.signed, 2);
    assert.equal(D.pages.length, 5);
    core.close(D.docId);
  });
  t('  · la primera: intacta con cambios después (la segunda firma); la segunda: intacta', () => {
    assert.deepEqual(sigs.map((s) => [s.name, s.status]), [['Firma de prueba', 'modified'], ['Segundo firmante', 'intact']]);
    assert.equal(worstStatus(sigs), 'modified');
  });
  const bad = verifyPdfSignatures(await addSignatureIncremental(orig, undefined, { corrupt: true }));
  t('  · si la segunda está corrupta, el peor estado es «rota»', () => {
    assert.deepEqual(bad.map((s) => s.status), ['modified', 'broken']);
    assert.equal(worstStatus(bad), 'broken');
  });
}

t('un PDF sin firmas no devuelve ninguna', () => assert.deepEqual(verifyPdfSignatures(plain), []));

t('basura en lugar de la firma: «no se pudo comprobar», sin excepción', () => {
  const b = Buffer.from(orig);
  const [, bb] = one(orig).byteRange;
  b.write('3082FFFF', bb + 1, 'latin1'); // cabecera ASN.1 con una longitud imposible
  const s = one(b);
  assert.ok(s.status === 'unknown' || s.status === 'broken', s.status);
});

t('fechas PDF con zona horaria', () => {
  assert.equal(pdfDate("D:20261104153000+01'00'"), '2026-11-04T14:30:00.000Z');
  assert.equal(pdfDate('D:20261104'), '2026-11-04T00:00:00.000Z');
});

console.log(`\n${passed} pruebas de integridad de firmas superadas.`);
