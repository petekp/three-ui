import { describe, expect, it } from 'vitest'
import {
  composeFields,
  damping,
  detentField,
  endStops,
  flipImpulse,
  overCenterField,
  step,
  stopsField,
  type Body1D,
  type Field,
} from './physics1D'

// The claim under test: every control feel in the kit — dial detents, switch
// snap, slider stops and travel bounds — is the SAME tiny integrator run over
// different composable force fields. If these hold, the control kit is one
// physics core plus geometry.

const STEP = (Math.PI * 2) / 8

function simulate(body: Body1D, field: Field, seconds: number, dt = 1 / 120): Body1D {
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) step(body, field, dt, 2)
  return body
}

describe('detentField (the dial)', () => {
  const field = composeFields(detentField(8, 50), damping(6))

  it('settles machine-exact into the nearest well', () => {
    const a = simulate({ q: 0.4 * STEP, v: 0 }, field, 8)
    expect(Math.abs(a.q)).toBeLessThan(1e-9)
    expect(Math.abs(a.v)).toBeLessThan(1e-9)

    const b = simulate({ q: 0.6 * STEP, v: 0 }, field, 8)
    expect(Math.abs(b.q - STEP)).toBeLessThan(1e-9)
  })

  it('a flick ratchets forward through wells and is fully deterministic', () => {
    const run = (v0: number) => {
      const body: Body1D = { q: 0, v: v0 }
      const trace: number[] = []
      for (let i = 0; i < 10 * 120; i++) {
        step(body, field, 1 / 120, 2)
        trace.push(body.q)
      }
      return { body, trace }
    }
    const a1 = run(14)
    const a2 = run(14)
    expect(a1.trace).toEqual(a2.trace) // bit-for-bit repeatable

    const wells = (q: number) => Math.round(q / STEP)
    expect(wells(a1.body.q)).toBeGreaterThanOrEqual(1) // it ratcheted
    expect(Math.abs(a1.body.q - wells(a1.body.q) * STEP)).toBeLessThan(1e-9)

    const harder = run(20)
    expect(wells(harder.body.q)).toBeGreaterThanOrEqual(wells(a1.body.q))
  })

  it('stays stable at a coarse 30fps timestep despite the stiff field', () => {
    const body: Body1D = { q: 0.3, v: 0 }
    for (let i = 0; i < 300; i++) {
      step(body, field, 1 / 30, 2)
      expect(Math.abs(body.q)).toBeLessThan(10) // never explodes
    }
    expect(Math.abs(body.q)).toBeLessThan(1e-6) // and still settles
  })
})

describe('overCenterField (the toggle)', () => {
  const SPAN = 0.35
  const field = composeFields(overCenterField(120, SPAN), damping(8))
  const settleFrom = (impulse: number) =>
    simulate({ q: -SPAN, v: impulse }, field, 4).q

  it('poles are stable: no impulse means it stays put', () => {
    expect(Math.abs(settleFrom(0) - -SPAN)).toBeLessThan(1e-9)
  })

  it('has a sharp snap threshold between returning and flipping', () => {
    // Bisect the impulse that separates "falls back to -span" from "snaps
    // over to +span" — the over-center feel IS this discontinuity.
    let lo = 0
    let hi = 10
    expect(settleFrom(lo) < 0).toBe(true)
    expect(settleFrom(hi) > 0).toBe(true)
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (settleFrom(mid) > 0) hi = mid
      else lo = mid
    }
    const threshold = (lo + hi) / 2
    expect(threshold).toBeGreaterThan(0.05)
    expect(threshold).toBeLessThan(9)
    // Just under: comes home. Just over: commits to the far pole. Both
    // settle EXACTLY on a pole — never in between.
    expect(Math.abs(settleFrom(threshold - 0.01) - -SPAN)).toBeLessThan(1e-6)
    expect(Math.abs(settleFrom(threshold + 0.01) - SPAN)).toBeLessThan(1e-6)
  })

  it('flipImpulse finds a tap strength that reliably flips, for any tuning', () => {
    for (const [k, s, c] of [[120, 0.35, 8], [60, 0.25, 5], [300, 0.5, 12]]) {
      const f = composeFields(overCenterField(k, s), damping(c))
      const imp = flipImpulse(f, s)
      expect(settleFromWith(f, s, imp) > 0).toBe(true) // flips
      expect(settleFromWith(f, s, imp / 1.5 - 0.05) < 0).toBe(true) // threshold is real
    }
    function settleFromWith(f: Field, s: number, impulse: number) {
      return simulate({ q: -s, v: impulse }, f, 4).q
    }
  })
})

describe('endStops + stopsField (the slider)', () => {
  const stops = [0, 0.25, 0.5, 0.75, 1]
  const field = composeFields(stopsField(stops, 200), endStops(0, 1, 800), damping(10))

  it('settles exactly on the nearest stop', () => {
    expect(Math.abs(simulate({ q: 0.6, v: 0 }, field, 4).q - 0.5)).toBeLessThan(1e-9)
    expect(Math.abs(simulate({ q: 0.7, v: 0 }, field, 4).q - 0.75)).toBeLessThan(1e-9)
  })

  it('a hard throw never escapes the travel bounds', () => {
    const body: Body1D = { q: 0.5, v: 8 }
    let maxQ = body.q
    for (let i = 0; i < 5 * 120; i++) {
      step(body, field, 1 / 120, 2)
      maxQ = Math.max(maxQ, body.q)
    }
    expect(maxQ).toBeLessThan(1.15) // brief stiff-spring compression only
    expect(Math.abs(body.q - 1)).toBeLessThan(1e-6) // settles on the end stop
    expect(Math.abs(body.v)).toBeLessThan(1e-6)
  })

  it('throws from either direction land inside travel, on stops', () => {
    const down = simulate({ q: 0.5, v: -8 }, field, 5)
    expect(Math.abs(down.q - 0)).toBeLessThan(1e-6)
  })
})
