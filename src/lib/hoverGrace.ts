// Grace for hover-driven DETACHED layers — the ray answer #36 owed.
//
// Radix dismisses a hover layer with timers: `pointerleave` on the trigger
// arms a close (300ms by default), `pointerenter` on the content cancels it.
// On a page that works because trigger and content are pixels apart. A
// detached layer (FloatingSurface) stands somewhere in the ROOM, so the
// trigger-leave → content-enter gap becomes a mouse flight across the
// screen, racing the close timer — the geometric grace question reborn as a
// timing question.
//
// Radix tooltip's own answer is the model: a hull spanning the pointer's
// exit point and the content's rect, inside which the pointer is "in
// transit" and the layer holds. Ours differs in one load-bearing way: the
// hull lives in SCREEN space — the exit point is where the trusted pointer
// really is, and the content's rect is the floating mesh's projected quad.
// Screen space is the only space in which "the pointer is travelling toward
// that slab" is even a statement; the parked page space Radix reasons in
// has both slabs stacked at (0,0).
//
// The tracker never touches Radix. It speaks the same synthetic
// over/enter // out/leave protocol the forwarder speaks (React synthesizes
// onPointerEnter/Leave from the bubbling pair, so both are dispatched), and
// Radix's own timers do the rest: enter on the content root holds the
// layer, leave re-arms the close. Dismissal semantics stay exactly Radix's
// — exit the hull and the layer closes precisely `closeDelay` later, the
// same lag a page hover-card has.
//
// Two asymmetries worth knowing, both measured facts of the medium:
//
//  - The ARM signal (a `pointerleave` on the trigger or content root) is
//    always SYNTHETIC — parked DOM never hears trusted events; the
//    forwarder is the only narrator (#19). So the leave listener must not
//    filter on `isTrusted`.
//  - The POSITION feed must be ONLY trusted moves — the forwarder's copies
//    carry parked-source coordinates, which are meaningless on screen. A
//    document-capture listener hears trusted moves even over Surfaces,
//    because #26's silencing stops propagation at the canvas (target
//    phase), which is downstream of document capture.

export interface Pt {
  x: number
  y: number
}

/** Cross product of (b−a) × (c−a): >0 means c is left of a→b. */
function cross(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/**
 * Convex hull, Andrew's monotone chain, returned counter-clockwise in
 * screen coordinates (y-down; "counter-clockwise" here is the sign
 * convention `pointInConvex` expects, not a visual claim).
 */
export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length <= 2) return pts

  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Point-in-convex-polygon; the boundary counts as inside. */
export function pointInConvex(p: Pt, hull: Pt[]): boolean {
  if (hull.length < 3) return false
  let sign = 0
  for (let i = 0; i < hull.length; i++) {
    const c = cross(hull[i], hull[(i + 1) % hull.length], p)
    if (c === 0) continue
    if (sign === 0) sign = Math.sign(c)
    else if (Math.sign(c) !== sign) return false
  }
  return true
}

export interface GraceTrackerOptions {
  /** The element whose hover opened the layer (queried lazily; may be null). */
  trigger: () => Element | null
  /** The detached layer's content root — the dispatch target. */
  content: () => Element | null
  /**
   * The layer's quad in screen coordinates, re-read every judged move so an
   * orbiting camera can't stale the hull. Null means "not projectable right
   * now" (layer empty or behind the camera) and releases without dispatch.
   */
  layerQuad: () => Pt[] | null
  /**
   * Half-size of the square padded around the exit point, in px. Radix pads
   * its exit points too; without it a hull built from a single point and a
   * distant quad is a sliver a real pointer falls out of immediately.
   */
  exitPad?: number
}

export interface GraceTracker {
  /** A trusted pointer position, in client coordinates. */
  move(x: number, y: number): void
  /** A `pointerleave` heard anywhere; arms when its target is a watched root. */
  leave(target: Element): void
  /** Drop all state without dispatching (call when the layer unmounts). */
  reset(): void
  readonly armed: boolean
}

function dispatchPair(el: Element, type: 'enter' | 'leave') {
  // Both pairs, same as the forwarder's boundary protocol: React synthesizes
  // onPointerEnter/Leave from the bubbling out/over pair; other listeners
  // take the non-bubbling one. pointerType matters — Radix's excludeTouch
  // drops events that don't identify as mouse/pen.
  const init: PointerEventInit = { pointerId: 1, pointerType: 'mouse', relatedTarget: null }
  el.dispatchEvent(
    new PointerEvent(type === 'enter' ? 'pointerover' : 'pointerout', { ...init, bubbles: true }),
  )
  el.dispatchEvent(
    new PointerEvent(type === 'enter' ? 'pointerenter' : 'pointerleave', {
      ...init,
      bubbles: false,
    }),
  )
}

export function createGraceTracker({
  trigger,
  content,
  layerQuad,
  exitPad = 12,
}: GraceTrackerOptions): GraceTracker {
  let last: Pt | null = null
  let exit: Pt | null = null
  // The trigger-side end of the corridor, kept across arms: a return
  // transit (leaving the CONTENT, heading back) needs a hull that reaches
  // the trigger, and the pointer's position when it last left the trigger
  // is the only screen-space fact we hold about where that is.
  // `prev` is the sample BEFORE the newest one, and it — not `last` — is
  // what a leave uses as its exit point. The leave that matters arrives on
  // the first move that missed the source, so by hearing time the pointer
  // is already one sample past the crossing; for a fast flick (or a
  // teleporting test pointer) that sample is far away. Anchoring the hull
  // there would make the corridor follow the pointer — measured live as a
  // card that never closed: the departure burst's leave re-armed the
  // tracker at the pointer's parked position, whose own pad is inside its
  // own hull by construction, and a stopped pointer re-judges nothing.
  let prev: Pt | null = null
  let triggerExit: Pt | null = null
  let armed = false

  const release = (dispatch: boolean) => {
    if (armed && dispatch) {
      const c = content()
      if (c) dispatchPair(c, 'leave')
    }
    armed = false
    exit = null
  }

  /** The corridor hull for a given exit anchor, or null when unprojectable. */
  const hullFor = (anchor: Pt): Pt[] | null => {
    const quad = layerQuad()
    if (!quad || quad.length < 3) return null
    const pts: Pt[] = [...quad]
    for (const p of triggerExit && triggerExit !== anchor ? [anchor, triggerExit] : [anchor]) {
      pts.push(
        { x: p.x - exitPad, y: p.y - exitPad },
        { x: p.x + exitPad, y: p.y - exitPad },
        { x: p.x - exitPad, y: p.y + exitPad },
        { x: p.x + exitPad, y: p.y + exitPad },
      )
    }
    return convexHull(pts)
  }

  return {
    get armed() {
      return armed
    },

    move(x, y) {
      prev = last
      last = { x, y }
      if (!armed || !exit) return
      const hull = hullFor(exit)
      if (!hull) {
        release(false)
        return
      }
      if (!pointInConvex({ x, y }, hull)) release(true)
    },

    leave(target) {
      // Exact roots only. The forwarder fires one leave per element crossed,
      // so crossing between the content's children names the children, never
      // the root — `contains` would arm on every internal move.
      const c = content()
      if (target !== trigger() && (c === null || target !== c)) return
      if (!last || !c) return
      // Judge before arming: a leave heard with the pointer already outside
      // the corridor is a genuine departure, and the tracker must not speak —
      // Radix's own close timer is the correct outcome.
      const anchor = prev ?? last
      const hull = hullFor(anchor)
      if (!hull || !pointInConvex(last, hull)) return
      exit = anchor
      if (target === trigger()) triggerExit = anchor
      armed = true
      // Hold immediately. Safe ordering by construction: the forwarder
      // dispatches `pointerout` (which is where React runs Radix's leave
      // handler and sets the close timer) BEFORE the `pointerleave` that
      // armed us — so this enter lands after the timer exists and cancels it.
      dispatchPair(c, 'enter')
    },

    reset() {
      release(false)
      last = null
      prev = null
      triggerExit = null
    },
  }
}

/**
 * Wire a tracker to a document: capture-phase listeners, ahead of every
 * target-phase stopPropagation in the pipeline. Returns the detach.
 */
export function observeGrace(tracker: GraceTracker, doc: Document = document): () => void {
  const onMove = (e: PointerEvent) => {
    // Trusted, hover only. Synthetic moves carry parked coordinates (skip),
    // and a drag crossing the scene is OrbitControls' business (#26).
    if (!e.isTrusted || e.buttons !== 0) return
    tracker.move(e.clientX, e.clientY)
  }
  const onLeave = (e: PointerEvent) => {
    if (e.target instanceof Element) tracker.leave(e.target)
  }
  doc.addEventListener('pointermove', onMove, true)
  doc.addEventListener('pointerleave', onLeave, true)
  return () => {
    doc.removeEventListener('pointermove', onMove, true)
    doc.removeEventListener('pointerleave', onLeave, true)
  }
}
