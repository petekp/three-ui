// @vitest-environment happy-dom
//
// The pointer-exit protocol. Everything else in this repo's test suite is
// pure geometry; this file needs a DOM because the thing under test IS the
// sequence of DOM events we synthesize — which events, on which elements,
// carrying which coordinates.
//
// Layout is stubbed rather than computed: happy-dom has no layout engine, and
// these tests are about the event protocol, not about where boxes land.
// deepestElementAt's own hit-testing is exercised through those stubs.

import { beforeEach, describe, expect, it } from 'vitest'
import { clearPointerState, forwardPointer } from './forwardEvents'

const ROOT = { left: 0, top: 0, right: 360, bottom: 460 }

/** Give `el` a fixed layout box. */
function box(el: Element, left: number, top: number, right: number, bottom: number) {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right,
      bottom,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }) as DOMRect
}

/** Texture coordinates that land on the centre of a box inside ROOT. */
function uvOf(left: number, top: number, right: number, bottom: number) {
  const x = (left + right) / 2
  const y = (top + bottom) / 2
  return {
    u: (x - ROOT.left) / (ROOT.right - ROOT.left),
    v: 1 - (y - ROOT.top) / (ROOT.bottom - ROOT.top),
    x,
    y,
  }
}

interface Log {
  type: string
  at: string
  x: number
  y: number
}

let root: HTMLElement
let trigger: HTMLElement
let sibling: HTMLElement
let log: Log[]

const TRIGGER_BOX = [20, 20, 120, 60] as const
const SIBLING_BOX = [20, 100, 120, 140] as const

beforeEach(() => {
  document.body.innerHTML = ''
  log = []

  root = document.createElement('div')
  trigger = document.createElement('button')
  sibling = document.createElement('button')
  root.append(trigger, sibling)
  document.body.append(root)

  box(root, ROOT.left, ROOT.top, ROOT.right, ROOT.bottom)
  box(trigger, ...TRIGGER_BOX)
  box(sibling, ...SIBLING_BOX)

  // Record every pointer event where its listener actually sits, so a
  // non-bubbling event caught on an ancestor is distinguishable from one
  // dispatched there directly.
  const record = (el: Element | Document, name: string) => {
    for (const type of ['pointerover', 'pointerenter', 'pointerout', 'pointerleave', 'pointermove']) {
      el.addEventListener(type, (e) => {
        const pe = e as PointerEvent
        log.push({ type, at: name, x: pe.clientX, y: pe.clientY })
      })
    }
  }
  record(trigger, 'trigger')
  record(sibling, 'sibling')
  record(root, 'root')
  record(document, 'document')
})

const typesAt = (at: string) => log.filter((l) => l.at === at).map((l) => l.type)
const first = (type: string, at: string) => log.findIndex((l) => l.type === type && l.at === at)

/** The departure moves are spread over animation frames — let them land. */
const settle = (n = 5) =>
  new Promise<void>((done) => {
    let left = n
    const tick = () => (--left > 0 ? requestAnimationFrame(tick) : done())
    requestAnimationFrame(tick)
  })

describe('leaving the surface entirely', () => {
  // The bug Pete reported: a tooltip opened in a Surface never dismisses.
  //
  // Radix Tooltip closes in two ordered steps (react-tooltip 1.6.7):
  //   1. a native, non-bubbling `pointerleave` on the trigger builds a grace
  //      polygon from the exit point and the content rect, and only then is
  //      the document listener registered at all;
  //   2. a `pointermove` reaching `document` outside that polygon closes it.
  // Dispatching `pointerout` alone — which is all the forwarder used to do —
  // means step 1 never happens, so there is no step 2 to reach.

  it('fires pointerleave on the element the pointer was over', () => {
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    clearPointerState(root)

    expect(typesAt('trigger')).toContain('pointerleave')
  })

  it('carries the last known position, not the exit position', () => {
    // The grace polygon is anchored at the pointerleave coordinates. Reporting
    // the away point here would build a hull stretching out to it — and the
    // pointermove that follows would land inside its own grace area and never
    // close anything.
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    clearPointerState(root)

    const leave = log.find((l) => l.type === 'pointerleave' && l.at === 'trigger')
    expect(leave).toBeDefined()
    // Round-tripping through texture coordinates costs a few ULPs.
    expect(leave!.x).toBeCloseTo(on.x, 6)
    expect(leave!.y).toBeCloseTo(on.y, 6)
  })

  it('then moves the pointer somewhere provably outside the surface', async () => {
    // Radix pads its exit points *inward* (padding 5, always toward the
    // element), so the grace hull never escapes the trigger ∪ content
    // bounding box — which is inside the root. Any point outside the root's
    // rect is therefore outside the hull, for any tooltip, at any position.
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    clearPointerState(root)
    await settle()

    const move = log.find((l) => l.type === 'pointermove' && l.at === 'document')
    expect(move).toBeDefined()
    const outside =
      move!.x < ROOT.left || move!.x > ROOT.right || move!.y < ROOT.top || move!.y > ROOT.bottom
    expect(outside).toBe(true)
  })

  it('keeps moving for a few frames after the leave', async () => {
    // The single most expensive thing learned here: one synchronous move is
    // too early for anyone who arms a tracker in response to the leave.
    // Radix sets React state on `pointerleave` and only attaches its
    // document listener in the effect after that commits, so the move has to
    // arrive on a later frame — measured in Chrome 150 on 2026-07-31.
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    clearPointerState(root)
    expect(log.filter((l) => l.type === 'pointermove' && l.at === 'document')).toHaveLength(0)

    await settle()
    expect(
      log.filter((l) => l.type === 'pointermove' && l.at === 'document').length,
    ).toBeGreaterThan(1)
  })

  it('calls off the departure if the pointer comes back', async () => {
    // Otherwise re-entering a surface mid-departure announces that the
    // pointer is gone while it is demonstrably here, and the tooltip you just
    // re-hovered dismisses itself.
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    clearPointerState(root)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    await settle()

    const away = log.filter(
      (l) => l.type === 'pointermove' && (l.x < ROOT.left || l.y < ROOT.top),
    )
    expect(away).toHaveLength(0)
  })

  it('leaves before it moves away', async () => {
    // Order is load-bearing: the document listener that closes the tooltip is
    // only mounted once the grace area exists.
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    clearPointerState(root)
    await settle()

    expect(first('pointerleave', 'trigger')).toBeGreaterThanOrEqual(0)
    expect(first('pointerleave', 'trigger')).toBeLessThan(first('pointermove', 'document'))
  })

  it('still clears the mirrored hover attributes', () => {
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    expect(trigger.hasAttribute('data-hover')).toBe(true)

    clearPointerState(root)

    expect(trigger.hasAttribute('data-hover')).toBe(false)
    expect(root.hasAttribute('data-hover')).toBe(false)
  })
})

describe('moving between elements inside the surface', () => {
  it('fires pointerleave on the element being left', () => {
    // Same defect, second path: hovering a tooltip trigger and then moving to
    // a sibling never told the trigger it had been left either.
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    const next = uvOf(...SIBLING_BOX)
    forwardPointer(root, next.u, next.v, 'move')

    expect(typesAt('trigger')).toContain('pointerleave')
  })

  it('fires pointerenter on the element being entered', () => {
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    const next = uvOf(...SIBLING_BOX)
    forwardPointer(root, next.u, next.v, 'move')

    expect(typesAt('sibling')).toContain('pointerenter')
  })

  it('does not leave or re-enter the common ancestor', () => {
    // The pointer never left the root, so the root must hear neither. This is
    // what makes leave/enter different from out/over, and getting it wrong
    // would make every ancestor think it was exited on every internal move.
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    const next = uvOf(...SIBLING_BOX)
    forwardPointer(root, next.u, next.v, 'move')

    expect(typesAt('root')).not.toContain('pointerleave')
    expect(typesAt('root')).not.toContain('pointerenter')
  })

  it('still bubbles pointerout and pointerover to the root', () => {
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    const next = uvOf(...SIBLING_BOX)
    forwardPointer(root, next.u, next.v, 'move')

    expect(typesAt('root')).toContain('pointerout')
    expect(typesAt('root')).toContain('pointerover')
  })

  it('moves hover mirroring to the new element', () => {
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    const next = uvOf(...SIBLING_BOX)
    forwardPointer(root, next.u, next.v, 'move')

    expect(trigger.hasAttribute('data-hover')).toBe(false)
    expect(sibling.hasAttribute('data-hover')).toBe(true)
    expect(root.hasAttribute('data-hover')).toBe(true)
  })
})
