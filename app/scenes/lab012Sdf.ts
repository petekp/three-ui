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
 *
 * `MAX_BLOBS` is the other define: the panel may carry up to that many
 * coplanar circles, smooth-min-unioned into its field. That union is the
 * reason the shape had to stop being a mesh — two meshes can only overlap,
 * but two distances can merge, and the neck between them is three lines of
 * arithmetic rather than a remesh.
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

// satellites: circles COPLANAR with the panel (same local z = 0), unioned
// into its field with a smooth minimum. xy = centre in panel-local units,
// z = radius. They carry no DOM of their own — they are shape, not surface.
uniform vec3  uBlobs[MAX_BLOBS];
uniform int   uBlobCount;
uniform float uSmooth;       // blend radius: how far out a neck forms

// ripples: expanding wave packets on the panel's surface, emitted where a
// satellite makes or breaks contact. xy = origin (panel-local), z = age in
// seconds, w = signed amplitude (negative for a release, so the surface
// recoils instead of swelling).
uniform vec4  uRipples[MAX_RIPPLES];
uniform int   uRippleCount;
uniform float uRippleK;      // phase constant, 4/(27 sigma/rho) — sets scale
uniform float uRippleNu;     // viscosity: how fast short waves are eaten
uniform float uRippleSrc;    // source RADIUS — a contact is not a delta
uniform float uRippleDecay;  // bulk loss, seconds
uniform float uRippleInk;    // 0 = the DOM stays flat and crisp (see below)

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

// Polynomial smooth minimum (iq). A plain min() unions two shapes with a
// crease; this one trades a band of width k around the seam for a tangent
// join — which is the entire liquid effect. Nothing about it is a special
// case: the union of a card and a circle IS one shape, so it gets one
// coverage, one bezel, one refraction, and a rim that flows around the neck.
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// The panel's whole field. A circle needs no new primitive — but it does
// need its own cheap one, because sdRoundRect with b = vec2(r) would be an
// exact circle and three times the arithmetic.
float fieldAt(vec2 p) {
  float d = sdRoundRect(p, uHalf, uRadius);
  for (int i = 0; i < MAX_BLOBS; i++) {
    if (i >= uBlobCount) break;
    d = smin(d, length(p - uBlobs[i].xy) - uBlobs[i].z, uSmooth);
  }
  return d;
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
  float d = fieldAt(q);
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
  // With satellites in the field the analytic gradient is wrong — it only
  // knows the rect. A central difference on the UNIONED field is what makes
  // the rim follow the merged outline: through the neck the normal turns
  // continuously from card to blob, so the lens does too, and the two read as
  // one body of glass rather than two overlapping ones. Four extra field
  // evaluations, and only on covered pixels (the early-outs are above).
  vec2 g;
  if (uBlobCount == 0) {
    g = sdRoundRectGrad(q, uHalf, uRadius);
  } else {
    float eps = max(aa, 0.0015);
    vec2 gr = vec2(
      fieldAt(q + vec2(eps, 0.0)) - fieldAt(q - vec2(eps, 0.0)),
      fieldAt(q + vec2(0.0, eps)) - fieldAt(q - vec2(0.0, eps))
    );
    g = dot(gr, gr) > 1e-12 ? normalize(gr) : vec2(0.0, 1.0);
  }

  // --- ripples: a capillary impulse, not a scrolled texture -------------
  // The bezel is already h(d) and the normal is already what h's slope does
  // to a direction, so a ripple needs no new machinery — it contributes a
  // second slope, along its own radial direction, and the two add.
  //
  // What it does need is to disperse. A rigid packet translated outward at a
  // fixed speed reads as a decal being scrolled; a real impact ring STRETCHES,
  // because different wavelengths travel at different speeds. At this scale
  // the regime is capillary (surface tension, not gravity): w = C k^(3/2), so
  // the group velocity is (3/2) C sqrt(k) and SHORT waves lead. Feeding the
  // stationary-phase condition r = v_group * t back into the phase collapses
  // the whole train to one expression:
  //
  //   theta(r,t) = K r^3 / t^2,        K = 4 / (27 C^2)
  //   k(r,t)     = d(theta)/dr = 3 K r^2 / t^2
  //
  // (Those two are consistent by construction — the derivative of the phase
  // IS the stationary wavenumber. Verified numerically before it was written.)
  // The pattern therefore gets finer outward and self-similar along
  // r ~ t^(2/3), which is what a fixed-wavelength packet cannot fake.
  vec2 tilt = -slope * g;
  vec2 rippleTilt = vec2(0.0);
  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= uRippleCount) break;
    vec4 rp = uRipples[i];
    vec2 dv = q - rp.xy;
    float r = max(length(dv), 1e-4);
    float t = max(rp.z, 0.02);

    float th = uRippleK * r * r * r / (t * t);
    float kk = 3.0 * uRippleK * r * r / (t * t);

    // Amplitude, three physical terms and no fudge:
    //   inversesqrt(r) — a circular front spreads its energy over a growing
    //     circumference, so the wave MUST weaken as it travels. Its absence
    //     was the loudest thing wrong with the first version.
    //   exp(-nu k^2 t) — viscosity eats short waves quadratically. This is
    //     also what gives the train a soft leading edge instead of the hard
    //     drawn ring a gaussian window produces.
    //   exp(-t/decay) — bulk loss, so the sheet eventually goes still.
    // A finite SOURCE. Modelling the contact as a delta impulse makes the
    // first frames sixteen times more violent than the last — the wave
    // arrives as a crack and then behaves. But a bead is not a point: it
    // cannot radiate wavelengths shorter than itself, and suppressing those
    // (a gaussian source spectrum) flattens the whole run to a smooth decay
    // without a single artificial ramp.
    float src = exp(-0.5 * kk * kk * uRippleSrc * uRippleSrc);

    float amp = rp.w
      * inversesqrt(1.0 + r / 0.25)
      * exp(-uRippleNu * kk * kk * t)
      * src
      * exp(-t / uRippleDecay);

    // Nothing may oscillate faster than the pixel grid can carry. This is the
    // antialias, but it is not only cosmetic: those are exactly the waves
    // viscosity has already taken. aa is the panel's world units per pixel.
    amp *= 1.0 - smoothstep(1.0, 2.4, kk * aa);

    // h = amp cos(theta)  ->  dh/dr = -amp k sin(theta). The d(amp)/dr term
    // is dropped as slowly varying next to k.
    rippleTilt += (-amp * kk * sin(th)) * (dv / r);
  }
  // Waves break. Past a certain steepness a real surface stops being a
  // graph over the plane at all, so a soft saturation is nearer the truth
  // than letting an early frame fold the lens inside out.
  float steep = length(rippleTilt);
  if (steep > 1e-5) rippleTilt *= (1.0 / (1.0 + steep / 1.1));
  // The rim is a thick edge, not a membrane. Letting the wave die into it
  // keeps the one hairline that has to stay crisp from wobbling — and a
  // boundary that absorbs is closer to the truth than one that ignores.
  // (e is 1 on the flat glass, 0 at the outline.)
  rippleTilt *= e;
  tilt += rippleTilt;

  vec3 nLocal = normalize(vec3(tilt, 1.0));
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
  // Clipped to the RECT, not to the coverage: the DOM is a property of the
  // panel, and a satellite that has merged into it is glass with nothing
  // written on it. Without the clip the sampler's clamp-to-edge would smear
  // the card's border row out across every blob.
  if (uHasInk) {
    float outside = max(abs(q.x) - uHalf.x, abs(q.y) - uHalf.y);
    float m = 1.0 - smoothstep(-aa, aa, outside);
    if (m > 0.0) {
      // The ink rides the wave only if asked to. It is laid on unrefracted
      // BY DESIGN — the world bends through the glass, the DOM sits on it
      // and stays crisp — so warping its UV trades the thesis for the
      // effect. Default 0; __lab012.set('rippleInk', 0.4) to see the other
      // reading. (No backticks in here — they end the template literal.)
      vec2 iuv = (q + rippleTilt * uRippleInk) / (2.0 * uHalf) + 0.5;
      vec4 ink = texture2D(tInk, iuv) * (uInkOpacity * m);   // premultiplied
      glass = glass * (1.0 - ink.a) + ink.rgb;
    }
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
