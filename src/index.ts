// three-ui — the public surface.
//
// Live DOM as physical matter in WebGL (Chrome's HTML-in-canvas trial). A
// consumer scene imports from here alone; the labs under src/scenes are
// where each primitive earned its place. Curated on purpose: the lib/
// internals (cameraPose, focusTree, spatialNav, physics1D, lodTier) stay
// private — FocusOrbitRig, FocusScene, and the controls wrap them, and
// every constant they hide was measured before it was hidden.

export { Surface, type SurfaceProps } from './primitives/Surface'
export { SurfaceLayer, type SurfaceLayerProps } from './primitives/SurfaceLayer'
export { MomentumCard } from './primitives/MomentumCard'

export { Dial, type DialProps } from './primitives/controls/Dial'
export { Toggle, type ToggleProps } from './primitives/controls/Toggle'
export { Slider, type SliderProps } from './primitives/controls/Slider'

export {
  FocusScene,
  FocusGroup,
  useFocusScene,
  useFocusSceneEvents,
  useFocusReframe,
  useFocusNavPolicy,
  type FocusLevel,
  type GroupFocusState,
  type FocusCause,
  type FocusSceneEvent,
  type ReframeRequest,
  type ReframeFulfiller,
  type NudgeRequest,
  type NavPolicy,
} from './primitives/FocusScene'

export {
  FocusOrbitRig,
  type FocusOrbitRigProps,
  type FocusRigApi,
  type MotionMode,
} from './primitives/FocusOrbitRig'
