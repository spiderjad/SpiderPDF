// Firma digital de PRUEBA para los tests: certificado X.509 autofirmado y firma CMS
// (adbe.pkcs7.detached) hechos con node:crypto y ASN.1 escrito a mano, sin dependencias.
// Solo sirve para generar PDFs firmados de ejemplo; no es código del producto.
import crypto from 'node:crypto';
import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib';

// --- ASN.1 DER mínimo ------------------------------------------------------------
const lenBytes = (n) => {
  if (n < 128) return [n];
  const b = [];
  for (let x = n; x; x >>= 8) b.unshift(x & 255);
  return [0x80 | b.length, ...b];
};
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts.map((p) => Buffer.from(p)));
  return Buffer.concat([Buffer.from([tag, ...lenBytes(body.length)]), body]);
};
const seq = (...p) => tlv(0x30, ...p);
const set = (...p) => tlv(0x31, ...p);
const ctx = (n, ...p) => tlv(0xa0 + n, ...p);
const int = (v) => {
  let b = Buffer.isBuffer(v) ? v : Buffer.from(v.toString(16).padStart(2, '0').replace(/^(.(..)*)$/, '0$1'), 'hex');
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
};
const oid = (s) => {
  const a = s.split('.').map(Number);
  const out = [40 * a[0] + a[1]];
  for (const v of a.slice(2)) {
    const st = [v & 127];
    for (let x = v >> 7; x; x >>= 7) st.unshift((x & 127) | 128);
    out.push(...st);
  }
  return tlv(0x06, Buffer.from(out));
};
const NULL = Buffer.from([5, 0]);
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const utc = (d) => tlv(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`));
const octet = (b) => tlv(0x04, b);
const bits = (b) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));

const OID = {
  sha256WithRSA: '1.2.840.113549.1.1.11', ecdsaSha256: '1.2.840.10045.4.3.2', rsa: '1.2.840.113549.1.1.1', sha256: '2.16.840.1.101.3.4.2.1',
  data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5',
  cn: '2.5.4.3', o: '2.5.4.10',
};

/**
 * Certificado autofirmado (RSA 2048 o, con ec, ECDSA P-256; SHA-256), válido un año.
 * → { key, certDer, name, serial, ec }
 */
export function selfSignedCert(cn = 'Firma de prueba', { ec = false } = {}) {
  const { privateKey, publicKey } = ec
    ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const name = seq(set(seq(oid(OID.cn), utf8(cn))), set(seq(oid(OID.o), utf8('SpiderPDF (pruebas)'))));
  const serial = crypto.randomBytes(8);
  serial[0] &= 0x7f;
  const algo = ec ? seq(oid(OID.ecdsaSha256)) : seq(oid(OID.sha256WithRSA), NULL);
  const now = new Date();
  const tbs = seq(
    ctx(0, int(2)), int(serial), algo, name,
    seq(utc(new Date(now - 86400000)), utc(new Date(+now + 365 * 86400000))),
    name, publicKey.export({ type: 'spki', format: 'der' }),
  );
  const certDer = seq(tbs, algo, bits(crypto.sign('sha256', tbs, privateKey)));
  return { key: privateKey, certDer, name, serial, ec };
}

/** Firma CMS separada (detached) de un resumen SHA-256. corrupt: estropea el valor de la firma (no el resumen). */
function cmsSign(digest, { key, certDer, name, serial, ec }, corrupt = false) {
  const attrs = [
    seq(oid(OID.contentType), set(oid(OID.data))),
    seq(oid(OID.signingTime), set(utc(new Date()))),
    seq(oid(OID.messageDigest), set(octet(digest))),
  ].sort(Buffer.compare); // DER: SET OF ordenado
  const signedAttrs = set(...attrs);
  const signature = crypto.sign('sha256', signedAttrs, key);
  if (corrupt) signature[signature.length - 1] ^= 1;
  const signerInfo = seq(
    int(1), seq(name, int(serial)), seq(oid(OID.sha256), NULL),
    Buffer.concat([Buffer.from([0xa0]), signedAttrs.subarray(1)]), // [0] IMPLICIT con el mismo contenido
    ec ? seq(oid(OID.ecdsaSha256)) : seq(oid(OID.rsa), NULL), octet(signature),
  );
  const signedData = seq(int(1), set(seq(oid(OID.sha256), NULL)), seq(oid(OID.data)), ctx(0, certDer), set(signerInfo));
  return seq(oid(OID.signedData), ctx(0, signedData));
}

const PLACE = 9999999999;
const SIG_BYTES = 8192;

/**
 * Firma digitalmente un PDF (bytes) con un campo de firma invisible en la primera página.
 * → bytes del PDF firmado. La firma cubre todo el archivo salvo el hueco de /Contents.
 * mdp: 1, 2 o 3 para una firma de CERTIFICACIÓN (DocMDP) con esos permisos: 1 = ningún cambio,
 * 2 = rellenar formularios y firmar, 3 = además anotar.
 */
export async function signPdf(bytes, cert = selfSignedCert(), { mdp = 0, corrupt = false } = {}) {
  const doc = await PDFDocument.load(bytes);
  const c = doc.context;
  const sigDict = {
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, PLACE, PLACE, PLACE],
    Contents: PDFHexString.of('0'.repeat(SIG_BYTES * 2)),
    M: PDFString.fromDate(new Date()), Name: PDFString.of('Firma de prueba'), Reason: PDFString.of('Pruebas'),
  };
  if (mdp) {
    sigDict.Reference = [c.obj({
      Type: 'SigRef', TransformMethod: 'DocMDP',
      TransformParams: c.obj({ Type: 'TransformParams', P: mdp, V: '1.2' }),
    })];
  }
  const sig = c.register(c.obj(sigDict));
  if (mdp) doc.catalog.set(PDFName.of('Perms'), c.obj({ DocMDP: sig }));
  const page = doc.getPage(0);
  const widget = c.register(c.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Firma1'), Rect: [0, 0, 0, 0], F: 132, P: page.ref, V: sig }));
  page.node.addAnnot(widget);
  doc.catalog.set(PDFName.of('AcroForm'),c.obj({ Fields: [widget], SigFlags: 3 }));
  const buf = Buffer.from(await doc.save({ useObjectStreams: false }));
  return fillSignature(buf, cert, corrupt, 0);
}

/** Rellena el ByteRange y la firma CMS del primer hueco de firma a partir de from. → Uint8Array */
function fillSignature(buf, cert, corrupt, from) {
  const text = buf.toString('latin1');
  const hole = `<${'0'.repeat(SIG_BYTES * 2)}>`;
  const start = text.indexOf(hole, from);
  const end = start + hole.length;
  const re = /\/ByteRange\s*\[\s*0\s+9999999999\s+9999999999\s+9999999999\s*\]/g;
  re.lastIndex = from;
  const br = re.exec(text);
  if (start < 0 || !br) throw new Error('signPdf: no se encontraron los huecos de la firma.');
  const range = `/ByteRange [0 ${start} ${end} ${buf.length - end}]`.padEnd(br[0].length, ' ');
  buf.write(range, br.index, 'latin1');

  const digest = crypto.createHash('sha256').update(buf.subarray(0, start)).update(buf.subarray(end)).digest();
  const cms = cmsSign(digest, cert, corrupt).toString('hex').toUpperCase();
  if (cms.length > SIG_BYTES * 2) throw new Error('signPdf: la firma no cabe.');
  buf.write(cms, start + 1, 'latin1');
  return new Uint8Array(buf);
}

/**
 * Añade OTRA firma a un PDF ya firmado con un guardado INCREMENTAL escrito a mano, como un programa
 * de firma real: los bytes anteriores no se tocan y al final van la página y el catálogo actualizados,
 * el diccionario de la firma nueva, su widget, una tabla xref con /Prev y el trailer.
 * Solo para PDFs con tabla xref clásica (los que genera signPdf).
 */
export async function addSignatureIncremental(bytes, cert = selfSignedCert('Segundo firmante'), { corrupt = false } = {}) {
  const prev = Buffer.from(bytes);
  const doc = await PDFDocument.load(prev, { updateMetadata: false });
  const c = doc.context;
  const sig = c.register(c.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, PLACE, PLACE, PLACE],
    Contents: PDFHexString.of('0'.repeat(SIG_BYTES * 2)),
    M: PDFString.fromDate(new Date()), Name: PDFString.of('Segundo firmante'),
  }));
  const page = doc.getPage(0);
  const widget = c.register(c.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Firma2'), Rect: [0, 0, 0, 0], F: 132, P: page.ref, V: sig }));
  page.node.addAnnot(widget);
  const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  acro.lookup(PDFName.of('Fields')).push(widget);
  const rootRef = c.trailerInfo.Root;

  // Revisión nueva: objetos cambiados o nuevos, xref y trailer (con /Prev al xref anterior).
  const changed = [page.ref, rootRef, sig, widget];
  if (!(doc.catalog.get(PDFName.of('AcroForm')) instanceof PDFDict)) changed.push(doc.catalog.get(PDFName.of('AcroForm')));
  let out = prev.at(-1) === 0x0a ? '' : '\n';
  const offsets = [];
  for (const ref of changed) {
    offsets.push([ref.objectNumber, ref.generationNumber, prev.length + Buffer.byteLength(out, 'latin1')]);
    out += `${ref.objectNumber} ${ref.generationNumber} obj\n${c.lookup(ref).toString()}\nendobj\n`;
  }
  const xrefAt = prev.length + Buffer.byteLength(out, 'latin1');
  out += 'xref\n';
  for (const [n, g, off] of offsets.sort((x, y) => x[0] - y[0])) out += `${n} 1\n${String(off).padStart(10, '0')} ${String(g).padStart(5, '0')} n \n`;
  const prevXref = Number([...prev.toString('latin1').matchAll(/startxref\s+(\d+)/g)].at(-1)[1]);
  out += `trailer\n<< /Size ${c.largestObjectNumber + 1} /Root ${rootRef.toString()} /Prev ${prevXref} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const buf = Buffer.concat([prev, Buffer.from(out, 'latin1')]);
  return fillSignature(buf, cert, corrupt, prev.length);
}

/** ByteRange de la primera firma del archivo: [a, b, c, d], o null si no hay. */
export function byteRange(bytes) {
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(Buffer.from(bytes).toString('latin1'));
  return m ? m.slice(1).map(Number) : null;
}

/**
 * ¿La firma (la primera) verifica? Como un validador: SHA-256 de los rangos firmados frente al
 * messageDigest guardado en la firma. Lo añadido después (revisiones incrementales) no cuenta:
 * la firma vale para SU revisión. → true, false, o null si no hay firma.
 */
export function signatureIntact(bytes) {
  const buf = Buffer.from(bytes);
  const text = buf.toString('latin1');
  const r = byteRange(buf);
  if (!r) return null;
  const [a, b, c2, d] = r;
  if (a !== 0 || c2 + d > buf.length) return false;
  const hex = text.slice(a + b + 1, c2 - 1);
  const cms = Buffer.from(hex.replace(/[^0-9a-f]/gi, ''), 'hex');
  const marker = Buffer.concat([oid(OID.messageDigest), Buffer.from([0x31, 0x22, 0x04, 0x20])]);
  const at = cms.indexOf(marker);
  if (at < 0) return false;
  const stored = cms.subarray(at + marker.length, at + marker.length + 32);
  const digest = crypto.createHash('sha256').update(buf.subarray(a, a + b)).update(buf.subarray(c2, c2 + d)).digest();
  return digest.equals(stored);
}

/** Comprueba que un certificado DER es válido y autofirmado (para la prueba del generador). */
export function certIsSelfSigned(certDer) {
  const x = new crypto.X509Certificate(certDer);
  return x.verify(x.publicKey) && x.subject === x.issuer;
}
