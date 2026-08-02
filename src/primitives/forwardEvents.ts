// Input forwarding: map a hit on a 3D surface back into the live DOM subtree
// that the surface's texture is rasterized from.
//
// The pipeline: r3f raycast gives us the intersection UV → we scale that to
// pixel coordinates inside the source element → walk the (real, laid-out)
// subtree with getBoundingClientRect to find the deepest element under the
// point → dispatch synthetic pointer events there and manage focus.
//
// Because the source subtree is REAL DOM parked behind the WebGL canvas, the
// browser does the rest for free: :hover/:focus styles repaint into the
// texture, and once an input is focused, native keystrokes type into it with
// no forwarding needed at all (we just stop the canvas from stealing focus).

const FOCUSABLE = 'input, textarea, select, button, [tabindex], [contenteditable]'

/**
 * Deepest descendant of `root` that accepts the pointer at (x, y) — or null,
 * when nothing there does.
 *
 * `pointer-events` is honoured for the same reason the browser honours it: a
 * Surface is a slab of glass, and it is clear everywhere its DOM declined to
 * paint. A floating layer is the worked example — a full-size container
 * standing in front of its panel, `pointer-events: none`, holding a popover
 * that sets `auto`. Without this, the slab caught every ray the moment it went
 * live and the panel behind it went dead (see Surface's `hitTest="content"`).
 *
 * `none` is not a wall: a descendant may set `auto` and be hittable inside a
 * transparent ancestor — that is precisely the portal-container idiom. So the
 * walk descends through transparent elements and only refuses to *land* on
 * them.
 *
 * Note this reads the *computed* value, which is inherited. The parking canvas
 * is `pointer-events: none`, so createDomTextureSource re-roots the cascade on
 * the source element; without that every element here would read as clear.
 */
export function deepestElementAt(root: Element, x: number, y: number): Element | null {
  // The browser's own hit test first: document.elementsFromPoint returns the
  // real paint-order stack — z-index and stacking contexts resolved, with
  // pointer-events, visibility and zero-size handled natively — and it DOES
  // see parked canvas-fallback subtrees (measured, Chrome 150). The geometric
  // walk below can only see DOM order, which paint order is allowed to
  // contradict: measured in lab 009, a sonner toast (z 999999999, FIRST
  // child of the chrome layer) painted above the dialog overlay (z 50, later
  // sibling), and the walk handed the pointer to the overlay underneath the
  // visible toast. Every parked source shares the viewport origin, so the
  // stack holds elements of every overlapping source — filtering to `root`
  // keeps our own subtree's order intact.
  //
  // The browser can only answer inside the visual viewport (elementsFromPoint
  // clamps), and a layoutless environment answers with nothing useful — both
  // fall through to the walk. When the stack is real but holds nothing of
  // this root, the walk agrees by construction (nothing hittable paints
  // there), so falling through is also the null verdict, just derived twice.
  const doc = root.ownerDocument
  const view = doc.defaultView
  if (
    typeof doc.elementsFromPoint === 'function' &&
    view &&
    x >= 0 &&
    y >= 0 &&
    x < view.innerWidth &&
    y < view.innerHeight
  ) {
    const stack = doc.elementsFromPoint(x, y)
    if (stack.length > 0) {
      for (const el of stack) if (root.contains(el)) return el
      return null
    }
  }
  let best: Element | null = null
  const walk = (node: Element) => {
    const r = node.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return
    // Later siblings win ties, as in paint order; depth wins over breadth.
    if (getComputedStyle(node).pointerEvents !== 'none') best = node
    for (const child of Array.from(node.children)) walk(child)
  }
  walk(root)
  return best
}

// ---- focus modality mirroring -------------------------------------------
//
// `:focus-visible` is not a state, it is a *verdict*: the browser decides
// whether the focus that just landed deserves a visible ring, and it decides
// by asking how the user last interacted — keyboard shows the ring, pointer
// does not (unless the element takes keyboard input, which always earns it).
// The heuristic is fed exclusively by TRUSTED events. Everything the
// forwarder dispatches is synthetic, so the browser never hears our pointer
// story, and any script focus that follows a forwarded click — our own fixup
// below, or a library's autofocus (Radix FocusScope focuses the first
// tabbable of every popover it opens) — is judged as if the user had been
// tabbing. Measured 2026-08-01: every pointer-opened popover materialized a
// focus ring a real page would not show, and with shadcn's `transition-all`
// on the button, paid ~18 paints of ring fade under the entrance flight.
//
// Same doctrine as the boundary protocol above: the forwarder is the only
// thing that knows the pointer's real story, so whatever it declines to say,
// nothing downstream can reconstruct. It mirrors the verdict the browser
// would have reached onto `data-pointer-focus`, and the consumer's
// `focus-visible` variant excludes it:
//
//   @custom-variant focus-visible (&:focus-visible:not([data-pointer-focus]));
//
// Keyboard is tracked from real keydowns (which ARE trusted and also reach
// the heuristic — that direction was never broken) so a Tab after a click
// re-earns the ring on the next focus, exactly as on a page.

const POINTER_FOCUS_ATTR = 'data-pointer-focus'

/**
 * The browser's own carve-out: an element that supports keyboard input shows
 * its focus ring however focus arrived — click into a text field and the ring
 * is correct, not noise. Only button-like things get stamped.
 */
function ringSuppressible(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return false
  if ((el as HTMLElement).isContentEditable) return false
  if (el instanceof HTMLInputElement) {
    return ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(el.type)
  }
  return true
}

/** What the user last did, as far as any parked subtree can know. Starts as
 * 'keyboard' because that is the browser's posture before any interaction —
 * an autofocus on a freshly loaded page shows its ring. */
let modality: 'pointer' | 'keyboard' = 'keyboard'

const isModifier = (key: string) =>
  key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta'

const onModalityKeydown = (e: KeyboardEvent) => {
  // Modifier chords are how pointer users invoke shortcuts mid-gesture; the
  // browser's heuristic ignores them and so do we.
  if (!isModifier(e.key)) modality = 'keyboard'
}
const onModalityFocusIn = (e: FocusEvent) => {
  const el = e.target
  if (!(el instanceof HTMLElement)) return
  if (modality === 'pointer' && ringSuppressible(el)) {
    el.setAttribute(POINTER_FOCUS_ATTR, '')
  } else {
    el.removeAttribute(POINTER_FOCUS_ATTR)
  }
}
const onModalityFocusOut = (e: FocusEvent) => {
  const el = e.target
  if (el instanceof HTMLElement) el.removeAttribute(POINTER_FOCUS_ATTR)
}

let modalityInstalls = 0

/**
 * Install the document-level half of the mirror (keydown resets to keyboard;
 * focusin stamps, focusout cleans). Reference-counted: every Surface calls
 * this, one set of listeners serves them all. Returns a release.
 *
 * keydown listens on CAPTURE so a handler that stops propagation (FocusScene
 * claims Tab and arrows at the document) cannot hide a keyboard interaction
 * from the mirror.
 */
export function trackFocusModality(): () => void {
  if (modalityInstalls++ === 0) {
    document.addEventListener('keydown', onModalityKeydown, true)
    document.addEventListener('focusin', onModalityFocusIn)
    document.addEventListener('focusout', onModalityFocusOut)
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--modalityInstalls === 0) {
      document.removeEventListener('keydown', onModalityKeydown, true)
      document.removeEventListener('focusin', onModalityFocusIn)
      document.removeEventListener('focusout', onModalityFocusOut)
    }
  }
}

// ---- hover / active mirroring -------------------------------------------
//
// :hover and :active are set by the browser's REAL hit-testing, which never
// reaches the parked subtree (it sits behind the canvas with pointer-events
// off) — and dispatching synthetic events cannot flip pseudo-classes. So the
// forwarder owns those states: it mirrors the pseudo-class chains onto
// `data-hover` / `data-active` attributes (target + ancestors, like the real
// thing) and dispatches pointerover/pointerout on hover changes.
//
// Author CSS with both selectors:  button:hover, button[data-hover] { … }

const HOVER_ATTR = 'data-hover'
const ACTIVE_ATTR = 'data-active'

interface PointerMirror {
  hovered: Element | null
  active: Element | null
  /** Last forwarded position, in the source subtree's page coordinates. */
  at: { x: number; y: number }
  /** Pending animation frame for the departure moves; 0 when none. */
  away: number
}

const mirrors = new WeakMap<HTMLElement, PointerMirror>()

const mirrorOf = (root: HTMLElement): PointerMirror => {
  let m = mirrors.get(root)
  if (!m) {
    m = { hovered: null, active: null, at: { x: 0, y: 0 }, away: 0 }
    mirrors.set(root, m)
  }
  return m
}

/** `el` and its ancestors up to and including `root`. */
function chainOf(root: Element, el: Element | null): Element[] {
  const out: Element[] = []
  for (let n: Element | null = el; n; n = n.parentElement) {
    out.push(n)
    if (n === root) break
  }
  return out
}

function swapChainAttr(root: Element, prev: Element | null, next: Element | null, attr: string) {
  if (prev === next) return
  const nextChain = chainOf(root, next)
  const keep = new Set(nextChain)
  for (const el of chainOf(root, prev)) if (!keep.has(el)) el.removeAttribute(attr)
  for (const el of nextChain) if (!el.hasAttribute(attr)) el.setAttribute(attr, '')
}

/**
 * The boundary-crossing protocol: what a real browser dispatches when the
 * pointer moves off `prev` and onto `next` (either may be null at the edges
 * of the surface).
 *
 * The pair that bubbles and the pair that doesn't say different things, and
 * libraries listen to both:
 *
 * - `pointerout`/`pointerover` bubble, so one dispatch each is the whole
 *   announcement — every ancestor hears "something under me changed".
 * - `pointerleave`/`pointerenter` do NOT bubble. The browser fires one per
 *   element actually crossed and stops at the deepest common ancestor,
 *   because the pointer never left *that*. So they mean "the pointer left
 *   ME", which is a claim only the crossed elements may make.
 *
 * Forwarding only the bubbling pair — which is all this did until 2026-07-31
 * — is why a Radix tooltip opened inside a Surface could never close. It
 * builds its grace area from a native `pointerleave` on the trigger, and
 * only mounts the document listener that closes it once that area exists.
 * No leave, no grace area, no close: the tooltip hung until something else
 * unmounted it.
 *
 * Order matters and is the spec's: out, leave, over, enter — leaves outward
 * from the deepest element, enters inward toward it.
 *
 * The `mouseout`/`mouseleave`/`mouseover`/`mouseenter` twins ARE mirrored,
 * one per pointer event — a real browser fires mouse compatibility events
 * for every pointer boundary crossing, and the first mouse-native consumer
 * (recharts, lab 010 inc 8) arrived to collect: React synthesizes
 * `onMouseLeave` from native `mouseout`, so without the twin a chart's
 * tooltip appears on forwarded moves and then never hides — the departure
 * burst was speaking a dialect recharts doesn't listen to.
 */
function crossBoundary(
  root: HTMLElement,
  prev: Element | null,
  next: Element | null,
  init: PointerEventInit & MouseEventInit,
) {
  if (prev === next) return

  const prevChain = chainOf(root, prev)
  const nextChain = chainOf(root, next)
  const entered = new Set(nextChain)
  const left = new Set(prevChain)

  prev?.dispatchEvent(
    new PointerEvent('pointerout', { ...init, bubbles: true, relatedTarget: next }),
  )
  prev?.dispatchEvent(
    new MouseEvent('mouseout', { ...init, bubbles: true, relatedTarget: next }),
  )
  for (const el of prevChain) {
    if (entered.has(el)) break // the deepest common ancestor — not left
    el.dispatchEvent(
      new PointerEvent('pointerleave', { ...init, bubbles: false, relatedTarget: next }),
    )
    el.dispatchEvent(
      new MouseEvent('mouseleave', { ...init, bubbles: false, relatedTarget: next }),
    )
  }

  next?.dispatchEvent(
    new PointerEvent('pointerover', { ...init, bubbles: true, relatedTarget: prev }),
  )
  next?.dispatchEvent(
    new MouseEvent('mouseover', { ...init, bubbles: true, relatedTarget: prev }),
  )
  const entering: Element[] = []
  for (const el of nextChain) {
    if (left.has(el)) break
    entering.push(el)
  }
  for (const el of entering.reverse()) {
    el.dispatchEvent(
      new PointerEvent('pointerenter', { ...init, bubbles: false, relatedTarget: prev }),
    )
    el.dispatchEvent(
      new MouseEvent('mouseenter', { ...init, bubbles: false, relatedTarget: prev }),
    )
  }
}

// Roots whose mirror is currently hovering — the set a wheel event consults
// to find which surface (if any) is under the pointer. A WeakMap can't be
// iterated, and the wheel arrives on the CANVAS with screen coordinates, so
// the only way back to the parked point is through the mirrors that already
// know it.
const hoverRoots = new Set<HTMLElement>()

function updateHover(
  root: HTMLElement,
  target: Element,
  init: PointerEventInit & MouseEventInit,
) {
  const m = mirrorOf(root)
  hoverRoots.add(root)
  if (m.hovered === target) return
  // Mirror first, dispatch second: the browser has :hover applied before it
  // fires the boundary events, so a handler reading [data-hover] must see the
  // new state, not the one being left.
  swapChainAttr(root, m.hovered, target, HOVER_ATTR)
  crossBoundary(root, m.hovered, target, init)
  m.hovered = target
}

/**
 * How far outside the source's own rect to park the pointer on exit.
 *
 * Any positive margin is provably enough for Radix's grace area: it pads its
 * exit points *inward* (`getPaddedExitPoints`, padding 5, always toward the
 * element), so the hull it hands to the tracker never escapes the trigger ∪
 * content bounding box — which is inside the source root. A point outside the
 * root is therefore outside the hull, for any tooltip, at any position.
 * 16px is simply comfortable clearance for fractional rects.
 */
const AWAY_MARGIN_PX = 16

/**
 * How many frames of departure to send. Three is enough slack for a consumer
 * that reacts to the leave through a React state update — render and passive
 * effects are separate scheduler tasks, and either may land after a given
 * frame — while staying far too short to be felt.
 */
const AWAY_FRAMES = 3

/**
 * Where the pointer is, across every surface at once.
 *
 * No single surface can answer this: each one only knows the ray arrived or
 * left. But a departure needs to say where the pointer *went*, and when it
 * went to a neighbouring surface, "off-page" is a lie with consequences —
 * Radix spans its grace polygon across trigger ∪ content precisely so the
 * pointer may cross from one to the other, and a tooltip you reach for
 * dismisses itself if we report that crossing as an exit to nowhere.
 *
 * The coordinates need no conversion. Every parked source is fixed at page
 * (0,0) (decisions.md #16), so a point forwarded to any surface is already a
 * page point in the same document Radix measured its hull in.
 *
 * One record is enough, and staleness cannot arise: a surface only announces a
 * departure when the pointer was on it, so if the newest forward anywhere went
 * somewhere else, the pointer crossed there. Same root means it left for
 * nothing at all.
 */
let lastForward: { root: HTMLElement; x: number; y: number } | null = null

/** Drop all mirrored state (call when the pointer leaves the surface). */
export function clearPointerState(root: HTMLElement) {
  const m = mirrors.get(root)
  if (!m) return
  hoverRoots.delete(root)
  if (m.hovered) {
    // Leave from where the pointer actually was. The grace polygon is
    // anchored at these coordinates, so reporting the away point here would
    // stretch the hull out to meet it and the move below would land inside
    // its own grace area — open forever, for a subtler reason.
    const init: PointerEventInit & MouseEventInit = {
      clientX: m.at.x,
      clientY: m.at.y,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
      view: window,
    }
    swapChainAttr(root, m.hovered, null, HOVER_ATTR)
    crossBoundary(root, m.hovered, null, init)
    m.hovered = null

    // Then say where the pointer went, over the next few frames. Document
    // -level trackers — Radix's grace area, and every dismissal heuristic
    // built like it — reason about position, not about which subtree an event
    // came from, so a leave with no follow-up move leaves them believing the
    // pointer is still parked wherever it last was.
    //
    // Why a burst and not one dispatch: a real pointer that leaves an element
    // keeps moving, so a consumer that ARMS a tracker in response to the
    // leave still receives later moves. Ours is discrete — one exit, one
    // instant — and a single synchronous move lands before any consumer has
    // reacted. Radix is the worked example: `pointerleave` sets React state,
    // and the document listener that closes the tooltip is attached by the
    // effect after that commits. Measured 2026-07-31: the synchronous move
    // did nothing; the identical move sent later closed the tooltip.
    //
    // Cancelled if the pointer comes back (see forwardPointer), so returning
    // to the surface never eats its own dismissal.
    const rect = root.getBoundingClientRect()
    let frames = AWAY_FRAMES
    const step = () => {
      m.away = 0
      // A surface torn down mid-departure has nothing to dismiss, and events
      // from a detached tree never reach document anyway.
      if (!root.isConnected) return

      // Where did it go? If a neighbouring surface has taken the pointer since
      // this departure began, there — a real destination, which a grace area
      // may well decide to tolerate. Otherwise off the source entirely, which
      // is provably outside any hull Radix can build (AWAY_MARGIN_PX). Asked
      // per frame, not once, because the destination can arrive a frame late
      // and because the pointer may leave everything after all.
      const to = lastForward && lastForward.root !== root ? lastForward : null
      const away: PointerEventInit & MouseEventInit = {
        ...init,
        clientX: to ? to.x : rect.left - AWAY_MARGIN_PX,
        clientY: to ? to.y : rect.top - AWAY_MARGIN_PX,
      }
      root.dispatchEvent(new PointerEvent('pointermove', away))
      root.dispatchEvent(new MouseEvent('mousemove', away))
      if (--frames > 0) m.away = requestAnimationFrame(step)
    }
    m.away = requestAnimationFrame(step)
  }
  if (m.active) {
    swapChainAttr(root, m.active, null, ACTIVE_ATTR)
    m.active = null
  }
}

/**
 * Stop a native canvas pointermove from bubbling on to document — the same
 * truth-telling as Surface's pointerdown suppression (decisions #18), extended
 * to hover. Every pointer over a Surface arrives as a native event whose
 * target is the canvas and whose coordinates are screen coordinates; the
 * forwarder retells that move as a synthetic event with the coordinates of
 * what the pointer actually hit. Document-level listeners that reason about
 * move COORDINATES — Radix's tooltip grace tracker is the measured case:
 * `isPointInPolygon(clientX/Y, hull)` against a hull built in parked-source
 * page space — hear the canvas's screen coordinates as "miles outside" and
 * dismiss a tooltip the pointer is demonstrably travelling toward. Both
 * stories must not reach the document; the forwarded one is the true one.
 *
 * Hover moves only (`buttons === 0`): OrbitControls registers document-level
 * move/up listeners for the duration of a drag, and a drag that began on
 * empty space must keep orbiting while the ray crosses a panel. Dismissal
 * still works everywhere — a pointer over empty canvas never reaches a
 * Surface handler, so its native move bubbles untouched and closes what it
 * should close; a pointer leaving a Surface gets the departure burst, whose
 * synthetic moves land provably outside every grace hull.
 */
export function silenceHoverMove(native: PointerEvent) {
  if (native.buttons === 0) native.stopPropagation()
}

export interface ForwardResult {
  target: Element
  focused: boolean
}

/**
 * Forward a pointer interaction to the DOM subtree rooted at `root`.
 * (u, v) are texture coordinates: u ∈ [0,1] left→right, v ∈ [0,1] bottom→top
 * (GL convention — we flip v internally to DOM's top-down y).
 */
export function forwardPointer(
  root: HTMLElement,
  u: number,
  v: number,
  kind: 'down' | 'up' | 'move',
): ForwardResult | null {
  const rect = root.getBoundingClientRect()
  const x = rect.left + u * rect.width
  const y = rect.top + (1 - v) * rect.height
  const target = deepestElementAt(root, x, y)
  // Nothing here accepts the pointer — the ray passed through clear glass.
  // Whatever this surface was hovering, it is not hovering it now.
  if (!target) {
    clearPointerState(root)
    return null
  }
  const mirror = mirrorOf(root)
  mirror.at = { x, y }
  lastForward = { root, x, y }
  // The pointer is back before the departure finished sending — call it off,
  // or we would announce the pointer is gone while it is demonstrably here.
  if (mirror.away) {
    cancelAnimationFrame(mirror.away)
    mirror.away = 0
  }

  const init: PointerEventInit & MouseEventInit = {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: kind === 'down' ? 1 : 0,
    view: window,
  }

  let focused = false
  if (kind === 'move') {
    updateHover(root, target, init)
    target.dispatchEvent(new PointerEvent('pointermove', init))
    target.dispatchEvent(new MouseEvent('mousemove', init))
  } else if (kind === 'down') {
    // The press is the interaction the modality mirror cares about — declared
    // BEFORE dispatch, because a consumer may focus synchronously from its
    // pointerdown handler and the verdict must already be in.
    modality = 'pointer'
    // Real browsers hover before they press — a down with no prior move
    // (surface just appeared under the cursor) still hovers correctly.
    updateHover(root, target, init)
    swapChainAttr(root, null, target, ACTIVE_ATTR)
    mirrorOf(root).active = target
    target.dispatchEvent(new PointerEvent('pointerdown', init))
    target.dispatchEvent(new MouseEvent('mousedown', init))
  } else {
    modality = 'pointer' // a release is a pointer interaction even without its down
    target.dispatchEvent(new PointerEvent('pointerup', init))
    target.dispatchEvent(new MouseEvent('mouseup', init))
    target.dispatchEvent(new MouseEvent('click', init))
    const m = mirrorOf(root)
    swapChainAttr(root, m.active, null, ACTIVE_ATTR)
    m.active = null
    // Synthetic clicks don't run the browser's focus fixup, so do it by hand.
    const focusable = target.closest(FOCUSABLE) as HTMLElement | null
    if (focusable) {
      focusable.focus({ preventScroll: true })
      focused = document.activeElement === focusable
    } else {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    }
  }

  return { target, focused }
}

/**
 * Checkboxes/radios toggle via real activation behavior on click; synthetic
 * clicks handle them, but selects need help: a synthetic click can't open a
 * native dropdown picker. Instead we cycle the value — good enough to prove
 * state flows; a real library would render its own popover surface.
 */
export function nudgeSelect(el: HTMLSelectElement) {
  el.selectedIndex = (el.selectedIndex + 1) % el.options.length
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// ---- wheel / scroll forwarding ------------------------------------------
//
// Scroll RASTERIZES fine — a scrollTop change invalidates the paint record
// like any descendant mutation (measured 2026-08-01: instant jump = 1 paint,
// smooth scroll = 1 paint/frame while gliding, pixels verified). What the
// platform will not do is scroll FOR us: the default scrolling action only
// runs for trusted wheel events, and everything the forwarder dispatches is
// synthetic. So the forwarder performs the scroll itself, the way the
// browser would have: dispatch the (cancelable) wheel to the DOM first, and
// if no handler claims it, walk up from the target for the nearest scroll
// container that can still move in the delta's direction and move it.
//
// The return value is the arbitration verdict the SCENE needs: `true` means
// the surface consumed the wheel (a handler claimed it, a scroller moved, or
// an `overscroll-behavior: contain|none` boundary swallowed it), and the
// camera must not also zoom. `false` means the wheel fell all the way
// through — over a panel with nothing scrollable, the room itself is the
// next scroll container, exactly like scroll chaining reaching the page.

/** Can `el` still scroll in the direction of `delta` on `axis`? */
function canScroll(el: Element, axis: 'x' | 'y', delta: number): boolean {
  if (delta === 0) return false
  const cs = getComputedStyle(el)
  const overflow = axis === 'y' ? cs.overflowY : cs.overflowX
  if (overflow !== 'auto' && overflow !== 'scroll') return false
  const max =
    axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
  if (max <= 0) return false
  const pos = axis === 'y' ? el.scrollTop : el.scrollLeft
  // Half a pixel of slack: scroll positions are fractional on scaled sources.
  return delta > 0 ? pos < max - 0.5 : pos > 0.5
}

/** Is `el` a scroll container on `axis` whose overscroll must not chain? */
function overscrollStops(el: Element, axis: 'x' | 'y'): boolean {
  const cs = getComputedStyle(el)
  const overflow = axis === 'y' ? cs.overflowY : cs.overflowX
  if (overflow !== 'auto' && overflow !== 'scroll') return false
  const behavior =
    (axis === 'y' ? cs.overscrollBehaviorY : cs.overscrollBehaviorX) ||
    cs.overscrollBehavior
  return behavior === 'contain' || behavior === 'none'
}

/**
 * Forward a wheel at page point (x, y) into `root`. Returns true when the
 * surface consumed it (the camera must stand down), false when it chained
 * through to the scene.
 */
export function forwardWheel(
  root: HTMLElement,
  x: number,
  y: number,
  wheel: { deltaX: number; deltaY: number; deltaMode?: number },
): boolean {
  const target = deepestElementAt(root, x, y)
  if (!target) return false

  // The retelling: consumers hear the wheel whether or not anything scrolls
  // (cmdk, carousels, custom scrollers all listen). A preventDefault is a
  // claim, honored the way the browser would.
  const ev = new WheelEvent('wheel', {
    clientX: x,
    clientY: y,
    deltaX: wheel.deltaX,
    deltaY: wheel.deltaY,
    deltaMode: wheel.deltaMode ?? 0,
    bubbles: true,
    cancelable: true,
    view: window,
  })
  if (!target.dispatchEvent(ev)) return true

  // Line/page deltas normalized to pixels before moving anything (real
  // devices send pixels; some mice send lines).
  const unit = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? 100 : 1
  const dx = wheel.deltaX * unit
  const dy = wheel.deltaY * unit

  // Scroll chaining, target → root: the nearest scroll container that can
  // move takes the delta; a container at its end with overscroll containment
  // stops the chain cold, consuming nothing — the chat log at its bottom must
  // not become a camera zoom.
  for (const el of chainOf(root, target)) {
    const x2 = canScroll(el, 'x', dx)
    const y2 = canScroll(el, 'y', dy)
    if (x2 || y2) {
      // Direct mutation, not scrollBy: user scrolling is exempt from CSS
      // scroll-behavior, so instant is the faithful semantics — and it costs
      // exactly one paint. scroll events fire from the mutation for free.
      if (x2) el.scrollLeft += dx
      if (y2) el.scrollTop += dy
      return true
    }
    if ((dx !== 0 && overscrollStops(el, 'x')) || (dy !== 0 && overscrollStops(el, 'y')))
      return true
  }
  return false
}

// The wheel cannot be arbitrated where it is heard. OrbitControls listens on
// the CANVAS element — the wheel's real target — so by the time r3f's own
// wrapper-level handler (and any mesh onWheel) runs, the camera has already
// zoomed. The only seat ahead of the canvas is document capture. From there,
// the mirrors already know whether the pointer is over a surface and where
// its parked point is; if that surface consumes the wheel, the event is
// stopped before OrbitControls ever hears it.
let wheelRefs = 0
let untrackWheel: (() => void) | null = null

/** Reference-counted document-capture wheel arbiter. Returns a release. */
export function trackWheel(): () => void {
  if (wheelRefs++ === 0) {
    const onWheel = (e: WheelEvent) => {
      // Only wheels aimed at a canvas are ours to arbitrate — page scrolling
      // outside the scene stays untouched, and the synthetic wheel dispatched
      // by forwardWheel (whose target is parked DOM, never a canvas) can't
      // re-enter here.
      if (!(e.target instanceof HTMLCanvasElement)) return
      for (const rootEl of hoverRoots) {
        const m = mirrors.get(rootEl)
        if (!m?.hovered) continue
        if (forwardWheel(rootEl, m.at.x, m.at.y, e)) {
          e.preventDefault()
          e.stopImmediatePropagation()
          return
        }
      }
    }
    document.addEventListener('wheel', onWheel, { capture: true, passive: false })
    untrackWheel = () =>
      document.removeEventListener('wheel', onWheel, { capture: true })
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--wheelRefs === 0) {
      untrackWheel?.()
      untrackWheel = null
    }
  }
}
