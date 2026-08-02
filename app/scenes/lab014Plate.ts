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

export const HAND: Grip = { ks: 420, kd: 41, grip: 0.3, wUp: 121, cUp: 22 }

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
 */
export function stepHeld(
  plate: Plate,
  dt: number,
  target: THREE.Vector3,
  hold: THREE.Vector3,
  faceTo: THREE.Quaternion,
  g: Grip = HAND,
) {
  // Where the grab point actually IS right now: centre + the held corner
  // rotated into the world.
  _r.copy(hold).applyQuaternion(plate.q)
  // Velocity of that material point = v + ω × r. Damping the POINT rather
  // than the centre is what makes a swinging card lose its swing; damping
  // only the centre leaves a card that oscillates about a hand that is
  // standing still.
  _pointVel.copy(plate.w).cross(_r).add(plate.v)

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

/** Impulse-style velocity estimate from a pointer track, px/s. */
export class Swing {
  private lastX = 0
  private lastY = 0
  private seeded = false
  readonly v = new THREE.Vector3()

  reset(x: number, y: number) {
    this.lastX = x
    this.lastY = y
    this.seeded = true
    this.v.set(0, 0, 0)
  }

  /** Exponentially smoothed so one jittery sample can't launch a card. */
  push(x: number, y: number, dt: number, tau = 0.06) {
    if (!this.seeded || dt <= 0) return this.reset(x, y)
    const k = 1 - Math.exp(-dt / tau)
    this.v.x += ((x - this.lastX) / dt - this.v.x) * k
    this.v.y += ((y - this.lastY) / dt - this.v.y) * k
    this.lastX = x
    this.lastY = y
  }
}
