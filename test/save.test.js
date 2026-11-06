// Pruebas de src/savePlan.js (cómo se guarda).  Ejecutar: npm test
import assert from 'node:assert/strict';
import { planSave, replacesOriginal, replacesSigned, signedSources, samePath, dirOf, joinPath, hasRedactions } from '../src/savePlan.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

const WIN = 'C:\\Users\\Ana\\Documentos\\contrato.pdf';
const MAC = '/Users/ana/Documentos/contrato.pdf';
const page = (annots = []) => ({ annots });
const zone = { id: 'z', type: 'redact', rect: [0, 0, 0.5, 0.5] };
const doc = (path, pages) => ({ file: { path, name: 'contrato.pdf' }, sources: [{ docId: 1, name: 'contrato', path }], pages });

t('sin redacciones, Guardar escribe directamente en el archivo abierto', () => {
  const p = planSave(doc(WIN, [page([{ type: 'highlight' }])]));
  assert.equal(p.redacted, false);
  assert.equal(p.path, WIN);
});

t('con redacciones, Guardar nunca escribe directamente: siempre pregunta', () => {
  const p = planSave(doc(WIN, [page(), page([zone])]));
  assert.equal(p.redacted, true);
  assert.equal(p.path, null);
});

t('propone «<nombre> (redactado).pdf» en la misma carpeta (Windows y Mac)', () => {
  assert.equal(planSave(doc(WIN, [page([zone])])).defaultPath, 'C:\\Users\\Ana\\Documentos\\contrato (redactado).pdf');
  assert.equal(planSave(doc(MAC, [page([zone])])).defaultPath, '/Users/ana/Documentos/contrato (redactado).pdf');
});

t('no encadena «(redactado)» al volver a redactar una copia redactada', () => {
  const p = planSave({ file: { path: 'C:\\x\\contrato (redactado).pdf', name: 'contrato (redactado).pdf' }, sources: [], pages: [page([zone])] });
  assert.equal(p.suggestedName, 'contrato (redactado).pdf');
});

t('documento nuevo (varios PDF unidos) con redacciones: carpeta del primer PDF con ruta', () => {
  const p = planSave({ file: null, sources: [{ name: 'anexo', path: null }, { name: 'contrato', path: MAC }], pages: [page([zone])] });
  assert.equal(p.defaultPath, '/Users/ana/Documentos/anexo (redactado).pdf');
  assert.deepEqual(p.originals, [MAC]);
});

t('elegir el mismo archivo que el original se detecta (mayúsculas y barras en Windows)', () => {
  const p = planSave(doc(WIN, [page([zone])]));
  assert.equal(replacesOriginal(p, 'c:/users/ana/documentos/CONTRATO.pdf'), true);
  assert.equal(replacesOriginal(p, p.defaultPath), false);
});

t('en Mac/Linux las mayúsculas sí distinguen archivos', () => {
  const p = planSave(doc(MAC, [page([zone])]));
  assert.equal(replacesOriginal(p, MAC), true);
  assert.equal(replacesOriginal(p, '/Users/ana/Documentos/Contrato.pdf'), false);
});

t('Guardar como y Extraer siguen preguntando; Extraer propone «(extracto)»', () => {
  assert.equal(planSave({ ...doc(WIN, [page()]), asNew: true }).path, null);
  const e = planSave({ ...doc(WIN, [page()]), extract: true });
  assert.equal(e.path, null);
  assert.equal(e.suggestedName, 'contrato (extracto).pdf');
});

t('utilidades de rutas', () => {
  assert.equal(dirOf('C:\\a\\b.pdf'), 'C:\\a');
  assert.equal(dirOf('b.pdf'), '');
  assert.equal(joinPath('', 'x.pdf'), 'x.pdf');
  assert.equal(joinPath('/a/', 'x.pdf'), '/a/x.pdf');
  assert.equal(samePath(null, 'x'), false);
  assert.equal(hasRedactions([page(), page([{ type: 'note' }])]), false);
});

// --- PDFs firmados digitalmente -----------------------------------------------------------
const signedDoc = (path, pages, extra = {}) => ({
  file: { path, name: 'contrato.pdf' }, sources: [{ docId: 1, name: 'contrato', path, signed: 1 }],
  pages: pages.map((p) => ({ docId: 1, ...p })), ...extra,
});

t('firmado y con cambios: Guardar pide confirmación y propone una copia «(modificado)»', () => {
  const p = planSave(signedDoc(WIN, [page()]));
  assert.equal(p.confirmSigned, true);
  assert.equal(p.path, WIN); // solo si se confirma «Guardar encima»
  assert.equal(p.copyPath, 'C:\\Users\\Ana\\Documentos\\contrato (modificado).pdf');
});

t('firmado y sin cambios: Guardar no escribe nada (reescribirlo rompería la firma)', () => {
  const p = planSave({ ...signedDoc(WIN, [page()]), dirty: false });
  assert.equal(p.skip, true);
  assert.equal(p.confirmSigned, false);
});

t('Guardar como / Extraer de un firmado: elegir el original firmado se detecta', () => {
  const p = planSave({ ...signedDoc(WIN, [page()]), asNew: true });
  assert.equal(p.confirmSigned, false);
  assert.equal(replacesSigned(p, 'c:\\users\\ana\\documentos\\contrato.PDF'), true);
  assert.equal(replacesSigned(p, p.copyPath), false);
});

t('firmado con redacciones: manda la regla de las redacciones (siempre pregunta dónde) y reemplazar el original avisa de ambas', () => {
  const p = planSave(signedDoc(WIN, [page([zone])]));
  assert.equal(p.path, null);
  assert.equal(p.confirmSigned, false);
  assert.equal(replacesOriginal(p, WIN) && replacesSigned(p, WIN), true);
});

t('sin firma no cambia nada', () => {
  const p = planSave(doc(WIN, [page()]));
  assert.equal(p.confirmSigned, false);
  assert.equal(p.skip, false);
  assert.deepEqual(p.signedOriginals, []);
});

t('barra de estado: los PDF firmados que aún aportan páginas', () => {
  const s = signedDoc(WIN, [page()]);
  assert.deepEqual(signedSources(s).map((x) => x.docId), [1]);
  assert.deepEqual(signedSources({ ...s, pages: [{ docId: 2 }] }), []); // ya no queda ninguna página suya
  assert.deepEqual(signedSources(doc(WIN, [page()])), []);
});

console.log(`\n${passed} pruebas de guardado superadas.`);
