// Junta los textos de todas las áreas: { es: { clave: texto }, en: {…}, ca: {…} }.
// Una clave repetida entre áreas es un error (lo comprueba test/i18n.test.js).
import core from './strings/core.js';
import dialogs from './strings/dialogs.js';
import exportStrings from './strings/export.js';
import reader from './strings/reader.js';
import engine from './strings/engine.js';

export const AREAS = { core, dialogs, export: exportStrings, reader, engine };

export const CATALOG = { es: {}, en: {}, ca: {} };
for (const area of Object.values(AREAS)) {
  for (const lang of Object.keys(CATALOG)) Object.assign(CATALOG[lang], area[lang]);
}
