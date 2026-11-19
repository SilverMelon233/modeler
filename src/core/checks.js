/**
 * MESH CHECKS — cheap geometric QA used by the CLI and the validation loop.
 * These are the checks an LLM-authored document should pass before export.
 */
import { edgeMap, faceNormal, faceCenter, bounds, len, sub, dot } from './mesh.js';

/** Every edge must be shared by exactly two faces. */
export function isWatertight(mesh) {
  for (const e of edgeMap(mesh).values()) {
    if (e.faces.length !== 2) return false;
  }
  return true;
}

export function openEdgeCount(mesh) {
  let n = 0;
  for (const e of edgeMap(mesh).values()) if (e.faces.length !== 2) n++;
  return n;
}

export function nonManifoldEdgeCount(mesh) {
  let n = 0;
  for (const e of edgeMap(mesh).values()) if (e.faces.length > 2) n++;
  return n;
}

/** Signed volume via the divergence theorem (uses a triangle fan per face). */
export function volume(mesh) {
  let vol = 0;
  for (const f of mesh.faces) {
    for (let i = 1; i < f.length - 1; i++) {
      const a = mesh.verts[f[0]], b = mesh.verts[f[i]], c = mesh.verts[f[i + 1]];
      vol += dot(a, crossV(b, c)) / 6;
    }
  }
  return vol;
}

const crossV = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Fraction of faces whose normal points away from the centroid. */
export function outwardRatio(mesh) {
  const c = bounds(mesh).center;
  let good = 0, total = 0;
  for (const f of mesh.faces) {
    const n = faceNormal(mesh.verts, f);
    const fc = faceCenter(mesh.verts, f);
    if (len(sub(fc, c)) < 1e-9) continue;
    total++;
    if (dot(n, sub(fc, c)) > 0) good++;
  }
  return total ? good / total : 1;
}

/** Bounding box aspect + degenerate-face detection. */
/**
 * Faces whose *entire* area collapses. A quad that got one collinear vertex
 * inserted (T-junction repair) still has area and must not be flagged.
 */
/**
 * Faces with negligible area. The tolerance is *relative to the model size*
 * because a needle sliver of 5e-13 m² is numerical noise on a 1 m object but
 * would be a real defect on a 10 µm object.
 */
export function degenerateFaces(mesh, tol) {
  if (tol === undefined) {
    const diag = Math.hypot(...bounds(mesh).size) || 1;
    tol = diag * diag * 1e-12;
  }
  let n = 0;
  for (const f of mesh.faces) {
    const pts = f.map((i) => mesh.verts[i]);
    let area = 0;
    for (let i = 1; i < f.length - 1; i++) {
      const v = crossV(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0]));
      area += len(v) * 0.5;
    }
    if (area < tol) n++;
  }
  return n;
}

/**
 * Full QA report. `strict` collects warnings worth surfacing to an author.
 */
export function meshReport(mesh) {
  const b = bounds(mesh);
  const vol = volume(mesh);
  const open = openEdgeCount(mesh);
  const nonManifold = nonManifoldEdgeCount(mesh);
  const degrad = degenerateFaces(mesh);
  const outRatio = outwardRatio(mesh);
  const warnings = [];
  if (open) warnings.push(`${open} 条开放边（非水密，STL 打印可能失败）`);
  if (nonManifold) warnings.push(`${nonManifold} 条非流形边`);
  if (degrad) warnings.push(`${degrad} 个退化面`);
  // The centroid heuristic is only meaningful for open / non-closed shells.
  // A watertight mesh with positive signed volume already has consistent winding.
  const windingOk = open === 0 && nonManifold === 0 ? vol > 0 : outRatio >= 0.9;
  if (!windingOk) warnings.push(`绕序可疑：朝外 ${Math.round(outRatio * 100)}%，体积 ${vol.toFixed(5)} m³`);
  const minSize = Math.min(...b.size);
  if (minSize <= 0) warnings.push('包围盒存在零厚度维度');
  return {
    verts: mesh.verts.length,
    faces: mesh.faces.length,
    tris: mesh.faces.reduce((n, f) => n + Math.max(0, f.length - 2), 0),
    watertight: open === 0 && nonManifold === 0,
    openEdges: open,
    nonManifoldEdges: nonManifold,
    degenerateFaces: degrad,
    outwardRatio: +outRatio.toFixed(3),
    windingOk: +windingOk,
    volume: +vol.toFixed(6),
    size: b.size.map((v) => +v.toFixed(4)),
    warnings,
  };
}
