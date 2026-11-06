// Análisis forense de PDFs guardados: busca una palabra en todas sus formas (texto, hexadecimal,
// UTF-16, dentro de flujos comprimidos y de objetos sueltos) y cuenta objetos huérfanos y guardados incrementales.
// Uso: node test/scan-pdf.js <palabra> <archivo.pdf> [más archivos...]
import { readFile } from 'node:fs/promises';
import { parsePdf, unreachable, scanWord } from './forensics.js';

const [word, ...files] = process.argv.slice(2);
if (!word || !files.length) {
  console.log('Uso: node test/scan-pdf.js <palabra> <archivo.pdf> [más archivos...]');
  process.exit(1);
}
let dirty = false;
for (const f of files) {
  const p = parsePdf(await readFile(f));
  const hits = scanWord(p, word);
  const orphans = unreachable(p);
  const eofs = (p.text.match(/%%EOF/g) ?? []).length;
  dirty ||= hits.length > 0 || orphans.length > 0 || eofs > 1;
  console.log(`\n${f}`);
  console.log(`  «${word}»: ${hits.length ? hits.map((h) => `${h.where} [${h.how}]`).join('; ') : 'no aparece'}`);
  console.log(`  objetos huérfanos: ${orphans.length}  ·  secciones de guardado (%%EOF): ${eofs}`);
}
process.exit(dirty ? 2 : 0);
