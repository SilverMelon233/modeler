/**
 * CLI end-to-end tests — exercise the exact commands an LLM agent would run.
 * Run: node --test tests/cli.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const QF = path.join(ROOT, 'src/bin/qf.js');
const HERO = path.join(ROOT, 'examples/hero.quadforge.json');
const PATCH = path.join(ROOT, 'examples/patches/muscular.json');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-test-'));

function qf(args, { expectFail = false } = {}) {
  try {
    const out = execFileSync(process.execPath, [QF, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      timeout: 120000,
    });
    if (expectFail) throw new Error('expected failure but command succeeded');
    return { code: 0, out };
  } catch (e) {
    if (!expectFail) throw new Error(`qf ${args.join(' ')} failed:\n${e.stdout || ''}\n${e.stderr || ''}`);
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('qf validate accepts the example document', () => {
  const { out } = qf(['validate', HERO]);
  assert.match(out, /校验通过/);
});

test('qf validate rejects a broken document with a non-zero exit', () => {
  const bad = path.join(tmp, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ schema: 'quadforge/1', objects: [{ id: 'x', prim: { type: 'nope' } }] }));
  const r = qf(['validate', bad], { expectFail: true });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /校验失败|未知|必须/);
});

test('qf stats --json reports every example object as watertight', () => {
  const { out } = qf(['stats', HERO, '--json']);
  const data = JSON.parse(out);
  assert.equal(data.ok, true);
  assert.equal(data.objects.length, 3);
  for (const o of data.objects) {
    assert.equal(o.openEdges, 0, `${o.id} has open edges`);
    assert.equal(o.nonManifoldEdges, 0, `${o.id} has non-manifold edges`);
    assert.ok(o.volume > 0, `${o.id} volume ${o.volume}`);
  }
});

test('qf compile writes a valid GLB', () => {
  const outFile = path.join(tmp, 'hero.glb');
  const { out } = qf(['compile', HERO, '-o', outFile]);
  assert.match(out, /GLB/);
  const buf = fs.readFileSync(outFile);
  assert.equal(buf.readUInt32LE(0), 0x46546c67);
  assert.equal(buf.readUInt32LE(4), 2);
  assert.equal(buf.readUInt32LE(8), buf.length);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a);
});

test('qf compile writes a binary STL with the right triangle count', () => {
  const outFile = path.join(tmp, 'hero.stl');
  qf(['compile', HERO, '-o', outFile]);
  const buf = fs.readFileSync(outFile);
  const tris = buf.readUInt32LE(80);
  assert.ok(tris > 1000, `unexpected triangle count ${tris}`);
  assert.equal(buf.length, 84 + tris * 50);
});

test('qf compile writes a valid OBJ', () => {
  const outFile = path.join(tmp, 'hero.obj');
  qf(['compile', HERO, '-o', outFile]);
  const text = fs.readFileSync(outFile, 'utf8');
  assert.match(text, /^# QuadForge export/m);
  const verts = text.split('\n').filter((l) => l.startsWith('v ')).length;
  const faces = text.split('\n').filter((l) => l.startsWith('f '));
  // The body is now a single 500-ish vertex quad surface rather than thousands
  // of vertices from assembled primitives, so the threshold tracks the shape.
  assert.ok(verts > 300, `unexpected vertex count ${verts}`);
  assert.ok(faces.length > 300, `unexpected face count ${faces.length}`);
  const maxIdx = Math.max(...faces.flatMap((l) => l.slice(2).trim().split(/\s+/).map(Number)));
  assert.ok(maxIdx <= verts);
});

test('qf patch applies a semantic edit and keeps the model valid', () => {
  const outFile = path.join(tmp, 'hero2.json');
  const { out } = qf(['patch', HERO, PATCH, '-o', outFile]);
  assert.match(out, /已应用 3 个操作/);
  assert.match(out, /调整人物参数/);
  const doc = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(doc.objects[0].rig.build, 0.78);
  assert.equal(doc.objects[0].rig.height, 1.9);
  assert.equal(doc.materials.skin.color, '#c98d63');
  assert.equal(doc.objects[2].parts.length, 3);
  // and the patched doc still compiles
  assert.match(qf(['stats', outFile]).out, /水密 ✓/);
});

test('qf patch fails loudly on an out-of-range path', () => {
  const patchFile = path.join(tmp, 'badpatch.json');
  fs.writeFileSync(patchFile, JSON.stringify([{ op: 'replace', path: '/objects/99/name', value: 'x' }]));
  const r = qf(['patch', HERO, patchFile, '-o', path.join(tmp, 'nope.json')], { expectFail: true });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /补丁应用失败/);
});

test('qf diff produces a patch that rebuilds the target document', () => {
  const a = path.join(tmp, 'a.json');
  const b = path.join(tmp, 'b.json');
  fs.writeFileSync(a, JSON.stringify({ schema: 'quadforge/1', objects: [{ id: 'x', prim: { type: 'box', size: 1 } }] }));
  fs.writeFileSync(b, JSON.stringify({ schema: 'quadforge/1', objects: [{ id: 'x', prim: { type: 'box', size: 2 } }] }));
  const diffFile = path.join(tmp, 'diff.json');
  qf(['diff', a, b, '-o', diffFile]);
  const outFile = path.join(tmp, 'rebuilt.json');
  qf(['patch', a, diffFile, '-o', outFile]);
  assert.deepEqual(JSON.parse(fs.readFileSync(outFile, 'utf8')), JSON.parse(fs.readFileSync(b, 'utf8')));
});

test('qf materialize bakes a recipe into an editable mesh document', () => {
  const outFile = path.join(tmp, 'hero.mesh.json');
  const { out } = qf(['materialize', HERO, '-o', outFile]);
  assert.match(out, /已烘焙/);
  const doc = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(doc.objects.length, 3);
  for (const o of doc.objects) {
    assert.equal(o.kind, 'mesh');
    assert.ok(o.mesh.verts.length > 0);
    assert.ok(o.mesh.faces.length > 0);
  }
  // and it still validates
  qf(['validate', outFile]);
});

test('qf schema emits parseable JSON Schema with the document id', () => {
  const { out } = qf(['schema']);
  const schema = JSON.parse(out);
  assert.equal(schema.$id, 'https://quadforge.dev/schema/1.json');
  assert.ok(schema.definitions.object);
  assert.ok(schema.definitions.prim);
});

test('qf unknown command exits non-zero with a hint', () => {
  const r = qf(['frobnicate'], { expectFail: true });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /未知命令/);
});
