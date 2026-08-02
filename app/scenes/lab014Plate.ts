// Lab 014 — a card held in a hand, as a rigid thin plate.
//
// Everything in this file is in CSS PIXELS and SECONDS. Lab 014's world unit
// IS a CSS pixel (see Lab014.tsx — the camera is calibrated so the plane
// z = 0 is pixel-exact with the viewport), which means a card's rect can be
// read off `getBoundingClientRect` and used as a world pose with no
// conversion anywhere. The physics inherits that: `ks = 400` really is
// 400 px/s² per px of stretch, and the inertia of a 320×180 card really is
// the inertia of a 320×180 plate.
//
// Why a rigid body rather than the 1-DOF integrator in `physics1D`: a card
// picked up by one corner has to SWING, and swing is the lever arm between
// where the hand is and where the mass is. That is a torque, and a torque
// needs an orientation to act on. The whole feel of the lab is in the two
// lines that turn `r × F` into angular acceleration.

import * as THREE from 'three'

/** A thin rectangular plate in the body's xy plane, facing +z. */
export interface Plate {
  /** Centre of mass, world px. */
  p: THREE.Vector3
  /** Linear velocity, px/s. */
  v: THREE.Vector3
  /** Orientation. Identity = facing the camera, unrotated. */
  q: THREE.Quaternion
  /** Angular velocity, WORLD frame, rad/s. */
  w: THREE.Vector3
  /** Mass. 1 for every card — the interesting ratios are all rotational. */
  m: number
  /**
   * Inverse principal moments of inertia, BODY frame, as a diagonal.
   * A thin plate of width a and height b: Ixx = m·b²/12 (roll about the
   * long axis is cheap), Iyy = m·a²/12, Izz = m·(a²+b²)/12. Wide cards
   * therefore resist yaw more than pitch, which is why a wide card grabbed
   * at a top corner tips toward you before it swings sideways — it is not
   * a tuned behaviour, it is the aspect ratio.
   */
  invI: THREE.Vector3
}

export function makePlate(w: number, h: number, m = 1): Plate {
  const ixx = (m * h * h) / 12
  const iyy = (m * w * w) / 12
  const izz = (m * (w * w + h * h)) / 12
  return {
    p: new THREE.Vector3(),
    v: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    w: new THREE.Vector3(),
    m,
    invI: new THREE.Vector3(1 / ixx, 1 / iyy, 1 / izz),
  }
}

/**
 * How a hand holds a card.
 *
 * The two rotational channels are specified in DIFFERENT units, on purpose,
 * and getting that wrong was the first bug this file had. The lever is
 * physics: a torque, divided by a real inertia, so a card twice as wide
 * really does swing four times as lazily. The fingers are a SERVO: they
 * are specified as an angular frequency and applied as angular acceleration
 * directly, never touching the inertia tensor — because a hand does not
 * grip a big card more limply than a small one, and any gain expressed as a
 * torque would say that it does. (Expressed as one, it did: at px units a
 * 320-wide plate has I ≈ 8533, so a "62" that felt right in the abstract was
 * four orders of magnitude too small and a tilted card took eight seconds to
 * lie down.)
 */
export interface Grip {
  /** Positional spring at the grab point, px/s² per px. */
  ks: number
  /** Its damper. Critical for m = 1 is 2√ks. */
  kd: number
  /**
   * How much of the lever torque the hand actually lets through. 1 = the
   * card pivots freely on a pin at the grab point; 0 = welded to the hand.
   * Fingers are somewhere in between and that is the whole knob.
   */
  grip: number
  /** Finger servo stiffness, ω₀² in rad/s². */
  wUp: number
  /** Finger servo damping, 2ζω₀ in 1/s. ζ = 1 is 2√wUp. */
  cUp: number
}

// `ks` is the COMPLIANCE OF THE GRIP and nothing else. Once the damper is
// connected to the hand the only steady-state displacement left is the
// honest one — `m·a / ks`, the give in your fingers when you accelerate
// something with mass — so this number alone decides how firmly the card is
// anchored. It does NOT decide how much the card swings: the lever torque is
// `grip · (r × F)` and at any sustained acceleration `F ≈ m·a` regardless of
// how stiff the spring is. Stiffening it therefore buys anchoring and costs
// nothing in character, which is exactly the trade this lab wanted and could
// not have while a phantom drag force was setting `F`.
//
// ω₀ = √1400 = 37 rad/s, and semi-implicit Euler is stable while ω₀·dt < 2 —
// the driver clamps dt at 1/30, so the worst case is 1.25. `kd` is 2√ks: the
// grip is critically damped, because a hand does not ring.
export const HAND: Grip = { ks: 1400, kd: 75, grip: 0.3, wUp: 121, cUp: 22 }

const ZERO = new THREE.Vector3()

/**
 * The physics timestep is NOT the frame timestep.
 *
 * An explicit integrator's stability limit is a statement about `ω·dt`, so
 * leaving `dt` up to the display couples every gain in this file to whatever
 * hardware happens to be running it: the same numbers that are serene at
 * 120 Hz can walk themselves apart at 60, and the driver clamps a hitch at
 * 1/30, which is worse still. Stiffening the grip to `ks = 1400` is what made
 * that concrete — it diverged at 60 Hz on the first try, because the lever
 * turns the grab point's damper into an angular damping rate of
 * `grip · kd · |r|² / I`, and THAT is the term that runs out of headroom
 * first, several times before the spring does.
 *
 * So the loop below fixes the timestep and lets the frame rate decide only
 * how many of them to take. Gains are now chosen for feel and nothing else,
 * which is the only reason they can be. Two substeps at 120 Hz, eight at the
 * clamp; the body of one is about thirty flops.
 */
const MAX_H = 1 / 240

function substep(dt: number, once: (h: number) => void) {
  const n = Math.max(1, Math.ceil(dt / MAX_H))
  const h = dt / n
  for (let i = 0; i < n; i++) once(h)
}

const _r = new THREE.Vector3()
const _f = new THREE.Vector3()
const _t = new THREE.Vector3()
const _pointVel = new THREE.Vector3()
const _axis = new THREE.Vector3()
const _a = new THREE.Vector3()
const _ang = new THREE.Vector3()
const _qe = new THREE.Quaternion()
const _dq = new THREE.Quaternion()
const _qi = new THREE.Quaternion()

/**
 * One frame of "a hand at `target` is holding the plate at body-local point
 * `hold`". Returns nothing; mutates the plate.
 *
 * `faceTo` is the orientation the fingers want — normally identity (flat to
 * the screen) but a caller may hand it the pointer's own tilt.
 *
 * `handVel` is how fast the hand itself is moving, and leaving it out is how
 * this file spent its first day being wrong — see the damper below.
 */
export function stepHeld(
  plate: Plate,
  dt: number,
  target: THREE.Vector3,
  hold: THREE.Vector3,
  faceTo: THREE.Quaternion,
  handVel: THREE.Vector3 = ZERO,
  g: Grip = HAND,
) {
  substep(dt, (h) => heldOnce(plate, h, target, hold, faceTo, handVel, g))
}

function heldOnce(
  plate: Plate,
  dt: number,
  target: THREE.Vector3,
  hold: THREE.Vector3,
  faceTo: THREE.Quaternion,
  handVel: THREE.Vector3,
  g: Grip,
) {
  // Where the grab point actually IS right now: centre + the held corner
  // rotated into the world.
  _r.copy(hold).applyQuaternion(plate.q)
  // Velocity of that material point = v + ω × r. Damping the POINT rather
  // than the centre is what makes a swinging card lose its swing; damping
  // only the centre leaves a card that oscillates about a hand that is
  // standing still.
  //
  // …RELATIVE TO THE HAND. A damper is a connection between two things and
  // it resists their relative motion; subtracting `handVel` is what says the
  // other end of this one is attached to the hand rather than bolted to the
  // floor. Without it the model is a card being dragged through treacle,
  // and the consequence is not subtle: the treacle needs a standing force to
  // overcome, the spring can only make force out of displacement, so the
  // card flies a fixed distance BEHIND the cursor — `kd / ks` seconds' worth
  // of travel, which at 41/420 is 98 ms, which at a normal drag speed is a
  // hundred pixels. It also flies at a permanent tilt, because with a lever
  // that phantom force is a phantom torque. Both scale with speed and both
  // reverse when you turn around, which is why it read as the card wandering
  // rather than as anything as legible as lag.
  _pointVel.copy(plate.w).cross(_r).add(plate.v).sub(handVel)

  _f.copy(target).sub(plate.p).sub(_r).multiplyScalar(g.ks)
  _f.addScaledVector(_pointVel, -g.kd)

  // Lever torque, throttled by the grip. This one is real physics and pays
  // the inertia tensor.
  _t.copy(_r).cross(_f).multiplyScalar(g.grip)

  // Fingers also hold an ORIENTATION — a second-order servo on the full
  // rotation error, applied as acceleration and never touching the inertia.
  faceError(plate, faceTo)
  _ang.copy(_axis).multiplyScalar(g.wUp).addScaledVector(plate.w, -g.cUp)

  integrate(plate, dt, _f, _t, _ang)
}

/**
 * Writes the rotation vector taking the plate to `faceTo` into `_axis`:
 * direction = the axis, magnitude = the angle in radians.
 *
 * The first version of this crossed the two NORMALS, which is cheaper and
 * wrong in a way that only shows up at rest: the cross product of two
 * normals is blind to roll ABOUT the normal, so a card set down with a 6°
 * in-plane twist stayed twisted forever — zero facing error, zero restoring
 * term, a perfectly stable wrong answer. Fingers hold an orientation, not a
 * direction, so the error has to be one too.
 */
function faceError(plate: Plate, faceTo: THREE.Quaternion) {
  _qe.copy(faceTo).multiply(_qi.copy(plate.q).invert())
  // q and −q are the same rotation; the one with w ≥ 0 is the short way
  // round, and taking the other is how a servo talks itself into a 350°
  // correction.
  const sign = _qe.w < 0 ? -1 : 1
  const s = Math.hypot(_qe.x, _qe.y, _qe.z)
  if (s < 1e-9) return _axis.set(0, 0, 0)
  const angle = 2 * Math.atan2(s, Math.abs(_qe.w))
  _axis.set(_qe.x, _qe.y, _qe.z).multiplyScalar((sign * angle) / s)
}

/**
 * One frame of "the card is flying itself back to `target` and lying flat".
 * Same machinery, no lever: a card in flight is not being held anywhere, so
 * the spring acts at the centre of mass and cannot induce spin. Whatever
 * spin it left the hand with just decays.
 */
export function stepFree(
  plate: Plate,
  dt: number,
  target: THREE.Vector3,
  faceTo: THREE.Quaternion,
  ks = 300,
  kd = 33,
  wUp = 196,
  cUp = 28,
) {
  substep(dt, (h) => freeOnce(plate, h, target, faceTo, ks, kd, wUp, cUp))
}

function freeOnce(
  plate: Plate,
  dt: number,
  target: THREE.Vector3,
  faceTo: THREE.Quaternion,
  ks: number,
  kd: number,
  wUp: number,
  cUp: number,
) {
  _f.copy(target).sub(plate.p).multiplyScalar(ks).addScaledVector(plate.v, -kd)

  faceError(plate, faceTo)
  _ang.copy(_axis).multiplyScalar(wUp).addScaledVector(plate.w, -cUp)

  _t.set(0, 0, 0)
  integrate(plate, dt, _f, _t, _ang)
}

/**
 * Semi-implicit Euler. Velocity first, then position from the NEW velocity —
 * the same choice `physics1D` makes and for the same reason: it conserves
 * energy where explicit Euler pumps it, so a stiff spring at 60 Hz stays
 * stable instead of walking itself apart.
 *
 * The gyroscopic term ω × Iω is deliberately dropped. It is what makes a
 * tossed book tumble about its intermediate axis, and it is genuinely lovely,
 * but it is also an instability generator at UI timesteps and a card is not
 * a book. Named, not forgotten.
 */
function integrate(
  plate: Plate,
  dt: number,
  force: THREE.Vector3,
  torque: THREE.Vector3,
  angAcc: THREE.Vector3,
) {
  plate.v.addScaledVector(force, dt / plate.m)
  plate.p.addScaledVector(plate.v, dt)

  // Torque is world-frame; the inertia tensor is diagonal only in the BODY
  // frame, so the angular acceleration has to make the round trip. `angAcc`
  // skips it entirely — see the note on `Grip`.
  _qi.copy(plate.q).invert()
  _a.copy(torque).applyQuaternion(_qi)
  _a.multiply(plate.invI)
  _a.applyQuaternion(plate.q)
  _a.add(angAcc)
  plate.w.addScaledVector(_a, dt)

  // q̇ = ½ ω ⊗ q for a world-frame ω.
  _dq.set(plate.w.x * dt * 0.5, plate.w.y * dt * 0.5, plate.w.z * dt * 0.5, 0)
  _dq.multiply(plate.q)
  plate.q.set(
    plate.q.x + _dq.x,
    plate.q.y + _dq.y,
    plate.q.z + _dq.z,
    plate.q.w + _dq.w,
  )
  plate.q.normalize()
}

/** Has it stopped? Both channels, because a flat card can still be spinning. */
export function atRest(plate: Plate, target: THREE.Vector3, posEps = 0.6, velEps = 8) {
  return (
    plate.p.distanceTo(target) < posEps &&
    plate.v.length() < velEps &&
    plate.w.length() < 0.25
  )
}

/**
 * The plate's four corners in world space — what the shadow needs, and the
 * honest way to ask "how far off the page is this thing" for a body that is
 * tilted. Written into `out`.
 */
export function corners(
  plate: Plate,
  w: number,
  h: number,
  out: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
) {
  const hw = w / 2
  const hh = h / 2
  const sx = [-hw, hw, hw, -hw]
  const sy = [hh, hh, -hh, -hh]
  for (let i = 0; i < 4; i++) {
    out[i].set(sx[i], sy[i], 0).applyQuaternion(plate.q).add(plate.p)
  }
  return out
}

/**
 * The shadow quad's frame: vertices for the inflated footprint plus the two
 * half-extents the fragment shader is told about. The contract is that the
 * numbers NEVER LIE — `quadHalf` must be the quad's true half-extent in its
 * own edge directions, because the shader reconstructs "px from the card" as
 * `(vUv·2−1)·quadHalf` and evaluates the measured shadow layers at that
 * coordinate.
 *
 * The old construction pushed each corner radially away from the centroid,
 * which inflates a wide card's quad by only `margin·sin(diag)` vertically
 * (≈0.29·margin at 514×157) while claiming the full margin in `quadHalf`.
 * That stretch made every pixel below the card evaluate the shadow 2–3σ
 * farther out than it really was — at altitude a squished halo, at rest
 * (spread −12, σ 9: the whole fringe within ~12 px of the edge) it pushed
 * the ENTIRE visible shadow underneath the card quad. The card came to rest
 * shadowless and the DOM's fringe popped in at the swap.
 *
 * A planar rectangle projected along a fixed light direction is exactly a
 * parallelogram, so the projected corners are summarized without loss by two
 * half-edge vectors; the quad is rebuilt from them with the margin added
 * ALONG EACH AXIS. At rest the parallelogram is the card's own rect and the
 * p-space metric is the CSS pixel grid — identity, which is what the
 * measured layers assume.
 *
 * `proj` is the projected footprint in `corners` order (TL, TR, BR, BL, z
 * ignored); `verts` comes back in PlaneGeometry vertex order (TL, TR, BL,
 * BR). Everything is written into `out`, allocation-free.
 */
export interface ShadowFrame {
  verts: [THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2]
  quadHalf: THREE.Vector2
  cardHalf: THREE.Vector2
}

export function makeShadowFrame(): ShadowFrame {
  return {
    verts: [
      new THREE.Vector2(),
      new THREE.Vector2(),
      new THREE.Vector2(),
      new THREE.Vector2(),
    ],
    quadHalf: new THREE.Vector2(1, 1),
    cardHalf: new THREE.Vector2(1, 1),
  }
}

const _eu = new THREE.Vector2()
const _ev = new THREE.Vector2()
const _fc = new THREE.Vector2()

export function shadowQuadFrame(
  proj: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
  margin: number,
  out: ShadowFrame,
): ShadowFrame {
  const [tl, tr, br, bl] = proj
  _fc.set((tl.x + tr.x + br.x + bl.x) / 4, (tl.y + tr.y + br.y + bl.y) / 4)
  // Half-edge vectors of the parallelogram (averaged across the two parallel
  // edges, which are equal up to float noise for a true projection).
  _eu.set((tr.x + br.x - tl.x - bl.x) / 4, (tr.y + br.y - tl.y - bl.y) / 4)
  _ev.set((tl.x + tr.x - bl.x - br.x) / 4, (tl.y + tr.y - bl.y - br.y) / 4)
  // An edge-on card has no footprint to speak of; keep the frame finite so
  // the normalize below can't hand the GPU a NaN quad.
  const lu = Math.max(_eu.length(), 1e-3)
  const lv = Math.max(_ev.length(), 1e-3)
  _eu.divideScalar(lu)
  _ev.divideScalar(lv)
  out.cardHalf.set(lu, lv)
  out.quadHalf.set(lu + margin, lv + margin)
  // PlaneGeometry vertex order: TL (−1,+1), TR (+1,+1), BL (−1,−1), BR (+1,−1).
  const SX = [-1, 1, -1, 1]
  const SY = [1, 1, -1, -1]
  for (let i = 0; i < 4; i++) {
    out.verts[i].set(
      _fc.x + _eu.x * out.quadHalf.x * SX[i] + _ev.x * out.quadHalf.y * SY[i],
      _fc.y + _eu.y * out.quadHalf.x * SX[i] + _ev.y * out.quadHalf.y * SY[i],
    )
  }
  return out
}

// ── aero bend — the sheet against the air ────────────────────────────────
//
// Presentation only, like the gloss band: the plate stays rigid in the
// physics and the BEND is a vertex-shader field driven by the plate's own
// velocity. The two functions below are the JS side of that field's
// contract, kept pure so the tests can hold them still.

/**
 * Bend amplitude (px of out-of-plane sag at the far edge) for a plate
 * moving at `speed` px/s.
 *
 * Shape: a saturating square law with a HARD zero below 30 px/s. The
 * saturation is paper — a hand can always move faster, the sheet cannot
 * bend more. The hard gate is the handoff contract: the swap instants
 * happen at rest, and "flat at rest" must be a property of the curve, not
 * of how quickly some smoothing happened to decay. Between 30 and 90 px/s
 * the gate ramps in so the first pixel of bend cannot pop.
 */
export function aeroAmplitude(speed: number): number {
  const AMP = 22 // px, the cap — tuned by eye against real card stock
  const V0 = 900 // px/s, half-saturation speed
  const gate = aeroGate(speed)
  if (gate === 0) return 0
  const s2 = speed * speed
  return AMP * (s2 / (s2 + V0 * V0)) * gate
}

/**
 * The hard-zero gate, exported on its own because the driver needs it
 * twice: once inside `aeroAmplitude` (the target), and once on the
 * RENDERED amplitude — smoothed · gate — so the settle can never carry a
 * decay tail into the swap frame (measured: 0.45 px still aboard at
 * touchdown when only the target was gated; the descent outruns a 120 ms
 * time constant). One formula, one place.
 */
export function aeroGate(speed: number): number {
  return Math.min(1, Math.max(0, (speed - 30) / 60))
}

/**
 * Farthest |signed distance| of the card rect's corners from the grab
 * point, measured along the (unit) motion direction. This is the `L` that
 * normalizes the shader's bend parameter to t ∈ [−1, 1]: the support
 * function of the rect (|dx|·w/2 + |dy|·h/2) plus the grab point's own
 * offset along the direction — exact, not an estimate, so the far edge of
 * the sheet always lands at |t| = 1 no matter where it is held.
 */
export function aeroReach(
  dirX: number,
  dirY: number,
  w: number,
  h: number,
  grabX: number,
  grabY: number,
): number {
  return (
    (Math.abs(dirX) * w) / 2 +
    (Math.abs(dirY) * h) / 2 +
    Math.abs(dirX * grabX + dirY * grabY)
  )
}

// ── the crumple ──────────────────────────────────────────────────────────
//
// Deleting a card is the one gesture that gets to break the "indistinguishable
// from DOM" contract on purpose — the card stops being a document element and
// dies as matter. The timeline is pure so the tests can hold it still: the
// driver advances one clock (crumpleT, seconds) and everything else — when
// the sheet crushes, when gravity takes over, when the wad fades — is a
// function of that clock. The phases exist because each one covers a
// different mechanism: the rise is the HANDOFF window (page copy hides on
// first upload while the plate springs gently off the page, exactly like a
// grab); the crush is the vertex morph; the fall is ballistics; the fade is
// the exit. Nothing may overlap the rise, because the swap's pixel-copy
// guarantee holds only while the sheet is still a flat, untouched card.

/** Seconds: crush begins only after the handoff window has fully passed. */
export const CRUMPLE_RISE_T = 0.18
/** Seconds: the sheet is a wad. Gravity switches on here. */
export const CRUMPLE_CRUSH_T = 0.62
/** Seconds: the falling wad starts to fade… */
export const CRUMPLE_FADE_T = 0.82
/** …and is gone. The driver reports the flight done. */
export const CRUMPLE_END_T = 1.12

const sstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

export interface CrumplePhase {
  /** 0 → 1 vertex-morph progress. EXACTLY 0 through the whole rise. */
  crush: number
  /** 1 → 0 late-fall opacity. EXACTLY 1 until the fade begins. */
  fade: number
  /** Gravity on? (The wad falls only once it IS a wad.) */
  falling: boolean
  /** The flight is over; commit the delete. */
  done: boolean
}

/** The whole delete, as a function of one clock. */
export function crumplePhase(t: number): CrumplePhase {
  return {
    crush: sstep((t - CRUMPLE_RISE_T) / (CRUMPLE_CRUSH_T - CRUMPLE_RISE_T)),
    fade: 1 - sstep((t - CRUMPLE_FADE_T) / (CRUMPLE_END_T - CRUMPLE_FADE_T)),
    falling: t >= CRUMPLE_CRUSH_T,
    done: t >= CRUMPLE_END_T,
  }
}

/**
 * The shadow's footprint scale while the sheet crushes. The shadow quad is
 * driven from the plate's corners, but a wad no longer spans the plate —
 * shrink the dimensions the corners are computed from, and the shadow
 * contracts with the thing that casts it. 1 at crush 0 (identity — the
 * rise still casts the card's own shadow), 0.16 at full crush (a wad is
 * about a sixth of the sheet).
 */
export function wadShrink(crush: number): number {
  return 1 - 0.84 * crush
}
