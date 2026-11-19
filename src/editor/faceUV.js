/**
 * UV PROJECTION — map the flat face texture onto the head.
 *
 * The head is a closed quad surface with no UVs and no seams, so ordinary
 * unwrapping would need a cut, and a cut on the face is exactly where an artist
 * would not put a seam. Instead the texture is applied by PLANAR PROJECTION
 * along +Z, restricted to the front of the face by an analytic mask.
 *
 * That is the same trick a decal uses. It has two consequences worth stating:
 *
 *   * the face can only be viewed from the front without stretching, which is
 *     fine for a character portrait but not for a game camera;
 *   * the mask must be smooth or the texture edge shows as a hard rectangle,
 *     so the alpha fades out with distance from the face centre.
 */

/**
 * Planar +Z projection into the head's local box, with a radial mask.
 *
 * @param {{verts:number[][], faces:number[][]}} mesh
 * @param {object} head  {minY, maxY, halfW, frontZ}
 * @returns {Float32Array} per-vertex UV
 */
export function projectFaceUV(mesh, head) {
  const { minY, maxY, halfW } = head;
  const span = Math.max(1e-6, maxY - minY);
  const uvs = new Float32Array(mesh.verts.length * 2);

  // The canvas is laid out for a head that fills it, but the measured box
  // includes the neck below the jaw. Remapping so the box covers only the
  // canvas's face region is what puts the eyes at eye height instead of on the
  // cheekbones: without it the whole decal sat about a third of a head too low.
  const V_TOP = 0.08;      // canvas v for the crown
  const V_BOTTOM = 0.92;   // canvas v for the jaw

  for (let i = 0; i < mesh.verts.length; i++) {
    const [x, y] = mesh.verts[i];
    // u: across the face, centred on 0.5
    const u = 0.5 + (x / (halfW * 2)) * 0.5;
    // t: 0 at the jaw, 1 at the crown
    const t = (y - minY) / span;
    const v = V_BOTTOM + (V_TOP - V_BOTTOM) * t;
    // Clamp: vertices far below the head (torso, legs) would otherwise produce
    // v values in the thousands. They are masked out anyway, but an
    // out-of-range UV makes the sampler wrap the face texture across the body if
    // the mask ever evaluates non-zero there, and it fails the range assertion
    // that guards exactly this.
    uvs[i * 2] = Math.min(1, Math.max(0, u));
    uvs[i * 2 + 1] = Math.min(1, Math.max(0, v));
  }
  return uvs;
}

/**
 * Per-vertex mask in [0,1]: how strongly the face texture should apply.
 *
 * Weighting by mask in the shader (rather than in the texture's alpha) keeps the
 * texture crisp and lets the fade be computed from geometry that is already
 * smooth, so no aliasing appears along the fade.
 */
export function faceMask(mesh, head) {
  const { minY, maxY, halfW, frontZ } = head;
  const span = Math.max(1e-6, maxY - minY);
  const out = new Float32Array(mesh.verts.length);

  for (let i = 0; i < mesh.verts.length; i++) {
    const [x, y, z] = mesh.verts[i];

    // Front hemisphere only. The test is on the NORMALISED depth so it scales
    // with the head instead of with absolute metres: comparing raw z against a
    // fixed fraction of frontZ left only 84 vertices masked.
    if (z <= 0) { out[i] = 0; continue; }
    const nz = z / (frontZ || 1);

    const ny = (y - minY) / span;              // 0 jaw, 1 crown
    const nx = x / (halfW || 1);               // -1 .. 1

    // Vertical window: keep the whole front of the head, crown included. The
    // previous upper cut at ny=0.80 clipped the eyes, which are drawn in the
    // upper third of the canvas.
    const vy = smoothstep(0.00, 0.06, ny) * (1 - smoothstep(0.92, 1.0, ny));
    // Horizontal: fade toward the ears
    const vx = 1 - smoothstep(0.70, 1.05, Math.abs(nx));
    // Front-facing softness.
    //
    // This was smoothstep(0.25, 0.62, nz), which left the bridge of the nose
    // (nz ~ 0.45) only half covered while the cheeks were fully covered — a
    // partial-alpha island in the middle of the face that read as a grey tear.
    // The ramp now starts near the silhouette edge so the whole front of the
    // face is covered uniformly and only the sides fade.
    const vz = smoothstep(0.12, 0.30, nz);

    out[i] = Math.max(0, Math.min(1, vy * vx * vz));
  }
  return out;
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

/**
 * Head box used by both the UV and the mask.
 * Derived from the mesh so it tracks every parameter change.
 */
export function headBox(mesh) {
  const crown = Math.max(...mesh.verts.map((v) => v[1]));

  const halfAt = (y) => {
    let w = 0;
    for (const v of mesh.verts) if (Math.abs(v[1] - y) < 0.007) w = Math.max(w, Math.abs(v[0]));
    return w;
  };

  // Find the neck: the narrowest section in the column below the crown.
  //
  // The search window matters more than the rule. Starting at `crown - 0.02`
  // put the crown itself in the window, and the crown is (of course) very
  // narrow, so it was reported as the neck and the head box collapsed to a 36 mm
  // sliver — which is why only a handful of vertices got any mask at all.
  // The window must start well below the crown and stop above the shoulders.
  let neckY = crown - 0.22;
  let neckW = Infinity;
  const top = crown - 0.09 * 10;        // 0.09 m below the crown, in metres
  const bottom = crown - 0.30;
  for (let y = top; y > bottom; y -= 0.003) {
    const w = halfAt(y);
    if (w > 1e-6 && w < neckW) { neckW = w; neckY = y; }
  }

  const headVerts = mesh.verts.filter((v) => v[1] > neckY);
  const halfW = Math.max(1e-6, Math.max(...headVerts.map((v) => Math.abs(v[0]))));
  const frontZ = Math.max(1e-6, Math.max(...headVerts.map((v) => v[2])));
  return { minY: neckY, maxY: crown, halfW, frontZ };
}
