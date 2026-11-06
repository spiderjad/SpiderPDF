// Negrita y cursiva de una fuente incrustada, leídas del propio archivo de la fuente (TrueType / OpenType).
// Hace falta porque muchos PDF (Chrome, «Imprimir a PDF», algunos Word) nombran las fuentes «CIDFont+F1» y su
// descriptor no dice si son negrita, y FPDFFont_GetWeight devuelve valores sin sentido en esos casos.
// Puro: se prueba en Node.

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

/** Tablas de un sfnt: Map etiqueta → { off, len }. null si no lo es (CFF suelto, Type 1…). */
function tables(b) {
  if (b.length < 12) return null;
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (!(tag === 'OTTO' || tag === 'true' || u32(b, 0) === 0x00010000)) return null;
  const n = u16(b, 4);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    if (r + 16 > b.length) break;
    out.set(String.fromCharCode(b[r], b[r + 1], b[r + 2], b[r + 3]), { off: u32(b, r + 8), len: u32(b, r + 12) });
  }
  return out;
}

/** Nombre completo (nameID 4) o de familia + subfamilia (1 + 2), si están. */
function fullName(b, t) {
  const nm = t.get('name');
  if (!nm || nm.off + 6 > b.length) return '';
  const count = u16(b, nm.off + 2);
  const strings = nm.off + u16(b, nm.off + 4);
  const found = {};
  for (let i = 0; i < count; i++) {
    const r = nm.off + 6 + i * 12;
    if (r + 12 > b.length) break;
    const platform = u16(b, r); const id = u16(b, r + 6); const len = u16(b, r + 8); const off = strings + u16(b, r + 10);
    if (![1, 2, 4].includes(id) || off + len > b.length || found[id]) continue;
    let s = '';
    if (platform === 3 || platform === 0) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(u16(b, off + k));
    else for (let k = 0; k < len; k++) s += String.fromCharCode(b[off + k]);
    found[id] = s;
  }
  return found[4] || [found[1], found[2]].filter(Boolean).join(' ');
}

/**
 * → { bold, italic, weight, name } | null. weight: usWeightClass del OS/2 (400 normal, 700 negrita).
 * bold si weight ≥ 600, el bit de negrita de fsSelection o el nombre lo dice («Calibri Bold»).
 */
export function fontTraits(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const t = tables(b);
  if (!t) return null;
  const name = fullName(b, t);
  const os2 = t.get('OS/2');
  let weight = 0; let sel = 0;
  if (os2 && os2.off + 64 <= b.length) { weight = u16(b, os2.off + 4); sel = u16(b, os2.off + 62); }
  const low = name.toLowerCase();
  const bold = (weight >= 600 && weight <= 1000) || (sel & 0x20) !== 0 || /bold|black|heavy|semibold|demibold/.test(low);
  const italic = (sel & 0x01) !== 0 || /italic|oblique/.test(low);
  if (!weight && !name) return null;
  return { bold, italic, weight, name };
}
