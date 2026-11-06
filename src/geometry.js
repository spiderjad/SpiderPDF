// Geometría compartida por la interfaz y el motor (sin DOM).
//
// Todas las anotaciones se guardan en "fracciones de página sin rotar":
//   u = 0 (izquierda) … 1 (derecha), v = 0 (arriba) … 1 (abajo)
// medidas sobre el CropBox del PDF ignorando cualquier /Rotate.
// Así, si el usuario gira la página después, la anotación gira con ella.
//
// R = cuartos de vuelta en sentido horario con los que se muestra la página
//     (rotación propia del PDF + la que añadió el usuario).

/** Fracción sin rotar → fracción en pantalla. */
export function toDisplay(u, v, R) {
  switch (((R % 4) + 4) % 4) {
    case 1: return [1 - v, u];
    case 2: return [1 - u, 1 - v];
    case 3: return [v, 1 - u];
    default: return [u, v];
  }
}

/** Fracción en pantalla → fracción sin rotar. */
export function fromDisplay(x, y, R) {
  switch (((R % 4) + 4) % 4) {
    case 1: return [y, 1 - x];
    case 2: return [1 - x, 1 - y];
    case 3: return [1 - y, x];
    default: return [x, y];
  }
}

/** Rectángulo [u0, v0, u1, v1] → rectángulo en pantalla { x, y, w, h }. */
export function rectToDisplay([u0, v0, u1, v1], R) {
  const [ax, ay] = toDisplay(u0, v0, R);
  const [bx, by] = toDisplay(u1, v1, R);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** Rectángulo en pantalla → [u0, v0, u1, v1] sin rotar y normalizado. */
export function rectFromDisplay({ x, y, w, h }, R) {
  const [au, av] = fromDisplay(x, y, R);
  const [bu, bv] = fromDisplay(x + w, y + h, R);
  return [Math.min(au, bu), Math.min(av, bv), Math.max(au, bu), Math.max(av, bv)];
}

/** Desplaza una anotación por un vector en pantalla (dx, dy en fracciones). */
export function moveAnnot(annot, dx, dy, R) {
  const [o0, o1] = fromDisplay(0, 0, R);
  const [d0, d1] = fromDisplay(dx, dy, R);
  const du = d0 - o0;
  const dv = d1 - o1;
  const clampRect = ([a, b, c, d]) => {
    const su = Math.min(Math.max(du, -a), 1 - c);
    const sv = Math.min(Math.max(dv, -b), 1 - d);
    return [a + su, b + sv, c + su, d + sv];
  };
  switch (annot.type) {
    case 'ink':
      return { ...annot, strokes: annot.strokes.map((s) => s.map((n, i) => n + (i % 2 ? dv : du))) };
    case 'note': {
      const [u, v] = annot.at;
      return { ...annot, at: [Math.min(1, Math.max(0, u + du)), Math.min(1, Math.max(0, v + dv))] };
    }
    default:
      return { ...annot, rect: clampRect(annot.rect) };
  }
}

/** Caja que contiene una anotación, en fracciones sin rotar. */
export function annotBounds(annot) {
  if (annot.type === 'note') {
    const [u, v] = annot.at;
    return [u, v, u, v];
  }
  if (annot.type === 'ink') {
    let r = [1, 1, 0, 0];
    for (const s of annot.strokes) {
      for (let i = 0; i < s.length; i += 2) {
        r = [Math.min(r[0], s[i]), Math.min(r[1], s[i + 1]), Math.max(r[2], s[i]), Math.max(r[3], s[i + 1])];
      }
    }
    return r;
  }
  return annot.rect;
}

/**
 * Matriz PDF [a b c d e f] para dibujar una imagen dentro de la caja (x0, y0, w, h)
 * en el espacio de usuario, de forma que se vea derecha cuando la página
 * se muestra con k cuartos de vuelta.
 */
export function imageMatrix(k, x0, y0, w, h) {
  switch (((k % 4) + 4) % 4) {
    case 1: return [0, h, -w, 0, x0 + w, y0];
    case 2: return [-w, 0, 0, -h, x0 + w, y0 + h];
    case 3: return [0, -h, w, 0, x0, y0 + h];
    default: return [w, 0, 0, h, x0, y0];
  }
}
