// Camera pose legality for OrbitControls-constrained rigs.
//
// OrbitControls.update() re-satisfies its polar/distance limits by MOVING THE
// POSITION around the target. Any tween that settles by handing a pose back
// to the controls must therefore arm poses that ALREADY satisfy the app's
// limits, or the settle frame visibly yanks the camera (browser-verified in
// lab 006: y 2→3.05 on a steep head-turn; every top- and middle-row approach
// pose sat past the polar clamp).
//
// Two clamps for the pose's two points — which one is sacred decides which
// moves:
//   clampViewElevation — the POSITION is sacred (head turns, release aims):
//     bend the view direction's elevation into the polar band and let the
//     target ride along the new direction.
//   clampOrbitPose — the TARGET is sacred (approach rides: the panel must
//     stay centered): rotate/slide the position about the target.

import * as THREE from 'three'

export interface OrbitLimits {
  minPolarAngle?: number
  maxPolarAngle?: number
  minDistance?: number
  maxDistance?: number
}

// Inset armed phi slightly inside the limits so the controls' own exact
// clamp at settle is a strict no-op.
const EPS = 1e-4

/**
 * Mutates and returns `d`, a unit view direction (camera → target).
 * phi(position about target) = acos(−d.y), so the legal band for d.y is
 * [−cos(minPolar), −cos(maxPolar)] order-normalized. Horizontal heading is
 * preserved (a vertical `d` has none — it falls to +z); result stays unit.
 */
export function clampViewElevation(d: THREE.Vector3, limits: OrbitLimits): THREE.Vector3 {
  const yA = -Math.cos(limits.minPolarAngle ?? 0)
  const yB = -Math.cos(limits.maxPolarAngle ?? Math.PI)
  const yClamped = THREE.MathUtils.clamp(d.y, Math.min(yA, yB), Math.max(yA, yB))
  if (yClamped !== d.y) {
    const h = Math.sqrt(Math.max(1 - yClamped * yClamped, 1e-9))
    const hLen = Math.hypot(d.x, d.z)
    if (hLen < 1e-9) d.set(0, yClamped, h)
    else d.set((d.x / hLen) * h, yClamped, (d.z / hLen) * h)
  }
  return d
}

// ---- gaze interpolation ---------------------------------------------------
//
// A camera ride that LERPS THE TARGET POINT has a hidden failure mode: for
// some pose pairs the target's straight path sweeps close past the camera's
// straight path, and lookAt(target − position) whips as the difference
// vector shrinks through near-zero (browser-measured in lab 006: 1.13 rad in
// ONE frame riding from a corner release-aim to the opposite corner's
// approach). Gaze is angular state, so interpolate the DIRECTION — but not
// on the great circle: for near-antiparallel, near-horizontal aims (exactly
// the corner-to-corner case) the great circle arcs over the ZENITH, where
// lookAt's up-vector degenerates and the orientation spins (browser-
// measured 0.31 rad/frame). The stable parametrization for a head-turn is
// YAW/PITCH decomposition — rotate about vertical along the short arc,
// morph elevation linearly. That is also the body grammar of turning in
// place, and the path's elevation never leaves the endpoints' band, so the
// pole is unreachable by construction.

export interface GazeTween {
  fromYaw: number
  dYaw: number
  fromPitch: number
  dPitch: number
  fromDist: number
  toDist: number
  /** Great-circle angle between the aims — for duration scaling. */
  angle: number
}

/** Precompute the angular path between two (position, target) poses. */
export function gazeTween(
  fromPos: THREE.Vector3,
  fromTarget: THREE.Vector3,
  toPos: THREE.Vector3,
  toTarget: THREE.Vector3,
): GazeTween {
  const fromDir = fromTarget.clone().sub(fromPos)
  const fromDist = Math.max(fromDir.length(), 1e-6)
  fromDir.normalize()
  const toDir = toTarget.clone().sub(toPos)
  const toDist = Math.max(toDir.length(), 1e-6)
  toDir.normalize()
  // A vertical aim has no yaw — inherit the other endpoint's so the turn
  // degenerates to pure pitch instead of an arbitrary spin.
  const yawOf = (d: THREE.Vector3, fallback: number) =>
    Math.hypot(d.x, d.z) < 1e-6 ? fallback : Math.atan2(d.x, d.z)
  const fromYaw = yawOf(fromDir, yawOf(toDir, 0))
  const toYaw = yawOf(toDir, fromYaw)
  const dYaw = THREE.MathUtils.euclideanModulo(toYaw - fromYaw + Math.PI, 2 * Math.PI) - Math.PI
  const fromPitch = Math.asin(THREE.MathUtils.clamp(fromDir.y, -1, 1))
  const dPitch = Math.asin(THREE.MathUtils.clamp(toDir.y, -1, 1)) - fromPitch
  return { fromYaw, dYaw, fromPitch, dPitch, fromDist, toDist, angle: fromDir.angleTo(toDir) }
}

/** The gaze target at progress k from position `pos`, written into `out`. */
export function gazeAt(
  g: GazeTween,
  pos: THREE.Vector3,
  k: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const yaw = g.fromYaw + g.dYaw * k
  const pitch = g.fromPitch + g.dPitch * k
  const c = Math.cos(pitch)
  out.set(c * Math.sin(yaw), Math.sin(pitch), c * Math.cos(yaw))
  return out.multiplyScalar(THREE.MathUtils.lerp(g.fromDist, g.toDist, k)).add(pos)
}

/**
 * Returns a NEW position whose spherical pose about `target` satisfies the
 * limits. A pose already inside them passes through value-identical; a
 * violating pose keeps its distance/azimuth (when legal) and gives up only
 * the illegal coordinate — the settled frame the controls would have yanked
 * to anyway, reached smoothly instead.
 */
export function clampOrbitPose(
  pos: THREE.Vector3,
  target: THREE.Vector3,
  limits: OrbitLimits,
): THREE.Vector3 {
  const off = pos.clone().sub(target)
  const s = new THREE.Spherical().setFromVector3(off)
  const phi = THREE.MathUtils.clamp(
    s.phi,
    (limits.minPolarAngle ?? 0) + EPS,
    (limits.maxPolarAngle ?? Math.PI) - EPS,
  )
  const radius = THREE.MathUtils.clamp(
    s.radius,
    limits.minDistance ?? 0,
    limits.maxDistance ?? Infinity,
  )
  if (phi === s.phi && radius === s.radius) return pos.clone()
  s.phi = phi
  s.radius = radius
  s.makeSafe()
  return target.clone().add(off.setFromSpherical(s))
}
