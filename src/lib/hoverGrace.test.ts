// @vitest-environment happy-dom
//
// The screen-space grace hull for detached hover layers. The hull math is
// pure geometry; the tracker tests are about protocol — which synthetic
// events land on the content root, and exactly when. Layout never enters:
// the layer quad is injected, which is also how the real consumer works
// (FloatingSurface projects its own mesh).

import { beforeEach, describe, expect, it } from 'vitest'
import { convexHull, createGraceTracker, observeGrace, pointInConvex } from './hoverGrace'
import type { GraceTracker, Pt } from './hoverGrace'

describe('convexHull', () => {
  it('reduces a square with interior points to its corners', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
      { x: 2, y: 8 },
    ])
    expect(hull).toHaveLength(4)
    for (const c of [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])
      expect(hull).toContainEqual(c)
  })

  it('drops collinear points', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])
    expect(hull).toHaveLength(4)
    expect(hull).not.toContainEqual({ x: 5, y: 0 })
  })

  it('passes degenerate inputs through', () => {
    expect(convexHull([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }])
    expect(convexHull([])).toEqual([])
  })
})

describe('pointInConvex', () => {
  const square = convexHull([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ])

  it('accepts interior and boundary, rejects exterior', () => {
    expect(pointInConvex({ x: 5, y: 5 }, square)).toBe(true)
    expect(pointInConvex({ x: 0, y: 5 }, square)).toBe(true)
    expect(pointInConvex({ x: 10, y: 10 }, square)).toBe(true)
    expect(pointInConvex({ x: 11, y: 5 }, square)).toBe(false)
    expect(pointInConvex({ x: -1, y: -1 }, square)).toBe(false)
  })

  it('rejects everything against a degenerate hull', () => {
    expect(pointInConvex({ x: 1, y: 1 }, [{ x: 1, y: 1 }])).toBe(false)
  })
})

// ---------------------------------------------------------------------------

/** A quad well to the right of the exit points used below: x 300–400, y 100–200. */
const QUAD: Pt[] = [
  { x: 300, y: 100 },
  { x: 400, y: 100 },
  { x: 400, y: 200 },
  { x: 300, y: 200 },
]

type Log = { type: string; target: string }[]

describe('createGraceTracker', () => {
  let trigger: HTMLElement
  let contentRoot: HTMLElement
  let contentChild: HTMLElement
  let log: Log
  let tracker: GraceTracker
  let quad: Pt[] | null

  beforeEach(() => {
    document.body.innerHTML =
      '<button id="trigger"></button><div id="content"><span id="child"></span></div>'
    trigger = document.getElementById('trigger')!
    contentRoot = document.getElementById('content')!
    contentChild = document.getElementById('child')!
    log = []
    for (const type of ['pointerover', 'pointerenter', 'pointerout', 'pointerleave'])
      contentRoot.addEventListener(type, (e) =>
        log.push({ type, target: (e.target as Element).id }),
      )
    quad = QUAD
    tracker = createGraceTracker({
      trigger: () => trigger,
      content: () => contentRoot,
      layerQuad: () => quad,
    })
  })

  it('arms on trigger leave and holds the content with an enter pair', () => {
    tracker.move(100, 150)
    tracker.leave(trigger)
    expect(tracker.armed).toBe(true)
    expect(log.map((l) => l.type)).toEqual(['pointerover', 'pointerenter'])
  })

  it('holds while the pointer transits inside the hull, releases outside it', () => {
    tracker.move(100, 150)
    tracker.leave(trigger)
    log.length = 0

    // Straight flight toward the quad: inside the hull the whole way.
    tracker.move(180, 150)
    tracker.move(260, 150)
    tracker.move(320, 150) // arrived on the quad itself
    expect(log).toEqual([])
    expect(tracker.armed).toBe(true)

    // Sharp exit downward, far off the hull.
    tracker.move(320, 500)
    expect(log.map((l) => l.type)).toEqual(['pointerout', 'pointerleave'])
    expect(tracker.armed).toBe(false)
  })

  it('a wander that never approaches the quad releases immediately', () => {
    tracker.move(100, 150)
    tracker.leave(trigger)
    log.length = 0
    tracker.move(60, 400)
    expect(log.map((l) => l.type)).toEqual(['pointerout', 'pointerleave'])
  })

  it('re-arms on content-root leave — return transit is covered', () => {
    // The full round trip. The corridor back to the trigger exists only
    // because the outbound arm recorded where the pointer left it.
    tracker.move(100, 150)
    tracker.leave(trigger)
    tracker.move(350, 150) // arrived on the layer
    log.length = 0

    tracker.leave(contentRoot)
    expect(tracker.armed).toBe(true)
    expect(log.map((l) => l.type)).toEqual(['pointerover', 'pointerenter'])

    log.length = 0
    tracker.move(220, 150) // heading back toward the trigger, inside hull
    expect(log).toEqual([])
    tracker.move(220, 500) // bailing out of the corridor
    expect(log.map((l) => l.type)).toEqual(['pointerout', 'pointerleave'])
  })

  it('a departure burst leave with the pointer already parked outside never re-arms', () => {
    // The measured live bug: leaving the card onto the panel below, the
    // trusted move releases the grace — and then the card surface's
    // departure burst fires a leave on the content root. Anchored at the
    // pointer's parked position that leave re-armed forever; anchored at
    // the previous sample it is judged, found outside, and stays silent.
    tracker.move(100, 150)
    tracker.leave(trigger)
    tracker.move(350, 150) // on the card
    log.length = 0

    tracker.move(700, 450) // flick off the card, far outside the corridor
    expect(log.map((l) => l.type)).toEqual(['pointerout', 'pointerleave'])

    log.length = 0
    tracker.leave(contentRoot) // the burst's leave, arriving after the move
    expect(tracker.armed).toBe(false)
    expect(log).toEqual([]) // no enter — Radix's close timer must win
  })

  it('a trigger leave heard with the pointer already flicked away never arms', () => {
    tracker.move(100, 150)
    tracker.move(90, 320) // fast flick away before the leave is heard
    tracker.leave(trigger)
    expect(tracker.armed).toBe(false)
    expect(log).toEqual([])
  })

  it('ignores leaves from content children — internal crossings never arm', () => {
    tracker.move(350, 150)
    tracker.leave(contentChild)
    expect(tracker.armed).toBe(false)
    expect(log).toEqual([])
  })

  it('ignores leaves from unrelated elements', () => {
    tracker.move(100, 150)
    tracker.leave(document.body)
    expect(tracker.armed).toBe(false)
  })

  it('never arms without a recorded pointer position', () => {
    tracker.leave(trigger)
    expect(tracker.armed).toBe(false)
    expect(log).toEqual([])
  })

  it('releases silently when the quad becomes unprojectable', () => {
    tracker.move(100, 150)
    tracker.leave(trigger)
    log.length = 0
    quad = null
    tracker.move(180, 150)
    expect(tracker.armed).toBe(false)
    expect(log).toEqual([]) // no dispatched leave — the layer is already gone
  })

  it('reset drops everything without dispatching', () => {
    tracker.move(100, 150)
    tracker.leave(trigger)
    log.length = 0
    tracker.reset()
    expect(tracker.armed).toBe(false)
    expect(log).toEqual([])
    // And the stale position is gone: a leave right after reset cannot arm.
    tracker.leave(trigger)
    expect(tracker.armed).toBe(false)
  })

  it('the exit pad keeps a hull alive for a pointer wobbling at the exit point', () => {
    tracker.move(100, 150)
    tracker.leave(trigger)
    log.length = 0
    tracker.move(95, 158) // behind the exit point but inside the pad
    expect(tracker.armed).toBe(true)
    expect(log).toEqual([])
  })
})

describe('observeGrace', () => {
  it('feeds trusted hover moves and any leave; detach stops both', () => {
    const calls: string[] = []
    const fake: GraceTracker = {
      move: (x, y) => calls.push(`move ${x},${y}`),
      leave: (t) => calls.push(`leave ${(t as HTMLElement).id}`),
      reset: () => calls.push('reset'),
      armed: false,
    }
    document.body.innerHTML = '<div id="el"></div>'
    const el = document.getElementById('el')!
    const detach = observeGrace(fake, document)

    // happy-dom events are untrusted by construction — exactly the forwarded
    // case — so a synthetic move must NOT reach the tracker…
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 6 }))
    // …while a leave (always synthetic in this medium) must.
    el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))
    expect(calls).toEqual(['leave el'])

    detach()
    el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))
    expect(calls).toEqual(['leave el'])
  })
})
