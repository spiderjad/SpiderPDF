// Idiomas (src/i18n): detección, plurales y que el catálogo está completo en los tres idiomas.  npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t, setLang, getLang, getLocale, detectLang, resolveLang, localeFor, LANGS } from '../src/i18n/index.js';
import { AREAS, CATALOG } from '../src/i18n/catalog.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`); };
const params = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('detección: catalán → ca, español → es, inglés y cualquier otro → en', () => {
  assert.equal(detectLang(['ca-ES', 'es-ES']), 'ca');
  assert.equal(detectLang(['es-ES']), 'es');
  assert.equal(detectLang(['es-AR', 'en-US']), 'es');
  assert.equal(detectLang(['en-US']), 'en');
  assert.equal(detectLang(['fr-FR', 'de-DE']), 'en');
  assert.equal(detectLang(['fr-FR', 'es-ES']), 'en', 'solo cuenta el idioma principal del sistema');
  assert.equal(detectLang([]), 'en');
  assert.equal(detectLang(['ca_ES']), 'ca');
  assert.equal(resolveLang('auto', ['ca-ES']), 'ca');
  assert.equal(resolveLang('es', ['ca-ES']), 'es', 'lo elegido en Preferencias manda');
  assert.equal(resolveLang('xx', ['de-DE']), 'en');
  assert.equal(localeFor('en', ['en-US']), 'en-US');
  assert.equal(localeFor('en', ['fr-FR']), 'en-GB');
  assert.equal(localeFor('ca', []), 'ca-ES');
});

test('catálogo: cada área tiene es, en y ca con las mismas claves y los mismos {parámetros}', () => {
  const problems = [];
  for (const [name, area] of Object.entries(AREAS)) {
    for (const lang of LANGS) assert.ok(area[lang] && typeof area[lang] === 'object', `${name}: falta ${lang}`);
    for (const key of Object.keys(area.es)) {
      for (const lang of ['en', 'ca']) {
        if (!(key in area[lang])) problems.push(`${name}.${lang}: falta «${key}»`);
        else if (params(area[lang][key]) !== params(area.es[key])) problems.push(`${name}.${lang}: {parámetros} distintos en «${key}»`);
        else if (!String(area[lang][key]).trim()) problems.push(`${name}.${lang}: «${key}» vacía`);
      }
    }
    for (const lang of ['en', 'ca']) for (const key of Object.keys(area[lang])) if (!(key in area.es)) problems.push(`${name}.${lang}: «${key}» sobra (no está en es)`);
  }
  assert.deepEqual(problems, []);
});

test('catálogo: ninguna clave repetida entre áreas', () => {
  const seen = new Map();
  const dup = [];
  for (const [name, area] of Object.entries(AREAS)) {
    for (const key of Object.keys(area.es)) { if (seen.has(key)) dup.push(`${key} (${seen.get(key)} y ${name})`); seen.set(key, name); }
  }
  assert.deepEqual(dup, []);
});

test('plurales: _one / _other con las reglas de cada idioma', () => {
  CATALOG.es['test.pages_one'] = '{count} página'; CATALOG.es['test.pages_other'] = '{count} páginas';
  CATALOG.en['test.pages_one'] = '{count} page'; CATALOG.en['test.pages_other'] = '{count} pages';
  try {
    setLang('es');
    assert.equal(t('test.pages', { count: 1 }), '1 página');
    assert.equal(t('test.pages', { count: 3 }), '3 páginas');
    setLang('en', ['en-US']);
    assert.equal(getLocale(), 'en-US');
    assert.equal(t('test.pages', { count: 1 }), '1 page');
    assert.equal(t('test.pages', { count: 0 }), '0 pages');
    setLang('ca');
    assert.equal(t('test.pages', { count: 2 }), '2 páginas', 'sin traducción: el español');
    assert.equal(t('no.existe'), 'no.existe');
    assert.equal(t('test.pages_one', { count: 'x' }), 'x página', 'un count que no es número no elige plural (pero se sustituye)');
  } finally {
    for (const l of LANGS) { delete CATALOG[l]['test.pages_one']; delete CATALOG[l]['test.pages_other']; }
    setLang('es');
  }
  assert.equal(getLang(), 'es');
});

test('menú: cada etiqueta de menu.json está en los tres idiomas', () => {
  const menu = JSON.parse(readFileSync(new URL('../electron/menu.json', import.meta.url), 'utf8'));
  const missing = [];
  const walk = (items) => items.forEach((it) => {
    if (typeof it === 'string' || it.sep) return; // separadores
    for (const v of [it.accel, it.mac?.accel, it.cmd].filter(Boolean)) if (v !== v.trim()) missing.push(`espacios en «${v}»`);
    for (const lang of LANGS) if (!it.label?.[lang]) missing.push(`${JSON.stringify(it.label)} (${lang})`);
    if (it.mac?.label) for (const lang of LANGS) if (!it.mac.label[lang]) missing.push(`mac ${JSON.stringify(it.mac.label)} (${lang})`);
    if (Array.isArray(it.items)) walk(it.items);
  });
  walk(menu);
  assert.deepEqual(missing, []);
});

test('proceso principal: electron/strings.json con las mismas claves y {parámetros} en los tres idiomas', () => {
  const s = JSON.parse(readFileSync(new URL('../electron/strings.json', import.meta.url), 'utf8'));
  const problems = [];
  for (const key of Object.keys(s.es)) for (const lang of ['en', 'ca']) {
    if (!(key in s[lang])) problems.push(`${lang}: falta ${key}`);
    else if (params(s[lang][key]) !== params(s.es[key])) problems.push(`${lang}: {parámetros} distintos en ${key}`);
  }
  assert.deepEqual(problems, []);
});

console.log(`\n${passed} pruebas superadas.`);
