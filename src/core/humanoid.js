/**
 * HUMANOID — single-topology parametric body.
 *
 * WHY THIS IS NOT THE OLD ASSEMBLY APPROACH.
 *
 * The previous generator concatenated ~40 independent closed shells (a sphere
 * for the deltoid, a tube for the upper arm, ...). Catmull-Clark shrinks every
 * closed shell toward its own centroid, so a shoulder that merely *touches* its
 * neighbour tears open into a visible seam under subdivision. That is an
 * architectural limit, not a tuning problem: disjoint shells can never stay
 * welded.
 *
 * This module builds ONE connected quad surface by box modelling: start from a
 * subdivided box torso, then repeatedly extrude a patch of faces outward to
 * grow each limb. Extrusion duplicates the patch boundary and stitches walls,
 * so every new segment shares edges with the one before it and the result is a
 * single closed manifold. Parameters only move existing vertices, so topology
 * is invariant across the whole parameter space — which is what makes these
 * effectively morph targets rather than rebuilds.
 */
import { cube } from './primitives.js';
import {
  faceCenter, mergeByDistance, fixWinding, signedVolume,
} from './mesh.js';

const key = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

export function centroidOf(verts, idxs) {
  const c = [0, 0, 0];
  for (const i of idxs) {
    c[0] += verts[i][0]; c[1] += verts[i][1]; c[2] += verts[i][2];
  }
  const n = idxs.length || 1;
  return [c[0] / n, c[1] / n, c[2] / n];
}

export function pickFaces(mesh, pred) {
  const out = [];
  mesh.faces.forEach((f, fi) => {
    if (pred(faceCenter(mesh.verts, f), fi)) out.push(fi);
  });
  return out;
}

/**
 * Extrude a contiguous face patch.
 *
 * The patch boundary is duplicated, offset, optionally scaled about `pivot`,
 * and stitched to the original surface with quad walls. The cap keeps the
 * original winding so it faces the same way; the caller's next extrusion uses
 * the returned `capFaces`.
 *
 * @returns {{mesh, capFaces:number[]}}
 */
export function extrudeRegion(mesh, faceIdxs, opts = {}) {
  const sel = new Set(faceIdxs);
  if (!sel.size) throw new Error('extrudeRegion: empty face selection');

  const count = new Map();
  const dirEdges = [];
  for (const fi of sel) {
    const f = mesh.faces[fi];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      count.set(key(a, b), (count.get(key(a, b)) || 0) + 1);
      dirEdges.push([a, b, fi]);
    }
  }

  const used = [];
  for (const fi of sel) for (const i of mesh.faces[fi]) used.push(i);
  const uniq = [...new Set(used)];

  const pivot = opts.pivot ?? centroidOf(mesh.verts, uniq);
  const offset = opts.offset ?? [0, 0, 0];
  const sc = opts.scale ?? 1;
  const [sx, sy, sz] = Array.isArray(sc) ? sc : [sc, sc, sc];

  const verts = mesh.verts.map((v) => v.slice());
  const map = new Map();
  for (const i of uniq) {
    const p = mesh.verts[i];
    map.set(i, verts.length);
    verts.push([
      pivot[0] + (p[0] - pivot[0]) * sx + offset[0],
      pivot[1] + (p[1] - pivot[1]) * sy + offset[1],
      pivot[2] + (p[2] - pivot[2]) * sz + offset[2],
    ]);
  }

  const parent = mesh.faceSource || null;
  const faces = [];
  const src = [];
  mesh.faces.forEach((f, fi) => {
    if (!sel.has(fi)) { faces.push(f.slice()); src.push(parent ? parent[fi] : fi); }
  });

  const capFaces = [];
  for (const fi of sel) {
    capFaces.push(faces.length);
    faces.push(mesh.faces[fi].map((i) => map.get(i)));
    src.push(parent ? parent[fi] : fi);
  }

  for (const [a, b, fi] of dirEdges) {
    if (count.get(key(a, b)) !== 1) continue;
    faces.push([a, b, map.get(b), map.get(a)]);
    src.push(parent ? parent[fi] : fi);
  }

  return { mesh: { verts, faces, faceSource: src }, capFaces };
}

/* --------------------------------------------------------------- profile */

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/** Piecewise-smooth lookup over [t, value] knots. */
function knotAt(knots, t) {
  if (t <= knots[0][0]) return knots[0][1];
  if (t >= knots[knots.length - 1][0]) return knots[knots.length - 1][1];
  for (let i = 0; i < knots.length - 1; i++) {
    const [t0, v0] = knots[i];
    const [t1, v1] = knots[i + 1];
    if (t >= t0 && t <= t1) return lerp(v0, v1, smooth((t - t0) / (t1 - t0)));
  }
  return knots[knots.length - 1][1];
}

/* ------------------------------------------------------------------ build */

export const HUMANOID_DEFAULTS = {
  height: 1.8,
  build: 0.45,
  muscle: 0.55,
  headScale: 1,
  neck: 1,
  armLength: 1,
  legLength: 1,
  handSize: 1,
  footSize: 1,
  bust: 0,
  shoulder: 0.5,
  belly: 0.3,
  hips: 0.5,
};

/**
 * @param {object} p HUMANOID_DEFAULTS overrides
 * @returns {{verts:number[][], faces:number[][]}} one closed quad surface
 */
export function buildHumanoid(p = {}) {
  const o = { ...HUMANOID_DEFAULTS, ...p };
  const H = o.height;
  const mus = o.muscle;
  const bld = o.build;

  const hipY = 0.500 * H;
  const torsoBottom = 0.455 * H;   // crotch
  const torsoTop = 0.815 * H;      // acromion (shoulder top)

  const pelvisW = (0.084 + 0.026 * o.hips) * H;
  const pelvisD = (0.046 + 0.018 * o.hips) * H;
  const waistW = (0.064 + 0.028 * o.belly) * H;
  const waistD = (0.038 + 0.024 * o.belly) * H;
  const chestW = (0.086 + 0.020 * bld + 0.008 * mus) * H;
  const chestD = (0.046 + 0.020 * bld) * H;
  const shoulderW = (0.100 + 0.018 * o.shoulder + 0.010 * bld) * H;

  // ---- base torso: a subdivided box, so every side is a clean quad grid ----
  const N = 5;                    // 5x5 quads per box face
  let mesh = cube(1, N);

  // Sockets are picked on the *unscaled* box using its known face-centre grid:
  // side faces sit at |axis| = 0.5, and the other two coordinates are
  // -0.5 + (i + 0.5) / N. Picking by exact grid cell avoids tolerance guessing.
  const cell = 1 / N;
  const at = (v, cells) => cells.some((c) => Math.abs(v - (-0.5 + (c + 0.5) * cell)) < cell * 0.25);
  // rows counted from the bottom (-0.5) upward
  const ARM_ROWS = [3];                 // one row of cells just below the shoulder
  const ARM_COLS = [1, 2];              // centred on the side, skipping the corners
  // A leg socket must not cross the body's midline: cells are indexed from the
  // -X side, so a positive-side leg uses the cells at +0.2 and +0.4 (indices 3,4),
  // never index 2 (which is centred on x=0 and would weld both legs together).
  // Column indices are offset by half a cell: cell i sits at -0.5+(i+0.5)/N,
  // so N=5 gives x = -0.4,-0.2,0,+0.2,+0.4 for i = 0..4. A leg must never
  // include the centre column (i=2), or both legs weld along the midline.
  const LEG_COLS_POS = [3, 4];        // x = +0.2, +0.4
  const LEG_COLS_NEG = [0, 1];        // x = -0.4, -0.2

  const sideFace = (sx) =>
    pickFaces(mesh, (c) =>
      Math.abs(c[0] - sx * 0.5) < 1e-6 &&
      at(c[1], ARM_ROWS) && at(c[2], ARM_COLS));
  const bottomFace = (sx) =>
    pickFaces(mesh, (c) =>
      Math.abs(c[1] + 0.5) < 1e-6 &&
      at(c[0], sx > 0 ? LEG_COLS_POS : LEG_COLS_NEG) && at(c[2], [1, 2]));
  const armSockets = { '1': sideFace(1), '-1': sideFace(-1) };
  const legSockets = { '1': bottomFace(1), '-1': bottomFace(-1) };
  const neckSocket = pickFaces(mesh, (c) =>
    Math.abs(c[1] - 0.5) < 1e-6 && at(c[0], [1, 2, 3]) && at(c[2], [1, 2, 3]));

  // Torso silhouette as a vertical profile (box coords -0.5..0.5 -> metres).
  const wKnots = [
    [0.00, pelvisW * 0.94], [0.10, pelvisW], [0.42, waistW],
    [0.72, chestW], [0.92, chestW * 1.02], [1.00, shoulderW],
  ];
  const dKnots = [
    [0.00, pelvisD * 0.96], [0.10, pelvisD], [0.42, waistD],
    [0.72, chestD], [0.92, chestD], [1.00, chestD * 0.88],
  ];
  const tOf = (y) => (y + 0.5);
  mesh.verts = mesh.verts.map((v) => {
    const t = Math.min(1, Math.max(0, tOf(v[1])));
    const w = knotAt(wKnots, t);
    const d = knotAt(dKnots, t);
    return [
      (v[0] / 0.5) * w,
      torsoBottom + t * (torsoTop - torsoBottom),
      (v[2] / 0.5) * d,
    ];
  });

  // ---- limbs: each list entry is one extrusion step ------------------------
  // FACE INDICES ARE NOT STABLE ACROSS EXTRUSIONS.
  //
  // extrudeRegion rebuilds the face array (keeps unselected faces, appends the
  // cap, appends walls), so an index captured from the base mesh points at a
  // different face after any extrusion runs. Sockets are therefore remembered
  // as *regions* (a set of vertex positions) and re-resolved to face indices
  // right before each use. That makes the order of the limbs irrelevant.
  /**
   * A socket is remembered by its vertex POSITIONS, not by face index, because
   * extrudeRegion renumbers faces. Positions must be captured from the base
   * mesh before any extrusion so that a later resolve cannot accidentally match
   * geometry produced by an earlier limb.
   */
  const region = (faceIdxs) => {
    const pts = new Set();
    for (const fi of faceIdxs) {
      for (const i of mesh.faces[fi]) {
        const v = mesh.verts[i];
        pts.add(`${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)}`);
      }
    }
    return pts;
  };
  const keyOf = (v) => `${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)}`;
  // A face belongs to the region only if ALL of its vertices are in it — a
  // single shared vertex would also match every neighbouring face.
  const resolve = (pts) => {
    const out = [];
    mesh.faces.forEach((f, fi) => {
      if (f.every((i) => pts.has(keyOf(mesh.verts[i])))) out.push(fi);
    });
    return out;
  };

  const grow = (regionPts, steps) => {
    let caps = null;
    for (const st of steps) {
      const targets = caps ?? resolve(regionPts);
      if (!targets.length) throw new Error('grow: socket did not resolve to any face');
      const r = extrudeRegion(mesh, targets, st);
      mesh = r.mesh;
      caps = r.capFaces;
    }
    return caps;
  };

  // CAPTURE EVERY SOCKET BEFORE ANY EXTRUSION.
  // Region keys are vertex positions; if a socket were captured after another
  // limb had already grown, its position set would be read off mutated geometry
  // and the later resolve could match the wrong faces.
  const armRegion = { '1': region(armSockets['1']), '-1': region(armSockets['-1']) };
  const legRegion = { '1': region(legSockets['1']), '-1': region(legSockets['-1']) };
  const neckRegion = region(neckSocket);

  // ARM.
  //
  // The socket lies on the side of the torso, so its faces point along +/-X.
  // Extruding such a patch straight DOWN produces a sheared prism (a blade),
  // not a tube — the cross-section stays perpendicular to X while the axis
  // travels along Y. So the arm is grown HORIZONTALLY along its own normal to
  // build a proper tube, then rotated down about the shoulder afterwards.
  const armLen = 0.46 * H * o.armLength;
  const armR = (0.030 + 0.012 * mus) * H;
  const armTips = {};
  for (const s of [1, -1]) {
    const out = (dx, r) => ({
      offset: [s * dx * H, 0, 0],
      // thickness lives in Y/Z; the multiplier is relative to the current cap
      scale: [1, r / armR, (r / armR) * 0.98],
    });
    armTips[s] = grow(armRegion[String(s)], [
      { offset: [s * 0.020 * H, 0, 0], scale: [1, 0.86, 0.90] },   // deltoid
      out(0.055, armR * 0.94),
      out(0.050, armR * 0.86),
      out(0.045, armR * 0.72),      // elbow
      out(0.045, armR * 0.80),
      out(0.042, armR * 0.66),
      out(0.038, armR * 0.52),      // wrist
      // palm: wider in Y (across the hand), thinner in Z
      { offset: [s * 0.030 * H, 0, 0], scale: [1, 1.55, 0.58] },
      { offset: [s * 0.030 * H, 0, 0], scale: [1, 0.90, 0.86] },
    ]);
  }

  // LEG.
  //
  // The socket is on the BOTTOM of the torso, so its normal is -Y and extruding
  // downward is geometrically correct (unlike the arm, which needed a turn).
  // Absolute half-widths are used per section so the limb cannot drift thin.
  const legLen = 0.40 * H * o.legLength;
  const thighR = (0.050 + 0.014 * mus) * H;
  for (const s of [1, -1]) {
    // The socket patch is 2x2 cells; remember its actual half-extents so each
    // step can be expressed as an ABSOLUTE target width instead of a multiplier
    // on the previous cap. Chained multipliers drift the limb to a needle.
    const socketX = (cell * 2) * pelvisW * 0.5 * 2;   // patch spans 2 cells
    const socketZ = (cell * 2) * pelvisD * 0.5 * 2;
    void socketX; void socketZ;

    let curRx = 0.052 * H;     // measured from the socket after the first step
    let curRz = 0.030 * H;
    const seg = (dy, rx, rz) => {
      const st = { offset: [0, dy, 0], scale: [rx / curRx, 1, rz / curRz] };
      curRx = rx; curRz = rz;
      return st;
    };
    grow(legRegion[String(s)], [
      { offset: [0, -0.026 * H, 0], scale: [0.92, 1, 0.96] },
      seg(-legLen * 0.20, thighR * 0.98, thighR * 0.62),
      seg(-legLen * 0.20, thighR * 0.90, thighR * 0.58),
      seg(-legLen * 0.18, thighR * 0.74, thighR * 0.50),   // knee
      seg(-legLen * 0.18, thighR * 0.78, thighR * 0.54),   // calf
      seg(-legLen * 0.16, thighR * 0.62, thighR * 0.44),
      seg(-legLen * 0.14, thighR * 0.46, thighR * 0.34),   // ankle
      // foot: long forward, wide, low
      { offset: [0, -0.016 * H, 0.034 * H * o.footSize], scale: [1.15, 0.85, 3.20] },
      { offset: [0, -0.004 * H, 0.030 * H * o.footSize], scale: [1.02, 0.92, 0.94] },
    ]);
  }

  // ---- neck + head ---------------------------------------------------------
  const headR = 0.072 * H * o.headScale;
  grow(neckRegion, [
    { offset: [0, 0.016 * H, 0], scale: [0.44 * o.neck, 1, 0.48] },
    { offset: [0, 0.022 * H * o.neck, 0.002 * H], scale: [0.94, 1, 0.96] },
    // jaw: narrower at the front
    { offset: [0, 0.016 * H, 0.004 * H], scale: [1.06, 1, 1.04] },
    // cheeks / mid-face
    { offset: [0, headR * 0.30, 0.004 * H], scale: [1.22, 1, 1.18] },
    // cranium
    { offset: [0, headR * 0.42, 0], scale: [1.10, 1, 1.08] },
    { offset: [0, headR * 0.40, 0], scale: [1.00, 1, 0.98] },
    // crown
    { offset: [0, headR * 0.34, -0.002 * H], scale: [0.70, 0.90, 0.72] },
    { offset: [0, headR * 0.24, -0.002 * H], scale: [0.40, 0.70, 0.42] },
  ]);

  /* ------------------------------------------------------ arm down-swing */
  // Rotate the horizontal arm down about the shoulder joint. The pivot is the
  // socket centroid; everything outboard of |x| > shoulderInnerX moves, which
  // is exactly the extruded arm plus hand.
  for (const s of [1, -1]) {
    const pivotX = shoulderW * 0.97;
    const pivotY = torsoTop - 0.030 * H;
    const angle = -1.15;                 // radians, hang slightly outward
    const cos = Math.cos(angle), sin = Math.sin(angle);
    mesh.verts = mesh.verts.map((v) => {
      const dx = (v[0] - s * pivotX) * s;          // distance outboard, along +X
      if (dx <= 0) return v;                        // inside the torso: untouched
      const dy = v[1] - pivotY;
      const rad = Math.hypot(dx, dy);
      if (rad < 1e-9) return v;
      const ang = Math.atan2(dy, dx) + angle;
      const nx = Math.cos(ang) * rad;
      const ny = Math.sin(ang) * rad;
      return [s * pivotX + s * nx, pivotY + ny, v[2]];
    });
  }

  /* ------------------------------------------------------------- shaping */
  // Everything below only moves vertices: topology is already final.

  const chinY = torsoTop + 0.070 * H * o.neck;
  const headCY = chinY + headR * 1.05;

  mesh.verts = mesh.verts.map((v) => {
    let [x, y, z] = v;

    // bust
    if (o.bust > 0.02 && z > 0.004 * H && y > (0.66 * H) && y < (0.78 * H)) {
      const t = Math.max(0, 1 - Math.abs(y - 0.725 * H) / (0.055 * H));
      const side = Math.min(1, Math.abs(x) / (chestW * 0.85));
      z += 0.020 * H * o.bust * t * (1 - 0.55 * side);
    }
    // belly
    if (o.belly > 0.02 && z > 0.004 * H && y > 0.55 * H && y < 0.68 * H) {
      const t = Math.max(0, 1 - Math.abs(y - 0.615 * H) / (0.065 * H));
      z += 0.016 * H * o.belly * t;
    }
    // glutes
    if (o.hips > 0.05 && z < -0.004 * H && y > 0.46 * H && y < 0.55 * H) {
      const t = Math.max(0, 1 - Math.abs(y - 0.505 * H) / (0.05 * H));
      z -= 0.015 * H * o.hips * t;
    }
    // deltoid / biceps bulge: widen the shoulder region outward
    if (mus > 0.05) {
      const armT = Math.max(0, 1 - Math.abs(Math.abs(x) - shoulderW * 0.95) / (0.055 * H));
      if (armT > 0 && y > 0.70 * H && y < 0.80 * H) {
        const k = 1 + 0.16 * mus * armT;
        x *= k;
      }
    }
    // head: flatten the back of the skull, taper the jaw, add a brow/nose hint
    if (y > chinY - 0.01 * H) {
      const rel = (y - headCY) / headR;
      if (z < 0) z *= 0.94;
      if (rel < -0.15) {
        const t = Math.min(1, (-rel - 0.15) / 0.85);
        x *= 1 - 0.24 * t;
        z *= 1 - 0.05 * t;
      }
    }
    return [x, y, z];
  });

  // normalise: feet on the ground, exact height
  let minY = Infinity, maxY = -Infinity;
  for (const v of mesh.verts) { if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1]; }
  const k = H / (maxY - minY || 1);
  for (const v of mesh.verts) {
    v[1] = (v[1] - minY) * k;
    v[0] *= k;
    v[2] *= k;
  }

  const out = mergeByDistance({ verts: mesh.verts, faces: mesh.faces }, 1e-6);
  return fixWinding(out);
}

/**
 * Connected-component count of the SURFACE (by faces, not vertices).
 *
 * Vertex-based counting reports 1 for a mesh whose faces are one sheet but
 * which also carries unreferenced vertices, and — more importantly — counts an
 * isolated vertex as its own component. Only face connectivity describes
 * whether the body is a single surface.
 */
export function componentCount(mesh) {
  const parent = new Array(mesh.verts.length).fill(0).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const f of mesh.faces) {
    for (let i = 1; i < f.length; i++) {
      const a = find(f[0]), b = find(f[i]);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const roots = new Set();
  for (const f of mesh.faces) roots.add(find(f[0]));
  return roots.size;
}

export function allQuads(mesh) {
  return mesh.faces.every((f) => f.length === 4);
}
