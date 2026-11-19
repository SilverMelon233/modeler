/**
 * PRIMITIVES — quad-dominant meshes, centered at origin, Y up.
 * Deliberately low-poly: subdivision + sculpting refine them.
 */
import { ShapeUtils, Vector2 } from 'three';
import { mergeByDistance, cross, sub, norm, dot, len, mul, fixWinding } from './mesh.js';

function grid(nu, nv, fn) {
  const verts = [];
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) verts.push(fn(i / nu, j / nv));
  const faces = [];
  const at = (i, j) => j * (nu + 1) + i;
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++)
      faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
  return { verts, faces };
}

/** Cube, n x n quads per side, welded. */
export function cube(size = 1, n = 2) {
  const h = size / 2;
  const acc = { verts: [], faces: [] };
  const plate = grid(n, n, (u, v) => [u, v]);
  const addPlate = (fn) => {
    const off = acc.verts.length;
    for (const v of plate.verts) acc.verts.push(fn(v[0], v[1]));
    for (const f of plate.faces) acc.faces.push(f.map((i) => i + off));
  };
  addPlate((u, v) => [-h + u * size, -h + v * size, h]);
  addPlate((u, v) => [h - u * size, -h + v * size, -h]);
  addPlate((u, v) => [h, -h + v * size, h - u * size]);
  addPlate((u, v) => [-h, -h + v * size, -h + u * size]);
  addPlate((u, v) => [-h + u * size, h, h - v * size]);
  addPlate((u, v) => [-h + u * size, -h, -h + v * size]);
  return fixWinding(mergeByDistance(acc, 1e-6));
}

/** UV sphere, quads with triangles at the poles. */
export function sphere(radius = 1, seg = 16, rings = 12) {
  const verts = [];
  const faces = [];
  const at = (i, j) => j * (seg + 1) + i;
  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      verts.push([
        radius * Math.sin(phi) * Math.cos(th),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(th),
      ]);
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++)
      faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
  return fixWinding(mergeByDistance({ verts, faces }, 1e-6));
}

export function cylinder(radius = 0.5, height = 1, seg = 16, rings = 1) {
  const verts = [];
  const faces = [];
  const at = (i, j) => j * seg + i;
  for (let j = 0; j <= rings; j++) {
    const y = -height / 2 + (j / rings) * height;
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      verts.push([radius * Math.cos(th), y, radius * Math.sin(th)]);
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      faces.push([at(i, j), at(i2, j), at(i2, j + 1), at(i, j + 1)]);
    }
  for (const j of [0, rings]) {
    const ci = verts.length;
    verts.push([0, j === 0 ? -height / 2 : height / 2, 0]);
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      faces.push(j === 0 ? [ci, at(i2, 0), at(i, 0)] : [ci, at(i, rings), at(i2, rings)]);
    }
  }
  return fixWinding({ verts, faces });
}

export function cone(radius = 0.5, height = 1, seg = 16) {
  const verts = [[0, height / 2, 0], [0, -height / 2, 0]];
  const faces = [];
  for (let i = 0; i < seg; i++) {
    const th = (i / seg) * Math.PI * 2;
    verts.push([radius * Math.cos(th), -height / 2, radius * Math.sin(th)]);
  }
  for (let i = 0; i < seg; i++) {
    const a = 2 + i, b = 2 + ((i + 1) % seg);
    faces.push([a, b, 0]);
    faces.push([1, b, a]);
  }
  return fixWinding({ verts, faces });
}

export function torus(radius = 0.7, tube = 0.22, seg = 20, tubeSeg = 10) {
  const verts = [];
  const faces = [];
  const at = (i, j) => j * seg + i;
  for (let j = 0; j < tubeSeg; j++) {
    const v = (j / tubeSeg) * Math.PI * 2;
    for (let i = 0; i < seg; i++) {
      const u = (i / seg) * Math.PI * 2;
      verts.push([
        (radius + tube * Math.cos(v)) * Math.cos(u),
        tube * Math.sin(v),
        (radius + tube * Math.cos(v)) * Math.sin(u),
      ]);
    }
  }
  for (let j = 0; j < tubeSeg; j++)
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg, j2 = (j + 1) % tubeSeg;
      faces.push([at(i, j), at(i2, j), at(i2, j2), at(i, j2)]);
    }
  return fixWinding({ verts, faces });
}

export function plane(size = 2, n = 4) {
  const h = size / 2;
  return grid(n, n, (u, v) => [-h + u * size, 0, -h + v * size]);
}

/** Capsule via lat/long profile sampling (smooth, quad body). */
export function capsule(radius = 0.2, length = 0.8, seg = 14, rows = 14) {
  const half = Math.max(0, length / 2);
  const prof = [];
  const top = Math.max(2, Math.round(rows / 2));
  const H = rows;
  for (let k = 0; k <= H; k++) {
    const t = k / H;
    let y, r;
    if (t <= 0.5) {
      // top hemisphere: phi 0 (pole) -> pi/2 (equator)
      const phi = t * Math.PI;
      y = half + radius * Math.cos(phi);
      r = radius * Math.sin(phi);
    } else {
      // bottom hemisphere: psi 0 (equator) -> pi/2 (pole)
      const psi = (t - 0.5) * Math.PI;
      y = -half - radius * Math.sin(psi);
      r = radius * Math.cos(psi);
    }
    prof.push({ y, r });
  }
  const verts = [];
  const faces = [];
  for (let k = 0; k <= H; k++)
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      verts.push([prof[k].r * Math.cos(th), prof[k].y, prof[k].r * Math.sin(th)]);
    }
  for (let k = 0; k < H; k++)
    for (let i = 0; i < seg; i++) {
      const a = k * (seg + 1) + i;
      faces.push([a, a + 1, a + seg + 2, a + seg + 1]);
    }
  return fixWinding(mergeByDistance({ verts, faces }, 1e-5));
}

/** Sweep a circular cross-section along a polyline with per-point radii. */
export function tubeAlong(points, radii, radial = 10, cap = true) {
  const n = points.length;
  const tangents = points.map((_, i) =>
    norm(sub(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)]))
  );
  let ref = Math.abs(tangents[0][1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  let nrm = norm(cross(tangents[0], ref));
  const verts = [];
  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    nrm = norm(sub(nrm, mul(t, dot(nrm, t))));
    if (len(nrm) < 1e-6) nrm = norm(cross(t, [0, 1, 0]));
    const bin = norm(cross(t, nrm));
    const r = Array.isArray(radii) ? radii[i] : radii;
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      verts.push([
        points[i][0] + (nrm[0] * c + bin[0] * s) * r,
        points[i][1] + (nrm[1] * c + bin[1] * s) * r,
        points[i][2] + (nrm[2] * c + bin[2] * s) * r,
      ]);
    }
  }
  const faces = [];
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      faces.push([a, a + 1, a + radial + 2, a + radial + 1]);
    }
  if (cap) {
    // fan caps at both ends, duplicating the ring so ends stay flat
    for (const [idx, flip] of [[0, true], [n - 1, false]]) {
      const base = verts.length;
      const p = points[idx];
      verts.push([p[0], p[1], p[2]]);
      const ringStart = idx * (radial + 1);
      for (let j = 0; j < radial; j++) {
        const a = ringStart + j, b = ringStart + ((j + 1) % radial);
        faces.push(flip ? [base, b, a] : [base, a, b]);
      }
    }
  }
  return fixWinding(mergeByDistance({ verts, faces }, 1e-6));
}

/** Bezier sample helper for limb curves. */
export function bezier(p0, p1, p2, p3, t) {
  const it = 1 - t;
  return [
    it * it * it * p0[0] + 3 * it * it * t * p1[0] + 3 * it * t * t * p2[0] + t * t * t * p3[0],
    it * it * it * p0[1] + 3 * it * it * t * p1[1] + 3 * it * t * t * p2[1] + t * t * t * p3[1],
    it * it * it * p0[2] + 3 * it * it * t * p1[2] + 3 * it * t * t * p2[2] + t * t * t * p3[2],
  ];
}

/**
 * Extrude 2D polygons (outer ring + optional holes) along Z into a watertight
 * solid. Self-contained ear-clipping so the core stays dependency free.
 */
export function extrudePolygons(polygons, depth = 0.2) {
  const h = depth / 2;
  const verts = [];
  const faces = [];
  for (const poly of polygons) {
    const outer = sanitiseRing(poly.outer);
    const holes = (poly.holes || []).map(sanitiseRing).filter((r) => r.length >= 3);
    if (outer.length < 3) continue;
    const frontBase = verts.length;
    for (const [x, y] of outer) verts.push([x, y, h]);
    const holeBases = [];
    for (const hole of holes) {
      holeBases.push(verts.length);
      for (const [x, y] of hole) verts.push([x, y, h]);
    }
    const backBase = verts.length;
    for (const [x, y] of outer) verts.push([x, y, -h]);
    const holeBacks = [];
    for (const hole of holes) {
      holeBacks.push(verts.length);
      for (const [x, y] of hole) verts.push([x, y, -h]);
    }
    // side walls
    const wall = (ringLen, aBase, bBase) => {
      for (let i = 0; i < ringLen; i++) {
        const j = (i + 1) % ringLen;
        faces.push([aBase + i, bBase + i, bBase + j, aBase + j]);
      }
    };
    wall(outer.length, frontBase, backBase);
    // hole walls must wind the opposite way so their normals point into the hole
    const wallRev = (ringLen, aBase, bBase) => {
      for (let i = 0; i < ringLen; i++) {
        const j = (i + 1) % ringLen;
        faces.push([aBase + i, aBase + j, bBase + j, bBase + i]);
      }
    };
    holes.forEach((hole, k) => wallRev(hole.length, holeBases[k], holeBacks[k]));

    // caps: local 2D triangulation, then map to front/back index ranges
    const localPts = [...outer, ...holes.flat()];
    const tris = earcut(localPts, [outer.length, ...holes.map((x) => x.length)]);
    // NOTE: multi-hole mapping needs per-hole offsets
    const buildMaps = (baseRing, holeBaseList) => {
      const map = new Array(localPts.length);
      for (let k = 0; k < outer.length; k++) map[k] = baseRing + k;
      let off = outer.length;
      holes.forEach((hole, hi) => {
        for (let k = 0; k < hole.length; k++) map[off + k] = holeBaseList[hi] + k;
        off += hole.length;
      });
      return map;
    };
    const fMap = buildMaps(frontBase, holeBases);
    const bMap = buildMaps(backBase, holeBacks);
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2];
      faces.push([fMap[a], fMap[b], fMap[c]]);
      faces.push([bMap[a], bMap[c], bMap[b]]);
    }
  }
  return fixWinding(mergeByDistance({ verts, faces }, 1e-6));
}

function sanitiseRing(ring) {
  const out = [];
  for (const p of ring) {
    if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 1e-9) out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) out.pop();
  }
  return out;
}

/**
 * Minimal ear-clipping triangulation of a simple polygon with holes
 * (holes are bridged into the outer contour). Good enough for text glyphs
 * and user-drawn profiles.
 */
export function earcut(points, holeLengths) {
  const outerLen = holeLengths[0];
  const rings = [];
  let off = 0;
  for (const len of holeLengths) {
    rings.push(points.slice(off, off + len).map(([x, y]) => new Vector2(x, y)));
    off += len;
  }
  // three's ShapeUtils does robust ear cutting with hole bridging.
  try {
    const tris = ShapeUtils.triangulateShape(rings[0], rings.slice(1));
    const out = [];
    for (const t of tris) out.push(t[0], t[1], t[2]);
    return out;
  } catch (e) {
    return [];
  }
}

/**
 * Loft a stack of superellipse rings into a quad tube.
 * sections: [{ c:[x,y,z], rx, rz, e?:power, rot?:radians }] — all rings share `radial`.
 */
export function loft(sections, radial = 12, capStart = true, capEnd = true) {
  const verts = [];
  const faces = [];
  sections.forEach((s, si) => {
    const e = s.e ?? 2;
    const rot = s.rot || 0;
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2 + rot;
      const c = Math.cos(th), sn = Math.sin(th);
      // superellipse: |x|^e + |z|^e = 1
      const k = 1 / (Math.abs(c) ** e + Math.abs(sn) ** e) ** (1 / e);
      verts.push([
        s.c[0] + c * k * s.rx,
        s.c[1],
        s.c[2] + sn * k * s.rz,
      ]);
    }
  });
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      faces.push([a, b, b + radial, a + radial]);
    }
  const cap = (si, flip) => {
    const c = sections[si].c;
    const ci = verts.length;
    verts.push([c[0], c[1], c[2]]);
    for (let j = 0; j < radial; j++) {
      const a = si * radial + j;
      const b = si * radial + ((j + 1) % radial);
      const tri = flip ? [ci, b, a] : [ci, a, b];
      faces.push(tri);
    }
  };
  if (capStart) cap(0, true);
  if (capEnd) cap(sections.length - 1, false);
  const out = { verts, faces };
  return capStart && capEnd ? fixWinding(out) : out;
}

/** Rounded box from a plane sampled on a spherified cube (all quads). */
export function roundedBox(size = 1, radius = 0.15, n = 6) {
  const h = size / 2 - radius;
  const m = sphere(1, n * 2, n); // reuse topology
  const verts = m.verts.map((v) => {
    const s = [Math.sign(v[0]) || 0, Math.sign(v[1]) || 0, Math.sign(v[2]) || 0];
    return [
      v[0] * radius + s[0] * h,
      v[1] * radius + s[1] * h,
      v[2] * radius + s[2] * h,
    ];
  });
  return mergeByDistance({ verts, faces: m.faces }, 1e-5);
}
