/**
 * Core kernel tests — pure Node, no browser needed.
 * Run: node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/core/primitives.js';
import {
  catmullClark, subdivide, extrudeFaces, insetFaces, mergeByDistance,
  signedVolume, mirrorX, solidify, healTJunctions, fillHoles, compact,
} from '../src/core/mesh.js';
import { buildCharacter } from '../src/core/character.js';
import { meshReport } from '../src/core/checks.js';
import { applyTRS, fromTRS, invert, multiply, transformPoint } from '../src/core/transform.js';
import { booleanOp } from '../src/core/booleans.js';
import { validateDocument, validateGeometry } from '../src/core/schema.js';
import { applyPatch, diffDocuments, tryApplyPatch } from '../src/core/patch.js';
import { compileDocument } from '../src/core/recipe.js';
import { toSTL, toOBJ, toGLTF } from '../src/core/exporters.js';

/* ------------------------------------------------------------- primitives */

const closed = {
  cube: () => P.cube(1, 2),
  sphere: () => P.sphere(0.5, 16, 12),
  cylinder: () => P.cylinder(0.5, 1, 16, 1),
  cone: () => P.cone(0.5, 1, 16),
  torus: () => P.torus(0.6, 0.2, 20, 10),
  capsule: () => P.capsule(0.25, 0.9, 16, 12),
  roundedBox: () => P.roundedBox(1, 0.15, 4),
  loft: () => P.loft([
    { c: [0, -0.5, 0], rx: 0.3, rz: 0.2 },
    { c: [0, 0, 0], rx: 0.4, rz: 0.3 },
    { c: [0, 0.5, 0], rx: 0.25, rz: 0.18 },
  ], 16),
  tube: () => P.tubeAlong([[0, 0, 0], [0.4, 0.3, 0], [0.9, 0.2, 0.2]], [0.1, 0.12, 0.06], 10),
  extrude: () => P.extrudePolygons([{
    outer: [[0, 0], [0.5, 0], [0.5, 0.4], [0, 0.4]],
    holes: [[[0.15, 0.1], [0.35, 0.1], [0.35, 0.3], [0.15, 0.3]]],
  }], 0.2),
};

for (const [name, fn] of Object.entries(closed)) {
  test(`primitive ${name} is watertight, outward-wound, positive volume`, () => {
    const m = fn();
    const r = meshReport(m);
    assert.equal(r.openEdges, 0, `${name} has open edges`);
    assert.equal(r.nonManifoldEdges, 0, `${name} has non-manifold edges`);
    assert.ok(r.volume > 0, `${name} volume should be positive, got ${r.volume}`);
    assert.ok(Math.abs(signedVolume(m) - r.volume) < 1e-6);
  });
}

test('extruded polygon with hole has the analytic volume', () => {
  const m = closed.extrude();
  const expected = (0.5 * 0.4 - 0.2 * 0.2) * 0.2;
  assert.ok(Math.abs(signedVolume(m) - expected) < 1e-9);
});

test('cube volume is exactly 1', () => {
  assert.ok(Math.abs(signedVolume(P.cube(1, 2)) - 1) < 1e-12);
});

/* ------------------------------------------------------------ subdivision */

test('catmull-clark quadruples face count and keeps watertightness', () => {
  const m = P.cube(1, 1);      // 6 quads
  const r = catmullClark(m);
  assert.equal(r.faces.length, 6 * 4);
  const two = subdivide(m, 2);
  assert.equal(two.faces.length, 6 * 16);
  assert.ok(meshReport(two).watertight);
});

test('catmull-clark shrinks a cube toward the limit surface without exploding', () => {
  const r = subdivide(P.cube(1, 1), 2);
  const vol = signedVolume(r);
  assert.ok(vol > 0.3 && vol < 1.0, `subdivided cube volume ${vol}`);
});

/* --------------------------------------------------------------- topology */

test('extrude adds cap and wall faces, stays watertight', () => {
  const cube = P.cube(1, 1);
  const out = extrudeFaces(cube, [0], 0.4);
  const r = meshReport(out);
  assert.ok(out.faces.length > cube.faces.length);
  assert.equal(r.openEdges, 0);
});

test('inset keeps face count growable and topology closed', () => {
  const cube = P.cube(1, 1);
  const out = insetFaces(cube, [0], 0.3);
  assert.ok(out.faces.length > cube.faces.length);
  assert.equal(meshReport(out).openEdges, 0);
});

test('cutX + mirrorX rebuilds a closed symmetric solid', async () => {
  const { cutX } = await import('../src/core/cut.js');
  const half = cutX(P.sphere(0.6, 24, 16), 1, true);
  assert.ok(meshReport(half).watertight, 'half should be capped and closed');
  const full = mirrorX(half, true);
  const r = meshReport(full);
  assert.equal(r.openEdges, 0);
  assert.equal(r.nonManifoldEdges, 0);
  // full sphere volume = 4/3 pi r^3 ~= 0.905; polygonal approximation is lower
  assert.ok(r.volume > 0.8 && r.volume < 0.95, `mirrored volume ${r.volume}`);
});

test('solidify closes an open sheet into a solid', () => {
  const sheet = P.plane(1, 4);
  assert.ok(!meshReport(sheet).watertight);
  const solid = solidify(sheet, 0.05, -1);
  const r = meshReport(solid);
  assert.equal(r.openEdges, 0, 'solidified sheet should be closed');
  assert.ok(r.volume > 0);
});

test('fillHoles closes a deliberately holed mesh', () => {
  const cube = P.cube(1, 2);
  const holed = { verts: cube.verts, faces: cube.faces.slice(0, -1) };
  assert.ok(!meshReport(holed).watertight);
  const fixed = fillHoles(holed, 8);
  assert.equal(meshReport(fixed).openEdges, 0);
});

/* ------------------------------------------------------------------- CSG */

test('CSG subtract produces a watertight result with reduced volume', () => {
  const box = P.roundedBox(0.5, 0.03, 3);
  const drill = P.cylinder(0.1, 0.7, 20);
  const out = booleanOp(box, drill, 'subtract');
  const r = meshReport(out);
  assert.equal(r.openEdges, 0, 'CSG result should be watertight after repair');
  assert.ok(r.volume < signedVolume(box), 'subtracting material must reduce volume');
  assert.ok(r.volume > 0);
});

test('CSG union of disjoint solids equals the sum of volumes', () => {
  const a = applyTRS(P.sphere(0.3, 16, 12), { position: [-0.5, 0, 0] });
  const b = applyTRS(P.sphere(0.3, 16, 12), { position: [0.5, 0, 0] });
  const out = booleanOp(a, b, 'union');
  const r = meshReport(out);
  assert.equal(r.openEdges, 0);
  const expected = signedVolume(a) + signedVolume(b);
  assert.ok(Math.abs(r.volume - expected) < 0.01 * expected, `union volume ${r.volume} vs ${expected}`);
});

test('CSG intersect of a box and a sphere is bounded by the smaller volume', () => {
  const box = P.cube(0.6, 2);
  const sph = P.sphere(0.35, 20, 14);
  const out = booleanOp(box, sph, 'intersect');
  const r = meshReport(out);
  assert.equal(r.openEdges, 0);
  assert.ok(r.volume > 0 && r.volume <= signedVolume(sph) + 1e-6);
});

/* ------------------------------------------------------------ transform */

test('matrix TRS round-trips through invert', () => {
  const m = fromTRS([1, 2, 3], [0.2, 0.4, -0.1], [2, 0.5, 1.5]);
  const p = [0.3, -0.7, 1.1];
  const back = transformPoint(invert(m), transformPoint(m, p));
  assert.ok(Math.hypot(back[0] - p[0], back[1] - p[1], back[2] - p[2]) < 1e-9);
  const I = multiply(m, invert(m));
  for (let i = 0; i < 16; i++) {
    assert.ok(Math.abs(I[i] - (i % 5 === 0 ? 1 : 0)) < 1e-9, `identity[${i}] = ${I[i]}`);
  }
});

test('mirror transform flips winding so volume stays positive', () => {
  const m = applyTRS(P.cube(1, 2), { mirror: 'x' });
  assert.ok(signedVolume(m) > 0);
});

/* ------------------------------------------------------------ character */

test('character is watertight and roughly human-proportioned', () => {
  const m = buildCharacter({ height: 1.8 });
  const r = meshReport(m);
  assert.equal(r.openEdges, 0, 'character shell should be closed');
  assert.equal(r.nonManifoldEdges, 0);
  assert.ok(r.volume > 0.03 && r.volume < 0.4, `character volume ${r.volume}`);
  assert.ok(Math.abs(r.size[1] - 1.8) < 0.01, `height ${r.size[1]}`);
});

test('character parameters are monotonic where expected', () => {
  const slim = buildCharacter({ height: 1.8, build: 0, belly: 0 });
  const heavy = buildCharacter({ height: 1.8, build: 1, belly: 1 });
  assert.ok(signedVolume(heavy) > signedVolume(slim));
  const short = buildCharacter({ height: 1.2 });
  assert.ok(meshReport(short).size[1] < meshReport(slim).size[1]);
});

test('character with hair and armor stays watertight', () => {
  const m = buildCharacter({ hair: true, armor: true, height: 1.85 });
  assert.equal(meshReport(m).openEdges, 0);
});

/* --------------------------------------------------------------- schema */

const minimalDoc = {
  schema: 'quadforge/1',
  objects: [{ id: 'a', kind: 'part', parts: [{ prim: { type: 'box', size: 0.5 } }] }],
};

test('schema accepts a minimal document', () => {
  const v = validateDocument(minimalDoc);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
});

test('schema rejects unknown fields and bad ids', () => {
  const bad = { schema: 'quadforge/1', objects: [{ id: 'has space', nope: 1 }] };
  const v = validateDocument(bad);
  assert.equal(v.valid, false);
  const paths = v.errors.map((e) => e.path);
  assert.ok(paths.some((p) => p.includes('id')));
  assert.ok(paths.some((p) => p.includes('nope')));
});

test('schema rejects out-of-range primitive params', () => {
  const bad = {
    schema: 'quadforge/1',
    objects: [{ id: 'a', prim: { type: 'sphere', segments: 2 } }],
  };
  const v = validateDocument(bad);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.path.includes('segments')));
});

test('geometry validation catches out-of-range mesh indices', () => {
  const doc = {
    schema: 'quadforge/1',
    objects: [{
      id: 'a', kind: 'mesh',
      mesh: { verts: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 7]] },
    }],
  };
  const g = validateGeometry(doc);
  assert.equal(g.valid, false);
  assert.ok(g.issues[0].message.includes('越界'));
});

test('geometry validation catches dangling material references', () => {
  const doc = {
    schema: 'quadforge/1',
    objects: [{ id: 'a', prim: { type: 'box' }, material: 'ghost' }],
  };
  assert.equal(validateGeometry(doc).valid, false);
});

/* ---------------------------------------------------------------- patch */

test('JSON Patch replace applies and result validates', () => {
  const next = applyPatch(minimalDoc, [{ op: 'replace', path: '/objects/0/parts/0/prim/size', value: 0.9 }]);
  assert.equal(next.objects[0].parts[0].prim.size, 0.9);
  assert.equal(validateDocument(next).valid, true);
});

test('setRig merges into an existing rig instead of replacing it', () => {
  const doc = { schema: 'quadforge/1', objects: [{ id: 'h', kind: 'humanoid', rig: { height: 1.7, build: 0.2 } }] };
  const next = applyPatch(doc, [{ op: 'setRig', path: '/objects/0', value: { build: 0.9 } }]);
  assert.deepEqual(next.objects[0].rig, { height: 1.7, build: 0.9 });
});

test('setRig refuses non-humanoid targets', () => {
  const r = tryApplyPatch(minimalDoc, [{ op: 'setRig', path: '/objects/0', value: { build: 1 } }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /humanoid/);
});

test('addPart / removePart round-trip', () => {
  let doc = applyPatch(minimalDoc, [{ op: 'addPart', path: '/objects/0', value: { id: 'b', prim: { type: 'sphere' } } }]);
  assert.equal(doc.objects[0].parts.length, 2);
  doc = applyPatch(doc, [{ op: 'removePart', path: '/objects/0', partId: 'b' }]);
  assert.equal(doc.objects[0].parts.length, 1);
});

test('patch failure leaves the document untouched and reports the op', () => {
  const r = tryApplyPatch(minimalDoc, [{ op: 'replace', path: '/nope/x', value: 1 }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /patch\[0\]/);
});

test('diffDocuments produces a patch that reconstructs the target', () => {
  const b = structuredClone(minimalDoc);
  b.objects[0].parts[0].prim.size = 1.25;
  b.meta = { title: 'changed' };
  const patch = diffDocuments(minimalDoc, b);
  const rebuilt = applyPatch(minimalDoc, patch);
  assert.deepEqual(rebuilt, b);
});

/* --------------------------------------------------------------- recipe */

test('recipe compiles humanoid + CSG parts', () => {
  const doc = {
    schema: 'quadforge/1',
    materials: { steel: { color: '#aab4c0', metalness: 0.9, roughness: 0.2 } },
    objects: [
      { id: 'h', kind: 'humanoid', rig: { height: 1.7, hair: false } },
      {
        id: 'w', kind: 'part', material: 'steel',
        parts: [
          { prim: { type: 'cube', size: 0.3 } },
          { op: 'subtract', prim: { type: 'cylinder', radius: 0.08, height: 0.5, segments: 16 } },
        ],
      },
    ],
  };
  const { objects, warnings } = compileDocument(doc);
  assert.equal(objects.length, 2);
  assert.equal(warnings.length, 0);
  assert.equal(objects[1].material.metalness, 0.9);
  assert.ok(meshReport(objects[1].mesh).volume < 0.3 ** 3);
});

test('recipe reports unknown primitives clearly', () => {
  const doc = { schema: 'quadforge/1', objects: [{ id: 'x', prim: { type: 'teapot' } }] };
  assert.throws(() => compileDocument(doc), /未知图元类型/);
});

test('recipe rejects a wrong schema id', () => {
  assert.throws(() => compileDocument({ schema: 'nope', objects: [] }), /schema/);
});

test('recipe deformers: taper reduces volume monotonically', () => {
  const base = { schema: 'quadforge/1', objects: [{ id: 'c', prim: { type: 'cylinder', radius: 0.3, height: 1 }, deform: [] }] };
  const tapered = structuredClone(base);
  tapered.objects[0].deform = [{ type: 'taper', top: 0.3, bottom: 1 }];
  const a = compileDocument(base).objects[0].mesh;
  const b = compileDocument(tapered).objects[0].mesh;
  assert.ok(signedVolume(b) < signedVolume(a));
  assert.ok(signedVolume(b) > 0);
});

/* ------------------------------------------------------------ exporters */

test('STL export has the correct header and triangle count', () => {
  const m = P.cube(1, 2);
  const stl = toSTL(m, 'test');
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const tris = dv.getUint32(80, true);
  assert.equal(tris, m.faces.length * 2);
  assert.equal(stl.byteLength, 84 + tris * 50);
});

test('OBJ export references valid 1-based indices', () => {
  const obj = toOBJ([{ id: 'a', name: 'a', mesh: P.cube(1, 1) }]);
  const lines = obj.split('\n');
  const vcount = lines.filter((l) => l.startsWith('v ')).length;
  const maxIdx = Math.max(...lines.filter((l) => l.startsWith('f '))
    .flatMap((l) => l.slice(2).split(' ').map(Number)));
  assert.equal(maxIdx, vcount);
});

test('GLB export has a valid container and parses as glTF 2.0', () => {
  const glb = toGLTF([{ id: 'a', name: 'a', mesh: P.cube(1, 1), material: { color: '#ff0000' } }], { binary: true });
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546c67);   // glTF
  assert.equal(dv.getUint32(4, true), 2);
  assert.equal(dv.getUint32(8, true), glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  assert.equal(dv.getUint32(16, true), 0x4e4f534a);  // JSON
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
  assert.equal(json.asset.version, '2.0');
  assert.equal(json.meshes.length, 1);
});

test('compact drops unreferenced vertices', () => {
  const m = P.cube(1, 2);
  m.verts.push([99, 99, 99]);
  const c = compact(m);
  assert.equal(c.verts.length, m.verts.length - 1);
});

test('mergeByDistance welds coincident vertices', () => {
  const m = P.cube(1, 2);
  const dup = { verts: [...m.verts, ...m.verts.map((v) => [...v])], faces: m.faces.slice() };
  assert.equal(mergeByDistance(dup, 1e-6).verts.length, m.verts.length);
});
