// LOD tier selection for Surface textures.
//
// GPUs already solve half of this problem: when a texture is *minified*
// (far away), mipmaps + anisotropy pick a pre-shrunk level. There is no
// hardware answer for *magnification* — walk up to a 420-texel-wide panel
// filling 1200 screen px and you get bilinear soup. But drawElementImage
// replays paint records (vector draw commands), so unlike a screenshot we
// can re-rasterize the same DOM at a higher scale and get genuinely sharper
// glyphs — this module decides *when*. Think of it as computing the mip
// level the GPU wishes it had, then generating it from the live source.
//
// density  = desired texels per CSS px = projected device px per CSS px.
//            (density 2 ⇒ the panel occupies twice as many screen pixels
//            as its CSS layout size ⇒ the texture should be rendered 2x.)
// tier     = the canvas backing-store multiplier we actually rasterize at.
//
// Selection is a Schmitt trigger: the upshift threshold (current is
// undersampling by more than `band`) and the downshift threshold (the tier
// below would still oversupply by `band`) are separated by a dead zone, so
// a camera parked on a boundary cannot thrash resize→re-raster→re-upload.

// 0.25 quarters far-panel memory; 4/6 cover retina close-ups (an approached
// panel on a dpr-2 display demands ~4; a grab-pulled one ~6). clampTiers'
// 4096 long-edge guard still bounds the top for large Surfaces.
export const DEFAULT_TIERS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6]

/** Hysteresis fraction: tolerated under/over-supply before switching. */
const BAND = 0.15

/**
 * Pick the texture tier for a given density. Pure; call it with the tier it
 * last returned. Upshifts jump straight to the covering tier (an approach
 * should sharpen once, not ratchet through intermediates); downshifts step
 * one tier per call so a fast pull-back degrades gradually.
 */
export function selectLodTier(
  density: number,
  current: number,
  tiers: readonly number[] = DEFAULT_TIERS,
  band = BAND,
): number {
  if (!Number.isFinite(density) || density <= 0 || tiers.length === 0) {
    return current
  }
  // Re-seat `current` on the ladder (tolerates prop changes / first call).
  let idx = 0
  for (let i = 1; i < tiers.length; i++) {
    if (Math.abs(tiers[i] - current) < Math.abs(tiers[idx] - current)) idx = i
  }
  const seated = tiers[idx]

  if (seated < density * (1 - band)) {
    // Undersampling beyond tolerance: jump to the smallest covering tier.
    for (const t of tiers) if (t >= density) return t
    return tiers[tiers.length - 1]
  }
  if (idx > 0 && tiers[idx - 1] >= density * (1 + band)) {
    // The tier below still oversupplies with margin: relax one step.
    return tiers[idx - 1]
  }
  return seated
}

/**
 * Slice a ladder to an inclusive [min, max] density range — the tuple form
 * of Surface's `resolution` prop (shaped like r3f's `dpr`). The range
 * expresses *intent* (a floor/ceiling on texture density); the ladder's
 * *structure* stays ours — tier spacing is coupled to the hysteresis band,
 * and any contiguous slice of a valid ladder is still thrash-free by
 * construction, which a user-authored ladder would not be.
 *
 * Swapped bounds are normalized. ±Infinity are legitimate open bounds
 * ([1, Infinity] = "never below 1:1"); NaN disables the range. A range
 * landing between tiers (e.g. [1.1, 1.4]) degrades to the single nearest
 * tier — a graceful pin, never an empty ladder.
 */
export function tiersInRange(
  tiers: readonly number[],
  min: number,
  max: number,
): number[] {
  if (tiers.length === 0) return []
  if (Number.isNaN(min) || Number.isNaN(max)) return [...tiers]
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  const within = tiers.filter((t) => t >= lo && t <= hi)
  if (within.length > 0) return within
  // Nothing inside: pin to the tier nearest the *interval* (ties take the
  // lower tier — cheaper memory for the same miss distance).
  let best = tiers[0]
  let bestDist = Number.POSITIVE_INFINITY
  for (const t of tiers) {
    const d = t < lo ? lo - t : t - hi
    if (d < bestDist) {
      best = t
      bestDist = d
    }
  }
  return [best]
}

/**
 * The tier `resolution="max"` resolves to: the highest ladder tier the
 * long-edge guard admits for a given CSS size. "As sharp as the library
 * allows" is a relational answer — it depends on the ladder and the guard,
 * both private to this module — so the library resolves it, not the caller
 * (a measured Surface doesn't even know its size in time to ask). Stays ON
 * the ladder rather than at the exact guard boundary, so a later switch to
 * auto/range finds the texture already seated on a tier.
 */
export function maxTier(
  tiers: readonly number[],
  cssWidth: number,
  cssHeight: number,
  maxDim = 4096,
): number {
  const kept = clampTiers(tiers, cssWidth, cssHeight, maxDim)
  return kept[kept.length - 1]
}

/**
 * Clamp a caller-chosen fixed scale to the same long-edge guard the ladder
 * obeys. Unlike tiers a fixed scale is continuous, so the clamp lands on
 * the exact guard boundary — the caller asked for a density, not a rung,
 * and gets the closest legal one.
 */
export function clampScale(
  scale: number,
  cssWidth: number,
  cssHeight: number,
  maxDim = 4096,
): number {
  const longEdge = Math.max(cssWidth, cssHeight)
  if (!(longEdge > 0) || Number.isNaN(scale)) return scale
  return Math.min(scale, maxDim / longEdge)
}

/**
 * Restrict a tier ladder so no tier would allocate a canvas larger than
 * `maxDim` on its long edge (GPU texture ceilings, memory sanity). Always
 * keeps the smallest tier so every Surface has a valid floor.
 */
export function clampTiers(
  tiers: readonly number[],
  cssWidth: number,
  cssHeight: number,
  maxDim = 4096,
): number[] {
  const longEdge = Math.max(cssWidth, cssHeight)
  const kept = tiers.filter((t) => t * longEdge <= maxDim)
  return kept.length > 0 ? kept : [tiers[0]]
}
