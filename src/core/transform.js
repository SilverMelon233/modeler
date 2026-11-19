/**
 * TRANSFORM — 4x4 matrices stored column-major (same layout as THREE.Matrix4)
 * and helpers to bake transforms into quad meshes.
 */
import { add, sub, mul, cross, norm, dot, len } from './mesh.js';

export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function fromTRS(position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const [rx, ry, rz] = rotation;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // R = Ry * Rx * Rz  (matches the rotation order used by the character builder)
  const m00 = cy * cz + sy * sx * sz;
  const m01 = -cy * sz + sy * sx * cz;
  const m02 = sy * cx;
  const m10 = cx * sz;
  const m11 = cx * cz;
  const m12 = -sx;
  const m20 = -sy * cz + cy * sx * sz;
  const m21 = sy * sz + cy * sx * cz;
  const m22 = cy * cx;

  return [
    m00 * scale[0], m10 * scale[0], m20 * scale[0], 0,
    m01 * scale[1], m11 * scale[1], m21 * scale[1], 0,
    m02 * scale[2], m12 * scale[2], m22 * scale[2], 0,
    position[0], position[1], position[2], 1,
  ];
}

export function invert(m) {
  // Gauss-Jordan on the augmented [M | I] matrix, column-major storage.
  const a = [
    [m[0], m[4], m[8], m[12]],
    [m[1], m[5], m[9], m[13]],
    [m[2], m[6], m[10], m[14]],
    [m[3], m[7], m[11], m[15]],
  ];
  const inv = [
    [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1],
  ];
  for (let i = 0; i < 4; i++) {
    let pivot = i;
    for (let r = i + 1; r < 4; r++) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
    if (Math.abs(a[pivot][i]) < 1e-12) return identity();
    [a[i], a[pivot]] = [a[pivot], a[i]];
    [inv[i], inv[pivot]] = [inv[pivot], inv[i]];
    const d = a[i][i];
    for (let c = 0; c < 4; c++) { a[i][c] /= d; inv[i][c] /= d; }
    for (let r = 0; r < 4; r++) {
      if (r === i) continue;
      const f = a[r][i];
      if (!f) continue;
      for (let c = 0; c < 4; c++) {
        a[r][c] -= f * a[i][c];
        inv[r][c] -= f * inv[i][c];
      }
    }
  }
  return [
    inv[0][0], inv[1][0], inv[2][0], inv[3][0],
    inv[0][1], inv[1][1], inv[2][1], inv[3][1],
    inv[0][2], inv[1][2], inv[2][2], inv[3][2],
    inv[0][3], inv[1][3], inv[2][3], inv[3][3],
  ];
}

export function transformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/** Apply a matrix to every vertex; mirrors flip the face winding. */
export function applyMatrix(mesh, m) {
  const det =
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5]);
  const flip = det < 0;
  return {
    verts: mesh.verts.map((v) => transformPoint(m, v)),
    faces: mesh.faces.map((f) => (flip ? f.slice().reverse() : f.slice())),
    faceSource: mesh.faceSource ? mesh.faceSource.slice() : undefined,
  };
}

export function applyTRS(mesh, { position, rotation, scale, mirror } = {}) {
  let out = mesh;
  if (mirror === 'x' || mirror === 'y' || mirror === 'z') {
    const mm = identity();
    const i = { x: 0, y: 1, z: 2 }[mirror];
    mm[i * 4 + i] = -1;
    out = applyMatrix(out, mm);
  }
  if (position || rotation || scale) {
    out = applyMatrix(out, fromTRS(position || [0, 0, 0], rotation || [0, 0, 0], scale || [1, 1, 1]));
  }
  return out;
}
