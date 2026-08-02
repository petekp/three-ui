// Surface chrome — the visual truth a Surface inherits from its own DOM.
//
// A Surface's texture is a rectangle, but the element painted into it almost
// never is: real components have border-radius, and they cast box-shadows the
// rasterizer cannot capture (an outer shadow paints OUTSIDE the element's
// layout box, and `drawElementImage` rasterizes the box). Worse, the corners
// of the texture are not even transparent — the `.ui-root` contract puts the
// consumer's app background on the content root, so the region outside a
// rounded corner is opaquely painted in the app's background color (measured:
// corner texel 255,255,255,255 under a 14px-radius card). The texture cannot
// say where the element ends; only the element's computed style can.
//
// So the element is measured, and the measurement is the API:
//
//   - `measureSurfaceChrome` reads computed border-radius and box-shadow off
//     the drawn subtree (walking a single-child chain, because a SurfaceApp
//     roots its component two containers deep).
//   - `Surface` re-measures on the compositor's own paint signal — the same
//     paintCount that drives uploads — so a style change reaches the mask on
//     the frame its pixels change, and an idle Surface never measures at all.
//   - The radius becomes an analytic SDF mask (GLSL below): corners are cut
//     by geometry-in-the-shader, resolution-independent, crisp at every LOD
//     tier — not by texture alpha, which is opaque there.
//   - The shadow layers become data (`SurfaceShadowLayer[]`) a consumer can
//     render at rest-truth and evolve dynamically — height, tilt, whatever
//     the scene's physics wants — with identity meaning "exactly the DOM".

export interface SurfaceShadowLayer {
  /** Horizontal offset, CSS px (positive = right, in DOM screen space). */
  x: number
  /** Vertical offset, CSS px (positive = DOWN — DOM screen space, not world). */
  y: number
  /** CSS blur radius, px. The Gaussian's σ is blur/2 (spec). */
  blur: number
  /** Spread, px — expands (or, negative, shrinks) the shadow rect. */
  spread: number
  /** sRGB 0–1 plus alpha, exactly as the page composites it. */
  color: [number, number, number, number]
}

export interface SurfaceChrome {
  /** Corner radii tl, tr, br, bl — CSS px in the surface's own coordinate. */
  radii: [number, number, number, number]
  /** Outer box-shadow layers, first = topmost, `inset` layers excluded. */
  shadow: SurfaceShadowLayer[]
}

export const EMPTY_CHROME: SurfaceChrome = {
  radii: [0, 0, 0, 0],
  shadow: [],
}

// ── box-shadow ───────────────────────────────────────────────────────────

/** Split on commas that are not inside parentheses — `rgba(a, b, …)` safe. */
function splitLayers(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i))
      start = i + 1
    }
  }
  out.push(text.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}

function parseColor(token: string): [number, number, number, number] | null {
  // Computed style serializes sRGB colors as rgb()/rgba(); authored strings
  // may also hand us hex. Wider-gamut serializations (oklch, color(srgb …))
  // are not worth a color library here — the caller skips the layer.
  const fn = /^rgba?\(([^)]+)\)$/.exec(token)
  if (fn) {
    const parts = fn[1].split(/[,/]/).map((s) => s.trim()).filter(Boolean)
    if (parts.length < 3) return null
    const num = (s: string, scale: number) =>
      s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) / scale
    const r = num(parts[0], 255)
    const g = num(parts[1], 255)
    const b = num(parts[2], 255)
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    if ([r, g, b, a].some((v) => Number.isNaN(v))) return null
    return [r, g, b, a]
  }
  const hex = /^#([0-9a-f]{3,8})$/i.exec(token)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const v = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255
    return [v(0), v(2), v(4), h.length === 8 ? v(6) : 1]
  }
  return null
}

/**
 * Parse a `box-shadow` value (computed or authored form) into layers.
 *
 * `inset` layers are dropped on purpose: an inset shadow paints INSIDE the
 * border box, so it is already in the rasterized texture — rendering it again
 * would double it. Layers whose color can't be read (exotic color-space
 * serializations) are dropped too, with a warning, rather than guessed at.
 */
export function parseBoxShadow(text: string): SurfaceShadowLayer[] {
  if (!text || text === 'none') return []
  const layers: SurfaceShadowLayer[] = []
  for (const seg of splitLayers(text)) {
    const tokens = seg.split(/\s+(?![^(]*\))/).filter(Boolean)
    if (tokens.some((t) => t === 'inset')) continue
    const lengths: number[] = []
    let color: [number, number, number, number] | null = null
    let badColor = false
    for (const t of tokens) {
      if (/^-?[\d.]+(px)?$/.test(t)) lengths.push(parseFloat(t))
      else {
        const c = parseColor(t)
        if (c) color = c
        else badColor = true
      }
    }
    if (lengths.length < 2) continue
    if (!color) {
      if (badColor) {
        console.warn(`[three-ui] parseBoxShadow: unreadable color in "${seg}" — layer skipped.`)
        continue
      }
      // No color token at all means currentColor; without an element to
      // resolve it against, black is the CSS initial ink.
      color = [0, 0, 0, 1]
    }
    layers.push({
      x: lengths[0],
      y: lengths[1],
      blur: Math.max(lengths[2] ?? 0, 0),
      spread: lengths[3] ?? 0,
      color,
    })
  }
  return layers
}

// ── border-radius ────────────────────────────────────────────────────────

function radiusPx(value: string, basis: number): number {
  // Per-corner computed values are "Npx", "N%", or two-value "x y" for
  // elliptical corners — we take the first component (documented: elliptical
  // corners are approximated by their x radius).
  const first = value.split(/\s+/)[0] ?? '0'
  if (first.endsWith('%')) return (parseFloat(first) / 100) * basis
  return parseFloat(first) || 0
}

/**
 * Resolve per-corner computed values against a box, clamped by the CSS
 * overlap rule (when adjacent radii would exceed a side, all radii scale by
 * the worst-case factor — the same reduction the browser paints with).
 * Pure, so the clamp math is testable without a layout engine.
 */
export function resolveRadii(
  values: [string, string, string, string],
  w: number,
  h: number,
): [number, number, number, number] {
  if (w <= 0 || h <= 0) return [0, 0, 0, 0]
  const basis = Math.min(w, h)
  let tl = radiusPx(values[0], basis)
  let tr = radiusPx(values[1], basis)
  let br = radiusPx(values[2], basis)
  let bl = radiusPx(values[3], basis)
  const f = Math.min(
    1,
    w / Math.max(tl + tr, 1e-6),
    h / Math.max(tr + br, 1e-6),
    w / Math.max(br + bl, 1e-6),
    h / Math.max(bl + tl, 1e-6),
  )
  if (f < 1) {
    tl *= f
    tr *= f
    br *= f
    bl *= f
  }
  return [tl, tr, br, bl]
}

/** Read an element's per-corner radii, resolved to px against its own box. */
export function readRadii(el: HTMLElement): [number, number, number, number] {
  const cs = getComputedStyle(el)
  return resolveRadii(
    [
      cs.borderTopLeftRadius,
      cs.borderTopRightRadius,
      cs.borderBottomRightRadius,
      cs.borderBottomLeftRadius,
    ],
    el.offsetWidth,
    el.offsetHeight,
  )
}

// ── measurement ──────────────────────────────────────────────────────────

/**
 * Measure the chrome of a drawn subtree: walk from the drawn root down a
 * single-element-child chain (a SurfaceApp's component sits two containers
 * deep: source root → `.ui-root` host → the component) and take radii from
 * the first element that has any, shadow from the first that casts one.
 *
 * The walk stops where the chain branches: a root holding several children
 * side by side is a composite, not a single rounded thing, and gets no
 * chrome. Auto-measure assumes the chrome-owning element fills the surface —
 * the house pattern, where the content root declares the surface's own size.
 */
export function measureSurfaceChrome(root: HTMLElement): SurfaceChrome {
  let radii: [number, number, number, number] | null = null
  let shadow: SurfaceShadowLayer[] | null = null
  let el: HTMLElement | null = root
  for (let depth = 0; el && depth < 5; depth++) {
    const r = readRadii(el)
    if (!radii && (r[0] || r[1] || r[2] || r[3])) radii = r
    if (!shadow) {
      const bs = getComputedStyle(el).boxShadow
      if (bs && bs !== 'none') {
        const layers = parseBoxShadow(bs)
        if (layers.length) shadow = layers
      }
    }
    if (radii && shadow) break
    el = el.childElementCount === 1 ? (el.firstElementChild as HTMLElement) : null
  }
  if (!radii && !shadow) return EMPTY_CHROME
  return { radii: radii ?? [0, 0, 0, 0], shadow: shadow ?? [] }
}

export function chromeEquals(a: SurfaceChrome, b: SurfaceChrome): boolean {
  for (let i = 0; i < 4; i++) if (a.radii[i] !== b.radii[i]) return false
  if (a.shadow.length !== b.shadow.length) return false
  for (let i = 0; i < a.shadow.length; i++) {
    const s = a.shadow[i]
    const t = b.shadow[i]
    if (s.x !== t.x || s.y !== t.y || s.blur !== t.blur || s.spread !== t.spread) return false
    for (let c = 0; c < 4; c++) if (s.color[c] !== t.color[c]) return false
  }
  return true
}

// ── the mask, in both languages ──────────────────────────────────────────

/**
 * Signed distance from a UV point to the surface's rounded-rect edge, in CSS
 * px — negative inside. `radii` order is tl, tr, br, bl; `v = 1` is the TOP
 * of the content (CanvasTexture flipY), which is why +y picks the top pair.
 * This is the JS twin of `threeUiRadiusSd` below; the raycaster uses it so a
 * ray and a fragment agree about where the corner ends.
 */
export function surfaceRadiusSd(
  u: number,
  v: number,
  width: number,
  height: number,
  radii: [number, number, number, number],
): number {
  const px = (u - 0.5) * width
  const py = (v - 0.5) * height
  const r = px < 0 ? (py > 0 ? radii[0] : radii[3]) : py > 0 ? radii[1] : radii[2]
  const dx = Math.abs(px) - width / 2 + r
  const dy = Math.abs(py) - height / 2 + r
  const ox = Math.max(dx, 0)
  const oy = Math.max(dy, 0)
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ox, oy) - r
}

/**
 * The GLSL half of the mask, for a custom material (`material="none"`) that
 * wants its Surface cut to the element's corners. Prepend to the fragment
 * shader, declare the two uniforms, and multiply your alpha by
 * `threeUiRadiusMask(vUv)` (feed it the UNMIRRORED uv you sample with).
 * `Surface` injects this same chunk into its own standard material — custom
 * shaders opt in because only they know their varyings.
 */
export const SURFACE_RADIUS_GLSL = /* glsl */ `
  uniform vec4 uThreeUiRadii; // tl, tr, br, bl — CSS px of the source
  uniform vec2 uThreeUiSize;  // source CSS px
  float threeUiRadiusSd(vec2 uv) {
    vec2 p = (uv - 0.5) * uThreeUiSize; // +y = content top (flipY texture)
    float r = p.x < 0.0
      ? (p.y > 0.0 ? uThreeUiRadii.x : uThreeUiRadii.w)
      : (p.y > 0.0 ? uThreeUiRadii.y : uThreeUiRadii.z);
    vec2 d = abs(p) - uThreeUiSize * 0.5 + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
  }
  // Antialiased coverage: 1 inside, 0 outside, one fragment-width of edge.
  // Analytic, so the corner stays crisp at every LOD tier — the texture's
  // own corner texels are opaquely painted app background and cannot help.
  float threeUiRadiusMask(vec2 uv) {
    float sd = threeUiRadiusSd(uv);
    float aa = max(fwidth(sd), 1e-4);
    return 1.0 - smoothstep(-aa, aa, sd);
  }
`
