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
  faceCenter, faceNormal, mergeByDistance, fixWinding, signedVolume,
  subdivideSelected, catmullClark,
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

  // Two ways to size the new cap:
  //   scale: [sx, sy, sz]  — multiplier on the current cap (drifts when chained)
  //   size:  [hx, hy, hz]  — ABSOLUTE half-extents about the pivot
  // The absolute form is what limbs use: a chain of multipliers compounds and
  // collapses the limb to a needle, which is exactly what happened before.
  let sc;
  if (opts.size) {
    // Per-axis half-extent of the current cap about the pivot. A cap that lies
    // in a plane has ZERO extent on its normal axis; for that axis the scale is
    // taken from `size` relative to the cap's other axes' mean, which keeps the
    // cross-section a sensible rectangle instead of a zero-thickness sheet.
    const cur = [0, 0, 0];
    for (const i of uniq) {
      cur[0] = Math.max(cur[0], Math.abs(mesh.verts[i][0] - pivot[0]));
      cur[1] = Math.max(cur[1], Math.abs(mesh.verts[i][1] - pivot[1]));
      cur[2] = Math.max(cur[2], Math.abs(mesh.verts[i][2] - pivot[2]));
    }
    const mean = (cur[0] + cur[1] + cur[2]) / 3 || 1e-6;
    sc = opts.size.map((h, k) => ((cur[k] > 1e-9 ? cur[k] : mean) > 0 ? h / (cur[k] > 1e-9 ? cur[k] : mean) : 1));
  } else {
    sc = opts.scale ?? 1;
  }
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
  const pelvisD = (0.062 + 0.022 * o.hips) * H;
  const waistW = (0.064 + 0.028 * o.belly) * H;
  const waistD = (0.052 + 0.028 * o.belly) * H;
  const chestW = (0.086 + 0.020 * bld + 0.008 * mus) * H;
  const chestD = (0.064 + 0.024 * bld) * H;
  const shoulderW = (0.100 + 0.018 * o.shoulder + 0.010 * bld) * H;

  // ---- base torso: a subdivided box, so every side is a clean quad grid ----
  // N=7 gives a 7x7 quad grid per box face: enough columns to carve separate
  // fingers and enough rows for a believable shoulder/hip transition.
  const N = 7;
  let mesh = cube(1, N);

  // Sockets are picked on the *unscaled* box using its known face-centre grid:
  // side faces sit at |axis| = 0.5, and the other two coordinates are
  // -0.5 + (i + 0.5) / N. Picking by exact grid cell avoids tolerance guessing.
  const cell = 1 / N;
  const at = (v, cells) => cells.some((c) => Math.abs(v - (-0.5 + (c + 0.5) * cell)) < cell * 0.25);
  // rows counted from the bottom (-0.5) upward
  // N=7 columns are at -0.4286 .. +0.4286 in steps of 1/7.
  // The arm socket spans 5 of them so the hand has enough columns to split into
  // fingers later; the two outermost columns stay as the shoulder cap.
  const ARM_ROWS = [4];                 // just below the shoulder line
  const ARM_COLS = [1, 2, 3, 4, 5];
  // A leg socket must not cross the body's midline: cells are indexed from the
  // -X side, so a positive-side leg uses the cells at +0.2 and +0.4 (indices 3,4),
  // never index 2 (which is centred on x=0 and would weld both legs together).
  // Column indices are offset by half a cell: cell i sits at -0.5+(i+0.5)/N,
  // so N=5 gives x = -0.4,-0.2,0,+0.2,+0.4 for i = 0..4. A leg must never
  // include the centre column (i=2), or both legs weld along the midline.
  const LEG_COLS_POS = [4, 5];        // x = +0.143, +0.286
  const LEG_COLS_NEG = [1, 2];        // x = -0.286, -0.143

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
    Math.abs(c[1] - 0.5) < 1e-6 && at(c[0], [2, 3, 4]) && at(c[2], [2, 3, 4]));

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

  /**
   * @param regionPts Set of vertex position keys (resolved on first use)
   *   — or an array of face indices, already resolved by the caller
   */
  const grow = (regionPts, steps) => {
    const presolved = Array.isArray(regionPts) ? regionPts : null;
    let caps = null;
    for (const st of steps) {
      const targets = caps ?? presolved ?? resolve(regionPts);
      if (!targets || !targets.length) throw new Error('grow: socket did not resolve to any face');
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
  //
  // Every section is sized with `size` (absolute half-extents) rather than a
  // chained `scale`, because chained multipliers compound and collapse the limb.
  const armLen = 0.44 * H * o.armLength;
  const upperR = (0.026 + 0.010 * mus) * H;
  const foreR = (0.020 + 0.007 * mus) * H;
  const wristR = 0.015 * H;
  const hs = o.handSize;
  const palmHalfY = 0.040 * H * hs;      // across the hand (before the down-swing)
  const palmHalfZ = 0.016 * H * hs;      // thickness

  const armFingerCaps = {};
  for (const s of [1, -1]) {
    const cap = (dx, hy, hz = hy) => ({
      offset: [s * dx * H, 0, 0],
      size: [hy * 0.5, hy, hz],
    });
    const steps = [
      cap(0.016, upperR * 1.35),                 // deltoid
      cap(armLen * 0.10, upperR),
      cap(armLen * 0.10, upperR * 0.92),
      cap(armLen * 0.09, upperR * 0.78),         // elbow
      cap(armLen * 0.09, foreR * 1.12),
      cap(armLen * 0.09, foreR * 0.94),
      cap(armLen * 0.08, wristR),                // wrist
      // palm: wide across Y, thin in Z
      { offset: [s * 0.030 * H * hs, 0, 0], size: [0.004 * H, palmHalfY, palmHalfZ] },
      { offset: [s * 0.034 * H * hs, 0, 0], size: [0.004 * H, palmHalfY * 0.94, palmHalfZ * 0.92] },
    ];
    armFingerCaps[s] = grow(armRegion[String(s)], steps);
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
      // FOOT.
      //
      // A real foot is roughly 0.15H long with the ankle sitting about a third
      // of the way back from the heel, so the extrusion has to move BACKWARD as
      // well as forward. Driving it only forward gave a 0.18 m stub with no heel.
      { offset: [0, -0.014 * H, 0.010 * H * o.footSize], size: [0.030 * H, 0.022 * H, 0.048 * H * o.footSize] },
      { offset: [0, -0.004 * H, 0.016 * H * o.footSize], size: [0.032 * H, 0.014 * H, 0.072 * H * o.footSize] },
    ]);
  }

  /* ------------------------------------------------------------------ toes */
  // Same trick as the fingers: the foot's front cap is a small grid, so its
  // columns can each be extruded into a toe.
  //
  // The cap is found by restricting to the FOOT SLAB (below ankle height) and
  // taking the forwardmost faces there. An earlier version scanned the whole
  // leg below 0.08H, so `frontZ` was set by the shin and the selected faces were
  // the inside of the ankle instead of the front of the foot.
  for (const s of [1, -1]) {
    // The foot's front cap is simply the set of forward-facing faces in the
    // foot slab whose centre is within a toe-length of the furthest point.
    // Deriving "furthest point" from the whole slab picked the instep, which is
    // higher than the toes, so the cap set came out empty.
    let frontZ = -Infinity;
    for (const f of mesh.faces) {
      const c = faceCenter(mesh.verts, f);
      if (c[0] * s < 0.015 * H) continue;
      if (c[1] > 0.055 * H) continue;
      if (c[2] > frontZ) frontZ = c[2];
    }
    if (!isFinite(frontZ)) continue;

    const capFaces = [];
    mesh.faces.forEach((f, fi) => {
      const c = faceCenter(mesh.verts, f);
      if (c[0] * s < 0.015 * H || c[1] > 0.055 * H) return;
      if (c[2] < frontZ - 0.012 * H) return;
      capFaces.push(fi);
    });
    if (globalThis.__QF_TOE_DEBUG) console.log(`[toe s=${s}] frontZ=${frontZ.toFixed(3)} caps=${capFaces.length}`);

    const cols = new Map();
    for (const fi of capFaces) {
      const c = faceCenter(mesh.verts, mesh.faces[fi]);
      const k = Math.round(c[0] / (0.010 * H));
      if (!cols.has(k)) cols.set(k, []);
      cols.get(k).push(fi);
    }
    const keys = [...cols.keys()].sort((a, b) => a - b);
    keys.forEach((k, idx) => {
      const group = cols.get(k);
      const colPts = new Set();
      for (const fi of group) for (const i of mesh.faces[fi]) colPts.add(keyOf(mesh.verts[i]));
      const inboard = idx === 0 || idx === keys.length - 1;
      const len = (inboard ? 0.012 : 0.008) * H * o.footSize;
      grow(colPts, [
        { offset: [0, 0, len], scale: [0.96, 0.94, 1] },
        { offset: [0, 0, len * 0.7], scale: [0.88, 0.86, 1] },
      ]);
    });
  }

  // ---- neck + head ---------------------------------------------------------
  // HEAD.
  //
  // Sizes are absolute half-extents so the skull cannot drift. The head is a
  // 3x3 patch on the neck socket, so each extrusion step quadruples the grid it
  // inherits — by the cranium there is enough resolution to carve facial
  // features into the vertices rather than bolting separate shells on.
  const headR = 0.074 * H * o.headScale;
  const headBaseY = torsoTop + 0.030 * H * o.neck;
  grow(neckRegion, [
    { offset: [0, 0.014 * H, 0], size: [0.026 * H * o.neck, 0.008 * H, 0.028 * H * o.neck] },
    // jaw: narrower at the front than the skull
    { offset: [0, 0.020 * H * o.neck, 0.003 * H], size: [headR * 0.62, 0.020 * H, headR * 0.70] },
    { offset: [0, headR * 0.28, 0.004 * H], size: [headR * 0.80, headR * 0.30, headR * 0.86] },  // mid-face
    { offset: [0, headR * 0.34, 0], size: [headR * 0.86, headR * 0.34, headR * 0.88] },          // cranium
    { offset: [0, headR * 0.42, -0.002 * H], size: [headR * 0.78, headR * 0.30, headR * 0.80] }, // upper skull
    { offset: [0, headR * 0.46, -0.004 * H], size: [headR * 0.50, headR * 0.22, headR * 0.54] }, // crown
    { offset: [0, headR * 0.30, -0.004 * H], size: [headR * 0.22, headR * 0.14, headR * 0.24] }, // top
  ]);
  void headBaseY;

  /* ------------------------------------------------------ refine the head */
  // The head starts as a 3x3 patch and only reaches ~6 height bands by the
  // crown, which is coarser than the eye/brow/nose/mouth bands are apart — the
  // facial tuning below would have nowhere to live.
  //
  // `subdivideSelected` was the obvious tool and it is the wrong one here: it
  // splits only quads and leaves T-junctions along the boundary of the
  // selection, so the mesh stopped being watertight the moment the head was
  // refined. Catmull-Clark on the whole surface is uniform (no T-junctions) and
  // costs a single pass, so the body is subdivided once and the features are
  // then carved into the finer grid.
  {
    const sub = catmullClark(mesh);
    mesh = { verts: sub.verts, faces: sub.faces };
  }

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

  /* ------------------------------------------------------ shoulder blending */
  // The down-swing rotates the arm rigidly, which leaves a hard crease where the
  // deltoid meets the torso (the rotation line is visible as a diagonal edge).
  // A short smoothstep blend across the joint, pulling vertices toward a sphere
  // fitted to the shoulder, rounds that transition without moving the arm.
  {
    const R = (0.040 + 0.008 * mus) * H;      // shoulder cap radius
    for (const s of [1, -1]) {
      const sx = s * shoulderW * 0.94;
      const sy = torsoTop - 0.012 * H;
      // Keep the band tight: a wide band reaches into the upper arm and the
      // sphere target, which is smaller than the arm, flattens it.
      const band = R * 0.85;
      mesh.verts = mesh.verts.map((v) => {
        const dx = v[0] - sx, dy = v[1] - sy;
        const d = Math.hypot(dx, dy, v[2] * 0.7);
        if (d > band) return v;
        // 1 at the joint centre, 0 at the band edge
        const k = 1 - Math.min(1, d / band);
        const w = k * k * (3 - 2 * k);
        // sphere target at the same direction, radius R
        if (d < 1e-6) return v;
        const tx = sx + (dx / d) * R;
        const ty = sy + (dy / d) * R;
        const tz = (v[2] / d) * R;
        const mix = w * 0.30;
        return [
          v[0] + (tx - v[0]) * mix,
          v[1] + (ty - v[1]) * mix,
          v[2] + (tz - v[2]) * mix,
        ];
      });
    }
  }

  /* --------------------------------------------------------------- fingers */
  // Fingers are grown AFTER the arm hangs down, so "outward along the arm" is
  // -Y in world space.
  //
  // The palm cap is found by slicing, not by a bottom-Y threshold: for each
  // side, take every face whose normal points mostly down and whose centre is
  // among the lowest 4% of that side's geometry. Thresholding on an absolute
  // offset from the lowest vertex kept only 5 of the 1x5 cap faces, and failed
  // entirely on the other side, because the two hands do not sit at identical
  // heights once the down-swing is applied.
  for (const s of [1, -1]) {
    const sideFaces = [];
    let lowY = Infinity;
    for (const f of mesh.faces) {
      const c = faceCenter(mesh.verts, f);
      if (c[0] * s < 0.12 * H) continue;
      sideFaces.push(f);
      if (c[1] < lowY) lowY = c[1];
    }
    if (!sideFaces.length) continue;

    const band = 0.05 * H;
    const capFaces = [];
    mesh.faces.forEach((f, fi) => {
      const c = faceCenter(mesh.verts, f);
      if (c[0] * s < 0.12 * H) return;
      if (c[1] > lowY + band) return;
      const n = faceNormal(mesh.verts, f);
      if (n[1] > -0.5) return;                       // must face down
      capFaces.push(fi);
    });

    // group into columns by Z (across the hand)
    const cols = new Map();
    for (const fi of capFaces) {
      const c = faceCenter(mesh.verts, mesh.faces[fi]);
      // 5 columns across a palm of half-width 0.040*H -> each column centre is
      // ~0.016*H apart, so quantise at half that to keep them distinct.
      const k = Math.round(c[2] / (0.007 * H));
      if (!cols.has(k)) cols.set(k, []);
      cols.get(k).push(fi);
    }
    const keys = [...cols.keys()].sort((a, b) => a - b);

    keys.forEach((k, idx) => {
      const group = cols.get(k);
      if (!group.length) return;
      const colPts = new Set();
      for (const fi of group) for (const i of mesh.faces[fi]) colPts.add(keyOf(mesh.verts[i]));

      const isThumb = idx === 0 || idx === keys.length - 1;
      const len = (isThumb ? 0.024 : 0.030 + 0.003 * (idx % 3)) * H * o.handSize;
      const dirZ = isThumb ? (idx === 0 ? -1 : 1) : 0;
      const drift = isThumb ? 0.55 : 0.05;
      grow(colPts, [
        { offset: [dirZ * drift * len * 0.45, -len * 0.55, dirZ * drift * len * 0.55], scale: [1, 1, 0.94] },
        { offset: [dirZ * drift * len * 0.25, -len * 0.45, dirZ * drift * len * 0.30], scale: [0.84, 0.88, 0.80] },
      ]);
    });
  }

  /* ------------------------------------------------------------- shaping */
  // Everything below only moves vertices: topology is already final.

  // Measure the head from the geometry instead of predicting it from the
  // extrusion steps. Absolute landmark heights (0.885*H for eyes etc.) were
  // silently wrong once the neck length changed: the mouth landed BELOW the
  // jaw, so the whole feature block did nothing. Anchoring the bands to the
  // measured head box keeps them on the face for every parameter combination.
  // Measure the head from geometry, but do NOT let the shoulders in: filtering
  // on `y > torsoTop + 0.02H` includes the deltoids, and using their width to
  // normalise `u` squeezed every facial feature toward the midline so they
  // vanished.
  //
  // A fixed offset below the crown does not work either: at 1.58 m tall,
  // `crown - 0.20H` still reaches the chest, and the resulting head box was
  // nearly twice the real head height — every landmark landed on the wrong part
  // of the face.
  //
  // The neck is the narrowest horizontal section below the head, and that is a
  // fact about the silhouette rather than a tuning constant, so the head is
  // found by scanning for it.
  const crownY = Math.max(...mesh.verts.map((v) => v[1]));
  const halfWidthAt = (y) => {
    let w = 0;
    for (const v of mesh.verts) {
      if (Math.abs(v[1] - y) < 0.006) w = Math.max(w, Math.abs(v[0]));
    }
    return w;
  };
  let neckY = crownY - 0.30 * H;
  let neckW = Infinity;
  for (let y = crownY - 0.04 * H; y > crownY - 0.24 * H; y -= 0.006 * H) {
    const w = halfWidthAt(y);
    if (w > 1e-6 && w < neckW) { neckW = w; neckY = y; }
  }
  const headMinY = neckY;
  const headMaxY = crownY;

  const headVerts = mesh.verts.filter((v) => v[1] > headMinY);
  let headMaxZ = 0;
  for (const v of headVerts) if (v[2] > headMaxZ) headMaxZ = v[2];
  const headHalfW = Math.max(1e-6, Math.max(...headVerts.map((p) => Math.abs(p[0]))));
  const headSpan = Math.max(1e-6, headMaxY - headMinY);
  // 0 at the jaw, 1 at the crown
  const faceT = (y) => (y - headMinY) / headSpan;
  const faceZ = headMaxZ;
  const frontThresh = faceZ * 0.30;

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
    // deltoid / biceps
    if (mus > 0.05) {
      const armT = Math.max(0, 1 - Math.abs(Math.abs(x) - shoulderW * 0.95) / (0.055 * H));
      if (armT > 0 && y > 0.70 * H && y < 0.80 * H) x *= 1 + 0.16 * mus * armT;
    }

    // ---- head ---------------------------------------------------------------
    if (y > headMinY - 0.01 * H) {
      const t = faceT(y);                  // 0 jaw .. 1 crown

      if (z < 0) z *= 0.94;                // flatter occiput
      if (t < 0.16) {                      // jaw taper
        const k = 1 - (0.16 - t) / 0.16;
        x *= 1 - 0.22 * k;
      }

      // Facial form is applied only to the forward-facing shell, using
      // smooth radial bumps so Catmull-Clark does not turn them into creases.
      if (z > frontThresh) {
        const u = x / headHalfW;
        const bump = (cu, ct, su, st, amp) =>
          amp * Math.exp(-(((u - cu) / su) ** 2)) * Math.exp(-(((t - ct) / st) ** 2));

        // Landmarks as fractions of the measured head box (0 = jaw, 1 = crown).
        // The measured box bottom sits at the jaw UNDERSIDE, so anatomical
        // landmarks sit higher than raw fractions-of-height suggest. First table
        // had eyes at 0.625, which placed them on the mouth.
        //   eyes 0.78 | brow 0.84 | nose tip 0.66 | mouth 0.47 | chin 0.35
        //
        // eye sockets (shallow), brow ridge above
        z -= bump(-0.42, 0.780, 0.20, 0.050, 0.0090 * H);
        z -= bump(0.42, 0.780, 0.20, 0.050, 0.0090 * H);
        z += bump(-0.40, 0.842, 0.24, 0.030, 0.0055 * H);
        z += bump(0.40, 0.842, 0.24, 0.030, 0.0055 * H);

        // nose ridge on the midline, with nostril flare
        z += bump(0.00, 0.670, 0.09, 0.070, 0.0140 * H);
        z += bump(-0.19, 0.625, 0.10, 0.026, 0.0045 * H);
        z += bump(0.19, 0.625, 0.10, 0.026, 0.0045 * H);

        // mouth groove with lips either side, and a chin below
        z -= bump(0.00, 0.470, 0.22, 0.020, 0.0030 * H);
        z += bump(0.00, 0.500, 0.22, 0.014, 0.0022 * H);
        z += bump(0.00, 0.440, 0.22, 0.014, 0.0022 * H);
        z += bump(0.00, 0.360, 0.22, 0.040, 0.0035 * H);

        // cheekbones
        z += bump(-0.62, 0.600, 0.18, 0.070, 0.0030 * H);
        z += bump(0.62, 0.600, 0.18, 0.070, 0.0030 * H);
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
