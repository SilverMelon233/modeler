/**
 * FACE TEXTURE — the anime face, drawn on a canvas.
 *
 * WHY TEXTURE AND NOT GEOMETRY.
 *
 * An anime face gets its identity from drawn lines and flat colour, not from
 * sculpted form: the eye is an outline plus an iris disc plus two highlights,
 * the brow is a thin arc, the mouth is a two-stroke curve. Trying to model that
 * with vertex displacement produced a soft bulge that subdivision smoothed into
 * a blob. A texture carries hard edges for free, needs no topology, and costs
 * one draw call.
 *
 * The canvas is a full-head box in UV space, drawn once and reused.
 */

const W = 1024;
const H = 1024;

/** Landmarks as fractions of the head box (0 = top of canvas, 1 = bottom). */
export const FACE_LAYOUT = {
  browY: 0.320,
  eyeY: 0.400,
  eyeOffsetX: 0.160,
  eyeW: 0.170,
  eyeH: 0.105,
  noseY: 0.560,
  mouthY: 0.670,
  blushY: 0.540,
  blushX: 0.320,
};

function drawEye(ctx, cx, cy, w, h, side, palette) {
  // Almond shape: upper lid arcs more than the lower one, which is what makes
  // an eye read as an eye rather than an ellipse.
  const path = new Path2D();
  const upper = h * 0.62;
  const lower = h * 0.38;
  path.moveTo(cx - w / 2, cy);
  path.bezierCurveTo(cx - w * 0.28, cy - upper, cx + w * 0.28, cy - upper, cx + w / 2, cy);
  path.bezierCurveTo(cx + w * 0.26, cy + lower, cx - w * 0.26, cy + lower, cx - w / 2, cy);

  // sclera
  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - w, cy - h, w * 2, h * 2);

  // iris: a tall disc, slightly off-centre toward the nose for a friendly gaze
  const irisR = h * 0.52;
  const irisX = cx + side * w * 0.02;
  const grad = ctx.createLinearGradient(irisX, cy - irisR, irisX, cy + irisR);
  grad.addColorStop(0, palette.irisTop);
  grad.addColorStop(1, palette.irisBottom);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(irisX, cy, irisR * 0.94, irisR * 1.06, 0, 0, Math.PI * 2);
  ctx.fill();

  // pupil
  ctx.fillStyle = palette.pupil;
  ctx.beginPath();
  ctx.ellipse(irisX, cy + irisR * 0.06, irisR * 0.42, irisR * 0.56, 0, 0, Math.PI * 2);
  ctx.fill();

  // shadow across the top of the iris: the lid casts onto it
  ctx.fillStyle = 'rgba(20, 16, 40, 0.28)';
  ctx.beginPath();
  ctx.ellipse(irisX, cy - irisR * 0.55, irisR * 1.0, irisR * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // highlights: one big, one small — the single strongest anime cue
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(irisX - irisR * 0.34, cy - irisR * 0.34, irisR * 0.30, irisR * 0.36,
    -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(irisX + irisR * 0.38, cy + irisR * 0.34, irisR * 0.15, irisR * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  // upper lash line: thick, and thicker toward the outer corner
  ctx.strokeStyle = palette.line;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy);
  ctx.bezierCurveTo(cx - w * 0.28, cy - upper, cx + w * 0.28, cy - upper, cx + w / 2, cy);
  ctx.lineWidth = h * 0.16;
  ctx.stroke();

  // outer flick
  ctx.beginPath();
  ctx.moveTo(cx + side * w * 0.48, cy - h * 0.06);
  ctx.lineTo(cx + side * w * 0.60, cy - h * 0.22);
  ctx.lineWidth = h * 0.10;
  ctx.stroke();
}

function drawBrow(ctx, cx, cy, w, side, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w * 0.10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy + w * 0.06);
  ctx.quadraticCurveTo(cx, cy - w * 0.10, cx + w / 2, cy + w * 0.02);
  ctx.stroke();
  void side;
}

function drawMouth(ctx, cx, cy, w, color) {
  // A small open smile: two arcs meeting at a point, filled with a darker tone.
  ctx.strokeStyle = color;
  ctx.lineWidth = w * 0.10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy - w * 0.05);
  ctx.quadraticCurveTo(cx, cy + w * 0.55, cx + w / 2, cy - w * 0.05);
  ctx.stroke();

  // faint tongue/inner shadow so the smile is not a bare line
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#b4556a';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.34, cy + w * 0.02);
  ctx.quadraticCurveTo(cx, cy + w * 0.40, cx + w * 0.34, cy + w * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawBlush(ctx, cx, cy, w, h) {
  // Solid fill with a soft EDGE COLOUR rather than a transparent gradient: the
  // shader blends the decal with a hard coverage cut, so a transparent wash
  // would either vanish or show its boundary. A solid disc whose colour fades
  // toward the skin tone leaves alpha at 1 everywhere it matters.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w);
  g.addColorStop(0, 'rgba(255, 138, 148, 0.34)');
  g.addColorStop(0.55, 'rgba(255, 150, 158, 0.20)');
  g.addColorStop(1, 'rgba(255, 170, 175, 0.06)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - w, cy - h, w * 2, h * 2);
  ctx.restore();
}

/**
 * Draw the face onto a 2D context at head-box UV scale.
 * Exported separately so the same routine can be used for canvas previews.
 */
export function paintFace(ctx, palette, opts = {}) {
  const L = FACE_LAYOUT;
  ctx.clearRect(0, 0, W, H);
  // Optional opaque skin fill, used by the PNG preview so the features can be
  // judged against the real base colour. The live texture stays transparent.
  if (opts.skin) {
    ctx.fillStyle = opts.skin;
    ctx.fillRect(0, 0, W, H);
  }

  // blush goes under the eyes
  drawBlush(ctx, W * L.blushX, H * L.blushY, W * 0.085, H * 0.045);
  drawBlush(ctx, W * (1 - L.blushX), H * L.blushY, W * 0.085, H * 0.045);

  // nose: a short shadow line, not a shape
  ctx.strokeStyle = 'rgba(150, 104, 96, 0.55)';
  ctx.lineWidth = W * 0.012;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(W / 2, H * (L.noseY - 0.012), W * 0.020, 0.30, Math.PI - 0.30);
  ctx.stroke();

  drawMouth(ctx, W / 2, H * L.mouthY, W * 0.085, palette.line);

  for (const side of [-1, 1]) {
    const cx = W / 2 + side * W * L.eyeOffsetX;
    drawBrow(ctx, cx, H * L.browY, W * 0.150, side, palette.brow);
    drawEye(ctx, cx, H * L.eyeY, W * L.eyeW, H * L.eyeH, side, palette);
  }
}

export const FACE_PALETTES = {
  // warm, dark-haired character
  default: {
    irisTop: '#7fd8e8',
    irisBottom: '#2f6f9e',
    pupil: '#182032',
    line: '#2a1f33',
    brow: '#4a3446',
  },
  amber: {
    irisTop: '#ffd88a',
    irisBottom: '#b46a24',
    pupil: '#2a1a10',
    line: '#2e1f1a',
    brow: '#5a3b2a',
  },
  violet: {
    irisTop: '#d0b6ff',
    irisBottom: '#6440a8',
    pupil: '#1c1430',
    line: '#241a2e',
    brow: '#42304f',
  },
};

export const FACE_CANVAS_SIZE = { W, H };

/** Create a THREE texture from the face painter (browser only). */
export function makeFaceTexture(THREE, paletteName = 'default') {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  paintFace(ctx, FACE_PALETTES[paletteName] || FACE_PALETTES.default);
  const tex = new THREE.CanvasTexture(canvas);
  // A canvas has its origin at the TOP-left; a GL texture samples from the
  // BOTTOM-left by default, so the face was drawn upside down (the mouth
  // appeared above the eyes). Turning the flip OFF makes the sampled v axis
  // match the canvas y axis, which is what the UV projection assumes.
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
