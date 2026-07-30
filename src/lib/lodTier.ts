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

export const DEFAULT_TIERS = [0.5, 1, 1.5, 2, 3]

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
