// @vitest-environment happy-dom
//
// The source canvas's size arithmetic. Everything here is about ONE invariant
// that is easy to get wrong and expensive to notice: `setScale` recomputes the
// backing store from the CSS size, so the CSS size is the source of truth and
// a resize that fails to move it is silently undone the next time the LOD
// ladder shifts a tier.
//
// That is not a hypothetical. Measured in the browser during the detached-
// surface spike (2026-07-31): a hand-resize that touched only `canvas.width`
// and `canvas.style.width` held for about a second, then an ordinary LOD
// downshift recomputed 360×460 from the birth size — against a 288×122 CSS
// box — and the two stayed diverged for the rest of the session.
//
// happy-dom has no compositor, so the origin-trial surface is stubbed. These
// tests are about the arithmetic, not about rasterization.

import { beforeEach, describe, expect, it } from 'vitest'
import { createDomTextureSource } from './htmlInCanvas'

interface StubCanvas extends HTMLCanvasElement {
  layoutSubtree: boolean
  onpaint: (() => void) | null
  requestPaint: () => void
}

/**
 * Stub the origin-trial API onto every canvas this module creates, and let a
 * test drive paints by hand. `requestPaint` is deliberately asynchronous-ish
 * (it only records intent) so a test can assert on the state the compositor
 * would see, not on a synchronous side effect.
 */
let paintRequests = 0

beforeEach(() => {
  paintRequests = 0
  const proto = HTMLCanvasElement.prototype as unknown as StubCanvas
  proto.layoutSubtree = false
  proto.onpaint = null
  proto.requestPaint = function (this: StubCanvas) {
    paintRequests++
  }
  // No 2D context stub is needed: the only code that touches `ctx` lives
  // inside `onpaint`, and nothing fires it here.
})

function make(w = 360, h = 460, scale = 1) {
  return createDomTextureSource('<div class="root"></div>', w, h, {
    label: 'test',
    scale,
  })
}

/** The CSS box the canvas is pinned to, as numbers. */
function cssSize(canvas: HTMLCanvasElement): [number, number] {
  return [parseFloat(canvas.style.width), parseFloat(canvas.style.height)]
}

describe('createDomTextureSource sizing', () => {
  it('pins the CSS box to the layout size and the backing store to size × scale', () => {
    const s = make(360, 460, 1.5)
    expect(cssSize(s.canvas)).toEqual([360, 460])
    expect([s.canvas.width, s.canvas.height]).toEqual([540, 690])
    expect(s.size()).toEqual([360, 460])
    s.dispose()
  })

  it('setScale moves the backing store only — the subtree never relayouts', () => {
    const s = make(360, 460, 1)
    s.setScale(2)
    expect([s.canvas.width, s.canvas.height]).toEqual([720, 920])
    // The CSS box is what the DOM lays out against. It must not move, or
    // focus/caret/selection would survive the raster but not the reflow.
    expect(cssSize(s.canvas)).toEqual([360, 460])
    expect(s.size()).toEqual([360, 460])
    s.dispose()
  })

  it('setSize moves the CSS box and the backing store together, holding scale', () => {
    const s = make(360, 460, 1.5)
    s.setSize(288, 122)
    expect(cssSize(s.canvas)).toEqual([288, 122])
    expect([s.canvas.width, s.canvas.height]).toEqual([432, 183])
    expect(s.size()).toEqual([288, 122])
    s.dispose()
  })

  // THE REGRESSION GUARD. If setSize ever stops updating the closed-over
  // width/height, this is the test that fails — and it fails for the same
  // reason the browser did: the next setScale recomputes from the stale size.
  it('a resize SURVIVES a subsequent tier swap', () => {
    const s = make(360, 460, 1.5)
    s.setSize(288, 122)
    // An ordinary LOD downshift, exactly as Surface's useFrame issues it.
    s.setScale(1)
    expect(s.size()).toEqual([288, 122])
    expect(cssSize(s.canvas)).toEqual([288, 122])
    // The killer assertion: 288×122, NOT the birth size of 360×460.
    expect([s.canvas.width, s.canvas.height]).toEqual([288, 122])
    s.dispose()
  })

  it('a tier swap after a resize still scales the NEW size', () => {
    const s = make(360, 460, 1)
    s.setSize(200, 100)
    s.setScale(2)
    expect([s.canvas.width, s.canvas.height]).toEqual([400, 200])
    expect(cssSize(s.canvas)).toEqual([200, 100])
    s.dispose()
  })

  it('setSize is a no-op at the same size, so callers can call it every render', () => {
    const s = make(360, 460)
    const before = paintRequests
    s.setSize(360, 460)
    expect(paintRequests).toBe(before)
    // Surface compares size() across the call to decide whether to mark a
    // texture realloc; a no-op must leave it unchanged.
    expect(s.size()).toEqual([360, 460])
    s.dispose()
  })

  it('setSize requests a repaint when the size really moves', () => {
    const s = make(360, 460)
    const before = paintRequests
    s.setSize(288, 122)
    expect(paintRequests).toBe(before + 1)
    s.dispose()
  })

  it('rounds to whole pixels and never collapses to zero', () => {
    const s = make(360, 460)
    // A measured content box is often fractional; a canvas dimension is not.
    s.setSize(287.6, 121.2)
    expect(s.size()).toEqual([288, 121])
    s.setSize(0, 0)
    expect(s.size()).toEqual([1, 1])
    expect([s.canvas.width, s.canvas.height]).toEqual([1, 1])
    s.dispose()
  })
})
