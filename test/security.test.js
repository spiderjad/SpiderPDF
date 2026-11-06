// PDFs protegidos con contraseña: permisos, política de edición y el qpdf incluido.  npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ALL_PERMS, PERM, permsFor, choicesFrom, allAllowed, permsPolicy, deniedText, permsNotice, canChangeSecurity, checkNewPassword } from '../src/security.js';
import { editPolicy, allows, allowedTools, incrementalPlan, reasonText } from '../src/signed.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

t('permsFor: todo permitido = ALL_PERMS; cada casilla quita sus bits', () => {
  assert.equal(permsFor({}), ALL_PERMS);
  const noPrint = permsFor({ print: false });
  assert.equal(noPrint & (PERM.print | PERM.printHigh), 0);
  assert.equal(permsFor({ copy: false }) & PERM.copy, 0);
  const noEdit = permsFor({ edit: false });
  for (const b of [PERM.modify, PERM.annotate, PERM.fillForms, PERM.assemble]) assert.equal(noEdit & b, 0);
  assert.ok(noEdit & PERM.accessibility, 'la extracción para accesibilidad se deja');
  assert.equal(noEdit & 3, 0, 'los dos primeros bits, a 0');
});

t('choicesFrom es el inverso de permsFor', () => {
  for (const c of [{ print: true, copy: true, edit: true }, { print: false, copy: true, edit: false }, { print: true, copy: false, edit: true }]) {
    assert.deepEqual(choicesFrom(permsFor(c)), c);
  }
});

t('permsPolicy: sin cifrar o con la de permisos, nada; con la de abrir, lo que digan los bits', () => {
  assert.equal(permsPolicy({ encrypted: false }), null);
  assert.equal(permsPolicy({ encrypted: true, owner: true, perms: 0 }), null);
  assert.deepEqual(permsPolicy({ encrypted: true, owner: false, perms: permsFor({ print: false, edit: false }) }),
    { pages: false, content: false, annots: false, forms: false, print: false, copy: true });
  // Rellenar formularios sin poder anotar (bit 9 sin el 6).
  const fill = (ALL_PERMS & ~PERM.annotate) | 0;
  assert.equal(permsPolicy({ encrypted: true, owner: false, perms: fill }).forms, true);
  assert.equal(permsPolicy({ encrypted: true, owner: false, perms: fill }).annots, false);
});

t('deniedText y permsNotice explican lo que no se permite', () => {
  assert.equal(deniedText({ pages: false, content: false, print: false, copy: false }), 'editar, imprimir ni copiar');
  assert.equal(deniedText({ pages: true, content: true, print: false, copy: true }), 'imprimir');
  assert.equal(permsNotice({ pages: true, content: true, annots: true, forms: true, print: true, copy: true }), null);
  assert.match(permsNotice({ pages: true, content: true, print: false, copy: false }), /no permite imprimir ni copiar\. Con la contraseña de permisos/);
});

t('editPolicy combina certificación y contraseña: lo más restrictivo de cada cosa', () => {
  const restricted = { security: { encrypted: true, owner: false, perms: permsFor({ print: false, copy: false }) } };
  const p = editPolicy([restricted]);
  assert.equal(p.level, 'protected');
  assert.deepEqual([p.pages, p.content, p.annots, p.forms, p.print, p.copy], [true, true, true, true, false, false]);
  assert.match(p.notice, /imprimir ni copiar/);
  // + certificación P=3: las páginas y el contenido los bloquea la certificación; imprimir y copiar, la contraseña.
  const both = editPolicy([{ ...restricted, mdp: 3 }]);
  assert.deepEqual([both.pages, both.content, both.annots, both.print, both.copy], [false, false, true, false, false]);
  assert.match(both.notice, /certificado/);
  // Desbloqueado con la de permisos: como si no tuviera.
  assert.equal(editPolicy([{ security: { ...restricted.security, owner: true } }]).level, 'full');
  // Sin editar: las herramientas de Leer se quedan en Seleccionar.
  const noEdit = editPolicy([{ security: { encrypted: true, owner: false, perms: permsFor({ edit: false }) } }]);
  assert.deepEqual([...allowedTools(noEdit)], ['select']);
  assert.equal(allows(noEdit, { type: 'rotate' }), false);
  assert.equal(allows(noEdit, { type: 'addAnnot', annot: { type: 'note' } }), false);
  assert.equal(allows(noEdit, { type: 'setOcr' }), false);
  assert.equal(allows(noEdit, { type: 'selectAll' }), true);
});

t('canChangeSecurity: con la de permisos o si la de abrir lo permite todo', () => {
  assert.equal(canChangeSecurity(null), true);
  assert.equal(canChangeSecurity({ encrypted: true, owner: false, perms: ALL_PERMS }), true);
  assert.equal(canChangeSecurity({ encrypted: true, owner: false, perms: permsFor({ print: false }) }), false);
  assert.equal(canChangeSecurity({ encrypted: true, owner: true, perms: ALL_PERMS }), true);
  assert.equal(allAllowed(permsFor({ copy: false })), false);
});

t('checkNewPassword: vacía, corta, larga y repetida distinta', () => {
  assert.equal(checkNewPassword('', ''), 'Escribe una contraseña.');
  assert.equal(checkNewPassword('abc', 'abc'), 'Usa al menos 4 caracteres.');
  assert.equal(checkNewPassword('x'.repeat(128), 'x'.repeat(128)), 'Usa como mucho 127 caracteres.');
  assert.equal(checkNewPassword('abcd', 'abce'), 'Las contraseñas no coinciden.');
  assert.equal(checkNewPassword('señal€', 'señal€'), null);
});

t('cambiar la contraseña de un PDF firmado obliga a reescribirlo', () => {
  const pages = [{ docId: 1, index: 0, annots: [] }];
  assert.equal(incrementalPlan(pages, { docId: 1, pageCount: 1 }).incremental, true);
  const plan = incrementalPlan(pages, { docId: 1, pageCount: 1 }, { security: true });
  assert.deepEqual(plan, { incremental: false, reasons: ['security'] });
  assert.equal(reasonText(plan.reasons), 'has cambiado la contraseña');
});

t('qpdf incluido: los archivos coinciden con su SHA-256 (build/qpdf/build.sh los genera)', () => {
  const dir = new URL('../src/engine/qpdf/', import.meta.url);
  const sums = readFileSync(new URL('SHA256SUMS', dir), 'utf8').trim().split('\n').map((l) => l.split(/\s+\*?/));
  assert.deepEqual(sums.map(([, f]) => f).sort(), ['qpdf.mjs', 'qpdf.wasm']);
  for (const [hash, file] of sums) assert.equal(createHash('sha256').update(readFileSync(new URL(file, dir))).digest('hex'), hash, file);
});

console.log(`\n${passed} pruebas superadas.`);
