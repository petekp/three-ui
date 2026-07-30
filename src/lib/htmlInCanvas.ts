// Feature detection + plumbing for the Chrome "HTML in Canvas" origin trial
// (Chrome 148–150). https://developer.chrome.com/blog/html-in-canvas-origin-trial
//
// Empirically discovered contract (Chrome 150, --enable-features=CanvasDrawElement):
//   1. The source element must be a CHILD of the canvas you draw into, and the
//      canvas needs `canvas.layoutSubtree = true` so the child gets layout.
//   2. drawElementImage() only succeeds inside the canvas's `onpaint` callback,
//      scheduled via `canvas.requestPaint()`. Outside it you get
//      "No cached paint record for element".
//   3. The draw is DEFERRED to paint time: readback (getImageData/drawImage)
//      returns blank until the next paint completes, then works normally.
//      So a texture upload always trails the DOM by one frame.
//
// Full API surface found on HTMLCanvasElement: layoutSubtree, onpaint,
// requestPaint(), captureElementImage(), getElementTransform().
// Plus CanvasRenderingContext2D.drawElementImage and (on WebGL2)
// texElementImage2D for direct-to-texture upload.

export interface HtmlInCanvasSupport {
  drawElementImage: boolean
  texElementImage2D: boolean
}

export function detectHtmlInCanvas(): HtmlInCanvasSupport {
  return {
    drawElementImage:
      typeof CanvasRenderingContext2D !== 'undefined' &&
      'drawElementImage' in CanvasRenderingContext2D.prototype,
    texElementImage2D:
      typeof WebGL2RenderingContext !== 'undefined' &&
      'texElementImage2D' in WebGL2RenderingContext.prototype,
  }
}

interface TrialCanvas extends HTMLCanvasElement {
  layoutSubtree: boolean
  onpaint: (() => void) | null
  requestPaint: () => void
}

interface TrialContext2D extends CanvasRenderingContext2D {
  drawElementImage: (el: Element, x: number, y: number) => unknown
}

export interface DomTextureSource {
  /** The 2D canvas receiving the rasterized DOM — feed this to CanvasTexture. */
  canvas: HTMLCanvasElement
  /** The live DOM element being rasterized. Mutate it; changes show up. */
  element: HTMLElement
  /** Force a repaint request (rarely needed — see paintCount). */
  repaint: () => void
  /** Current texture scale (backing-store px per CSS px). */
  scale: () => number
  /**
   * Re-rasterize the subtree at `width×k`/`height×k` backing-store pixels.
   * drawElementImage replays paint records — vector draw commands — so this
   * is a true re-render (sharper glyphs), not an upscale. The canvas's CSS
   * size stays pinned, so the subtree never relayouts and DOM state (focus,
   * caret, selection) is untouched. The repaint rides the normal onpaint
   * path: paintCount advances, so upload-on-paint consumers need no extra
   * plumbing.
   */
  setScale: (k: number) => void
  /** True once at least one paint has succeeded. */
  painted: () => boolean
  /**
   * Number of paints that have hit the canvas. The compositor fires onpaint
   * BY ITSELF whenever the subtree's paint record changes — DOM mutations,
   * transitions, paint-property CSS animations, caret blink — so this
   * counter advancing IS the "content changed" signal, and while it's
   * still, the subtree is visually quiescent. (Compositor-side properties
   * — animated opacity/transform — never enter the paint record and are
   * invisible here AND to drawElementImage itself.)
   */
  paintCount: () => number
  dispose: () => void
}

export interface DomTextureSourceOptions {
  /** Name shown in the paint-stats diagnostics registry. */
  label?: string
  /** Initial texture scale (backing-store px per CSS px). Default 1. */
  scale?: number
  onError?: (err: unknown) => void
}

// Diagnostics: every live source registers here so multi-Surface paint
// behavior is observable (window.__threeUI.stats() in devtools). The open
// question this answers: parked source canvases all stack at the same fixed
// position, occluding each other — do the occluded ones keep painting?
// A source whose `paints` counter stalls while others advance is starved.
export interface PaintStats {
  label: string
  paints: number
  errors: number
  /** Current LOD texture scale (backing-store px per CSS px). */
  scale: number
  lastError?: string
}

const registry = new Set<PaintStats>()
let sourceSeq = 0

declare global {
  interface Window {
    __threeUI?: { stats: () => PaintStats[] }
  }
}

if (typeof window !== 'undefined') {
  window.__threeUI = {
    stats: () => Array.from(registry, (s) => ({ ...s })),
  }
}

/**
 * Mounts `markup` as a live DOM subtree inside a hidden layout-canvas and
 * rasterizes it on every repaint() via drawElementImage.
 */
export function createDomTextureSource(
  markup: string,
  width: number,
  height: number,
  options: DomTextureSourceOptions = {},
): DomTextureSource {
  const { label = `source-${sourceSeq++}`, onError } = options
  let scale = clampScale(options.scale ?? 1)
  const canvas = document.createElement('canvas') as TrialCanvas
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  canvas.layoutSubtree = true
  // Must stay in-document AND on-screen to get paint records — off-screen
  // (left:-10000px) canvases are skipped by the compositor and never paint.
  // Parking it behind the page (z-index:-1) keeps it painted but unseen.
  // CSS size is pinned to the layout size so backing-store changes
  // (setScale) never relayout the subtree — focus/caret/selection survive.
  canvas.style.cssText =
    `position:fixed;left:0;top:0;z-index:-1;pointer-events:none;` +
    `width:${width}px;height:${height}px;`

  const host = document.createElement('div')
  host.innerHTML = markup
  const element = (host.firstElementChild ?? host) as HTMLElement
  canvas.appendChild(element)
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d') as TrialContext2D
  let ok = false

  const stats: PaintStats = { label, paints: 0, errors: 0, scale }
  registry.add(stats)

  canvas.onpaint = () => {
    try {
      // Resizing the canvas resets context state, so the transform is
      // (re)applied per paint. drawElementImage honors the CTM: the paint
      // record replays scaled, re-rasterizing text at the new density.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.drawElementImage(element, 0, 0)
      ok = true
      stats.paints++
    } catch (err) {
      ok = false
      stats.errors++
      stats.lastError = String(err)
      onError?.(err)
    }
  }
  canvas.requestPaint()

  return {
    canvas,
    element,
    repaint: () => canvas.requestPaint(),
    scale: () => scale,
    setScale: (k: number) => {
      const next = clampScale(k)
      if (next === scale) return
      scale = next
      stats.scale = next
      // Resizing clears the backing store, but nothing uploads the blank:
      // consumers only upload after paintCount advances, which happens when
      // the requested paint below completes with the fresh raster.
      canvas.width = Math.max(1, Math.round(width * next))
      canvas.height = Math.max(1, Math.round(height * next))
      canvas.requestPaint()
    },
    painted: () => ok,
    paintCount: () => stats.paints,
    dispose: () => {
      canvas.onpaint = null
      canvas.remove()
      registry.delete(stats)
    },
  }
}

function clampScale(k: number): number {
  return Number.isFinite(k) ? Math.min(8, Math.max(0.1, k)) : 1
}
