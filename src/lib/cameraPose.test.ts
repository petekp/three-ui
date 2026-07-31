import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  clampOrbitPose,
  clampViewElevation,
  gazeAt,
  gazeTween,
  viewPitchRoom,
  type OrbitLimits,
} from './cameraPose'

// Lab 006's live values: App.tsx OrbitControls + the arc workspace geometry.
const LIMITS: OrbitLimits = {
  minPolarAngle: 0,
  maxPolarAngle: Math.PI / 2.05,
  minDistance: 3,
  maxDistance: 16,
}
const LOOK_TARGET = new THREE.Vector3(0, 1.7, 0)
const APPROACH_DIST = 3.05

/** OrbitControls.update()'s constraint reconciliation, verbatim: clamp the
 *  spherical pose and MOVE THE POSITION around the target to re-satisfy it.
 *  The distance a pose moves under this is exactly the settle-frame pop. */
function orbitReconcile(pos: THREE.Vector3, target: THREE.Vector3, limits: OrbitLimits) {
  const off = pos.clone().sub(target)
  const s = new THREE.Spherical().setFromVector3(off)
  s.phi = Math.max(limits.minPolarAngle ?? 0, Math.min(limits.maxPolarAngle ?? Math.PI, s.phi))
  s.makeSafe()
  s.radius = Math.max(limits.minDistance ?? 0, Math.min(limits.maxDistance ?? Infinity, s.radius))
  return target.clone().add(off.setFromSpherical(s))
}

/** A lab-006 approach pose for a panel at `p`: panels face LOOK_TARGET, the
 *  camera parks APPROACH_DIST out along that facing, aimed at the panel. */
function approachPose(p: THREE.Vector3) {
  const facing = LOOK_TARGET.clone().sub(p).normalize()
  return { toPos: p.clone().addScaledVector(facing, APPROACH_DIST), toTarget: p.clone() }
}

const phiOf = (pos: THREE.Vector3, target: THREE.Vector3) =>
  new THREE.Spherical().setFromVector3(pos.clone().sub(target)).phi

describe('clampOrbitPose (target sacred — approach rides)', () => {
  it('reproduces the settle pop: raw top- and middle-row approach poses move >0.5 under reconciliation', () => {
    // Row ys from Lab006 ROW_YS at radius 7; facing tilts toward LOOK_TARGET
    // put the camera BELOW the panel (phi > maxPolar) for the upper rows.
    const top = approachPose(new THREE.Vector3(0, 3.94, -7))
    const mid = approachPose(new THREE.Vector3(0, 2.36, -7))
    expect(phiOf(top.toPos, top.toTarget)).toBeGreaterThan(LIMITS.maxPolarAngle!)
    expect(phiOf(mid.toPos, mid.toTarget)).toBeGreaterThan(LIMITS.maxPolarAngle!)
    expect(orbitReconcile(top.toPos, top.toTarget, LIMITS).distanceTo(top.toPos)).toBeGreaterThan(0.5)
    expect(orbitReconcile(mid.toPos, mid.toTarget, LIMITS).distanceTo(mid.toPos)).toBeGreaterThan(0.3)
  })

  it('clamped poses are reconciliation fixed points (settle pop gone)', () => {
    for (const y of [0.78, 2.36, 3.94]) {
      const { toPos, toTarget } = approachPose(new THREE.Vector3(1.8, y, -6.5))
      const clamped = clampOrbitPose(toPos, toTarget, LIMITS)
      expect(orbitReconcile(clamped, toTarget, LIMITS).distanceTo(clamped)).toBeLessThan(1e-3)
    }
  })

  it('keeps the target centered: distance and azimuth survive the clamp', () => {
    const { toPos, toTarget } = approachPose(new THREE.Vector3(0, 3.94, -7))
    const clamped = clampOrbitPose(toPos, toTarget, LIMITS)
    const before = new THREE.Spherical().setFromVector3(toPos.clone().sub(toTarget))
    const after = new THREE.Spherical().setFromVector3(clamped.clone().sub(toTarget))
    expect(after.radius).toBeCloseTo(before.radius, 6)
    expect(after.theta).toBeCloseTo(before.theta, 6)
    expect(after.phi).toBeLessThanOrEqual(LIMITS.maxPolarAngle!)
  })

  it('passes a legal pose through unchanged (bottom row never popped)', () => {
    const { toPos, toTarget } = approachPose(new THREE.Vector3(0, 0.78, -7))
    expect(phiOf(toPos, toTarget)).toBeLessThan(LIMITS.maxPolarAngle!)
    expect(clampOrbitPose(toPos, toTarget, LIMITS).distanceTo(toPos)).toBeLessThan(1e-9)
  })

  it('clamps distance into [minDistance, maxDistance]', () => {
    const target = new THREE.Vector3(0, 1.6, 0)
    const near = clampOrbitPose(new THREE.Vector3(0, 1.6, 1), target, LIMITS)
    const far = clampOrbitPose(new THREE.Vector3(0, 1.6, 40), target, LIMITS)
    expect(near.distanceTo(target)).toBeCloseTo(3, 6)
    expect(far.distanceTo(target)).toBeCloseTo(16, 6)
  })
})

describe('clampViewElevation (position sacred — head turns, release aims)', () => {
  it('leaves a legal (downward-ish) view untouched', () => {
    const d = new THREE.Vector3(0.3, -0.4, -0.866).normalize()
    const before = d.clone()
    expect(clampViewElevation(d, LIMITS).equals(before)).toBe(true)
  })

  it('bends an upward view to the polar band edge, unit length, heading preserved', () => {
    const d = new THREE.Vector3(0.5, 0.6, -0.7).normalize()
    const heading = Math.atan2(d.x, d.z)
    clampViewElevation(d, LIMITS)
    // Legal band for d.y is [−cos(minP), −cos(maxP)] — with maxP just shy of
    // π/2 the view must always pitch at least slightly DOWN.
    expect(d.y).toBeCloseTo(-Math.cos(LIMITS.maxPolarAngle!), 6)
    expect(d.length()).toBeCloseTo(1, 6)
    expect(Math.atan2(d.x, d.z)).toBeCloseTo(heading, 6)
  })

  it('release aim: a top-row panel seen from HOME_POS yields a legal orbit pose', () => {
    const HOME_POS = new THREE.Vector3(0, 2.0, 3.4)
    const HOME_TARGET = new THREE.Vector3(0, 1.6, 0)
    const panel = new THREE.Vector3(-4.9, 3.94, -5.0) // an edge, top-row slot
    const d = clampViewElevation(panel.clone().sub(HOME_POS).normalize(), LIMITS)
    const target = HOME_POS.clone().addScaledVector(d, HOME_POS.distanceTo(HOME_TARGET))
    expect(orbitReconcile(HOME_POS, target, LIMITS).distanceTo(HOME_POS)).toBeLessThan(1e-3)
    // And the aim still points AT the panel horizontally.
    const toPanel = panel.clone().sub(HOME_POS)
    expect(Math.atan2(d.x, d.z)).toBeCloseTo(Math.atan2(toPanel.x, toPanel.z), 6)
  })

  it('survives a straight-up direction without NaN', () => {
    const d = clampViewElevation(new THREE.Vector3(0, 1, 0), LIMITS)
    expect(Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z)).toBe(true)
    expect(d.length()).toBeCloseTo(1, 6)
  })
})

describe('viewPitchRoom (camera-bounds predicate for the no-candidate ladder)', () => {
  it('the home view has a little up-room and lots of down-room', () => {
    // HOME_POS → HOME_TARGET: pitched ~6.7° down; the polar band tops out
    // just shy of horizontal, so upward room is real but small.
    const d = new THREE.Vector3(0, 1.6, 0).sub(new THREE.Vector3(0, 2.0, 3.4)).normalize()
    const room = viewPitchRoom(d, LIMITS)
    expect(room.up).toBeGreaterThan(0.05)
    expect(room.up).toBeLessThan(0.12)
    expect(room.down).toBeGreaterThan(1.2)
  })

  it('a view clampViewElevation bent to the band edge has zero up-room left', () => {
    const d = clampViewElevation(new THREE.Vector3(0.5, 0.6, -0.7).normalize(), LIMITS)
    const room = viewPitchRoom(d, LIMITS)
    expect(room.up).toBeLessThan(1e-9)
    expect(room.down).toBeGreaterThan(1)
  })

  it('a straight-down view has zero down-room and the whole band of up-room', () => {
    const room = viewPitchRoom(new THREE.Vector3(0, -1, 0), LIMITS)
    expect(room.down).toBeLessThan(1e-9)
    // Band spans from −90° up to just below horizontal.
    expect(room.up).toBeCloseTo(Math.PI / 2 + Math.asin(-Math.cos(LIMITS.maxPolarAngle!)), 6)
  })

  it('room halves sum to the band size wherever the view sits inside it', () => {
    const bandSize =
      Math.asin(-Math.cos(LIMITS.maxPolarAngle!)) - Math.asin(-Math.cos(LIMITS.minPolarAngle!))
    const d = new THREE.Vector3(0.3, -0.4, -0.866).normalize()
    const room = viewPitchRoom(d, LIMITS)
    expect(room.up + room.down).toBeCloseTo(bandSize, 6)
  })
})

describe('gaze slerp (mid-ride whip)', () => {
  // The browser-measured pose pair: home aimed at the bottom-right corner
  // panel (doc-7 release aim) riding to the top-LEFT corner's approach pose
  // (doc-14). Lerping the TARGET POINT sweeps it close past the camera's
  // path and lookAt whips: 0.23 rad in one uniform 120Hz step here — the
  // browser trace showed 1.13 rad, the same whip landing on a hitched frame
  // (approach repaints panels, stretching exactly the frames mid-whip).
  const fromPos = new THREE.Vector3(0, 2.0, 3.4)
  const fromTarget = new THREE.Vector3(3.282, 1.408, 2.629)
  const toPos = new THREE.Vector3(-3.818, 4.057, 1.023)
  const toTarget = new THREE.Vector3(-6.761, 3.94, 1.812)
  const FRAMES = 120 // one 120Hz second — the ride's dur is 0.9s
  const smoothstep = (t: number) => t * t * (3 - 2 * t)

  const maxStepAngle = (dirAt: (k: number) => THREE.Vector3) => {
    let max = 0
    let prev = dirAt(0)
    for (let i = 1; i <= FRAMES; i++) {
      const cur = dirAt(smoothstep(i / FRAMES))
      max = Math.max(max, prev.angleTo(cur))
      prev = cur
    }
    return max
  }

  it('reproduces the whip: target-point lerp swings >0.2 rad in a single frame', () => {
    const whip = maxStepAngle((k) => {
      const pos = fromPos.clone().lerp(toPos, k)
      const tgt = fromTarget.clone().lerp(toTarget, k)
      return tgt.sub(pos).normalize()
    })
    expect(whip).toBeGreaterThan(0.2)
  })

  it('yaw/pitch gaze path bounds every frame step', () => {
    const g = gazeTween(fromPos, fromTarget, toPos, toTarget)
    const out = new THREE.Vector3()
    const step = maxStepAngle((k) => {
      const pos = fromPos.clone().lerp(toPos, k)
      return gazeAt(g, pos, k, out).clone().sub(pos).normalize()
    })
    // Smoothstep peak velocity is 1.5× uniform; the angular path length is
    // at most hypot(dYaw, dPitch).
    expect(step).toBeLessThan((Math.hypot(g.dYaw, g.dPitch) * 1.5) / FRAMES + 0.005)
  })

  it('never arcs toward the zenith: path elevation stays inside the endpoint band', () => {
    // The great-circle between these near-antiparallel horizontal aims
    // passes near straight-up, where lookAt's up-vector degenerates and the
    // orientation spins. Yaw/pitch interpolation keeps |y| inside the band.
    const g = gazeTween(fromPos, fromTarget, toPos, toTarget)
    const out = new THREE.Vector3()
    let maxY = 0
    for (let i = 0; i <= FRAMES; i++) {
      const k = smoothstep(i / FRAMES)
      const pos = fromPos.clone().lerp(toPos, k)
      const d = gazeAt(g, pos, k, out).clone().sub(pos).normalize()
      maxY = Math.max(maxY, Math.abs(d.y))
    }
    const fromDir = fromTarget.clone().sub(fromPos).normalize()
    const toDir = toTarget.clone().sub(toPos).normalize()
    expect(maxY).toBeLessThanOrEqual(Math.max(Math.abs(fromDir.y), Math.abs(toDir.y)) + 1e-9)
  })

  it('lands exactly on the destination pose', () => {
    const g = gazeTween(fromPos, fromTarget, toPos, toTarget)
    const end = gazeAt(g, toPos, 1, new THREE.Vector3())
    expect(end.distanceTo(toTarget)).toBeLessThan(1e-6)
  })

  it('handles a pure dolly (no gaze change) and an anti-parallel flip', () => {
    const g0 = gazeTween(
      new THREE.Vector3(0, 2, 5),
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(0, 2, 3),
      new THREE.Vector3(0, 2, -2),
    )
    const mid = gazeAt(g0, new THREE.Vector3(0, 2, 4), 0.5, new THREE.Vector3())
    expect(mid.x).toBeCloseTo(0, 6)
    expect(mid.y).toBeCloseTo(2, 6)

    const flip = gazeTween(
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(0, 2, -5),
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(0, 2, 5),
    )
    const half = gazeAt(flip, new THREE.Vector3(0, 2, 0), 0.5, new THREE.Vector3())
    expect(Number.isFinite(half.x)).toBe(true)
    expect(half.distanceTo(new THREE.Vector3(0, 2, 0))).toBeCloseTo(5, 6)
  })
})
