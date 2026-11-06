// Comprobación de INTEGRIDAD de las firmas digitales de un PDF (proceso principal, node:crypto).
// Para cada firma: ByteRange coherente, resumen de esos bytes = messageDigest firmado, y la firma
// CMS/PKCS#7 verifica con la clave pública del certificado que lleva dentro.
// NO comprueba la confianza del certificado (cadena, almacén del sistema) ni la revocación: eso es el paso 5.
'use strict';
const { T } = require('./i18n.cjs');
const crypto = require('node:crypto');

// --- Lector DER/BER mínimo ---------------------------------------------------------------------
/** Lee un elemento en pos. → { tag, start, cs (inicio del contenido), ce (fin del contenido), end } */
function read(buf, pos) {
  if (pos + 2 > buf.length) throw new Error('ASN.1 truncado');
  const tag = buf[pos];
  let p = pos + 1;
  if ((tag & 0x1f) === 0x1f) while (buf[p++] & 0x80) if (p >= buf.length) throw new Error('ASN.1: etiqueta truncada');
  let len = buf[p++];
  if (len === 0x80) { // longitud indefinida (BER): hijos hasta 00 00
    if (!(tag & 0x20)) throw new Error('ASN.1: longitud indefinida en un primitivo');
    let q = p;
    while (!(buf[q] === 0 && buf[q + 1] === 0)) { q = read(buf, q).end; if (q >= buf.length) throw new Error('ASN.1: sin fin'); }
    return { tag, start: pos, cs: p, ce: q, end: q + 2 };
  }
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n > 4) throw new Error('ASN.1: longitud demasiado grande');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p++];
  }
  if (p + len > buf.length) throw new Error('ASN.1: longitud fuera del búfer');
  return { tag, start: pos, cs: p, ce: p + len, end: p + len };
}
function kids(buf, node) {
  const out = [];
  for (let p = node.cs; p < node.ce;) { const k = read(buf, p); out.push(k); p = k.end; }
  return out;
}
const bytesOf = (buf, n) => buf.subarray(n.cs, n.ce);
const rawOf = (buf, n) => buf.subarray(n.start, n.end);

function oidStr(b) {
  const out = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { out.push(v); v = 0; } }
  return out.join('.');
}
const oidOf = (buf, n) => oidStr(bytesOf(buf, n));

function asnString(buf, n) {
  const b = bytesOf(buf, n);
  if (n.tag === 0x1e) { // BMPString (UTF-16BE)
    let s = '';
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    return s;
  }
  if (n.tag === 0x14) return b.toString('latin1'); // TeletexString: aproximación habitual
  return b.toString('utf8'); // UTF8String, PrintableString, IA5String…
}

function asnTime(buf, n) {
  const s = bytesOf(buf, n).toString('latin1');
  const utcTime = n.tag === 0x17; // UTCTime: año con 2 cifras; GeneralizedTime (0x18): con 4
  const m = (utcTime ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/ : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/).exec(s);
  if (!m) return null;
  let y = Number(m[1]);
  if (utcTime) y += y < 50 ? 2000 : 1900;
  return new Date(Date.UTC(y, m[2] - 1, m[3], m[4], m[5], m[6] ?? 0)).toISOString();
}

/** Fecha PDF «D:20261104153000+01'00'» → ISO. */
function pdfDate(s) {
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s ?? '');
  if (!m) return null;
  const [y, mo = 1, d = 1, h = 0, mi = 0, se = 0] = m.slice(1, 7).map((x) => (x === undefined ? undefined : Number(x)));
  let t = Date.UTC(y, mo - 1, d, h, mi, se);
  if (m[7] === '+' || m[7] === '-') t -= (m[7] === '+' ? 1 : -1) * ((Number(m[8] ?? 0) * 60 + Number(m[9] ?? 0)) * 60000);
  return new Date(t).toISOString();
}

const DIGEST = {
  '1.3.14.3.2.26': 'sha1', '2.16.840.1.101.3.4.2.4': 'sha224', '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384', '2.16.840.1.101.3.4.2.3': 'sha512',
};
const SIG_HASH = { // firma → hash, cuando el algoritmo de firma lo fija
  '1.2.840.113549.1.1.5': 'sha1', '1.2.840.113549.1.1.14': 'sha224', '1.2.840.113549.1.1.11': 'sha256',
  '1.2.840.113549.1.1.12': 'sha384', '1.2.840.113549.1.1.13': 'sha512',
  '1.2.840.10045.4.1': 'sha1', '1.2.840.10045.4.3.1': 'sha224', '1.2.840.10045.4.3.2': 'sha256',
  '1.2.840.10045.4.3.3': 'sha384', '1.2.840.10045.4.3.4': 'sha512',
};
const RSA_PSS = '1.2.840.113549.1.1.10';
const OID = {
  signedData: '1.2.840.113549.1.7.2', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5',
  cn: '2.5.4.3', o: '2.5.4.10', serialName: '2.5.4.5',
};

/** Nombre del titular de un certificado (CN; si no hay, O). */
function subjectName(certDer) {
  const tbs = kids(certDer, read(certDer, 0))[0];
  const f = kids(certDer, tbs);
  const off = f[0].tag === 0xa0 ? 1 : 0; // [0] versión
  const subject = f[off + 4];
  const attrs = {};
  for (const rdn of kids(certDer, subject)) {
    for (const atv of kids(certDer, rdn)) {
      const [o, v] = kids(certDer, atv);
      attrs[oidOf(certDer, o)] ??= asnString(certDer, v);
    }
  }
  return attrs[OID.cn] ?? attrs[OID.o] ?? null;
}

const normSerial = (s) => s.replace(/^0+/, '').toUpperCase();

/**
 * Verifica un bloque CMS SignedData separado sobre data (los bytes que cubre el ByteRange).
 * → { ok, reason?, name, signingTime }
 */
function verifyCms(cms, data) {
  const ci = read(cms, 0);
  const [ctype, wrapped] = kids(cms, ci);
  if (oidOf(cms, ctype) !== OID.signedData) return { ok: false, reason: T('sig.notCms') };
  const sd = kids(cms, kids(cms, wrapped)[0]);
  let i = 2; // versión, algoritmos de resumen
  const encap = kids(cms, sd[i++]);
  const eContent = encap[1] ? bytesOf(cms, kids(cms, encap[1])[0]) : null; // adbe.pkcs7.sha1: el resumen va dentro
  const certs = [];
  if (sd[i]?.tag === 0xa0) { for (const c of kids(cms, sd[i])) if (c.tag === 0x30) certs.push(Buffer.from(rawOf(cms, c))); i++; }
  if (sd[i]?.tag === 0xa1) i++; // CRL
  const signers = kids(cms, sd[i]);
  if (!signers.length) return { ok: false, reason: T('sig.noSigner') };
  const si = kids(cms, signers[0]);
  let j = 1;
  const sid = si[j++];
  const digestAlg = DIGEST[oidOf(cms, kids(cms, si[j++])[0])];
  let signedAttrs = null;
  if (si[j]?.tag === 0xa0) signedAttrs = si[j++];
  const sigAlgSeq = kids(cms, si[j++]);
  const sigAlg = oidOf(cms, sigAlgSeq[0]);
  const signature = bytesOf(cms, si[j]);
  if (!digestAlg) return { ok: false, unsupported: true, reason: T('sig.digestAlg') };

  // Contenido firmado: los bytes del documento, o el resumen SHA-1 que lleva dentro (adbe.pkcs7.sha1).
  let content = data;
  if (eContent) {
    if (!crypto.createHash('sha1').update(data).digest().equals(eContent)) return { ok: false, reason: T('sig.digestMismatch') };
    content = eContent;
  }

  let signingTime = null;
  let toVerify = content;
  if (signedAttrs) {
    let md = null;
    for (const attr of kids(cms, signedAttrs)) {
      const [o, vals] = kids(cms, attr);
      const v = kids(cms, vals)[0];
      const id = oidOf(cms, o);
      if (id === OID.messageDigest) md = bytesOf(cms, v);
      if (id === OID.signingTime) signingTime = asnTime(cms, v);
    }
    if (!md) return { ok: false, reason: T('sig.noDigest') };
    if (!crypto.createHash(digestAlg).update(content).digest().equals(md)) {
      return { ok: false, reason: T('sig.digestMismatch') };
    }
    // Se firma el SET de atributos (etiqueta 0x31), no el [0] implícito.
    toVerify = Buffer.concat([Buffer.from([0x31]), cms.subarray(signedAttrs.start + 1, signedAttrs.end)]);
  }

  // Certificado del firmante: por número de serie; si no (SubjectKeyIdentifier), el que verifique.
  let serial = null;
  if (sid.tag === 0x30) serial = normSerial(bytesOf(cms, kids(cms, sid)[1]).toString('hex'));
  const parsed = certs.map((der) => { try { return { der, x: new crypto.X509Certificate(der) }; } catch { return null; } }).filter(Boolean);
  if (!parsed.length) return { ok: false, reason: T('sig.noCert') };
  const ordered = [...parsed.filter((c) => serial && normSerial(c.x.serialNumber) === serial), ...parsed];

  const hash = SIG_HASH[sigAlg] ?? digestAlg;
  for (const c of ordered) {
    const key = c.x.publicKey;
    const opts = sigAlg === RSA_PSS || key.asymmetricKeyType === 'rsa-pss'
      ? { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_AUTO }
      : key.asymmetricKeyType === 'ec' ? { key, dsaEncoding: 'der' } : key;
    let ok = false;
    try { ok = crypto.verify(hash, toVerify, opts, signature); } catch { ok = false; }
    if (ok) return { ok: true, name: safeName(c.der) ?? c.x.subject, signingTime };
  }
  return { ok: false, reason: T('sig.badCrypto'), name: safeName(ordered[0].der), signingTime };
}

function safeName(der) { try { return subjectName(der); } catch { return null; } }

/** ¿Solo hay espacios y saltos de línea en b? (lo que va tras el %%EOF de la revisión firmada) */
const blank = (b) => b.every((x) => x === 0x20 || x === 0x0a || x === 0x0d || x === 0x09 || x === 0x00);

/**
 * Todas las firmas del archivo con su estado:
 *   [{ name, date, status: 'intact' | 'modified' | 'broken' | 'unknown', reason, byteRange, subFilter }]
 *   intact   la firma verifica y no hay nada después de la revisión firmada
 *   modified verifica, pero se añadieron revisiones después (guardado incremental)
 *   broken   no verifica: el documento cambió o el ByteRange no tiene sentido
 *   unknown  formato de firma que no se sabe comprobar
 */
function verifyPdfSignatures(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const text = buf.toString('latin1');
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) {
    const br = m.slice(1, 5).map(Number);
    const key = br.join(' ');
    if (seen.has(key)) continue; // el mismo diccionario de firma, repetido en una revisión posterior
    seen.add(key);
    // Diccionario de la firma alrededor del ByteRange (para /SubFilter, /M y /Name).
    const from = text.lastIndexOf(' obj', m.index);
    let to = text.indexOf('endobj', m.index);
    if (to < 0) to = m.index + 200;
    const dictText = text.slice(Math.max(0, from), Math.min(to, m.index + 100000)).replace(/<[0-9a-fA-F\s]{200,}>/g, '<…>');
    const subFilter = /\/SubFilter\s*\/([^\s/<>[\]()]+)/.exec(dictText)?.[1] ?? null;
    const dictDate = pdfDate(/\/M\s*\((D:[^)]*)\)/.exec(dictText)?.[1]);
    const dictName = /\/Name\s*\(([^)]*)\)/.exec(dictText)?.[1] ?? null;
    out.push({ ...checkOne(buf, br, subFilter), byteRange: br, subFilter, dictDate, dictName });
  }
  return out.map(({ dictDate, dictName, signingTime, ...r }) => ({
    ...r, name: r.name ?? dictName ?? null, date: signingTime ?? dictDate ?? null,
  }));
}

function checkOne(buf, [a, b, c, d], subFilter) {
  const broken = (reason, extra = {}) => ({ status: 'broken', reason, ...extra });
  if (a !== 0 || b <= 0 || c <= b || d < 0 || c + d > buf.length || buf[b] !== 0x3c || buf[c - 1] !== 0x3e) {
    return broken(T('sig.byteRange'));
  }
  const hex = buf.subarray(b + 1, c - 1).toString('latin1').replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]*$/.test(hex)) return broken(T('sig.byteRange'));
  if (subFilter === 'adbe.x509.rsa_sha1') return { status: 'unknown', reason: T('sig.oldFormat') };
  const cms = Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
  const data = Buffer.concat([buf.subarray(a, a + b), buf.subarray(c, c + d)]);
  let r;
  try { r = verifyCms(cms, data); } catch (e) { return { status: 'unknown', reason: T('sig.unreadable', { error: e.message }) }; }
  if (r.unsupported) return { status: 'unknown', reason: r.reason, name: r.name, signingTime: r.signingTime };
  if (!r.ok) return broken(r.reason, { name: r.name, signingTime: r.signingTime });
  const after = buf.subarray(c + d);
  return blank(after)
    ? { status: 'intact', name: r.name, signingTime: r.signingTime }
    : { status: 'modified', reason: T('sig.modified'), name: r.name, signingTime: r.signingTime };
}

module.exports = { verifyPdfSignatures, pdfDate };
