// The CSS→mesh translation table.
//
// A Surface never lets a compositor-owned animation play in its texture: on
// Chrome 151 those keyframes DO rasterize, but at ~60 uploads/s, and a
// root-level translate slides pixels *inside* the slab and clips at its
// edge — motion of the whole panel is the mesh's job, not the material's.
//
// So the conductor pauses each CSS animation and asks the style engine what
// it *would* have painted at a series of times (pause → set currentTime →
// getComputedStyle returns the eased, interpolated value). That turns a
// declarative `animate-in fade-in-0 zoom-in-95 slide-in-from-top-2` into a
// small table of samples, which the r3f frame loop replays on the mesh.
//
// The helpers below are the pure half: matrix decomposition and table
// interpolation. Reading the samples out of the browser is the hook's job.

export interface MotionSample {
  /** Normalized progress along the animation, 0..1. */
  t: number
  opacity: number
  /** Uniform scale factor (CSS `scale()` — x and y are averaged). */
  scale: number
  /** Translation in CSS pixels, DOM orientation (y grows downward). */
  x: number
  y: number
}

export interface MotionValue {
  opacity: number
  scale: number
  x: number
  y: number
}

const IDENTITY: Omit<MotionSample, 't' | 'opacity'> = { scale: 1, x: 0, y: 0 }

/**
 * Decompose a computed `transform` into the pieces a mesh can wear.
 *
 * getComputedStyle always resolves to a matrix (never the authored
 * `translateY(12px) scale(.95)`), which is exactly what we want: the
 * browser has already composed every transform function in the chain.
 * Rotation and skew are deliberately dropped — the floating family only
 * ever zooms and slides, and a mesh that inherited skew from a texture
 * would be lying about its geometry.
 */
export function decomposeMatrix(transform: string): Omit<MotionSample, 't' | 'opacity'> {
  if (!transform || transform === 'none') return { ...IDENTITY }

  const m2 = transform.match(/^matrix\(([^)]+)\)$/)
  if (m2) {
    const n = m2[1].split(',').map((v) => parseFloat(v))
    if (n.length !== 6 || n.some((v) => !Number.isFinite(v))) return { ...IDENTITY }
    const [a, b, c, d, e, f] = n
    // Column norms are the scale factors surviving any rotation.
    const sx = Math.hypot(a, b)
    const sy = Math.hypot(c, d)
    return { scale: (sx + sy) / 2, x: e, y: f }
  }

  const m3 = transform.match(/^matrix3d\(([^)]+)\)$/)
  if (m3) {
    const n = m3[1].split(',').map((v) => parseFloat(v))
    if (n.length !== 16 || n.some((v) => !Number.isFinite(v))) return { ...IDENTITY }
    const sx = Math.hypot(n[0], n[1], n[2])
    const sy = Math.hypot(n[4], n[5], n[6])
    return { scale: (sx + sy) / 2, x: n[12], y: n[13] }
  }

  return { ...IDENTITY }
}

/**
 * Read the motion table at normalized progress `p`, linearly interpolating
 * between samples.
 *
 * The easing is already baked into the sample VALUES (each was read at a
 * specific currentTime, so the browser applied the timing function for us) —
 * this only has to reconstruct the curve between the points we asked about.
 * Progress outside 0..1 clamps to the end samples, so a frame that overshoots
 * the duration lands exactly on the final pose rather than extrapolating.
 */
export function sampleAt(samples: readonly MotionSample[], p: number): MotionValue {
  if (samples.length === 0) return { opacity: 1, scale: 1, x: 0, y: 0 }
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!(p > first.t)) return { opacity: first.opacity, scale: first.scale, x: first.x, y: first.y }
  if (p >= last.t) return { opacity: last.opacity, scale: last.scale, x: last.x, y: last.y }

  for (let i = 1; i < samples.length; i++) {
    const b = samples[i]
    if (p > b.t) continue
    const a = samples[i - 1]
    const span = b.t - a.t
    const k = span > 0 ? (p - a.t) / span : 0
    return {
      opacity: a.opacity + (b.opacity - a.opacity) * k,
      scale: a.scale + (b.scale - a.scale) * k,
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
    }
  }
  return { opacity: last.opacity, scale: last.scale, x: last.x, y: last.y }
}

/**
 * Does this table actually ask for motion? tw-animate's `animate-in` with no
 * fade/zoom/slide modifier resolves to an identity curve, and a Surface
 * should not pay a per-frame mesh write to animate nothing.
 */
export function isStatic(samples: readonly MotionSample[], epsilon = 1e-3): boolean {
  if (samples.length < 2) return true
  const a = samples[0]
  return samples.every(
    (s) =>
      Math.abs(s.opacity - a.opacity) < epsilon &&
      Math.abs(s.scale - a.scale) < epsilon &&
      Math.abs(s.x - a.x) < epsilon &&
      Math.abs(s.y - a.y) < epsilon,
  )
}
