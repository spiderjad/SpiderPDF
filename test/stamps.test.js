// Pruebas de los sellos (src/stamps.js y la acción copyAnnotTo del estado).  Ejecutar: npm test
import assert from 'node:assert/strict';
import {
  STAMP_PRESETS, formatStampDate, stampName, stampLines, placeRect, normalizeAngle, snapAngle, loadRecentStamps, rememberStamp,
} from '../src/stamps.js';
import { reducer, initialState, pagesFrom } from '../src/state.js';
import { setLang } from '../src/i18n/index.js';

setLang('es');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };
const DATE = new Date(2026, 10, 18, 9, 5);

t('predefinidos: Recibido, Pagado, Aprobado, Contabilizado, Rechazado y Copia, cada uno con su color', () => {
  assert.deepEqual(STAMP_PRESETS.map((p) => stampName({ kind: 'preset', id: p.id })), ['Recibido', 'Pagado', 'Aprobado', 'Contabilizado', 'Rechazado', 'Copia']);
  assert.equal(new Set(STAMP_PRESETS.map((p) => p.color)).size, 6);
});

t('lo que dice el sello: título en mayúsculas, fecha, hora y nombre', () => {
  assert.equal(formatStampDate(DATE, 'es-ES'), '18/11/2026 09:05');
  assert.deepEqual(stampLines({ kind: 'preset', id: 'paid' }, { date: DATE, user: ' Diego Pennisi ', locale: 'es-ES' }),
    { title: 'PAGADO', sub: '18/11/2026 09:05 · Diego Pennisi', color: '#15803D' });
  assert.equal(stampLines({ kind: 'preset', id: 'copy' }, { date: DATE, user: '', locale: 'es-ES' }).sub, '18/11/2026 09:05', 'sin nombre, solo la fecha');
  const own = stampLines({ kind: 'text', text: 'revisado', color: '#B91C1C', meta: false }, { date: DATE, user: 'Ana', locale: 'es-ES' });
  assert.deepEqual(own, { title: 'REVISADO', sub: '', color: '#B91C1C' });
  assert.equal(stampLines({ kind: 'text', text: 'x'.repeat(80), color: '#B91C1C' }, { locale: 'es-ES' }).title.length, 40);
  assert.equal(stampName({ kind: 'image', src: 'data:image/png;base64,x' }), 'Imagen');
});

t('colocar: centrado donde se hace clic, del tamaño pedido y sin salirse (también con la página girada)', () => {
  const page = { dispW: 595, dispH: 842, R: 0 };
  const r = placeRect([0.5, 0.5], { wPt: 119, hPt: 42.1 }, page);
  assert.ok(Math.abs(r[0] - 0.4) < 1e-9 && Math.abs(r[2] - 0.6) < 1e-9 && Math.abs(r[1] - 0.475) < 1e-9);
  const corner = placeRect([0.99, 0.01], { wPt: 119, hPt: 42.1 }, page);
  assert.ok(corner[2] <= 1 && corner[1] >= 0);
  // Página que se ve girada 90°: la caja guardada (sin girar) es la girada de la que se ve.
  const rot = placeRect([0.5, 0.5], { wPt: 84.2, hPt: 59.5 }, { dispW: 842, dispH: 595, R: 1 });
  assert.ok(Math.abs((rot[2] - rot[0]) - 0.1) < 1e-9 && Math.abs((rot[3] - rot[1]) - 0.1) < 1e-9);
  // Más grande que la página: se reduce.
  const big = placeRect([0.5, 0.5], { wPt: 2000, hPt: 100 }, page);
  assert.ok(big[2] - big[0] <= 0.9 + 1e-9);
});

t('giro: entre -180 y 180, y a pasos de 5°', () => {
  assert.equal(normalizeAngle(190), -170);
  assert.equal(normalizeAngle(-190), 170);
  assert.equal(normalizeAngle(180), -180);
  assert.equal(snapAngle(17), 15);
  assert.equal(snapAngle(-3), -5);
  assert.equal(snapAngle(363), 5);
});

t('recientes: el último primero, sin repetir, como mucho 6, solo los válidos', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  rememberStamp(storage, { kind: 'preset', id: 'paid' });
  rememberStamp(storage, { kind: 'text', text: 'Revisado', color: '#B91C1C', meta: true });
  rememberStamp(storage, { kind: 'preset', id: 'paid' });
  assert.deepEqual(loadRecentStamps(storage).map((d) => d.id ?? d.text), ['paid', 'Revisado']);
  for (const id of ['received', 'approved', 'posted', 'rejected', 'copy']) rememberStamp(storage, { kind: 'preset', id });
  assert.equal(loadRecentStamps(storage).length, 6);
  rememberStamp(storage, { kind: 'preset', id: 'no-existe' });
  rememberStamp(storage, { kind: 'image', src: 'javascript:alert(1)', wPt: 10, hPt: 10 });
  assert.ok(loadRecentStamps(storage).every((d) => d.id !== 'no-existe' && d.kind !== 'image'));
  store.set('spiderpdf:sellos', '{ roto');
  assert.deepEqual(loadRecentStamps(storage), []);
  assert.deepEqual(loadRecentStamps(null), []);
});

t('estado: aplicar un sello a otras páginas (mismo sitio y tamaño en puntos), en un solo paso de deshacer', () => {
  const A = { docId: 1, name: 'A' };
  let s = reducer(initialState, { type: 'open', sources: [A], pages: pagesFrom(A, [{ width: 595, height: 842 }, { width: 842, height: 595 }, { width: 595, height: 842 }]), file: null });
  const [k0, k1, k2] = s.pages.map((p) => p.key);
  s = reducer(s, { type: 'addAnnot', key: k0, annot: { type: 'stamp', rect: [0.4, 0.1, 0.6, 0.2], k: 0, angle: 15, src: 'data:image/png;base64,x', label: 'Pagado' } });
  const id = s.pages[0].annots[0].id;
  const steps = s.past.length;
  s = reducer(s, { type: 'copyAnnotTo', key: k0, id, keys: new Set([k0, k1, k2]) });
  assert.equal(s.past.length, steps + 1);
  assert.deepEqual(s.pages.map((p) => p.annots.length), [1, 1, 1]);
  const [, b, c] = s.pages.map((p) => p.annots[0]);
  assert.equal(b.angle, 15);
  assert.notEqual(b.id, id);
  assert.notEqual(b.id, c.id);
  assert.ok(Math.abs((b.rect[2] - b.rect[0]) * 842 - 119) < 1e-6, 'mismo ancho en puntos en la apaisada');
  assert.deepEqual(c.rect.map((v) => Math.round(v * 1e9) / 1e9), [0.4, 0.1, 0.6, 0.2]);
  s = reducer(s, { type: 'undo' });
  assert.deepEqual(s.pages.map((p) => p.annots.length), [1, 0, 0]);
  assert.equal(reducer(s, { type: 'copyAnnotTo', key: k0, id, keys: new Set([k0]) }), s, 'solo la suya: nada');
});

console.log(`\n${passed} pruebas de sellos superadas.`);
