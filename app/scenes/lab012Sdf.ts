// Lab 012 inc 2 — the glass is a distance field, not a mesh.
//
// The spike (inc 1) gave every panel an extruded rounded-rect wearing drei's
// MeshTransmissionMaterial, and paid for it with one full scene render PER
// PANEL: MTM refracts by sampling a screen-space buffer, so each panel needs
// its own buffer with itself (and everything in front of it) hidden. Three
// panels, three scene renders, and the bookkeeping to keep them ordered.
//
// This is the other way round. Render the scene ONCE, then composite each
// panel as a full-screen pass that:
//
//   1. rebuilds the eye ray for the pixel and intersects it with the panel's
//      own plane — so the panel keeps an arbitrary 3D pose; the SDF is
//      evaluated in PANEL-LOCAL 2D, not in screen space,
//   2. evaluates a rounded-rect SDF there. That is the whole shape: no
//      geometry, no curveSegments, no MSAA — coverage comes out of the
//      distance with an exact analytic antialias,
//   3. builds a bezel normal from the SDF's gradient and an analytic height
//      profile, refracts the eye ray through it, and samples the ACCUMULATED
//      image behind it,
//   4. lays the panel's own DOM texture on top, unrefracted, clipped by the
//      same coverage that drew the glass.
//
// Because the passes ping-pong far→near, a panel samples the composite of
// everything already laid down behind it — glass, ink and world. Multi-level
// refraction is not a feature here, it's the shape of the loop; inc 1's
// cumulative-hide ordering rule (README, decisions #34) is deleted rather
// than reimplemented.
//
// Everything below runs in linear light: the scene FBO is HalfFloat, three
// forces NoToneMapping and a linear working space for any render into a
// target (WebGLPrograms.js:176 — the spike's manual toneMapping save/restore
// was belt-and-braces), and BLIT_FRAGMENT is the one place tone mapping and
// the sRGB transfer happen, once, on the way to the screen.

/** Shared by both passes: a full-screen quad that ignores the camera. */
export const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * One glass panel, composited over `tSrc`.
 *
 * `SAMPLES` is a define (8 is the tuned default): each sample walks one step
 * along a spectral ramp, so a single loop buys BOTH dispersion (the step
 * indexes an ior between ior±chroma) and frost (it also jitters the sample
 * point). Weighting the taps by a spectral response and normalising means
 * chroma=0 degrades to a plain blur instead of a tinted one.
 */
export const GLASS_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D tSrc;      // everything composited so far (linear)
uniform sampler2D tDepth;    // scene depth, for occlusion
uniform sampler2D tInk;      // the panel's live DOM (premultiplied, sRGB tex)
uniform bool  uHasInk;
uniform float uInkOpacity;

// camera
uniform vec3  uCamPos;
uniform mat4  uInvProjView;  // clip -> world
uniform mat4  uProjView;     // world -> clip
uniform mat4  uView;         // world -> view
uniform float uNear;
uniform float uFar;

// panel frame
uniform mat4  uPanelInv;     // world -> panel local
uniform mat3  uPanelRot;     // panel local -> world (rotation)
uniform vec2  uHalf;         // half extents, world units
uniform float uRadius;       // corner radius, world units

// glass
uniform float uBezel;        // width of the lensing rim, world units
uniform float uThickness;    // height of the bezel bulge, world units
uniform float uSpread;       // how far the refracted ray travels before we
                             // re-project it — the strength of the bend
uniform float uIor;
uniform float uChroma;
uniform float uRough;        // frost
uniform vec3  uTint;
uniform float uTintAmount;
uniform float uEdgeLight;    // the bright hairline on the rim
uniform float uSpecular;
uniform vec3  uLightDir;

// A rounded rect as a signed distance. Negative inside, and — unlike a
// coverage mask — it keeps meaning outside the shape, which is what the
// bezel profile below is a function of.
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + r;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

// Its gradient — the outward direction, unit length everywhere the field is
// a true distance. This is the "which way does the rim face" that a mesh
// would have had to store as vertex normals.
vec2 sdRoundRectGrad(vec2 p, vec2 b, float r) {
  vec2 s = sign(p);
  vec2 d = abs(p) - b + r;
  if (d.x > 0.0 && d.y > 0.0) return s * normalize(d);
  return (d.x > d.y) ? vec2(s.x, 0.0) : vec2(0.0, s.y);
}

float viewZFromDepth(float depth, float near, float far) {
  float z = depth * 2.0 - 1.0;
  return (2.0 * near * far) / (far + near - z * (far - near)) * -1.0;
}

vec2 projectToUv(vec3 world) {
  vec4 clip = uProjView * vec4(world, 1.0);
  return clip.xy / clip.w * 0.5 + 0.5;
}

// Golden-angle spiral: cheap, isotropic, and no texture lookup.
vec2 spiralTap(int i, int n) {
  float f = (float(i) + 0.5) / float(n);
  float a = float(i) * 2.39996323;
  return vec2(cos(a), sin(a)) * sqrt(f);
}

vec3 spectralWeight(float f) {
  return max(vec3(
    smoothstep(0.62, 0.0, f),
    1.0 - abs(f - 0.5) * 2.0,
    smoothstep(0.38, 1.0, f)
  ), vec3(0.0));
}

void main() {
  vec3 base = texture2D(tSrc, vUv).rgb;

  // --- the eye ray, rebuilt from the pixel ------------------------------
  vec4 farClip = uInvProjView * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(farClip.xyz / farClip.w - uCamPos);

  // --- intersect the panel's own plane (local z = 0) --------------------
  vec3 lo = (uPanelInv * vec4(uCamPos, 1.0)).xyz;
  vec3 ld = (uPanelInv * vec4(rd, 0.0)).xyz;
  if (abs(ld.z) < 1e-6) { gl_FragColor = vec4(base, 1.0); return; }
  float t = -lo.z / ld.z;
  if (t <= 0.0) { gl_FragColor = vec4(base, 1.0); return; }
  vec2 q = (lo + ld * t).xy;

  // --- coverage: the shape IS the distance ------------------------------
  float d = sdRoundRect(q, uHalf, uRadius);
  float aa = max(fwidth(d), 1e-6);
  float cov = 1.0 - smoothstep(-aa, aa, d);
  if (cov <= 0.002) { gl_FragColor = vec4(base, 1.0); return; }

  // --- occlusion against the one scene render ---------------------------
  // View-space z is negative ahead of the camera, so "nearer" is greater.
  // Background pixels sit at depth 1 → -far → never in front of anything.
  vec3 hit = uCamPos + rd * t;
  float panelZ = (uView * vec4(hit, 1.0)).z;
  float sceneZ = viewZFromDepth(texture2D(tDepth, vUv).x, uNear, uFar);
  if (sceneZ > panelZ + 1e-4) { gl_FragColor = vec4(base, 1.0); return; }

  // --- the bezel, as a height field over the distance -------------------
  // h(d) rises from 0 at the outline to uThickness over uBezel, on a
  // quarter-circle profile, then goes flat. The normal is what that slope
  // does to the gradient direction — a lens rim with no vertices in it.
  float e = clamp(-d / uBezel, 0.0, 1.0);
  float k = 1.0 - e;
  float prof = sqrt(max(1.0 - k * k, 0.0));
  float slope = (e >= 1.0) ? 0.0 : -uThickness * (k / max(prof, 0.02)) / uBezel;
  vec2 g = sdRoundRectGrad(q, uHalf, uRadius);
  vec3 nLocal = normalize(vec3(-slope * g, 1.0));
  if (ld.z > 0.0) nLocal = -nLocal;   // seen from behind: the far face
  vec3 n = normalize(uPanelRot * nLocal);

  // --- refraction: dispersion and frost in one loop ---------------------
  // Frost is a property of the FLAT glass, and the rim is where the lens
  // does its work — blurring there (the first thing this shader did) turns
  // the bezel into a soft white halo and throws away the one detail the
  // whole approach buys: a crisp, strongly displaced edge. So the profile
  // runs the other way, easing OFF as the bezel takes over.
  float blur = uRough * 0.05 * (0.35 + 0.65 * e);
  vec3 acc = vec3(0.0);
  vec3 wsum = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float f = (float(i) + 0.5) / float(SAMPLES);
    float ior = uIor + (f - 0.5) * 2.0 * uChroma;
    vec3 r = refract(rd, n, 1.0 / max(ior, 1.0001));
    if (dot(r, r) < 1e-6) r = reflect(rd, n);       // total internal reflection
    vec2 uv = projectToUv(hit + r * uSpread) + spiralTap(i, SAMPLES) * blur;
    vec3 w = spectralWeight(f);
    acc += texture2D(tSrc, clamp(uv, 0.001, 0.999)).rgb * w;
    wsum += w;
  }
  vec3 glass = acc / max(wsum, vec3(1e-4));

  // --- the surface's own light ------------------------------------------
  glass = mix(glass, uTint, uTintAmount);

  float fres = pow(1.0 - abs(dot(rd, n)), 5.0);
  vec3 lightDir = normalize(uLightDir);
  vec3 hv = normalize(lightDir - rd);   // "half" is a reserved word in GLSL
  float spec = pow(max(dot(n, hv), 0.0), 180.0) * uSpecular;
  // The hairline is a HAIRLINE: it lives in the outermost eighth of the
  // bezel, where the rim has turned far enough to catch light the flat face
  // never sees. Widen it and the panel grows a chunky white border instead
  // of an edge.
  float rim = (1.0 - smoothstep(0.0, 0.14, e)) * uEdgeLight * (0.35 + fres);
  glass += spec + rim + fres * 0.12;

  // --- the ink, on top, in the panel's own UV ---------------------------
  if (uHasInk) {
    vec2 iuv = q / (2.0 * uHalf) + 0.5;
    vec4 ink = texture2D(tInk, iuv) * uInkOpacity;   // premultiplied
    glass = glass * (1.0 - ink.a) + ink.rgb;
  }

  gl_FragColor = vec4(mix(base, glass, cov), 1.0);
}
`

/** The only place the pipeline leaves linear light. */
export const BLIT_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
void main() {
  gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
