// Pruebas de src/conflicts.js.  Ejecutar: npm test
import assert from 'node:assert/strict';
import { redactConflicts, noteRect, conflictMessage } from '../src/conflicts.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };
const page = (annots, extra = {}) => ({ width: 595, height: 842, rot0: 0, annots, textEdits: {}, ...extra });
const zone = { id: 'z', type: 'redact', rect: [0.2, 0.2, 0.5, 0.4] };

t('sin zonas no hay conflictos', () => {
  assert.deepEqual(redactConflicts(page([{ id: 'f', type: 'image', rect: [0, 0, 1, 1] }])), []);
});

t('una firma que toca la zona es conflicto; una fuera, no', () => {
  const c = redactConflicts(page([zone,
    { id: 'dentro', type: 'image', rect: [0.45, 0.35, 0.7, 0.45] },
    { id: 'fuera', type: 'image', rect: [0.6, 0.6, 0.8, 0.7] }]));
  assert.deepEqual(c, [{ kind: 'image', id: 'dentro' }]);
});

t('la nota cuenta con el tamaño de su icono (20 pt)', () => {
  // Punto justo a la izquierda de la zona: el icono se extiende hacia la derecha y la toca.
  const cerca = { id: 'n', type: 'note', at: [0.2 - 10 / 595, 0.3] };
  assert.deepEqual(redactConflicts(page([zone, cerca])), [{ kind: 'note', id: 'n' }]);
  const lejos = { id: 'n2', type: 'note', at: [0.2 - 25 / 595, 0.3] };
  assert.deepEqual(redactConflicts(page([zone, lejos])), []);
});

t('el tamaño de la nota usa la página sin rotar', () => {
  const r = noteRect({ at: [0, 0] }, { width: 842, height: 595, rot0: 1 }); // apaisada por /Rotate
  assert.ok(Math.abs(r[2] - 20 / 595) < 1e-9 && Math.abs(r[3] - 20 / 842) < 1e-9);
});

t('solo los textos editados (no borrados) cuentan', () => {
  const runs = [
    { objIndex: 1, rect: [0.25, 0.25, 0.3, 0.3] },
    { objIndex: 2, rect: [0.25, 0.3, 0.3, 0.35] },
    { objIndex: 3, rect: [0.25, 0.35, 0.3, 0.38] },
  ];
  const p = page([zone], { textEdits: { 1: { text: 'nuevo', from: 'viejo' }, 2: { text: '', from: 'x' } } });
  assert.deepEqual(redactConflicts(p, runs), [{ kind: 'text', id: 1 }]);
});

t('el aviso nombra el elemento', () => {
  assert.equal(conflictMessage('image'), 'Esta zona se va a borrar al guardar; mueve la firma fuera.');
  assert.match(conflictMessage('note'), /la nota/);
  assert.match(conflictMessage('text'), /el texto/);
});

t('un cuadro de texto encima de una zona es un conflicto (vacío, no)', () => {
  const page = { width: 595, height: 842, annots: [
    { id: 'z', type: 'redact', rect: [0.1, 0.1, 0.5, 0.5] },
    { id: 'tb', type: 'textbox', rect: [0.4, 0.4, 0.7, 0.45], text: 'Hola' },
    { id: 'vacio', type: 'textbox', rect: [0.2, 0.2, 0.3, 0.25], text: '  ' },
  ] };
  assert.deepEqual(redactConflicts(page), [{ kind: 'textbox', id: 'tb' }]);
  assert.match(conflictMessage('textbox'), /cuadro de texto/);
});

console.log(`\n${passed} pruebas de conflictos superadas.`);
