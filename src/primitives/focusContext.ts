import { createContext, type RefObject } from 'react'
import type * as THREE from 'three'
import type { Viewport } from '../lib/focusTree'
import type { Dir } from '../lib/spatialNav'

// The focus subsystem's contract: what a scene and a group promise each
// other, and the two contexts that carry those promises down the tree.
//
// Split out of FocusScene.tsx, which implements them. Three reasons, in
// increasing order of how much they matter:
//
//  - Fast Refresh gives up on any module that exports both components and
//    non-components, so editing the manager meant a full reload of the very
//    scene you were mid-way through focusing. HMR works on both halves now.
//  - `Surface` reads FocusGroupContext to auto-register. Importing that from
//    the manager pulled 1200 lines of state machine into every Surface, for
//    one context object.
//  - It reads better. The contract is ~150 lines of prose-annotated types;
//    the machine that satisfies it is a different kind of document.
//
// docs/focus.md is the specification these types are the API surface of.

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
  /** The registered focus object for `groupId` (FocusGroup objectRef, else
   *  the first member object) — resolved at emit time so camera rigs can
   *  fulfill the descend/release grammar without keeping their own
   *  id→object map. Absent for scene/page-level events. */
  object?: THREE.Object3D | null
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

export interface GroupRegistration {
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

export interface FocusSceneApi {
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

export const FocusSceneContext = createContext<FocusSceneApi | null>(null)

export interface FocusGroupApi {
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
