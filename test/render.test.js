// Pruebas de src/renderDraw.js (dibujar páginas sin falsos «No se pudo mostrar»).  Ejecutar: npm test
import assert from 'node:assert/strict';
import { createTurns, drawLatest, isClosed } from '../src/renderDraw.js';

let passed = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const bmp = (w = 10) => ({ width: w, height: w });
const closed = () => ({ width: 0, height: 0 });
const later = (v, ms = 5) => new Promise((r) => setTimeout(() => r(v), ms));
const fails = (ms = 5) => new Promise((_, rej) => setTimeout(() => rej(new Error('fallo')), ms));

t('un bitmap cerrado mide 0 × 0', () => {
  assert.equal(isClosed(closed()), true);
  assert.equal(isClosed(bmp()), false);
  assert.equal(isClosed(null), true);
});

t('dibuja el render normal', async () => {
  const turns = createTurns();
  const drawn = [];
  assert.equal(await drawLatest(turns.next(), () => later(bmp()), (b) => drawn.push(b)), 'drawn');
  assert.equal(drawn.length, 1);
});

t('si un render obsoleto falla, no cuenta: el último sí se dibuja', async () => {
  const turns = createTurns();
  const old = turns.next();
  const recent = turns.next();
  const drawn = [];
  const r1 = drawLatest(old, () => fails(10), (b) => drawn.push(b)).catch((e) => e);
  const r2 = drawLatest(recent, () => later(bmp(20), 2), (b) => drawn.push(b));
  assert.equal(await r2, 'drawn');
  // El viejo falla después, pero como ya no es el último turno ni siquiera llega a lanzar.
  const res1 = await r1;
  assert.ok(res1 instanceof Error); // drawLatest lanza; quien llama comprueba el turno antes de marcar error
  assert.equal(old.current(), false);
  assert.deepEqual(drawn, [bmp(20)]);
});

t('un render obsoleto que termina bien no pinta encima del último', async () => {
  const turns = createTurns();
  const old = turns.next();
  const recent = turns.next();
  const drawn = [];
  assert.equal(await drawLatest(old, () => later(bmp(5)), (b) => drawn.push(b)), 'stale');
  assert.equal(await drawLatest(recent, () => later(bmp(9)), (b) => drawn.push(b)), 'drawn');
  assert.deepEqual(drawn, [bmp(9)]);
});

t('bitmap cerrado por la caché: reintenta una vez con un render nuevo', async () => {
  const turns = createTurns();
  const asked = [];
  const drawn = [];
  const r = await drawLatest(turns.next(), (fresh) => { asked.push(fresh); return later(fresh ? bmp(7) : closed()); }, (b) => drawn.push(b));
  assert.equal(r, 'drawn');
  assert.deepEqual(asked, [false, true]);
  assert.deepEqual(drawn, [bmp(7)]);
});

t('si se cierra justo al dibujar, también reintenta una vez', async () => {
  const turns = createTurns();
  const first = bmp(4);
  let tries = 0;
  const r = await drawLatest(turns.next(), (fresh) => later(fresh ? bmp(8) : first), (b) => {
    tries++;
    if (b === first) { first.width = 0; first.height = 0; throw new Error('InvalidStateError'); }
  });
  assert.equal(r, 'drawn');
  assert.equal(tries, 2);
});

t('solo un reintento: si vuelve a llegar cerrado, es un error de verdad', async () => {
  const turns = createTurns();
  await assert.rejects(drawLatest(turns.next(), () => later(closed()), () => {}), /cerrado dos veces/);
});

for (const [name, fn] of tests) { await fn(); passed++; console.log('  ok -', name); }
console.log(`\n${passed} pruebas de render superadas.`);
