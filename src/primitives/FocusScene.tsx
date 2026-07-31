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
import { useFrame, useThree } from '@react-three/fiber'
import {
  createFocusTree,
  createMemoryStack,
  entryPick,
  interiorBoundary,
  needsReframe,
  readingOrder,
  reframeDelta,
  sceneRing,
  type MemoryStack,
  type OrderRect,
  type Viewport,
} from '../lib/focusTree'
import { tabbables } from '../lib/tabbables'
import {
  createDirectionalHistory,
  directionalPick,
  type Dir,
  type NavRect,
} from '../lib/spatialNav'

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
  | 'interior' // Tab across a member boundary INSIDE a group (composite ⇄ leaf)
  | 'escape' // Escape at scene level (no focus move; subscribers react)
  | 'release' // Escape out of an ENGAGED group — the camera's cue to un-commit
  | 'pointer' // focus arrived by means we didn't initiate (mouse, page Tab)
  | 'directional' // arrow-key spatial move between units (docs/focus.md)

export interface FocusSceneEvent {
  level: FocusLevel
  groupId?: string
  cause: FocusCause
}

// Reframe bridge (docs/focus.md, ratified 2026-07-30). The DOM's focus()
// carries an implicit obligation — the scroll container brings the focused
// element into view. Our preventScroll:true suppresses the page's fulfillment
// (correct: panels aren't in page flow) so the obligation transfers to the
// camera. But the camera is APP state (orbit rigs, scroll cameras, XR heads
// we must never move) — so the library only DETECTS and REQUESTS; the app's
// rig fulfills however it wants. A minimal built-in fulfiller covers rigless
// scenes so the invariant holds out of the box.

export interface ReframeRequest {
  groupId: string
  /** The scene object whose projection triggered the request. */
  object: THREE.Object3D
  /** Projected rect in canvas CSS px; null = entirely behind the camera. */
  rect: { x: number; y: number; w: number; h: number } | null
  viewport: Viewport
  /** 'descend' is the commitment gesture (center-stage it); every other
   *  cause wants the MINIMAL correction (scrollIntoView block:'nearest'). */
  cause: FocusCause
  level: FocusLevel
}

export type ReframeFulfiller = (req: ReframeRequest) => void

// Directional-nav policy (docs/focus.md "no-candidate ladder"). When an
// arrow finds no candidate in its direction, the ladder asks whether the
// VIEW can still move that way — if yes, nudge the camera one increment and
// leave focus put (repeated presses alternate tween…tween…focus as targets
// come into view); if no, the press is a no-op at the scene root. Camera
// bounds are app state (orbit clamps, scroll extents), so like reframing
// this is detect-here / fulfill-there: the app registers the predicate and
// the motion. Rigless scenes get no nudge — spatial arrows still work
// between projectable candidates; view motion is rig territory.

export interface NudgeRequest {
  dir: Dir
  viewport: Viewport
}

export interface NavPolicy {
  /** Can the view move any further in this direction? (For orbit rigs: yaw
   *  is unbounded, pitch has the polar band — see viewPitchRoom.) */
  canMove(dir: Dir): boolean
  /** Move the view one increment in the direction. Never moves focus. */
  nudge(req: NudgeRequest): void
}

/** One shape for both member kinds: a composite's root is the Surface source
 *  subtree; a leaf's root is its ARIA proxy in the shared portal layer. */
interface MemberData {
  root: HTMLElement
  object: THREE.Object3D | null
}

// Leaf members (docs/focus.md "Proxy contract"): a WebGL-only control backed
// by a visually-hidden proxy element carrying real focus + ARIA semantics.
// 'switch'/'button' land when Toggle/pushbutton wiring does — no untested
// role paths shipped ahead of a control that exercises them.
export type LeafRole = 'slider'

export type LeafKeyAction =
  | { type: 'step'; dir: 1 | -1 } // arrows — impulses into the physics
  | { type: 'jump'; to: 'min' | 'max' } // Home/End — APG-mandatory absolutes

export interface LeafAria {
  min: number
  max: number
  now: number
  /** Human units ("440 Hz"), not raw indices. */
  valuetext?: string
  orientation?: 'horizontal' | 'vertical'
}

export interface LeafEntry {
  label: string
  role: LeafRole
  /** Projected for the proxy's screen rect (mobile AT explores by position). */
  object: THREE.Object3D | null
  aria: LeafAria
  /** Explicit traversal order (Flutter OrderedTraversalPolicy). Default:
   *  composites first, then leaves, registration order within each kind. */
  order?: number
  onKey?: (action: LeafKeyAction) => void
  /** Real focus arriving on / leaving the proxy — drive the mesh glow. */
  onFocus?: (focused: boolean) => void
}

export interface LeafHandle {
  /** Update the announced value at settle — never per physics frame. */
  setAria(patch: Partial<Pick<LeafAria, 'now' | 'valuetext'>>): void
  dispose(): void
}

interface GroupRegistration {
  id: string
  label?: string
  /** Authored ring position. Groups with an order ignore camera geometry
   *  entirely (sceneRing); unordered groups fall back to reading order. */
  order?: number
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
    entry: { root: HTMLElement; object: THREE.Object3D | null; label?: string; order?: number },
  ): () => void
  registerLeaf(groupId: string, entry: LeafEntry): LeafHandle
  subscribe(fn: (e: FocusSceneEvent) => void): () => void
  /** App camera rigs claim visibility fulfillment; the built-in minimal
   *  fulfiller stands down while any registration is live. */
  registerReframeFulfiller(fn: ReframeFulfiller): () => void
  /** App rigs claim the no-candidate ladder's view motion (see NavPolicy). */
  registerNavPolicy(policy: NavPolicy): () => void
  focusUnit(groupId: string): boolean
  /** One shared projection pass repositioning every leaf proxy. Called on
   *  focus transitions automatically; call it at tween-settle / drag-end —
   *  never per frame (react-three-a11y's open perf bug). */
  syncProxyRects(): void
}

const FocusSceneContext = createContext<FocusSceneApi | null>(null)

interface FocusGroupApi {
  registerComposite(entry: {
    root: HTMLElement
    object: THREE.Object3D | null
    label?: string
    order?: number
  }): () => void
  registerLeaf(entry: LeafEntry): LeafHandle
}

/** Consumed by Surface for auto-registration; null outside a FocusGroup. */
export const FocusGroupContext = createContext<FocusGroupApi | null>(null)

// --------------------------------------------------------------------------

const _box = new THREE.Box3()
const _corner = new THREE.Vector3()
const _navPos = new THREE.Vector3()

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

const ARROW_DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

const ROUTED_KEYS = new Set(['Tab', 'Enter', 'F2', 'Escape', ...Object.keys(ARROW_DIRS)])

export function FocusScene({
  children,
  onFocusChange,
  initialFocus,
  reframeMargin = 24,
}: {
  children: ReactNode
  onFocusChange?: (e: FocusSceneEvent) => void
  /** Group the first Tab into the scene selects. Default: entryPick — the
   *  nearest fully-visible unit to the viewport center. */
  initialFocus?: string
  /** Inset (CSS px) the reframe correction aims inside — scroll-margin's
   *  analog. */
  reframeMargin?: number
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  const tree = useRef(createFocusTree<MemberData>()).current
  const runtimes = useRef(new Map<string, GroupRuntime>()).current
  const subscribers = useRef(new Set<(e: FocusSceneEvent) => void>()).current
  const fulfillers = useRef(new Set<ReframeFulfiller>()).current
  const navPolicies = useRef(new Set<NavPolicy>()).current
  const cursorRef = useRef<string | null>(null)
  // Cause of the focusin we are about to trigger; a focusin with no pending
  // cause arrived by mouse / native Tab / script — reported as 'pointer'.
  const pendingCauseRef = useRef<FocusCause | null>(null)
  const onFocusChangeRef = useRef(onFocusChange)
  onFocusChangeRef.current = onFocusChange
  const initialFocusRef = useRef(initialFocus)
  initialFocusRef.current = initialFocus
  const marginRef = useRef(reframeMargin)
  marginRef.current = reframeMargin
  // The built-in fulfiller's tween: a bare camera truck, consumed by
  // useFrame below. Never armed while an app fulfiller is registered.
  const defaultTweenRef = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number } | null>(
    null,
  )

  const bundle = useMemo(() => {
    // ONE portal layer for every proxy (docs/focus.md: never a React root per
    // proxy — that's react-three-a11y's crash class). Plain imperative DOM:
    // we're inside the r3f reconciler, where a react-dom portal can't reach.
    // Children are position:fixed, so the layer itself has no geometry.
    const proxyLayer = document.createElement('div')
    proxyLayer.dataset.threeUiProxyLayer = ''
    let leafSeq = 0

    const hasComposite = (groupId: string) =>
      tree.members(groupId).some((m) => m.kind === 'composite')

    const unitElement = (groupId: string): HTMLElement | null => {
      const members = tree.members(groupId)
      return (
        members.find((m) => m.kind === 'composite')?.data.root ??
        // Leaf-only group: the first proxy IS the unit — a free-standing
        // control is its own stop, no descend ceremony (APG single-widget-
        // cell rule). Ring focus lands directly on the control.
        members[0]?.data.root ??
        null
      )
    }

    /** Per-member element sequences in authored order: a composite's
     *  tabbables (browser-owned interior), a leaf's single proxy. */
    const memberSequences = (groupId: string): HTMLElement[][] =>
      tree
        .members(groupId)
        .map((m) => (m.kind === 'composite' ? tabbables(m.data.root) : [m.data.root]))

    const interiorFirst = (groupId: string): HTMLElement | null => {
      for (const seq of memberSequences(groupId)) if (seq[0]) return seq[0]
      return null
    }

    const locate = (): Located => {
      const active = document.activeElement
      if (!active || active === document.body) return { level: 'page' }
      if (active === gl.domElement) return { level: 'scene' }
      for (const { id } of tree.groups()) {
        for (const m of tree.members(id)) {
          if (m.data.root === active) {
            // A focused leaf proxy is a control INSIDE a mixed group; only
            // in a leaf-only group is the proxy the unit itself.
            if (m.kind === 'leaf' && hasComposite(id))
              return { level: 'interior', groupId: id }
            return { level: 'unit', groupId: id }
          }
          if (m.data.root.contains(active)) return { level: 'interior', groupId: id }
        }
      }
      return { level: 'page' }
    }

    /** Position one proxy at its object's projected rect. No rect (behind
     *  camera, no volume): keep the last position — a focused proxy must
     *  never become unreachable or display:none (docs/focus.md). */
    const positionProxy = (proxy: HTMLElement, object: THREE.Object3D | null) => {
      if (!object) return
      const rect = screenRect(object, camera, gl.domElement)
      if (!rect) return
      const canvasBox = gl.domElement.getBoundingClientRect()
      proxy.style.left = `${canvasBox.left + rect.x}px`
      proxy.style.top = `${canvasBox.top + rect.y}px`
      // Floor the box: zero-area focusables are a flagged a11y anti-pattern.
      proxy.style.width = `${Math.max(rect.w, 12)}px`
      proxy.style.height = `${Math.max(rect.h, 12)}px`
    }

    const syncProxyRects = () => {
      for (const { id } of tree.groups()) {
        for (const m of tree.members(id)) {
          if (m.kind === 'leaf') positionProxy(m.data.root, m.data.object)
        }
      }
    }

    const groupObject = (id: string): THREE.Object3D | null =>
      runtimes.get(id)?.reg.objectRef?.current ??
      tree.members(id).find((m) => m.data.object)?.data.object ??
      null

    const viewport = (): Viewport => ({
      w: gl.domElement.clientWidth,
      h: gl.domElement.clientHeight,
    })

    // Authored order wins (sceneRing — the group half of Flutter's policy
    // split, adopted after the first user test scrambled a designed grid);
    // camera geometry is consulted only for unordered groups, sampled fresh
    // at the keypress. Fully-authored scenes never project here at all.
    const ringOrder = (): string[] => {
      const groups = tree.groups()
      const rects: OrderRect[] = []
      const unprojected: string[] = []
      for (const { id, order } of groups) {
        if (order !== undefined) continue
        const obj = groupObject(id)
        const rect = obj ? screenRect(obj, camera, gl.domElement) : null
        if (rect) rects.push({ id, ...rect })
        else unprojected.push(id)
      }
      return sceneRing(groups, [...readingOrder(rects), ...unprojected])
    }

    // Scene-entry policy: with no live cursor, the first Tab/Enter selects
    // what the user is looking at — authored initialFocus, else the nearest
    // fully-visible unit to the viewport center (entryPick).
    const entryTarget = (ring: string[]): string | null => {
      const initial = initialFocusRef.current
      if (initial && ring.includes(initial)) return initial
      const rects: OrderRect[] = []
      for (const id of ring) {
        const obj = groupObject(id)
        const rect = obj ? screenRect(obj, camera, gl.domElement) : null
        if (rect) rects.push({ id, ...rect })
      }
      return entryPick(rects, viewport())
    }

    // ENGAGED — the altitude latch (docs/focus.md, ratified 2026-07-30):
    // descend is a commitment the camera physically enacts, so while a group
    // is engaged, Tab traverses its members and WRAPS — the group is modal,
    // Escape is the release. The latch lives in the document as a stamp on
    // the unit root ([data-engaged] — same channel the focus chrome reads),
    // set/cleared only at explicit gesture sites; click-in without descend
    // never sets it, so mouse-entered interiors keep APG exit-at-edge.
    const isEngaged = (groupId: string): boolean =>
      unitElement(groupId)?.dataset.engaged === '1'

    const setEngaged = (groupId: string, on: boolean) => {
      const root = unitElement(groupId)
      if (!root) return
      if (on) root.dataset.engaged = '1'
      else delete root.dataset.engaged
    }

    // ---- Reframe bridge ----------------------------------------------------

    /** The object AT reads focus geometry from: the focused leaf's own mesh
     *  when a proxy holds focus, else the group's registered object. */
    const focusedObject = (groupId: string): THREE.Object3D | null => {
      const active = document.activeElement
      const leaf = tree
        .members(groupId)
        .find((m) => m.kind === 'leaf' && m.data.root === active)
      return leaf?.data.object ?? groupObject(groupId)
    }

    /** Built-in minimal fulfiller: truck the bare camera by the world-space
     *  equivalent of the screen overshoot at the object's depth. No controls
     *  integration, no lookAt change — apps with rigs register their own
     *  fulfiller and this never runs. */
    const defaultReframe = (req: ReframeRequest) => {
      if (!req.rect) return
      if (!(camera instanceof THREE.PerspectiveCamera)) return
      const raw = reframeDelta(req.rect, req.viewport, marginRef.current)
      if (raw.dx === 0 && raw.dy === 0) return
      // Pixel math linearizes badly once a box nears the camera plane (its
      // projected rect explodes). Bound the correction to one viewport per
      // event: monotone progress toward visibility, never a runaway.
      const dx = THREE.MathUtils.clamp(raw.dx, -req.viewport.w, req.viewport.w)
      const dy = THREE.MathUtils.clamp(raw.dy, -req.viewport.h, req.viewport.h)
      const objPos = new THREE.Vector3().setFromMatrixPosition(req.object.matrixWorld)
      const depth = objPos.distanceTo(camera.position)
      const fov = THREE.MathUtils.degToRad(camera.fov)
      const worldPerPx = (2 * depth * Math.tan(fov / 2)) / req.viewport.h
      // Camera right → image left; camera up → image down. Solve for the
      // truck that moves the IMAGE by (dx, dy).
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
      const delta = right.multiplyScalar(-dx * worldPerPx).add(up.multiplyScalar(dy * worldPerPx))
      // prefers-reduced-motion: same correction as a jump-cut. Vestibular-
      // safe is a library floor, not app policy.
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        camera.position.add(delta)
        syncProxyRects()
        return
      }
      defaultTweenRef.current = {
        from: camera.position.clone(),
        to: camera.position.clone().add(delta),
        t: 0,
      }
    }

    /** Detect a focus-visibility violation and request fulfillment. Pointer
     *  causes never reframe (mouse grammar owns its own camera); 'descend'
     *  emits so rigless scenes get a floor, but rigs typically ignore it —
     *  their commitment ride already centers the target. */
    const maybeReframe = (loc: Located, cause: FocusCause) => {
      if (cause === 'pointer' || cause === 'escape' || cause === 'release') return
      if (loc.level !== 'unit' && loc.level !== 'interior') return
      const obj = focusedObject(loc.groupId)
      if (!obj) return
      const vp = viewport()
      const rect = screenRect(obj, camera, gl.domElement)
      if (rect && !needsReframe(rect, vp)) return
      const req: ReframeRequest = {
        groupId: loc.groupId,
        object: obj,
        rect,
        viewport: vp,
        cause,
        level: loc.level,
      }
      if (fulfillers.size > 0) for (const f of fulfillers) f(req)
      else defaultReframe(req)
    }

    // ---- Directional navigation (arrows) -----------------------------------

    const history = createDirectionalHistory()

    /** Candidate rects for a spatial pick: every registered group except the
     *  origin, projected fresh at this keypress (nothing cached but the
     *  history trail). Depth = camera distance — the painting-order
     *  tie-break for stacked insiders. */
    const navCandidates = (excludeId: string): NavRect[] => {
      const out: NavRect[] = []
      for (const { id } of tree.groups()) {
        if (id === excludeId) continue
        const obj = groupObject(id)
        if (!obj) continue
        const rect = screenRect(obj, camera, gl.domElement)
        if (!rect) continue
        out.push({
          id,
          ...rect,
          depth: camera.position.distanceTo(_navPos.setFromMatrixPosition(obj.matrixWorld)),
        })
      }
      return out
    }

    const notify = (e: FocusSceneEvent) => {
      // Any focus change that ISN'T an arrow move invalidates the
      // directional trail — Tab, Enter, Escape, clicks, external moves,
      // disposals. One chokepoint covers Flutter's whole invalidation row.
      if (e.cause !== 'directional') history.clear()
      onFocusChangeRef.current?.(e)
      for (const fn of subscribers) fn(e)
    }

    // Reconcile per-group states + cursor from reality. Runs on every
    // focusin/focusout — mouse clicks, native moves, and our own routing
    // all land here, which is what keeps the manager honest.
    const syncStates = (cause: FocusCause) => {
      // Proxies track their objects on demand, and a focus transition is the
      // moment AT reads focused-element geometry — the one place a shared
      // projection pass is always warranted.
      syncProxyRects()
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
            if (state === 'none') {
              delete root.dataset.focus
              // Focus left the group by ANY route (pointer, dispose,
              // programmatic) — the trap must not outlive residency.
              delete root.dataset.engaged
            } else {
              root.dataset.focus = state
            }
          }
          rt.reg.onStateChange?.(state, cause)
        }
      }
      notify({ ...loc, cause } as FocusSceneEvent)
      // The ported scrollIntoView obligation, checked at every transition we
      // caused. Runs AFTER notify so fulfillers see the event first.
      maybeReframe(loc, cause)
    }

    const focusEl = (el: HTMLElement, cause: FocusCause) => {
      // Already focused: .focus() would fire no focusin, leaving the cause
      // armed for the next unrelated one. Nothing to do.
      if (document.activeElement === el) return
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

    // A remembered interior element is valid if it's still operable AND
    // still one of ours: inside a composite member's subtree (not the unit
    // root itself), or a leaf member's proxy.
    const interiorValid = (groupId: string) => (el: HTMLElement) => {
      if (!el.isConnected || el.matches(':disabled')) return false
      if (el.tabIndex < 0 || el.getClientRects().length === 0) return false
      return tree
        .members(groupId)
        .some((m) =>
          m.kind === 'leaf' ? m.data.root === el : m.data.root !== el && m.data.root.contains(el),
        )
    }

    const descend = (groupId: string) => {
      const remembered = runtimes.get(groupId)?.memory.recall(interiorValid(groupId))
      const target = remembered ?? interiorFirst(groupId)
      // The latch sets at the GESTURE — Enter is the commitment the camera
      // enacts. Click-in interiors never pass through here, so they never
      // trap (APG exit-at-edge preserved for mouse-entered focus).
      setEngaged(groupId, true)
      if (target && target !== document.activeElement) {
        focusEl(target, 'descend')
      } else {
        // No interior focusables (a read-only panel — the common case in
        // practice), or the target already holds focus (a leaf-only group's
        // proxy-as-unit). Focus stays put, but the descend INTENT still
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

    /** An arrow press at scene/unit level: retrace the trail, else pick
     *  geometrically, else climb the no-candidate ladder. `originId` null
     *  means nothing is selected — arrows enter like Tab, landing on what
     *  the user is already looking at. */
    const handleArrow = (dir: Dir, originId: string | null) => {
      if (!originId) {
        const target = entryTarget(ringOrder())
        if (target) focusUnit(target, 'directional')
        return
      }
      const back = history.onArrow(dir, (id) => unitElement(id) !== null)
      if (back) {
        focusUnit(back, 'directional')
        return
      }
      const obj = groupObject(originId)
      const originRect = obj ? screenRect(obj, camera, gl.domElement) : null
      if (!originRect) {
        // Unprojectable origin (behind the camera) anchors no geometry;
        // treat the press as re-entry toward whatever is in view.
        const target = entryTarget(ringOrder())
        if (target && target !== originId) focusUnit(target, 'directional')
        return
      }
      const pick = directionalPick(originRect, navCandidates(originId), dir)
      if (pick) {
        if (focusUnit(pick, 'directional')) history.record(originId, dir)
        return
      }
      // The ladder: no candidate in the direction. If the view can still
      // move that way, nudge one increment WITHOUT moving focus — repeated
      // presses alternate tween…tween…focus as targets come into view.
      // Can't move either: the press is a no-op at the scene root.
      for (const policy of navPolicies) {
        if (policy.canMove(dir)) {
          policy.nudge({ dir, viewport: viewport() })
          return
        }
      }
    }

    const onKeydown = (e: KeyboardEvent) => {
      if (!ROUTED_KEYS.has(e.key)) return
      // Bubble phase on document: interior markup (dismissals, editors) has
      // already seen the event — a defaultPrevented key is claimed.
      if (e.defaultPrevented) return
      const loc = locate()
      if (loc.level === 'page') return

      const arrowDir = ARROW_DIRS[e.key]
      if (arrowDir) {
        // Modified arrows belong to the platform (OS window management,
        // word navigation) — never route them.
        if (e.altKey || e.ctrlKey || e.metaKey) return
        // The DOM owns arrows below unit altitude: leaf proxies stepped
        // their physics before this handler ran (the defaultPrevented gate
        // above), text carets and scroll containers keep native behavior.
        // An ENGAGED unit reads the same way — arrows scroll the committed
        // panel's content natively; Tab is the member traversal.
        if (loc.level === 'interior') return
        if (loc.level === 'unit' && isEngaged(loc.groupId)) return
        e.preventDefault()
        handleArrow(arrowDir, loc.level === 'unit' ? loc.groupId : cursorRef.current)
        return
      }

      if (loc.level === 'scene') {
        if (e.key === 'Tab') {
          const ring = ringOrder()
          if (ring.length === 0) return // no groups — browser's Tab, unchanged
          e.preventDefault()
          const cursor = cursorRef.current
          // With a live cursor, advance FROM it, never re-enter it: after
          // Escape-from-unit, Tab means "move on". With none, this is scene
          // ENTRY: select what the user is looking at (entry policy), not
          // ring[0] — the ratified fix for "first Tab landed off-screen".
          const next =
            cursor !== null && ring.includes(cursor)
              ? step(ring, cursor, e.shiftKey ? -1 : 1)
              : (entryTarget(ring) ?? step(ring, null, e.shiftKey ? -1 : 1))
          if (next) focusUnit(next, 'ring')
        } else if (e.key === 'Enter' || e.key === 'F2') {
          const ring = ringOrder()
          if (ring.length === 0) return
          e.preventDefault()
          const cursor = cursorRef.current
          const target =
            cursor !== null && ring.includes(cursor)
              ? cursor
              : (entryTarget(ring) ?? ring[0])
          focusUnit(target, 'ring')
        } else if (e.key === 'Escape') {
          // No focus move at the root — subscribers decide (camera home).
          notify({ level: 'scene', cause: 'escape' })
        }
        return
      }

      if (loc.level === 'unit') {
        if (e.key === 'Tab') {
          e.preventDefault()
          if (isEngaged(loc.groupId)) {
            // Trapped: at descended altitude Tab traverses THIS group's
            // members — forward enters at the first element, backward at the
            // last (wrap grammar). A read-only engaged panel has no interior:
            // Tab is dead until Escape releases.
            const flat = memberSequences(loc.groupId).flat()
            const target = e.shiftKey ? flat[flat.length - 1] : flat[0]
            if (target) focusEl(target, 'interior')
            return
          }
          const ring = ringOrder()
          const next = step(ring, loc.groupId, e.shiftKey ? -1 : 1)
          if (next) focusUnit(next, 'ring')
        } else if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault()
          descend(loc.groupId)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          if (isEngaged(loc.groupId)) {
            // RELEASE: un-latch and cue the camera home in one gesture.
            // Focus HOLDS on the unit — no focusin fires — so the event
            // dispatches manually; the next Tab resumes the ring from here.
            setEngaged(loc.groupId, false)
            notify({ level: 'unit', groupId: loc.groupId, cause: 'release' })
            return
          }
          focusEl(gl.domElement, 'ascend')
        }
        return
      }

      // interior — the browser owns traversal INSIDE a composite member;
      // the manager owns every member boundary (composite edges, both sides
      // of a leaf proxy). Identity checks, not press counting (docs/focus.md
      // tab hygiene) — interiorBoundary is the vitest-pinned decision.
      if (e.key === 'Tab') {
        const active = document.activeElement
        if (!(active instanceof HTMLElement)) return
        const action = interiorBoundary(
          memberSequences(loc.groupId),
          active,
          e.shiftKey ? -1 : 1,
        )
        if (action.type === 'native') return // native Tab walks the subtree (probe 1)
        e.preventDefault()
        if (action.type === 'move') {
          focusEl(action.to, 'interior')
        } else if (action.type === 'exit') {
          if (isEngaged(loc.groupId)) {
            // Trap wrap: past the last member → back to the first.
            const first = interiorFirst(loc.groupId)
            if (first) focusEl(first, 'interior')
            return
          }
          const next = step(ringOrder(), loc.groupId, 1)
          if (next) focusUnit(next, 'exit')
        } else {
          if (isEngaged(loc.groupId)) {
            // Trap wrap, backward: before the first member → the last.
            const flat = memberSequences(loc.groupId).flat()
            const last = flat[flat.length - 1]
            if (last) focusEl(last, 'interior')
            return
          }
          focusUnit(loc.groupId, 'ascend') // one step up: own unit
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        // Explicit unfocus clears the stack (Flutter): Enter right after
        // must land on the FIRST tabbable, not the thing just escaped.
        runtimes.get(loc.groupId)?.memory.clear()
        if (isEngaged(loc.groupId)) {
          // RELEASE from inside: one Escape un-latches, lands on the unit,
          // and cues the camera home ('release' rides the focusin).
          setEngaged(loc.groupId, false)
          focusUnit(loc.groupId, 'release')
          return
        }
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

    // Click grammar: clicking a surface SELECTS its unit — the pointer
    // analog of Tab, minus the camera ('pointer' cause skips reframe: a
    // clicked panel is visible by definition). Clicks that land real focus
    // themselves (a button — forwardEvents' focus fixup) win; selection only
    // fills the gap where the fixup left the group without focus. Capture
    // phase, because focus-follows-click is browser behavior, not an event
    // contract markup can stopPropagation away.
    const groupAt = (el: Element): string | null => {
      for (const { id } of tree.groups())
        for (const m of tree.members(id))
          if (m.kind === 'composite' && m.data.root.contains(el)) return id
      return null
    }

    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return
      const groupId = groupAt(e.target)
      if (!groupId) return
      // forwardPointer runs its focus fixup AFTER dispatching the click —
      // including a blur when nothing focusable was under the point, which
      // would immediately undo a focus set here. Defer one microtask so the
      // fixup settles first, then fill in only if the group ended up bare.
      queueMicrotask(() => {
        const loc = locate()
        if ((loc.level === 'unit' || loc.level === 'interior') && loc.groupId === groupId)
          return
        focusUnit(groupId, 'pointer')
      })
    }

    const api: FocusSceneApi = {
      registerGroup(reg) {
        tree.registerGroup(reg.id, reg.label, reg.order)
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
          order: entry.order,
          data: { root: entry.root, object: entry.object },
        })
        return () => tree.unregisterMember(groupId, memberId)
      },
      registerLeaf(groupId, entry) {
        const proxy = document.createElement('div')
        // Probe 5: an opacity:0 fixed element with tabindex=0 is reachable
        // and receives arrows. Never display:none / visibility:hidden /
        // inert / zero-area — every one makes the proxy unreachable.
        // pointer-events:none: hit-testable invisible elements are
        // react-three-a11y's largest bug class; the canvas raycast path
        // owns clicks (they coincide spatially — proxy sits at the
        // projected rect).
        proxy.tabIndex = 0
        proxy.setAttribute('role', entry.role)
        proxy.setAttribute('aria-label', entry.label)
        proxy.style.cssText =
          'position:fixed;left:0;top:0;width:24px;height:24px;opacity:0;pointer-events:none;margin:0;'
        proxy.setAttribute('aria-valuemin', String(entry.aria.min))
        proxy.setAttribute('aria-valuemax', String(entry.aria.max))
        proxy.setAttribute('aria-valuenow', String(entry.aria.now))
        if (entry.aria.valuetext) proxy.setAttribute('aria-valuetext', entry.aria.valuetext)
        if (entry.aria.orientation)
          proxy.setAttribute('aria-orientation', entry.aria.orientation)

        // Native-semantics key contract (APG slider): all four arrows,
        // Up/Right increase; Home/End are mandatory absolute jumps.
        // preventDefault keeps arrows from scrolling the page (probe 6).
        const onKeydown = (e: KeyboardEvent) => {
          let action: LeafKeyAction | null = null
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') action = { type: 'step', dir: 1 }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft')
            action = { type: 'step', dir: -1 }
          else if (e.key === 'Home') action = { type: 'jump', to: 'min' }
          else if (e.key === 'End') action = { type: 'jump', to: 'max' }
          if (action) {
            e.preventDefault()
            entry.onKey?.(action)
          }
        }
        const onFocus = () => entry.onFocus?.(true)
        const onBlur = () => entry.onFocus?.(false)
        proxy.addEventListener('keydown', onKeydown)
        proxy.addEventListener('focus', onFocus)
        proxy.addEventListener('blur', onBlur)
        proxyLayer.appendChild(proxy)

        const memberId = `${groupId}:leaf:${leafSeq++}:${entry.label}`
        tree.registerMember(groupId, {
          id: memberId,
          kind: 'leaf',
          order: entry.order,
          data: { root: proxy, object: entry.object },
        })
        positionProxy(proxy, entry.object)

        return {
          setAria(patch) {
            if (patch.now !== undefined) proxy.setAttribute('aria-valuenow', String(patch.now))
            if (patch.valuetext !== undefined) proxy.setAttribute('aria-valuetext', patch.valuetext)
          },
          dispose() {
            // Never yank a focused proxy out from under the user — that
            // silently drops focus to <body> (react-three-a11y's culling
            // bug). Hand focus up first: own unit, else the canvas.
            if (document.activeElement === proxy) {
              tree.unregisterMember(groupId, memberId)
              if (!focusUnit(groupId, 'ascend')) focusEl(gl.domElement, 'ascend')
            } else {
              tree.unregisterMember(groupId, memberId)
            }
            proxy.removeEventListener('keydown', onKeydown)
            proxy.removeEventListener('focus', onFocus)
            proxy.removeEventListener('blur', onBlur)
            proxy.remove()
          },
        }
      },
      subscribe(fn) {
        subscribers.add(fn)
        return () => subscribers.delete(fn)
      },
      registerReframeFulfiller(fn) {
        fulfillers.add(fn)
        // An app rig taking over cancels any built-in truck mid-flight.
        defaultTweenRef.current = null
        return () => fulfillers.delete(fn)
      },
      registerNavPolicy(policy) {
        navPolicies.add(policy)
        return () => navPolicies.delete(policy)
      },
      focusUnit: (groupId: string) => focusUnit(groupId, 'ring'),
      syncProxyRects,
    }

    const debugMembers = (groupId: string) =>
      tree.members(groupId).map((m) => ({ id: m.id, kind: m.kind }))

    return {
      api,
      onKeydown,
      onFocusin,
      onFocusout,
      onClick,
      locate,
      ringOrder,
      entryTarget,
      isEngaged,
      proxyLayer,
      debugMembers,
      historySize: () => history.size(),
    }
  }, [camera, gl, tree, runtimes, subscribers, fulfillers, navPolicies])

  // The built-in fulfiller's consumer: a 0.32s smoothstep truck. Armed only
  // in rigless scenes — registering any app fulfiller disarms it for good.
  useFrame((_, dt) => {
    const tw = defaultTweenRef.current
    if (!tw) return
    tw.t = Math.min(1, tw.t + dt / 0.32)
    const k = tw.t * tw.t * (3 - 2 * tw.t)
    camera.position.lerpVectors(tw.from, tw.to, k)
    if (tw.t >= 1) {
      defaultTweenRef.current = null
      bundle.api.syncProxyRects()
    }
  })

  useEffect(() => {
    // The canvas is the scene's single entry stop in the page tab order.
    const el = gl.domElement
    const prevTabIndex = el.tabIndex
    el.tabIndex = 0
    // The proxy layer mounts adjacent to the canvas (docs/focus.md). Leaf
    // registrations from child effects ran before this parent effect and
    // appended into the (detached) layer — insertion carries them along.
    el.insertAdjacentElement('afterend', bundle.proxyLayer)
    document.addEventListener('keydown', bundle.onKeydown)
    document.addEventListener('focusin', bundle.onFocusin)
    document.addEventListener('focusout', bundle.onFocusout)
    document.addEventListener('click', bundle.onClick, true)
    const w = window as unknown as { __focusScene?: unknown }
    w.__focusScene = {
      locate: bundle.locate,
      ring: bundle.ringOrder,
      cursor: () => cursorRef.current,
      entry: () => bundle.entryTarget(bundle.ringOrder()),
      engaged: (groupId: string) => bundle.isEngaged(groupId),
      members: bundle.debugMembers,
      historySize: bundle.historySize,
      syncProxies: bundle.api.syncProxyRects,
      proxies: () =>
        [...bundle.proxyLayer.children].map((p) => ({
          label: p.getAttribute('aria-label'),
          role: p.getAttribute('role'),
          now: p.getAttribute('aria-valuenow'),
          text: p.getAttribute('aria-valuetext'),
          rect: (p as HTMLElement).getBoundingClientRect().toJSON(),
          focused: document.activeElement === p,
        })),
    }
    return () => {
      el.tabIndex = prevTabIndex
      bundle.proxyLayer.remove()
      document.removeEventListener('keydown', bundle.onKeydown)
      document.removeEventListener('focusin', bundle.onFocusin)
      document.removeEventListener('focusout', bundle.onFocusout)
      document.removeEventListener('click', bundle.onClick, true)
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
  order,
  objectRef,
  onStateChange,
  children,
}: {
  id: string
  label?: string
  /** Authored scene-ring position (docs/focus.md "Ordering"). Ordered groups
   *  ignore camera geometry; omit to fall back to projected reading order. */
  order?: number
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
      order,
      objectRef,
      onStateChange: (state, cause) => onStateChangeRef.current?.(state, cause),
    })
  }, [scene, id, label, order, objectRef])

  const api = useMemo<FocusGroupApi | null>(
    () =>
      scene && {
        registerComposite: (entry) => scene.registerMember(id, entry),
        registerLeaf: (entry) => scene.registerLeaf(id, entry),
      },
    [scene, id],
  )

  return <FocusGroupContext value={api}>{children}</FocusGroupContext>
}

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
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => scene?.subscribe((e) => ref.current(e)), [scene])
}

/** Claim reframe fulfillment for the app's camera rig (docs/focus.md
 *  "Reframe bridge"). While ANY fulfiller is registered the built-in bare-
 *  camera truck stands down — the rig owns visibility however it wants,
 *  including ignoring 'descend' requests its approach ride already covers.
 *  No-op outside a FocusScene. */
export function useFocusReframe(fulfiller: ReframeFulfiller) {
  const scene = use(FocusSceneContext)
  const ref = useRef(fulfiller)
  ref.current = fulfiller
  useEffect(() => scene?.registerReframeFulfiller((req) => ref.current(req)), [scene])
}

/** Claim the no-candidate ladder's view motion (docs/focus.md "Directional
 *  navigation"): `canMove` is the camera-bounds predicate, `nudge` the one-
 *  increment view move. Rigless scenes get no nudge — arrows still work
 *  between projectable candidates; view motion is rig territory. No-op
 *  outside a FocusScene. */
export function useFocusNavPolicy(policy: NavPolicy) {
  const scene = use(FocusSceneContext)
  const ref = useRef(policy)
  ref.current = policy
  useEffect(
    () =>
      scene?.registerNavPolicy({
        canMove: (dir) => ref.current.canMove(dir),
        nudge: (req) => ref.current.nudge(req),
      }),
    [scene],
  )
}
