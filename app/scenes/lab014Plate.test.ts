import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  aeroAmplitude,
  type AeroFollow,
  aeroFollowStep,
  aeroGate,
  aeroReach,
  atRest,
  CRUMPLE_CRUSH_T,
  CRUMPLE_RISE_T,
  crumplePhase,
  HAND,
  makePlate,
  makeShadowFrame,
  shadowQuadFrame,
  stepFree,
  stepHeld,
  TOSS_SPIN_MAX,
  TOSS_SPIN_V0,
  tossSpin,
  wadOffscreen,
  wadShrink,
} from './lab014Plate'

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

describe('shadow quad frame — the mapping never lies', () => {
  const rect = (w: number, h: number, cx = 0, cy = 0) =>
    [
      new THREE.Vector3(cx - w / 2, cy + h / 2, 0), // TL
      new THREE.Vector3(cx + w / 2, cy + h / 2, 0), // TR
      new THREE.Vector3(cx + w / 2, cy - h / 2, 0), // BR
      new THREE.Vector3(cx - w / 2, cy - h / 2, 0), // BL
    ] as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]

  it('at rest the quad reaches the FULL margin past every edge', () => {
    // The bug this guards: the old radial push gave a 514×157 card only
    // margin·sin(diag) ≈ 0.29·margin of quad below its bottom edge while
    // quadHalf claimed the full margin — so the shader evaluated every
    // below-card pixel 2–3σ too far out, and the rest shadow (whose whole
    // fringe lives within ~12 px of the edge: spread −12, σ 9, offset 6)
    // rendered entirely underneath the card. Rest = shadowless, then the
    // DOM's fringe popped in at the swap.
    const out = makeShadowFrame()
    shadowQuadFrame(rect(514, 157.5), 33, out)

    expect(out.cardHalf.x).toBeCloseTo(257, 6)
    expect(out.cardHalf.y).toBeCloseTo(78.75, 6)
    expect(out.quadHalf.x).toBeCloseTo(290, 6)
    expect(out.quadHalf.y).toBeCloseTo(111.75, 6)
    for (const v of out.verts) {
      // True extents equal the claimed extents — the contract itself.
      expect(Math.abs(v.x)).toBeCloseTo(out.quadHalf.x, 6)
      expect(Math.abs(v.y)).toBeCloseTo(out.quadHalf.y, 6)
    }
  })

  it('margin 0 reproduces the projected parallelogram exactly', () => {
    // A planar rect projected along a fixed direction IS a parallelogram,
    // so the two half-edge vectors summarize it without loss. Shear one and
    // round-trip it.
    const proj = rect(320, 180, 40, -25)
    for (const v of proj) v.x += v.y * 0.35 // shear from a tilted plate
    const out = makeShadowFrame()
    shadowQuadFrame(proj, 0, out)

    // verts come back TL, TR, BL, BR; proj is TL, TR, BR, BL.
    const want = [proj[0], proj[1], proj[3], proj[2]]
    for (let i = 0; i < 4; i++) {
      expect(out.verts[i].x).toBeCloseTo(want[i].x, 6)
      expect(out.verts[i].y).toBeCloseTo(want[i].y, 6)
    }
  })

  it('an edge-on card cannot hand the GPU a NaN', () => {
    const out = makeShadowFrame()
    shadowQuadFrame(rect(320, 0), 10, out)
    for (const v of out.verts) {
      expect(Number.isFinite(v.x)).toBe(true)
      expect(Number.isFinite(v.y)).toBe(true)
    }
  })
})

describe('aero bend — flat at rest is a theorem, not a tuning', () => {
  it('a still card is EXACTLY flat, and stays flat through the gate band', () => {
    // The swap instants happen at rest. If the amplitude curve leaked even a
    // fraction of a pixel at speed 0, the landing card would be bent while
    // the DOM card is flat, and the handoff would pop. Zero must be exact.
    expect(aeroAmplitude(0)).toBe(0)
    expect(aeroAmplitude(15)).toBe(0)
    expect(aeroAmplitude(30)).toBe(0)
  })

  it('rises monotonically with speed and saturates below its cap', () => {
    let prev = 0
    for (const s of [60, 120, 300, 600, 1200, 2400, 5000]) {
      const a = aeroAmplitude(s)
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
    // A hand can always move faster; the sheet cannot bend more than paper.
    expect(aeroAmplitude(1e6)).toBeLessThanOrEqual(55)
  })

  it('a real drag is VISIBLE — the curve reaches readable amplitude at hand speeds', () => {
    // Pete's report, verbatim: "i don't see any bend when picking up and
    // moving the card around, even swiftly." The pipeline was healthy end to
    // end — the browser bisect showed the driver delivering 8–15 px at real
    // drag speeds and the shader bending beautifully when forced to 60 —
    // so the defect was the CURVE: a 22 px cap with half-saturation at
    // 900 px/s puts every human drag in the single-digit-swell regime,
    // and a head-on z-bow that size is a sub-2% perspective change.
    // Invisible is a bug even when every wire is live. These floors pin
    // "readable": a comfortable drag clears 25 px, a brisk one clears 40.
    expect(aeroAmplitude(600)).toBeGreaterThan(25)
    expect(aeroAmplitude(1200)).toBeGreaterThan(40)
    // …while a slow, deliberate reposition stays a whisper.
    expect(aeroAmplitude(300)).toBeLessThan(12)
  })

  it('reach is the exact corner support along the motion direction', () => {
    // Brute force over the four corners is the definition; the closed form
    // must agree, including from an off-centre grab point.
    const w = 514
    const h = 157.5
    const cases = [
      { d: [1, 0], g: [0, 0] },
      { d: [0, 1], g: [0, 0] },
      { d: [0.6, 0.8], g: [120, -40] },
      { d: [-0.28, 0.96], g: [-200, 60] },
    ] as const
    for (const { d, g } of cases) {
      let brute = 0
      for (const cx of [-w / 2, w / 2])
        for (const cy of [-h / 2, h / 2])
          brute = Math.max(brute, Math.abs((cx - g[0]) * d[0] + (cy - g[1]) * d[1]))
      expect(aeroReach(d[0], d[1], w, h, g[0], g[1])).toBeCloseTo(brute, 10)
    }
  })
})

describe('aero gate — the rendered bend is zero at the swap by construction', () => {
  it('gates the TARGET to exactly 0 below 30 px/s', () => {
    // The gate lives inside aeroAmplitude alone. (It was once also
    // multiplied onto the rendered value — that multiply was the flicker
    // and the settle hitch, and the follower's gated release + snap now
    // owns swap-frame exactness instead. See the follower suite below.)
    expect(aeroGate(0)).toBe(0)
    expect(aeroGate(29.9)).toBe(0)
    expect(aeroGate(30)).toBe(0)
    expect(aeroGate(90)).toBe(1)
    expect(aeroGate(60)).toBeCloseTo(0.5, 10)
    for (const s of [40, 55, 70, 85]) {
      const g = aeroGate(s)
      expect(g).toBeGreaterThan(0)
      expect(g).toBeLessThan(1)
    }
  })

  it('aeroAmplitude is the gated curve — the two cannot disagree', () => {
    for (const s of [0, 20, 45, 100, 800, 3000]) {
      const raw = s * s === 0 ? 0 : 55 * ((s * s) / (s * s + 650 * 650))
      expect(aeroAmplitude(s)).toBeCloseTo(raw * aeroGate(s), 10)
    }
  })
})

describe('aero follower — the bend is continuous; flat-at-rest stays exact', () => {
  // Speed profiles measured in the browser (2026-08-02). A hesitation-rich
  // hand drag rings speed through the 30–90 gate band at every pause; a
  // release-to-settle descends through it once, fast, then creeps sub-30
  // until the swap. Both are along +x — the bow axis is not under test here.
  const RAMP = Array.from({ length: 30 }, (_, i) => (900 * (i + 1)) / 30)
  const HOLD = Array.from({ length: 20 }, () => 900)
  const CRASH = [400, 150, 47, 20, 10]
  const REST = Array.from({ length: 40 }, () => 0)

  function follower(): AeroFollow {
    return { amt: 0, dirX: 1, dirY: 0 }
  }

  function drive(sm: AeroFollow, speeds: number[], held: boolean): number[] {
    return speeds.map((s) => aeroFollowStep(sm, s, 0, DT, held))
  }

  it('a held hesitation cannot strobe the bend: bounded per-frame drop, no teleport to 0', () => {
    // Measured before the law changed: −25.75 px in ONE frame as a pause
    // crossed the gate band (35 px of bend → 9 in 8 ms), and every pause in
    // a drag ran a full appear-vanish-appear cycle. The eye reads that as
    // flicker, and the curvature shade amplifies it — the darkening scales
    // with amplitude, so the shade strobed with it. A hand that is DOWN has
    // no swap deadline, so the pause's relax gets the lazy time constant.
    const sm = follower()
    const out = drive(sm, [...RAMP, ...HOLD, ...CRASH, ...REST], true)
    let worst = 0
    for (let i = 1; i < out.length; i++) {
      worst = Math.max(worst, out[i - 1] - out[i])
      // a visible bend may never be exactly 0 one frame later
      if (out[i - 1] > 1) expect(out[i]).toBeGreaterThan(0)
    }
    expect(worst).toBeLessThanOrEqual(4)
  })

  it('the free settle relax is exponential butter that BEATS the swap: shrinking steps, exactly 0 within 150 ms of gate-close', () => {
    // The measured settle (trace B): band entry at ~144 px/s with ~23 px
    // aboard, gate-zero at ~30 px/s. The old law multiplied the smoothed
    // amplitude by the instantaneous gate, compressing the whole relax into
    // ~75 ms of 3–4 px steps that ended in a visible snap — the hitch. But
    // the cliff was also hiding a deadline: gate-close to the DOM swap is
    // only ~116 ms (measured — the trace stops when the mesh unmounts), and
    // a first fix with one 70 ms gated constant swapped with 2.75 px still
    // aboard. Free flight gets the brisk constant; exactness must arrive
    // from convergence before the swap can plausibly fire.
    const sm = follower()
    const FLIGHT = Array.from({ length: 40 }, () => 900)
    const DECEL = [700, 500, 300, 220, 180]
    const BAND = [144, 127, 112, 97, 86, 76, 65, 57, 50, 43, 36, 30]
    const TAIL = [
      25, 20, 16, 13, 10, 8, 6, 5, 4, 3, 2, 2, 1, 1,
      ...Array.from({ length: 30 }, () => 0),
    ]
    const out = drive(sm, [...FLIGHT, ...DECEL, ...BAND, ...TAIL], false)
    const bandStart = FLIGHT.length + DECEL.length
    let worst = 0
    for (let i = bandStart + 1; i < out.length; i++) {
      worst = Math.max(worst, out[i - 1] - out[i])
      if (out[i - 1] > 1) expect(out[i]).toBeGreaterThan(0)
    }
    expect(worst).toBeLessThanOrEqual(4)
    // Exactness is still the theorem: EXACTLY 0, before the swap deadline.
    expect(out[out.length - 1]).toBe(0)
    const gateClose = bandStart + BAND.length
    const zeroAt = out.findIndex((v, i) => i >= gateClose && v === 0)
    expect(zeroAt).toBeGreaterThan(-1)
    expect((zeroAt - gateClose) * DT).toBeLessThanOrEqual(0.15)
  })

  it('the attack still snaps: a step to 900 px/s reaches 80% of the curve within 150 ms', () => {
    const sm = follower()
    const out = drive(sm, Array.from({ length: 18 }, () => 900), true)
    expect(out[17]).toBeGreaterThanOrEqual(0.8 * aeroAmplitude(900))
  })

  it('free rest is EXACTLY zero after any history — the swap contract survives the law', () => {
    const sm = follower()
    drive(sm, [...RAMP, ...HOLD, ...CRASH], false)
    const out = drive(sm, Array.from({ length: 42 }, () => 0), false) // 350 ms
    expect(out[out.length - 1]).toBe(0)
  })

  it('a held pause still drains to EXACTLY zero, just lazily', () => {
    // No deadline while the hand is down — but a parked bend may not
    // linger forever either; the lazy constant reaches the snap too.
    const sm = follower()
    drive(sm, [...RAMP, ...HOLD, ...CRASH], true)
    const out = drive(sm, Array.from({ length: 72 }, () => 0), true) // 600 ms
    expect(out[out.length - 1]).toBe(0)
  })

  it('a near-still hand cannot steer the bow axis', () => {
    const sm = follower()
    sm.dirX = 0.6
    sm.dirY = 0.8
    aeroFollowStep(sm, 5, 15, DT, true) // speed ~15.8 — below the 40 px/s floor
    expect(sm.dirX).toBeCloseTo(0.6, 10)
    expect(sm.dirY).toBeCloseTo(0.8, 10)
  })
})

describe('crumple — the phases may not overlap the handoff', () => {
  it('the rise window is an untouched sheet: crush exactly 0, held or not', () => {
    // The page copy hides on first upload somewhere inside this window, and
    // the swap's pixel-copy guarantee holds only while the sheet is still a
    // flat card. Not "small" — zero. The hand does not get a say: a ✕
    // pressed and dragged immediately still lifts a flat sheet.
    for (const t of [0, CRUMPLE_RISE_T * 0.5, CRUMPLE_RISE_T * 0.999, CRUMPLE_RISE_T]) {
      for (const held of [false, true]) {
        const ph = crumplePhase(t, held)
        expect(ph.crush).toBe(0)
        expect(ph.falling).toBe(false)
      }
    }
  })

  it('crush rises monotonically to exactly 1 and stays there', () => {
    let prev = 0
    for (let i = 0; i <= 60; i++) {
      const t = CRUMPLE_RISE_T + (i / 60) * (CRUMPLE_CRUSH_T - CRUMPLE_RISE_T)
      const c = crumplePhase(t).crush
      expect(c).toBeGreaterThanOrEqual(prev)
      prev = c
    }
    expect(crumplePhase(CRUMPLE_CRUSH_T).crush).toBe(1)
    expect(crumplePhase(CRUMPLE_CRUSH_T + 10).crush).toBe(1)
  })

  it('gravity waits for the wad', () => {
    // A flat sheet dropping like a stone reads as a glitch — the thing that
    // falls must already be a wad.
    expect(crumplePhase(CRUMPLE_CRUSH_T - 0.001).falling).toBe(false)
    expect(crumplePhase(CRUMPLE_CRUSH_T).falling).toBe(true)
  })

  it('a held wad never falls, no matter how long it is held', () => {
    // The button is down: the ball is IN the hand. Gravity resumes only at
    // release — this is what makes the ✕ a toss and not a timer.
    for (const t of [CRUMPLE_CRUSH_T, CRUMPLE_CRUSH_T + 1, CRUMPLE_CRUSH_T + 60]) {
      const ph = crumplePhase(t, true)
      expect(ph.falling).toBe(false)
      expect(ph.crush).toBe(1) // it still crushes in the grip — only the fall waits
    }
  })

  it('the phase clocks are ordered', () => {
    expect(CRUMPLE_RISE_T).toBeLessThan(CRUMPLE_CRUSH_T)
  })

  it('wadShrink is identity at crush 0 and a sixth at full crush', () => {
    expect(wadShrink(0)).toBe(1)
    expect(wadShrink(1)).toBeCloseTo(0.16, 10)
    expect(wadShrink(0.5)).toBeGreaterThan(wadShrink(1))
  })
})

describe('crumple — the exit is a place, not a time', () => {
  // 1280×720 viewport, r = 100: the wad may not be reported gone while any
  // part of it (or its shadow — the caller inflates r) could still be seen.
  const vw = 1280
  const vh = 720

  it('on screen anywhere inside the rectangle: not gone', () => {
    expect(wadOffscreen(0, 0, 100, vw, vh)).toBe(false)
    expect(wadOffscreen(600, 300, 100, vw, vh)).toBe(false)
    // Straddling an edge: centre outside, extent still reaches in.
    expect(wadOffscreen(vw / 2 + 99, 0, 100, vw, vh)).toBe(false)
    expect(wadOffscreen(0, -(vh / 2 + 99), 100, vw, vh)).toBe(false)
  })

  it('gone only once the whole extent has crossed', () => {
    expect(wadOffscreen(vw / 2 + 101, 0, 100, vw, vh)).toBe(true)
    expect(wadOffscreen(-(vw / 2 + 101), 0, 100, vw, vh)).toBe(true)
    expect(wadOffscreen(0, vh / 2 + 101, 100, vw, vh)).toBe(true)
    expect(wadOffscreen(0, -(vh / 2 + 101), 100, vw, vh)).toBe(true)
  })

  it('a corner exit needs only ONE axis fully out', () => {
    // Off the bottom-right diagonally: the y band was crossed, x was not.
    // Outside the y band is outside the viewport, full stop.
    expect(wadOffscreen(vw / 2 - 50, -(vh / 2 + 101), 100, vw, vh)).toBe(true)
  })
})

describe('crumple — the toss reads the throw', () => {
  it('a dead drop spins not at all (the caller randomizes that case)', () => {
    const out = new THREE.Vector3(9, 9, 9)
    tossSpin(0, 0, out)
    expect(out.length()).toBe(0)
  })

  it('topspin: the axis is ẑ × d̂, rate ∝ speed, saturating', () => {
    const out = new THREE.Vector3()
    // Throw along +x: axis must be +y (camera-facing side rolls with the throw).
    tossSpin(TOSS_SPIN_V0, 0, out)
    expect(out.x).toBeCloseTo(0, 10)
    expect(out.y).toBeCloseTo(1, 10)
    expect(out.z).toBe(0)
    // Throw along −y (down-screen): axis must be +x.
    tossSpin(0, -TOSS_SPIN_V0 * 2, out)
    expect(out.x).toBeCloseTo(2, 10)
    expect(out.y).toBeCloseTo(0, 10)
    // The axis is perpendicular to the throw for any direction.
    tossSpin(371, -842, out)
    expect(out.dot(new THREE.Vector3(371, -842, 0))).toBeCloseTo(0, 8)
    // And the rate saturates at the cap, however hard the fling.
    tossSpin(1e6, 0, out)
    expect(out.length()).toBeCloseTo(TOSS_SPIN_MAX, 10)
  })
})
