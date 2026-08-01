// @vitest-environment happy-dom
//
// The layout oracle's pure math and its plumbing. happy-dom has no layout
// engine — offsetWidth is 0 and offsetParent is null for everything — so
// these tests stub the offset properties and exercise what the oracle DOES
// with measurements: the world-pose projection, identity-stable rect reuse,
// change coalescing, and teardown. Whether real CSS produces the right boxes
// is the browser's half, verified live (see the lab journal).

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLayoutOracle,
  paneRectsEqual,
  paneWorldPose,
  type LayoutOracle,
} from './layoutOracle'

// happy-dom's offsetWidth/offsetParent are stubs; give an element a real box.
function lay(
  el: HTMLElement,
  x: number,
  y: number,
  width: number,
  height: number,
  offsetParent: Element | null = null,
) {
  Object.defineProperty(el, 'offsetLeft', { value: x, configurable: true })
  Object.defineProperty(el, 'offsetTop', { value: y, configurable: true })
  Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true })
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true })
  Object.defineProperty(el, 'offsetParent', { value: offsetParent, configurable: true })
}

const oracles: LayoutOracle[] = []
function oracle(markup: string, w = 1200, h = 800) {
  const o = createLayoutOracle(markup, w, h)
  oracles.push(o)
  return o
}
afterEach(() => {
  while (oracles.length) oracles.pop()!.dispose()
})

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()))

describe('paneWorldPose', () => {
  it('centres the rig at the origin with y up', () => {
    // A pane exactly filling the rig sits at the origin, full size.
    expect(paneWorldPose({ x: 0, y: 0, width: 1200, height: 800 }, 1200, 800, 200)).toEqual({
      x: 0,
      y: 0,
      width: 6,
      height: 4,
    })
  })

  it('maps DOM top-left to world upper-left', () => {
    // A 200×100 pane at the rig's top-left corner: centre is left of and
    // ABOVE the rig centre — DOM y grows down, world y grows up.
    const pose = paneWorldPose({ x: 0, y: 0, width: 200, height: 100 }, 1200, 800, 200)
    expect(pose.x).toBeCloseTo((100 - 600) / 200)
    expect(pose.y).toBeCloseTo(-(50 - 400) / 200)
    expect(pose.y).toBeGreaterThan(0)
  })

  it('scales by px', () => {
    const at200 = paneWorldPose({ x: 300, y: 200, width: 400, height: 300 }, 1200, 800, 200)
    const at100 = paneWorldPose({ x: 300, y: 200, width: 400, height: 300 }, 1200, 800, 100)
    expect(at100.width).toBeCloseTo(at200.width * 2)
    expect(at100.x).toBeCloseTo(at200.x * 2)
  })
})

describe('measure', () => {
  it('collects panes keyed by attribute value', () => {
    const o = oracle(`<div>
      <div data-pane="a"></div>
      <div data-pane="b"></div>
    </div>`)
    const [a, b] = Array.from(
      o.element.querySelectorAll<HTMLElement>('[data-pane]'),
    )
    lay(a, 10, 20, 300, 400)
    lay(b, 320, 20, 500, 400)
    const rects = o.measure()
    expect(rects.get('a')).toEqual({ x: 10, y: 20, width: 300, height: 400 })
    expect(rects.get('b')).toEqual({ x: 320, y: 20, width: 500, height: 400 })
  })

  it('accumulates offsets through positioned wrappers up to the rig', () => {
    const o = oracle(`<div id="wrap"><div data-pane="nested"></div></div>`)
    const wrap = o.element.querySelector<HTMLElement>('#wrap')!
    const pane = o.element.querySelector<HTMLElement>('[data-pane]')!
    // wrap is positioned (an offsetParent) at (100, 50) in the rig; the pane
    // is at (10, 5) within wrap.
    lay(wrap, 100, 50, 600, 700, o.element)
    lay(pane, 10, 5, 200, 300, wrap)
    expect(o.measure().get('nested')).toEqual({ x: 110, y: 55, width: 200, height: 300 })
  })

  it('treats a zero-box pane as absent (display: none semantics)', () => {
    const o = oracle(`<div data-pane="a"></div><div data-pane="hidden"></div>`)
    const [a, hidden] = Array.from(o.element.querySelectorAll<HTMLElement>('[data-pane]'))
    lay(a, 0, 0, 100, 100)
    lay(hidden, 0, 0, 0, 0)
    const rects = o.measure()
    expect(rects.has('a')).toBe(true)
    expect(rects.has('hidden')).toBe(false)
  })

  it('reuses rect identity for unchanged panes', () => {
    const o = oracle(`<div data-pane="a"></div><div data-pane="b"></div>`)
    const [a, b] = Array.from(o.element.querySelectorAll<HTMLElement>('[data-pane]'))
    lay(a, 0, 0, 100, 100)
    lay(b, 100, 0, 100, 100)
    let rects: Map<string, unknown> = new Map()
    o.observe((r) => (rects = r))
    const firstA = rects.get('a')
    // Move b only.
    lay(b, 200, 0, 100, 100)
    const next = o.measure()
    expect(next.get('a')).toBe(firstA)
    expect(next.get('b')).not.toBe(rects.get('b'))
  })
})

describe('observe', () => {
  it('delivers current rects synchronously on subscribe', () => {
    const o = oracle(`<div data-pane="a"></div>`)
    lay(o.element.querySelector<HTMLElement>('[data-pane]')!, 5, 6, 70, 80)
    const cb = vi.fn()
    o.observe(cb)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].get('a')).toEqual({ x: 5, y: 6, width: 70, height: 80 })
  })

  it('coalesces a mutation burst into one emission', async () => {
    const o = oracle(`<div data-pane="a"></div>`)
    const pane = o.element.querySelector<HTMLElement>('[data-pane]')!
    lay(pane, 0, 0, 100, 100)
    const cb = vi.fn()
    o.observe(cb)
    cb.mockClear()
    // A class toggle plus a style write: two MO records, one measure.
    lay(pane, 0, 0, 240, 100)
    o.element.className = 'collapsed'
    pane.style.color = 'red'
    await flush()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].get('a').width).toBe(240)
  })

  it('does not emit when nothing moved', async () => {
    const o = oracle(`<div data-pane="a"></div>`)
    lay(o.element.querySelector<HTMLElement>('[data-pane]')!, 0, 0, 100, 100)
    const cb = vi.fn()
    o.observe(cb)
    cb.mockClear()
    // A mutation that changes no box.
    o.element.querySelector('[data-pane]')!.setAttribute('data-inert', '1')
    await flush()
    expect(cb).not.toHaveBeenCalled()
  })

  it('reports pane removal', async () => {
    const o = oracle(`<div data-pane="a"></div><div data-pane="b"></div>`)
    const [a, b] = Array.from(o.element.querySelectorAll<HTMLElement>('[data-pane]'))
    lay(a, 0, 0, 100, 100)
    lay(b, 100, 0, 100, 100)
    const cb = vi.fn()
    o.observe(cb)
    cb.mockClear()
    b.remove()
    await flush()
    expect(cb).toHaveBeenCalledTimes(1)
    const rects = cb.mock.calls[0][0]
    expect(rects.has('a')).toBe(true)
    expect(rects.has('b')).toBe(false)
  })

  it('stops delivering after unsubscribe and after dispose', async () => {
    const o = oracle(`<div data-pane="a"></div>`)
    const pane = o.element.querySelector<HTMLElement>('[data-pane]')!
    lay(pane, 0, 0, 100, 100)
    const cb = vi.fn()
    const off = o.observe(cb)
    cb.mockClear()
    off()
    lay(pane, 0, 0, 200, 100)
    pane.className = 'x'
    await flush()
    expect(cb).not.toHaveBeenCalled()

    const cb2 = vi.fn()
    o.observe(cb2)
    cb2.mockClear()
    o.dispose()
    lay(pane, 0, 0, 300, 100)
    await flush()
    expect(cb2).not.toHaveBeenCalled()
  })

  it('removes the rig element on dispose', () => {
    const o = createLayoutOracle(`<div data-pane="a"></div>`, 100, 100)
    expect(document.body.contains(o.element)).toBe(true)
    o.dispose()
    expect(document.body.contains(o.element)).toBe(false)
  })
})

describe('motion window', () => {
  it('samples per frame between transitionrun and transitionend', async () => {
    const o = oracle(`<div data-pane="a"></div>`)
    const pane = o.element.querySelector<HTMLElement>('[data-pane]')!
    lay(pane, 0, 0, 100, 100)
    const cb = vi.fn()
    o.observe(cb)
    cb.mockClear()

    // Drive rAF by hand.
    const frames: FrameRequestCallback[] = []
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((f) => (frames.push(f), frames.length))

    pane.dispatchEvent(
      new Event('transitionrun', { bubbles: true }) as TransitionEvent,
    )
    expect(frames.length).toBe(1)
    // Frame 1: box moved → emit.
    lay(pane, 20, 0, 100, 100)
    frames[0](0)
    expect(cb).toHaveBeenCalledTimes(1)
    // Still live → chained another frame.
    expect(frames.length).toBe(2)
    // Frame 2: box moved again.
    lay(pane, 40, 0, 100, 100)
    frames[1](0)
    expect(cb).toHaveBeenCalledTimes(2)

    // End the transition: the window closes, no further frames chain.
    pane.dispatchEvent(new Event('transitionend', { bubbles: true }) as TransitionEvent)
    lay(pane, 60, 0, 100, 100)
    frames[2](0)
    expect(frames.length).toBe(3)
    await flush()
    // The settle emit still lands the final box.
    expect(cb.mock.calls.at(-1)![0].get('a').x).toBe(60)
    raf.mockRestore()
  })
})

describe('paneRectsEqual', () => {
  it('compares by value', () => {
    const r = { x: 1, y: 2, width: 3, height: 4 }
    expect(paneRectsEqual(r, { ...r })).toBe(true)
    expect(paneRectsEqual(r, { ...r, width: 5 })).toBe(false)
  })
})
