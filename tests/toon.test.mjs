/**
 * Face-decal tests. The interesting behaviour is that the projection is stable
 * across every parameter combination — a decal that drifts when the head
 * changes size is worse than no decal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHumanoid } from '../src/core/humanoid.js';
import { headBox, projectFaceUV, faceMask } from '../src/editor/faceUV.js';
import { FACE_LAYOUT, FACE_PALETTES, paintFace } from '../src/editor/faceTexture.js';

const PRESETS = [
  {},
  { height: 1.58, headScale: 1.28, shoulder: 0.38, build: 0.28 },
  { height: 2.0, headScale: 0.9, build: 0.9, belly: 0.8 },
  { height: 1.4, headScale: 1.35, neck: 1.3 },
];

test('head box finds a plausible head, not a sliver', () => {
  for (const p of PRESETS) {
    const m = buildHumanoid(p);
    const box = headBox(m);
    const h = box.maxY - box.minY;
    // a real head is 12-20% of body height; a collapsed box is ~2%
    const bodyH = p.height ?? 1.8;
    assert.ok(h > bodyH * 0.10, `head height ${h.toFixed(3)} too small for ${JSON.stringify(p)}`);
    assert.ok(h < bodyH * 0.30, `head height ${h.toFixed(3)} too large`);
    assert.ok(box.halfW > 0.02, 'head half-width collapsed');
  }
});

test('face UV stays inside [0,1] across parameters', () => {
  for (const p of PRESETS) {
    const m = buildHumanoid(p);
    const uv = projectFaceUV(m, headBox(m));
    for (let i = 0; i < uv.length; i++) {
      assert.ok(uv[i] >= -0.001 && uv[i] <= 1.001, `uv out of range: ${uv[i]}`);
    }
  }
});

test('the face mask covers a useful fraction of the head, and only the front', () => {
  const m = buildHumanoid(PRESETS[1]);
  const mask = faceMask(m, headBox(m));
  const covered = [...mask].filter((v) => v > 0.5).length;
  assert.ok(covered > 30, `only ${covered} vertices carry the decal`);

  // nothing on the back of the head may be covered
  m.verts.forEach((v, i) => {
    if (v[2] < -0.01) assert.equal(mask[i], 0, 'decal must not wrap to the back');
  });
});

test('the decal region spans the eye band drawn on the canvas', () => {
  // If the covered v range did not include FACE_LAYOUT.eyeY the eyes would be
  // drawn outside the projected region and clipped by the silhouette.
  const m = buildHumanoid(PRESETS[1]);
  const box = headBox(m);
  const uv = projectFaceUV(m, box);
  const mask = faceMask(m, box);
  let vmin = 1, vmax = 0;
  m.verts.forEach((v, i) => {
    if (mask[i] < 0.5) return;
    vmin = Math.min(vmin, uv[i * 2 + 1]);
    vmax = Math.max(vmax, uv[i * 2 + 1]);
  });
  assert.ok(vmin < FACE_LAYOUT.browY, `brow at ${FACE_LAYOUT.browY} outside coverage [${vmin.toFixed(2)}, ${vmax.toFixed(2)}]`);
  assert.ok(vmax > FACE_LAYOUT.mouthY, `mouth at ${FACE_LAYOUT.mouthY} outside coverage`);
});

test('face layout keeps features in a head-like arrangement', () => {
  const L = FACE_LAYOUT;
  assert.ok(L.browY < L.eyeY, 'brow must be above the eye');
  assert.ok(L.eyeY < L.noseY, 'eye must be above the nose');
  assert.ok(L.noseY < L.mouthY, 'nose must be above the mouth');
});

test('every palette defines the colours the painter uses', () => {
  for (const [name, p] of Object.entries(FACE_PALETTES)) {
    for (const k of ['irisTop', 'irisBottom', 'pupil', 'line', 'brow']) {
      assert.ok(p[k], `palette ${name} missing ${k}`);
    }
  }
});

test('paintFace draws onto a context without throwing', () => {
  // A minimal 2D-context stub: enough to prove the paint routine only uses that
  // surface, which is what lets it run under @napi-rs/canvas in the preview tool.
  const calls = [];
  const ctx = {
    clearRect: () => calls.push('clearRect'),
    fillRect: () => calls.push('fillRect'),
    beginPath: () => calls.push('beginPath'),
    closePath: () => {},
    moveTo: () => {}, lineTo: () => {}, bezierCurveTo: () => {},
    quadraticCurveTo: () => {}, arc: () => {}, ellipse: () => {},
    fill: () => calls.push('fill'), stroke: () => calls.push('stroke'),
    save: () => {}, restore: () => {}, clip: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    set lineCap(v) {}, set lineJoin(v) {}, set globalAlpha(v) {},
  };
  globalThis.Path2D = class { moveTo() {} bezierCurveTo() {} };
  paintFace(ctx, FACE_PALETTES.default);
  assert.ok(calls.includes('fill'), 'nothing was filled');
  assert.ok(calls.includes('stroke'), 'nothing was stroked');
});
