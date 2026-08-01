// The layout oracle — DOM as the layout authority for scene placement.
//
// A scene of Surface panels needs the same answers a 2D app does: where does
// the sidebar end, how wide is the main column, what happens when a panel
// collapses. CSS already has the industry's best answer machine for this —
// flex, grid, gap, wrap, container queries — and every consumer already
// speaks it. So instead of reinventing layout in world units, the oracle
// mounts a HIDDEN in-document container, lets the real style engine lay it
// out, reads the resulting boxes, and hands them to the scene. The DOM stays
// the layout authority; the scene is a faithful projection of it.
//
// The container is parked exactly like a texture source (fixed at the page
// origin, behind everything) but with one difference that is the whole
// design: `visibility: hidden`. A texture source must PAINT — the compositor
// skips off-screen canvases, which is why sources park on-screen. The oracle
// must never paint and only LAY OUT, and visibility affects painting alone:
// layout runs, offsetWidth answers, transitions tick and fire their events,
// and not one pixel or paint record is produced. A whole animated reflow
// costs zero paints by construction.
//
// Two platform facts shape the API:
//
//  - The rig is NOT a viewport. `vw`/`vh` and every `@media` query resolve
//    against the page, not the rig (measured for layoutSubtree canvases,
//    same rule here — nothing about a hidden div changes it). So the root
//    declares `container-type: size`, and CONTAINER queries are the
//    responsive mechanism: `@container`, and Tailwind v4's `@sm:`/`@lg:`
//    variants, resolve against the rig's authored size — the thing a
//    consumer actually means by "the layout got narrower".
//
//  - Sizes are read as `offsetWidth`/`offsetHeight` and positions by walking
//    the `offsetParent` chain, never `getBoundingClientRect`: the rect bakes
//    in transforms, and a pane mid-entrance would report its animated box
//    (the same trap decisions #22 records for measurement in general).
//
// Change detection is three signals, each answering a question the others
// cannot, none of them the banned kind (this is FloatingSurface's clause:
// these answer "what exists / how big", which no paint signal reports, and
// none of them trigger a repaint — there is nothing here to repaint):
//
//  - ResizeObserver on the container and every pane: catches almost every
//    reflow, because flex/grid changes nearly always resize something.
//  - MutationObserver (childList + class/style, subtree): catches the
//    position-only reflows RO is blind to — `justify-content` moves panes
//    without resizing any of them — and pane addition/removal.
//  - Transition/animation events: a transitioned layout property (width,
//    flex-basis, gap) moves boxes EVERY FRAME between the discrete
//    endpoints. The oracle samples on rAF exactly while at least one
//    transition or animation is live in the subtree, keyed by
//    `transitionrun`→`transitionend`/`cancel`, so an animated collapse
//    streams poses to the scene and an idle rig costs nothing.

export interface PaneRect {
  /** Left edge in CSS px, relative to the rig's content box. */
  x: number
  /** Top edge in CSS px. */
  y: number
  width: number
  height: number
}

export interface LayoutOracle {
  /**
   * The live layout container. Mutate it to drive layout — toggle a class,
   * flip an attribute a selector matches on — exactly as you would on a page.
   */
  element: HTMLElement
  /** Read every `[data-pane]` box right now. Keyed by the attribute value. */
  measure(): Map<string, PaneRect>
  /**
   * Change feed. Fires once immediately with the current rects, then on
   * every layout change (coalesced per frame while motion is live). The map
   * reuses rect object identities for unchanged panes, so `prev.get(id) ===
   * next.get(id)` is a valid dirty check.
   */
  observe(cb: (rects: Map<string, PaneRect>) => void): () => void
  /** Resize the rig — the layout viewport, and what container queries see. */
  setSize(width: number, height: number): void
  dispose(): void
}

export interface LayoutOracleOptions {
  /** Attribute that marks a measurable box. Default `data-pane` (shadcn owns `data-slot`). */
  paneAttribute?: string
}

/** World-space pose for a pane: center-origin, y-up, `px` CSS px per unit. */
export interface PanePose {
  /** World position of the pane's centre relative to the rig's centre. */
  x: number
  y: number
  /** Plane size in world units. */
  width: number
  height: number
}

// Pure: one rect, projected into the rig group's local space. The rig's
// centre is the group origin; DOM y grows down, world y grows up.
export function paneWorldPose(
  rect: PaneRect,
  layoutWidth: number,
  layoutHeight: number,
  px: number,
): PanePose {
  return {
    x: (rect.x + rect.width / 2 - layoutWidth / 2) / px,
    y: (layoutHeight / 2 - (rect.y + rect.height / 2)) / px,
    width: rect.width / px,
    height: rect.height / px,
  }
}

export function paneRectsEqual(a: PaneRect, b: PaneRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

// Position of `el`'s border box relative to `root`'s border box, by offset
// chain. `offsetLeft` reports against the nearest positioned ancestor, so
// accumulate until the chain reaches (or leaves) the root. Border widths of
// intermediate offsetParents are the known error term; layout templates are
// scaffolding and don't wear borders.
function offsetWithin(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0
  let y = 0
  let node: HTMLElement | null = el
  while (node && node !== root && root.contains(node)) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return { x, y }
}

export function createLayoutOracle(
  markup: string,
  width: number,
  height: number,
  options: LayoutOracleOptions = {},
): LayoutOracle {
  const paneAttribute = options.paneAttribute ?? 'data-pane'

  const element = document.createElement('div')
  // The parking spot (see htmlInCanvas): in-document at the origin, behind
  // the page, inert to the pointer — plus hidden, because unlike a source
  // this thing must never paint. `container-type: size` turns the rig into
  // the query target the (page-global) viewport can't be.
  element.style.cssText =
    `position:fixed;left:0;top:0;z-index:-1;visibility:hidden;` +
    `pointer-events:none;container-type:size;` +
    `width:${width}px;height:${height}px;`
  element.setAttribute('aria-hidden', 'true')
  element.innerHTML = markup
  document.body.appendChild(element)

  let last = new Map<string, PaneRect>()
  const listeners = new Set<(rects: Map<string, PaneRect>) => void>()
  let disposed = false

  const measure = (): Map<string, PaneRect> => {
    const next = new Map<string, PaneRect>()
    for (const node of element.querySelectorAll<HTMLElement>(`[${paneAttribute}]`)) {
      const id = node.getAttribute(paneAttribute)
      if (!id) continue
      // No box, no pane: `display: none` (a container query hid it, say)
      // zeroes the offset box, and a pane the layout gave nothing to should
      // read as absent — its slot renders no panel — not as a dot at the
      // rig's corner.
      if (node.offsetWidth === 0 && node.offsetHeight === 0) continue
      const { x, y } = offsetWithin(node, element)
      const rect: PaneRect = { x, y, width: node.offsetWidth, height: node.offsetHeight }
      const prev = last.get(id)
      // Reuse identities so subscribers can dirty-check by reference.
      next.set(id, prev && paneRectsEqual(prev, rect) ? prev : rect)
    }
    return next
  }

  const changed = (next: Map<string, PaneRect>): boolean => {
    if (next.size !== last.size) return true
    for (const [id, rect] of next) if (last.get(id) !== rect) return true
    return false
  }

  const emit = () => {
    if (disposed) return
    const next = measure()
    if (!changed(next)) return
    last = next
    for (const cb of listeners) cb(next)
  }

  // ── Discrete change signals ──────────────────────────────────────────────
  // Coalesce bursts (a class toggle fires the MO once per attribute plus the
  // RO once per resized pane) into a single measure per microtask.
  let queued = false
  const schedule = () => {
    if (queued || disposed) return
    queued = true
    queueMicrotask(() => {
      queued = false
      emit()
    })
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
  ro?.observe(element)
  const observePanes = () => {
    if (!ro) return
    ro.disconnect()
    ro.observe(element)
    for (const node of element.querySelectorAll<HTMLElement>(`[${paneAttribute}]`)) {
      ro.observe(node)
    }
  }
  observePanes()

  const mo =
    typeof MutationObserver !== 'undefined'
      ? new MutationObserver((records) => {
          if (records.some((r) => r.type === 'childList')) observePanes()
          schedule()
        })
      : null
  mo?.observe(element, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', paneAttribute],
  })

  // ── The continuous window ────────────────────────────────────────────────
  // While any transition/animation is live in the subtree, boxes move every
  // frame with no discrete signal at all. Sample on rAF exactly for the
  // union of those windows. `transitionrun` fires even during the delay
  // phase; `transitioncancel`/`animationcancel` close windows that never
  // reach their end event. Keyed per target+property so overlapping
  // transitions ref-count correctly.
  const live = new Map<EventTarget, Set<string>>()
  let liveCount = 0
  let rafId = 0
  const tick = () => {
    emit()
    rafId = liveCount > 0 && !disposed ? requestAnimationFrame(tick) : 0
  }
  const nameOf = (e: Event) =>
    (e as TransitionEvent).propertyName ?? (e as AnimationEvent).animationName ?? ''
  const motionStart = (e: Event) => {
    if (!e.target) return
    let names = live.get(e.target)
    if (!names) live.set(e.target, (names = new Set()))
    if (!names.has(nameOf(e))) {
      names.add(nameOf(e))
      liveCount++
    }
    if (!rafId && !disposed) rafId = requestAnimationFrame(tick)
  }
  const motionEnd = (e: Event) => {
    const names = e.target ? live.get(e.target) : undefined
    if (names?.delete(nameOf(e))) {
      liveCount--
      if (names.size === 0) live.delete(e.target!)
    }
    // One more emit so the settled boxes always land, even if the final
    // frame's rAF already ran.
    schedule()
  }
  element.addEventListener('transitionrun', motionStart)
  element.addEventListener('transitionend', motionEnd)
  element.addEventListener('transitioncancel', motionEnd)
  element.addEventListener('animationstart', motionStart)
  element.addEventListener('animationend', motionEnd)
  element.addEventListener('animationcancel', motionEnd)

  return {
    element,
    measure,
    observe(cb) {
      listeners.add(cb)
      // First delivery is synchronous: a subscriber renders from it.
      last = measure()
      cb(last)
      return () => listeners.delete(cb)
    },
    setSize(w, h) {
      element.style.width = `${w}px`
      element.style.height = `${h}px`
      schedule()
    },
    dispose() {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      ro?.disconnect()
      mo?.disconnect()
      listeners.clear()
      element.remove()
    },
  }
}
