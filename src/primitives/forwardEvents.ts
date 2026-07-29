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
    target.dispatchEvent(new PointerEvent('pointermove', init))
    target.dispatchEvent(new MouseEvent('mousemove', init))
  } else if (kind === 'down') {
    target.dispatchEvent(new PointerEvent('pointerdown', init))
    target.dispatchEvent(new MouseEvent('mousedown', init))
  } else {
    target.dispatchEvent(new PointerEvent('pointerup', init))
    target.dispatchEvent(new MouseEvent('mouseup', init))
    target.dispatchEvent(new MouseEvent('click', init))
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
