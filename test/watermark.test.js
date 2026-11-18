// Pruebas de la marca de agua (src/watermark.js y las acciones setWatermark / removeWatermarks).  Ejecutar: npm test
import assert from 'node:assert/strict';
import {
  DEFAULT_WM, normalizeWm, wmReady, wmAngle, wmPlacements, imageBox, wmTargets, loadWmPrefs, saveWmPrefs, WM_STORE,
} from '../src/watermark.js';
import { reducer, initialState, pagesFrom } from '../src/state.js';
import { allows, editPolicy } from '../src/signed.js';
import { setLang } from '../src/i18n/index.js';

setLang('es');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };
const A4 = { W: 595, H: 842 };

t('normalizar: valores fuera de rango, colores y opciones desconocidas vuelven a lo razonable', () => {
  assert.deepEqual(normalizeWm({}), DEFAULT_WM);
  const w = normalizeWm({ kind: 'image', text: 'a\nb', size: 9999, opacity: 0, color: 'red', rotation: 'loca', angle: 400, position: 'tile', layer: 'back', scale: 3 });
  assert.equal(w.kind, 'image');
  assert.equal(w.text, 'a b');
  assert.equal(w.size, 300);
  assert.equal(w.opacity, 0.05);
  assert.equal(w.color, DEFAULT_WM.color);
  assert.equal(w.rotation, 'diagonal');
  assert.equal(w.angle, 180);
  assert.equal(w.position, 'tile');
  assert.equal(w.layer, 'back');
  assert.equal(w.scale, 1);
  assert.equal(w.image, null, 'una imagen sin tamaño no vale');
  assert.equal(normalizeWm({ color: '#b91c1c' }).color, '#B91C1C');
  assert.equal(normalizeWm({ text: 'x'.repeat(100) }).text.length, 60);
});

t('lista para aplicar: texto con algo escrito; imagen, con imagen', () => {
  assert.equal(wmReady({ kind: 'text', text: '  ' }), false);
  assert.equal(wmReady({ kind: 'text', text: 'BORRADOR' }), true);
  assert.equal(wmReady({ kind: 'image', image: null }), false);
  assert.equal(wmReady({ kind: 'image', image: { src: 'data:image/png;base64,AA', pxW: 2, pxH: 1 } }), true);
});

t('giro: diagonal de la página (de abajo a la izquierda a arriba a la derecha), horizontal, vertical u otro', () => {
  assert.ok(Math.abs(wmAngle({ rotation: 'diagonal' }, 595, 842) - 54.75) < 0.1);
  assert.ok(Math.abs(wmAngle({ rotation: 'diagonal' }, 842, 595) - 35.25) < 0.1, 'apaisada: más tumbada');
  assert.equal(wmAngle({ rotation: 'horizontal' }, 595, 842), 0);
  assert.equal(wmAngle({ rotation: 'vertical' }, 595, 842), 90);
  assert.equal(wmAngle({ rotation: 'custom', angle: -30 }, 595, 842), -30);
});

t('centrada: una sola copia en el centro', () => {
  const r = wmPlacements({ ...DEFAULT_WM }, A4, { w: 400, h: 50 });
  assert.deepEqual(r.centers, [[297.5, 421]]);
});

t('en mosaico: copias que cubren toda la página, sin solaparse, y solo las que se ven', () => {
  const wm = { ...DEFAULT_WM, position: 'tile', rotation: 'horizontal' };
  const box = { w: 120, h: 30 };
  const { centers } = wmPlacements(wm, A4, box);
  assert.ok(centers.length >= 20 && centers.length < 80, `copias: ${centers.length}`);
  // Todas tocan la página.
  for (const [x, y] of centers) assert.ok(x + 60 > 0 && x - 60 < 595 && y + 15 > 0 && y - 15 < 842);
  // Cubren las esquinas (hay copias cerca de cada una).
  for (const [cx, cy] of [[0, 0], [595, 0], [0, 842], [595, 842]]) {
    assert.ok(centers.some(([x, y]) => Math.abs(x - cx) < 200 && Math.abs(y - cy) < 120), `esquina ${cx},${cy}`);
  }
  // Sin solaparse: en la misma fila, separadas al menos el ancho; entre filas, al menos el alto.
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const dx = Math.abs(centers[i][0] - centers[j][0]); const dy = Math.abs(centers[i][1] - centers[j][1]);
      assert.ok(dx >= 120 || dy >= 30, `solapan: ${centers[i]} ${centers[j]}`);
    }
  }
  // Giradas: también cubren la página, y el orden es estable (de arriba abajo).
  const diag = wmPlacements({ ...wm, rotation: 'diagonal' }, A4, box);
  assert.ok(diag.centers.length >= 20);
  assert.deepEqual(diag.centers, [...diag.centers].sort((p, q) => p[1] - q[1] || p[0] - q[0]));
  // Un texto diminuto no llena la página de miles de copias.
  assert.ok(wmPlacements(wm, A4, { w: 1, h: 1 }).centers.length <= 400);
});

t('imagen: su ancho es una fracción del de la página y conserva la proporción', () => {
  assert.deepEqual(imageBox({ scale: 0.5, image: { pxW: 200, pxH: 100 } }, 600), { w: 300, h: 150 });
});

t('páginas: todas, un intervalo («1-2, 4») o las seleccionadas (con sus errores)', () => {
  const pages = ['a', 'b', 'c', 'd'].map((key) => ({ key }));
  assert.deepEqual(wmTargets(pages, 'all').keys, ['a', 'b', 'c', 'd']);
  assert.deepEqual(wmTargets(pages, 'range', { range: '1-2, 4' }).keys, ['a', 'b', 'd']);
  assert.match(wmTargets(pages, 'range', { range: '9' }).error, /4/);
  assert.ok(wmTargets(pages, 'range', { range: '' }).error);
  assert.deepEqual(wmTargets(pages, 'selection', { selected: new Set(['c']) }).keys, ['c']);
  assert.equal(wmTargets(pages, 'selection', { selected: new Set() }).error, 'selection');
});

t('se recuerda lo último (sin la imagen)', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveWmPrefs(storage, { ...DEFAULT_WM, text: 'COPIA', opacity: 0.5, kind: 'image', image: { src: 'data:image/png;base64,AA', pxW: 1, pxH: 1 } });
  assert.ok(!store.get(WM_STORE).includes('data:image'));
  const back = loadWmPrefs(storage);
  assert.equal(back.text, 'COPIA');
  assert.equal(back.opacity, 0.5);
  assert.equal(back.image, null);
  assert.deepEqual(loadWmPrefs({ getItem: () => '{roto' }), DEFAULT_WM);
  assert.deepEqual(loadWmPrefs({ getItem: () => { throw new Error('sin permiso'); } }), DEFAULT_WM);
});

// --- estado ------------------------------------------------------------------------------------------------
const opened = () => reducer(initialState, {
  type: 'open',
  sources: [{ docId: 1, name: 'a.pdf' }],
  pages: pagesFrom({ docId: 1, name: 'a.pdf' }, [{ width: 595, height: 842 }, { width: 595, height: 842 }, { width: 595, height: 842 }]),
  file: { path: 'C:/a.pdf' },
});

t('setWatermark: en las páginas elegidas, un solo paso de deshacer; sustituye y marca las guardadas para quitarlas', () => {
  let s = opened();
  const [a, b, c] = s.pages.map((p) => p.key);
  const wm = normalizeWm({ text: 'BORRADOR' });
  s = reducer(s, { type: 'setWatermark', keys: [a, c], watermark: wm, strip: new Set([c]) });
  assert.equal(s.dirty, true);
  assert.deepEqual(s.pages.map((p) => !!p.watermark), [true, false, true]);
  assert.deepEqual(s.pages.map((p) => !!p.stripWm), [false, false, true]);
  const other = normalizeWm({ text: 'COPIA' });
  s = reducer(s, { type: 'setWatermark', keys: [a], watermark: other, strip: new Set() });
  assert.equal(s.pages[0].watermark.text, 'COPIA');
  s = reducer(s, { type: 'undo' });
  assert.equal(s.pages[0].watermark.text, 'BORRADOR');
  s = reducer(s, { type: 'undo' });
  assert.deepEqual(s.pages.map((p) => !!p.watermark), [false, false, false]);
  // Nada que hacer: el mismo estado.
  assert.equal(reducer(s, { type: 'setWatermark', keys: ['zz'], watermark: wm }), s);
  assert.equal(reducer(s, { type: 'setWatermark', keys: [b], watermark: null }), s);
});

t('removeWatermarks: quita las pendientes y marca las guardadas; sin nada que quitar, no cambia', () => {
  let s = opened();
  const [a, b] = s.pages.map((p) => p.key);
  assert.equal(reducer(s, { type: 'removeWatermarks', strip: new Set() }), s);
  s = reducer(s, { type: 'setWatermark', keys: [a], watermark: normalizeWm({ text: 'X' }) });
  s = reducer(s, { type: 'removeWatermarks', strip: new Set([b]) });
  assert.deepEqual(s.pages.map((p) => [!!p.watermark, !!p.stripWm]), [[false, false], [false, true], [false, false]]);
  s = reducer(s, { type: 'undo' });
  assert.equal(s.pages[0].watermark.text, 'X');
  assert.equal(!!s.pages[1].stripWm, false);
});

t('PDF certificado o protegido sin cambiar el contenido: no se permite', () => {
  const certified = editPolicy([{ docId: 1, signed: 1, mdp: 2 }]);
  assert.equal(allows(certified, { type: 'setWatermark' }), false);
  assert.equal(allows(certified, { type: 'removeWatermarks' }), false);
  assert.equal(allows(editPolicy([{ docId: 1 }]), { type: 'setWatermark' }), true);
});

console.log(`\n${passed} pruebas superadas.`);
