// Idiomas de la interfaz: español (el original), inglés y catalán. Puro: se prueba en Node (test/i18n.test.js).
//
//   t('clave', { n: 3 })         → texto en el idioma actual, con {n} sustituido.
//   t('paginas', { count: 3 })   → plural: busca 'paginas_one' / 'paginas_other' (Intl.PluralRules) y si no, 'paginas'.
//   useT()                        → t para componentes de React (se vuelven a pintar al cambiar el idioma).
//
// Los textos están repartidos por áreas en src/i18n/strings/*.js ({ es, en, ca }); catalog.js los junta. Si falta
// una traducción se usa el español (y si tampoco está, la clave, para que se vea en las pruebas).
// El idioma: el elegido en Preferencias o, en «Automático», el del sistema (navigator.languages, que en Electron es el
// de Windows/macOS): catalán → català, español → español, inglés u otro cualquiera → inglés.
import { useSyncExternalStore } from 'react';
import { CATALOG } from './catalog.js';

export const LANGS = ['es', 'en', 'ca'];
/** Nombre de cada idioma en su propio idioma (selector de Preferencias). */
export const LANG_NAMES = { es: 'Español', en: 'English', ca: 'Català' };
const FALLBACK = 'en'; // idioma del sistema que no tenemos

let current = 'es';
let localeTag = 'es-ES';
const listeners = new Set();

/**
 * Idioma de la interfaz según el idioma principal del sistema (el primero de la lista: Chromium añade detrás los
 * secundarios, y un Windows en francés con español instalado debe salir en inglés, no en español).
 */
export function detectLang(languages = []) {
  const base = String(languages[0] ?? '').toLowerCase().split(/[-_]/)[0];
  return LANGS.includes(base) ? base : FALLBACK;
}

/** pref: 'auto' | 'es' | 'en' | 'ca' (Preferencias). */
export function resolveLang(pref, languages) {
  return LANGS.includes(pref) ? pref : detectLang(languages);
}

/** Etiqueta para Intl (números y fechas): la del sistema si es del mismo idioma (en-US / en-GB), si no, la del idioma. */
export function localeFor(lang, languages = []) {
  const same = languages.find((tag) => String(tag).toLowerCase().split(/[-_]/)[0] === lang && /[-_]/.test(tag));
  return same ? String(same).replace('_', '-') : { es: 'es-ES', en: 'en-GB', ca: 'ca-ES' }[lang];
}

export const getLang = () => current;
export const getLocale = () => localeTag;

export function setLang(lang, languages = []) {
  const next = LANGS.includes(lang) ? lang : FALLBACK;
  const tag = localeFor(next, languages);
  if (next === current && tag === localeTag) return;
  current = next;
  localeTag = tag;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const rules = new Map();
function pluralCategory(n) {
  if (!rules.has(current)) rules.set(current, new Intl.PluralRules(current));
  return rules.get(current).select(n);
}

function lookup(key) {
  return CATALOG[current]?.[key] ?? CATALOG.es[key];
}

/** Texto traducido. params: { nombre: valor } para {nombre}; count elige el plural. */
export function t(key, params) {
  let s;
  if (params && typeof params.count === 'number') s = lookup(`${key}_${pluralCategory(params.count)}`) ?? lookup(`${key}_other`);
  s ??= lookup(key);
  if (s == null) return key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) => (params[name] == null ? m : String(params[name])));
}

/** ¿Existe la clave? (para textos opcionales). */
export const has = (key) => lookup(key) != null;

/** Número con el formato del idioma (miles y decimales). */
export const formatNumber = (n, opts) => new Intl.NumberFormat(localeTag, opts).format(n);

/** Hook de React: devuelve t y vuelve a pintar el componente cuando cambia el idioma. */
export function useT() {
  useSyncExternalStore(subscribe, getLang, getLang);
  return t;
}
