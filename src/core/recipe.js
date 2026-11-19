/**
 * RECIPE — the .quadforge document compiler.
 *
 * A .quadforge file is a small, semantic, diff-friendly description of a model:
 * parametric primitives + CSG ops + deformers + materials. It is NOT a mesh dump.
 * That keeps LLM-authored files at hundreds of tokens instead of hundreds of
 * thousands, and makes "arm longer" a one-number edit.
 *
 * Compilation is deterministic and side-effect free, so it can run in the
 * browser, in Node (CLI), and inside a validation loop.
 */
import * as P from './primitives.js';
import { buildCharacter, CHAR_DEFAULTS } from './character.js';
import { applyTRS } from './transform.js';
import {
  joinMeshes, mergeByDistance, subdivide, mirrorX, fixWinding,
  bounds, faceNormal, faceCenter, dot, sub, vertexNormals, mul, add,
} from './mesh.js';
import { booleanOp } from './booleans.js';

export const SCHEMA_ID = 'quadforge/1';
export const RECIPE_VERSION = 1;

export const DEFAULT_MATERIAL = {
  color: '#d9e2ec',
  metalness: 0.05,
  roughness: 0.45,
  opacity: 1,
  flat: false,
  emissive: '#000000',
};

/* ------------------------------------------------------------- primitives */

const PRIMITIVES = {
  box(i = {}) {
    return P.cube(i.size ?? 1, i.segments ?? 2);
  },
  // `cube` is a friendly alias accepted by the recipe compiler (the schema
  // only advertises `box`, but LLM authors reach for "cube" constantly).
  cube(i = {}) {
    return P.cube(i.size ?? 1, i.segments ?? 2);
  },
  sphere(i = {}) {
    return P.sphere(i.radius ?? 0.5, i.segments ?? 20, i.rings ?? 14);
  },
  cylinder(i = {}) {
    return P.cylinder(i.radius ?? 0.5, i.height ?? 1, i.segments ?? 18, i.rings ?? 1);
  },
  cone(i = {}) {
    return P.cone(i.radius ?? 0.5, i.height ?? 1, i.segments ?? 18);
  },
  torus(i = {}) {
    return P.torus(i.radius ?? 0.6, i.tube ?? 0.2, i.segments ?? 24, i.tubeSegments ?? 12);
  },
  plane(i = {}) {
    return P.plane(i.size ?? 2, i.segments ?? 4);
  },
  capsule(i = {}) {
    return P.capsule(i.radius ?? 0.25, i.length ?? 0.9, i.segments ?? 16, i.rings ?? 14);
  },
  roundedBox(i = {}) {
    return P.roundedBox(i.size ?? 1, i.radius ?? 0.15, i.segments ?? 4);
  },
  /** Stacked superellipse rings: the workhorse for organic + hard-surface bodies. */
  loft(i = {}) {
    if (!Array.isArray(i.sections) || i.sections.length < 2) {
      throw new Error('loft 需要至少 2 个 sections');
    }
    const sections = i.sections.map((s, k) => ({
      c: [s.x ?? 0, s.y ?? k * 0.1, s.z ?? 0],
      rx: s.rx ?? 0.2,
      rz: s.rz ?? (s.rx ?? 0.2),
      e: s.e ?? 2.4,
      rot: s.rot ?? 0,
    }));
    return P.loft(sections, i.radial ?? 16, i.capStart !== false, i.capEnd !== false);
  },
  /** Swept circular tube along a polyline with per-point radii. */
  tube(i = {}) {
    if (!Array.isArray(i.points) || i.points.length < 2) throw new Error('tube 需要至少 2 个 points');
    const radii = i.radii ?? i.points.map(() => i.radius ?? 0.1);
    return P.tubeAlong(i.points, radii, i.radial ?? 10);
  },
  /** Extrude 2D polygons (outer ring + holes) along Z. */
  extrude(i = {}) {
    if (!Array.isArray(i.polygons)) throw new Error('extrude 需要 polygons 数组');
    const polys = i.polygons.map((p) => ({
      outer: p.outer,
      holes: p.holes ?? [],
    }));
    return P.extrudePolygons(polys, i.depth ?? 0.2);
  },
};

export const PRIMITIVE_TYPES = Object.keys(PRIMITIVES);

export function makePrimitive(prim) {
  const fn = PRIMITIVES[prim.type];
  if (!fn) throw new Error(`未知图元类型 "${prim.type}"，可用：${PRIMITIVE_TYPES.join(', ')}`);
  return fn(prim);
}

/* ------------------------------------------------------------- deformers */

const DEFORMERS = {
  subdivide: (mesh, a = {}) => {
    const r = subdivide(mesh, a.levels ?? 1);
    return { verts: r.verts, faces: r.faces };
  },
  mirror: (mesh, a = {}) => mirrorX(mesh, a.weld !== false),
  weld: (mesh, a = {}) => mergeByDistance(mesh, a.tolerance ?? 1e-5),
  smoothShade: (mesh) => mesh, // render-time hint only
  orient: (mesh) => {
    const c = bounds(mesh).center;
    const faces = mesh.faces.map((f) => {
      const n = faceNormal(mesh.verts, f);
      const fc = faceCenter(mesh.verts, f);
      return dot(n, sub(fc, c)) < 0 ? f.slice().reverse() : f.slice();
    });
    return { verts: mesh.verts, faces };
  },
  /** Push vertices along normals with a smooth falloff sphere. */
  inflate: (mesh, a = {}) => {
    const center = a.center ?? bounds(mesh).center;
    const radius = a.radius ?? 0.5;
    const amount = a.amount ?? 0.02;
    const nrm = vertexNormals(mesh);
    const r2 = radius * radius;
    const verts = mesh.verts.map((v, i) => {
      const d2 = (v[0] - center[0]) ** 2 + (v[1] - center[1]) ** 2 + (v[2] - center[2]) ** 2;
      if (d2 > r2) return v;
      const t = 1 - Math.sqrt(d2) / radius;
      const w = t * t * (3 - 2 * t);
      return add(v, mul(nrm[i], amount * w));
    });
    return { ...mesh, verts };
  },
  /** Global non-uniform scale about a pivot. */
  scale: (mesh, a = {}) => applyTRS(mesh, { position: [0, 0, 0], scale: a.factor ?? [1, 1, 1] }),
  /** Taper along Y: scale XZ by a linear function of height. */
  taper: (mesh, a = {}) => {
    const top = a.top ?? 1;
    const bottom = a.bottom ?? 1;
    const b = bounds(mesh);
    const h = Math.max(1e-6, b.size[1]);
    const verts = mesh.verts.map((v) => {
      const t = (v[1] - b.min[1]) / h;
      const s = bottom + (top - bottom) * t;
      return [v[0] * s, v[1], v[2] * s];
    });
    return { ...mesh, verts };
  },
  bend: (mesh, a = {}) => {
    const angle = (a.angle ?? 0.5) * Math.PI;
    const axis = a.axis ?? 'y';
    const b = bounds(mesh);
    const h = Math.max(1e-6, b.size[1]);
    const r = h / Math.max(1e-6, angle);
    const verts = mesh.verts.map((v) => {
      const t = (v[1] - b.min[1]) / h;
      const th = t * angle;
      if (axis === 'x') return [v[0], b.min[1] + Math.sin(th) * r, v[2] - (1 - Math.cos(th)) * r];
      return [v[0] - (1 - Math.cos(th)) * r, b.min[1] + Math.sin(th) * r, v[2]];
    });
    return { ...mesh, verts };
  },
};

export const DEFORMER_TYPES = Object.keys(DEFORMERS);

export function applyDeformer(mesh, d) {
  const fn = DEFORMERS[d.type];
  if (!fn) throw new Error(`未知变形器 "${d.type}"，可用：${DEFORMER_TYPES.join(', ')}`);
  return fn(mesh, d);
}

/* ------------------------------------------------------------------ CSG */

const BOOL_OPS = { union: 'union', subtract: 'subtract', intersect: 'intersect' };

/* -------------------------------------------------------------- compiler */

/**
 * Compile one object node.
 * @param {object} node object entry from a .quadforge document
 * @returns {{mesh, warnings: string[]}}
 */
export function compileObject(node, ctx = {}) {
  const warnings = [];
  let mesh = null;
  let material = { ...DEFAULT_MATERIAL, ...(ctx.materials?.[node.material] ?? {}), ...(node.materialInline ?? {}) };

  if (node.kind === 'humanoid') {
    const rig = { ...CHAR_DEFAULTS, ...(node.rig ?? {}) };
    mesh = buildCharacter(rig);
  } else if (node.kind === 'mesh') {
    if (!node.mesh?.verts || !node.mesh?.faces) throw new Error(`对象 ${node.id}: kind=mesh 需要 mesh.verts / mesh.faces`);
    mesh = { verts: node.mesh.verts, faces: node.mesh.faces };
  } else if (node.kind === 'part' || node.parts) {
    const parts = node.parts ?? [];
    if (!parts.length) throw new Error(`对象 ${node.id}: parts 为空`);
    for (const part of parts) {
      let pm = makePrimitive(part.prim ?? part);
      pm = applyTRS(pm, part.transform ?? {});
      for (const d of part.deform ?? []) pm = applyDeformer(pm, d);

      const op = part.op ?? (mesh ? 'union' : 'merge');
      if (op === 'merge' || op === 'add') {
        mesh = mesh ? joinMeshes(mesh, pm) : pm;
      } else if (op === 'subtract' || op === 'union' || op === 'intersect') {
        if (!mesh) { mesh = pm; continue; }
        try {
          mesh = booleanOp(mesh, pm, BOOL_OPS[op]);
        } catch (e) {
          warnings.push(`CSG ${op} 失败（${part.id ?? part.prim?.type}）：${e.message}；已退化为合并`);
          mesh = joinMeshes(mesh, pm);
        }
      } else {
        throw new Error(`未知 op "${op}"，可用：merge / union / subtract / intersect`);
      }
    }
  } else {
    if (node.prim) {
      mesh = makePrimitive(node.prim);
    } else {
      throw new Error(`对象 ${node.id}: 需要 kind（humanoid/part/mesh）或 prim`);
    }
  }

  for (const d of node.deform ?? []) mesh = applyDeformer(mesh, d);
  mesh = applyTRS(mesh, node.transform ?? {});

  if (node.subdiv > 0) {
    const r = subdivide(mesh, node.subdiv);
    mesh = { verts: r.verts, faces: r.faces };
  }
  if (node.weld !== false) mesh = mergeByDistance(mesh, node.weldTolerance ?? 1e-5);
  // CSG and joins can leave inconsistently wound islands; a global check fixes
  // the common case (whole mesh inverted) without re-topologising.
  if (node.fixWinding !== false) mesh = fixWinding(mesh);

  return { mesh, material, warnings };
}

/** Compile a whole document into the editor's object list shape. */
export function compileDocument(doc) {
  if (doc?.schema !== SCHEMA_ID) throw new Error(`schema 必须是 "${SCHEMA_ID}"，实际为 "${doc?.schema}"`);
  if (!Array.isArray(doc.objects)) throw new Error('objects 必须是数组');
  const materials = doc.materials ?? {};
  const warnings = [];
  const objects = doc.objects.map((node, i) => {
    const id = node.id ?? `obj${i}`;
    const r = compileObject({ ...node, id }, { materials });
    warnings.push(...r.warnings.map((w) => `[${id}] ${w}`));
    return {
      id: node.id ?? `obj_${i}`,
      name: node.name ?? id,
      mesh: r.mesh,
      material: r.material,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      subdiv: 0,
      visible: node.visible !== false,
      _source: node,
    };
  });
  return { objects, materials, warnings };
}

/** Best-effort editor object -> recipe node (for round-tripping). */
export function objectToNode(obj) {
  return {
    id: obj.id,
    name: obj.name,
    kind: 'mesh',
    mesh: { verts: obj.mesh.verts, faces: obj.mesh.faces },
    materialInline: { ...obj.material },
    subdiv: obj.subdiv || 0,
    transform: obj.transform,
  };
}

/** Serialise editor objects back to a document (lossy: becomes kind=mesh). */
export function documentFromObjects(objects, meta = {}) {
  return {
    schema: SCHEMA_ID,
    version: RECIPE_VERSION,
    unit: 'm',
    meta,
    materials: {},
    objects: objects.map(objectToNode),
  };
}
