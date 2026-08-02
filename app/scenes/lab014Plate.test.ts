import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { atRest, HAND, makePlate, stepFree, stepHeld } from './lab014Plate'

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

// Every test above this line measures where the card comes to REST, and a
// system with any amount of tracking lag passes all of them. Pete dragged a
// card and said it "changes position erratically and doesn't stay anchored to
// the cursor" — which is a statement about the TRANSIENT, and nothing here
// was looking at it.
describe('plate — tracking a hand that is moving', () => {
  const CARD = [514, 157] as const

  /**
   * Drag the hand in a straight line at `speed` px/s and report the worst
   * error, and the worst tilt, over the second half of the run — i.e. after
   * any start-up transient has died and the system is in whatever steady
   * state it has.
   *
   * Note which two things are compared, because the first version of this
   * helper compared the wrong ones and reported a flat 1-frame error that
   * looked like a real defect. A frame integrates the interval `[t, t+dt]`:
   * the hand sample it is given is the one from the START (that is all a
   * pointer event can ever be), and semi-implicit Euler advances the body
   * with the velocity it will have at the END. So the answer a correct
   * solver gives at step i is where the hand is at step i, having been told
   * where it was at step i−1 — and drawing the card there is what cancels
   * the one frame of staleness every real input pipeline has.
   */
  function drag(speed: number, hold: THREE.Vector3, seconds = 1.5) {
    const plate = makePlate(...CARD)
    const hand = (t: number) => new THREE.Vector3(speed * t, 0, 0)
    const handVel = new THREE.Vector3(speed, 0, 0)
    const grab = new THREE.Vector3()
    const n = Math.round(seconds / DT)
    let err = 0
    let tilt = 0
    for (let i = 1; i <= n; i++) {
      stepHeld(plate, DT, hand((i - 1) * DT), hold, FLAT, handVel)
      if (i < n / 2) continue
      grab.copy(hold).applyQuaternion(plate.q).add(plate.p)
      err = Math.max(err, grab.distanceTo(hand(i * DT)))
      tilt = Math.max(tilt, plate.q.angleTo(FLAT))
    }
    return { err, tilt }
  }

  it('the grab point stays under a hand moving at a steady speed', () => {
    // A hand moving at a constant speed is exerting NO net force on what it
    // is holding, so at steady state there is nothing for the card to lag by.
    // The shipped version disagreed: it damped the grab point's velocity
    // against the WORLD rather than against the hand, which is a card being
    // dragged through treacle by a hand nailed to the ground. That damper
    // needs a standing force to overcome, the spring can only make force out
    // of displacement, and so the card sat a fixed distance behind the
    // cursor — `kd / ks` seconds' worth of travel, 41/420 = 98 ms of it.
    // At an ordinary drag speed that is a hundred pixels.
    // Was 44.6 px at 500, 89.3 at 1000, 178 at 2000 — a tenth of a second of
    // travel, whatever that happened to be worth.
    //
    // The bound is stated as a fraction of ONE FRAME of hand travel, because
    // that is the only honest unit here: the newest hand position any frame
    // can possibly know is already one frame old, so a solver that is exactly
    // right still renders the card where the hand WAS. Landing inside half a
    // frame of where it now is means the physics has contributed nothing of
    // its own — everything left is the input pipeline, and no amount of
    // tuning in this file can reach it.
    const frame = (speed: number) => speed * DT * 0.5
    expect(drag(500, new THREE.Vector3()).err).toBeLessThan(frame(500))
    expect(drag(1000, new THREE.Vector3()).err).toBeLessThan(frame(1000))
    expect(drag(2000, new THREE.Vector3()).err).toBeLessThan(frame(2000))
  })

  it('…and does not tilt while it does, when held off-centre', () => {
    // The same phantom force is a phantom TORQUE once there is a lever, so
    // the card also flew at a permanent speed-dependent angle. Turn around
    // and the angle reverses through zero: the card visibly rocks whenever
    // the hand changes direction, which it does constantly.
    const corner = new THREE.Vector3(-199, 44.3, 0)
    expect(drag(1000, corner).tilt).toBeLessThan(0.02) // just over 1°
    expect(drag(1000, corner).err).toBeLessThan(1000 * DT * 0.5)
  })

  it('lags only while the hand is ACCELERATING, and catches up after', () => {
    // What should remain is the honest part: mass resists a change of speed.
    // Yank the hand from rest to 1600 px/s in 120 ms and the card is allowed
    // to fall behind — then it has to arrive, quickly, and stay arrived.
    const plate = makePlate(...CARD)
    const hold = new THREE.Vector3(-199, 44.3, 0)
    const target = new THREE.Vector3()
    const handVel = new THREE.Vector3()
    const grab = new THREE.Vector3()

    const speed = (t: number) => (t < 0.12 ? (1600 * t) / 0.12 : 1600)
    let x = 0
    let peak = 0
    let after = 0
    let settled = 0
    const n = Math.round(1.0 / DT)
    for (let i = 1; i <= n; i++) {
      const t = i * DT
      target.set(x, 0, 0) // where the hand was when this frame started
      handVel.set(speed(t - DT), 0, 0)
      x += speed(t) * DT
      stepHeld(plate, DT, target, hold, FLAT, handVel)
      grab.copy(hold).applyQuaternion(plate.q).add(plate.p)
      const e = Math.abs(grab.x - x)
      if (t < 0.12) peak = Math.max(peak, e)
      if (t > 0.3) after = Math.max(after, e)
      if (t > 0.6) settled = Math.max(settled, e)
    }
    // It is a physical object, not a cursor: `ks` is the compliance of the
    // grip, so a real acceleration shows up as a real displacement — 13333
    // px/s² over a grip of 1400 is about 10 px of give, and the swing the
    // lever takes out of it is worth several more.
    expect(peak).toBeGreaterThan(8)
    // …and a HELD physical object: once the hand stops changing speed there
    // is nothing left to lag by, and what is left is the swing the yank put
    // into it decaying at the fingers' own rate. Was 142.9 px, permanently —
    // no decay available, because the thing sustaining it was the drag speed.
    expect(after).toBeLessThan(8)
    expect(settled).toBeLessThan(1600 * DT * 0.5)
  })
})

describe('plate — stability', () => {
  it('a stiff spring at 60 Hz does not walk itself apart', () => {
    const plate = makePlate(320, 180)
    const target = new THREE.Vector3(600, -400, 0)
    const hold = new THREE.Vector3(-160, 90, 0)

    let peak = 0
    run(1800, () => {
      stepHeld(plate, 1 / 60, target, hold, FLAT, undefined, HAND)
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
