/**
 * CHARACTER BUILDER — parametric humanoid generator.
 *
 * Proportions follow real anthropometry for a 1.8 m adult, expressed as
 * fractions of total height H. Every part overlaps its neighbour so the
 * assembled shell is watertight after the global weld.
 *
 * Parts: torso (lofted superellipse), neck, trapezius, head (shaped sphere),
 * nose/brow/ears/eyes, hair cap, shoulder deltoids, arms (upper + fore),
 * hands with 5 fingers + thumb, pelvis wrap, legs (thigh + calf), feet.
 */
import { sphere, cylinder, roundedBox, tubeAlong, loft } from './primitives.js';
import { add, sub, mul, norm, len, solidify, fixWinding } from './mesh.js';

function concat(parts) {
  const verts = [];
  const faces = [];
  for (const p of parts) {
    if (!p || !p.verts.length) continue;
    const off = verts.length;
    for (const v of p.verts) verts.push([v[0], v[1], v[2]]);
    for (const f of p.faces) faces.push(f.map((i) => i + off));
  }
  return { verts, faces };
}

function transform(mesh, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const [rx, ry, rz] = rot;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const verts = mesh.verts.map((v) => {
    let x = v[0] * scale[0], y = v[1] * scale[1], z = v[2] * scale[2];
    // Z, then Y, then X (same order as the recipe transform helper)
    let nx = x * cz - y * sz, ny = x * sz + y * cz;
    x = nx; y = ny;
    nx = x * cy + z * sy; let nz = -x * sy + z * cy;
    x = nx; z = nz;
    ny = y * cx - z * sx; nz = y * sx + z * cx;
    y = ny; z = nz;
    return [x + pos[0], y + pos[1], z + pos[2]];
  });
  return { verts, faces: mesh.faces.map((f) => f.slice()) };
}

const sec = (y, rx, rz, e = 2.4, z = 0) => ({ c: [0, y, z], rx, rz, e, rot: 0 });

/**
 * Box with explicit FULL dimensions (w, h, d) in metres.
 * primitives.roundedBox(1) has extent 1, so Object3D scale == full size;
 * using a named helper avoids mixing half- and full-extent conventions.
 */
function box(w, h, d, radius = 0.35, n = 4) {
  return transform(roundedBox(1, radius, n), { scale: [w, h, d] });
}

export const CHAR_DEFAULTS = {
  height: 1.8,
  build: 0.45,       // 0 slim .. 1 heavy
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
  hair: true,
  armor: false,
};

/**
 * @param {object} p see CHAR_DEFAULTS
 * @returns {{verts:number[][], faces:number[][]}}
 */
export function buildCharacter(p = {}) {
  const o = { ...CHAR_DEFAULTS, ...p };
  const H = o.height;

  // --- vertical landmarks (fractions of height) ---------------------------
  const pelvisY = 0.500 * H;     // hip joint line
  const crotchY = 0.470 * H;
  const waistY = 0.605 * H;
  const chestY = 0.720 * H;
  const shoulderY = 0.800 * H;
  const chinY = 0.865 * H;
  const headR = 0.068 * H * o.headScale;
  const headCY = chinY + headR * 1.00;

  // --- horizontal half-extents -------------------------------------------
  const bld = o.build;
  const mus = o.muscle;

  const shoulderW = (0.108 + 0.018 * o.shoulder + 0.010 * bld) * H;
  const chestW = (0.088 + 0.020 * bld + 0.007 * mus) * H;
  const waistW = (0.068 + 0.030 * o.belly) * H;
  const pelvisW = (0.086 + 0.026 * o.hips) * H;

  const chestD = (0.048 + 0.020 * bld) * H;
  const waistD = (0.040 + 0.026 * o.belly) * H;
  const pelvisD = (0.046 + 0.018 * o.hips) * H;

  const parts = [];

  /* ---------------------------------------------------------------- torso */
  const torso = loft([
    sec(crotchY - 0.010 * H, pelvisW * 0.80, pelvisD * 0.86, 2.6, -0.004 * H),
    sec(pelvisY, pelvisW, pelvisD, 2.7, -0.006 * H),
    sec(pelvisY + 0.048 * H, pelvisW * 0.94, pelvisD * 0.96, 2.7, -0.003 * H),
    sec(waistY - 0.020 * H, waistW * 0.98, waistD * 0.98, 2.5, 0),
    sec(waistY, waistW, waistD, 2.5, 0),
    sec(waistY + 0.035 * H, waistW * 1.06, waistD * 1.04, 2.6, 0.002 * H),
    sec(chestY - 0.030 * H, chestW * 0.97, chestD * 0.94, 2.7, 0.004 * H),
    sec(chestY, chestW, chestD, 2.8, 0.004 * H),
    sec(chestY + 0.045 * H, chestW * 0.99, chestD * 0.92, 2.7, 0.002 * H),
    sec(shoulderY - 0.008 * H, shoulderW * 0.72, chestD * 0.80, 2.3, 0),
    sec(shoulderY + 0.014 * H, shoulderW * 0.52, chestD * 0.68, 2.2, -0.002 * H),
  ], 24);

  // bust shaping: push the front of the chest forward with a smooth lobe
  if (o.bust > 0.02) {
    torso.verts.forEach((v) => {
      const y = v[1];
      const dy = Math.abs(y - (chestY - 0.012 * H)) / (0.055 * H);
      if (dy > 1) return;
      const t = 1 - dy;
      if (v[2] < 0.012 * H) return;
      const side = Math.min(1, Math.abs(v[0]) / (chestW * 0.9));
      v[2] += 0.017 * H * o.bust * t * (1 - side * 0.5);
    });
  }
  // glutes + lat spread
  torso.verts.forEach((v) => {
    const y = v[1];
    if (v[2] < 0 && y > pelvisY - 0.03 * H && y < pelvisY + 0.08 * H) {
      const t = Math.max(0, 1 - Math.abs(y - (pelvisY + 0.02 * H)) / (0.075 * H));
      v[2] -= 0.014 * H * o.hips * t * (1 - Math.min(1, Math.abs(v[0]) / pelvisW));
    }
    if (v[2] < 0 && y > chestY - 0.04 * H && y < shoulderY) {
      const t = Math.max(0, 1 - Math.abs(y - (chestY + 0.03 * H)) / (0.09 * H));
      v[2] -= 0.008 * H * mus * t;
    }
  });
  parts.push(torso);

  /* ----------------------------------------------------------------- neck */
  const neckR = (0.026 + 0.005 * mus) * H * o.neck;
  const neckBase = shoulderY - 0.004 * H;
  const neckTop = chinY - 0.006 * H;
  parts.push(transform(cylinder(neckR, neckTop - neckBase + 0.03 * H, 14, 2), {
    pos: [0, (neckBase + neckTop) / 2, -0.004 * H],
  }));
  // trapezius: a low wide wedge blending shoulders into the neck
  parts.push(transform(box(shoulderW * 1.55, 0.042 * H, chestD * 1.6, 0.45), {
    pos: [0, shoulderY + 0.004 * H, -0.008 * H],
  }));

  /* ----------------------------------------------------------------- head */
  const head = sphere(headR, 24, 18);
  head.verts.forEach((v) => {
    const ny = v[1] / headR;                    // -1 (chin) .. 1 (crown)
    const front = v[2] > 0;
    let sx = 0.88 + 0.10 * Math.max(0, ny);
    let sz = 0.94;
    if (ny < -0.15) {
      const t = Math.min(1, (-ny - 0.15) / 0.85);       // jaw taper
      sx *= 1 - 0.26 * t;
      sz *= 1 - 0.05 * t;
      v[2] += headR * 0.10 * t * (front ? 1 : 0.1);     // chin forward
      v[1] += headR * 0.04 * t;
    }
    if (ny > 0.5) sx *= 1 - 0.08 * (ny - 0.5);
    v[0] *= sx;
    v[2] *= sz;
    if (v[2] < 0) v[2] *= 0.95;                        // flatter occiput
  });
  const headPos = [0, headCY, 0.002 * H];
  parts.push(transform(head, { pos: headPos, scale: [0.90, 1.05, 1] }));

  // nose
  parts.push(transform(box(headR * 0.30, headR * 0.36, headR * 0.36, 0.45, 3), {
    pos: [0, headCY - headR * 0.06, headPos[2] + headR * 0.90],
  }));
  // brow ridge
  for (const s of [-1, 1]) {
    parts.push(transform(box(headR * 0.62, headR * 0.14, headR * 0.28, 0.5, 3), {
      pos: [s * headR * 0.33, headCY + headR * 0.30, headPos[2] + headR * 0.68],
      rot: [0, s * 0.16, s * 0.09],
    }));
  }
  // ears
  for (const s of [-1, 1]) {
    parts.push(transform(sphere(headR * 0.26, 10, 8), {
      pos: [s * headR * 0.86, headCY + headR * 0.02, headPos[2] - headR * 0.10],
      scale: [0.40, 0.95, 0.70],
    }));
  }
  // eyes (shallow spheres sitting in the socket)
  for (const s of [-1, 1]) {
    parts.push(transform(sphere(headR * 0.19, 12, 10), {
      pos: [s * headR * 0.33, headCY + headR * 0.12, headPos[2] + headR * 0.82],
      scale: [1, 0.85, 0.62],
    }));
  }

  // hair cap: solidify the upper shell so it is a closed volume
  if (o.hair) {
    const cap = sphere(headR * 1.03, 24, 14);
    cap.faces = cap.faces.filter((f) => {
      const cy = f.reduce((a, i) => a + cap.verts[i][1], 0) / f.length;
      const cz = f.reduce((a, i) => a + cap.verts[i][2], 0) / f.length;
      // keep the crown and the back of the head, never the face
      return cy > headR * 0.34 || (cz < -headR * 0.06 && cy > -headR * 0.18);
    });
    parts.push(transform(solidify(cap, headR * 0.10, -1), {
      pos: headPos, scale: [0.92, 1.06, 1.02],
    }));
  }

  /* ----------------------------------------------------------- left/right */
  for (const s of [-1, 1]) {
    /* deltoid */
    const deltoidR = (0.030 + 0.008 * mus) * H;
    parts.push(transform(sphere(deltoidR, 14, 12), {
      pos: [s * shoulderW * 0.86, shoulderY - 0.016 * H, 0],
      scale: [0.95, 1.10, 0.95],
    }));

    /* arm: upper + forearm, relaxed A-pose hanging slightly out */
    const armLen = 0.56 * H * o.armLength;     // shoulder -> wrist
    const sh = [s * shoulderW * 0.92, shoulderY - 0.020 * H, 0];
    const elbow = [
      s * (shoulderW * 0.92 + 0.030 * H),
      sh[1] - armLen * 0.50,
      -0.014 * H,
    ];
    const wrist = [
      s * (shoulderW * 0.92 + 0.052 * H),
      sh[1] - armLen * 0.98,
      0.004 * H,
    ];

    const upperR = (0.029 + 0.011 * mus) * H;
    const elbowR = (0.023 + 0.006 * mus) * H;
    const foreMidR = (0.021 + 0.005 * mus) * H;
    const wristR = 0.015 * H;

    const upper = tubeAlong(
      [sh, [sh[0] + s * 0.012 * H, sh[1] - armLen * 0.25, -0.004 * H], elbow],
      [upperR, upperR * 0.96, elbowR], 12,
    );
    const fore = tubeAlong(
      [elbow, [elbow[0] + s * 0.010 * H, (elbow[1] + wrist[1]) / 2, -0.002 * H], wrist],
      [elbowR, foreMidR, wristR], 12,
    );
    parts.push(upper, fore);

    /* hand */
    const hs = o.handSize;
    const dir = norm(sub(wrist, elbow));
    const palmLen = 0.054 * H * hs;
    const palmW = 0.042 * H * hs;
    const palmTh = 0.019 * H * hs;
    const palmC = add(wrist, mul(dir, palmLen * 0.50));
    const yaw = Math.atan2(dir[0], -dir[1]);
    parts.push(transform(box(palmW * 2, palmLen, palmTh * 2, 0.4), {
      pos: palmC, rot: [0, 0, -yaw],
    }));

    // four fingers fanning from the palm's far edge
    for (let fi = 0; fi < 4; fi++) {
      const spread = (fi - 1.5) / 1.5;                    // -1..1
      const flen = (0.044 - 0.006 * Math.abs(spread)) * H * hs;
      const base = add(add(palmC, mul(dir, palmLen * 0.46)), [spread * palmW * 0.30 * -s, 0, 0]);
      const tip = add(base, mul(dir, flen));
      const mid = add(base, mul(dir, flen * 0.55));
      mid[2] += 0.004 * H;                                 // slight curl
      parts.push(tubeAlong([base, mid, tip], [0.0060 * H * hs, 0.0052 * H * hs, 0.0036 * H * hs], 7));
    }
    // thumb, offset toward the body and forward
    const thBase = add(add(palmC, mul(dir, -palmLen * 0.10)), [-palmW * 0.85 * s, 0, palmTh * 0.7]);
    const thMid = add(thBase, [-s * 0.012 * H * hs, -0.006 * H * hs, 0.013 * H * hs]);
    const thTip = add(thMid, [-s * 0.004 * H * hs, -0.014 * H * hs, 0.008 * H * hs]);
    parts.push(tubeAlong([thBase, thMid, thTip], [0.0072 * H * hs, 0.0060 * H * hs, 0.0042 * H * hs], 7));

    /* leg: hip -> knee -> ankle */
    const legLen = 0.445 * H * o.legLength;
    const hip = [s * pelvisW * 0.52, pelvisY - 0.010 * H, 0];
    const knee = [s * pelvisW * 0.56, pelvisY - legLen * 0.50, 0.006 * H];
    const ankleY = Math.max(0.045 * H, pelvisY - legLen);
    const ankle = [s * pelvisW * 0.58, ankleY, -0.002 * H];

    const thighR = (0.046 + 0.014 * mus) * H;
    const kneeR = (0.029 + 0.005 * mus) * H;
    const calfR = (0.026 + 0.008 * mus) * H;
    const ankleR = 0.014 * H;

    const thigh = tubeAlong(
      [hip, [(hip[0] + knee[0]) / 2, (hip[1] + knee[1]) / 2, 0.004 * H], knee],
      [thighR, thighR * 0.86, kneeR], 16,
    );
    const calf = tubeAlong(
      [knee, [(knee[0] + ankle[0]) / 2, (knee[1] + ankle[1]) / 2, -0.004 * H], ankle],
      [kneeR, calfR, ankleR], 14,
    );
    // calf bulge at the back
    calf.verts.forEach((v) => {
      const t = (knee[1] - v[1]) / Math.max(1e-6, knee[1] - ankle[1]);
      if (t > 0.08 && t < 0.55 && v[2] < 0) v[2] -= 0.007 * H * mus * Math.sin(t * Math.PI * 1.3);
    });
    parts.push(thigh, calf);

    /* foot: overlaps the ankle so the shell stays closed */
    const fs = o.footSize;
    const footLen = 0.118 * H * fs;                 // heel -> toe
    const footH = 0.032 * H * fs;
    const footW = 0.044 * H * fs;
    parts.push(transform(box(footW, footH, footLen, 0.32), {
      pos: [ankle[0], ankle[1] - footH * 0.46, 0.040 * H * fs],
    }));
    // ankle: overlaps the calf above and the foot below so the shell is sealed
    parts.push(transform(cylinder(ankleR * 1.35, 0.052 * H, 12, 1), {
      pos: [ankle[0], ankle[1] - 0.008 * H, 0],
    }));

    /* armor shells */
    if (o.armor) {
      // pauldron: a shell hugging the deltoid, not a balloon
      parts.push(transform(sphere(deltoidR * 1.28, 14, 10), {
        pos: [s * shoulderW * 0.87, shoulderY - 0.014 * H, 0],
        scale: [1.0, 0.88, 1.0],
      }));
      parts.push(transform(box(0.080 * H, armLen * 0.40, 0.072 * H, 0.4), {
        pos: [s * (shoulderW * 0.92 + 0.022 * H), sh[1] - armLen * 0.30, 0],
        rot: [0, 0, -s * 0.10],
      }));
      // shin guard
      parts.push(transform(box(0.064 * H, (knee[1] - ankle[1]) * 0.84, 0.048 * H, 0.4), {
        pos: [knee[0], (knee[1] + ankle[1]) / 2, 0.014 * H],
      }));
    }
  }

  /* ----------------------------------------------------------- pelvis wrap */
  parts.push(transform(box(pelvisW * 2.04, 0.11 * H, pelvisD * 2.04, 0.45), {
    pos: [0, pelvisY - 0.030 * H, 0],
  }));

  if (o.armor) {
    parts.push(transform(box(chestW * 2.08, 0.17 * H, chestD * 2.08, 0.4), {
      pos: [0, chestY + 0.010 * H, 0],
    }));
  }

  let merged = fixWinding(concat(parts));

  // Normalise: feet on the ground, total height exactly H.
  let minY = Infinity, maxY = -Infinity;
  for (const v of merged.verts) { minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]); }
  const k = H / (maxY - minY || 1);
  for (const v of merged.verts) {
    v[1] = (v[1] - minY) * k;
    v[0] *= k;
    v[2] *= k;
  }

  return merged;
}
