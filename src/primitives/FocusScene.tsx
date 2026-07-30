import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import {
  createFocusTree,
  createMemoryStack,
  readingOrder,
  type MemoryStack,
  type OrderRect,
} from '../lib/focusTree'
import { tabbables } from '../lib/tabbables'

// FocusScene — lab 007's manager, implementing docs/focus.md.
//
// The invariant everything else hangs off: SCENE FOCUS IS DOCUMENT FOCUS.
// This component never stores "what is focused" — it derives its level from
// document.activeElement at every decision point (locate()) and routes real
// browser focus with element.focus(). The only state it keeps is
// presentation/continuity state the DOM can't hold: the ring cursor (last
// unit visited) and per-group interior memory stacks.
//
// Levels (docs/focus.md "The model"):
//   page     — focus is outside the scene entirely; we never touch it
//   scene    — the GL canvas itself is focused (the page's single entry stop)
//   unit     — a group's unit element is focused (the Surface source root,
//              tabindex=-1): the group selected "as a thing"
//   interior — focus is inside a group's DOM subtree; the browser owns
//              traversal, we only guard the boundary
//
// Keys: Tab/Shift+Tab move between units (one stop per group — APG
// composite convention). Enter/F2 descend into a unit's DOM. Escape
// ascends: interior → unit (clearing that group's memory — Flutter's
// clear-on-explicit-unfocus), unit → scene, scene → subscribers (labs
// decide; e.g. camera home). The scene ring is a closed loop this
// increment: page-embed edge handoff needs the parked subtrees pulled out
// of the native tab order first, which is proxy-layer work (next
// increment).

export type FocusLevel = 'page' | 'scene' | 'unit' | 'interior'
export type GroupFocusState = 'none' | 'unit' | 'interior'
export type FocusCause =
  | 'ring' // Tab between units
  | 'descend' // Enter/F2 into a group's DOM
  | 'ascend' // Escape upward, or Shift+Tab from the first interior element
  | 'exit' // Tab past the last interior element → next unit
  | 'escape' // Escape at scene level (no focus move; subscribers react)
  | 'pointer' // focus arrived by means we didn't initiate (mouse, page Tab)

export interface FocusSceneEvent {
  level: FocusLevel
  groupId?: string
  cause: FocusCause
}

interface CompositeData {
  root: HTMLElement
  object: THREE.Object3D | null
}

interface GroupRegistration {
  id: string
  label?: string
  /** Object projected for ring ordering; falls back to the first composite
   *  member's mesh when absent. */
  objectRef?: RefObject<THREE.Object3D | null>
  onStateChange?: (state: GroupFocusState, cause: FocusCause) => void
}

interface GroupRuntime {
  reg: GroupRegistration
  /** Interior focus memory (docs/focus.md "Focus memory — a stack"). */
  memory: MemoryStack<HTMLElement>
  lastState: GroupFocusState
}

interface FocusSceneApi {
  registerGroup(reg: GroupRegistration): () => void
  registerMember(
    groupId: string,
    entry: { root: HTMLElement; object: THREE.Object3D | null; label?: string },
  ): () => void
  subscribe(fn: (e: FocusSceneEvent) => void): () => void
  focusUnit(groupId: string): boolean
}

const FocusSceneContext = createContext<FocusSceneApi | null>(null)

interface FocusGroupApi {
  registerComposite(entry: {
    root: HTMLElement
    object: THREE.Object3D | null
    label?: string
  }): () => void
}

/** Consumed by Surface for auto-registration; null outside a FocusGroup. */
export const FocusGroupContext = createContext<FocusGroupApi | null>(null)

// --------------------------------------------------------------------------

const _box = new THREE.Box3()
const _corner = new THREE.Vector3()

/** Projected screen-space AABB of an object, or null when it has no volume
 *  or sits entirely behind the camera (those groups ring-order last, in
 *  registration order). */
function screenRect(
  obj: THREE.Object3D,
  camera: THREE.Camera,
  el: HTMLCanvasElement,
): Omit<OrderRect, 'id'> | null {
  _box.setFromObject(obj)
  if (_box.isEmpty()) return null
  const w = el.clientWidth
  const h = el.clientHeight
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let anyInFront = false
  for (let i = 0; i < 8; i++) {
    _corner.set(
      i & 1 ? _box.max.x : _box.min.x,
      i & 2 ? _box.max.y : _box.min.y,
      i & 4 ? _box.max.z : _box.min.z,
    )
    _corner.project(camera)
    if (_corner.z > -1 && _corner.z < 1) anyInFront = true
    const sx = ((_corner.x + 1) / 2) * w
    const sy = ((1 - _corner.y) / 2) * h
    if (sx < minX) minX = sx
    if (sy < minY) minY = sy
    if (sx > maxX) maxX = sx
    if (sy > maxY) maxY = sy
  }
  if (!anyInFront) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

type Located =
  | { level: 'page' }
  | { level: 'scene' }
  | { level: 'unit'; groupId: string }
  | { level: 'interior'; groupId: string }

const ROUTED_KEYS = new Set(['Tab', 'Enter', 'F2', 'Escape'])

export function FocusScene({
  children,
  onFocusChange,
}: {
  children: ReactNode
  onFocusChange?: (e: FocusSceneEvent) => void
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  const tree = useRef(createFocusTree<CompositeData>()).current
  const runtimes = useRef(new Map<string, GroupRuntime>()).current
  const subscribers = useRef(new Set<(e: FocusSceneEvent) => void>()).current
  const cursorRef = useRef<string | null>(null)
  // Cause of the focusin we are about to trigger; a focusin with no pending
  // cause arrived by mouse / native Tab / script — reported as 'pointer'.
  const pendingCauseRef = useRef<FocusCause | null>(null)
  const onFocusChangeRef = useRef(onFocusChange)
  onFocusChangeRef.current = onFocusChange

  const bundle = useMemo(() => {
    const unitElement = (groupId: string): HTMLElement | null =>
      tree.members(groupId).find((m) => m.kind === 'composite')?.data.root ?? null

    const locate = (): Located => {
      const active = document.activeElement
      if (!active || active === document.body) return { level: 'page' }
      if (active === gl.domElement) return { level: 'scene' }
      for (const { id } of tree.groups()) {
        for (const m of tree.members(id)) {
          if (m.data.root === active) return { level: 'unit', groupId: id }
          if (m.data.root.contains(active)) return { level: 'interior', groupId: id }
        }
      }
      return { level: 'page' }
    }

    // Ring order is sampled fresh at each keypress from the CURRENT camera
    // (docs/focus.md "Ordering": imperative at keypress, no React state).
    // Mid-tween presses sample the in-flight camera — acceptable for Tab,
    // whose order barely shifts; arrows (next increment) must gate on
    // tween-settle.
    const ringOrder = (): string[] => {
      const rects: OrderRect[] = []
      const unprojected: string[] = []
      for (const { id } of tree.groups()) {
        const rt = runtimes.get(id)
        const obj =
          rt?.reg.objectRef?.current ??
          tree.members(id).find((m) => m.data.object)?.data.object ??
          null
        const rect = obj ? screenRect(obj, camera, gl.domElement) : null
        if (rect) rects.push({ id, ...rect })
        else unprojected.push(id)
      }
      return [...readingOrder(rects), ...unprojected]
    }

    const notify = (e: FocusSceneEvent) => {
      onFocusChangeRef.current?.(e)
      for (const fn of subscribers) fn(e)
    }

    // Reconcile per-group states + cursor from reality. Runs on every
    // focusin/focusout — mouse clicks, native moves, and our own routing
    // all land here, which is what keeps the manager honest.
    const syncStates = (cause: FocusCause) => {
      const loc = locate()
      if (loc.level === 'unit' || loc.level === 'interior') cursorRef.current = loc.groupId
      for (const [id, rt] of runtimes) {
        const state: GroupFocusState =
          loc.level === 'unit' && loc.groupId === id
            ? 'unit'
            : loc.level === 'interior' && loc.groupId === id
              ? 'interior'
              : 'none'
        if (state !== rt.lastState) {
          rt.lastState = state
          const root = unitElement(id)
          // Paint-property hook for authored markup ([data-focus] CSS);
          // one repaint per transition, deliberate.
          if (root) {
            if (state === 'none') delete root.dataset.focus
            else root.dataset.focus = state
          }
          rt.reg.onStateChange?.(state, cause)
        }
      }
      notify({ ...loc, cause } as FocusSceneEvent)
    }

    const focusEl = (el: HTMLElement, cause: FocusCause) => {
      pendingCauseRef.current = cause
      el.focus({ preventScroll: true })
      // If focus didn't actually move (unfocusable target), don't leave a
      // stale cause armed for the next unrelated focusin.
      if (document.activeElement !== el) pendingCauseRef.current = null
    }

    const focusUnit = (groupId: string, cause: FocusCause): boolean => {
      const root = unitElement(groupId)
      if (!root) return false
      focusEl(root, cause)
      return document.activeElement === root
    }

    const interiorValid = (root: HTMLElement) => (el: HTMLElement) =>
      root.contains(el) &&
      el.isConnected &&
      !el.matches(':disabled') &&
      el.tabIndex >= 0 &&
      el.getClientRects().length > 0

    const descend = (groupId: string) => {
      const root = unitElement(groupId)
      if (!root) return
      const remembered = runtimes.get(groupId)?.memory.recall(interiorValid(root))
      const target = remembered ?? tabbables(root)[0]
      if (target) {
        focusEl(target, 'descend')
      } else {
        // No interior focusables (a read-only panel — the common case in
        // practice). Focus stays at unit, but the descend INTENT still
        // fires: Enter is the commitment gesture and subscribers (camera
        // approach) respond to it, not to whether the DOM had an input.
        notify({ level: 'unit', groupId, cause: 'descend' })
      }
    }

    const step = (ring: string[], from: string | null, dir: 1 | -1): string | null => {
      if (ring.length === 0) return null
      const idx = from ? ring.indexOf(from) : -1
      if (idx === -1) return dir === 1 ? ring[0] : ring[ring.length - 1]
      return ring[(idx + dir + ring.length) % ring.length]
    }

    const onKeydown = (e: KeyboardEvent) => {
      if (!ROUTED_KEYS.has(e.key)) return
      // Bubble phase on document: interior markup (dismissals, editors) has
      // already seen the event — a defaultPrevented key is claimed.
      if (e.defaultPrevented) return
      const loc = locate()
      if (loc.level === 'page') return

      if (loc.level === 'scene') {
        if (e.key === 'Tab') {
          const ring = ringOrder()
          if (ring.length === 0) return // no groups — browser's Tab, unchanged
          e.preventDefault()
          // Advance FROM the cursor, never re-enter it: after Escape-from-
          // unit, Tab means "move on", not "go back where I just was".
          const next = step(ring, cursorRef.current, e.shiftKey ? -1 : 1)
          if (next) focusUnit(next, 'ring')
        } else if (e.key === 'Enter' || e.key === 'F2') {
          const ring = ringOrder()
          if (ring.length === 0) return
          e.preventDefault()
          const target =
            cursorRef.current && ring.includes(cursorRef.current)
              ? cursorRef.current
              : ring[0]
          focusUnit(target, 'ring')
        } else if (e.key === 'Escape') {
          // No focus move at the root — subscribers decide (camera home).
          notify({ level: 'scene', cause: 'escape' })
        }
        return
      }

      if (loc.level === 'unit') {
        if (e.key === 'Tab') {
          const ring = ringOrder()
          e.preventDefault()
          const next = step(ring, loc.groupId, e.shiftKey ? -1 : 1)
          if (next) focusUnit(next, 'ring')
        } else if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault()
          descend(loc.groupId)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          focusEl(gl.domElement, 'ascend')
        }
        return
      }

      // interior — the browser owns traversal; we guard the boundary.
      if (e.key === 'Tab') {
        const root = unitElement(loc.groupId)
        if (!root) return
        const seq = tabbables(root)
        if (seq.length === 0) return
        const active = document.activeElement
        if (!e.shiftKey && active === seq[seq.length - 1]) {
          // Identity check, not press counting (docs/focus.md tab hygiene).
          e.preventDefault()
          const next = step(ringOrder(), loc.groupId, 1)
          if (next) focusUnit(next, 'exit')
        } else if (e.shiftKey && active === seq[0]) {
          e.preventDefault()
          focusUnit(loc.groupId, 'ascend') // one step up: own unit
        }
        // else: native Tab walks the subtree (probe 1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        // Explicit unfocus clears the stack (Flutter): Enter right after
        // must land on the FIRST tabbable, not the thing just escaped.
        runtimes.get(loc.groupId)?.memory.clear()
        focusUnit(loc.groupId, 'ascend')
      }
      // Enter/F2 at interior are the DOM's business.
    }

    const onFocusin = (e: FocusEvent) => {
      const cause = pendingCauseRef.current ?? 'pointer'
      pendingCauseRef.current = null
      const loc = locate()
      if (loc.level === 'interior' && e.target instanceof HTMLElement) {
        runtimes.get(loc.groupId)?.memory.remember(e.target)
      }
      syncStates(cause)
    }

    const onFocusout = (e: FocusEvent) => {
      // Blur with no successor (focus fell to body) still changes states.
      if (!e.relatedTarget) queueMicrotask(() => syncStates('pointer'))
    }

    const api: FocusSceneApi = {
      registerGroup(reg) {
        tree.registerGroup(reg.id, reg.label)
        runtimes.set(reg.id, { reg, memory: createMemoryStack(), lastState: 'none' })
        return () => {
          tree.unregisterGroup(reg.id)
          runtimes.delete(reg.id)
          if (cursorRef.current === reg.id) cursorRef.current = null
        }
      },
      registerMember(groupId, entry) {
        const memberId = entry.label ?? `${groupId}:composite`
        // The unit element contract: focusable by script only. Focusing it
        // paints the browser's own focus treatment into the texture (probe
        // 2) and makes document.activeElement the honest unit-level truth.
        entry.root.tabIndex = -1
        tree.registerMember(groupId, {
          id: memberId,
          kind: 'composite',
          data: { root: entry.root, object: entry.object },
        })
        return () => tree.unregisterMember(groupId, memberId)
      },
      subscribe(fn) {
        subscribers.add(fn)
        return () => subscribers.delete(fn)
      },
      focusUnit: (groupId: string) => focusUnit(groupId, 'ring'),
    }

    return { api, onKeydown, onFocusin, onFocusout, locate, ringOrder }
  }, [camera, gl, tree, runtimes, subscribers])

  useEffect(() => {
    // The canvas is the scene's single entry stop in the page tab order.
    const el = gl.domElement
    const prevTabIndex = el.tabIndex
    el.tabIndex = 0
    document.addEventListener('keydown', bundle.onKeydown)
    document.addEventListener('focusin', bundle.onFocusin)
    document.addEventListener('focusout', bundle.onFocusout)
    const w = window as unknown as { __focusScene?: unknown }
    w.__focusScene = {
      locate: bundle.locate,
      ring: bundle.ringOrder,
      cursor: () => cursorRef.current,
    }
    return () => {
      el.tabIndex = prevTabIndex
      document.removeEventListener('keydown', bundle.onKeydown)
      document.removeEventListener('focusin', bundle.onFocusin)
      document.removeEventListener('focusout', bundle.onFocusout)
      delete w.__focusScene
    }
  }, [bundle, gl])

  return <FocusSceneContext value={bundle.api}>{children}</FocusSceneContext>
}

// --------------------------------------------------------------------------

/**
 * Declares a focus group: one tab stop in the scene ring. Surfaces inside
 * auto-register as composite members via FocusGroupContext; WebGL leaf
 * controls join in the proxy increment. Renders no scene-graph object.
 */
export function FocusGroup({
  id,
  label,
  objectRef,
  onStateChange,
  children,
}: {
  id: string
  label?: string
  objectRef?: RefObject<THREE.Object3D | null>
  onStateChange?: (state: GroupFocusState, cause: FocusCause) => void
  children: ReactNode
}) {
  const scene = use(FocusSceneContext)
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  useEffect(() => {
    if (!scene) return
    return scene.registerGroup({
      id,
      label,
      objectRef,
      onStateChange: (state, cause) => onStateChangeRef.current?.(state, cause),
    })
  }, [scene, id, label, objectRef])

  const api = useMemo<FocusGroupApi | null>(
    () =>
      scene && {
        registerComposite: (entry) => scene.registerMember(id, entry),
      },
    [scene, id],
  )

  return <FocusGroupContext value={api}>{children}</FocusGroupContext>
}

/** Subscribe to scene-level focus events (e.g. Escape-at-scene → camera
 *  home). No-op outside a FocusScene. */
export function useFocusSceneEvents(handler: (e: FocusSceneEvent) => void) {
  const scene = use(FocusSceneContext)
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => scene?.subscribe((e) => ref.current(e)), [scene])
}
