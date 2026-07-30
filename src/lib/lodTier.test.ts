import { describe, expect, it } from 'vitest'
import { DEFAULT_TIERS, clampTiers, selectLodTier } from './lodTier'

// density = desired texels per CSS px (projected device px per css px).
// selectLodTier is a Schmitt trigger over a quantized tier ladder: the
// upshift and downshift thresholds are separated by the hysteresis band so a
// camera parked exactly on a boundary can never oscillate the tier.

const TIERS = [0.5, 1, 1.5, 2, 3]

describe('selectLodTier', () => {
  it('upshifts to the smallest tier covering the density', () => {
    expect(selectLodTier(1.3, 1, TIERS)).toBe(1.5)
    expect(selectLodTier(1.8, 1, TIERS)).toBe(2)
  })

  it('jumps multiple tiers up in one step (approach should sharpen once, not ratchet)', () => {
    expect(selectLodTier(2.6, 0.5, TIERS)).toBe(3)
    // Retina close-up on the default ladder: demand ~4.3 lands on 6.
    expect(selectLodTier(4.3, 1.5, DEFAULT_TIERS)).toBe(6)
  })

  it('clamps to the max tier when density exceeds the ladder', () => {
    expect(selectLodTier(5.2, 1, TIERS)).toBe(3)
    expect(selectLodTier(5.2, 3, TIERS)).toBe(3)
  })

  it('tolerates small undersampling inside the band (no upshift)', () => {
    // 5% under-provisioned is invisible; re-rastering for it is waste.
    expect(selectLodTier(1.05, 1, TIERS)).toBe(1)
  })

  it('downshifts one step when the tier below still satisfies with margin', () => {
    expect(selectLodTier(0.8, 2, TIERS)).toBe(1.5)
    // …and continues stepping on later evaluations until settled.
    expect(selectLodTier(0.8, 1.5, TIERS)).toBe(1)
    expect(selectLodTier(0.8, 1, TIERS)).toBe(1)
  })

  it('never oscillates at a boundary (hysteresis gap)', () => {
    // Sitting just above tier 1.5's capacity: neither up nor down fires.
    expect(selectLodTier(1.45, 1.5, TIERS)).toBe(1.5)
    expect(selectLodTier(1.55, 1.5, TIERS)).toBe(1.5)
    // Sticky over-provision: 2 holds until density falls below 1.5/(1+band).
    expect(selectLodTier(1.55, 2, TIERS)).toBe(2)
    expect(selectLodTier(1.2, 2, TIERS)).toBe(1.5)
  })

  it('holds the floor tier at vanishing density', () => {
    expect(selectLodTier(0.05, 0.5, TIERS)).toBe(0.5)
    expect(selectLodTier(0, 1, TIERS)).toBe(1) // degenerate input: no change
    expect(selectLodTier(Number.NaN, 1, TIERS)).toBe(1)
  })

  it('adopts the nearest tier when current is not on the ladder', () => {
    expect(selectLodTier(1.0, 1.1, TIERS)).toBe(1)
  })
})

describe('clampTiers', () => {
  it('drops tiers whose texture would exceed the max dimension', () => {
    // 420×300 css at maxDim 1024 → 3x (1260) is out, 2x (840) stays.
    expect(clampTiers(TIERS, 420, 300, 1024)).toEqual([0.5, 1, 1.5, 2])
  })

  it('always keeps at least the smallest tier', () => {
    expect(clampTiers(TIERS, 8000, 100, 1024)).toEqual([0.5])
  })

  it('defaults leave typical panel sizes untouched', () => {
    // 420 css wide at 6x = 2520 — inside the 4096 guard.
    expect(clampTiers(DEFAULT_TIERS, 420, 300)).toEqual(DEFAULT_TIERS)
  })

  it('default ladder spans 0.25–6 (far-memory return to retina close-up)', () => {
    expect(DEFAULT_TIERS[0]).toBe(0.25)
    expect(DEFAULT_TIERS[DEFAULT_TIERS.length - 1]).toBe(6)
  })
})
