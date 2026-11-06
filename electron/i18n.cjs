// Idioma del proceso principal (diálogos nativos, menú de macOS, ventana de impresión…). Mismas reglas que
// src/i18n/index.js: catalán → ca, español → es, inglés u otro → en. Al arrancar, el del sistema (app.getLocale(),
// que respeta --lang); en cuanto la ventana carga, manda el que se usa de verdad (Preferencias) con «app:setLang».
// Los textos están en strings.json ({ es, en, ca }; lo comprueba test/i18n.test.js).
const STRINGS = require('./strings.json');

const LANGS = ['es', 'en', 'ca'];
let lang = 'es';
const listeners = new Set();

/** Idioma principal del sistema (el primero); si no es uno de los nuestros, inglés. */
function detect(languages = []) {
  const base = String(languages[0] ?? '').toLowerCase().split(/[-_]/)[0];
  return LANGS.includes(base) ? base : 'en';
}

function setLang(next) {
  const l = LANGS.includes(next) ? next : 'en';
  if (l === lang) return;
  lang = l;
  listeners.forEach((fn) => fn(l));
}

/** Texto en el idioma actual; {nombre} se sustituye con params. Sin traducción: el español; sin clave: la clave. */
function T(key, params) {
  const s = STRINGS[lang]?.[key] ?? STRINGS.es[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, n) => (params[n] == null ? m : String(params[n]))) : s;
}

/** Etiqueta de menu.json ({ es, en, ca }) en el idioma actual. */
const label = (l) => (typeof l === 'string' ? l : l?.[lang] ?? l?.es ?? '');

module.exports = { T, label, setLang, detect, getLang: () => lang, onChange: (fn) => listeners.add(fn), LANGS };
