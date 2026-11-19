/**
 * PLANE CUT — clip a mesh against the X=0 plane and cap the opening.
 * Useful before mirroring a half-model, and for slicing a mesh for print.
 * Pure: no module state.
 */
import {
  cross, sub, dot, mergeByDistance, fixWinding,
} from './mesh.js';

/**
 * @param {{verts:number[][],faces:number[][]}} mesh
 * @param {1|-1} side keep the +X (1) or -X (-1) half
 * @param {boolean} cap close the cut cross-section
 */
export function cutX(mesh, side = 1, cap = true) {
  const verts = mesh.verts.map((v) => v.slice());
  const faces = [];
  const cutEdges = [];
  const cutVerts = new Map();

  const edgeCut = (a, b) => {
    const key = a < b ? a + '_' + b : b + '_' + a;
    if (cutVerts.has(key)) return cutVerts.get(key);
    const va = verts[a], vb = verts[b];
    const t = va[0] / (va[0] - vb[0]);
    verts.push([0, va[1] + (vb[1] - va[1]) * t, va[2] + (vb[2] - va[2]) * t]);
    const i = verts.length - 1;
    cutVerts.set(key, i);
    return i;
  };

  const inSide = (i) => verts[i][0] * side >= -1e-9;

  for (const f of mesh.faces) {
    const k = f.length;
    if (f.every(inSide)) { faces.push(f.slice()); continue; }
    if (!f.some(inSide)) continue;

    const out = [];
    const onCut = [];
    for (let i = 0; i < k; i++) {
      const a = f[i], b = f[(i + 1) % k];
      const aIn = inSide(a), bIn = inSide(b);
      if (aIn) out.push(a);
      if (aIn !== bIn) {
        const ci = edgeCut(a, b);
        out.push(ci);
        onCut.push(ci);
      }
    }
    if (out.length >= 3) faces.push(out);
    if (onCut.length === 2) cutEdges.push(onCut);
  }

  const result = { verts, faces };
  if (!cap || !cutEdges.length) return mergeByDistance(result, 1e-6);

  // cap: fan from the centroid of the cut loop
  const c = [0, 0, 0];
  let n = 0;
  for (const [a] of cutEdges) { c[0] += verts[a][0]; c[1] += verts[a][1]; c[2] += verts[a][2]; n++; }
  if (!n) return mergeByDistance(result, 1e-6);
  c[0] /= n; c[1] /= n; c[2] /= n;
  verts.push(c);
  const ci = verts.length - 1;
  for (const [a, b] of cutEdges) {
    // The cap normal must point along `side`; use the tiny-cap triangle's own
    // winding to decide, which is robust even for concave cross-sections.
    const nn = cross(sub(verts[b], verts[a]), sub(verts[a], verts[ci]));
    faces.push(dot(nn, [side, 0, 0]) >= 0 ? [ci, a, b] : [ci, b, a]);
  }

  return mergeByDistance(fixWinding(result), 1e-6);
}
