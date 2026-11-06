// Cuadros de texto nuevo (herramienta «Texto nuevo»). Puro: lo usan la interfaz y el motor (test/textbox.test.js).
//
// Un cuadro es una anotación { type: 'textbox', rect, k, text, style, fallback? }:
//   rect  caja en fracciones de página sin rotar (como el resto); k = giro de pantalla al crearla (el texto se
//         escribe derecho en esa orientación, como las firmas).
//   style { pdf: { objIndex, name, raw } | null, usePdf, family, size, bold, italic, color, align }
//         pdf: la fuente de un texto del PDF (objIndex en esa página), que se usa si usePdf; family: la incluida
//         más parecida, que se usa si se elige otra, si se pide negrita/cursiva o si a la del PDF le faltan letras.
//   fallback true: la fuente del PDF no tiene alguna letra escrita; se usa family.

/** Fuentes incluidas (OFL 1.1, TTF en node_modules/@expo-google-fonts). */
export const FAMILIES = {
  sans: { label: 'Inter', css: 'PDFE Inter', file: 'inter/{w}{i}/Inter_{w}{i}.ttf' },
  serif: { label: 'Noto Serif', css: 'PDFE Noto Serif', file: 'noto-serif/{w}{i}/NotoSerif_{w}{i}.ttf' },
  mono: { label: 'JetBrains Mono', css: 'PDFE JetBrains Mono', file: 'jetbrains-mono/{w}{i}/JetBrainsMono_{w}{i}.ttf' },
};

/** Ruta del TTF (relativa a node_modules/@expo-google-fonts) de una familia y estilo. */
export function fontFile(family, bold, italic) {
  const w = bold ? '700Bold' : '400Regular';
  const i = italic ? '_Italic' : '';
  return FAMILIES[family].file.replace(/\{w\}/g, w).replace(/\{i\}/g, i);
}

/** Clave de una fuente incluida: 'serif-700-i'. */
export const familyKey = (family, bold, italic) => `${family}-${bold ? 700 : 400}${italic ? '-i' : ''}`;

/** Clave → { family, bold, italic }. */
export function parseFamilyKey(key) {
  const [family, w, i] = key.split('-');
  return { family, bold: w === '700', italic: i === 'i' };
}

export const LINE_HEIGHT = 1.2; // interlineado, en tamaños de letra (igual en pantalla y en el PDF)

/** Nombre legible de una fuente del PDF: «ABCDEF+Helvetica-Bold» → «Helvetica». */
export function displayFontName(raw = '') {
  const n = raw.replace(/^[A-Z]{6}\+/, '')
    .replace(/[-,](Bold|Italic|Oblique|Regular|Roman|Book|Medium|Light|Semibold|MT|PS)\b.*$/i, '')
    .replace(/(PS)?MT$|PS$/, ''); // sufijos de fabricante: TimesNewRomanPSMT, ArialMT
  return n.replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Fuente del PDF';
}

/** Familia incluida más parecida a una fuente del PDF. */
export function similarFamily(raw = '') {
  const n = raw.toLowerCase().replace(/^[a-z]{6}\+/, '');
  if (/courier|mono|consol|code|menlo/.test(n)) return 'mono';
  if (/times|georgia|garamond|roman|cambria|minion|serif|palat|book ?antiqua|baskerville/.test(n) && !/sans/.test(n)) return 'serif';
  return 'sans';
}

/** Negrita y cursiva de una fuente del PDF (por nombre, peso y ángulo). */
export function fontStyleOf(raw = '', weight = 400, italicAngle = 0) {
  const n = raw.toLowerCase();
  return {
    bold: weight >= 600 || /bold|black|heavy|semibold|demi/.test(n),
    italic: italicAngle !== 0 || /italic|oblique/.test(n),
  };
}

/** Bloque de texto más cercano al punto (u, v), en puntos. runs: textRuns del motor. pw, ph: tamaño en puntos. */
export function nearestRun(runs, u, v, pw = 1, ph = 1) {
  let best = null;
  let bestD = Infinity;
  for (const r of runs ?? []) {
    if (r.invisible || !r.text?.trim()) continue;
    const [u0, v0, u1, v1] = r.rect;
    const dx = Math.max(u0 - u, 0, u - u1) * pw;
    const dy = Math.max(v0 - v, 0, v - v1) * ph;
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/** Estilo por defecto de un cuadro nuevo: el del texto del PDF más cercano o, si no hay, Inter 12 pt negro. */
export function defaultStyle(run) {
  if (!run) return { pdf: null, usePdf: false, family: 'sans', size: 12, bold: false, italic: false, color: '#121216', align: 'left' };
  const { bold, italic } = fontStyleOf(run.fontName, run.weight, run.italic);
  return {
    pdf: { objIndex: run.objIndex, name: displayFontName(run.fontName), raw: run.fontName },
    usePdf: true,
    family: similarFamily(run.fontName),
    size: Math.max(4, Math.round(run.ptSize * 2) / 2),
    bold, italic,
    color: run.color ?? '#121216',
    align: 'left',
  };
}

/** ¿Se escribe con la fuente del PDF? (si no, con la incluida `family`). */
export const usesPdfFont = (a) => !!(a.style.usePdf && a.style.pdf && !a.fallback);

/**
 * Parte el texto en líneas que caben en maxWidth (respeta los saltos de línea; las palabras más largas que
 * la línea se cortan por letras). measure(cadena) → ancho en las mismas unidades.
 */
export function wrapLines(text, maxWidth, measure) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const token of para.split(/(\s+)/).filter((t) => t !== '')) {
      const candidate = line + token;
      if (!line || measure(candidate.trimEnd()) <= maxWidth) { line = candidate; continue; }
      if (/^\s+$/.test(token)) { out.push(line.trimEnd()); line = ''; continue; }
      out.push(line.trimEnd());
      line = token;
    }
    // Una palabra sola más ancha que la caja: se corta por letras.
    let rest = line.trimEnd();
    while (rest.length > 1 && measure(rest) > maxWidth) {
      let n = rest.length - 1;
      while (n > 1 && measure(rest.slice(0, n)) > maxWidth) n--;
      out.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    out.push(rest);
  }
  return out;
}

/** Letras de `text` que no están en `available` (sin contar espacios). */
export function missingChars(text, available) {
  const have = new Set(available);
  return [...new Set([...String(text)].filter((c) => !/\s/.test(c) && !have.has(c)))];
}
