// The style bridge: CSS custom properties as mesh channels.
//
// A registered custom property (`@property` / CSS.registerProperty with a
// real syntax) is interpolable, so `transition: --depth 300ms ease` runs a
// genuine CSSTransition — timed, eased, and staged by the cascade like any
// paint property, but painting NOTHING: a custom property no paint rule
// consumes never invalidates a paint record (measured: zero paints across a
// full 600ms transition). getComputedStyle mid-transition returns the eased
// intermediate value synchronously — the style engine is the interpolation
// oracle, and no easing math exists in our code.
//
// That makes the cascade a channel authority for the MESH: Tailwind
// utilities (`[--depth:0.5]`, `hover:[--depth:1]`, `transition-[--depth]`)
// or plain CSS declare what a surface's depth/tilt/glow should be and how it
// should get there; the scene reads the channel per frame and moves matter.
// The hover twin (`data-hover`, decisions #19) makes variant-driven channels
// work through a texture unmodified.
//
// Contract: a channel lives on ONE element — author the property's value,
// its transition, and its variants on that element. (Transition events do
// not descend, so a channel can't watch a value it inherits from an
// ancestor; the value would move and nobody would hear it.)

export interface StyleChannelOptions {
  /** Registered syntax. Default '<number>' — the mesh-channel shape. */
  syntax?: string
  /** Registered initial value. Default '0'. */
  initialValue?: string
  /** Registered inheritance. Default false — a channel is local to its
   *  element (see the one-element contract above). */
  inherits?: boolean
}

export interface StyleChannel {
  /** Current value, read live from computed style — mid-transition this is
   *  the eased intermediate. Cheap while style is clean; intended to be
   *  polled per frame (useFrame). */
  get(): number
  /** Change notification: fires per animation frame while the property
   *  transitions, once (coalesced) after a discrete change. Returns
   *  unsubscribe. */
  observe(cb: (value: number) => void): () => void
  dispose(): void
}

// registerProperty throws on re-registration (including a stylesheet
// @property that got there first). Registration is global and permanent, so
// an idempotent guard + swallow is the whole story.
const registered = new Set<string>()

export function ensureChannelRegistered(
  property: string,
  { syntax = '<number>', initialValue = '0', inherits = false }: StyleChannelOptions = {},
): void {
  if (registered.has(property)) return
  registered.add(property)
  const css = (globalThis as { CSS?: { registerProperty?: (d: object) => void } }).CSS
  if (!css?.registerProperty) return // layoutless envs; CSS may declare @property
  try {
    css.registerProperty({ name: property, syntax, initialValue, inherits })
  } catch {
    // Already registered (by CSS @property or an earlier run) — fine.
  }
}

export function createStyleChannel(
  el: HTMLElement,
  property: string,
  opts: StyleChannelOptions = {},
): StyleChannel {
  ensureChannelRegistered(property, opts)
  const fallback = parseFloat(opts.initialValue ?? '0') || 0

  const read = (): number => {
    const raw = getComputedStyle(el).getPropertyValue(property)
    const v = parseFloat(raw)
    return Number.isNaN(v) ? fallback : v
  }

  const observers = new Set<(value: number) => void>()
  let last = read()
  const emit = () => {
    const v = read()
    if (v === last) return
    last = v
    for (const cb of observers) cb(v)
  }

  // Discrete changes (a class flip with no transition declared) fire no
  // transition event — one coalesced settle sample covers them.
  let queued = false
  const schedule = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!disposed) emit()
    })
  }

  // Transitioning values move every frame with no discrete signal — the
  // transition events bound an rAF sampling window, exactly the layout
  // oracle's motion-window shape (#25). Ref-count by property occurrence so
  // overlapping transitions (interrupted + restarted) keep one loop.
  let live = 0
  let disposed = false
  const tick = () => {
    if (disposed || live <= 0) return
    emit()
    requestAnimationFrame(tick)
  }
  const isOurs = (e: Event) =>
    e.target === el && (e as TransitionEvent).propertyName === property
  const onRun = (e: Event) => {
    if (!isOurs(e)) return
    live += 1
    if (live === 1) requestAnimationFrame(tick)
  }
  const onDone = (e: Event) => {
    if (!isOurs(e)) return
    live = Math.max(0, live - 1)
    schedule() // land the exact final value
  }
  el.addEventListener('transitionrun', onRun)
  el.addEventListener('transitionend', onDone)
  el.addEventListener('transitioncancel', onDone)

  const mo = new MutationObserver(schedule)
  mo.observe(el, { attributes: true })

  return {
    get: read,
    observe(cb) {
      observers.add(cb)
      return () => observers.delete(cb)
    },
    dispose() {
      disposed = true
      observers.clear()
      mo.disconnect()
      el.removeEventListener('transitionrun', onRun)
      el.removeEventListener('transitionend', onDone)
      el.removeEventListener('transitioncancel', onDone)
    },
  }
}
