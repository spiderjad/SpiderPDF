// PDFs protegidos con contraseña: permisos y qué permiten editar. Puro (sin DOM); lo usan la interfaz y el motor
// y se prueba en Node (test/security.test.js).
//
// Un PDF cifrado tiene una contraseña para abrir (la «de usuario», puede estar vacía) y otra de permisos (la «de
// propietario»). Abierto con la de abrir, valen las restricciones de /P; con la de permisos, todo está permitido.
// Las contraseñas NUNCA salen del worker de PDFium: aquí solo se manejan los bits de permiso.
import { t } from './i18n/index.js';

/** Bits de /P (ISO 32000, tabla 22). */
export const PERM = {
  print: 1 << 2, // imprimir
  modify: 1 << 3, // cambiar el contenido
  copy: 1 << 4, // copiar texto e imágenes
  annotate: 1 << 5, // anotar y rellenar formularios
  fillForms: 1 << 8, // rellenar formularios (aunque no se pueda anotar)
  accessibility: 1 << 9, // extraer para accesibilidad (se deja siempre)
  assemble: 1 << 10, // insertar, girar y quitar páginas
  printHigh: 1 << 11, // imprimir en alta calidad (si está activo, PDFium activa también imprimir)
};

/** Todo permitido: todos los bits menos los dos primeros, que deben ser 0. */
export const ALL_PERMS = 0xfffffffc | 0;

const EDIT_BITS = PERM.modify | PERM.annotate | PERM.fillForms | PERM.assemble;

/** Bits de /P para lo que se elige al proteger: { print, copy, edit } (true = permitido). */
export function permsFor({ print = true, copy = true, edit = true } = {}) {
  let p = ALL_PERMS;
  if (!print) p &= ~(PERM.print | PERM.printHigh);
  if (!copy) p &= ~PERM.copy;
  if (!edit) p &= ~EDIT_BITS;
  return p | 0;
}

/** Lo contrario: qué permiten unos bits, como las casillas del diálogo. */
export function choicesFrom(perms) {
  return { print: !!(perms & PERM.print), copy: !!(perms & PERM.copy), edit: !!(perms & PERM.modify) };
}

/** ¿Unos bits lo permiten todo (lo que importa aquí)? */
export function allAllowed(perms) {
  const need = PERM.print | PERM.modify | PERM.copy | PERM.annotate | PERM.fillForms | PERM.assemble;
  return (perms & need) === need;
}

/**
 * Qué permite un PDF protegido abierto: security = { encrypted, owner, perms } (perms: los efectivos, ya con la
 * contraseña usada). Mismo vocabulario que editPolicy (src/signed.js) más imprimir y copiar.
 */
export function permsPolicy(security) {
  if (!security?.encrypted || security.owner) return null;
  const p = security.perms;
  return {
    pages: !!(p & (PERM.assemble | PERM.modify)),
    content: !!(p & PERM.modify),
    annots: !!(p & PERM.annotate),
    forms: !!(p & (PERM.annotate | PERM.fillForms)),
    print: !!(p & PERM.print),
    copy: !!(p & PERM.copy),
  };
}

/** Lo que no permite, en una frase: «editar, imprimir ni copiar». */
export function deniedText(pol) {
  const list = [];
  if (!pol.content || !pol.pages) list.push(t('dialogs.security.deniedEdit'));
  if (!pol.print) list.push(t('dialogs.security.deniedPrint'));
  if (!pol.copy) list.push(t('dialogs.security.deniedCopy'));
  return list.length > 1 ? t('dialogs.security.deniedList', { list: list.slice(0, -1).join(', '), last: list.at(-1) }) : list[0] ?? '';
}

/** Aviso al abrir un PDF con restricciones (null si no tiene). */
export function permsNotice(pol) {
  if (!pol) return null;
  const denied = deniedText(pol);
  if (!denied) return null;
  return t('dialogs.security.notice', { denied });
}

/** ¿Se puede cambiar o quitar la protección? Con la contraseña de permisos, o si la de abrir ya lo permite todo. */
export function canChangeSecurity(security) {
  return !security?.encrypted || !!security.owner || allAllowed(security.perms);
}

/** Comprobación de la contraseña nueva en el diálogo «Proteger»: mensaje de error o null. */
export function checkNewPassword(pw, repeat) {
  if (!pw) return t('dialogs.security.pwEmpty');
  if (pw.length < 4) return t('dialogs.security.pwShort');
  if (pw.length > 127) return t('dialogs.security.pwLong');
  if (repeat !== undefined && pw !== repeat) return t('dialogs.security.pwMismatch');
  return null;
}
