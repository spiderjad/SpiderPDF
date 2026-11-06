/**
 * Núcleo PDF basado en PDFium (WebAssembly). No depende del DOM:
 * se ejecuta igual en un Web Worker y en Node (tests).
 *
 * Modelo: los documentos abiertos son "fuentes" que nunca se modifican.
 * La interfaz trabaja con referencias de página:
 *   { docId, index, rot, annots: [...], fields: { annotIndex: valor } }
 * y al guardar compose() parte de una COPIA del PDF original con más páginas
 * (así se conservan formularios, marcadores y metadatos), la reordena, añade
 * páginas de otros PDFs y escribe encima giros, campos, anotaciones y firmas.
 */
import { imageMatrix, fromDisplay, rectToDisplay } from '../geometry.js';
import { familyKey, usesPdfFont, wrapLines, missingChars, LINE_HEIGHT } from '../textbox.js';
import { findMatches, lineRects, hasRealText } from '../textGeom.js';
import { mapOutline, pruneOutline, flatten } from '../outline.js';
import { incrementalPlan } from '../signed.js';
import { ALL_PERMS } from '../security.js';
import { downscaleRGBA, targetSize } from './resample.js';

// «Reducir tamaño»: espacios de color que se pueden pasar a JPEG sin cambiar los colores (gris, RGB, calibrados, ICC
// de 1 o 3 componentes, indexados). CMYK, separaciones y demás se dejan (pasarlos a RGB cambia los colores).
const REDUCIBLE_CS = new Set([1, 2, 4, 5, 7, 10]);
/** Huella de unos bytes (FNV-1a de 32 bits), para reconocer la misma imagen usada en varios sitios. */
function fnv(heap, p, n) {
  let h = 0x811c9dc5;
  for (let i = 0; i < n; i++) h = Math.imul(h ^ heap[p + i], 0x01000193);
  return (h >>> 0).toString(16);
}

const BITMAP_BGRA = 4;
const FPDF_INCREMENTAL = 1;
const FLAG_ANNOT = 0x01;
const OCR_FONT = familyKey('sans', false, false); // fuente de la capa de texto del OCR
const FLAG_REVERSE_BYTE_ORDER = 0x10;
const ANNOT = { TEXT: 1, HIGHLIGHT: 9, INK: 15, POPUP: 16, FILEATTACHMENT: 17, SOUND: 18, WIDGET: 20 };
// «Quitar información oculta»: notas (su texto no se ve en la página), sus ventanas y adjuntos.
const HIDDEN_ANNOTS = new Set([ANNOT.TEXT, ANNOT.POPUP, ANNOT.FILEATTACHMENT, ANNOT.SOUND]);
const OBJ = { TEXT: 1, PATH: 2, IMAGE: 3, SHADING: 4, FORM: 5 };
const ANNOT_FLAG_PRINT = 4;
const FIELD = { 0: 'unknown', 1: 'button', 2: 'checkbox', 3: 'radio', 4: 'combo', 5: 'list', 6: 'text', 7: 'signature' };
const FIELD_READONLY = 1;
const FIELD_MULTILINE = 1 << 12;
const FIELD_PASSWORD = 1 << 13;
const ERRORS = {
  1: 'Error desconocido de PDFium.',
  2: 'No se encontró el archivo o no se pudo leer.',
  3: 'El archivo no es un PDF válido o está dañado.',
  4: 'Este PDF está protegido con contraseña.',
  5: 'Este PDF usa un sistema de seguridad no soportado.',
  6: 'La página no existe o está dañada.',
};

const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export class PdfCore {
  constructor(pdfium) {
    this.m = pdfium;
    this.rt = pdfium.pdfium;
    this.docs = new Map(); // docId -> { handle, ptr, size, form, formInfo }
    this.nextId = 1;
  }

  // --- memoria ------------------------------------------------------------
  heap() { return this.rt.HEAPU8; }
  malloc(n) { return this.rt.wasmExports.malloc(n); }
  free(p) { if (p) this.rt.wasmExports.free(p); }

  withMem(n, fn) {
    const p = this.malloc(n);
    try { return fn(p); } finally { this.free(p); }
  }

  floats(ptr, n) {
    return Array.from({ length: n }, (_, i) => this.rt.getValue(ptr + i * 4, 'float'));
  }

  setFloats(ptr, values) {
    values.forEach((v, i) => this.rt.setValue(ptr + i * 4, v, 'float'));
  }

  /** Cadena JS → UTF-16LE con terminador, en memoria wasm. Liberar con free(). */
  wide(str) {
    const bytes = (str.length + 1) * 2;
    const p = this.malloc(bytes);
    this.rt.stringToUTF16(str, p, bytes);
    return p;
  }

  /** Llama a una función PDFium que devuelve texto UTF-16 en un buffer. */
  readWide(fn) {
    const len = fn(0, 0);
    if (!len || len <= 2) return '';
    return this.withMem(len, (p) => { fn(p, len); return this.rt.UTF16ToString(p); });
  }

  lastError() {
    const code = this.m.FPDF_GetLastError();
    return ERRORS[code] || `Error de PDFium (código ${code}).`;
  }

  // --- documentos -----------------------------------------------------------
  /** Abre un PDF desde bytes. Devuelve { docId, pages: [{ width, height, rot0 }], hasForm, signed (nº de firmas digitales) }. */
  open(bytes, password = '') {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const { handle, ptr } = this.load(data, password);
    const count = this.m.FPDF_GetPageCount(handle);
    const pages = this.withMem(8, (sz) => Array.from({ length: count }, (_, i) => this.pageInfo(handle, i, sz)));
    return this.register(handle, ptr, data.length, pages, password);
  }

  /**
   * Igual que open(), pero cede el control cada pocas páginas: informa del avance con
   * onProgress({ done, total }) y se puede cancelar (isCancelled() → true). Para el worker.
   */
  async openAsync(bytes, password = '', { onProgress, isCancelled, every = 25 } = {}) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const { handle, ptr } = this.load(data, password);
    try {
      const total = this.m.FPDF_GetPageCount(handle);
      const pages = [];
      const sz = this.malloc(8);
      try {
        for (let i = 0; i < total; i++) {
          pages.push(this.pageInfo(handle, i, sz));
          if ((i + 1) % every === 0 || i + 1 === total) {
            onProgress?.({ done: i + 1, total });
            await new Promise((r) => setTimeout(r, 0)); // deja pasar otros mensajes (p. ej. «cancelar»)
            if (isCancelled?.()) throw Object.assign(new Error('Apertura cancelada.'), { cancelled: true });
          }
        }
      } finally {
        this.free(sz);
      }
      return this.register(handle, ptr, data.length, pages, password);
    } catch (e) {
      this.m.FPDF_CloseDocument(handle);
      this.free(ptr);
      throw e;
    }
  }

  /** Tamaño (ya con su /Rotate) y giro propio de una página. */
  pageInfo(handle, i, sz) {
    this.m.FPDF_GetPageSizeByIndexF(handle, i, sz);
    const [width, height] = this.floats(sz, 2);
    const page = this.m.FPDF_LoadPage(handle, i);
    const rot0 = page ? this.m.FPDFPage_GetRotation(page) : 0;
    if (page) this.m.FPDF_ClosePage(page);
    return { width, height, rot0 };
  }

  /**
   * Da de alta un documento cargado. hasForm: tiene AcroForm (FPDF_GetFormType); es inmediato,
   * a diferencia de leer los campos de todas las páginas.
   */
  register(handle, ptr, size, pages, password = '') {
    const docId = this.nextId++;
    // La contraseña se queda aquí (memoria del worker) para hacer copias de trabajo y conservar la protección al
    // guardar. Nunca se devuelve a la interfaz ni se escribe en ningún sitio.
    const entry = { handle, ptr, size, password };
    this.attachForm(entry);
    this.docs.set(docId, entry);
    entry.hasForm = this.m.FPDF_GetFormType(handle) !== 0;
    // Firmas digitales: campos de firma ya firmados (con su /V). Una firma gráfica («Rellenar y firmar») no cuenta.
    // mdp: permisos de la firma de certificación (DocMDP) si la hay: 1 nada, 2 formularios, 3 formularios y notas.
    const signed = Math.max(0, this.m.FPDF_GetSignatureCount(handle));
    let mdp = 0;
    for (let i = 0; i < signed; i++) {
      const sig = this.m.FPDF_GetSignatureObject(handle, i);
      const p = sig ? this.m.FPDFSignatureObj_GetDocMDPPermission(sig) : 0;
      if (p >= 1 && p <= 3) mdp = mdp ? Math.min(mdp, p) : p;
    }
    Object.assign(entry, { signed, mdp, pageCount: pages.length });
    return { docId, pages, hasForm: entry.hasForm, signed, mdp, security: this.security(docId) };
  }

  /**
   * Protección de un documento abierto: { encrypted, revision, owner, perms, userPerms }.
   * owner: se abrió (o desbloqueó) con la contraseña de permisos; perms: los permisos que valen ahora
   * (todos con la de permisos); userPerms: los de quien abre con la contraseña de abrir. Sin contraseñas.
   */
  security(docId) {
    const h = this.doc(docId);
    const revision = this.m.FPDF_GetSecurityHandlerRevision(h);
    if (revision < 0) return { encrypted: false, revision: -1, owner: false, perms: ALL_PERMS, userPerms: ALL_PERMS };
    const owner = !!this.m.EPDF_IsOwnerUnlocked(h);
    return { encrypted: true, revision, owner, perms: owner ? ALL_PERMS : this.m.FPDF_GetDocPermissions(h) | 0, userPerms: this.m.FPDF_GetDocUserPermissions(h) | 0 };
  }

  /** Desbloquea los permisos con la contraseña de propietario. → security(docId); unlocked: si era correcta. */
  unlockOwner(docId, password) {
    const e = this.entry(docId);
    const unlocked = !!password && !!this.m.EPDF_UnlockOwnerPermissions(e.handle, password);
    if (unlocked) e.ownerPassword = password;
    return { ...this.security(docId), unlocked };
  }

  /** Carga bytes en memoria wasm (PDFium NO los copia: viven lo mismo que el documento). */
  load(data, password = '') {
    const ptr = this.malloc(data.length);
    this.heap().set(data, ptr);
    const handle = this.m.FPDF_LoadMemDocument(ptr, data.length, password);
    if (!handle) {
      const msg = this.lastError();
      this.free(ptr);
      // needsPassword: está protegido; wrongPassword: además se probó una contraseña y no era.
      const needsPassword = msg === ERRORS[4];
      throw Object.assign(new Error(needsPassword && password ? 'La contraseña no es correcta.' : msg), { needsPassword, wrongPassword: needsPassword && !!password });
    }
    return { handle, ptr };
  }

  /** Copia independiente de un documento abierto, para editarla sin tocar el original. */
  loadCopy(docId) {
    const d = this.entry(docId);
    const data = this.heap().slice(d.ptr, d.ptr + d.size);
    const copy = { ...this.load(data, d.ownerPassword ?? d.password), size: data.length };
    this.attachForm(copy);
    return copy;
  }

  attachForm(entry) {
    entry.formInfo = this.m.PDFiumExt_OpenFormFillInfo();
    entry.form = this.m.PDFiumExt_InitFormFillEnvironment(entry.handle, entry.formInfo);
  }

  closeEntry(e) {
    if (e.form) this.m.PDFiumExt_ExitFormFillEnvironment(e.form);
    if (e.formInfo) this.m.PDFiumExt_CloseFormFillInfo(e.formInfo);
    this.m.FPDF_CloseDocument(e.handle);
    this.free(e.ptr);
  }

  entry(docId) {
    const d = this.docs.get(docId);
    if (!d) throw new Error(`El documento ${docId} no está abierto.`);
    return d;
  }

  doc(docId) { return this.entry(docId).handle; }

  pageSizes(docId) {
    const h = this.doc(docId);
    const count = this.m.FPDF_GetPageCount(h);
    return this.withMem(8, (sz) => Array.from({ length: count }, (_, i) => {
      this.m.FPDF_GetPageSizeByIndexF(h, i, sz);
      const [width, height] = this.floats(sz, 2);
      const page = this.m.FPDF_LoadPage(h, i);
      const rot0 = page ? this.m.FPDFPage_GetRotation(page) : 0;
      if (page) this.m.FPDF_ClosePage(page);
      return { width, height, rot0 };
    }));
  }

  /** Tamaño de una página tal como se ve (con su /Rotate), sin cargarla. → [width, height] en puntos */
  pageSize(docId, index) {
    return this.withMem(8, (sz) => {
      if (!this.m.FPDF_GetPageSizeByIndexF(this.doc(docId), index, sz)) throw new Error(`No existe la página ${index + 1}.`);
      return this.floats(sz, 2);
    });
  }

  /** Abre una página con el entorno de formularios activo. Siempre cerrar con closePage. */
  openPage(entry, index) {
    const page = this.m.FPDF_LoadPage(entry.handle, index);
    if (!page) throw new Error(this.lastError());
    if (entry.form) this.m.FORM_OnAfterLoadPage(page, entry.form);
    return page;
  }

  closePage(entry, page) {
    if (entry.form) this.m.FORM_OnBeforeClosePage(page, entry.form);
    this.m.FPDF_ClosePage(page);
  }

  /** CropBox (o MediaBox) sin rotar: [izq, abajo, der, arriba] en puntos. */
  box(page) {
    return this.withMem(16, (p) => {
      const ptrs = [p, p + 4, p + 8, p + 12];
      if (!this.m.FPDFPage_GetCropBox(page, ...ptrs)) this.m.FPDFPage_GetMediaBox(page, ...ptrs);
      return this.floats(p, 4);
    });
  }

  // --- render -----------------------------------------------------------------
  /** Renderiza una página a RGBA. scale: píxeles por punto. rot: cuartos de vuelta extra. */
  render(docId, index, scale = 1, rot = 0) {
    const entry = this.entry(docId);
    const page = this.openPage(entry, index);
    try {
      const pw = this.m.FPDF_GetPageWidthF(page);
      const ph = this.m.FPDF_GetPageHeightF(page);
      const swap = rot % 2 === 1;
      const width = Math.max(1, Math.round((swap ? ph : pw) * scale));
      const height = Math.max(1, Math.round((swap ? pw : ph) * scale));
      const bmp = this.m.FPDFBitmap_CreateEx(width, height, BITMAP_BGRA, 0, 0);
      if (!bmp) throw new Error('Sin memoria para renderizar la página.');
      try {
        const flags = FLAG_ANNOT | FLAG_REVERSE_BYTE_ORDER;
        this.m.FPDFBitmap_FillRect(bmp, 0, 0, width, height, 0xffffffff);
        this.m.FPDF_RenderPageBitmap(bmp, page, 0, 0, width, height, rot, flags);
        if (entry.form) this.m.FPDF_FFLDraw(entry.form, bmp, page, 0, 0, width, height, rot, flags);
        const buf = this.m.FPDFBitmap_GetBuffer(bmp);
        const pixels = new Uint8ClampedArray(this.heap().slice(buf, buf + width * height * 4).buffer);
        return { width, height, pixels };
      } finally {
        this.m.FPDFBitmap_Destroy(bmp);
      }
    } finally {
      this.closePage(entry, page);
    }
  }

  // --- formularios ----------------------------------------------------------------
  hasFields(docId) {
    const count = this.m.FPDF_GetPageCount(this.doc(docId));
    for (let i = 0; i < count; i++) if (this.fields(docId, i).length) return true;
    return false;
  }

  /**
   * Campos de formulario de una página, con su caja en fracciones sin rotar.
   * [{ annotIndex, type, name, value, checked, options, rect, readOnly, multiline, password }]
   */
  fields(docId, index) {
    const entry = this.entry(docId);
    if (!entry.form) return [];
    const page = this.openPage(entry, index);
    const out = [];
    try {
      const [l, b, r, t] = this.box(page);
      const n = this.m.FPDFPage_GetAnnotCount(page);
      for (let i = 0; i < n; i++) {
        const annot = this.m.FPDFPage_GetAnnot(page, i);
        try {
          if (this.m.FPDFAnnot_GetSubtype(annot) !== ANNOT.WIDGET) continue;
          const type = FIELD[this.m.FPDFAnnot_GetFormFieldType(entry.form, annot)] ?? 'unknown';
          if (type === 'button' || type === 'signature' || type === 'unknown') continue;
          const rect = this.withMem(16, (p) => (this.m.FPDFAnnot_GetRect(annot, p) ? this.floats(p, 4) : null));
          if (!rect) continue;
          const [left, top, right, bottom] = rect; // FS_RECTF
          const flags = this.m.FPDFAnnot_GetFormFieldFlags(entry.form, annot);
          const field = {
            annotIndex: i,
            type,
            name: this.readWide((p, len) => this.m.FPDFAnnot_GetFormFieldName(entry.form, annot, p, len)),
            value: this.readWide((p, len) => this.m.FPDFAnnot_GetFormFieldValue(entry.form, annot, p, len)),
            rect: [
              (Math.min(left, right) - l) / (r - l), (t - Math.max(top, bottom)) / (t - b),
              (Math.max(left, right) - l) / (r - l), (t - Math.min(top, bottom)) / (t - b),
            ],
            readOnly: !!(flags & FIELD_READONLY),
            multiline: type === 'text' && !!(flags & FIELD_MULTILINE),
            password: type === 'text' && !!(flags & FIELD_PASSWORD),
          };
          if (type === 'checkbox' || type === 'radio') {
            field.checked = this.m.FPDFAnnot_IsChecked(entry.form, annot);
            field.exportValue = this.readWide((p, len) => this.m.FPDFAnnot_GetFormFieldExportValue(entry.form, annot, p, len));
          }
          if (type === 'combo' || type === 'list') {
            const count = this.m.FPDFAnnot_GetOptionCount(entry.form, annot);
            field.options = Array.from({ length: Math.max(0, count) }, (_, k) =>
              this.readWide((p, len) => this.m.FPDFAnnot_GetOptionLabel(entry.form, annot, k, p, len)));
            field.selected = field.options.findIndex((_, k) => this.m.FPDFAnnot_IsOptionSelected(entry.form, annot, k));
          }
          out.push(field);
        } finally {
          this.m.FPDFPage_CloseAnnot(annot);
        }
      }
    } finally {
      this.closePage(entry, page);
    }
    return out;
  }

  /** Escribe valores en los campos de una página. values: { annotIndex: string | boolean | number } */
  fillFields(entry, index, values) {
    const keys = Object.keys(values ?? {});
    if (!keys.length || !entry.form) return;
    const { form } = entry;
    const page = this.openPage(entry, index);
    try {
      for (const key of keys) {
        const annot = this.m.FPDFPage_GetAnnot(page, Number(key));
        if (!annot) continue;
        try {
          const value = values[key];
          const type = FIELD[this.m.FPDFAnnot_GetFormFieldType(form, annot)];
          if (!this.m.FORM_SetFocusedAnnot(form, annot)) continue;
          if (type === 'text') {
            this.m.FORM_SelectAllText(form, page);
            const w = this.wide(String(value));
            this.m.FORM_ReplaceSelection(form, page, w);
            this.free(w);
          } else if (type === 'checkbox' || type === 'radio') {
            const checked = this.m.FPDFAnnot_IsChecked(form, annot);
            if (!!value !== checked && (type === 'checkbox' || value)) this.m.FORM_OnChar(form, page, 32, 0);
          } else if (type === 'combo' || type === 'list') {
            this.m.FORM_SetIndexSelected(form, page, Number(value), true);
          }
          this.m.FORM_ForceToKillFocus(form);
        } finally {
          this.m.FPDFPage_CloseAnnot(annot);
        }
      }
    } finally {
      this.closePage(entry, page);
    }
  }

  // --- anotaciones e imágenes -------------------------------------------------------
  /**
   * Añade anotaciones (en fracciones sin rotar) a una página del documento destino.
   * zones: zonas que se van a redactar. Lo que las toca no se llega a crear (si se creara y luego se
   * quitara, PDFium guardaría igualmente el objeto suelto en el archivo, con su contenido).
   * Las firmas que solo las tocan en parte sí se crean: redact() pinta de negro esa parte de sus píxeles.
   */
  applyAnnots(entry, index, annots, zones = [], fonts = null) {
    if (!annots?.length) return;
    const page = this.openPage(entry, index);
    try {
      const [l, b, r, t] = this.box(page);
      const X = (u) => l + u * (r - l);
      const Y = (v) => t - v * (t - b);
      const unitU = 1 / (r - l); const unitV = 1 / (t - b); // un punto, en fracciones
      const bounds = (a) => {
        if (a.type === 'note') return [a.at[0], a.at[1], a.at[0] + 20 * unitU, a.at[1] + 20 * unitV];
        if (a.type === 'ink') {
          const all = a.strokes.flat();
          const us = all.filter((_, i) => i % 2 === 0); const vs = all.filter((_, i) => i % 2 === 1);
          const pad = (a.width ?? 2) * unitU;
          return [Math.min(...us) - pad, Math.min(...vs) - pad, Math.max(...us) + pad, Math.max(...vs) + pad];
        }
        return a.rect;
      };
      const touches = ([u0, v0, u1, v1]) => zones.some(([a0, b0, a1, b1]) => u0 < a1 && u1 > a0 && v0 < b1 && v1 > b0);
      const within = ([u0, v0, u1, v1]) => zones.some(([a0, b0, a1, b1]) => u0 >= a0 && u1 <= a1 && v0 >= b0 && v1 <= b1);
      let contentChanged = false;
      for (const a of annots) {
        const bx = bounds(a);
        // Firmas y texto nuevo son contenido: dentro de una zona no se crean; si la tocan, la redacción
        // (que va después) les quita lo que cae dentro. El resto de anotaciones que tocan una zona no se crean.
        const content = a.type === 'image' || a.type === 'textbox';
        if (content ? within(bx) : touches(bx)) continue;
        if (a.type === 'image') { this.addImage(entry, page, a, X, Y); contentChanged = true; }
        else if (a.type === 'textbox') {
          if (!a.text?.trim()) continue;
          if (!fonts) throw new Error('Faltan las fuentes del texto nuevo.');
          this.addTextBox(entry, page, a, [l, b, r, t], fonts);
          contentChanged = true;
        } else this.addAnnot(page, a, X, Y);
      }
      if (contentChanged) this.m.FPDFPage_GenerateContent(page);
      // Renderizar la página hace que PDFium genere y guarde la apariencia (/AP)
      // de las anotaciones nuevas, para que se vean igual en cualquier visor.
      const bmp = this.m.FPDFBitmap_CreateEx(1, 1, BITMAP_BGRA, 0, 0);
      this.m.FPDF_RenderPageBitmap(bmp, page, 0, 0, 1, 1, 0, FLAG_ANNOT);
      this.m.FPDFBitmap_Destroy(bmp);
    } finally {
      this.closePage(entry, page);
    }
  }

  addAnnot(page, a, X, Y) {
    const subtype = { highlight: ANNOT.HIGHLIGHT, ink: ANNOT.INK, note: ANNOT.TEXT }[a.type];
    if (!subtype) throw new Error(`Tipo de anotación desconocido: ${a.type}`);
    const annot = this.m.FPDFPage_CreateAnnot(page, subtype);
    if (!annot) throw new Error('No se pudo crear la anotación.');
    try {
      const [cr, cg, cb] = hexToRgb(a.color ?? '#FFD400');
      this.m.FPDFAnnot_SetColor(annot, 0, cr, cg, cb, 255);
      this.m.FPDFAnnot_SetFlags(annot, ANNOT_FLAG_PRINT);
      const setRect = (left, top, right, bottom) =>
        this.withMem(16, (p) => { this.setFloats(p, [left, top, right, bottom]); this.m.FPDFAnnot_SetRect(annot, p); });

      if (a.type === 'highlight') {
        const [u0, v0, u1, v1] = a.rect;
        const [x0, x1, yt, yb] = [X(u0), X(u1), Y(v0), Y(v1)];
        this.withMem(32, (p) => {
          this.setFloats(p, [x0, yt, x1, yt, x0, yb, x1, yb]);
          this.m.FPDFAnnot_AppendAttachmentPoints(annot, p);
        });
        setRect(x0, yt, x1, yb);
      } else if (a.type === 'ink') {
        const width = a.width ?? 2;
        let box = [Infinity, -Infinity, -Infinity, Infinity]; // left, top, right, bottom
        for (const s of a.strokes) {
          const n = s.length / 2;
          if (n < 1) continue;
          this.withMem(n * 8, (p) => {
            const pts = [];
            for (let i = 0; i < s.length; i += 2) {
              const x = X(s[i]); const y = Y(s[i + 1]);
              pts.push(x, y);
              box = [Math.min(box[0], x), Math.max(box[1], y), Math.max(box[2], x), Math.min(box[3], y)];
            }
            this.setFloats(p, pts);
            this.m.FPDFAnnot_AddInkStroke(annot, p, n);
          });
        }
        this.m.FPDFAnnot_SetBorder(annot, 0, 0, width);
        const pad = width;
        setRect(box[0] - pad, box[1] + pad, box[2] + pad, box[3] - pad);
      } else if (a.type === 'note') {
        const x = X(a.at[0]); const y = Y(a.at[1]);
        setRect(x, y, x + 20, y - 20);
        const w = this.wide(a.text ?? '');
        this.m.FPDFAnnot_SetStringValue(annot, 'Contents', w);
        this.free(w);
        if (a.author) {
          const wa = this.wide(a.author);
          this.m.FPDFAnnot_SetStringValue(annot, 'T', wa);
          this.free(wa);
        }
      }
    } finally {
      this.m.FPDFPage_CloseAnnot(annot);
    }
  }

  /** Bitmap de PDFium (BGRA) con los píxeles RGBA dados. Destruir con FPDFBitmap_Destroy. */
  bitmapFromRGBA(width, height, pixels) {
    const bmp = this.m.FPDFBitmap_CreateEx(width, height, BITMAP_BGRA, 0, 0);
    if (!bmp) throw new Error('Sin memoria para la imagen.');
    const buf = this.m.FPDFBitmap_GetBuffer(bmp);
    const heap = this.heap();
    for (let i = 0; i < width * height * 4; i += 4) {
      heap[buf + i] = pixels[i + 2];
      heap[buf + i + 1] = pixels[i + 1];
      heap[buf + i + 2] = pixels[i];
      heap[buf + i + 3] = pixels[i + 3];
    }
    return bmp;
  }

  /**
   * Crea una página nueva en la posición index: en blanco de width × height puntos o, con image
   * ({ width, height, pixels RGBA }), con esa imagen ocupando toda la página.
   */
  createPage(h, index, { width, height, image } = {}) {
    if (!(width > 0 && height > 0)) throw new Error('Tamaño de página no válido.');
    const page = this.m.FPDFPage_New(h, index, width, height);
    if (!page) throw new Error('No se pudo crear la página nueva.');
    try {
      if (!image) return;
      const bmp = this.bitmapFromRGBA(image.width, image.height, image.pixels);
      try {
        const obj = this.m.FPDFPageObj_NewImageObj(h);
        if (!this.m.FPDFImageObj_SetBitmap(0, 0, obj, bmp)) {
          this.m.FPDFPageObj_Destroy(obj);
          throw new Error('No se pudo insertar la imagen.');
        }
        this.m.FPDFImageObj_SetMatrix(obj, width, 0, 0, height, 0, 0);
        this.m.FPDFPage_InsertObject(page, obj);
      } finally {
        this.m.FPDFBitmap_Destroy(bmp);
      }
      this.m.FPDFPage_GenerateContent(page);
    } finally {
      this.m.FPDF_ClosePage(page);
    }
  }

  // --- Texto nuevo (cuadros de texto, ver src/textbox.js) -------------------------------------
  // Para las fuentes incluidas hacen falta, desde fuera: this.fontBytes(clave) → TTF de esa familia y estilo, y
  // this.subsetFont(bytes, texto) → subconjunto (si no hay, se incrusta la fuente entera).

  /** Letras de text que la fuente no tiene: se escribe con ella y se lee de vuelta (PDFium descarta las que faltan). */
  glyphCheck(docHandle, page, font, text) {
    const sample = [...new Set(String(text).replace(/\s+/g, ''))].join('');
    if (!sample) return [];
    const obj = this.m.FPDFPageObj_CreateTextObj(docHandle, font, 12);
    if (!obj) return [...sample];
    const w = this.wide(sample);
    this.m.FPDFText_SetText(obj, w);
    this.free(w);
    this.m.FPDFPage_InsertObject(page, obj);
    const tp = this.m.FPDFText_LoadPage(page);
    try {
      return missingChars(sample, this.readWide((p, len) => this.m.FPDFTextObj_GetText(obj, tp, p, len)));
    } finally {
      this.m.FPDFText_ClosePage(tp);
      this.m.FPDFPage_RemoveObject(page, obj);
      this.m.FPDFPageObj_Destroy(obj);
    }
  }

  /** Fuente del texto objIndex de la página (y su nombre), o null si no es un texto. */
  textObjFont(page, objIndex) {
    if (!(objIndex >= 0 && objIndex < this.m.FPDFPage_CountObjects(page))) return null;
    const o = this.m.FPDFPage_GetObject(page, objIndex);
    if (this.m.FPDFPageObj_GetType(o) !== OBJ.TEXT) return null;
    const font = this.m.FPDFTextObj_GetFont(o);
    return font ? { font, name: this.textStyle(o).fontName } : null;
  }

  /**
   * ¿La fuente del texto objIndex tiene todas las letras de text? → { missing: [letras] } (para avisar al escribir).
   * Se comprueba en el PDF de partida, sin cambiarlo.
   */
  checkGlyphs(docId, index, objIndex, text) {
    const entry = this.entry(docId);
    const page = this.m.FPDF_LoadPage(entry.handle, index);
    if (!page) throw new Error(this.lastError());
    try {
      const f = this.textObjFont(page, objIndex);
      return { missing: f ? this.glyphCheck(entry.handle, page, f.font, text) : [...new Set(String(text).replace(/\s+/g, ''))] };
    } finally {
      this.m.FPDF_ClosePage(page);
    }
  }

  /** Datos de la fuente del texto objIndex (para la vista previa en pantalla), o null. */
  fontData(docId, index, objIndex) {
    const entry = this.entry(docId);
    const page = this.m.FPDF_LoadPage(entry.handle, index);
    if (!page) throw new Error(this.lastError());
    try {
      const f = this.textObjFont(page, objIndex);
      if (!f || !this.m.FPDFFont_GetIsEmbedded(f.font)) return null;
      return this.withMem(4, (outLen) => {
        if (!this.m.FPDFFont_GetFontData(f.font, 0, 0, outLen)) return null;
        const n = this.rt.getValue(outLen, 'i32');
        if (!(n > 0)) return null;
        return this.withMem(n, (p) => (this.m.FPDFFont_GetFontData(f.font, p, n, outLen) ? this.heap().slice(p, p + n) : null));
      });
    } finally {
      this.m.FPDF_ClosePage(page);
    }
  }

  /**
   * Fuentes incluidas para el documento h: una por clave (familia y estilo), subconjuntada con las letras de
   * todos los cuadros que la pueden usar. texts: Map clave → texto. → { get(clave), close() }
   */
  textFonts(h, texts) {
    const handles = new Map();
    return {
      get: (key) => {
        if (handles.has(key)) return handles.get(key);
        if (!this.fontBytes) throw new Error('No están disponibles las fuentes para el texto nuevo.');
        const full = this.fontBytes(key);
        const data = this.subsetFont ? this.subsetFont(full, texts.get(key) ?? '') : full;
        const p = this.malloc(data.length);
        this.heap().set(data, p);
        const font = this.m.FPDFText_LoadFont(h, p, data.length, 2 /* TrueType */, 1 /* CID: texto Unicode */);
        this.free(p);
        if (!font) throw new Error('No se pudo cargar la fuente del texto nuevo.');
        handles.set(key, font);
        return font;
      },
      close: () => { for (const f of handles.values()) this.m.FPDFFont_Close(f); handles.clear(); },
    };
  }

  /** Ancho de una cadena con una fuente y tamaño (en puntos), medido con un objeto de texto provisional. */
  textWidth(h, font, size, s, cache) {
    if (!s.trim()) return 0;
    const key = `${size}|${s}`;
    if (cache?.has(key)) return cache.get(key);
    const obj = this.m.FPDFPageObj_CreateTextObj(h, font, size);
    const w = this.wide(s);
    this.m.FPDFText_SetText(obj, w);
    this.free(w);
    const [x0, , x1] = this.objBounds(obj);
    this.m.FPDFPageObj_Destroy(obj);
    cache?.set(key, x1 - x0);
    return x1 - x0;
  }

  /**
   * Escribe un cuadro de texto en la página como texto real (un objeto por línea). Las líneas se vuelven a
   * partir con las medidas de la fuente de verdad. Con la fuente del PDF solo si tiene todas las letras;
   * si no, la incluida más parecida. → { pdfFont: bool }
   */
  addTextBox(entry, page, a, box, fonts) {
    const h = entry.handle;
    const [l, b, r, t] = box;
    const st = a.style;
    let font = null;
    let pdfFont = false;
    if (usesPdfFont(a)) {
      const f = this.textObjFont(page, st.pdf.objIndex);
      // Mismo objeto que al crear el cuadro (el nombre coincide) y con todas las letras.
      if (f && (!st.pdf.raw || f.name === st.pdf.raw) && !this.glyphCheck(h, page, f.font, a.text).length) {
        font = f.font;
        pdfFont = true;
      }
    }
    font ??= fonts.get(familyKey(st.family, st.bold, st.italic));
    const size = st.size;
    const R = ((a.k ?? 0) % 4 + 4) % 4;
    const Wd = R % 2 ? t - b : r - l;
    const Hd = R % 2 ? r - l : t - b;
    // Punto de la página en pantalla (puntos, con el giro R) → punto PDF.
    const toPdf = (px, py) => {
      const [u, v] = fromDisplay(px / Wd, py / Hd, R);
      return [l + u * (r - l), t - v * (t - b)];
    };
    const d = rectToDisplay(a.rect, R);
    const bx = d.x * Wd;
    const by = d.y * Hd;
    const bw = d.w * Wd;
    const cache = new Map();
    const measure = (s) => this.textWidth(h, font, size, s, cache);
    const lines = wrapLines(a.text, bw + 0.5, measure);
    const [asc, desc] = this.withMem(4, (p) => [
      this.m.FPDFFont_GetAscent(font, size, p) ? this.rt.getValue(p, 'float') : size * 0.8,
      this.m.FPDFFont_GetDescent(font, size, p) ? this.rt.getValue(p, 'float') : -size * 0.2,
    ]);
    const lh = LINE_HEIGHT * size;
    const base0 = (lh - (asc - desc)) / 2 + asc; // línea base de la primera línea, como en CSS
    const [ox, oy] = toPdf(0, 0);
    const [rx, ry] = toPdf(1, 0);
    const [ux, uy] = toPdf(0, -1);
    const rgba = [...hexToRgb(st.color ?? '#000000'), 255];
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const w = measure(line);
      const dx = st.align === 'center' ? (bw - w) / 2 : st.align === 'right' ? bw - w : 0;
      const [px, py] = toPdf(bx + dx, by + base0 + i * lh);
      const obj = this.m.FPDFPageObj_CreateTextObj(h, font, size);
      if (!obj) throw new Error('No se pudo crear el texto.');
      const ws = this.wide(line);
      this.m.FPDFText_SetText(obj, ws);
      this.free(ws);
      this.m.FPDFPageObj_SetFillColor(obj, ...rgba);
      this.m.FPDFPageObj_Transform(obj, rx - ox, ry - oy, ux - ox, uy - oy, px, py);
      this.m.FPDFPage_InsertObject(page, obj);
    });
    return { pdfFont };
  }

  /** Inserta una imagen RGBA (p. ej. una firma) como contenido de la página. */
  addImage(entry, page, a, X, Y) {
    const { width, height, pixels } = a.image;
    const bmp = this.bitmapFromRGBA(width, height, pixels);
    try {
      const obj = this.m.FPDFPageObj_NewImageObj(entry.handle);
      if (!this.m.FPDFImageObj_SetBitmap(0, 0, obj, bmp)) {
        this.m.FPDFPageObj_Destroy(obj);
        throw new Error('No se pudo insertar la imagen.');
      }
      const [u0, v0, u1, v1] = a.rect;
      const x0 = X(u0); const x1 = X(u1); const y0 = Y(v1); const y1 = Y(v0);
      this.m.FPDFImageObj_SetMatrix(obj, ...imageMatrix(a.k ?? 0, x0, y0, x1 - x0, y1 - y0));
      this.m.FPDFPage_InsertObject(page, obj);
    } finally {
      this.m.FPDFBitmap_Destroy(bmp);
    }
  }

  // --- texto existente ------------------------------------------------------------------
  objBounds(o) {
    return this.withMem(16, (p) => { this.m.FPDFPageObj_GetBounds(o, p, p + 4, p + 8, p + 12); return this.floats(p, 4); });
  }

  objMatrix(o) {
    return this.withMem(24, (p) => { this.m.FPDFPageObj_GetMatrix(o, p); return this.floats(p, 6); });
  }

  setObjMatrix(o, mat) {
    this.withMem(24, (p) => { this.setFloats(p, mat); this.m.FPDFPageObj_SetMatrix(o, p); });
  }

  fillColor(o) {
    return this.withMem(16, (p) => {
      this.m.FPDFPageObj_GetFillColor(o, p, p + 4, p + 8, p + 12);
      return [0, 4, 8, 12].map((k) => this.rt.getValue(p + k, 'i32') >>> 0);
    });
  }

  /** Aspecto de un objeto de texto: tamaño, matriz, fuente, color y modo de pintado. */
  textStyle(o) {
    const size = this.withMem(4, (p) => (this.m.FPDFTextObj_GetFontSize(o, p) ? this.rt.getValue(p, 'float') : 12));
    const matrix = this.objMatrix(o);
    const font = this.m.FPDFTextObj_GetFont(o);
    let fontName = '';
    let weight = 400;
    let italic = 0;
    if (font) {
      const len = this.m.FPDFFont_GetBaseFontName(font, 0, 0);
      if (len > 1) {
        fontName = this.withMem(len, (p) => {
          this.m.FPDFFont_GetBaseFontName(font, p, len);
          return new TextDecoder().decode(this.heap().slice(p, p + len - 1));
        });
      }
      weight = this.m.FPDFFont_GetWeight(font);
      italic = this.withMem(4, (p) => (this.m.FPDFFont_GetItalicAngle(font, p) ? this.rt.getValue(p, 'i32') : 0));
    }
    const [r, g, b, a] = this.fillColor(o);
    const [ma, mb, mc, md] = matrix;
    return {
      size, matrix, fontName, weight, italic,
      rgba: [r, g, b, a],
      color: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
      renderMode: this.m.FPDFTextObj_GetTextRenderMode(o),
      ptSize: size * Math.sqrt(Math.abs(ma * md - mb * mc)), // tamaño visible en puntos
      angle: Math.atan2(mb, ma),
    };
  }

  /**
   * Fuente estándar (las 14 de todo lector PDF) más parecida a la original. Se usa al escribir
   * texto nuevo porque las fuentes incrustadas suelen traer solo los glifos que ya se usaban.
   */
  standardFont(name = '', weight = 400, italicAngle = 0) {
    const n = name.toLowerCase().replace(/^[a-z]{6}\+/, '');
    const bold = weight >= 600 || /bold|black|heavy|semibold|demi/.test(n);
    const italic = italicAngle !== 0 || /italic|oblique/.test(n);
    if (/courier|mono|consol/.test(n)) return `Courier${bold || italic ? '-' : ''}${bold ? 'Bold' : ''}${italic ? 'Oblique' : ''}`;
    if (/times|georgia|garamond|roman|cambria|minion|serif/.test(n) && !/sans/.test(n)) {
      return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
    }
    return `Helvetica${bold || italic ? '-' : ''}${bold ? 'Bold' : ''}${italic ? 'Oblique' : ''}`;
  }

  /** Crea un objeto de texto con fuente estándar, copiando el aspecto de style. */
  newTextObj(docHandle, text, style, matrix = style.matrix, size = style.size) {
    const font = this.m.FPDFText_LoadStandardFont(docHandle, this.standardFont(style.fontName, style.weight, style.italic));
    if (!font) throw new Error('No se pudo cargar la fuente para el texto nuevo.');
    try {
      const obj = this.m.FPDFPageObj_CreateTextObj(docHandle, font, size);
      if (!obj) throw new Error('No se pudo crear el texto.');
      const w = this.wide(text);
      this.m.FPDFText_SetText(obj, w);
      this.free(w);
      this.m.FPDFPageObj_SetFillColor(obj, ...style.rgba);
      this.m.FPDFTextObj_SetTextRenderMode(obj, style.renderMode);
      this.setObjMatrix(obj, matrix);
      return obj;
    } finally {
      this.m.FPDFFont_Close(font);
    }
  }

  /**
   * Bloques de texto de una página (objetos de texto de primer nivel), con su caja en fracciones sin rotar.
   * [{ objIndex, text, rect, ptSize, angle, color, fontName }]
   */
  textRuns(docId, index) {
    const entry = this.entry(docId);
    const page = this.m.FPDF_LoadPage(entry.handle, index);
    if (!page) throw new Error(this.lastError());
    const tp = this.m.FPDFText_LoadPage(page);
    try {
      const [l, b, r, t] = this.box(page);
      const out = [];
      const n = this.m.FPDFPage_CountObjects(page);
      for (let i = 0; i < n; i++) {
        const o = this.m.FPDFPage_GetObject(page, i);
        if (this.m.FPDFPageObj_GetType(o) !== OBJ.TEXT) continue;
        const text = this.readWide((p, len) => this.m.FPDFTextObj_GetText(o, tp, p, len));
        if (!text.trim()) continue;
        const [x0, y0, x1, y1] = this.objBounds(o);
        const s = this.textStyle(o);
        out.push({
          objIndex: i, text,
          rect: [(x0 - l) / (r - l), (t - y1) / (t - b), (x1 - l) / (r - l), (t - y0) / (t - b)],
          origin: [(s.matrix[4] - l) / (r - l), (t - s.matrix[5]) / (t - b)], // inicio de la línea base
          ptSize: s.ptSize, angle: s.angle, color: s.color, fontName: s.fontName, weight: s.weight, italic: s.italic,
          invisible: s.renderMode === 3,
        });
      }
      return out;
    } finally {
      this.m.FPDFText_ClosePage(tp);
      this.m.FPDF_ClosePage(page);
    }
  }

  /** Texto de una página tal como lo extrae un lector (para comprobar redacciones). */
  pageText(docId, index) {
    const page = this.m.FPDF_LoadPage(this.doc(docId), index);
    const tp = this.m.FPDFText_LoadPage(page);
    try {
      const n = this.m.FPDFText_CountChars(tp);
      if (n <= 0) return ''; // sin texto, GetText no escribe nada (ni el terminador): se leería basura
      return this.withMem((n + 1) * 2, (p) => { this.m.FPDFText_GetText(tp, 0, n, p); return this.rt.UTF16ToString(p); });
    } finally {
      this.m.FPDFText_ClosePage(tp);
      this.m.FPDF_ClosePage(page);
    }
  }

  /**
   * Texto de una página con la caja de cada carácter, en fracciones sin rotar del CropBox (v hacia abajo).
   * → { text, boxes: Float32Array(4·n), generated: Uint8Array(n), hasText }
   * text[i] es el carácter i de PDFium (los que PDFium añade entre bloques, como «\r\n», van marcados en generated).
   */
  textChars(docId, index) {
    const page = this.m.FPDF_LoadPage(this.doc(docId), index);
    if (!page) throw new Error(this.lastError());
    const tp = this.m.FPDFText_LoadPage(page);
    try {
      const [l, b, r, t] = this.box(page);
      const w = r - l; const h = t - b;
      const n = Math.max(0, this.m.FPDFText_CountChars(tp));
      const boxes = new Float32Array(n * 4);
      const generated = new Uint8Array(n);
      let text = '';
      this.withMem(32, (p) => {
        for (let i = 0; i < n; i++) {
          text += String.fromCharCode(this.m.FPDFText_GetUnicode(tp, i));
          generated[i] = this.m.FPDFText_IsGenerated(tp, i) === 1 ? 1 : 0;
          // Caja «holgada»: alto de línea completo (ascendente a descendente) y espacios con su anchura,
          // para que la selección y los resultados se vean continuos, como en un navegador.
          if (!this.m.FPDFText_GetLooseCharBox(tp, i, p)) continue;
          const [cl, ct, cr, cb] = this.floats(p, 4); // FS_RECTF: left, top, right, bottom
          boxes.set([(cl - l) / w, (t - ct) / h, (cr - l) / w, (t - cb) / h], i * 4);
        }
      });
      return { text, boxes, generated, hasText: hasRealText(text) };
    } finally {
      this.m.FPDFText_ClosePage(tp);
      this.m.FPDF_ClosePage(page);
    }
  }

  /**
   * Busca en una página sin distinguir mayúsculas ni tildes.
   * → { hasText, matches: [{ start, end, rects: [[u0, v0, u1, v1], …] }] } (un rectángulo por línea).
   */
  searchPage(docId, index, query) {
    const c = this.textChars(docId, index);
    return {
      hasText: c.hasText,
      matches: findMatches(c.text, query).map((m) => ({ ...m, rects: lineRects(c.boxes, c.generated, m.start, m.end) })),
    };
  }

  // --- OCR ----------------------------------------------------------------------
  /**
   * Páginas que son solo imagen (un escaneo): sin texto real y con imágenes que cubren al menos la mitad de la
   * página. Las que tienen algo de texto (aunque sea un sello) no cuentan. → [índices]
   */
  imageOnlyPages(docId, { isCancelled } = {}) {
    const h = this.doc(docId);
    const out = [];
    const n = this.m.FPDF_GetPageCount(h);
    for (let i = 0; i < n; i++) {
      if (isCancelled?.()) break;
      const page = this.m.FPDF_LoadPage(h, i);
      if (!page) continue;
      try {
        if (this.pageHasText(page)) continue;
        const [l, b, r, t] = this.box(page);
        const area = Math.max(1, (r - l) * (t - b));
        let covered = 0;
        const count = this.m.FPDFPage_CountObjects(page);
        for (let k = 0; k < count; k++) {
          const o = this.m.FPDFPage_GetObject(page, k);
          const type = this.m.FPDFPageObj_GetType(o);
          if (type !== OBJ.IMAGE && type !== OBJ.FORM) continue;
          const [x0, y0, x1, y1] = this.objBounds(o);
          covered += Math.max(0, Math.min(x1, r) - Math.max(x0, l)) * Math.max(0, Math.min(y1, t) - Math.max(y0, b));
        }
        if (covered / area >= 0.5) out.push(i);
      } finally {
        this.m.FPDF_ClosePage(page);
      }
    }
    return out;
  }

  /** ¿Tiene la página texto real (no solo espacios)? */
  pageHasText(page) {
    const tp = this.m.FPDFText_LoadPage(page);
    try {
      const n = Math.max(0, this.m.FPDFText_CountChars(tp));
      let text = '';
      for (let i = 0; i < n && i < 4000; i++) text += String.fromCharCode(this.m.FPDFText_GetUnicode(tp, i));
      return hasRealText(text);
    } finally {
      this.m.FPDFText_ClosePage(tp);
    }
  }

  /**
   * Capa de texto invisible del OCR (modo de pintado 3: no se ve, pero se busca, se selecciona y se copia).
   * words: [{ t, a: [u, v], b: [u, v], size, space }] con a y b los extremos de la línea base de la palabra en
   * fracciones de la página sin girar (src/ocr/layer.js). Cada palabra es un objeto de texto con la fuente
   * incluida, estirado a lo ancho para que ocupe lo mismo que en la imagen y girado como la línea base (escaneos
   * torcidos). `space`: añade un espacio al final (separa palabras al extraer el texto).
   */
  applyOcr(entry, index, words, font) {
    if (!words?.length) return 0;
    const h = entry.handle;
    const page = this.openPage(entry, index);
    let n = 0;
    try {
      const [l, b, r, t] = this.box(page);
      const X = (u) => l + u * (r - l);
      const Y = (v) => t - v * (t - b);
      const cache = new Map();
      for (const w of words) {
        const text = String(w.t ?? '').trim();
        if (!text) continue;
        const ax = X(w.a[0]); const ay = Y(w.a[1]);
        const dx = X(w.b[0]) - ax; const dy = Y(w.b[1]) - ay;
        const len = Math.hypot(dx, dy);
        const size = Math.max(1, Math.min(200, w.size || 10));
        const natural = this.textWidth(h, font, size, text, cache);
        if (!(len > 0) || !(natural > 0)) continue;
        const sx = len / natural;
        const cos = dx / len; const sin = dy / len;
        const obj = this.m.FPDFPageObj_CreateTextObj(h, font, size);
        if (!obj) throw new Error('No se pudo crear el texto reconocido.');
        const ws = this.wide(w.space ? `${text} ` : text);
        this.m.FPDFText_SetText(obj, ws);
        this.free(ws);
        this.m.FPDFTextObj_SetTextRenderMode(obj, 3 /* invisible */);
        this.m.FPDFPageObj_Transform(obj, sx * cos, sx * sin, -sin, cos, ax, ay);
        this.m.FPDFPage_InsertObject(page, obj);
        n++;
      }
      if (n) this.m.FPDFPage_GenerateContent(page);
    } finally {
      this.closePage(entry, page);
    }
    return n;
  }

  /**
   * Sustituye textos de una página. edits: { objIndex: { text, from } }; text '' borra el bloque.
   * `from` es el texto que se vio al editar: si ya no coincide, no se toca nada (mejor error que estropear).
   */
  applyTextEdits(entry, index, edits) {
    const keys = Object.keys(edits ?? {}).map(Number).sort((a, b) => b - a); // de atrás hacia delante
    if (!keys.length) return;
    const page = this.openPage(entry, index);
    let tp = this.m.FPDFText_LoadPage(page);
    try {
      const plan = keys.map((k) => {
        const o = this.m.FPDFPage_GetObject(page, k);
        if (!o || this.m.FPDFPageObj_GetType(o) !== OBJ.TEXT) throw new Error(`El texto que editaste en la página ${index + 1} ya no está.`);
        const current = this.readWide((p, len) => this.m.FPDFTextObj_GetText(o, tp, p, len));
        const { text, from } = edits[k];
        if (from !== undefined && current !== from) throw new Error(`El texto «${from}» de la página ${index + 1} no coincide con el del archivo.`);
        return { k, o, text, style: this.textStyle(o) };
      });
      this.m.FPDFText_ClosePage(tp);
      tp = null;
      for (const { k, o, text, style } of plan) {
        if (text) this.m.FPDFPage_InsertObjectAtIndex(page, this.newTextObj(entry.handle, text, style), k + 1);
        this.m.FPDFPage_RemoveObject(page, o);
        this.m.FPDFPageObj_Destroy(o);
      }
      this.m.FPDFPage_GenerateContent(page);
    } finally {
      if (tp) this.m.FPDFText_ClosePage(tp);
      this.closePage(entry, page);
    }
  }

  // --- redacción ---------------------------------------------------------------------------
  /**
   * Elimina de verdad el contenido bajo las zonas (fracciones sin rotar [u0, v0, u1, v1]) y las tapa con negro.
   * Devuelve avisos de lo que no se pudo limpiar del todo.
   */
  redact(entry, index, zones) {
    if (!zones?.length) return [];
    const warnings = new Set();
    const page = this.openPage(entry, index);
    try {
      const [l, b, r, t] = this.box(page);
      const Z = zones.map(([u0, v0, u1, v1]) => [l + u0 * (r - l), t - v1 * (t - b), l + u1 * (r - l), t - v0 * (t - b)]);
      const overlaps = ([x0, y0, x1, y1]) => Z.some((z) => x0 < z[2] && x1 > z[0] && y0 < z[3] && y1 > z[1]);
      const inside = ([x0, y0, x1, y1]) => Z.some((z) => x0 >= z[0] && x1 <= z[2] && y0 >= z[1] && y1 <= z[3]);

      // 1. Texto, carácter a carácter.
      const byObj = new Map();
      const tp = this.m.FPDFText_LoadPage(page);
      try {
        const count = this.m.FPDFText_CountChars(tp);
        this.withMem(32, (p) => {
          for (let i = 0; i < count; i++) {
            const obj = this.m.FPDFText_GetTextObject(tp, i);
            if (!obj) continue; // espacios generados por PDFium
            this.m.FPDFText_GetCharBox(tp, i, p, p + 8, p + 16, p + 24);
            const [cl, cr, cb, ct] = [0, 8, 16, 24].map((k) => this.rt.getValue(p + k, 'double'));
            const removed = cr > cl && ct > cb ? overlaps([cl, cb, cr, ct]) : overlaps([cl - 0.1, cb - 0.1, cl + 0.1, cb + 0.1]);
            if (!byObj.has(obj)) byObj.set(obj, []);
            this.m.FPDFText_GetCharOrigin(tp, i, p, p + 8);
            const origin = [this.rt.getValue(p, 'double'), this.rt.getValue(p + 8, 'double')];
            this.m.FPDFText_GetMatrix(tp, i, p);
            byObj.get(obj).push({
              u: this.m.FPDFText_GetUnicode(tp, i), removed, origin,
              matrix: this.floats(p, 6), size: this.m.FPDFText_GetFontSize(tp, i),
            });
          }
        });
      } finally {
        this.m.FPDFText_ClosePage(tp);
      }

      const indexOf = (o) => {
        const n = this.m.FPDFPage_CountObjects(page);
        for (let i = 0; i < n; i++) if (this.m.FPDFPage_GetObject(page, i) === o) return i;
        return -1;
      };
      for (const [o, chars] of byObj) {
        if (!chars.some((c) => c.removed)) continue;
        // Palabras borradas enteras (para limpiar metadatos y marcadores que las nombren).
        // Los trozos que corta el borde de una zona no cuentan: «stro» de «suministro» no identifica nada.
        let word = '';
        let whole = true;
        for (const c of [...chars, { u: 32 }]) {
          if (c.u > 32) { word += String.fromCodePoint(c.u); whole &&= c.removed; continue; }
          if (word && whole) this.redactedText.push(word);
          word = '';
          whole = true;
        }
        const at = indexOf(o);
        if (at < 0) continue;
        const style = this.textStyle(o);
        // El resto del bloque se reescribe letra a letra en su posición original.
        let pos = at + 1;
        for (const c of chars) {
          if (c.removed || c.u <= 32 || (c.u >= 0xD800 && c.u <= 0xDFFF)) continue;
          const [a, bb, cc, d] = c.matrix;
          const obj = this.newTextObj(entry.handle, String.fromCodePoint(c.u), style, [a, bb, cc, d, c.origin[0], c.origin[1]], style.size);
          this.m.FPDFPage_InsertObjectAtIndex(page, obj, pos++);
        }
        this.m.FPDFPage_RemoveObject(page, o);
        this.m.FPDFPageObj_Destroy(o);
      }

      // 2. Imágenes, formas y contenido agrupado.
      for (let i = this.m.FPDFPage_CountObjects(page) - 1; i >= 0; i--) {
        const o = this.m.FPDFPage_GetObject(page, i);
        const bounds = this.objBounds(o);
        if (!overlaps(bounds)) continue;
        const type = this.m.FPDFPageObj_GetType(o);
        const remove = () => { this.m.FPDFPage_RemoveObject(page, o); this.m.FPDFPageObj_Destroy(o); };
        if (type === OBJ.IMAGE) {
          if (inside(bounds)) remove();
          else if (!this.blackenImage(o, Z)) { remove(); warnings.add(`Página ${index + 1}: se quitó entera una imagen que no se podía recortar.`); }
        } else if (type === OBJ.PATH || type === OBJ.SHADING) {
          if (inside(bounds)) remove();
        } else if (type === OBJ.FORM) {
          if (inside(bounds)) remove();
          else warnings.add(`Página ${index + 1}: hay contenido agrupado bajo la zona que no se pudo limpiar del todo; queda tapado.`);
        } else if (type === OBJ.TEXT && !byObj.has(o)) {
          remove(); // texto que PDFium no lista carácter a carácter: se quita entero
        }
      }

      // 3. Anotaciones que tocan la zona (comentarios, enlaces...). Los campos de formulario se avisan.
      for (let i = this.m.FPDFPage_GetAnnotCount(page) - 1; i >= 0; i--) {
        const annot = this.m.FPDFPage_GetAnnot(page, i);
        let hit = false;
        let widget = false;
        try {
          const rect = this.withMem(16, (p) => (this.m.FPDFAnnot_GetRect(annot, p) ? this.floats(p, 4) : null));
          if (rect) {
            const [x0, y0, x1, y1] = rect; // left, top, right, bottom
            hit = overlaps([Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]);
          }
          widget = this.m.FPDFAnnot_GetSubtype(annot) === ANNOT.WIDGET;
        } finally {
          this.m.FPDFPage_CloseAnnot(annot);
        }
        if (!hit) continue;
        this.m.FPDFPage_RemoveAnnot(page, i);
        if (widget) warnings.add(`Página ${index + 1}: se eliminó un campo de formulario que tocaba la zona.`);
      }

      // 4. Recuadros negros.
      for (const [x0, y0, x1, y1] of Z) {
        const rect = this.m.FPDFPageObj_CreateNewRect(x0, y0, x1 - x0, y1 - y0);
        this.m.FPDFPageObj_SetFillColor(rect, 0, 0, 0, 255);
        this.m.FPDFPath_SetDrawMode(rect, 1, 0);
        this.m.FPDFPage_InsertObject(page, rect);
      }
      this.m.FPDFPage_GenerateContent(page);
    } finally {
      this.closePage(entry, page);
    }
    return [...warnings];
  }

  /** Pinta de negro, en los píxeles de la imagen, lo que cae dentro de las zonas (en puntos). */
  blackenImage(o, Z) {
    const src = this.m.FPDFImageObj_GetBitmap(o);
    if (!src) return false;
    try {
      const w = this.m.FPDFBitmap_GetWidth(src);
      const h = this.m.FPDFBitmap_GetHeight(src);
      const stride = this.m.FPDFBitmap_GetStride(src);
      const format = this.m.FPDFBitmap_GetFormat(src); // 1 gris, 2 BGR, 3 BGRx, 4 BGRA
      const bpp = { 1: 1, 2: 3, 3: 4, 4: 4 }[format];
      if (!bpp) return false;
      const [a, b, c, d, e, f] = this.objMatrix(o); // cuadrado unidad de la imagen → página
      const out = this.m.FPDFBitmap_CreateEx(w, h, 2, 0, 0); // BGR: la imagen nueva no conserva nada del original
      if (!out) return false;
      try {
        const heap = this.heap();
        const sp = this.m.FPDFBitmap_GetBuffer(src);
        const dp = this.m.FPDFBitmap_GetBuffer(out);
        const ds = this.m.FPDFBitmap_GetStride(out);
        for (let y = 0; y < h; y++) {
          const v = 1 - (y + 0.5) / h; // la fila 0 es la de arriba
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w;
            const px = a * u + c * v + e;
            const py = b * u + d * v + f;
            const s = sp + y * stride + x * bpp;
            const t = dp + y * ds + x * 3;
            const black = Z.some((z) => px >= z[0] && px <= z[2] && py >= z[1] && py <= z[3]);
            if (black) { heap[t] = 0; heap[t + 1] = 0; heap[t + 2] = 0; }
            else if (bpp === 1) { heap[t] = heap[s]; heap[t + 1] = heap[s]; heap[t + 2] = heap[s]; }
            else { heap[t] = heap[s]; heap[t + 1] = heap[s + 1]; heap[t + 2] = heap[s + 2]; }
          }
        }
        return !!this.m.FPDFImageObj_SetBitmap(0, 0, o, out);
      } finally {
        this.m.FPDFBitmap_Destroy(out);
      }
    } finally {
      this.m.FPDFBitmap_Destroy(src);
    }
  }

  // --- guardar ------------------------------------------------------------------------
  /**
   * Construye el PDF final. refs: [{ docId, index, rot, annots?, fields?, textEdits? }]
   * Las anotaciones de tipo 'redact' son zonas a redactar. Cada página original aparece como mucho una vez.
   * Los avisos de la redacción quedan en this.warnings.
   * security: sin indicar, el resultado conserva la protección del PDF base (mismas contraseñas y permisos);
   *   { remove: true } la quita; { user, owner, perms } protege con AES-256 (owner vacío = la misma que user).
   * this.post: lo que falta hacer con qpdf sobre los bytes devueltos (ver finishWithQpdf en pdf.worker.js):
   *   { copyEncryption: { from, password } } copia la protección del original (la redacción crea un PDF nuevo);
   *   { rewrite: true, password? } reescribe sin los objetos sueltos (p. ej. el diccionario de cifrado antiguo).
   * hidden: «Quitar información oculta» (al compartir): se guarda como un PDF nuevo, igual que al redactar, sin
   *   metadatos, notas, adjuntos, JavaScript ni formulario interactivo (los campos quedan como texto fijo).
   */
  compose(refs, onProgress, { security, hidden = false } = {}) {
    this.warnings = [];
    this.post = null;
    this.incremental = false;
    this.redactedText = [];
    if (!refs.length) throw new Error('No hay páginas para guardar.');

    // 1. Base = el PDF que más páginas aporta: se edita una copia suya. Las páginas nuevas (docId null,
    //    con create) no cuentan; si todas son nuevas, se parte de un documento vacío.
    const fromPdf = (r) => r.docId != null;
    const counts = new Map();
    refs.filter(fromPdf).forEach((r) => counts.set(r.docId, (counts.get(r.docId) ?? 0) + 1));
    const baseId = counts.size ? [...counts].sort((x, y) => y[1] - x[1])[0][0] : null;
    const isBase = (r) => fromPdf(r) && r.docId === baseId;

    // 2. Copias de trabajo: la base y cualquier otro PDF con formulario o textos editados.
    const zonesOf = (r) => (r.annots ?? []).filter((a) => a.type === 'redact').map((a) => a.rect);
    const needsCopy = (r) => fromPdf(r) && (this.entry(r.docId).hasForm || Object.keys(r.textEdits ?? {}).length > 0);
    const work = new Map(baseId != null ? [[baseId, this.loadCopy(baseId)]] : []);
    const created = [];
    let fonts = null; // fuentes incluidas del texto nuevo (se cierran al acabar)
    try {
      for (const r of refs) {
        if (!work.has(r.docId) && needsCopy(r)) work.set(r.docId, this.loadCopy(r.docId));
      }
      for (const [, copy] of work) created.push(copy);
      for (const r of refs) {
        const copy = work.get(r.docId);
        if (!copy) continue;
        if (r.fields) this.fillFields(copy, r.index, r.fields);
        if (r.textEdits) this.applyTextEdits(copy, r.index, r.textEdits);
      }

      // Las páginas con formulario que vienen de otro PDF se aplanan: sus campos no
      // entran en el AcroForm del resultado, así que sin aplanar muchos visores
      // (y el propio PDFium) no los dibujan. Así se ven rellenados en cualquier visor.
      for (const r of refs) {
        if (!fromPdf(r) || isBase(r) || !work.has(r.docId)) continue;
        const copy = work.get(r.docId);
        const page = this.openPage(copy, r.index);
        try { this.m.FPDFPage_Flatten(page, 0); } finally { this.closePage(copy, page); }
      }

      let dest = work.get(baseId);
      if (!dest) {
        const doc = this.m.FPDF_CreateNewDocument();
        if (!doc) throw new Error('No se pudo crear el documento.');
        dest = { handle: doc, ptr: 0, size: 0 };
        created.push(dest);
      }
      const h = dest.handle;

      // 3. Quitar de la base las páginas que no se usan (de atrás hacia delante).
      const used = new Set(refs.filter(isBase).map((r) => r.index));
      const total = this.m.FPDF_GetPageCount(h);
      for (let i = total - 1; i >= 0; i--) if (!used.has(i)) this.m.FPDFPage_Delete(h, i);
      const order = [...Array(total).keys()].filter((i) => used.has(i)); // espejo del orden actual

      // 4. Colocar cada página en su sitio: mover las de la base, crear las nuevas, importar las demás.
      this.withMem(4, (idx) => {
        refs.forEach((r, i) => {
          if (!fromPdf(r)) {
            this.createPage(h, i, r.create);
            order.splice(i, 0, null);
          } else if (isBase(r)) {
            const pos = order.indexOf(r.index, i);
            if (pos !== i) {
              this.rt.setValue(idx, pos, 'i32');
              if (!this.m.FPDF_MovePages(h, idx, 1, i)) throw new Error('No se pudo reordenar las páginas.');
              order.splice(i, 0, ...order.splice(pos, 1));
            }
          } else {
            const src = work.get(r.docId)?.handle ?? this.doc(r.docId);
            this.rt.setValue(idx, r.index, 'i32');
            if (!this.m.FPDF_ImportPagesByIndex(h, src, idx, 1, i)) throw new Error(`No se pudo copiar la página ${r.index + 1}.`);
            order.splice(i, 0, null);
          }
        });
      });

      // 4b. Índice: cada marcador a la nueva posición de su página; un grupo por archivo si se unieron varios.
      this.rebuildOutline(h, refs);

      // Texto nuevo: cada fuente incluida se subconjunta una vez con las letras de todos los cuadros que la pueden
      // usar (también los que van con la fuente del PDF, por si a esta le falta alguna letra).
      const boxTexts = new Map();
      for (const r of refs) {
        for (const a of r.annots ?? []) {
          if (a.type !== 'textbox' || !a.text) continue;
          const k = familyKey(a.style.family, a.style.bold, a.style.italic);
          boxTexts.set(k, (boxTexts.get(k) ?? '') + a.text);
        }
        // Capa del OCR: con la incluida sin serifa (solo importa que tenga las letras y que sea Unicode).
        if (r.ocr?.length) boxTexts.set(OCR_FONT, (boxTexts.get(OCR_FONT) ?? '') + r.ocr.map((w) => w.t).join(' '));
      }
      fonts = boxTexts.size ? this.textFonts(h, boxTexts) : null;

      // 5. Giros, anotaciones y firmas sobre el resultado. La redacción va la última: lo que el usuario
      //    haya dejado encima de una zona (firma, nota...) también se borra, como avisa la interfaz.
      refs.forEach((r, i) => {
        onProgress?.({ done: i, total: refs.length });
        if (r.rot) {
          const page = this.m.FPDF_LoadPage(h, i);
          this.m.FPDFPage_SetRotation(page, (this.m.FPDFPage_GetRotation(page) + r.rot) % 4);
          this.m.FPDF_ClosePage(page);
        }
        if (r.ocr?.length) this.applyOcr(dest, i, r.ocr, fonts.get(OCR_FONT));
        const annots = r.annots?.filter((a) => a.type !== 'redact');
        if (annots?.length) this.applyAnnots(dest, i, annots, zonesOf(r), fonts);
        const zones = zonesOf(r);
        if (zones.length) this.warnings.push(...this.redact(dest, i, zones));
      });

      onProgress?.({ done: refs.length, total: refs.length });
      const base = baseId != null ? this.entry(baseId) : null;
      const baseEncrypted = !!base && this.security(baseId).encrypted;
      const protect = security?.user != null ? security : null;
      // Páginas de otro PDF protegido: llevan la protección del resultado (la del base, o ninguna).
      if (!protect && (security?.remove || !baseEncrypted)) {
        const lost = [...new Set(refs.filter((r) => fromPdf(r) && !isBase(r) && this.security(r.docId).encrypted).map((r) => r.source ?? 'otro PDF'))];
        if (lost.length) this.warnings.push(`Las páginas de ${lost.map((n) => `«${n}»`).join(', ')} se guardan sin contraseña.`);
      }
      if (hidden || refs.some((r) => zonesOf(r).length)) {
        const bytes = this.cleanSave(dest, this.redactedText, protect, { hidden });
        if (!protect && !security?.remove && baseEncrypted) {
          this.post = { copyEncryption: { from: this.heap().slice(base.ptr, base.ptr + base.size), password: base.ownerPassword ?? base.password } };
        }
        return bytes;
      }
      if (security?.remove) {
        if (baseEncrypted && !this.m.EPDF_RemoveEncryption(h)) throw new Error('No se pudo quitar la contraseña.');
        this.post = { rewrite: true };
        return this.save(h);
      }
      if (protect) {
        this.protect(h, protect);
        this.post = { rewrite: true, password: protect.owner || protect.user };
        return this.save(h);
      }
      // PDF firmado y cambios que lo permiten: revisión incremental, sin tocar los bytes firmados.
      this.incremental = !!base && base.signed > 0 && incrementalPlan(refs, { docId: baseId, pageCount: base.pageCount }).incremental;
      return this.save(h, this.incremental);
    } finally {
      fonts?.close();
      created.forEach((c) => this.closeEntry(c));
    }
  }

  /**
   * Guarda un documento redactado sin rastros: se crea un PDF nuevo con las páginas ya redactadas
   * (solo se copia lo que usan, así no viajan objetos sueltos, versiones anteriores ni guardados
   * incrementales) y se pasan los metadatos y marcadores que no nombran lo redactado.
   * No se copian: XMP, formulario interactivo (los campos quedan como texto fijo), adjuntos ni JavaScript.
   */
  cleanSave(entry, terms, protect = null, { hidden = false } = {}) {
    const src = entry.handle;
    const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const words = [...new Set(terms.flatMap((t) => norm(t).split(/\s+/)).filter((w) => w.length >= 3))];
    const tainted = (t) => { const n = norm(t); return words.some((w) => n.includes(w)); };

    // Los campos que quedan se aplanan: sin el formulario del original no se verían.
    let flattened = 0;
    for (let i = 0; i < this.m.FPDF_GetPageCount(src); i++) {
      const page = this.openPage(entry, i);
      try {
        for (let k = this.m.FPDFPage_GetAnnotCount(page) - 1; k >= 0; k--) {
          const annot = this.m.FPDFPage_GetAnnot(page, k);
          let widget = false;
          let drop = false;
          try {
            const sub = this.m.FPDFAnnot_GetSubtype(annot);
            widget = sub === ANNOT.WIDGET;
            drop = hidden && HIDDEN_ANNOTS.has(sub);
            if (widget) this.m.EPDFAnnot_Flatten(page, annot);
          } finally {
            this.m.FPDFPage_CloseAnnot(annot);
          }
          if (drop) { this.m.FPDFPage_RemoveAnnot(page, k); continue; }
          if (!widget) continue;
          flattened++;
          if (this.m.FPDFPage_GetAnnotCount(page) > k) {
            const again = this.m.FPDFPage_GetAnnot(page, k);
            const still = again && this.m.FPDFAnnot_GetSubtype(again) === ANNOT.WIDGET;
            if (again) this.m.FPDFPage_CloseAnnot(again);
            if (still) this.m.FPDFPage_RemoveAnnot(page, k);
          }
        }
        this.m.FPDFPage_GenerateContent(page);
      } finally {
        this.closePage(entry, page);
      }
    }
    if (flattened) this.warnings.push(hidden && !terms.length ? 'Los campos de formulario quedan como texto fijo.' : 'Los campos de formulario del PDF redactado quedan como texto fijo.');

    const doc = this.m.FPDF_CreateNewDocument();
    if (!doc) throw new Error('No se pudo crear el documento redactado.');
    const withWide = (text, fn) => { const w = this.wide(text); try { return fn(w); } finally { this.free(w); } };
    try {
      if (!this.m.FPDF_ImportPagesByIndex(doc, src, 0, 0, 0)) throw new Error('No se pudieron copiar las páginas redactadas.');
      this.m.FPDF_CopyViewerPreferences(doc, src);
      const lang = this.readWide((p, len) => this.m.FPDFCatalog_GetLanguage(src, p, len));
      if (lang) withWide(lang, (w) => this.m.FPDFCatalog_SetLanguage(doc, w));
      for (const key of hidden ? [] : ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'CreationDate']) {
        const value = this.readWide((p, len) => this.m.FPDF_GetMetaText(src, key, p, len));
        if (value && !tainted(value)) withWide(value, (w) => this.m.EPDF_SetMetaText(doc, key, w));
      }
      this.copyBookmarks(src, doc, 0, 0, tainted, 0);
      if (protect) this.protect(doc, protect);
      return this.save(doc);
    } finally {
      this.m.FPDF_CloseDocument(doc);
    }
  }

  /** Copia el árbol de marcadores (título y página de destino), sin los que cumplen skip ni sus hijos. */
  copyBookmarks(src, dst, srcParent, dstParent, skip, depth) {
    if (depth > 32) return;
    for (let bm = this.m.FPDFBookmark_GetFirstChild(src, srcParent); bm; bm = this.m.FPDFBookmark_GetNextSibling(src, bm)) {
      const title = this.readWide((p, len) => this.m.FPDFBookmark_GetTitle(bm, p, len));
      if (skip(title)) continue;
      const w = this.wide(title);
      const nb = this.m.EPDFBookmark_AppendChild(dst, dstParent, w);
      this.free(w);
      if (!nb) continue;
      let dest = this.m.FPDFBookmark_GetDest(src, bm);
      if (!dest) {
        const action = this.m.FPDFBookmark_GetAction(bm);
        if (action && this.m.FPDFAction_GetType(action) === 1) dest = this.m.FPDFAction_GetDest(src, action); // GoTo
      }
      const index = dest ? this.m.FPDFDest_GetDestPageIndex(src, dest) : -1;
      if (index >= 0 && index < this.m.FPDF_GetPageCount(dst)) {
        const page = this.m.FPDF_LoadPage(dst, index);
        const view = this.m.EPDFDest_CreateView(page, 2, 0, 0); // ajustar la página
        if (view) this.m.EPDFBookmark_SetDest(dst, nb, view);
        this.m.FPDF_ClosePage(page);
      }
      this.copyBookmarks(src, dst, bm, nb, skip, depth + 1);
    }
  }

  // --- marcadores (índice) ---------------------------------------------------------------
  /** Índice del PDF: [{ title, pageIndex, children }]. pageIndex = -1 si no lleva a una página suya. */
  bookmarks(docId) {
    const strip = (nodes) => nodes.map(({ title, pageIndex, children }) => ({ title, pageIndex, children: strip(children) }));
    return strip(this.readOutline(this.doc(docId)));
  }

  /** Lee el árbol con la vista de cada destino (para recrearla al guardar). Resiste ciclos y árboles enormes. */
  readOutline(h) {
    const seen = new Set();
    let budget = 20000;
    const walk = (parent, depth) => {
      const out = [];
      if (depth > 32) return out;
      for (let bm = this.m.FPDFBookmark_GetFirstChild(h, parent); bm && budget > 0; bm = this.m.FPDFBookmark_GetNextSibling(h, bm)) {
        if (seen.has(bm)) break; // PDF dañado: el «siguiente» vuelve atrás
        seen.add(bm);
        budget--;
        const title = this.readWide((p, len) => this.m.FPDFBookmark_GetTitle(bm, p, len));
        const dest = this.bookmarkDest(h, bm);
        const pageIndex = dest ? this.m.FPDFDest_GetDestPageIndex(h, dest) : -1;
        out.push({ title, pageIndex: pageIndex >= 0 ? pageIndex : -1, view: dest ? this.destView(dest) : null, children: walk(bm, depth + 1) });
      }
      return out;
    };
    return walk(0, 0);
  }

  /** Destino de un marcador: el suyo o el de su acción «Ir a» (GoTo). */
  bookmarkDest(h, bm) {
    const dest = this.m.FPDFBookmark_GetDest(h, bm);
    if (dest) return dest;
    const action = this.m.FPDFBookmark_GetAction(bm);
    return action && this.m.FPDFAction_GetType(action) === 1 ? this.m.FPDFAction_GetDest(h, action) : 0;
  }

  /** Cómo muestra la página un destino: { xyz: [hasX, x, hasY, y, hasZoom, zoom] } o { mode, params }. */
  destView(dest) {
    return this.withMem(40, (p) => {
      if (this.m.FPDFDest_GetLocationInPage(dest, p, p + 4, p + 8, p + 12, p + 16, p + 20)) {
        const [hx, hy, hz] = [0, 4, 8].map((o) => this.rt.getValue(p + o, 'i32'));
        const [x, y, z] = this.floats(p + 12, 3);
        return { xyz: [!!hx, hx ? x : 0, !!hy, hy ? y : 0, !!hz, hz ? z : 0] };
      }
      const mode = this.m.FPDFDest_GetView(dest, p, p + 8);
      const n = Math.min(4, this.rt.getValue(p, 'i32'));
      return { mode, params: this.floats(p + 8, n) };
    });
  }

  /** Crea en el documento h un destino a la página index con la vista dada (o «ajustar la página»). */
  makeDest(h, index, view) {
    const page = this.m.FPDF_LoadPage(h, index);
    if (!page) return 0;
    try {
      if (view?.xyz) return this.m.EPDFDest_CreateXYZ(page, ...view.xyz);
      if (view?.mode > 1 && view.mode <= 8) {
        return this.withMem(16, (p) => { this.setFloats(p, view.params); return this.m.EPDFDest_CreateView(page, view.mode, p, view.params.length); });
      }
      return this.m.EPDFDest_CreateView(page, 2, 0, 0); // Fit
    } finally {
      this.m.FPDF_ClosePage(page);
    }
  }

  /**
   * Índice del resultado de compose: cada marcador apunta a la nueva posición de su página; los que
   * apuntaban a páginas eliminadas se quitan (salvo que tengan hijos que sigan). Con varios PDFs, un
   * grupo por archivo con su nombre. Si viene todo de un PDF y ningún marcador perdió su página, se deja
   * el índice original tal cual (las páginas movidas siguen enlazadas y se conservan estilos y acciones).
   */
  rebuildOutline(h, refs) {
    const docs = [...new Set(refs.map((r) => r.docId))].filter((d) => d != null); // las páginas nuevas no traen índice
    const raw = new Map(docs.map((d) => [d, this.readOutline(this.doc(d))]));
    const names = new Map();
    refs.forEach((r) => { if (r.source && !names.has(r.docId)) names.set(r.docId, r.source); });
    const mapped = mapOutline(refs, raw, names);
    if (docs.length === 1 && !flatten(mapped).some(({ node }) => node.missing)) return;

    // Vista original de cada nodo (mapOutline no la conserva): mismo recorrido, mismos ids.
    const views = new Map();
    const collect = (d, nodes, prefix) => nodes.forEach((n, i) => { views.set(`${prefix}/${i}`, n.view); collect(d, n.children, `${prefix}/${i}`); });
    for (const d of docs) collect(d, raw.get(d), `d${d}`);

    this.m.EPDFBookmark_Clear(h);
    const write = (nodes, parent) => {
      for (const n of nodes) {
        const w = this.wide(n.title);
        const bm = this.m.EPDFBookmark_AppendChild(h, parent, w);
        this.free(w);
        if (!bm) continue;
        if (n.pos >= 0) {
          const dest = this.makeDest(h, n.pos, n.group ? null : views.get(n.id));
          if (dest) this.m.EPDFBookmark_SetDest(h, bm, dest);
        }
        write(n.children, bm);
      }
    };
    write(pruneOutline(mapped), 0);
  }

  /**
   * «Reducir tamaño»: cada imagen que pasa de dpi (según cómo se ve en la página) se reduce y se vuelve a guardar en
   * JPEG con esa calidad. Nunca se tocan texto ni vectores: solo objetos de imagen. Se dejan las que tienen
   * transparencia, las de 1 bit (escaneos en blanco y negro), las CMYK y las que no ganarían nada.
   * La misma imagen usada en varios sitios se reduce una vez; si sus copias pesaran más que la original, no se toca.
   * La imagen original queda suelta en el archivo: la quita qpdf al optimizar (ver src/engine/reduce.js).
   * encode(rgba, w, h, quality 0-1) → Promise<Uint8Array> JPEG. → { images, reduced }
   */
  async reduceImages(entry, { dpi, quality }, encode, { onProgress, isCancelled } = {}) {
    const pageCount = this.m.FPDF_GetPageCount(entry.handle);
    const groups = new Map(); // huella → { uses: [{ page, k }], w, h, rawLen, dpi, ok }
    const meta = this.malloc(28); // FPDF_IMAGEOBJ_METADATA
    try {
      for (let i = 0; i < pageCount; i++) {
        const page = this.openPage(entry, i);
        try {
          const n = this.m.FPDFPage_CountObjects(page);
          for (let k = 0; k < n; k++) {
            const o = this.m.FPDFPage_GetObject(page, k);
            if (this.m.FPDFPageObj_GetType(o) !== OBJ.IMAGE) continue;
            if (!this.m.FPDFImageObj_GetImageMetadata(o, page, meta)) continue;
            const get = (off, t = 'i32') => this.rt.getValue(meta + off, t);
            const w = get(0) >>> 0;
            const h = get(4) >>> 0;
            const useDpi = Math.min(get(8, 'float'), get(12, 'float'));
            const bpp = get(16) >>> 0;
            const cs = get(20);
            const rawLen = this.m.FPDFImageObj_GetImageDataRaw(o, 0, 0);
            if (!rawLen || !w || !h) continue;
            const key = this.withMem(rawLen, (p) => { this.m.FPDFImageObj_GetImageDataRaw(o, p, rawLen); return `${w}x${h}:${rawLen}:${fnv(this.heap(), p, rawLen)}`; });
            let g = groups.get(key);
            if (!g) groups.set(key, (g = { uses: [], w, h, rawLen, dpi: Infinity, ok: true }));
            g.uses.push({ page: i, k });
            if (useDpi > 0) g.dpi = Math.min(g.dpi, useDpi); // la que se ve más grande manda
            if ((bpp !== 8 && bpp !== 24) || !REDUCIBLE_CS.has(cs) || this.imageHasAlpha(entry.handle, page, o)) g.ok = false;
          }
        } finally {
          this.closePage(entry, page);
        }
        onProgress?.({ phase: 'scan', done: i + 1, total: pageCount });
        if (isCancelled?.()) throw Object.assign(new Error('Cancelado.'), { cancelled: true });
      }
    } finally {
      this.free(meta);
    }

    const plan = new Map(); // página → [{ k, jpeg }]
    const todo = [...groups.values()].filter((g) => g.ok && Number.isFinite(g.dpi) && targetSize(g.w, g.h, g.dpi, dpi));
    let reduced = 0;
    for (const [n, g] of todo.entries()) {
      const t = targetSize(g.w, g.h, g.dpi, dpi);
      const { page: pi, k } = g.uses[0];
      const page = this.openPage(entry, pi);
      let img;
      try { img = this.imageRGBA(this.m.FPDFPage_GetObject(page, k)); } finally { this.closePage(entry, page); }
      onProgress?.({ phase: 'images', done: n + 1, total: todo.length });
      if (!img) continue;
      const small = downscaleRGBA(img.data, img.width, img.height, t.width, t.height);
      const jpeg = await encode(small, t.width, t.height, quality);
      if (isCancelled?.()) throw Object.assign(new Error('Cancelado.'), { cancelled: true });
      if (jpeg.length * g.uses.length >= g.rawLen) continue; // no se gana nada
      for (const u of g.uses) {
        if (!plan.has(u.page)) plan.set(u.page, []);
        plan.get(u.page).push({ k: u.k, jpeg });
      }
      reduced++;
    }
    for (const [pi, list] of plan) {
      const page = this.openPage(entry, pi);
      try {
        for (const { k, jpeg } of list) {
          const o = this.m.FPDFPage_GetObject(page, k);
          const ok = this.withMem(jpeg.length, (p) => { this.heap().set(jpeg, p); return this.m.EPDFImageObj_SetJpeg(0, 0, o, p, jpeg.length); });
          if (!ok) throw new Error('No se pudo cambiar una imagen.');
        }
        this.m.FPDFPage_GenerateContent(page); // sin esto, la página seguiría apuntando a la imagen original
      } finally {
        this.closePage(entry, page);
      }
    }
    return { images: groups.size, reduced };
  }

  /**
   * ¿La imagen tiene transparencia (SMask, máscara o alfa del estado gráfico)? Pasarla a JPEG la perdería.
   * FPDFPageObj_HasTransparency no ve las SMask en esta versión de PDFium: se dibuja como se ve en la página (tamaño
   * de página, barato) y se mira si algún píxel no es opaco. Si no se puede saber, se da por transparente.
   */
  imageHasAlpha(doc, page, o) {
    if (this.m.FPDFPageObj_HasTransparency(o)) return true;
    const bmp = this.m.FPDFImageObj_GetRenderedBitmap(doc, page, o);
    if (!bmp) return true;
    try {
      if (this.m.FPDFBitmap_GetFormat(bmp) !== 4) return false; // sin canal alfa: opaca
      const w = this.m.FPDFBitmap_GetWidth(bmp);
      const h = this.m.FPDFBitmap_GetHeight(bmp);
      const stride = this.m.FPDFBitmap_GetStride(bmp);
      const buf = this.m.FPDFBitmap_GetBuffer(bmp);
      const heap = this.heap();
      for (let y = 0; y < h; y++) {
        for (let x = 3, row = buf + y * stride; x < w * 4; x += 4) if (heap[row + x] < 255) return true;
      }
      return false;
    } finally {
      this.m.FPDFBitmap_Destroy(bmp);
    }
  }

  /** Píxeles de un objeto imagen (decodificados, en su tamaño original) como RGBA. null si PDFium no puede. */
  imageRGBA(o) {
    const bmp = this.m.FPDFImageObj_GetBitmap(o);
    if (!bmp) return null;
    try {
      const width = this.m.FPDFBitmap_GetWidth(bmp);
      const height = this.m.FPDFBitmap_GetHeight(bmp);
      const stride = this.m.FPDFBitmap_GetStride(bmp);
      const format = this.m.FPDFBitmap_GetFormat(bmp); // 1 gris, 2 BGR, 3 BGRx, 4 BGRA
      const bpp = { 1: 1, 2: 3, 3: 4, 4: 4 }[format];
      if (!bpp) return null;
      const buf = this.m.FPDFBitmap_GetBuffer(bmp);
      const heap = this.heap();
      const data = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        let s = buf + y * stride;
        let d = y * width * 4;
        for (let x = 0; x < width; x++, s += bpp, d += 4) {
          if (bpp === 1) { data[d] = data[d + 1] = data[d + 2] = heap[s]; } else { data[d] = heap[s + 2]; data[d + 1] = heap[s + 1]; data[d + 2] = heap[s]; }
          data[d + 3] = 255;
        }
      }
      return { data, width, height };
    } finally {
      this.m.FPDFBitmap_Destroy(bmp);
    }
  }

  /** Cifra el documento con AES-256 (revisión 6). owner vacío = la misma contraseña que user. */
  protect(h, { user, owner, perms }) {
    if (!user) throw new Error('Falta la contraseña para abrir.');
    if (!this.m.EPDF_SetEncryption(h, user, owner || user, perms | 0)) throw new Error('No se pudo proteger el PDF.');
  }

  /**
   * Bytes del documento. incremental: el archivo original intacto + una revisión al final con lo que
   * cambió (FPDF_INCREMENTAL); así no se tocan los bytes que cubre una firma digital.
   */
  save(handle, incremental = false) {
    const writer = this.m.PDFiumExt_OpenFileWriter();
    try {
      const ok = incremental ? this.m.FPDF_SaveAsCopy(handle, writer, FPDF_INCREMENTAL) : this.m.PDFiumExt_SaveAsCopy(handle, writer);
      if (!ok) throw new Error('No se pudo generar el PDF.');
      const size = this.m.PDFiumExt_GetFileWriterSize(writer);
      return this.withMem(size, (ptr) => {
        this.m.PDFiumExt_GetFileWriterData(writer, ptr, size);
        return this.heap().slice(ptr, ptr + size);
      });
    } finally {
      this.m.PDFiumExt_CloseFileWriter(writer);
    }
  }

  close(docId) {
    const d = this.docs.get(docId);
    if (!d) return;
    this.closeEntry(d);
    this.docs.delete(docId);
  }
}
