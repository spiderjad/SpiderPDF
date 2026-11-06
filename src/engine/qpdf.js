// qpdf (Apache 2.0) compilado por nosotros a WebAssembly (build/qpdf/build.sh). Sin DOM: vale en el worker y en
// Node (pruebas). Cada llamada usa una instancia nueva del módulo (qpdf es un programa de línea de órdenes y
// guarda estado entre ejecuciones), con el WebAssembly ya compilado: crearla cuesta milisegundos.
// Todo ocurre en memoria (MEMFS): ni los PDF ni las contraseñas tocan el disco, y nada se registra.

/**
 * createQpdf(factory, wasmBinary) → { run(args, files) }. factory: la función que exporta qpdf.mjs.
 * run(args, { 'in.pdf': bytes, … }, 'out.pdf') → bytes del archivo de salida.
 */
export async function createQpdf(factory, wasmBinary) {
  const compiled = await WebAssembly.compile(wasmBinary);
  return {
    async run(args, files, output) {
      const log = [];
      const mod = await factory({
        print: (l) => log.push(l),
        printErr: (l) => log.push(l),
        instantiateWasm: (imports, done) => {
          WebAssembly.instantiate(compiled, imports).then((inst) => done(inst, compiled));
          return {};
        },
      });
      for (const [name, bytes] of Object.entries(files)) mod.FS.writeFile(`/${name}`, bytes);
      let code;
      try {
        code = mod.callMain(args);
      } catch (e) {
        if (e?.name === 'ExitStatus' || typeof e?.status === 'number') code = e.status;
        else throw e;
      }
      // 0: bien; 3: bien con avisos (qpdf arregló algo del original). 2: error.
      if (code !== 0 && code !== 3) {
        const msg = log.filter((l) => !/password/i.test(l)).join(' ').slice(0, 300); // por si acaso, nada que hable de contraseñas
        throw new Error(`qpdf no pudo procesar el PDF${msg ? `: ${msg}` : '.'}`);
      }
      return mod.FS.readFile(`/${output}`);
    },
  };
}

/** Copia la protección (cifrado, contraseñas y permisos) de original a clean. password: la de abrir o la de permisos. */
export function copyEncryption(qpdf, clean, original, password) {
  return qpdf.run(
    ['--copy-encryption=/orig.pdf', `--encryption-file-password=${password}`, '/in.pdf', '/out.pdf'],
    { 'in.pdf': clean, 'orig.pdf': original },
    'out.pdf',
  );
}

/** Reescribe el PDF sin objetos sueltos (conserva el cifrado si lo tiene; entonces hace falta su contraseña). */
export function rewrite(qpdf, bytes, password) {
  return qpdf.run([...(password ? [`--password=${password}`] : []), '/in.pdf', '/out.pdf'], { 'in.pdf': bytes }, 'out.pdf');
}

/** Lo que compose() dejó pendiente (core.post) sobre sus bytes. */
export async function finishWithQpdf(getQpdf, bytes, post) {
  if (!post) return bytes;
  const qpdf = await getQpdf();
  if (post.copyEncryption) return copyEncryption(qpdf, bytes, post.copyEncryption.from, post.copyEncryption.password);
  if (post.rewrite) return rewrite(qpdf, bytes, post.password);
  return bytes;
}
