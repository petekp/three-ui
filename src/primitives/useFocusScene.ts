import { use, useEffect } from 'react'
import { useLatest } from './useLatest'
import {
  FocusSceneContext,
  type FocusSceneEvent,
  type NavPolicy,
  type ReframeFulfiller,
} from './focusContext'

// The consumer-facing half of the focus subsystem: four hooks an app reaches
// for, all of them reads of FocusSceneContext.
//
// Each one is a no-op outside a FocusScene rather than a throw. A control
// that wants to nudge a camera it may or may not have is a normal thing to
// write, and a scene assembled without a focus manager is a legitimate scene
// (labs 001–005 are all of them). Refusing to render in that case would make
// every one of these hooks a coupling the library doesn't need.
//
// All four hold the caller's function in a `useLatest` ref and register a
// stable trampoline. Registration is a subscription with real teardown —
// re-running it on every render because a consumer passed an inline arrow
// would churn the scene's subscriber list once a frame.

/** The scene api for imperative integration — chiefly syncProxyRects() at
 *  camera tween-settle / drag-end. Null outside a FocusScene. */
export function useFocusScene(): {
  focusUnit(groupId: string): boolean
  syncProxyRects(): void
} | null {
  return use(FocusSceneContext)
}

/** Subscribe to scene-level focus events (e.g. Escape-at-scene → camera
 *  home). No-op outside a FocusScene. */
export function useFocusSceneEvents(handler: (e: FocusSceneEvent) => void) {
  const scene = use(FocusSceneContext)
  const ref = useLatest(handler)
  useEffect(() => scene?.subscribe((e) => ref.current(e)), [scene, ref])
}

/** Claim reframe fulfillment for the app's camera rig (docs/focus.md
 *  "Reframe bridge"). While ANY fulfiller is registered the built-in bare-
 *  camera truck stands down — the rig owns visibility however it wants,
 *  including ignoring 'descend' requests its approach ride already covers.
 *  No-op outside a FocusScene. */
export function useFocusReframe(fulfiller: ReframeFulfiller) {
  const scene = use(FocusSceneContext)
  const ref = useLatest(fulfiller)
  useEffect(() => scene?.registerReframeFulfiller((req) => ref.current(req)), [scene, ref])
}

/** Claim the no-candidate ladder's view motion (docs/focus.md "Directional
 *  navigation"): `canMove` is the camera-bounds predicate, `nudge` the one-
 *  increment view move. Rigless scenes get no nudge — arrows still work
 *  between projectable candidates; view motion is rig territory. No-op
 *  outside a FocusScene. */
export function useFocusNavPolicy(policy: NavPolicy) {
  const scene = use(FocusSceneContext)
  const ref = useLatest(policy)
  useEffect(
    () =>
      scene?.registerNavPolicy({
        canMove: (dir) => ref.current.canMove(dir),
        nudge: (req) => ref.current.nudge(req),
      }),
    [scene, ref],
  )
}
