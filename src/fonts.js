// Fuentes en pantalla para el texto nuevo: las incluidas (los mismos TTF que se incrustan en el PDF, así la
// vista previa parte las líneas casi igual que al guardar) y, si se puede, la propia fuente del PDF.
import { FONT_URLS } from './engine/fontUrls.js';
import { FAMILIES, LINE_HEIGHT, parseFamilyKey, usesPdfFont } from './textbox.js';
import { pdf } from './engine/client.js';

let registered = false;
/** Da de alta las fuentes incluidas (se descargan solo cuando algo las usa). */
export function registerFamilies() {
  if (registered || typeof FontFace === 'undefined') return;
  registered = true;
  for (const [key, url] of Object.entries(FONT_URLS)) {
    const k = parseFamilyKey(key);
    document.fonts.add(new FontFace(FAMILIES[k.family].css, `url(${url})`, { weight: k.bold ? '700' : '400', style: k.italic ? 'italic' : 'normal' }));
  }
}

const pdfFaces = new Map(); // "docId:index:objIndex" → Promise<nombre CSS | null>
/**
 * Fuente del PDF (la del texto objIndex de esa página) para la pantalla. → nombre CSS, o null si no viene
 * incrustada o el navegador no la entiende (entonces se ve con la incluida más parecida).
 */
export function pdfFontFamily(docId, index, objIndex) {
  const key = `${docId}:${index}:${objIndex}`;
  if (!pdfFaces.has(key)) {
    pdfFaces.set(key, pdf.fontData(docId, index, objIndex).then(async (bytes) => {
      if (!bytes) return null;
      const name = `PDFE pdf ${key.replace(/:/g, '-')}`;
      const face = new FontFace(name, bytes);
      await face.load();
      document.fonts.add(face);
      return name;
    }).catch(() => null));
  }
  return pdfFaces.get(key);
}

/** Estilo CSS del texto de un cuadro. pdfFamily: nombre CSS de la fuente del PDF ya cargada (o null). */
export function textboxCss(a, pxPerPt, pdfFamily = null) {
  const st = a.style;
  const fam = FAMILIES[st.family]?.css ?? FAMILIES.sans.css;
  const usePdf = usesPdfFont(a) && pdfFamily;
  return {
    fontFamily: usePdf ? `"${pdfFamily}", "${fam}"` : `"${fam}"`,
    fontSize: st.size * pxPerPt,
    lineHeight: LINE_HEIGHT,
    // Con la fuente del PDF, la negrita/cursiva ya va en ella (no se fuerza).
    fontWeight: usePdf ? 'normal' : st.bold ? 700 : 400,
    fontStyle: usePdf ? 'normal' : st.italic ? 'italic' : 'normal',
    color: st.color,
    textAlign: st.align ?? 'left',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  };
}
