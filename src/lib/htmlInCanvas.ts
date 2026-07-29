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
  /** Schedule a repaint (call once per frame for live content). */
  repaint: () => void
  /** True once at least one paint has succeeded. */
  painted: () => boolean
  dispose: () => void
}

/**
 * Mounts `markup` as a live DOM subtree inside a hidden layout-canvas and
 * rasterizes it on every repaint() via drawElementImage.
 */
export function createDomTextureSource(
  markup: string,
  width: number,
  height: number,
  onError?: (err: unknown) => void,
): DomTextureSource {
  const canvas = document.createElement('canvas') as TrialCanvas
  canvas.width = width
  canvas.height = height
  canvas.layoutSubtree = true
  // Must stay in-document AND on-screen to get paint records — off-screen
  // (left:-10000px) canvases are skipped by the compositor and never paint.
  // Parking it behind the page (z-index:-1) keeps it painted but unseen.
  canvas.style.cssText =
    'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;'

  const host = document.createElement('div')
  host.innerHTML = markup
  const element = (host.firstElementChild ?? host) as HTMLElement
  canvas.appendChild(element)
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d') as TrialContext2D
  let ok = false

  canvas.onpaint = () => {
    try {
      ctx.clearRect(0, 0, width, height)
      ctx.drawElementImage(element, 0, 0)
      ok = true
    } catch (err) {
      ok = false
      onError?.(err)
    }
  }
  canvas.requestPaint()

  return {
    canvas,
    element,
    repaint: () => canvas.requestPaint(),
    painted: () => ok,
    dispose: () => {
      canvas.onpaint = null
      canvas.remove()
    },
  }
}
