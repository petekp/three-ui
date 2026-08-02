// three-ui — the public surface.
//
// Live DOM as physical matter in WebGL (Chrome's HTML-in-canvas trial).
// Everything a consumer may touch is re-exported here, plus the stylesheet
// at `three-ui/style.css`, which is not optional — see its header for the
// two rules it carries and the three it asks of you in return.
//
// Curated on purpose. The lib/ internals (cameraPose, focusTree, spatialNav,
// physics1D, lodTier, motionSamples) stay private: FocusOrbitRig, FocusScene
// and the controls wrap them, and every constant they hide was measured
// before it was hidden. The labs under app/scenes are where each primitive
// below earned its place, and they import from here and nowhere else — so a
// gap in this file shows up as a broken lab rather than as a relative path
// quietly reaching around it.

// ── The atom, and the two ways to fill it ────────────────────────────────
// A `Surface` is one mesh whose material is a live DOM subtree. Give it
// markup for something static, or use `SurfaceApp` to hand it a React tree.
export { Surface, type SurfaceProps } from './primitives/Surface'
export { SurfaceApp, type SurfaceAppProps } from './primitives/SurfaceApp'
export { SurfaceLayer, type SurfaceLayerProps } from './primitives/SurfaceLayer'
// The shader seam: with `material="none"` a Surface yields its material slot
// to its children, and this is how the custom material reaches the live DOM
// texture it should sample.
export { useSurfaceTexture } from './primitives/SurfaceContext'

// The surface protocol's retellings bubble to window BY DESIGN (Radix's
// grace areas live on document), so page-level pointer listeners hear two
// voices. Default guard: `if (!e.isTrusted) return` — the hand is the only
// trusted pointer. This predicate is the complement, for consumers whose own
// input is legitimately untrusted (AT middleware, remote control, harnesses)
// and who must reject specifically the library's voice (decisions #50).
export { isForgedEvent } from './lib/forged'

// ── The floating family ──────────────────────────────────────────────────
// One lever — a portaled component's `container` — and three places to aim
// it: a panel's own layer for anything anchored to a control, the viewer's
// slab for anything anchored to nobody, and a detached surface for anything
// that should be furniture in the room. See docs/authoring.md.
export {
  AnchoredSurface,
  type AnchoredSurfaceProps,
} from './primitives/floating/AnchoredSurface'
export {
  ViewerSurface,
  type ViewerSurfaceProps,
} from './primitives/floating/ViewerSurface'
export {
  FloatingSurface,
  type FloatingSurfaceProps,
} from './primitives/floating/FloatingSurface'
// The pose `ViewerSurface` rides on, for scene content that should hang off
// the eye without being a Surface at all.
export {
  CameraChrome,
  type CameraChromeProps,
} from './primitives/floating/CameraChrome'

// CSS-declared motion, performed by the mesh (decisions #17). Public because
// a consumer with layer geometry of its own needs the same bridge.
export { useAnimationConductor } from './primitives/useAnimationConductor'
export type { MotionValue } from './lib/motionSamples'

// ── Focus, and the camera that follows it ────────────────────────────────
export { FocusScene, FocusGroup } from './primitives/FocusScene'
export {
  useFocusScene,
  useFocusSceneEvents,
  useFocusReframe,
  useFocusNavPolicy,
} from './primitives/useFocusScene'
export type {
  FocusLevel,
  GroupFocusState,
  FocusCause,
  FocusSceneEvent,
  ReframeRequest,
  ReframeFulfiller,
  NudgeRequest,
  NavPolicy,
} from './primitives/focusContext'
export {
  FocusOrbitRig,
  type FocusOrbitRigProps,
  type FocusRigApi,
  type MotionMode,
} from './primitives/FocusOrbitRig'

// ── Physical controls ────────────────────────────────────────────────────
export { MomentumCard, type MomentumCardProps } from './primitives/controls/MomentumCard'
export { Dial, type DialProps } from './primitives/controls/Dial'
export { Toggle, type ToggleProps } from './primitives/controls/Toggle'
export { Slider, type SliderProps } from './primitives/controls/Slider'

// ── Layout ───────────────────────────────────────────────────────────────
export { arcLayout, type ArcSlot, type ArcLayoutOptions } from './lib/arcLayout'
// The layout oracle: author panel arrangement as real CSS in a hidden rig,
// and the scene wears the boxes. DOM stays the layout authority.
export {
  DomLayout,
  LayoutSlot,
  type DomLayoutProps,
  type LayoutSlotProps,
  type LayoutSlotBox,
} from './primitives/DomLayout'
export {
  createLayoutOracle,
  paneWorldPose,
  type LayoutOracle,
  type LayoutOracleOptions,
  type PaneRect,
  type PanePose,
} from './lib/layoutOracle'

// ── The style bridge ─────────────────────────────────────────────────────
// CSS custom properties as mesh channels (decisions #28). A registered
// property transitions as real CSS — timed, eased, zero paints — and the
// scene polls the eased value per frame. Tailwind variants (`[--depth:0.5]`,
// `hover:[--depth:1]`, `transition-[--depth]`) become mesh state.
export { useStyleChannel } from './primitives/useStyleChannel'
export {
  createStyleChannel,
  ensureChannelRegistered,
  type StyleChannel,
  type StyleChannelOptions,
} from './lib/styleChannel'

// ── Below the r3f layer ──────────────────────────────────────────────────
// `Surface` is the react-three-fiber wrapper; this is the engine underneath
// it, and it is framework-agnostic. Reach for it to check whether the trial
// is available at all, or to drive a mesh three-ui does not own.
export {
  detectHtmlInCanvas,
  createDomTextureSource,
  type HtmlInCanvasSupport,
  type DomTextureSource,
  type DomTextureSourceOptions,
  type PaintStats,
} from './lib/htmlInCanvas'
