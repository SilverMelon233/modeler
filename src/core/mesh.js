/**
 * QUAD CORE — a small, dependency-free polygonal modelling kernel.
 *
 * A mesh is { verts: number[][3], faces: number[][] }.
 * Faces are usually quads (4 indices) which makes Catmull-Clark subdivision,
 * extrusion and mirroring predictable and clean. Tris / ngons are supported.
 */

export const EPS = 1e-7;

/* ------------------------------------------------------------------ utils */

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function faceCenter(verts, face) {
  const c = [0, 0, 0];
  for (const i of face) {
    c[0] += verts[i][0];
    c[1] += verts[i][1];
    c[2] += verts[i][2];
  }
  return mul(c, 1 / face.length);
}

export function faceNormal(verts, face) {
  // Newell's method — robust for ngons.
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < face.length; i++) {
    const a = verts[face[i]];
    const b = verts[face[(i + 1) % face.length]];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const n = [nx, ny, nz];
  const l = len(n);
  return l > 1e-12 ? mul(n, 1 / l) : [0, 1, 0];
}

export function bounds(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.verts) {
    for (let k = 0; k < 3; k++) {
      if (v[k] < min[k]) min[k] = v[k];
      if (v[k] > max[k]) max[k] = v[k];
    }
  }
  if (!mesh.verts.length) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: [0, 0, 0] };
  const size = sub(max, min);
  return { min, max, size, center: add(min, mul(size, 0.5)) };
}

const edgeKey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

/** Build edge -> faces map. */
export function edgeMap(mesh) {
  const map = new Map();
  mesh.faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      if (a === b) continue;
      const k = edgeKey(a, b);
      let e = map.get(k);
      if (!e) map.set(k, (e = { a: Math.min(a, b), b: Math.max(a, b), faces: [] }));
      e.faces.push(fi);
    }
  });
  return map;
}

export function vertexNormals(mesh) {
  const out = Array.from({ length: mesh.verts.length }, () => [0, 0, 0]);
  for (const f of mesh.faces) {
    const n = faceNormal(mesh.verts, f);
    for (const i of f) {
      out[i][0] += n[0]; out[i][1] += n[1]; out[i][2] += n[2];
    }
  }
  return out.map((n) => (len(n) > 1e-9 ? norm(n) : [0, 0, 0]));
}

export function cloneMesh(mesh) {
  return {
    verts: mesh.verts.map((v) => [v[0], v[1], v[2]]),
    faces: mesh.faces.map((f) => f.slice()),
    faceGroup: mesh.faceGroup ? mesh.faceGroup.slice() : undefined,
  };
}

export function mergeByDistance(mesh, tol = 1e-5) {
  const cell = Math.max(tol, 1e-6) * 2;
  const map = new Map();
  const remap = new Array(mesh.verts.length);
  const verts = [];
  mesh.verts.forEach((v, i) => {
    const key = `${Math.round(v[0] / cell)}_${Math.round(v[1] / cell)}_${Math.round(v[2] / cell)}`;
    let hit = -1;
    const c = key.split('_').map(Number);
    outer: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const k = `${c[0] + dx}_${c[1] + dy}_${c[2] + dz}`;
          const list = map.get(k);
          if (list) for (const j of list) {
            if (len(sub(verts[j], v)) <= tol) { hit = j; break outer; }
          }
        }
    if (hit < 0) { hit = verts.length; verts.push(v.slice()); }
    const k2 = `${Math.round(v[0] / cell)}_${Math.round(v[1] / cell)}_${Math.round(v[2] / cell)}`;
    if (!map.has(k2)) map.set(k2, []);
    map.get(k2).push(hit);
    remap[i] = hit;
  });
  const faces = [];
  for (const f of mesh.faces) {
    const nf = [];
    for (const i of f) {
      const r = remap[i];
      if (!nf.length || nf[nf.length - 1] !== r) nf.push(r);
    }
    if (nf.length > 1 && nf[0] === nf[nf.length - 1]) nf.pop();
    if (nf.length >= 3) faces.push(nf);
  }
  return { verts, faces };
}

/** Drop unused vertices and report the old->new mapping. */
export function compact(mesh) {
  const used = new Uint8Array(mesh.verts.length);
  for (const f of mesh.faces) for (const i of f) used[i] = 1;
  const map = new Int32Array(mesh.verts.length).fill(-1);
  const verts = [];
  mesh.verts.forEach((v, i) => {
    if (used[i]) { map[i] = verts.length; verts.push(v.slice()); }
  });
  const faces = mesh.faces.map((f) => f.map((i) => map[i]));
  return { verts, faces, map };
}

/* ------------------------------------------------------------ subdivision */

/**
 * Catmull-Clark subdivision, ngon/quad/tri safe, with boundary rules.
 * Returns { verts, faces, faceSource } where faceSource[i] is the index of
 * the face in the input mesh that face i descended from (used for picking).
 */
export function catmullClark(mesh, faceSource) {
  const { verts, faces } = mesh;
  const nv = verts.length;
  const src = faceSource || faces.map((_, i) => i);
  const edges = edgeMap(mesh);

  const facesOfVert = Array.from({ length: nv }, () => []);
  const edgesOfVert = Array.from({ length: nv }, () => []);
  faces.forEach((f, fi) => { for (const v of f) facesOfVert[v].push(fi); });
  for (const e of edges.values()) {
    edgesOfVert[e.a].push(e); edgesOfVert[e.b].push(e);
  }

  const facePts = faces.map((f) => faceCenter(verts, f));
  const edgePts = new Map();
  const edgeNewIdx = new Map();
  let cursor = nv + faces.length;
  for (const [k, e] of edges) {
    const pa = verts[e.a], pb = verts[e.b];
    let p;
    if (e.faces.length < 2) {
      p = mul(add(pa, pb), 0.5);
    } else {
      const f0 = facePts[e.faces[0]], f1 = facePts[e.faces[1]];
      p = mul(add(add(pa, pb), add(f0, f1)), 0.25);
    }
    edgePts.set(k, p);
    edgeNewIdx.set(k, cursor++);
  }

  const outVerts = new Array(cursor);
  // original vertices
  for (let i = 0; i < nv; i++) {
    const P = verts[i];
    const es = edgesOfVert[i];
    if (!es.length) { outVerts[i] = P.slice(); continue; }   // isolated vertex

    const boundaryEdges = es.filter((e) => e.faces.length < 2);
    const fs = facesOfVert[i];

    if (boundaryEdges.length >= 2 || !fs.length) {
      // Crease / boundary rule: (6P + neighbours) / (6 + n).
      // With exactly two boundary neighbours this is the classic cc rule;
      // corner cases (1 or 3+ boundary edges) blend slightly toward P so the
      // result never divides by zero.
      const nbrs = boundaryEdges.map((e) => verts[e.a === i ? e.b : e.a]);
      const s = nbrs.reduce((acc, n) => add(acc, n), [0, 0, 0]);
      if (nbrs.length === 2) {
        outVerts[i] = mul(add(mul(P, 6), s), 1 / 8);
      } else if (nbrs.length === 0) {
        outVerts[i] = P.slice();
      } else {
        outVerts[i] = mul(add(mul(P, nbrs.length), s), 1 / (2 * nbrs.length));
      }
    } else {
      const F = fs.reduce((acc, fi) => add(acc, facePts[fi]), [0, 0, 0]);
      F[0] /= fs.length; F[1] /= fs.length; F[2] /= fs.length;
      const R = es.reduce((acc, e) => add(acc, mul(add(verts[e.a], verts[e.b]), 0.5)), [0, 0, 0]);
      R[0] /= es.length; R[1] /= es.length; R[2] /= es.length;
      const n = es.length;
      outVerts[i] = [
        (F[0] + 2 * R[0] + (n - 3) * P[0]) / n,
        (F[1] + 2 * R[1] + (n - 3) * P[1]) / n,
        (F[2] + 2 * R[2] + (n - 3) * P[2]) / n,
      ];
    }
    // guard against any residual numerical NaN
    if (outVerts[i].some((n) => !Number.isFinite(n))) outVerts[i] = P.slice();
  }
  // face points
  faces.forEach((f, fi) => { outVerts[nv + fi] = facePts[fi]; });
  // edge points
  for (const [k, p] of edgePts) outVerts[edgeNewIdx.get(k)] = p;

  const outFaces = [];
  const outSource = [];
  faces.forEach((f, fi) => {
    const k = f.length;
    for (let i = 0; i < k; i++) {
      const v = f[i];
      const prev = f[(i - 1 + k) % k];
      const next = f[(i + 1) % k];
      const ePrev = edgeNewIdx.get(edgeKey(prev, v));
      const eNext = edgeNewIdx.get(edgeKey(v, next));
      outFaces.push([v, eNext, nv + fi, ePrev]);
      outSource.push(src[fi]);
    }
  });

  return { verts: outVerts, faces: outFaces, faceSource: outSource };
}

/** Subdivide n times. */
export function subdivide(mesh, levels = 1, faceSource) {
  let m = mesh;
  let src = faceSource || mesh.faces.map((_, i) => i);
  for (let i = 0; i < levels; i++) {
    const r = catmullClark(m, src);
    m = { verts: r.verts, faces: r.faces };
    src = r.faceSource;
  }
  return { ...m, faceSource: src };
}

/* --------------------------------------------------------------- topology */

/**
 * Extrude a contiguous set of faces along averaged vertex normals.
 * Returns a new mesh.
 */
export function extrudeFaces(mesh, faceIdxs, distance = 0.2) {
  const sel = new Set(faceIdxs);
  if (!sel.size) return mesh;
  const tris = new Set();
  for (const fi of sel) {
    const f = mesh.faces[fi];
    for (let i = 0; i < f.length; i++) tris.add(f[i]);
  }
  // vertex normals limited to the selected region
  const vn = new Map();
  for (const fi of sel) {
    const f = mesh.faces[fi];
    const n = faceNormal(mesh.verts, f);
    for (const i of f) {
      if (!vn.has(i)) vn.set(i, [0, 0, 0]);
      const a = vn.get(i); a[0] += n[0]; a[1] += n[1]; a[2] += n[2];
    }
  }
  for (const [i, n] of vn) vn.set(i, mul(norm(n), distance));

  // boundary detection: undirected edges used once inside sel
  const count = new Map();
  const dir = [];
  for (const fi of sel) {
    const f = mesh.faces[fi];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      count.set(edgeKey(a, b), (count.get(edgeKey(a, b)) || 0) + 1);
      dir.push([a, b, fi]);
    }
  }
  const boundary = dir.filter(([a, b]) => (count.get(edgeKey(a, b)) || 0) === 1);

  const verts = mesh.verts.map((v) => v.slice());
  const map = new Map();
  for (const fi of sel) {
    for (const i of mesh.faces[fi]) {
      if (!map.has(i)) {
        map.set(i, verts.length);
        const d = vn.get(i) || [0, 0, 0];
        verts.push([verts[i][0] + d[0], verts[i][1] + d[1], verts[i][2] + d[2]]);
      }
    }
  }

  const faces = [];
  const src = [];
  const parent = mesh.faceSource || mesh.faces.map((_, i) => i);
  mesh.faces.forEach((f, fi) => {
    if (!sel.has(fi)) { faces.push(f.slice()); src.push(parent[fi]); }
  });
  // cap faces
  for (const fi of sel) {
    const f = mesh.faces[fi].map((i) => map.get(i));
    faces.push(f); src.push(parent[fi]);
  }
  // walls
  for (const [a, b] of boundary) {
    faces.push([a, b, map.get(b), map.get(a)]);
    src.push(parent[dir.find((d) => d[0] === a && d[1] === b)[2]]);
  }
  return { verts, faces, faceSource: src };
}

/** Per-face inset. */
export function insetFaces(mesh, faceIdxs, amount = 0.15) {
  const sel = new Set(faceIdxs);
  if (!sel.size) return mesh;
  const verts = mesh.verts.map((v) => v.slice());
  const faces = [];
  const src = [];
  const parent = mesh.faceSource || mesh.faces.map((_, i) => i);
  mesh.faces.forEach((f, fi) => {
    if (!sel.has(fi)) { faces.push(f.slice()); src.push(parent[fi]); return; }
    const c = faceCenter(verts, f);
    const inner = f.map((i) => {
      const p = verts[i];
      verts.push([p[0] + (c[0] - p[0]) * amount, p[1] + (c[1] - p[1]) * amount, p[2] + (c[2] - p[2]) * amount]);
      return verts.length - 1;
    });
    faces.push(inner); src.push(parent[fi]);
    for (let i = 0; i < f.length; i++) {
      const j = (i + 1) % f.length;
      faces.push([f[i], f[j], inner[j], inner[i]]);
      src.push(parent[fi]);
    }
  });
  return { verts, faces, faceSource: src };
}

export function deleteFaces(mesh, faceIdxs) {
  const sel = new Set(faceIdxs);
  const faces = [];
  const src = [];
  const parent = mesh.faceSource || mesh.faces.map((_, i) => i);
  mesh.faces.forEach((f, fi) => {
    if (!sel.has(fi)) { faces.push(f.slice()); src.push(parent[fi]); }
  });
  const c = compact({ verts: mesh.verts, faces });
  return { ...c, faceSource: src };
}

/** Duplicate selected faces, flipped — handy for cloth/plates. */
export function duplicateFaces(mesh, faceIdxs, offset = [0, 0, 0]) {
  const sel = new Set(faceIdxs);
  if (!sel.size) return mesh;
  const verts = mesh.verts.map((v) => v.slice());
  const map = new Map();
  const faces = mesh.faces.map((f) => f.slice());
  const src = (mesh.faceSource || mesh.faces.map((_, i) => i)).slice();
  for (const fi of sel) {
    const nf = [];
    for (const i of mesh.faces[fi]) {
      if (!map.has(i)) {
        map.set(i, verts.length);
        const p = mesh.verts[i];
        verts.push([p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]);
      }
      nf.push(map.get(i));
    }
    faces.push(nf);
    src.push(fi);
  }
  return { verts, faces, faceSource: src };
}

/**
 * Simple linear subdivision of selected faces (quad -> 4 quads), which is
 * great for adding local detail before a CC pass.
 */
export function subdivideSelected(mesh, faceIdxs) {
  const sel = new Set(faceIdxs);
  if (!sel.size) return mesh;
  const verts = mesh.verts.map((v) => v.slice());
  const edgeMid = new Map();
  const getMid = (a, b) => {
    const k = edgeKey(a, b);
    if (!edgeMid.has(k)) {
      const p = mul(add(verts[a], verts[b]), 0.5);
      verts.push(p);
      edgeMid.set(k, verts.length - 1);
    }
    return edgeMid.get(k);
  };
  const faces = [];
  const src = [];
  const parent = mesh.faceSource || mesh.faces.map((_, i) => i);
  mesh.faces.forEach((f, fi) => {
    if (!sel.has(fi) || f.length !== 4) { faces.push(f.slice()); src.push(parent[fi]); return; }
    const c = verts.length;
    verts.push(faceCenter(mesh.verts, f));
    const m = [];
    for (let i = 0; i < 4; i++) m.push(getMid(f[i], f[(i + 1) % 4]));
    faces.push([f[0], m[0], c, m[3]]);
    faces.push([m[0], f[1], m[1], c]);
    faces.push([c, m[1], f[2], m[2]]);
    faces.push([m[3], c, m[2], f[3]]);
    for (let i = 0; i < 4; i++) src.push(parent[fi]);
  });
  const c = compact({ verts, faces });
  return { ...c, faceSource: src };
}

export function joinMeshes(a, b) {
  const verts = a.verts.concat(b.verts);
  const off = a.verts.length;
  const faces = a.faces.concat(b.faces.map((f) => f.map((i) => i + off)));
  return { verts, faces };
}

/** Mirror across X with optional weld on the mirror plane. */
/**
 * Mirror across X. Vertices on the plane are shared (welded) so the seam is
 * continuous. Mirrored faces get reversed winding to stay outward.
 */
export function mirrorX(mesh, weld = true) {
  const eps = weld ? 1e-5 : -1;
  const verts = mesh.verts.map((v) => v.slice());
  const idx = new Array(mesh.verts.length);
  const key = (v) => `${Math.round(v[0] / 1e-6)}_${Math.round(v[1] / 1e-6)}_${Math.round(v[2] / 1e-6)}`;
  const lookup = new Map();
  verts.forEach((v, i) => lookup.set(key(v), i));

  mesh.verts.forEach((v, i) => {
    if (weld && Math.abs(v[0]) <= eps) { verts[i][0] = 0; idx[i] = i; return; }
    const mv = [-v[0], v[1], v[2]];
    if (weld) {
      const hit = lookup.get(key(mv));
      if (hit !== undefined) { idx[i] = hit; return; }
    }
    idx[i] = verts.length;
    verts.push(mv);
    if (weld) lookup.set(key(mv), verts.length - 1);
  });

  // Faces lying entirely on the mirror plane (a cut cap) must be dropped,
  // otherwise the mirrored result contains an internal internal wall.
  const onPlane = (f) => f.every((i) => Math.abs(mesh.verts[i][0]) <= (weld ? eps : 1e-9));
  const faces = mesh.faces.filter((f) => !onPlane(f)).map((f) => f.slice());
  for (const f of mesh.faces) {
    if (onPlane(f)) continue;
    faces.push(f.map((i) => idx[i]).reverse());
  }

  const out = { verts, faces };
  return weld ? mergeByDistance(out, 1e-6) : out;
}

/** Signed volume via the divergence theorem. Positive = outward winding. */
export function signedVolume(mesh) {
  let vol = 0;
  for (const f of mesh.faces) {
    for (let i = 1; i < f.length - 1; i++) {
      const a = mesh.verts[f[0]], b = mesh.verts[f[i]], c = mesh.verts[f[i + 1]];
      vol += dot(a, cross(b, c)) / 6;
    }
  }
  return vol;
}

export function flipFaces(mesh) {
  return { ...mesh, faces: mesh.faces.map((f) => f.slice().reverse()) };
}

/** Flip a closed mesh if its winding is inverted. */
export function fixWinding(mesh) {
  return signedVolume(mesh) < 0 ? flipFaces(mesh) : mesh;
}

/**
 * CSG output often duplicates vertices along cuts, leaving T-junctions that
 * look like open edges. Merging by position and dropping degenerate slivers
 * makes the result watertight in the vast majority of cases.
 */
export function weldSolid(mesh, tol = 1e-6) {
  const map = new Map();
  const verts = [];
  const idx = new Array(mesh.verts.length);
  const q = (n) => Math.round(n / tol);
  for (let i = 0; i < mesh.verts.length; i++) {
    const v = mesh.verts[i];
    const key = `${q(v[0])}_${q(v[1])}_${q(v[2])}`;
    let hit = map.get(key);
    if (hit === undefined) {
      hit = verts.length;
      verts.push([v[0], v[1], v[2]]);
      map.set(key, hit);
    }
    idx[i] = hit;
  }
  const faces = [];
  for (const f of mesh.faces) {
    const nf = [];
    for (const i of f) {
      const r = idx[i];
      if (!nf.length || nf[nf.length - 1] !== r) nf.push(r);
    }
    if (nf.length > 1 && nf[0] === nf[nf.length - 1]) nf.pop();
    // drop slivers with near-zero area
    if (nf.length >= 3) {
      const p = nf.map((i) => verts[i]);
      let area = 0;
      for (let i = 1; i < p.length - 1; i++) {
        const c = cross(sub(p[i], p[0]), sub(p[i + 1], p[0]));
        area += len(c) * 0.5;
      }
      if (area > 1e-12) faces.push(nf);
    }
  }
  return fixWinding({ verts, faces });
}

/** Switch all faces to face outward from the centroid (best-effort). */
export function orientOutward(mesh) {
  const b = bounds(mesh);
  const c = b.center;
  const faces = mesh.faces.map((f) => {
    const n = faceNormal(mesh.verts, f);
    const fc = faceCenter(mesh.verts, f);
    return dot(n, sub(fc, c)) < 0 ? f.slice().reverse() : f.slice();
  });
  return { verts: mesh.verts, faces };
}

/**
 * Give an open shell thickness so it becomes a closed solid.
 * Duplicates the sheet, pushes it back along the vertex normals, flips it, and
 * stitches every boundary edge. This is how cloth / plates / hair cards become
 * printable without a boolean pass.
 */
export function solidify(mesh, thickness = 0.02, offset = -1) {
  const n = mesh.verts.length;
  const nrm = vertexNormals(mesh);
  const dir = offset === 0 ? 0 : offset;
  const verts = mesh.verts.map((v, i) => [
    v[0] + nrm[i][0] * thickness * dir * 0.5,
    v[1] + nrm[i][1] * thickness * dir * 0.5,
    v[2] + nrm[i][2] * thickness * dir * 0.5,
  ]);
  for (let i = 0; i < n; i++) {
    verts.push([
      mesh.verts[i][0] - nrm[i][0] * thickness * dir * 0.5,
      mesh.verts[i][1] - nrm[i][1] * thickness * dir * 0.5,
      mesh.verts[i][2] - nrm[i][2] * thickness * dir * 0.5,
    ]);
  }
  const faces = [];
  for (const f of mesh.faces) faces.push(f.slice());
  for (const f of mesh.faces) faces.push(f.map((i) => i + n).reverse());

  // stitch boundary edges (edges used by exactly one face)
  const count = new Map();
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const k = a < b ? a + '_' + b : b + '_' + a;
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const k = a < b ? a + '_' + b : b + '_' + a;
      if ((count.get(k) || 0) === 1) faces.push([a, b, b + n, a + n]);
    }
  }
  return { verts, faces };
}

/* ----------------------------------------------------------------- render */

/**
 * Triangulate for the renderer. Returns typed arrays + tri -> base face map.
 */
export function toRenderData(mesh) {
  const verts = mesh.verts;
  const positions = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    positions[i * 3] = verts[i][0];
    positions[i * 3 + 1] = verts[i][1];
    positions[i * 3 + 2] = verts[i][2];
  }
  const idx = [];
  const triBase = [];
  const faceSource = mesh.faceSource || mesh.faces.map((_, i) => i);
  mesh.faces.forEach((f, fi) => {
    for (let i = 1; i < f.length - 1; i++) {
      idx.push(f[0], f[i], f[i + 1]);
      triBase.push(faceSource[fi]);
    }
  });
  const indices = verts.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { positions, indices, triBase };
}

export function toWireframeTris(mesh) {
  const pos = [];
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = mesh.verts[f[i]], b = mesh.verts[f[(i + 1) % f.length]];
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  }
  return new Float32Array(pos);
}

/* ----------------------------------------------------------- deform tools */

export function sculptBrush(mesh, center, radius, strength, mode = 'inflate', normals) {
  const verts = mesh.verts.map((v) => v.slice());
  const nrm = normals || vertexNormals(mesh);
  const neigh = new Map();
  const ensure = (i) => { if (!neigh.has(i)) neigh.set(i, new Set()); return neigh.get(i); };
  for (const f of mesh.faces) for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length];
    ensure(a).add(b); ensure(b).add(a);
  }
  const r2 = radius * radius;
  verts.forEach((v, i) => {
    const d2 = (v[0] - center[0]) ** 2 + (v[1] - center[1]) ** 2 + (v[2] - center[2]) ** 2;
    if (d2 > r2) return;
    const fall = 1 - Math.sqrt(d2) / radius;
    const w = fall * fall * (3 - 2 * fall);
    if (mode === 'inflate') {
      verts[i] = [
        v[0] + nrm[i][0] * strength * w,
        v[1] + nrm[i][1] * strength * w,
        v[2] + nrm[i][2] * strength * w,
      ];
    } else if (mode === 'flatten') {
      verts[i] = [
        v[0] - nrm[i][0] * strength * w,
        v[1] - nrm[i][1] * strength * w,
        v[2] - nrm[i][2] * strength * w,
      ];
    } else if (mode === 'smooth') {
      const ns = neigh.get(i);
      if (!ns || !ns.size) return;
      const avg = [0, 0, 0];
      for (const j of ns) { avg[0] += verts[j][0]; avg[1] += verts[j][1]; avg[2] += verts[j][2]; }
      avg[0] /= ns.size; avg[1] /= ns.size; avg[2] /= ns.size;
      const t = strength * w * 0.9;
      verts[i] = [v[0] + (avg[0] - v[0]) * t, v[1] + (avg[1] - v[1]) * t, v[2] + (avg[2] - v[2]) * t];
    } else if (mode === 'pinch') {
      // move toward the brush centre, tangentially
      const toC = sub(center, v);
      const n = nrm[i];
      const tangential = sub(toC, mul(n, dot(toC, n)));
      verts[i] = add(v, mul(tangential, strength * w * 2));
    }
  });
  return { ...mesh, verts };
}

/**
 * Heal T-junctions: if a vertex lies on the interior of a face edge, insert it
 * into that face. This is what turns CSG output with split edges into a
 * topologically closed surface (required for reliable STL/3MF export).
 *
 * Only vertices that touch a boundary edge are considered, and candidates are
 * looked up in a coarse spatial grid, so the cost stays near-linear.
 */
export function healTJunctions(mesh, tol = 1e-6) {
  const verts = mesh.verts;
  // 1. classify edges
  const edgeCount = new Map();
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const k = a < b ? a + '_' + b : b + '_' + a;
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    }
  }
  const boundaryVerts = new Set();
  for (const [k, c] of edgeCount) {
    if (c !== 2) {
      const [a, b] = k.split('_').map(Number);
      boundaryVerts.add(a); boundaryVerts.add(b);
    }
  }
  if (!boundaryVerts.size) return { verts, faces: mesh.faces, inserted: 0 };

  // 2. coarse grid over boundary vertices only
  const bb = bounds(mesh);
  const diag = Math.max(1e-3, Math.hypot(...bb.size));
  const cell = diag / 32;
  const grid = new Map();
  for (const i of boundaryVerts) {
    const v = verts[i];
    const k = `${Math.floor(v[0] / cell)}_${Math.floor(v[1] / cell)}_${Math.floor(v[2] / cell)}`;
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  const nearVerts = (A, B) => {
    const lo = [0, 1, 2].map((d) => Math.floor(Math.min(A[d], B[d]) / cell) - 1);
    const hi = [0, 1, 2].map((d) => Math.floor(Math.max(A[d], B[d]) / cell) + 1);
    const span = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
    if (span > 4096) return null;   // too long an edge: skip, not a T-junction
    const out = [];
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const list = grid.get(`${x}_${y}_${z}`);
          if (list) out.push(...list);
        }
    return out;
  };
  const eps = Math.max(tol, diag * 1e-6);
  const onSegment = (p, a, b) => {
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    if (l2 < 1e-14) return -1;
    const t = dot(sub(p, a), ab) / l2;
    if (t <= 2e-3 || t >= 1 - 2e-3) return -1;
    const proj = add(a, mul(ab, t));
    return len(sub(p, proj)) <= eps ? t : -1;
  };

  // 3. split edges that have a boundary vertex sitting on them
  let inserted = 0;
  const faces = mesh.faces.map((f) => {
    const out = [];
    const k = f.length;
    for (let i = 0; i < k; i++) {
      const a = f[i], b = f[(i + 1) % k];
      out.push(a);
      const A = verts[a], B = verts[b];
      const cand = nearVerts(A, B);
      if (!cand) continue;
      const hits = [];
      for (const vi of cand) {
        if (vi === a || vi === b || !boundaryVerts.has(vi)) continue;
        const t = onSegment(verts[vi], A, B);
        if (t > 0) hits.push([t, vi]);
      }
      if (hits.length) {
        hits.sort((p, q) => p[0] - q[0]);
        for (const [, vi] of hits) { out.push(vi); inserted++; }
      }
    }
    return out;
  });
  return { verts, faces, inserted };
}

/**
 * Clean faces produced by CSG.
 *
 * two-bvh-csg emits faces like [a, b, c, b]: a self-cancelling polygon whose
 * signed area is ~0 but whose triangle-fan magnitude is not. Such faces corrupt
 * the edge topology (an edge ends up shared by 3–4 faces), so they must be
 * dropped outright rather than de-duplicated.
 */
export function dropDegenerate(mesh, tol = 1e-12) {
  const faces = [];
  for (const f of mesh.faces) {
    if (f.length < 3) continue;
    if (new Set(f).size !== f.length) continue;   // repeated index -> drop
    const pts = f.map((i) => mesh.verts[i]);
    // Newell normal: signed, so self-cancelling polygons collapse to ~0.
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < f.length; i++) {
      const a = pts[i], b = pts[(i + 1) % f.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    if (Math.hypot(nx, ny, nz) * 0.5 > tol) faces.push(f);
  }
  return { verts: mesh.verts, faces };
}

/** Count edges not shared by exactly two faces. */
export function openEdges(mesh) {
  let n = 0;
  for (const e of edgeMap(mesh).values()) if (e.faces.length !== 2) n++;
  return n;
}

/**
 * Full repair pass for CSG results.
 *
 * Cut vertices land arbitrarily close to existing ones, so distance welding
 * (not quantised) plus T-junction healing plus small-hole filling are all
 * needed. If the first pass is not clean we retry with a slightly looser
 * tolerance, which resolves the remaining numerical near-degeneracies.
 */
export function repairSolid(mesh, baseTol = 1e-6) {
  let best = null;
  for (const scale of [1, 4, 16, 64]) {
    const tol = baseTol * scale;
    let m = mergeByDistance(dropDegenerate(mesh, 1e-14), tol);
    const healed = healTJunctions(m, tol);
    m = { verts: healed.verts, faces: healed.faces };
    m = mergeByDistance(dropDegenerate(m, 1e-14), tol);
    m = fillHolesRobust(m, 256);
    m = collapseShortEdges(m);
    m = mergeByDistance(dropDegenerate(m, 1e-14), tol);
    m = fixWinding(m);
    const open = openEdges(m);
    const candidate = { mesh: m, inserted: healed.inserted, filled: m.filled || 0, open };
    if (!best || open < best.open) best = candidate;
    if (open === 0) break;
  }
  return best;
}

/**
 * Close small holes left by CSG: find boundary loops and fan-fill them.
 * Only loops under `maxVerts` are filled, so intentional openings (a cup's
 * rim, an open shell) survive.
 */
export function fillHoles(mesh, maxVerts = 32) {
  const edges = new Map();
  const addEdge = (a, b) => {
    const k = a < b ? a + '_' + b : b + '_' + a;
    edges.set(k, (edges.get(k) || 0) + 1);
  };
  for (const f of mesh.faces) for (let i = 0; i < f.length; i++) addEdge(f[i], f[(i + 1) % f.length]);
  const open = new Map();
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (edges.get(k) === 1) {
        if (!open.has(a)) open.set(a, []);
        if (!open.has(b)) open.set(b, []);
        open.get(a).push(b);
        open.get(b).push(a);
      }
    }
  }
  if (!open.size) return { verts: mesh.verts, faces: mesh.faces, filled: 0 };

  const used = new Set();
  const faces = mesh.faces.map((f) => f.slice());
  let filled = 0;
  for (const start of open.keys()) {
    if (used.has(start)) continue;
    // walk the loop
    const loop = [start];
    used.add(start);
    let cur = start;
    let guard = 0;
    while (guard++ < 4096) {
      const nexts = (open.get(cur) || []).filter((n) => !used.has(n));
      if (!nexts.length) break;
      cur = nexts[0];
      used.add(cur);
      loop.push(cur);
      if (cur === start) break;
    }
    if (loop.length < 3 || loop.length > maxVerts) continue;
    // Fan from the first loop vertex. The loop was walked along existing
    // boundary edges, so [loop[0], loop[i], loop[i+1]] already faces outward.
    for (let i = 1; i < loop.length - 1; i++) {
      faces.push([loop[0], loop[i], loop[i + 1]]);
    }
    filled++;
  }
  return { verts: mesh.verts, faces, filled, loops: filled };
}

/**
 * Collapse edges shorter than `maxLen` (in mesh-relative terms). CSG cuts can
 * leave a vertex a micrometre away from another, producing sliver faces that
 * read as non-manifold. Collapsing is safer than a bigger weld tolerance,
 * which would merge unrelated geometry.
 */
export function collapseShortEdges(mesh, maxLen) {
  const { verts, faces } = mesh;
  const bb = bounds(mesh);
  const limit = maxLen ?? Math.max(1e-9, Math.hypot(...bb.size) * 2e-5);
  const remap = new Int32Array(verts.length);
  for (let i = 0; i < verts.length; i++) remap[i] = i;
  const find = (i) => {
    while (remap[i] !== i) { remap[i] = remap[remap[i]]; i = remap[i]; }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) remap[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  let collapsed = 0;
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      if (find(a) === find(b)) continue;
      if (len(sub(verts[a], verts[b])) <= limit) { union(a, b); collapsed++; }
    }
  }
  if (!collapsed) return { verts, faces, collapsed: 0 };

  const nf = [];
  for (const f of faces) {
    const out = [];
    for (const i of f) {
      const r = find(i);
      if (!out.length || out[out.length - 1] !== r) out.push(r);
    }
    if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
    if (out.length >= 3) nf.push(out);
  }
  return { verts, faces: nf, collapsed };
}

/**
 * Robust hole filling: trace boundary loops using directed boundary edges.
 * A boundary edge is one that appears exactly once. We orient each loop so the
 * new cap faces outward, then fan-triangulate. This is what makes CSG output
 * watertight even when the cut leaves many small openings.
 */
export function fillHolesRobust(mesh, maxLoop = 256) {
  const count = new Map();
  const dir = new Map();      // "a_b" -> true for directed boundary edges
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      if (a === b) continue;
      const k = a < b ? a + '_' + b : b + '_' + a;
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (count.get(k) === 1) dir.set(a + '_' + b, true);
    }
  }
  if (!dir.size) return { verts: mesh.verts, faces: mesh.faces, filled: 0 };

  const out = new Map();      // a -> [b...]
  for (const k of dir.keys()) {
    const [a, b] = k.split('_').map(Number);
    if (!out.has(a)) out.set(a, []);
    out.get(a).push(b);
  }

  const used = new Set();
  const faces = mesh.faces.map((f) => f.slice());
  let filled = 0;

  for (const start of out.keys()) {
    if (used.has(start)) continue;
    const loop = [start];
    used.add(start);
    let cur = start;
    let ok = false;
    for (let guard = 0; guard < maxLoop + 4; guard++) {
      const nexts = (out.get(cur) || []).filter((n) => !used.has(n) || n === start);
      if (!nexts.length) break;
      const n = nexts[0];
      if (n === start) { ok = true; break; }
      used.add(n);
      loop.push(n);
      cur = n;
    }
    if (!ok || loop.length < 3 || loop.length > maxLoop) continue;
    // fan triangulate; loop is already oriented along boundary edges, so the
    // fill must use the reverse orientation to face outward.
    for (let i = 1; i < loop.length - 1; i++) {
      faces.push([loop[0], loop[i + 1], loop[i]]);
    }
    filled++;
  }
  return { verts: mesh.verts, faces, filled, loops: filled };
}
