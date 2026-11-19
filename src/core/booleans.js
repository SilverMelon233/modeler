import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { repairSolid, dropDegenerate, openEdges as openEdgeCount } from '../core/mesh.js';

const OPS = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };

function toBrush(mesh) {
  const positions = [];
  const index = [];
  for (const v of mesh.verts) positions.push(v[0], v[1], v[2]);
  for (const f of mesh.faces)
    for (let i = 1; i < f.length - 1; i++) index.push(f[0], f[i], f[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  const b = new Brush(g);
  b.updateMatrixWorld();
  return b;
}

/** Convert a THREE.BufferGeometry to our mesh format (triangles). */
export function fromBufferGeometry(g) {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const verts = [];
  for (let i = 0; i < pos.count; i++) verts.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  const faces = [];
  // The CSG evaluator returns non-indexed geometry, so both paths matter.
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) faces.push([idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)]);
  } else {
    for (let i = 0; i + 2 < pos.count; i += 3) faces.push([i, i + 1, i + 2]);
  }
  return { verts, faces };
}

/**
 * CSG between two quad meshes. Returns a triangle mesh.
 * `result` is normalised to a similar visual scale by caller if needed.
 */
export function booleanOp(meshA, meshB, op = 'subtract') {
  const evaluator = new Evaluator();
  evaluator.attributes = ['position'];
  evaluator.useGroups = false;
  const a = toBrush(meshA);
  const b = toBrush(meshB);
  const out = evaluator.evaluate(a, b, OPS[op]);
  const geom = out.geometry.clone();
  geom.deleteAttribute('normal');
  geom.deleteAttribute('uv');
  const mesh = fromBufferGeometry(geom);
  const repaired = repairSolid(mesh, 1e-6).mesh;
  // Collapse slivers whose area is below numerical noise. Only keep the
  // tidy-up when it does not open the surface (a tiny sliver can be the only
  // thing sealing a T-junction).
  const tidy = dropDegenerate(repaired, 1e-9);
  return openEdgeCount(tidy) <= openEdgeCount(repaired) ? tidy : repaired;
}

/** Debounced-quality helper: run boolean work off the interaction path. */
export async function booleanAsync(meshA, meshB, op) {
  await new Promise((r) => setTimeout(r, 0));
  return booleanOp(meshA, meshB, op);
}
