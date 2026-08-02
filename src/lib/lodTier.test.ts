import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIERS,
  clampScale,
  clampTiers,
  maxTier,
  seedTier,
  selectLodTier,
  tiersInRange,
} from './lodTier'

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

describe('seedTier', () => {
  // A Surface's first raster happens before its mesh has ever been
  // projected, so birth density is a prior, not a measurement — and the
  // prior is the renderer's pixel ratio (world ≈ CSS px for almost every
  // consumer). Seeding at 1× regardless made retina Surfaces be born at
  // half density: a visible blur-then-pop on every popover open and every
  // page→mesh handoff (measured on lab 014, 2026-08-02: born tier 1,
  // ~130ms of 2.2×-undersampled text, then the tier-3 swap).

  it('seeds at the tier nearest the pixel ratio', () => {
    expect(seedTier(DEFAULT_TIERS, 1)).toBe(1)
    expect(seedTier(DEFAULT_TIERS, 2)).toBe(2)
    // 1.5 sits exactly on a rung of the default ladder (Windows scaling).
    expect(seedTier(DEFAULT_TIERS, 1.5)).toBe(1.5)
    expect(seedTier(DEFAULT_TIERS, 3)).toBe(3)
  })

  it('defaults to the old nearest-1× behavior when no target is given', () => {
    expect(seedTier(DEFAULT_TIERS)).toBe(1)
    expect(seedTier([2, 4])).toBe(2)
  })

  it('an authored range still caps the seed (the ladder arrives pre-sliced)', () => {
    // resolution={[0.25, 1]} on a dpr-2 display: the author said "never
    // above 1×", and birth respects it.
    expect(seedTier(tiersInRange(DEFAULT_TIERS, 0.25, 1), 2)).toBe(1)
    // resolution={[2, 4]} on a dpr-1 display: floor wins upward too.
    expect(seedTier(tiersInRange(DEFAULT_TIERS, 2, 4), 1)).toBe(2)
  })

  it('a 4096-clamped ladder seeds at its clamped ceiling, not above it', () => {
    // A 3000-css-px-wide Surface loses every tier above 4096/3000 ≈ 1.37;
    // dpr 2 must not resurrect an oversize allocation at birth.
    expect(seedTier(clampTiers(DEFAULT_TIERS, 3000, 400), 2)).toBe(1)
  })

  it('ties break toward the lower (cheaper) tier', () => {
    // dpr 1.75 sits exactly between 1.5 and 2 on the default ladder.
    expect(seedTier(DEFAULT_TIERS, 1.75)).toBe(1.5)
  })
})

describe('tiersInRange', () => {
  it('slices the ladder to the inclusive range', () => {
    expect(tiersInRange(DEFAULT_TIERS, 0.5, 3)).toEqual([0.5, 1, 1.5, 2, 3])
    expect(tiersInRange(TIERS, 1, 2)).toEqual([1, 1.5, 2])
  })

  it('normalizes swapped bounds', () => {
    expect(tiersInRange(TIERS, 2, 1)).toEqual([1, 1.5, 2])
  })

  it('treats an infinite bound as open-ended', () => {
    // resolution={[1, Infinity]} = "never below 1:1, no ceiling".
    expect(tiersInRange(DEFAULT_TIERS, 1, Number.POSITIVE_INFINITY)).toEqual([
      1, 1.5, 2, 3, 4, 6,
    ])
  })

  it('a degenerate [k, k] on a tier pins to that tier', () => {
    expect(tiersInRange(TIERS, 1.5, 1.5)).toEqual([1.5])
  })

  it('a range landing between tiers pins to the nearest tier (tie → lower)', () => {
    // 1 and 1.5 both miss [1.1, 1.4] by 0.1 → the cheaper tier wins.
    expect(tiersInRange(DEFAULT_TIERS, 1.1, 1.4)).toEqual([1])
    expect(tiersInRange(DEFAULT_TIERS, 7, 9)).toEqual([6])
    expect(tiersInRange(DEFAULT_TIERS, 0.05, 0.1)).toEqual([0.25])
  })

  it('NaN bounds disable the range (full ladder, not a floor pin)', () => {
    expect(tiersInRange(TIERS, Number.NaN, 2)).toEqual(TIERS)
    expect(tiersInRange(TIERS, 1, Number.NaN)).toEqual(TIERS)
  })

  it('composes with clampTiers: intent range first, physical guard second', () => {
    // [2, 6] on a 1600-css-wide panel: the range keeps [2, 3, 4, 6], then
    // the 4096 long-edge guard drops 3/4/6 (3×1600 = 4800) — the user's
    // floor survives as the sole tier.
    expect(clampTiers(tiersInRange(DEFAULT_TIERS, 2, 6), 1600, 900, 4096)).toEqual([2])
  })

  it('selectLodTier over a sliced ladder saturates at the range ceiling', () => {
    // Close-up demanding 4× under resolution={[0.5, 2]}: covers with the
    // max in-range tier and stays there (no covering tier exists → last).
    const sliced = tiersInRange(DEFAULT_TIERS, 0.5, 2)
    expect(selectLodTier(4, 1, sliced)).toBe(2)
    expect(selectLodTier(4, 2, sliced)).toBe(2)
  })
})

describe('maxTier', () => {
  it('resolves to the highest tier the guard admits (the lab-012 cases)', () => {
    // Card 360×440: 6× = 2640 fits → 6. Wall 880×560: 6× = 5280 is out,
    // 4× = 3520 fits → 4.
    expect(maxTier(DEFAULT_TIERS, 360, 440)).toBe(6)
    expect(maxTier(DEFAULT_TIERS, 880, 560)).toBe(4)
  })

  it('stays on the ladder, not at the guard boundary', () => {
    // 880 admits densities up to 4.65, but the answer is the RUNG 4 — a
    // later switch to auto/range finds the texture already seated.
    expect(maxTier(DEFAULT_TIERS, 880, 100)).toBe(4)
  })

  it('degrades to the ladder floor when even it exceeds the guard', () => {
    expect(maxTier(DEFAULT_TIERS, 20000, 100)).toBe(0.25)
  })
})

describe('clampScale', () => {
  it('passes scales the guard admits through unchanged', () => {
    expect(clampScale(2, 880, 560)).toBe(2)
    expect(clampScale(6, 360, 440)).toBe(6)
  })

  it('clamps to the exact guard boundary, not a tier', () => {
    // The caller asked for a density, not a rung: 880 css px admits up to
    // 4096/880 ≈ 4.65 — closer to the request than tier 4 would be.
    expect(clampScale(6, 880, 560)).toBeCloseTo(4096 / 880, 10)
  })

  it('tolerates degenerate sizes; Infinity clamps to the boundary', () => {
    expect(clampScale(3, 0, 0)).toBe(3)
    expect(clampScale(Number.NaN, 400, 300)).toBeNaN()
    expect(clampScale(Number.POSITIVE_INFINITY, 400, 300)).toBe(4096 / 400)
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
