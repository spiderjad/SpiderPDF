// Análisis forense de un PDF guardado, sin pdf-lib ni PDFium: se leen los bytes tal cual,
// como haría alguien que quiere recuperar lo redactado.
import zlib from 'node:zlib';

const latin1 = (buf) => Buffer.from(buf).toString('latin1');

function inflate(data) {
  try { return zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { /* sigue */ }
  try { return zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return null; }
}

/**
 * Todos los objetos del archivo, también los que están dentro de flujos de objetos (/ObjStm)
 * y los que nadie referencia. → { objects: Map(num → { dict, data, decoded, inObjStm }), trailers: [texto] }
 */
export function parsePdf(bytes) {
  const raw = Buffer.from(bytes);
  const text = latin1(raw);
  const objects = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) break;
    const body = text.slice(start, end);
    const s = body.search(/\bstream\r?\n/);
    let dict = body;
    let data = null;
    let decoded = null;
    if (s >= 0) {
      dict = body.slice(0, s);
      const dataStart = start + s + body.slice(s).match(/^stream\r?\n/)[0].length;
      const dataEnd = text.lastIndexOf('endstream', end);
      data = raw.subarray(dataStart, dataEnd).subarray(0); // incluye un posible salto final: inflate lo tolera
      decoded = /\/FlateDecode/.test(dict) ? inflate(data) : data;
    }
    objects.set(`${m[1]} ${m[2]}`, { num: Number(m[1]), dict, data, decoded, inObjStm: false });
    re.lastIndex = end;
  }
  // Objetos dentro de flujos de objetos.
  for (const o of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.decoded) continue;
    const n = Number(o.dict.match(/\/N\s+(\d+)/)[1]);
    const first = Number(o.dict.match(/\/First\s+(\d+)/)[1]);
    const t = latin1(o.decoded);
    const nums = t.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const from = first + nums[i * 2 + 1];
      const to = i + 1 < n ? first + nums[i * 2 + 3] : t.length;
      objects.set(`${nums[i * 2]} 0`, { num: nums[i * 2], dict: t.slice(from, to), data: null, decoded: null, inObjStm: true });
    }
  }
  const trailers = [...text.matchAll(/trailer\s*(<<[\s\S]*?>>)\s*startxref/g)].map((x) => x[1]);
  for (const o of objects.values()) if (/\/Type\s*\/XRef/.test(o.dict)) trailers.push(o.dict);
  return { text, objects, trailers };
}

/** Objetos que no se alcanzan desde el trailer (/Root, /Info, /Encrypt). No cuenta los contenedores de la estructura. */
export function unreachable({ objects, trailers }) {
  const refs = (s) => [...s.matchAll(/(\d+)\s+(\d+)\s+R\b/g)].map((x) => `${x[1]} ${x[2]}`);
  const seen = new Set();
  const queue = trailers.flatMap((t) => refs(t.replace(/\/(Prev|XRefStm)\s+\d+/g, '')));
  while (queue.length) {
    const k = queue.pop();
    if (seen.has(k) || !objects.has(k)) continue;
    seen.add(k);
    queue.push(...refs(objects.get(k).dict));
  }
  return [...objects.entries()]
    .filter(([k, o]) => !seen.has(k) && !/\/Type\s*\/(XRef|ObjStm)/.test(o.dict))
    .map(([k, o]) => ({ ref: k, dict: o.dict.slice(0, 120).replace(/\s+/g, ' ') }));
}

/** Todas las formas en que una palabra puede quedar escrita en un PDF con fuente de 1 byte o Unicode. */
export function needles(word) {
  const hex = Buffer.from(word, 'latin1').toString('hex');
  const utf16 = Buffer.from(word, 'utf16le').swap16();
  return {
    literal: word.toLowerCase(),
    hex,                                   // <7472617a...> códigos de glifo WinAnsi
    hex16: utf16.toString('hex'),          // <00740072...> texto Unicode (metadatos, campos, CID con Identity)
    raw16: latin1(utf16).toLowerCase(),    // \0t\0r\0a... (cadenas UTF-16BE literales)
  };
}

/** Busca la palabra en un texto PDF (crudo o descomprimido) en todas sus formas. Devuelve dónde la ve. */
export function findWord(pdfText, n) {
  const t = pdfText.toLowerCase();
  const hits = [];
  if (t.includes(n.literal)) hits.push('literal');
  if (t.includes(n.raw16)) hits.push('utf16');
  // Cadenas hexadecimales <...> unidas (el texto puede ir troceado en arrays TJ).
  const hexJoined = [...t.matchAll(/<([0-9a-f\s]+)>/g)].map((x) => x[1].replace(/\s+/g, '')).join('');
  if (hexJoined.includes(n.hex)) hits.push('hex');
  if (hexJoined.includes(n.hex16)) hits.push('hex16');
  // Cadenas literales (...) unidas, con los escapes más comunes resueltos.
  const litJoined = [...t.matchAll(/\(((?:\\.|[^\\)])*)\)/g)]
    .map((x) => x[1].replace(/\\([nrtbf()\\])/g, '$1').replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))).join('');
  if (litJoined.includes(n.literal)) hits.push('literal-troceado');
  if (litJoined.includes(n.raw16)) hits.push('utf16-troceado');
  return hits;
}

/** Busca la palabra en todo el archivo: bytes crudos, cada flujo descomprimido y cada objeto dentro de /ObjStm. */
export function scanWord(parsed, word) {
  const n = needles(word);
  const found = [];
  const raw = findWord(parsed.text, n);
  if (raw.length) found.push({ where: 'archivo sin descomprimir', how: raw });
  for (const [k, o] of parsed.objects) {
    const inDict = o.inObjStm ? findWord(o.dict, n) : [];
    if (inDict.length) found.push({ where: `objeto ${k} (en /ObjStm)`, how: inDict });
    if (o.decoded && o.decoded !== o.data) {
      const hits = findWord(latin1(o.decoded), n);
      if (hits.length) found.push({ where: `flujo ${k} (descomprimido)`, how: hits });
    }
  }
  return found;
}

/** Codifica un PNG RGB (para preparar las pruebas sin dependencias). */
export function pngRGB(width, height, colorAt, channels = 3) {
  const row = width * channels + 1;
  const rawData = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rawData.set(colorAt(x, y), y * row + 1 + x * channels);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8); // 6 = RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rawData)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
