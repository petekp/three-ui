import { describe, expect, it } from 'vitest'
import { decomposeMatrix, isStatic, sampleAt, type MotionSample } from './motionSamples'

// The numbers below are not invented: they are the values Chrome 151 returned
// from getComputedStyle while a paused `enter` animation was scrubbed inside a
// parked Surface subtree (spike, 2026-07-31). Pinning them here means a future
// refactor of the conductor has to keep agreeing with the browser.

describe('decomposeMatrix', () => {
  it('reads scale and translate out of a 2D matrix', () => {
    // zoom-in-95 + slide-in-from-top-2 at the from-frame.
    const d = decomposeMatrix('matrix(0.95, 0, 0, 0.95, 0, 12)')
    expect(d.scale).toBeCloseTo(0.95, 6)
    expect(d.x).toBe(0)
    expect(d.y).toBe(12)
  })

  it('matches the browser mid-curve sample', () => {
    const d = decomposeMatrix('matrix(0.988364, 0, 0, 0.988364, 0, 2.79259)')
    expect(d.scale).toBeCloseTo(0.988364, 6)
    expect(d.y).toBeCloseTo(2.79259, 5)
  })

  it('treats none and garbage as identity', () => {
    for (const t of ['none', '', 'wobble(3)', 'matrix(1, 2, 3)']) {
      expect(decomposeMatrix(t)).toEqual({ scale: 1, x: 0, y: 0 })
    }
  })

  it('averages non-uniform scale rather than picking an axis', () => {
    expect(decomposeMatrix('matrix(0.5, 0, 0, 1.5, 0, 0)').scale).toBeCloseTo(1, 6)
  })

  it('survives rotation without leaking it into scale', () => {
    // 90° rotation, uniform scale 2 — column norms are still 2.
    const d = decomposeMatrix('matrix(0, 2, -2, 0, 7, 9)')
    expect(d.scale).toBeCloseTo(2, 6)
    expect(d.x).toBe(7)
    expect(d.y).toBe(9)
  })

  it('handles matrix3d', () => {
    const d = decomposeMatrix(
      'matrix3d(0.95, 0, 0, 0, 0, 0.95, 0, 0, 0, 0, 1, 0, 4, 12, 0, 1)',
    )
    expect(d.scale).toBeCloseTo(0.95, 6)
    expect(d.x).toBe(4)
    expect(d.y).toBe(12)
  })
})

describe('sampleAt', () => {
  // The real captured curve: cubic-bezier(.2,.8,.2,1), five samples.
  const curve: MotionSample[] = [
    { t: 0, opacity: 0.3, scale: 0.95, x: 0, y: 12 },
    { t: 0.25, opacity: 0.837099, scale: 0.988364, x: 0, y: 2.79259 },
    { t: 0.5, opacity: 0.962256, scale: 0.997304, x: 0, y: 0.647046 },
    { t: 0.75, opacity: 0.993776, scale: 0.999555, x: 0, y: 0.106702 },
    { t: 1, opacity: 1, scale: 1, x: 0, y: 0 },
  ]

  it('returns the sampled values exactly at sample points', () => {
    for (const s of curve) {
      const v = sampleAt(curve, s.t)
      expect(v.opacity).toBeCloseTo(s.opacity, 9)
      expect(v.scale).toBeCloseTo(s.scale, 9)
      expect(v.y).toBeCloseTo(s.y, 9)
    }
  })

  it('interpolates between samples', () => {
    const v = sampleAt(curve, 0.125)
    expect(v.opacity).toBeCloseTo((0.3 + 0.837099) / 2, 9)
    expect(v.y).toBeCloseTo((12 + 2.79259) / 2, 9)
  })

  it('clamps outside the range instead of extrapolating', () => {
    // A frame that lands past the duration must settle on the final pose,
    // never overshoot it.
    expect(sampleAt(curve, 5).opacity).toBe(1)
    expect(sampleAt(curve, 5).y).toBe(0)
    expect(sampleAt(curve, -3).opacity).toBe(0.3)
    expect(sampleAt(curve, -3).y).toBe(12)
  })

  it('keeps the eased shape — the curve is front-loaded, not linear', () => {
    // cubic-bezier(.2,.8,.2,1) is most of the way there by the quarter mark;
    // a linear reading would put opacity near 0.475 at t=0.25.
    expect(sampleAt(curve, 0.25).opacity).toBeGreaterThan(0.8)
  })

  it('survives an empty or single-sample table', () => {
    expect(sampleAt([], 0.5)).toEqual({ opacity: 1, scale: 1, x: 0, y: 0 })
    const one: MotionSample[] = [{ t: 0, opacity: 0.4, scale: 0.5, x: 1, y: 2 }]
    expect(sampleAt(one, 0.9)).toEqual({ opacity: 0.4, scale: 0.5, x: 1, y: 2 })
  })
})

describe('isStatic', () => {
  it('flags an identity curve so nothing is driven', () => {
    expect(
      isStatic([
        { t: 0, opacity: 1, scale: 1, x: 0, y: 0 },
        { t: 1, opacity: 1, scale: 1, x: 0, y: 0 },
      ]),
    ).toBe(true)
  })

  it('does not flag a real fade', () => {
    expect(
      isStatic([
        { t: 0, opacity: 0, scale: 1, x: 0, y: 0 },
        { t: 1, opacity: 1, scale: 1, x: 0, y: 0 },
      ]),
    ).toBe(false)
  })

  it('catches a pure slide with no fade or zoom', () => {
    expect(
      isStatic([
        { t: 0, opacity: 1, scale: 1, x: 0, y: 8 },
        { t: 1, opacity: 1, scale: 1, x: 0, y: 0 },
      ]),
    ).toBe(false)
  })
})
