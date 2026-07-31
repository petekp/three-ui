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

/** Deepest descendant of `root` whose client rect contains (x, y). */
export function deepestElementAt(root: Element, x: number, y: number): Element {
  let best: Element = root
  const walk = (node: Element) => {
    const r = node.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return
    best = node
    for (const child of Array.from(node.children)) walk(child)
  }
  walk(root)
  return best
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
 * Known gap: the `mouseout`/`mouseleave`/`mouseover`/`mouseenter` twins are
 * not mirrored. Nothing in the port listens for them (Radix is pointer-event
 * native); add them here if a component ever needs them.
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
  for (const el of prevChain) {
    if (entered.has(el)) break // the deepest common ancestor — not left
    el.dispatchEvent(
      new PointerEvent('pointerleave', { ...init, bubbles: false, relatedTarget: next }),
    )
  }

  next?.dispatchEvent(
    new PointerEvent('pointerover', { ...init, bubbles: true, relatedTarget: prev }),
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
  }
}

function updateHover(
  root: HTMLElement,
  target: Element,
  init: PointerEventInit & MouseEventInit,
) {
  const m = mirrorOf(root)
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

/** Drop all mirrored state (call when the pointer leaves the surface). */
export function clearPointerState(root: HTMLElement) {
  const m = mirrors.get(root)
  if (!m) return
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
    const away: PointerEventInit & MouseEventInit = {
      ...init,
      clientX: rect.left - AWAY_MARGIN_PX,
      clientY: rect.top - AWAY_MARGIN_PX,
    }
    let frames = AWAY_FRAMES
    const step = () => {
      m.away = 0
      // A surface torn down mid-departure has nothing to dismiss, and events
      // from a detached tree never reach document anyway.
      if (!root.isConnected) return
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
): ForwardResult {
  const rect = root.getBoundingClientRect()
  const x = rect.left + u * rect.width
  const y = rect.top + (1 - v) * rect.height
  const target = deepestElementAt(root, x, y)
  const mirror = mirrorOf(root)
  mirror.at = { x, y }
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
    // Real browsers hover before they press — a down with no prior move
    // (surface just appeared under the cursor) still hovers correctly.
    updateHover(root, target, init)
    swapChainAttr(root, null, target, ACTIVE_ATTR)
    mirrorOf(root).active = target
    target.dispatchEvent(new PointerEvent('pointerdown', init))
    target.dispatchEvent(new MouseEvent('mousedown', init))
  } else {
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
