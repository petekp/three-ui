import { useRef } from 'react'

/**
 * A ref that always holds the value from the most recent render.
 *
 * Read a prop *without depending on it*. That sounds like a lint workaround
 * and here it is the opposite — it is how the expensive effects in this
 * package stay honest about what actually invalidates them:
 *
 *  - `Surface`'s source creation is a teardown. It destroys a live DOM
 *    subtree and everything living in it (focus, form values, selection, any
 *    second React root a scene mounted inside), so a prop that does not mean
 *    "this is different content now" must not appear in its deps. Each one
 *    that did was a bug: `width`/`height` killed a measured Surface on every
 *    resize, `paint` killed one for a flag the effect never even reads.
 *  - `useSourceHost.mount` is handed to `onSource` and must never change
 *    identity, for the same reason.
 *
 * Assignment during render is safe for this pattern (the ref is only ever
 * read from effects, frame callbacks and event handlers — never during the
 * render that writes it), and unlike a `useEffect` write it is already
 * current when a `useFrame` callback runs later in the same tick.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}
