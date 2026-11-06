// PDFs firmados: guardado incremental, permisos DocMDP y estados (src/signed.js).  Ejecutar: node test/signed.test.js
import assert from 'node:assert/strict';
import { incrementalPlan, reasonText, editPolicy, allowedTools, allows, worstStatus } from '../src/signed.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

const src = { docId: 1, pageCount: 3 };
const pg = (index, extra = {}) => ({ docId: 1, index, annots: [], ...extra });

t('mismas páginas y mismo orden (con notas, giros o campos): incremental', () => {
  assert.deepEqual(incrementalPlan([pg(0), pg(1, { rot: 1, annots: [{ type: 'note' }] }), pg(2)], src), { incremental: true, reasons: [] });
});

t('quitar, reordenar, añadir de otro PDF o redactar obliga a reescribir, con su motivo', () => {
  assert.deepEqual(incrementalPlan([pg(0), pg(2)], src).reasons, ['deleted']);
  assert.deepEqual(incrementalPlan([pg(1), pg(0), pg(2)], src).reasons, ['moved']);
  assert.deepEqual(incrementalPlan([pg(0), pg(1), pg(2), { docId: 2, index: 0, annots: [] }], src).reasons, ['added']);
  assert.deepEqual(incrementalPlan([pg(0), pg(1, { annots: [{ type: 'redact' }] }), pg(2)], src).reasons, ['redact']);
});

t('los motivos se explican en una frase', () => {
  assert.equal(reasonText(['deleted']), 'has quitado páginas');
  assert.equal(reasonText(['deleted', 'moved', 'redact']), 'has quitado páginas, has cambiado el orden de las páginas y hay zonas que redactar');
});

t('sin certificación se puede todo', () => {
  const p = editPolicy([{ signed: 1, mdp: 0 }]);
  assert.equal(p.level, 'full');
  assert.equal(allowedTools(p).size, 8);
});

t('DocMDP P=1: nada se puede cambiar (solo Seleccionar para leer, buscar y copiar)', () => {
  const p = editPolicy([{ mdp: 1 }]);
  assert.deepEqual([...allowedTools(p)], ['select']);
  for (const a of [{ type: 'rotate' }, { type: 'move' }, { type: 'setField' }, { type: 'addAnnot', annot: { type: 'note' } }]) assert.equal(allows(p, a), false, a.type);
  assert.equal(allows(p, { type: 'select' }), true);
  assert.equal(allows(p, { type: 'undo' }), true);
});

t('DocMDP P=2: solo rellenar formularios', () => {
  const p = editPolicy([{ mdp: 2 }]);
  assert.equal(allows(p, { type: 'setField' }), true);
  assert.equal(allows(p, { type: 'addAnnot', annot: { type: 'highlight' } }), false);
  assert.deepEqual([...allowedTools(p)], ['select']);
});

t('DocMDP P=3: formularios y anotaciones; ni páginas, ni texto, ni firma gráfica (es contenido), ni redactar', () => {
  const p = editPolicy([{ mdp: 3 }]);
  assert.deepEqual([...allowedTools(p)], ['select', 'highlight', 'ink', 'note']);
  assert.equal(allows(p, { type: 'addAnnot', annot: { type: 'ink' } }), true);
  assert.equal(allows(p, { type: 'addAnnot', annot: { type: 'image' } }), false);
  assert.equal(allows(p, { type: 'addAnnot', annot: { type: 'redact' } }), false);
  assert.equal(allows(p, { type: 'addAnnot', annot: { type: 'textbox' } }), false); // el texto nuevo es contenido
  assert.equal(allows(p, { type: 'setTextEdit' }), false);
  assert.equal(allows(p, { type: 'setOcr' }), false, 'el OCR añade texto a la página: no en un certificado');
  assert.equal(allows(p, { type: 'delete' }), false);
  const state = { pages: [{ key: 'k', annots: [{ id: 'a', type: 'note' }, { id: 'b', type: 'image' }] }] };
  assert.equal(allows(p, { type: 'updateAnnot', key: 'k', id: 'a' }, state), true);
  assert.equal(allows(p, { type: 'removeAnnot', key: 'k', id: 'b' }, state), false);
});

t('con varios PDF certificados manda el más restrictivo', () => {
  assert.equal(editPolicy([{ mdp: 3 }, { mdp: 1 }, { mdp: 0 }]).level, 'locked');
});

t('estado de varias firmas: el peor', () => {
  assert.equal(worstStatus([{ status: 'intact' }, { status: 'modified' }]), 'modified');
  assert.equal(worstStatus([{ status: 'modified' }, { status: 'broken' }, { status: 'unknown' }]), 'broken');
  assert.equal(worstStatus([{ status: 'intact' }]), 'intact');
});

console.log(`\n${passed} pruebas de PDFs firmados superadas.`);
