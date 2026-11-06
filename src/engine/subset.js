// Subconjunto de una fuente TrueType con HarfBuzz (harfbuzz-subset.wasm de harfbuzzjs, MIT): solo las letras
// que se usan, para incrustar en el PDF unos pocos KB en vez de la fuente entera. Sin DOM: worker y Node.

import { t } from '../i18n/index.js';

/** Crea el subconjuntador a partir de los bytes del wasm. → (fontBytes, text) => Uint8Array */
export async function createSubsetter(wasmBytes) {
  const { instance } = await WebAssembly.instantiate(wasmBytes);
  const hb = instance.exports;
  return (font, text) => {
    const p = hb.malloc(font.length);
    new Uint8Array(hb.memory.buffer).set(font, p);
    const blob = hb.hb_blob_create(p, font.length, 2 /* escribible */, 0, 0);
    const face = hb.hb_face_create(blob, 0);
    hb.hb_blob_destroy(blob);
    const input = hb.hb_subset_input_create_or_fail();
    try {
      const set = hb.hb_subset_input_unicode_set(input);
      for (const ch of new Set(text)) hb.hb_set_add(set, ch.codePointAt(0));
      hb.hb_set_add(set, 0x20); // el espacio siempre
      const sub = hb.hb_subset_or_fail(face, input);
      if (!sub) throw new Error(t('engine.fontPrepareFailed'));
      const out = hb.hb_face_reference_blob(sub);
      const off = hb.hb_blob_get_data(out, 0);
      const len = hb.hb_blob_get_length(out);
      const bytes = new Uint8Array(hb.memory.buffer).slice(off, off + len); // copia: la memoria puede crecer
      hb.hb_blob_destroy(out);
      hb.hb_face_destroy(sub);
      return bytes;
    } finally {
      hb.hb_subset_input_destroy(input);
      hb.hb_face_destroy(face);
      hb.free(p);
    }
  };
}
