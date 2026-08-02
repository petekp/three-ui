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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearPointerState,
  deepestElementAt,
  forwardPointer,
  forwardWheel,
  silenceHoverMove,
  trackFocusModality,
  trackWheel,
} from './forwardEvents'

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
  document.body.removeAttribute('style')
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

describe('pointer-transparent regions', () => {
  // The second half of Pete's tooltip bug. A floating layer is a full-size
  // slab standing in front of its panel, and it is transparent everywhere the
  // popover does not cover — so the moment a tooltip opened, the slab caught
  // every ray, the panel behind it heard `pointerOut`, and the departure below
  // dismissed the tooltip that had just opened.
  //
  // On a 2D page a portal container solves this with `pointer-events: none`
  // and `auto` on its content. That declaration is the answer here too: the
  // forwarded hit test honours it, so a ray through clear glass hits nothing.

  let layer: HTMLElement
  let content: HTMLElement
  const CONTENT_BOX = [200, 200, 300, 260] as const
  /** Inside the slab, outside everything the slab holds. */
  const CLEAR = { x: 250, y: 400, u: 250 / 360, v: 1 - 400 / 460 }

  beforeEach(() => {
    layer = document.createElement('div')
    content = document.createElement('div')
    layer.append(content)
    root.append(layer)
    box(layer, ROOT.left, ROOT.top, ROOT.right, ROOT.bottom)
    box(content, ...CONTENT_BOX)

    // Exactly how a portal container is authored on a normal page. In Chrome
    // `layer` would inherit `none` from the root and only `content` needs the
    // `auto`; happy-dom does not model inheritance, so the transparency is
    // stated on both. What is under test either way is the rule that decides a
    // single element: explicit `none` is not a landing place.
    root.style.pointerEvents = 'none'
    layer.style.pointerEvents = 'none'
    content.style.pointerEvents = 'auto'
  })

  it('resolves a hit on the content', () => {
    const on = uvOf(...CONTENT_BOX)
    expect(deepestElementAt(root, on.x, on.y)).toBe(content)
  })

  it('resolves nothing where the layer is clear', () => {
    expect(deepestElementAt(root, CLEAR.x, CLEAR.y)).toBeNull()
  })

  it('descends through a transparent ancestor to reach its content', () => {
    // `pointer-events: none` on a parent is not a wall: a child may set
    // `auto` and be hittable inside it. That is the portal-container idiom,
    // and the walk has to descend through the clear part to find the popover.
    expect(layer.style.pointerEvents).toBe('none')
    const on = uvOf(...CONTENT_BOX)
    expect(deepestElementAt(root, on.x, on.y)).toBe(content)
  })

  it('forwards nothing at all through a clear region', () => {
    log.length = 0

    expect(forwardPointer(root, CLEAR.u, CLEAR.v, 'move')).toBeNull()
    expect(log).toHaveLength(0)
  })
})

describe('leaving one surface for another', () => {
  // Radix builds a grace polygon spanning trigger ∪ content precisely so the
  // pointer may cross from one to the other without dismissing. Our surfaces
  // are separate meshes, so that crossing IS an exit — and reporting it as a
  // departure to nowhere closes the tooltip you were reaching for.
  //
  // Every parked source is fixed at page (0,0) (decisions.md #16), so the
  // other surface's forwarded point is already a page point in the same
  // document Radix measured its hull in. No conversion, and no guessing.

  let other: HTMLElement
  let otherChild: HTMLElement
  const OTHER_BOX = [200, 200, 300, 260] as const

  beforeEach(() => {
    other = document.createElement('div')
    otherChild = document.createElement('div')
    other.append(otherChild)
    document.body.append(other)
    box(other, ROOT.left, ROOT.top, ROOT.right, ROOT.bottom)
    box(otherChild, ...OTHER_BOX)
  })

  // The burst is dispatched on the departing root itself. Reading it there
  // rather than at `document` keeps the other surface's own forwarded moves —
  // which also bubble to document — out of the measurement.
  const awayMoves = () => log.filter((l) => l.type === 'pointermove' && l.at === 'root')

  it('reports the destination when the pointer arrived there first', async () => {
    // The real order: the front mesh is delivered before the one behind it
    // notices it lost the ray.
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    const to = uvOf(...OTHER_BOX)
    forwardPointer(other, to.u, to.v, 'move')
    log.length = 0

    clearPointerState(root)
    await settle()

    const moves = awayMoves()
    expect(moves.length).toBeGreaterThan(0)
    for (const m of moves) {
      expect(m.x).toBeCloseTo(to.x, 6)
      expect(m.y).toBeCloseTo(to.y, 6)
    }
  })

  it('reports the destination even when it is forwarded after the exit', async () => {
    // The other order, which r3f also produces: a mesh hears `pointerOut`
    // before the new one is delivered. The burst is deferred to a later frame
    // anyway, so by the time it speaks the destination is known.
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    clearPointerState(root)
    const to = uvOf(...OTHER_BOX)
    forwardPointer(other, to.u, to.v, 'move')
    await settle()

    const moves = awayMoves()
    expect(moves.length).toBeGreaterThan(0)
    expect(moves[0].x).toBeCloseTo(to.x, 6)
  })

  it('still parks off-page when the pointer left every surface', async () => {
    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    log.length = 0

    clearPointerState(root)
    await settle()

    const moves = awayMoves()
    expect(moves.length).toBeGreaterThan(0)
    expect(moves[0].x).toBeLessThan(ROOT.left)
  })
})

describe('focus modality mirroring', () => {
  // The browser decides ring-or-no-ring by asking how the user last
  // interacted, and its heuristic hears only TRUSTED events — so focus that
  // follows a forwarded click reads as keyboard and shows a ring a real page
  // wouldn't. The forwarder mirrors the verdict it knows to be correct as
  // `data-pointer-focus`; the consumer's `focus-visible` variant excludes it.

  let release: () => void

  beforeEach(() => {
    release = trackFocusModality()
    // The mirror's modality is module state; a previous test may have left it
    // on 'pointer'. A keydown is the public way to reset it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
  })

  afterEach(() => release())

  const clickOn = (boxCoords: readonly [number, number, number, number]) => {
    const at = uvOf(...boxCoords)
    forwardPointer(root, at.u, at.v, 'down')
    forwardPointer(root, at.u, at.v, 'up')
  }

  it('stamps the button a forwarded click focuses', () => {
    clickOn(TRIGGER_BOX)

    expect(document.activeElement).toBe(trigger)
    expect(trigger.hasAttribute('data-pointer-focus')).toBe(true)
  })

  it('stamps a script focus that follows a forwarded press', () => {
    // The case the whole mirror exists for: Radix FocusScope autofocuses the
    // first tabbable of a popover it opened in reaction to our click. That
    // focus is not ours, but the interaction that caused it was.
    const at = uvOf(...TRIGGER_BOX)
    forwardPointer(root, at.u, at.v, 'down')

    sibling.focus()

    expect(sibling.hasAttribute('data-pointer-focus')).toBe(true)
  })

  it('a keyboard interaction re-earns the ring for the next focus', () => {
    clickOn(TRIGGER_BOX)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))

    sibling.focus()

    expect(sibling.hasAttribute('data-pointer-focus')).toBe(false)
  })

  it('modifier keys are not a keyboard interaction', () => {
    // A pointer user holding Shift mid-gesture has not switched to the
    // keyboard; the browser's heuristic ignores lone modifiers and so do we.
    clickOn(TRIGGER_BOX)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))

    sibling.focus()

    expect(sibling.hasAttribute('data-pointer-focus')).toBe(true)
  })

  it('never stamps an element that takes keyboard input', () => {
    // The browser's own carve-out: click into a text field and the ring is
    // information, not noise. Only button-like things get suppressed.
    const input = document.createElement('input')
    input.type = 'text'
    root.append(input)
    const INPUT_BOX = [20, 200, 120, 240] as const
    box(input, ...INPUT_BOX)

    clickOn(INPUT_BOX)

    expect(document.activeElement).toBe(input)
    expect(input.hasAttribute('data-pointer-focus')).toBe(false)
  })

  it('the stamp leaves with focus', () => {
    // A stale stamp would suppress a later, legitimately keyboard-earned ring
    // on the same element.
    clickOn(TRIGGER_BOX)
    expect(trigger.hasAttribute('data-pointer-focus')).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    sibling.focus()

    expect(trigger.hasAttribute('data-pointer-focus')).toBe(false)
  })

  it('released listeners stop stamping', () => {
    release()
    // Re-install so afterEach's release stays balanced, then release for real.
    const again = trackFocusModality()
    again()

    const at = uvOf(...TRIGGER_BOX)
    forwardPointer(root, at.u, at.v, 'down')
    sibling.focus()

    expect(sibling.hasAttribute('data-pointer-focus')).toBe(false)
    release = trackFocusModality() // rebalance for afterEach
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

  it('mirrors the mouse compatibility twins on every boundary crossing', () => {
    // The browser-caught defect (lab 010 inc 8): recharts is mouse-native —
    // React synthesizes its onMouseLeave from native `mouseout` — so a chart
    // tooltip appeared on forwarded moves and then never hid: the departure
    // was speaking pointer events only. A real browser fires the mouse twins
    // for every pointer boundary crossing; so must the forwarder.
    const mouseLog: { type: string; at: string }[] = []
    for (const [el, name] of [
      [trigger, 'trigger'],
      [sibling, 'sibling'],
    ] as const) {
      for (const type of ['mouseover', 'mouseenter', 'mouseout', 'mouseleave'])
        el.addEventListener(type, () => mouseLog.push({ type, at: name }))
    }

    const on = uvOf(...TRIGGER_BOX)
    forwardPointer(root, on.u, on.v, 'move')
    const next = uvOf(...SIBLING_BOX)
    forwardPointer(root, next.u, next.v, 'move')

    const at = (name: string) => mouseLog.filter((l) => l.at === name).map((l) => l.type)
    expect(at('trigger')).toEqual(
      expect.arrayContaining(['mouseover', 'mouseenter', 'mouseout', 'mouseleave']),
    )
    expect(at('sibling')).toEqual(expect.arrayContaining(['mouseover', 'mouseenter']))
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

describe('silencing the trusted canvas move', () => {
  // The counterpart of the departure burst: the forwarder tells the true
  // story with synthetic events, so the native canvas move — screen
  // coordinates, target CANVAS — must not ALSO reach document-level
  // listeners that reason about coordinates (Radix's tooltip grace tracker
  // closes any tooltip the moment it sees one). Hover moves are silenced;
  // drag moves must keep bubbling — OrbitControls listens at document for
  // the duration of a drag (decisions #18).

  function nativeMoveThrough(buttons: number) {
    // A stand-in canvas inside the page, with the same listener topology as
    // the app: silencer at the canvas's host, coordinate reasoner at document.
    const host = document.createElement('div')
    document.body.append(host)
    let reached = 0
    const reasoner = () => reached++
    document.addEventListener('pointermove', reasoner)
    host.addEventListener('pointermove', (e) => silenceHoverMove(e as PointerEvent))
    host.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons }))
    document.removeEventListener('pointermove', reasoner)
    host.remove()
    return reached
  }

  it('a hover move stops at the canvas', () => {
    expect(nativeMoveThrough(0)).toBe(0)
  })

  it('a drag move still reaches document', () => {
    expect(nativeMoveThrough(1)).toBe(1)
  })
})

describe('stacking order (z-index) in the hit test', () => {
  // The geometric walk can only see DOM order — later siblings win. Real
  // paint order is decided by z-index and stacking contexts, which only the
  // browser can resolve: measured in lab 009, a sonner toast (z 999999999,
  // FIRST child) painted above the dialog overlay (z 50, later sibling), and
  // the walk handed the pointer to the overlay under the visible toast.
  // deepestElementAt must consult document.elementsFromPoint — the browser's
  // own hit test — and only fall back to the walk when the environment
  // cannot answer (no layout, point outside the viewport).

  afterEach(() => {
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint
  })

  it('prefers the browser paint-order stack over DOM order', () => {
    // toaster first, overlay later — both covering the same point.
    const toast = document.createElement('div')
    const overlay = document.createElement('div')
    root.append(toast, overlay)
    box(toast, 200, 300, 340, 360)
    box(overlay, 0, 0, 360, 460)
    // The browser says the toast paints on top at this point.
    ;(document as { elementsFromPoint?: unknown }).elementsFromPoint = () => [
      toast,
      overlay,
      root,
      document.body,
      document.documentElement,
    ]
    expect(deepestElementAt(root, 270, 330)).toBe(toast)
  })

  it('returns null when the browser stack holds nothing of this root', () => {
    // Clear glass: the stack exists (environment can answer) but nothing of
    // ours is hittable at the point — and the walk agrees (no painted box).
    ;(document as { elementsFromPoint?: unknown }).elementsFromPoint = () => [
      document.body,
      document.documentElement,
    ]
    expect(deepestElementAt(root, 1, 1)).toBe(null)
  })

  it('falls back to the geometric walk when the environment cannot answer', () => {
    ;(document as { elementsFromPoint?: unknown }).elementsFromPoint = () => []
    const on = uvOf(...TRIGGER_BOX)
    expect(deepestElementAt(root, on.x, on.y)).toBe(trigger)
  })
})

describe('wheel forwarding and scroll chaining', () => {
  // happy-dom has no layout, so scroll metrics are stubbed per element the
  // same way boxes are. Overflow is declared inline (happy-dom reflects
  // inline styles into computed style, which canScroll reads).
  function scroller(
    el: HTMLElement,
    opts: { max: number; pos?: number; overflow?: string; overscroll?: string },
  ) {
    el.style.overflowY = opts.overflow ?? 'auto'
    if (opts.overscroll) el.style.overscrollBehaviorY = opts.overscroll
    const state = { top: opts.pos ?? 0 }
    Object.defineProperties(el, {
      scrollTop: {
        get: () => state.top,
        set: (v: number) => {
          state.top = Math.max(0, Math.min(opts.max, v))
        },
        configurable: true,
      },
      scrollHeight: { get: () => 100 + opts.max, configurable: true },
      clientHeight: { get: () => 100, configurable: true },
      scrollWidth: { get: () => 100, configurable: true },
      clientWidth: { get: () => 100, configurable: true },
    })
    return state
  }

  it('dispatches the wheel to the deepest element at the point', () => {
    // Coordinates are asserted only by delta here: happy-dom's WheelEvent
    // drops clientX/Y from its init (Chrome's, a real MouseEvent subclass,
    // carries them — browser-verified).
    const heard: number[] = []
    trigger.addEventListener('wheel', (e) => heard.push(e.deltaY))
    const at = uvOf(...TRIGGER_BOX)
    const consumed = forwardWheel(root, at.x, at.y, { deltaX: 0, deltaY: 40 })
    expect(heard).toEqual([40])
    expect(consumed).toBe(false) // nothing scrollable anywhere
  })

  it('honors a preventDefault as a claim', () => {
    trigger.addEventListener('wheel', (e) => e.preventDefault())
    const at = uvOf(...TRIGGER_BOX)
    expect(forwardWheel(root, at.x, at.y, { deltaX: 0, deltaY: 40 })).toBe(true)
  })

  it('scrolls the nearest scrollable ancestor and consumes the wheel', () => {
    const state = scroller(root, { max: 300 })
    const at = uvOf(...TRIGGER_BOX)
    expect(forwardWheel(root, at.x, at.y, { deltaX: 0, deltaY: 50 })).toBe(true)
    expect(state.top).toBe(50)
  })

  it('chains past a scroller at its end to one that can still move', () => {
    const inner = scroller(trigger, { max: 200, pos: 200 })
    const outer = scroller(root, { max: 300, pos: 0 })
    const at = uvOf(...TRIGGER_BOX)
    expect(forwardWheel(root, at.x, at.y, { deltaX: 0, deltaY: 30 })).toBe(true)
    expect(inner.top).toBe(200)
    expect(outer.top).toBe(30)
  })

  it('overscroll containment stops the chain without moving anything', () => {
    scroller(trigger, { max: 200, pos: 200, overscroll: 'contain' })
    const outer = scroller(root, { max: 300, pos: 0 })
    const at = uvOf(...TRIGGER_BOX)
    expect(forwardWheel(root, at.x, at.y, { deltaX: 0, deltaY: 30 })).toBe(true)
    expect(outer.top).toBe(0)
  })

  it('an upward wheel at the top falls through; scrolled down, it consumes', () => {
    const state = scroller(root, { max: 300, pos: 0 })
    const at = uvOf(...TRIGGER_BOX)
    expect(forwardWheel(root, at.x, at.y, { deltaX: 0, deltaY: -40 })).toBe(false)
    state.top = 100
    expect(forwardWheel(root, at.x, at.y, { deltaX: 0, deltaY: -40 })).toBe(true)
    expect(state.top).toBe(60)
  })

  it('normalizes line-mode deltas to pixels', () => {
    const state = scroller(root, { max: 300 })
    const at = uvOf(...TRIGGER_BOX)
    forwardWheel(root, at.x, at.y, { deltaX: 0, deltaY: 3, deltaMode: 1 })
    expect(state.top).toBe(48) // 3 lines × 16px
  })
})

describe('the document-capture wheel arbiter', () => {
  let canvas: HTMLCanvasElement
  let release: () => void

  beforeEach(() => {
    canvas = document.createElement('canvas')
    document.body.append(canvas)
    release = trackWheel()
  })
  afterEach(() => release())

  function scrollableRoot(max: number, pos = 0) {
    root.style.overflowY = 'auto'
    const state = { top: pos }
    Object.defineProperties(root, {
      scrollTop: {
        get: () => state.top,
        set: (v: number) => {
          state.top = Math.max(0, Math.min(max, v))
        },
        configurable: true,
      },
      scrollHeight: { get: () => 100 + max, configurable: true },
      clientHeight: { get: () => 100, configurable: true },
      scrollWidth: { get: () => 100, configurable: true },
      clientWidth: { get: () => 100, configurable: true },
    })
    return state
  }

  function canvasWheel(dy: number) {
    const e = new WheelEvent('wheel', {
      deltaY: dy,
      bubbles: true,
      cancelable: true,
    })
    canvas.dispatchEvent(e)
    return e
  }

  it('consumes a canvas wheel for the hovered surface and stops it cold', () => {
    const state = scrollableRoot(300)
    const at = uvOf(...TRIGGER_BOX)
    forwardPointer(root, at.u, at.v, 'move') // arm the mirror

    // OrbitControls' seat: a listener on the canvas itself.
    let orbitHeard = 0
    canvas.addEventListener('wheel', () => orbitHeard++)

    const e = canvasWheel(40)
    expect(state.top).toBe(40)
    expect(e.defaultPrevented).toBe(true)
    expect(orbitHeard).toBe(0)
  })

  it('lets an unconsumed wheel through to the scene', () => {
    const at = uvOf(...TRIGGER_BOX)
    forwardPointer(root, at.u, at.v, 'move')
    let orbitHeard = 0
    canvas.addEventListener('wheel', () => orbitHeard++)
    const e = canvasWheel(40)
    expect(e.defaultPrevented).toBe(false)
    expect(orbitHeard).toBe(1)
  })

  it('ignores wheels not aimed at a canvas', () => {
    const state = scrollableRoot(300)
    const at = uvOf(...TRIGGER_BOX)
    forwardPointer(root, at.u, at.v, 'move')
    const e = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true })
    document.body.dispatchEvent(e)
    expect(state.top).toBe(0)
    expect(e.defaultPrevented).toBe(false)
  })

  it('stands down once the pointer has left the surface', () => {
    const state = scrollableRoot(300)
    const at = uvOf(...TRIGGER_BOX)
    forwardPointer(root, at.u, at.v, 'move')
    clearPointerState(root)
    const e = canvasWheel(40)
    expect(state.top).toBe(0)
    expect(e.defaultPrevented).toBe(false)
  })
})
