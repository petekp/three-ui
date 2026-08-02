// Lab 014 — the page has a third dimension.
//
// A real, ordinary, scrollable, selectable HTML page: a two-column board of
// task cards over a few hundred words of prose. Press a card and it PEELS
// OFF the page — the same component, still live, now a rigid plate with mass
// and inertia hanging off your pointer, casting a real shadow back down onto
// the page it came from. Let go and it flies into whichever slot you were
// over, the document reflows around it for real, and it lies back down as
// ordinary DOM.
//
// The three things that make it work, all of them small:
//
// 1. THE WORLD UNIT IS A CSS PIXEL. `PixelPerfect` sets the camera distance
//    to (viewportHeight/2)/tan(fov/2), so the plane z = 0 is the viewport,
//    exactly. A card's `getBoundingClientRect()` is therefore already a
//    world pose, and there is not one conversion function anywhere in this
//    file. Lifting toward the camera is then honest perspective: the card
//    gets bigger because it is closer, and the LOD ladder re-rasterizes it
//    sharper on the way up because it really is covering more pixels.
//
// 2. NOTHING IS EVER MOVED. The page card does not go anywhere at handoff —
//    it turns `visibility: hidden`, which keeps its box, so the layout does
//    not twitch and the slot is already the right size to be a drop target.
//    The airborne copy is a second React root rendering the SAME component
//    from the SAME state. That is why there is no flash to hide: the page
//    copy stays visible until the Surface has actually painted, and for the
//    two frames where both exist they are pixel-identical and in the same
//    place.
//
// 3. THE CANVAS IS ONLY SOLID WHERE THERE IS MATTER. The overlay is
//    `pointer-events: none` at rest — a canvas with nothing in it must not be
//    able to eat a click, a text selection or a scroll — and is switched to
//    `auto` for exactly as long as the pointer is over an airborne card.
//    Same rule as decisions #20, one level up: hit-test first, then decide
//    whether you are there at all.
//
// And the loop closes: the physics writes `--l14-near` onto the slot it is
// aimed at, so a rigid-body simulation running in WebGL is restyling real
// DOM through ordinary CSS, at the same time as that DOM is being rasterized
// into the material of the thing doing the simulating.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  SURFACE_RADIUS_GLSL,
  SurfaceApp,
  useSurfaceChrome,
  useSurfaceTexture,
  type SurfaceChrome,
} from 'three-ui'
import '../lab014.css'
import { cameraDistance, carryToPlane, planeScale, screenToPlane } from './lab014Camera'
import { attachLab014Gestures } from './lab014Gestures'
import {
  aeroAmplitude,
  aeroGate,
  aeroReach,
  atRest,
  corners,
  CRUMPLE_RISE_T,
  crumplePhase,
  makePlate,
  makeShadowFrame,
  shadowQuadFrame,
  stepFree,
  stepHeld,
  wadShrink,
  type Plate,
} from './lab014Plate'

// ── the data ─────────────────────────────────────────────────────────────

interface Card {
  id: string
  tag: string
  title: string
  body: string
  note: string
  done: boolean
}

type ColId = 'queue' | 'today'
const COLS: { id: ColId; name: string }[] = [
  { id: 'queue', name: 'Queue' },
  { id: 'today', name: 'Today' },
]

const SEED: Card[] = [
  {
    id: 'c1',
    tag: 'shader',
    title: 'Scissor each glass pass',
    body: 'Every SDF pass is full-screen. Clip it to the panel’s screen AABB.',
    note: '',
    done: false,
  },
  {
    id: 'c2',
    tag: 'a11y',
    title: 'Announcer kit',
    body: 'Live-region plumbing for scene-level focus moves.',
    note: 'after the demo',
    done: false,
  },
  {
    id: 'c3',
    tag: 'perf',
    title: 'Measure the upload ceiling again',
    body: '64–96 concurrent painting sources at 120 Hz — is that still true?',
    note: '',
    done: true,
  },
  {
    id: 'c4',
    tag: 'docs',
    title: 'Write down the depth-order bug',
    body: 'Distance to the eye is not depth. Any centred scene hides it.',
    note: 'decisions #43',
    done: false,
  },
  {
    id: 'c5',
    tag: 'spike',
    title: 'Pick this card up',
    body: 'It is still a DOM element. Type in the field while it is in the air.',
    note: '',
    done: false,
  },
]

const START: Record<ColId, string[]> = {
  queue: ['c1', 'c2', 'c4'],
  today: ['c3', 'c5'],
}

// ── flight ───────────────────────────────────────────────────────────────

/** How far off the page the hand lifts a card, px. */
const LIFT_Z = 96
/** Seconds to reach it. */
const LIFT_T = 0.22
/**
 * Where a deleted card rises to before the crush, px. Deliberately BELOW
 * the density schedule's approach (0.65 · LIFT_Z ≈ 62): the pin must not
 * flip and spend a re-raster on a sheet that is about to stop being a card.
 */
const CRUMPLE_Z = 55

interface Flight {
  id: string
  w: number
  h: number
  /** Where on the card the fingers are, body-local px, +y up. */
  hold: THREE.Vector3
  plate: Plate
  /**
   * `held` — the hand is on it. `float` — it was tapped rather than dragged,
   * and hangs where it was left. `home` — it is flying back into its slot.
   * `crumple` — it is being deleted, and dies as matter.
   *
   * `float` is the state the whole lab is actually about. A card is only
   * interesting as matter for as long as it is off the page, and a card you
   * have to keep the mouse button down on is a card you cannot click into. So
   * a tap parks it in mid-air, still solid, still a DOM subtree: you can put
   * the caret in its note field and type while it is casting a shadow on the
   * paragraph below it. Tap it again and it goes home.
   *
   * `crumple` is the exception to every rule the other modes obey. They all
   * exist to end in a swap back to resting DOM; this one ends in the board
   * forgetting the slot. It is irreversible from the moment it starts (esc
   * and pointerup are guarded in the gestures), and it is the only mode
   * allowed to break the "indistinguishable from DOM" contract — on purpose,
   * because a sheet of paper crushing into a wad is the one thing a document
   * element could never do.
   */
  mode: 'held' | 'float' | 'home' | 'crumple'
  /** The crumple's one clock, seconds. Everything else is a function of it. */
  crumpleT: number
  /** The wad's tumble: axis × rate (rad/s), seeded when the crumple starts. */
  spin: THREE.Vector3
  /** Where a floating card hangs: the grab point's world position when let go. */
  anchor: THREE.Vector3
  /**
   * …and the page's scroll offset at that instant. The anchor is in world
   * coordinates, which are pinned to the VIEWPORT, but the card is hanging
   * over a particular paragraph — and it is casting a shadow on it. Let the
   * page scroll under a stationary card and the shadow slides off the thing
   * that was supposed to be under it, which reads instantly as fake. So the
   * anchor rides the scroll: it is a page position wearing world clothes.
   */
  anchorScroll: number
  /** Start of the current press — how a tap is told from a drag. */
  downAt: number
  downX: number
  downY: number
  /** Has this card already been parked once? A second tap sends it home. */
  floated: boolean
  /** Live pointer, client px. */
  px: number
  py: number
  /**
   * The hand's own velocity, world px/s on the plane the card is on.
   *
   * `stepHeld`'s damper resists the card's motion RELATIVE to the hand, so
   * it needs this; a damper that does not know the hand is moving models a
   * hand nailed to the floor, and bills the difference to the spring as a
   * permanent speed-proportional lag. It is also the honest throw velocity —
   * the screen-space estimator it replaced had to be converted by hand and
   * had a sign flip in it, and neither of those is a thing you can get wrong
   * twice if the number is already in the right space.
   */
  handVel: THREE.Vector3
  /** Previous frame's target — `handVel` is its derivative. */
  prevTarget: THREE.Vector3
  /** False until `prevTarget` means something. */
  handSeeded: boolean
  /** 0 → 1 as the card leaves the page. */
  lift: number
  /**
   * Is the texture currently pinned at ALTITUDE density? The driver flips
   * this as the plate crosses the lift plane's approach, and `Flying` turns
   * it into a `resolution` change — see the density schedule there.
   */
  hiDensity: boolean
  /** Set by the driver, read by React: the card has landed. */
  done: boolean
}

// ── the card, rendered identically on the page and in the air ─────────────

interface CardBodyProps {
  card: Card
  onChange: (patch: Partial<Card>) => void
  /** Only the page copy starts drags; the airborne one is grabbed in 3D. */
  onGrab?: (e: React.PointerEvent<HTMLDivElement>) => void
  /** The ✕. Both copies get it: a card is deletable wherever it is. */
  onDelete?: () => void
  hidden?: boolean
}

function CardBody({ card, onChange, onGrab, onDelete, hidden }: CardBodyProps) {
  return (
    <div
      className="l14-card"
      data-done={card.done}
      data-card={card.id}
      onPointerDown={onGrab}
      style={hidden ? { visibility: 'hidden' } : undefined}
    >
      <div className="l14-row">
        <h3>{card.title}</h3>
        <span className="l14-tag">{card.tag}</span>
        {onDelete && (
          <button
            className="l14-del"
            data-nodrag
            aria-label="delete card"
            onClick={onDelete}
          >
            ×
          </button>
        )}
      </div>
      <p>{card.body}</p>
      <input
        className="l14-note"
        data-nodrag
        placeholder="note…"
        value={card.note}
        onChange={(e) => onChange({ note: e.target.value })}
      />
      <label className="l14-check" data-nodrag>
        <input
          type="checkbox"
          checked={card.done}
          onChange={(e) => onChange({ done: e.target.checked })}
        />
        done
      </label>
    </div>
  )
}

// ── the airborne copy's material ─────────────────────────────────────────
//
// `material="none"` hands the material slot to us (decisions #33) so the card
// can be UNLIT — a lit standard material would shade the texture and the
// handoff would stop being invisible the moment a light moved. What it does
// add is a gloss band keyed to the plate's own normal: the only cue that the
// thing is tilted, since an unlit quad has no other way to say so.

const CARD_VERT = /* glsl */ `
  // The aero bend: the one thing on this card CSS could never draw. The
  // plate is rigid in the physics; what bends is the SHEET, around the
  // point the fingers pin, by an amount the driver derives from the plate's
  // own velocity (aeroAmplitude — hard zero at rest, so both handoff swaps
  // are geometrically flat by theorem). uAero packs (dir.x, dir.y,
  // amplitude px, reach px); uAeroGrab is the held point in card-local px.
  // The leading half catches more air than the trailing half — a swished
  // card is not a symmetric parabola — and the normal is the ANALYTIC
  // derivative of the same field, so the gloss band sweeps the flex
  // instead of staying painted on.
  uniform vec4 uAero;
  uniform vec2 uAeroGrab;
  uniform vec4 uWad;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vNl;
  varying vec3 vWp;

  // Per-vertex chaos for the crumple. Deterministic in uv (+ the flight's
  // seed), so the wad holds one shape across frames instead of boiling.
  float l14hash(vec2 p2) {
    return fract(sin(dot(p2, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vUv = uv;
    vec3 p = position;
    vec2 dir = uAero.xy;
    float amt = uAero.z;
    float L = max(uAero.w, 1.0);
    float s = dot(p.xy - uAeroGrab, dir);
    float t = clamp(s / L, -1.0, 1.0);
    float lead = max(t, 0.0);
    float bow = t * t + 0.45 * lead * lead;
    // TOWARD the camera (+z). The sign is load-bearing, not aesthetic:
    // bowing away pushed the bent edges BEHIND the shadow plane at
    // z = −0.5 during a fast throw home, and where two surfaces cross, the
    // depth test flips per-pixel — a grainy seam marching along whichever
    // edge led the throw. Bowing toward the viewer keeps every bent
    // fragment strictly in front of the shadow at every altitude (a +z bow
    // in the plate's frame can only RAISE a vertex's world z for any bank
    // < 90°), so the carve (#58) can never fight its own card.
    p.z += amt * bow;
    // n = normalize(−∂z/∂x, −∂z/∂y, 1); ∂z/∂s = amt·(2t + 0.9·lead)/L.
    float dzds = amt * (2.0 * t + 0.9 * lead) / L;
    vec3 nl = normalize(vec3(-dzds * dir, 1.0));

    // ── the crumple: the sheet converges on a wad ──
    //
    // uWad = (crush 0→1, fade, seed, wad radius px). Each vertex has its own
    // noise target — the sheet's footprint contracted to 13% plus a random
    // radial offset inside the wad's ball — and its own PHASE: the hash
    // staggers when each vertex commits, because a real crush is chaotic,
    // not a uniform lerp. The sin(π·lt) term overshoots mid-travel (the
    // sheet bulges and wrinkles before it packs), and dies at both ends so
    // the endpoints are exact: crush 0 is the untouched card (the handoff
    // theorem again), crush 1 is the settled wad. Analytic normals are
    // hopeless on this field — the fragment shader switches to screen-space
    // derivative facets as the crush takes over.
    float crush = uWad.x;
    if (crush > 0.0) {
      float seed = uWad.z;
      float wadR = uWad.w;
      float j = l14hash(uv + seed);
      float lt = smoothstep(0.42 * j, 1.0, crush);
      // Fold coherence: the target field samples the hash on a COARSE uv
      // grid, so neighbouring vertices travel together as chunks — paper
      // folds, it does not shred. (All-per-vertex targets were measured as
      // exactly that: a confetti burst mid-crush, every triangle torn from
      // its neighbours.) A 35% per-vertex remainder puts crease chaos back
      // on top of the folds, and the phase stays per-vertex, so a chunk's
      // vertices crumple INTO their shared destination rather than arriving
      // in lockstep.
      vec2 cell = floor(uv * vec2(6.0, 3.0)) / vec2(6.0, 3.0);
      vec3 cellDir = vec3(
        l14hash(cell + seed + 1.3) - 0.5,
        l14hash(cell + seed + 2.7) - 0.5,
        l14hash(cell + seed + 4.1) - 0.5);
      vec3 vertDir = vec3(
        l14hash(uv + seed + 8.2) - 0.5,
        l14hash(uv + seed + 9.6) - 0.5,
        l14hash(uv + seed + 11.4) - 0.5);
      vec3 dirn = normalize(mix(cellDir, vertDir, 0.35) + vec3(1e-4));
      float rr = (0.35 + 0.65 * l14hash(cell + seed + 6.9)) * wadR;
      vec3 wadP = vec3(p.xy * 0.13, 0.0) + dirn * rr;
      wadP += dirn * (sin(lt * 3.14159265) * 0.35 * wadR);
      p = mix(p, wadP, lt);
    }

    vNl = nl;
    vN = normalize(mat3(modelMatrix) * nl);
    vWp = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const CARD_FRAG = /* glsl */ `
  ${SURFACE_RADIUS_GLSL}
  uniform sampler2D tMap;
  uniform float uGloss;
  uniform float uFlex;
  uniform vec4 uWad;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vNl;
  varying vec3 vWp;
  void main() {
    vec4 c = texture2D(tMap, vUv);
    // A broad highlight from up and to the left, riding the surface normal.
    // At rest the normal is +z, so the term is constant — and it has to be
    // constant ZERO, because a card lying in its slot must be exactly its own
    // pixels, not a shade of them. The bias is therefore the value the band
    // takes at rest, which is L.z raised to the same power: hand-writing it
    // as a literal is how this shipped 4.5% dark, a flat neutral tint that
    // reads as "the texture is slightly transparent" and sends you looking at
    // the blend mode.
    vec3 L = normalize(vec3(-0.45, 0.62, 0.65));
    float s = max(dot(vN, L), 0.0);
    float band = pow(s, 6.0) - pow(L.z, 6.0);
    c.rgb += uGloss * band;
    // The band above rides the WORLD normal — it is the tilt cue, and it is
    // ADDITIVE, which on a white card clips at white: the bend never read
    // through it. This one rides the LOCAL bend normal (vNl — exactly
    // (0,0,1) whenever the sheet is flat, at any plate tilt, so it is a
    // curvature-only signal), and it can only DARKEN: the curled region
    // turning away from the page light shades itself, and darkening is the
    // only direction a white card can show. Multiplicative with a factor
    // ≤ 1, so premultiplied alpha stays valid where the additive term
    // hasn't already spent it.
    vec3 nl = normalize(vNl);
    float sl = max(dot(nl, L), 0.0);
    float flexBand = pow(sl, 6.0) - pow(L.z, 6.0);
    c.rgb *= min(1.0 + uFlex * flexBand, 1.0);
    // ── crumple shading: facets, not fields ──
    //
    // The analytic normals above describe the BEND's smooth field; a wad is
    // the opposite object, all creases and planes. Screen-space derivatives
    // of the world position give the true facet normal of whatever triangle
    // is under the fragment — free, and automatically faceted because the
    // interpolated position is piecewise planar. The band is a broad pow-2
    // (a wad shades everywhere, not just at grazing), multiplicative and
    // floored so the deepest folds go dark grey, never black. And the fade:
    // rgb AND a together, because the texture is premultiplied — fading
    // only alpha would brighten the edges as they go.
    float crush = uWad.x;
    if (crush > 0.003) {
      vec3 fn = normalize(cross(dFdx(vWp), dFdy(vWp)));
      fn *= sign(fn.z + 1e-6);
      float sf = max(dot(fn, L), 0.0);
      float facetBand = pow(sf, 2.0) - pow(L.z, 2.0);
      float k = clamp(crush * 1.6, 0.0, 1.0);
      c.rgb *= clamp(1.0 + 1.1 * k * facetBand, 0.35, 1.0);
    }
    c *= uWad.y;
    // The element's corners, not the quad's. The texture can't say where the
    // card ends — the .ui-root background paints its corners opaque white —
    // so the measured border-radius is enforced analytically (crisp at any
    // LOD tier), and the gloss band dies with the alpha it rides on.
    c.a *= threeUiRadiusMask(vUv);
    if (c.a < 0.004) discard;
    gl_FragColor = c;
    // The texture is SRGBColorSpace, so the sampler above hands this shader
    // LINEAR values — and the renderer presents an sRGB canvas. Built-in
    // materials get this encode appended automatically; a raw ShaderMaterial
    // does not, and shipping without it wrote linear values into an sRGB
    // framebuffer: every AA midtone sank, and the card's text rendered
    // visibly darker and heavier than the same pixels at rest (measured in
    // the texel-vs-screen bisect, 2026-08-02). At rest band is exactly zero,
    // so with the encode the mesh is exactly its own pixels — in color, not
    // just in geometry.
    #include <colorspace_fragment>
  }
`

/**
 * The sheet's shared state: the driver writes these objects every frame and
 * the material's uniforms hold the SAME objects, so there is no per-frame
 * plumbing and no React in the loop. pack = (dir.x, dir.y, amplitude px,
 * reach px); grab = the held point, card-local px; wad = (crush 0→1,
 * fade 1→0, hash seed, wad radius px) — crush 0 / fade 1 is the identity,
 * and a card that is not being deleted never leaves it.
 */
export interface AeroState {
  pack: THREE.Vector4
  grab: THREE.Vector2
  wad: THREE.Vector4
}

function CardMaterial({ gloss = 0.5, aero }: { gloss?: number; aero: AeroState }) {
  const texture = useSurfaceTexture()
  const { chrome, width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: { value: null as THREE.Texture | null },
      uGloss: { value: gloss },
      // Gain on the curvature shade. The bend's normals only swing ~10-15°,
      // so the pow-6 band needs amplification to move a white pixel a
      // readable ~20 counts; the term is identically zero when flat, so
      // this number never touches a resting card.
      uFlex: { value: 2.5 },
      uThreeUiRadii: { value: new THREE.Vector4(0, 0, 0, 0) },
      uThreeUiSize: { value: new THREE.Vector2(1, 1) },
      uAero: { value: aero.pack },
      uAeroGrab: { value: aero.grab },
      uWad: { value: aero.wad },
    }),
    [gloss, aero],
  )
  uniforms.tMap.value = texture ?? null
  const radii = chrome?.radii ?? [0, 0, 0, 0]
  uniforms.uThreeUiRadii.value.set(radii[0], radii[1], radii[2], radii[3])
  uniforms.uThreeUiSize.value.set(width, height)
  return (
    <shaderMaterial
      key={texture?.uuid ?? 'none'}
      uniforms={uniforms}
      vertexShader={CARD_VERT}
      fragmentShader={CARD_FRAG}
      transparent
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  )
}

// ── the shadow the card throws back onto the page ────────────────────────
//
// Not a decal and not a blob: the plate's four corners projected onto z = 0
// along the light direction, so a tilted card throws a genuinely sheared
// quadrilateral. The softness and the weight are functions of how far off the
// page it is, which is the only reason a shadow reads as height at all.
//
// It darkens the PAGE, not the scene — the canvas composites over the
// document with alpha, so a translucent black quad drawn over the prose is
// a shadow falling on real text.
//
// WHAT it renders is not authored here, though: the layers are the card's own
// measured `box-shadow`, parsed by the library (`onChrome`). At height zero
// the shader draws exactly what the browser draws — same offsets, same
// Gaussian (σ = blur/2, via erf, which IS the analytic form of a Gaussian
// blurred edge), same colors compositing first-layer-on-top — so the liftoff
// swap is invisible: the page hides a DOM shadow and this draws its twin.
// Height then EVOLVES those layers (Driver); it no longer invents a look.
//
// No <colorspace_fragment> here, deliberately: this shader samples no
// texture. Its colors are CSS values, already sRGB — written raw into the
// sRGB canvas and alpha-blended there, which is the same space the page
// composites box-shadows in. The encode would double-apply. (The hard rule
// scopes to materials sampling `useSurfaceTexture`, which hand back linear.)

const SHADOW_MAX_LAYERS = 4

const SHADOW_FRAG = /* glsl */ `
  uniform vec2 uQuadHalf;
  uniform vec2 uCardHalf;
  uniform vec4 uRadii;
  uniform int uCount;
  uniform vec2 uOff[${SHADOW_MAX_LAYERS}];
  uniform float uSigma[${SHADOW_MAX_LAYERS}];
  uniform float uSpread[${SHADOW_MAX_LAYERS}];
  uniform vec4 uColor[${SHADOW_MAX_LAYERS}];
  varying vec2 vUv;

  // Abramowitz–Stegun 7.1.26 — plenty for an alpha ramp.
  float erfA(float x) {
    float s = sign(x);
    float a = abs(x);
    float t = 1.0 / (1.0 + 0.3275911 * a);
    float y = 1.0 -
      (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
        0.254829592) * t * exp(-a * a);
    return s * y;
  }

  float layerCoverage(vec2 p, int i) {
    vec2 half_ = uCardHalf + uSpread[i];
    if (half_.x <= 0.0 || half_.y <= 0.0) return 0.0;
    vec2 q = p - uOff[i];
    float r = q.x < 0.0 ? (q.y > 0.0 ? uRadii.x : uRadii.w)
                        : (q.y > 0.0 ? uRadii.y : uRadii.z);
    r = clamp(r + uSpread[i], 0.0, min(half_.x, half_.y));
    vec2 d = abs(q) - half_ + vec2(r);
    float sd = min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
    // Gaussian-blurred edge: coverage is the CDF of the blur at the signed
    // distance. σ near zero degenerates to a step — the '0px 1px 0px' hairline
    // layer renders as the same hairline the DOM paints.
    return 0.5 - 0.5 * erfA(sd / (uSigma[i] * 1.4142135 + 1e-4));
  }

  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * uQuadHalf;
    vec4 acc = vec4(0.0);
    // CSS paints the FIRST layer on top: composite back-to-front.
    for (int i = ${SHADOW_MAX_LAYERS - 1}; i >= 0; i--) {
      if (i >= uCount) continue;
      float a = layerCoverage(p, i) * uColor[i].a;
      acc.rgb = uColor[i].rgb * a + acc.rgb * (1.0 - a);
      acc.a = a + acc.a * (1.0 - a);
    }
    if (acc.a <= 0.002) discard;
    gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
  }
`

const SHADOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const LIGHT = new THREE.Vector3(-0.30, -0.46, -1).normalize()

// ── the driver ───────────────────────────────────────────────────────────

interface DriverProps {
  flight: React.RefObject<Flight | null>
  slotRect: (id: string) => DOMRect | null
  /** The page's scroll offset — a floating card's anchor rides it. */
  scrollTop: () => number
  onLanded: () => void
  /**
   * The card's pose is carried by a GROUP wrapping the Surface, not by the
   * Surface's own mesh. `Surface` spreads the caller's mesh props BEFORE
   * installing its own `ref`, so a `ref` passed down through `SurfaceApp`
   * would overwrite the one Surface uses internally to drive its texture.
   * A wrapper group costs a matrix and cannot collide with anything.
   */
  cardRef: React.RefObject<THREE.Group | null>
  shadowRef: React.RefObject<THREE.Mesh | null>
  /** The texture's CURRENT pin, texels per CSS px — the density schedule's live value. */
  density: number
  /** Flip the schedule: true as the plate climbs through the approach, false for home. */
  onAltitude: (hi: boolean) => void
  /** The card's measured chrome — the shadow's h = 0 truth (see the shader). */
  chromeRef: React.RefObject<SurfaceChrome | null>
  /** The bend field's shared uniforms — driver writes, CardMaterial holds. */
  aero: AeroState
  /** The crumple finished: commit the delete and tear the flight down. */
  onCrumpled: () => void
}

const FLAT = new THREE.Quaternion()
const _target = new THREE.Vector3()
const _corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
]
const _centroid = new THREE.Vector3()
const _proj: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
]
const _frame = makeShadowFrame()
const _spinQ = new THREE.Quaternion()
const _spinAxis = new THREE.Vector3()

/**
 * One time constant of smoothing on the hand's velocity. Pointer samples do
 * not arrive one per frame — they come in bursts, and some frames get none —
 * so the raw frame-to-frame difference is a staircase whose derivative is
 * spikes. It is not free: the estimate lags the hand by one time constant,
 * the damper is told the hand is slower than it is, and the spring pays the
 * difference — `kd·τ·a / ks` on top of the honest `m·a / ks`. At 41 and 45 ms
 * that surcharge was nearly TWICE the real compliance, so this number is not
 * a smoothing preference, it is most of the tracking error. Short enough that
 * the surcharge is a third of the honest term; long enough that the ripple
 * from a mouse polling slower than the display cannot reach the card.
 */
const HAND_TAU = 0.022
const _handRaw = new THREE.Vector3()

function trackHand(f: Flight, dt: number, target: THREE.Vector3) {
  if (!f.handSeeded) {
    f.handSeeded = true
    f.prevTarget.copy(target)
    f.handVel.set(0, 0, 0)
    return
  }
  _handRaw.copy(target).sub(f.prevTarget).divideScalar(Math.max(dt, 1e-4))
  f.handVel.lerp(_handRaw, 1 - Math.exp(-dt / HAND_TAU))
  f.prevTarget.copy(target)
}

function Driver({
  flight,
  slotRect,
  scrollTop,
  onLanded,
  cardRef,
  shadowRef,
  density,
  onAltitude,
  chromeRef,
  aero,
  onCrumpled,
}: DriverProps) {
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  const dpr = useThree((s) => s.viewport.dpr)
  // The bend's smoothed state. A ref, not module scratch: it must start at
  // zero for EVERY flight, and Driver mounts once per flight.
  const aeroSm = useRef({ amt: 0, dir: new THREE.Vector2(1, 0) })

  useFrame((_, rawDt) => {
    const f = flight.current
    const group = cardRef.current
    if (!f || !group) return
    // A tab that was backgrounded hands back a dt measured in seconds; a
    // stiff spring integrated over one of those explodes. Clamp, don't trust.
    const dt = Math.min(rawDt, 1 / 30)

    const vw = size.width
    const vh = size.height
    const camZ = camera.position.z

    // The crumple's live scalars — identity for every other mode, so the
    // shader and the shadow below never need to know which mode this is.
    let crush = 0
    let wadFade = 1

    if (f.mode === 'held') {
      f.lift = Math.min(1, f.lift + dt / LIFT_T)
      // easeOutCubic — a hand accelerates the card away from the page and
      // then stops; a linear rise reads as a lift dialog, not a lift.
      const e = 1 - Math.pow(1 - f.lift, 3)
      // The hand is wherever the cursor's RAY meets the plane the card is
      // currently on — NOT the z = 0 mapping. One world unit is one CSS pixel
      // on exactly one plane, and a lifted card is not on it. Reading the
      // cursor as if it were cost an 8% gain: the card outran the hand,
      // drifting out from under the pointer toward the edges of the screen
      // and back toward the middle, which is what "fighting the drag" was.
      // decisions #4 has always said intersect the ray with the DRAG plane;
      // this is that rule, on the plane that is actually being dragged on.
      screenToPlane(f.px, f.py, vw, vh, camZ, LIFT_Z * e, _target)
      trackHand(f, dt, _target)
      stepHeld(f.plate, dt, _target, f.hold, FLAT, f.handVel)
    } else if (f.mode === 'float') {
      // Identical machinery, with the hand replaced by a fixed point in the
      // air. The card settles flat and stays there — and because it is still
      // the held solver, grabbing it again is a change of one target vector.
      // Scrolling the page down moves content up the screen, and world y is
      // up, so the anchor moves the same way by the same amount.
      _target.copy(f.anchor)
      _target.y += scrollTop() - f.anchorScroll
      trackHand(f, dt, _target)
      stepHeld(f.plate, dt, _target, f.hold, FLAT, f.handVel)
    } else if (f.mode === 'crumple') {
      // The delete has one clock; everything — when the sheet crushes, when
      // gravity arrives, when the wad fades — is crumplePhase(t) of it.
      f.crumpleT += dt
      const ph = crumplePhase(f.crumpleT)
      crush = ph.crush
      wadFade = ph.fade
      if (f.crumpleT <= CRUMPLE_RISE_T) {
        // Phase one is the HANDOFF window wearing a gesture's clothes: the
        // plate springs gently off the page (the same free solver as a
        // throw home, aimed up instead of down) while the page copy hides
        // on first upload. The crush may not begin until the sheet is fully
        // matter — crumplePhase holds crush at exactly 0 through this
        // window, so the swap keeps its pixel-copy guarantee.
        _target.set(f.plate.p.x, f.plate.p.y, CRUMPLE_Z)
        stepFree(f.plate, dt, _target, FLAT)
      } else {
        // Ballistic. The wad keeps whatever momentum the flight had, drag
        // bleeds it, gravity takes over only once the sheet IS a wad (a
        // flat card dropping like a stone reads as a glitch, so
        // crumplePhase withholds `falling` until the crush completes), and
        // the tumble is the seeded axis — no aerodynamics, just enough
        // spin that the wad reads as a thing and not a sprite.
        const drag = Math.exp(-dt / 0.9)
        f.plate.v.multiplyScalar(drag)
        if (ph.falling) f.plate.v.y -= 3400 * dt
        f.plate.p.addScaledVector(f.plate.v, dt)
        const rate = f.spin.length()
        if (rate > 1e-6) {
          _spinAxis.copy(f.spin).multiplyScalar(1 / rate)
          _spinQ.setFromAxisAngle(_spinAxis, rate * dt)
          f.plate.q.premultiply(_spinQ)
        }
      }
      if (ph.done && !f.done) {
        f.done = true
        onCrumpled()
      }
    } else {
      const r = slotRect(f.id)
      if (r) _target.set(r.left + r.width / 2 - vw / 2, vh / 2 - (r.top + r.height / 2), 0)
      else _target.set(f.plate.p.x, f.plate.p.y, 0)
      stepFree(f.plate, dt, _target, FLAT)
      if (!f.done && atRest(f.plate, _target)) {
        f.done = true
        onLanded()
      }
    }

    // ── the density schedule ──
    //
    // Page density on the page, altitude density at altitude, toggled where
    // the plate actually is — not where a mode flag says it should be (a
    // regrabbed float is `held` with `lift` long finished; the plate's z is
    // the only honest witness). Hysteresis so a card bobbing on its spring
    // near the boundary cannot flap the pin. Descent flips low immediately
    // (`home` at any height): the fall is the motion mask for the re-raster,
    // and what matters is arriving at the page 1 : 1.
    // A crumpling card FREEZES the pin wherever it was: flipping it would
    // spend a full re-raster (and a texture swap) on a sheet that is about
    // to stop being a card — and a delete that starts at altitude would
    // otherwise flip low immediately, mid-crush.
    const hi =
      f.mode === 'crumple'
        ? f.hiDensity
        : f.mode !== 'home' && f.plate.p.z > LIFT_Z * (f.hiDensity ? 0.5 : 0.65)
    if (hi !== f.hiDensity) {
      f.hiDensity = hi
      onAltitude(hi)
    }

    // ── the presented pose: physics truth, then the pixel-grid settle ──
    //
    // At rest the card must be indistinguishable from resting DOM, and rest
    // is the only time anyone can stare: even at exactly 1 : 1 density, a
    // texture whose corner sits at a fractional screen position is resampled
    // by bilinear at that fraction — every glyph edge smeared across two
    // device pixels, the fattened-fuzzy look the bisect shots measured. So
    // when the plate is still (and only then), the PRESENTATION quantizes:
    // projected footprint to exactly the texture's texel count, projected
    // top-left corner to an integer device pixel, residual tilt to flat.
    // The physics never hears about it — same truth/presentation split as
    // the grounded damper (#49) — and the blend runs on plate speed, so a
    // moving card is pure truth and nothing pops in between.
    group.position.copy(f.plate.p)
    group.quaternion.copy(f.plate.q)
    group.scale.set(1, 1, 1)

    const mag = planeScale(camZ, f.plate.p.z)
    const supply = density / dpr
    // Only meaningful where the texture can be 1 : 1 at all — the pin and
    // the plane must agree (they diverge mid-rise and mid-descent, where
    // speed keeps the blend at zero anyway; the gate is for the edges).
    // Never for a crumple: the settle exists to make a RESTING CARD
    // pixel-identical to DOM, and a wad slowing to rest mid-air would be
    // quantized flat — slerped toward FLAT mid-tumble, visibly yanked.
    if (f.mode !== 'crumple' && Math.abs(mag - supply) < supply * 0.02) {
      const edge = Math.hypot(f.w, f.h) / 2
      const speed = f.plate.v.length() + f.plate.w.length() * edge
      const settle = 1 - Math.min(1, Math.max(0, (speed - 2) / 28))
      if (settle > 0) {
        const tw = Math.round(f.w * density)
        const th = Math.round(f.h * density)
        // Footprint: exactly tw × th device px (a 0.07% size lie at most —
        // without it the phase drifts across the card even when the corner
        // is pinned, because 514 · 1.114 is not an integer).
        const sx = tw / (f.w * mag * dpr)
        const sy = th / (f.h * mag * dpr)
        // Corner: the top-left of that footprint, in device px, onto the
        // integer grid. World y is up and screen y is down — mind the sign.
        const tlx = (vw / 2 + f.plate.p.x * mag) * dpr - tw / 2
        const tly = (vh / 2 - f.plate.p.y * mag) * dpr - th / 2
        const dx = (Math.round(tlx) - tlx) / (dpr * mag)
        const dy = (Math.round(tly) - tly) / (dpr * mag)
        group.position.x += settle * dx
        group.position.y -= settle * dy
        group.quaternion.slerp(FLAT, settle)
        group.scale.set(1 + settle * (sx - 1), 1 + settle * (sy - 1), 1)
      }
    }

    // ── the aero bend: the sheet reads the plate's own velocity ──
    //
    // Direction smooths with a fast time constant and only updates while
    // there is real motion (a near-zero velocity has no direction worth
    // following); amplitude chases aeroAmplitude's saturating curve, rising
    // faster than it falls — paper snaps against the air and relaxes out of
    // it. The curve's hard zero below 30 px/s makes "flat at rest" a
    // property of the field, not of how far some decay happened to get:
    // by the time the settle blend can engage (speed < ~30), the target is
    // exactly 0 and the residue is milli-pixels on its way down.
    {
      const sm = aeroSm.current
      const vx = f.plate.v.x
      const vy = f.plate.v.y
      const speed = Math.hypot(vx, vy)
      if (speed > 40) {
        const k = 1 - Math.exp(-dt / 0.05)
        sm.dir.x += (vx / speed - sm.dir.x) * k
        sm.dir.y += (vy / speed - sm.dir.y) * k
        sm.dir.normalize()
      }
      const target = aeroAmplitude(speed)
      const tau = target > sm.amt ? 0.06 : 0.12
      sm.amt += (target - sm.amt) * (1 - Math.exp(-dt / tau))
      const reach = aeroReach(sm.dir.x, sm.dir.y, f.w, f.h, f.hold.x, f.hold.y)
      // Rendered amplitude = smoothed · gate. The smoother gives continuity;
      // the gate gives the theorem — exactly 0 through the settle band, so
      // the swap frame is flat even when the descent outruns the decay
      // (measured: 0.45 px still aboard at touchdown without this).
      aero.pack.set(sm.dir.x, sm.dir.y, sm.amt * aeroGate(speed), reach)
      aero.grab.set(f.hold.x, f.hold.y)
      // The crumple's channels. x/y are the driver's per-frame verdict;
      // z (seed) and w (wad radius) belong to Flying and are written once.
      aero.wad.x = crush
      aero.wad.y = wadFade
    }

    // ── the shadow, from the plate's own corners ──
    //
    // A crumpling sheet no longer spans the plate, so the corners are
    // computed from SHRUNKEN dimensions (wadShrink: identity at crush 0,
    // a sixth at full crush) — the shadow contracts with the thing that
    // casts it, then rides `wadFade` out with the falling wad.
    const sh = shadowRef.current
    if (!sh) return
    const shrink = wadShrink(crush)
    corners(f.plate, f.w * shrink, f.h * shrink, _corners)
    _centroid.set(0, 0, 0)
    for (const c of _corners) _centroid.add(c)
    _centroid.multiplyScalar(0.25)

    const height = Math.max(_centroid.z, 0)

    // The measured layers are the h = 0 truth; height only EVOLVES them.
    // Every factor below is exactly 1 at h = 0, so the liftoff frame draws
    // the DOM's own shadow — same offsets, blurs, colors — and the swap has
    // nothing to pop. Rising: blur grows (the page is farther from the
    // caster), weight fades (more sky reaches around the card), and any
    // authored spread — usually negative, the tight contact hug — relaxes
    // toward zero. A card whose DOM casts nothing casts nothing here either.
    const chrome = chromeRef.current
    const layers = chrome?.shadow ?? []
    const n = Math.min(layers.length, SHADOW_MAX_LAYERS)
    const mat = sh.material as THREE.ShaderMaterial
    const uOff = mat.uniforms.uOff.value as THREE.Vector2[]
    const uSigma = mat.uniforms.uSigma.value as number[]
    const uSpread = mat.uniforms.uSpread.value as number[]
    const uColor = mat.uniforms.uColor.value as THREE.Vector4[]
    const grow = 0.17 * height
    const fade = 1 / (1 + height / 210)
    const relax = 1 / (1 + height / 140)
    let reach = 8
    for (let i = 0; i < n; i++) {
      const l = layers[i]
      const sigma = l.blur / 2 + grow
      const spread = l.spread * relax
      uOff[i].set(l.x, -l.y) // CSS y is down, world y is up
      uSigma[i] = sigma
      uSpread[i] = spread
      uColor[i].set(l.color[0], l.color[1], l.color[2], l.color[3] * fade * wadFade)
      reach = Math.max(reach, Math.hypot(l.x, l.y) + 3 * sigma + Math.max(spread, 0))
    }
    mat.uniforms.uCount.value = n
    const radii = chrome?.radii
    ;(mat.uniforms.uRadii.value as THREE.Vector4).set(
      radii?.[0] ?? 0,
      radii?.[1] ?? 0,
      radii?.[2] ?? 0,
      radii?.[3] ?? 0,
    )
    const margin = reach

    // Project the plate's corners onto the page along the light, then let
    // `shadowQuadFrame` rebuild the quad with the margin added along the
    // footprint's own axes. The frame's halves go to the shader VERBATIM —
    // the p-space metric and the world metric are the same numbers, which is
    // the whole fix: the old radial corner-push under-delivered the margin
    // vertically (≈0.29× on a wide card) while the uniforms claimed all of
    // it, so every below-card pixel sampled the shadow 2–3σ too far out and
    // the at-rest fringe rendered entirely underneath the card.
    for (let i = 0; i < 4; i++) {
      const c = _corners[i]
      const t = -c.z / LIGHT.z
      _proj[i].set(c.x + LIGHT.x * t, c.y + LIGHT.y * t, 0)
    }
    shadowQuadFrame(_proj, margin, _frame)

    const pos = sh.geometry.getAttribute('position') as THREE.BufferAttribute
    // The frame's verts are already in PlaneGeometry vertex order (TL, TR,
    // BL, BR) — `shadowQuadFrame` did the reorder from `corners` order so
    // the bow-tie mistake has exactly one place to not happen.
    //
    // z = −0.5: strictly BEHIND the card at every altitude, including h = 0.
    // The card renders first and writes depth, so the depth test deletes the
    // shadow wherever the card touched a pixel — which is exactly CSS's rule
    // that box-shadow paints only outside the border box. At +0.5 the plane
    // sat in FRONT of a resting card, the order put the card's blend on top,
    // and the shadow's interior (hairline α .04 + fringe) showed through the
    // border's AA column as a dark seam line.
    for (let i = 0; i < 4; i++) {
      pos.setXYZ(i, _frame.verts[i].x, _frame.verts[i].y, -0.5)
    }
    pos.needsUpdate = true
    sh.geometry.computeBoundingSphere()

    ;(mat.uniforms.uQuadHalf.value as THREE.Vector2).copy(_frame.quadHalf)
    ;(mat.uniforms.uCardHalf.value as THREE.Vector2).copy(_frame.cardHalf)
  })

  return null
}

// ── the airborne card ────────────────────────────────────────────────────

interface FlyingProps {
  card: Card
  flight: React.RefObject<Flight | null>
  onChange: (patch: Partial<Card>) => void
  onRegrab: (localX: number, localY: number, clientX: number, clientY: number) => void
  slotRect: (id: string) => DOMRect | null
  scrollTop: () => number
  onLanded: () => void
  /** The Surface's first real upload landed — fired by the library, not a frame count. */
  onPainted: () => void
  /** Board's `painted` state, reflected back down: gates the page-copy hide AND the shadow. */
  painted: boolean
  /**
   * Board-owned altitude state, reflected back down like `painted`. The
   * driver's density schedule writes it (via `onAltitude`) and TWO consumers
   * read it: the texture pin here, and the vacated slot's outline on the
   * page — which must fade while the card is still in the air, because the
   * swap instant is exactly when nothing may change (see the slot CSS).
   */
  atAltitude: boolean
  onAltitude: (hi: boolean) => void
  /** The airborne card's ✕ — a card is deletable mid-flight. */
  onDelete: () => void
  /** The wad faded out: commit the delete. */
  onCrumpled: () => void
}

function Flying({ card, flight, onChange, onRegrab, slotRect, scrollTop, onLanded, onPainted, painted, atAltitude, onAltitude, onDelete, onCrumpled }: FlyingProps) {
  const f = flight.current!
  const cardRef = useRef<THREE.Group>(null)
  const shadowRef = useRef<THREE.Mesh>(null)
  const grabbed = useRef<(() => void) | null>(null)
  const viewH = useThree((s) => s.size.height)
  const dpr = useThree((s) => s.viewport.dpr)

  // The card must be indistinguishable from the resting DOM it replaces —
  // and it lives on TWO planes, so it needs two densities, not one.
  //
  // On the page (z ≈ 0) a CSS pixel is a device pixel × dpr, full stop. At
  // altitude the card sits on the lift plane, magnified by exactly
  // planeScale(camZ, LIFT_Z), so the same content needs that many more
  // texels to stay 1 : 1 with the display. Pinning the ALTITUDE density for
  // the whole flight was measured to be the grab-moment blur itself: the
  // texture is born 11% too dense for the page, and the #46 hard cut swaps
  // crisp DOM for that texture minified into the resting rect — mush, one
  // frame after perfect, precisely when the eye is looking at it.
  //
  // So the pin follows the card: born at page density (the handoff frame is
  // a pixel-for-pixel copy of the DOM it replaces), re-pinned to altitude
  // density as the plate climbs through the approach (the swap re-rasters in
  // place, hidden by the rise), and back to page density on the way home so
  // the landing swap is a pixel copy too. The driver owns the toggle — it is
  // the only thing that watches z every frame.
  const airborneDensity = dpr * planeScale(cameraDistance(viewH, FOV), LIFT_Z)
  const density = atAltitude ? airborneDensity : dpr

  // Scene hook (the __lab005 convention): the flight ref and the card's
  // transform group, alive exactly while a card is airborne.
  useEffect(() => {
    const w = window as unknown as { __lab014?: unknown }
    w.__lab014 = { flight, cardRef }
    return () => {
      delete w.__lab014
    }
  }, [flight])

  // Re-grabbing an airborne card cannot go through an r3f handler: `Surface`
  // installs its own `onPointerDown` AFTER spreading the caller's mesh props,
  // so ours would simply be discarded. It comes through the DOM instead —
  // which is better anyway, because then the `[data-nodrag]` test that
  // protects the note field is the same one the page copy uses, and the hit
  // has already been resolved against the real subtree rather than against a
  // rectangle. The host is `position: fixed` at page (0, 0) (decisions #16),
  // so an offset within its rect IS the body-local point.
  const onHost = useCallback(
    (el: HTMLElement | null) => {
      grabbed.current?.()
      grabbed.current = null
      if (!el) return
      const down = (ev: PointerEvent) => {
        if ((ev.target as Element).closest('[data-nodrag]')) return
        const r = el.getBoundingClientRect()
        onRegrab(
          ev.clientX - r.left - f.w / 2,
          -(ev.clientY - r.top - f.h / 2),
          ev.clientX,
          ev.clientY,
        )
      }
      el.addEventListener('pointerdown', down)
      grabbed.current = () => el.removeEventListener('pointerdown', down)
    },
    [onRegrab, f.w, f.h],
  )
  useEffect(() => () => grabbed.current?.(), [])

  const shadowUniforms = useMemo(
    () => ({
      uQuadHalf: { value: new THREE.Vector2(1, 1) },
      uCardHalf: { value: new THREE.Vector2(1, 1) },
      uRadii: { value: new THREE.Vector4(0, 0, 0, 0) },
      uCount: { value: 0 },
      uOff: { value: Array.from({ length: SHADOW_MAX_LAYERS }, () => new THREE.Vector2()) },
      uSigma: { value: new Array(SHADOW_MAX_LAYERS).fill(0) },
      uSpread: { value: new Array(SHADOW_MAX_LAYERS).fill(0) },
      uColor: { value: Array.from({ length: SHADOW_MAX_LAYERS }, () => new THREE.Vector4()) },
    }),
    [],
  )

  // The card's measured chrome — radii and box-shadow layers — captured on
  // its first paint and re-measured only when a paint changes it. A ref, not
  // state: the only consumer is the Driver's per-frame uniform write.
  const chromeRef = useRef<SurfaceChrome | null>(null)

  // The sheet field's shared objects: Driver mutates them in place, the
  // material's uniforms hold the very same references. Amplitude starts at
  // 0 — a card is born flat — and the wad channel is born at its identity
  // (crush 0, fade 1) with a per-flight hash seed, so every delete crushes
  // along different creases, and a wad radius from the card's own smaller
  // dimension.
  const aero = useMemo<AeroState>(
    () => ({
      pack: new THREE.Vector4(1, 0, 0, 1),
      grab: new THREE.Vector2(),
      wad: new THREE.Vector4(0, 1, Math.random() * 10, Math.min(f.w, f.h) * 0.3),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <>
      <Driver
        flight={flight}
        slotRect={slotRect}
        scrollTop={scrollTop}
        onLanded={onLanded}
        cardRef={cardRef}
        shadowRef={shadowRef}
        density={density}
        onAltitude={onAltitude}
        chromeRef={chromeRef}
        aero={aero}
        onCrumpled={onCrumpled}
      />

      {/* The shadow may not exist before the card does. On the first r3f
          frame the source hasn't painted, the quad draws nothing — and a
          shadow drawn anyway is a card-shaped 30% veil stamped over the
          still-visible page copy for exactly one frame (measured: rgba
          4/4/3/76 at the card centre, paints 0). Pete saw it as a black
          flicker at every grab. Gate on the same first-upload signal that
          hides the page copy: card first, then its shadow.

          renderOrder 2 — AFTER the card, on purpose. The card writes depth
          (matter occludes its own shadow), so drawing the shadow second lets
          the depth test carve the card's silhouette out of it per fragment:
          CSS's outside-the-border-box clip, enforced by geometry. Drawn
          first, the shadow's interior survived under the card and leaked
          through the border's AA column as a 1px dark seam — the "extra
          border" on the right edge. The corners still show fringe: the
          radius mask DISCARDS there, no depth is written, and the shadow
          paints the notch exactly where CSS would. */}
      <mesh ref={shadowRef} renderOrder={2} frustumCulled={false} visible={painted}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          uniforms={shadowUniforms}
          vertexShader={SHADOW_VERT}
          fragmentShader={SHADOW_FRAG}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <group ref={cardRef}>
        <SurfaceApp
          label={`lab014-${card.id}`}
          width={f.w}
          height={f.h}
          resolution={density}
          material="none"
          renderOrder={1}
          frustumCulled={false}
          userData={{ matter: true }}
          onHost={onHost}
          // The handoff's readiness signal. Counting r3f frames here was a
          // race dressed as a constant: three frames USUALLY covers "second
          // root committed, compositor painted, texture uploaded" — until
          // load makes it four, the page copy hides early, and the slot
          // flashes through where the card should be. Only the upload path
          // knows the true moment, so only it gets to say.
          onFirstUpload={onPainted}
          onChrome={(c) => {
            chromeRef.current = c
          }}
          content={<CardBody card={card} onChange={onChange} onDelete={onDelete} />}
        >
          {/* Segments are the bend's resolution: 32×12 puts a vertex every
              ~16 px on a 514-wide card, enough for the parabolic bow to
              read as a curve rather than a crease. A flat card renders
              identically at any tessellation. */}
          <planeGeometry args={[f.w, f.h, 32, 12]} />
          <CardMaterial aero={aero} />
        </SurfaceApp>
      </group>
    </>
  )
}

// ── camera calibration ───────────────────────────────────────────────────

const FOV = 42

function PixelPerfect() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useLayoutEffect(() => {
    // The whole lab rests on this one line: put the camera exactly far
    // enough back that the frustum is the viewport at z = 0. Everything
    // downstream — rects as poses, texels as pixels, "1 CSS px" as a world
    // unit — is a consequence of it and nothing else has to know.
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height])
  return null
}

/**
 * The canvas is `pointer-events: none` until the pointer is genuinely over a
 * piece of matter, then `auto`, then none again. Without it an overlay eats
 * the page: no text selection, no links, no scrolling.
 */
function SolidWhereMatterIs({ active }: { active: boolean }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)

  useEffect(() => {
    const el = gl.domElement
    if (!active) {
      el.style.pointerEvents = 'none'
      return
    }
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const test = (e: PointerEvent) => {
      // Same rule as the gesture handlers (lab014Gestures.ts): this asks
      // "is the HAND over matter", and the surface protocol's retold events
      // — parked-local coordinates, the (−16,−16) departure burst — bubble to
      // window too. Ray-testing one of those would toggle the canvas off
      // while the real cursor is still over the card.
      if (!e.isTrusted) return
      ndc.set((e.clientX / size.width) * 2 - 1, -(e.clientY / size.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObjects(scene.children, true).some((h) => h.object.userData.matter)
      el.style.pointerEvents = hit ? 'auto' : 'none'
    }
    window.addEventListener('pointermove', test, true)
    return () => {
      window.removeEventListener('pointermove', test, true)
      el.style.pointerEvents = 'none'
    }
  }, [gl, camera, scene, size.width, size.height, active])

  return null
}

// ── FLIP, so the reflow is something you can watch ───────────────────────

function captureRects(root: HTMLElement) {
  const out = new Map<Element, DOMRect>()
  root.querySelectorAll('.l14-slot').forEach((el) => out.set(el, el.getBoundingClientRect()))
  return out
}

/**
 * Play the difference. These are page elements, not Surface content, so
 * transforms are perfectly ordinary here — the compositor rule this project
 * lives under only ever applied to a subtree being rasterized.
 */
function playFlip(root: HTMLElement, before: Map<Element, DOMRect>) {
  root.querySelectorAll('.l14-slot').forEach((el) => {
    const b = before.get(el)
    if (!b) return
    const a = el.getBoundingClientRect()
    const dx = b.left - a.left
    const dy = b.top - a.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 230, easing: 'cubic-bezier(.22,.61,.36,1)' },
    )
  })
}

// ── the lab ──────────────────────────────────────────────────────────────

export function Lab014App({ chips }: { chips?: React.ReactNode }) {
  const [cards, setCards] = useState<Record<string, Card>>(
    () => Object.fromEntries(SEED.map((c) => [c.id, c])) as Record<string, Card>,
  )
  const [board, setBoard] = useState<Record<ColId, string[]>>(() => ({ ...START }))
  const [flyingId, setFlyingId] = useState<string | null>(null)
  const [painted, setPainted] = useState(false)
  // The density schedule's altitude verdict, lifted here because the vacated
  // slot's outline keys on it too: the outline may only be lit while the
  // card is safely away, and must fade on the DESCENT — the swap instant is
  // exactly when nothing on the page is allowed to change.
  const [atAltitude, setAtAltitude] = useState(false)

  const flight = useRef<Flight | null>(null)
  const slots = useRef(new Map<string, HTMLLIElement>())
  const boardEl = useRef<HTMLDivElement>(null)

  const scroller = useRef<HTMLDivElement>(null)

  const slotRect = useCallback((id: string) => {
    const el = slots.current.get(id)
    return el ? el.getBoundingClientRect() : null
  }, [])

  const scrollTop = useCallback(() => scroller.current?.scrollTop ?? 0, [])

  const patch = useCallback((id: string, p: Partial<Card>) => {
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))
  }, [])

  // Where would a drop at (x, y) land? The gap the card would leave is
  // already in the list — it is the card's own slot, still holding its full
  // height because the page copy is only hidden, not removed. So this is a
  // plain "which slot is the pointer nearest the top half of".
  const dropTarget = useCallback(
    (x: number, y: number, id: string): { col: ColId; index: number } | null => {
      for (const { id: col } of COLS) {
        const list = board[col]
        const ul = boardEl.current?.querySelector(`[data-col="${col}"] ul`)
        if (!ul) continue
        const r = ul.getBoundingClientRect()
        if (x < r.left - 24 || x > r.right + 24) continue
        let index = list.length
        for (let i = 0; i < list.length; i++) {
          const sr = slotRect(list[i])
          if (sr && y < sr.top + sr.height / 2) {
            index = i
            break
          }
        }
        // Removing the card from its own column shifts everything after it.
        const from = list.indexOf(id)
        if (from >= 0 && index > from) index--
        return { col, index }
      }
      return null
    },
    [board, slotRect],
  )

  const moveTo = useCallback(
    (col: ColId, index: number, id: string) => {
      setBoard((prev) => {
        const cur = (Object.keys(prev) as ColId[]).find((c) => prev[c].includes(id))!
        if (cur === col && prev[cur].indexOf(id) === index) return prev
        const next = { queue: [...prev.queue], today: [...prev.today] }
        next[cur].splice(next[cur].indexOf(id), 1)
        next[col].splice(index, 0, id)
        return next
      })
    },
    [],
  )

  // FLIP: snapshot before every commit that can move a slot, play after.
  const pending = useRef<Map<Element, DOMRect> | null>(null)
  const snapshot = useCallback(() => {
    if (boardEl.current) pending.current = captureRects(boardEl.current)
  }, [])
  useLayoutEffect(() => {
    if (pending.current && boardEl.current) playFlip(boardEl.current, pending.current)
    pending.current = null
  }, [board])

  // ── the gesture ──
  const beginDrag = useCallback(
    (id: string, e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as Element).closest('[data-nodrag]')) return
      if (flight.current) return
      const el = (e.currentTarget as HTMLElement).getBoundingClientRect()
      e.preventDefault()

      const plate = makePlate(el.width, el.height)
      plate.p.set(
        el.left + el.width / 2 - window.innerWidth / 2,
        window.innerHeight / 2 - (el.top + el.height / 2),
        0,
      )
      flight.current = {
        id,
        w: el.width,
        h: el.height,
        hold: new THREE.Vector3(
          e.clientX - (el.left + el.width / 2),
          el.top + el.height / 2 - e.clientY,
          0,
        ),
        plate,
        mode: 'held',
        crumpleT: 0,
        spin: new THREE.Vector3(),
        anchor: new THREE.Vector3(),
        anchorScroll: 0,
        downAt: performance.now(),
        downX: e.clientX,
        downY: e.clientY,
        floated: false,
        hiDensity: false,
        px: e.clientX,
        py: e.clientY,
        handVel: new THREE.Vector3(),
        prevTarget: new THREE.Vector3(),
        handSeeded: false,
        lift: 0,
        done: false,
      }
      setPainted(false)
      setAtAltitude(false)
      setFlyingId(id)
    },
    [],
  )

  // ── the delete ──
  //
  // One entry for both worlds. A card already in flight crumples from its
  // current pose — momentum and all, so a held card deleted mid-gesture
  // tumbles away with the hand's own velocity. A card at rest on the page
  // becomes matter first: the same flight machinery as a grab (page copy
  // hides on first upload, plate springs off the page), except the mode is
  // `crumple` from birth and there is no hand to follow.
  const deleteCard = useCallback((id: string) => {
    const f = flight.current
    if (f) {
      // One flight at a time — and a crumple, once started, is not restarted.
      if (f.id !== id || f.mode === 'crumple') return
      f.mode = 'crumple'
      f.crumpleT = 0
      f.done = false
      f.spin.set(
        (Math.random() - 0.5) * 2.0,
        (Math.random() - 0.5) * 2.0,
        (Math.random() - 0.5) * 5.0,
      )
      return
    }
    const el = slots.current.get(id)?.querySelector<HTMLElement>('.l14-card')
    if (!el) return
    const r = el.getBoundingClientRect()
    const plate = makePlate(r.width, r.height)
    plate.p.set(
      r.left + r.width / 2 - window.innerWidth / 2,
      window.innerHeight / 2 - (r.top + r.height / 2),
      0,
    )
    flight.current = {
      id,
      w: r.width,
      h: r.height,
      hold: new THREE.Vector3(),
      plate,
      mode: 'crumple',
      crumpleT: 0,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 2.0,
        (Math.random() - 0.5) * 2.0,
        (Math.random() - 0.5) * 5.0,
      ),
      anchor: new THREE.Vector3(),
      anchorScroll: 0,
      downAt: performance.now(),
      downX: 0,
      downY: 0,
      floated: false,
      hiDensity: false,
      px: 0,
      py: 0,
      handVel: new THREE.Vector3(),
      prevTarget: new THREE.Vector3(),
      handSeeded: false,
      lift: 0,
      done: false,
    }
    setPainted(false)
    setAtAltitude(false)
    setFlyingId(id)
  }, [])

  const regrab = useCallback((localX: number, localY: number, cx: number, cy: number) => {
    const f = flight.current
    if (!f) return
    if (f.mode === 'crumple') return
    f.hold.set(localX, localY, 0)
    f.mode = 'held'
    f.lift = Math.max(f.lift, 0.35)
    f.done = false
    f.px = cx
    f.py = cy
    // The target jumps from the float anchor to wherever the ray now lands;
    // differentiating across that would read as a flick nobody performed.
    f.handSeeded = false
    f.downAt = performance.now()
    f.downX = cx
    f.downY = cy
  }, [])

  // Registered once and always, NOT gated on `flyingId`. An effect keyed on
  // that state does not run until React has committed the render the
  // `pointerdown` scheduled — and a quick tap's `pointerup` arrives before
  // that, so the listener that was supposed to hear the release did not exist
  // yet and the card stayed glued to a pointer whose button was already up.
  // Every handler reads `flight.current`, which is set synchronously, so
  // there is nothing to gate: with no flight they all return on the first
  // line. The handlers themselves live in lab014Gestures.ts — they filter
  // `isTrusted`, and the test file is the story of why.
  // The gesture's lift-plane carry, with the lab's own camera. The canvas
  // fills the window here, so `innerHeight` is the calibration height.
  const toLiftPlane = useCallback(
    (a: THREE.Vector3) => carryToPlane(a, cameraDistance(window.innerHeight, FOV), LIFT_Z),
    [],
  )

  useEffect(
    () => attachLab014Gestures({ flight, dropTarget, moveTo, snapshot, scrollTop, toLiftPlane }),
    [dropTarget, moveTo, snapshot, scrollTop, toLiftPlane],
  )

  const onLanded = useCallback(() => {
    flight.current = null
    setFlyingId(null)
    setPainted(false)
    setAtAltitude(false)
    document.querySelectorAll<HTMLElement>('.l14-slot').forEach((el) => {
      el.style.removeProperty('--l14-near')
    })
  }, [])

  // The wad faded out: NOW the board forgets. The FLIP snapshot goes first,
  // so the neighbours close over the vacated slot as a layout animation
  // rather than a cut — the one reflow in this lab a delete is allowed to
  // cause, and the user watches it happen.
  const onCrumpled = useCallback(() => {
    const f = flight.current
    if (!f) return
    const id = f.id
    snapshot()
    setCards((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setBoard((prev) => ({
      queue: prev.queue.filter((x) => x !== id),
      today: prev.today.filter((x) => x !== id),
    }))
    flight.current = null
    setFlyingId(null)
    setPainted(false)
    setAtAltitude(false)
    document.querySelectorAll<HTMLElement>('.l14-slot').forEach((el) => {
      el.style.removeProperty('--l14-near')
    })
  }, [snapshot])

  // The loop closing: the physics writes a CSS custom property onto the slot
  // it is aimed at, every frame, and ordinary CSS does the rest.
  useEffect(() => {
    if (!flyingId) return
    let raf = 0
    const tick = () => {
      const f = flight.current
      if (f) {
        const r = slotRect(f.id)
        const el = slots.current.get(f.id)
        if (r && el) {
          const d = Math.hypot(
            f.plate.p.x - (r.left + r.width / 2 - window.innerWidth / 2),
            f.plate.p.y - (window.innerHeight / 2 - (r.top + r.height / 2)),
            f.plate.p.z,
          )
          el.style.setProperty('--l14-near', String(Math.max(0, 1 - d / 260).toFixed(3)))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [flyingId, slotRect])

  const flyingCard = flyingId ? cards[flyingId] : null

  return (
    <div className="l14" ref={scroller}>
      <div className="l14-inner">
        <h1>Board</h1>
        <p className="l14-lede">
          An ordinary page. Select this text, scroll it, tab through it — then
          press a card and pull.
        </p>

        <div className="l14-board" ref={boardEl}>
          {COLS.map((col) => (
            <section className="l14-col" data-col={col.id} key={col.id}>
              <h2>{col.name}</h2>
              <ul>
                {board[col.id].map((id) => (
                  <li
                    className="l14-slot"
                    key={id}
                    data-empty={flyingId === id && painted}
                    data-away={flyingId === id && painted && atAltitude}
                    ref={(el) => {
                      if (el) slots.current.set(id, el)
                      else slots.current.delete(id)
                    }}
                  >
                    <CardBody
                      card={cards[id]}
                      onChange={(p) => patch(id, p)}
                      onGrab={(e) => beginDrag(id, e)}
                      onDelete={() => deleteCard(id)}
                      hidden={flyingId === id && painted}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <article className="l14-prose">
          <h2>What is actually happening</h2>
          <p>
            The cards above are DOM. So is this paragraph. The difference is
            that a card, while you are holding it, is also a rigid body: a thin
            plate with the inertia of its own dimensions, hanging off your
            pointer by whatever point you closed your fingers on. Grab one by a
            corner and it swings, because <code>r × F</code> is a torque and a
            torque needs an orientation to act on.
          </p>
          <p>
            Nothing is moved at the handoff. The card you pressed turns{' '}
            <code>visibility: hidden</code> — which keeps its box, so the page
            does not twitch — and a second React root renders the same
            component into a parked canvas that becomes the material of a quad.
            Both copies exist for two frames and they are the same pixels in
            the same place, so there is no moment to catch.
          </p>
          <h2>Why the seam is invisible</h2>
          <p>
            The camera sits exactly <code>(height/2)/tan(fov/2)</code> back, so
            the plane <code>z = 0</code> is the viewport and one world unit is
            one CSS pixel. A card&rsquo;s <code>getBoundingClientRect()</code>{' '}
            is already a pose. Lifting it toward you is honest perspective —
            it grows because it is nearer, and the texture is re-rasterized at
            a finer tier on the way up because it genuinely covers more pixels
            than it did on the page.
          </p>
          <p>
            The shadow is the plate&rsquo;s four corners projected onto{' '}
            <code>z = 0</code> along the light, so a tilted card throws a
            sheared quadrilateral rather than a blob. It falls on this text
            because the canvas composites over the document with alpha: there
            is no compositing trick and no blend mode, just a translucent black
            quadrilateral drawn where the light does not reach.
          </p>
          <h2>And the loop closes</h2>
          <p>
            While a card is in the air, the simulation writes{' '}
            <code>--l14-near</code> onto the slot it is aimed at. Real CSS
            reads it and tints the well. So the DOM is being rasterized into
            the material of the object that is, at the same time, restyling the
            DOM — which is either a feedback loop or a single interaction
            layer, depending on how generous you are feeling.
          </p>
        </article>
      </div>

      <Canvas
        className="l14-overlay"
        // `position`, `inset` and `pointer-events` all have to be INLINE. r3f
        // writes `position: relative` AND `pointer-events: auto` onto its own
        // wrapper div as inline styles, and an inline declaration outranks any
        // class — so the stylesheet lost silently, twice. First the overlay was
        // laid out as an ordinary block after the article, a full viewport
        // below the fold (the scene was complete and correct the whole time; it
        // was simply somewhere else). Then, once it was in the right place, the
        // wrapper sat over the entire page swallowing every pointerdown, so no
        // card could be grabbed at all — a full-viewport invisible div is a
        // very quiet way to break a page.
        //
        // `SolidWhereMatterIs` toggles the CANVAS, one level down. A child may
        // re-enable `pointer-events` under a `none` parent, which is exactly
        // the arrangement we want: the wrapper is permanently transparent to
        // the pointer, and the canvas inside it is solid only while the ray
        // says it is over matter.
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
        gl={{ alpha: true, antialias: true }}
        // An overlay stretched across somebody's document does not get to burn
        // a GPU frame every 8 ms for the privilege of being empty. There is a
        // card in flight or there is nothing to draw, and the difference is
        // this prop. (Same instinct as the upload-on-paint contract one layer
        // down: idle costs nothing, and "idle" is the normal case.)
        frameloop={flyingId ? 'always' : 'demand'}
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          ;(window as unknown as { __r3f: unknown }).__r3f = state
        }}
      >
        <PixelPerfect />
        <SolidWhereMatterIs active={!!flyingId} />
        {flyingCard && flight.current && (
          <Flying
            key={flyingCard.id}
            card={flyingCard}
            flight={flight}
            onChange={(p) => patch(flyingCard.id, p)}
            onRegrab={regrab}
            slotRect={slotRect}
            scrollTop={scrollTop}
            onLanded={onLanded}
            onPainted={() => setPainted(true)}
            painted={painted}
            atAltitude={atAltitude}
            onAltitude={setAtAltitude}
            onDelete={() => deleteCard(flyingCard.id)}
            onCrumpled={onCrumpled}
          />
        )}
      </Canvas>

      <div className="l14-hud">
        {chips}
        <span>
          press a card and pull · throw it into the other column · tap one to
          leave it hanging, then type in its note · esc puts it back · ✕
          crumples it away
        </span>
      </div>
    </div>
  )
}
