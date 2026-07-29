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
}

const mirrors = new WeakMap<HTMLElement, PointerMirror>()

const mirrorOf = (root: HTMLElement): PointerMirror => {
  let m = mirrors.get(root)
  if (!m) {
    m = { hovered: null, active: null }
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

function updateHover(
  root: HTMLElement,
  target: Element,
  init: PointerEventInit & MouseEventInit,
) {
  const m = mirrorOf(root)
  if (m.hovered === target) return
  m.hovered?.dispatchEvent(
    new PointerEvent('pointerout', { ...init, relatedTarget: target }),
  )
  swapChainAttr(root, m.hovered, target, HOVER_ATTR)
  target.dispatchEvent(
    new PointerEvent('pointerover', { ...init, relatedTarget: m.hovered }),
  )
  m.hovered = target
}

/** Drop all mirrored state (call when the pointer leaves the surface). */
export function clearPointerState(root: HTMLElement) {
  const m = mirrors.get(root)
  if (!m) return
  if (m.hovered) {
    m.hovered.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
    swapChainAttr(root, m.hovered, null, HOVER_ATTR)
    m.hovered = null
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
