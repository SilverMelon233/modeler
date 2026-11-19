import * as THREE from 'three';

/**
 * TOON SHADING — the "anime look" that Genshin-like games get from a small set
 * of tricks, none of which are high-poly geometry:
 *
 *   1. a BANDED light ramp instead of a smooth N·L falloff, so the terminator
 *      reads as a drawn line rather than a gradient;
 *   2. a cool, slightly desaturated SHADOW TINT rather than a darker albedo —
 *      skin in shadow goes violet/blue, not brown;
 *   3. a RIM light so silhouette edges pick up a bright fringe;
 *   4. an INVERTED-HULL outline (see makeOutlineMaterial) which draws the dark
 *      contour that sells the 2D-illustration feel.
 *
 * All four are shading tricks. The mesh underneath is still our quad body.
 */

const TOON_VERT = /* glsl */`
  varying vec3 vViewNormal;
  varying vec3 vViewPos;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  varying float vMask;
  attribute float aFaceMask;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mv.xyz;
    vViewNormal = normalize(normalMatrix * normal);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    vMask = aFaceMask;
    gl_Position = projectionMatrix * mv;
  }
`;

const TOON_FRAG = /* glsl */`
  uniform vec3 uBase;
  uniform vec3 uShade;
  uniform vec3 uRim;
  uniform vec3 uLightDirView;   // toward the light, in view space
  uniform vec3 uRimDirView;
  uniform float uRimPower;
  uniform float uRimStrength;
  uniform float uBands;         // 2 = hard cel, 3 = softer
  uniform float uSpecular;
  uniform vec3 uSpecColor;
  uniform sampler2D uFaceTex;
  uniform float uFaceAmount;    // 0 = no decal (non-character objects)
  varying vec3 vViewNormal;
  varying vec3 vViewPos;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  varying float vMask;

  // Quantise a 0..1 ramp into N flat steps with a narrow smooth band at each
  // edge. A pure step() gives aliased stair-steps; this keeps the edge crisp but
  // not jaggy, which is what the "2D but not pixelated" look needs.
  float quantise(float x, float n) {
    float scaled = x * n;
    float lower = floor(scaled);
    float frac = scaled - lower;
    float w = fwidth(scaled) * 1.5 + 0.02;
    float step01 = smoothstep(0.5 - w, 0.5 + w, frac);
    return (lower + step01) / n;
  }

  void main() {
    vec3 N = normalize(vViewNormal);
    vec3 V = normalize(vViewPos);
    vec3 L = normalize(uLightDirView);

    // --- banded diffuse -----------------------------------------------------
    // Half-lambert wrap, but WITHOUT the usual +0.5 bias trick applied twice:
    // biasing here would lift every surface into the lit band and flatten the
    // cel ramp, which is exactly what the first attempt did.
    float ndl = dot(N, L);
    float wrapped = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
    float lit = clamp(wrapped * 1.15 - 0.05, 0.0, 1.0);

    // --- cool shadow tint ---------------------------------------------------
    // Mixing toward a tinted shade colour (rather than multiplying the albedo
    // down) is what keeps shadowed skin from looking muddy.
    // TRUE CEL RAMP.
    //
    // A plain mix(shade, base, lit) is a smooth gradient: it technically shows
    // the nose, but the value change is so gradual that the form reads as a
    // soft blob instead of drawn shading. Snapping the ramp to a small set of
    // discrete values is what produces the flat, poster-like planes anime
    // shading is made of.
    float cel = floor(lit * 4.0 + 0.001) / 3.0;
    cel = clamp(cel, 0.0, 1.0);
    vec3 col = mix(uShade, uBase, cel);

    // --- face decal -----------------------------------------------------
    // Blended AFTER the cel ramp: the drawn lines must not be re-shaded by the
    // light, or the eyes change value as the head turns and stop reading as ink.
    if (uFaceAmount > 0.001) {
      vec4 face = texture2D(uFaceTex, vUv);
      // The canvas is transparent where nothing is drawn, but transparent
      // pixels still carry rgb 0. Mixing with them directly darkened the whole
      // masked area and showed as a grey tear along the mask edge. Premultiply,
      // and gate on coverage rather than on the raw rgb.
      float coverage = face.a * vMask * uFaceAmount;
      vec3 faceLin = pow(face.rgb / max(face.a, 1e-4), vec3(2.2));
      // Hard cut, not a ramp. A soft ramp multiplied the surface colour by a
      // partially-covered texel, and on this coarse grid the transition band
      // fell across whole faces — the grey tear down the middle of the face.
      col = mix(col, faceLin, step(0.5, coverage));
    }

    // --- rim ----------------------------------------------------------------
    vec3 R = normalize(uRimDirView);
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uRimPower);
    float rimMask = smoothstep(0.0, 0.6, dot(N, R) * 0.5 + 0.5);
    col += uRim * rim * rimMask * uRimStrength;

    // --- hard specular ------------------------------------------------------
    if (uSpecular > 0.0) {
      vec3 H = normalize(L + V);
      float s = pow(max(dot(N, H), 0.0), 48.0);
      float band = smoothstep(0.35, 0.45, s) * uSpecular;
      col = mix(col, uSpecColor, band);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function makeToonMaterial(mat, lights) {
  return new THREE.ShaderMaterial({
    vertexShader: TOON_VERT,
    fragmentShader: TOON_FRAG,
    uniforms: {
      uBase: { value: new THREE.Color(mat.color) },
      uShade: { value: new THREE.Color(mat.shadeColor || '#5a5f8c') },
      uRim: { value: new THREE.Color(mat.rimColor || '#bfe4ff') },
      uLightDirView: { value: (lights.keyDir || new THREE.Vector3(-0.62,0.55,0.56)).clone() },
      uRimDirView: { value: (lights.rimDir || new THREE.Vector3(0.55,0.35,-0.75)).clone() },
      uRimPower: { value: mat.rimPower ?? 2.6 },
      uRimStrength: { value: mat.rimStrength ?? 0.30 },
      uBands: { value: mat.bands ?? 4 },
      uSpecular: { value: mat.specular ?? 0 },
      uFaceTex: { value: mat.faceTexture ?? null },
      uFaceAmount: { value: mat.faceTexture ? 1 : 0 },
      uSpecColor: { value: new THREE.Color(mat.specColor || '#ffffff') },
    },
    side: THREE.FrontSide,
  });
}

/**
 * Inverted-hull outline: the same geometry, back faces only, pushed outward
 * along the normal. Cheap, resolution-independent, and it never leaks through
 * the surface the way a screen-space edge filter can.
 */
const OUTLINE_VERT = /* glsl */`
  uniform float uThickness;
  void main() {
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Scale thickness with distance so the line keeps a constant screen width.
    mv.xyz += n * uThickness * -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export function makeOutlineMaterial(color = '#2a1f33', thickness = 0.0022) {
  return new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VERT,
    fragmentShader: `uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }`,
    uniforms: {
      uThickness: { value: thickness },
      uColor: { value: new THREE.Color(color) },
    },
    side: THREE.BackSide,
    depthWrite: true,
  });
}

/** Anime proportions: a bigger head and longer legs read as "stylised". */
export const ANIME_PRESET = {
  headScale: 1.28,
  shoulder: 0.38,
  build: 0.28,
  muscle: 0.30,
  belly: 0.18,
  hips: 0.42,
  legLength: 1.10,
  armLength: 0.98,
  neck: 0.92,
  handSize: 0.88,
  footSize: 0.92,
};
