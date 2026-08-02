import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { atRest, HAND, makePlate, stepFree, stepHeld, Swing } from './lab014Plate'

const DT = 1 / 120
const FLAT = new THREE.Quaternion()

function run(steps: number, fn: (i: number) => void) {
  for (let i = 0; i < steps; i++) fn(i)
}

describe('plate — held by the centre', () => {
  it('settles at the hand without ever rotating', () => {
    const plate = makePlate(320, 180)
    const target = new THREE.Vector3(240, -120, 0)
    const hold = new THREE.Vector3(0, 0, 0)
    run(360, () => stepHeld(plate, DT, target, hold, FLAT))

    expect(plate.p.distanceTo(target)).toBeLessThan(0.5)
    // A force through the centre of mass has no lever, so there is no torque
    // to find. If this ever fails, `r × F` is being computed in the wrong
    // frame — that is the only way a centred pull can spin something.
    expect(plate.w.length()).toBeLessThan(1e-9)
    expect(plate.q.angleTo(FLAT)).toBeLessThan(1e-9)
  })
})

describe('plate — held by a corner', () => {
  const hold = new THREE.Vector3(-160, 90, 0) // top-left corner of a 320×180

  it('swings: an off-centre grab converts a pull into spin', () => {
    const plate = makePlate(320, 180)
    const target = new THREE.Vector3(400, 0, 0)

    let peak = 0
    run(120, () => {
      stepHeld(plate, DT, target, hold, FLAT)
      peak = Math.max(peak, plate.w.length())
    })
    expect(peak).toBeGreaterThan(0.5)
  })

  it('settles with the GRAB POINT at the hand, not the centre', () => {
    const plate = makePlate(320, 180)
    const target = new THREE.Vector3(400, 0, 0)
    run(1200, () => stepHeld(plate, DT, target, hold, FLAT))

    const grab = hold.clone().applyQuaternion(plate.q).add(plate.p)
    expect(grab.distanceTo(target)).toBeLessThan(1.5)
    // …and the fingers have flattened it back out.
    expect(plate.q.angleTo(FLAT)).toBeLessThan(0.02)
  })

  it('the finger torque flattens a tilted card', () => {
    const plate = makePlate(320, 180)
    plate.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.9)
    const target = new THREE.Vector3(0, 0, 0)
    run(900, () => stepHeld(plate, DT, target, new THREE.Vector3(), FLAT))
    expect(plate.q.angleTo(FLAT)).toBeLessThan(0.02)
  })
})

describe('plate — stability', () => {
  it('a stiff spring at 60 Hz does not walk itself apart', () => {
    const plate = makePlate(320, 180)
    const target = new THREE.Vector3(600, -400, 0)
    const hold = new THREE.Vector3(-160, 90, 0)

    let peak = 0
    run(1800, () => {
      stepHeld(plate, 1 / 60, target, hold, FLAT, HAND)
      peak = Math.max(peak, plate.v.length(), plate.w.length() * 100)
    })
    // Semi-implicit Euler conserves; explicit Euler would have diverged to
    // Infinity long before 30 seconds of stiff spring at half the rate.
    expect(Number.isFinite(peak)).toBe(true)
    expect(plate.v.length()).toBeLessThan(1)
    // The CENTRE settles one lever arm away from the hand — |hold| = 183.65
    // for this corner — because the spring pulls the GRAB POINT to the
    // target. Asserting on the centre here is how this test first "failed".
    const grab = hold.clone().applyQuaternion(plate.q).add(plate.p)
    expect(grab.distanceTo(target)).toBeLessThan(1)
  })
})

describe('plate — free flight home', () => {
  it('flies to the slot, lies flat, and reports at rest', () => {
    const plate = makePlate(320, 180)
    plate.p.set(500, 300, 200)
    plate.v.set(-800, 400, -200)
    plate.w.set(3, -2, 1.5)
    plate.q.setFromAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), 1.2)

    const slot = new THREE.Vector3(-100, -50, 0)
    let landed = -1
    run(600, (i) => {
      stepFree(plate, DT, slot, FLAT)
      if (landed < 0 && atRest(plate, slot)) landed = i
    })

    expect(landed).toBeGreaterThan(0)
    expect(landed / 120).toBeLessThan(2.5)
    expect(plate.q.angleTo(FLAT)).toBeLessThan(0.05)
  })

  it('a thrown card bleeds its spin off rather than winding it up', () => {
    const plate = makePlate(320, 180)
    plate.w.set(6, 0, 0)
    const start = plate.w.length()
    const slot = new THREE.Vector3()
    let peak = start
    run(360, () => {
      stepFree(plate, DT, slot, FLAT)
      peak = Math.max(peak, plate.w.length())
    })
    expect(peak).toBeLessThanOrEqual(start + 1e-6)
    expect(plate.w.length()).toBeLessThan(0.05)
  })
})

describe('inertia', () => {
  it('a wide card resists yaw more than pitch', () => {
    const wide = makePlate(320, 180)
    // invI = 1/I, so the LARGER inverse is the cheaper axis. Rolling about
    // the long (x) axis only has to move the short dimension.
    expect(wide.invI.x).toBeGreaterThan(wide.invI.y)
    expect(wide.invI.z).toBeLessThan(wide.invI.y)
  })

  it('scales as the square of the dimension', () => {
    const a = makePlate(320, 180)
    const b = makePlate(640, 180)
    expect(a.invI.y / b.invI.y).toBeCloseTo(4, 6)
  })
})

describe('Swing', () => {
  it('smooths a jittery sample instead of launching the card', () => {
    const s = new Swing()
    s.reset(0, 0)
    // One 200px teleport in one frame is 24000 px/s raw; the filter admits
    // one time-constant's worth of it and no more.
    s.push(200, 0, 1 / 120)
    expect(s.v.x).toBeLessThan(24000 * 0.2)
  })

  it('converges on a steady drag speed', () => {
    const s = new Swing()
    s.reset(0, 0)
    for (let i = 1; i <= 120; i++) s.push(i * 5, 0, 1 / 120)
    expect(s.v.x).toBeCloseTo(600, 0)
  })
})
