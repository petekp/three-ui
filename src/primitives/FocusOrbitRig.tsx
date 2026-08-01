// FocusOrbitRig — the library's orbit-controls camera rig for FocusScene,
// extracted from lab 006 after four increments of browser verification
// (docs/focus.md "Camera integration"; decisions #13). It fulfills the whole
// camera side of the focus grammar by default:
//
//   descend        → approach ride to the engaged unit (park in front of it)
//   release        → position home, view HOLDING the released unit
//   Escape @ scene → home
//   reframe bridge → minimal head-turn to the comfort cone (never a truck)
//   arrow ladder   → head-turn nudges, honest canMove via viewPitchRoom
//   motion modes   → 'animated' | 'instant' | 'auto' (prefers-reduced-motion)
//
// Every armed pose is pre-clamped legal (clampOrbitPose) so the settle
// handoff to OrbitControls is a fixed point; gaze rides yaw/pitch
// decomposition (gazeTween) so corner-to-corner rides cannot whip or arc
// over the zenith; the live aim is published into controls.target every
// tween frame so mid-flight re-arms read the rendered view. Pointer/wheel
// input cancels the tween where it stands — the user always wins.
import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import {
  clampOrbitPose,
  clampViewElevation,
  gazeAt,
  gazeTween,
  viewPitchRoom,
  type GazeTween,
  type OrbitLimits,
} from '../lib/cameraPose'
import {
  useFocusNavPolicy,
  useFocusReframe,
  useFocusScene,
  useFocusSceneEvents,
} from './useFocusScene'

const WORLD_UP = new THREE.Vector3(0, 1, 0)

interface OrbitLike extends OrbitLimits {
  enabled: boolean
  target: THREE.Vector3
  update: () => void
}

export type MotionMode = 'animated' | 'instant' | 'auto'

export interface FocusRigApi {
  /** Ride to `approachDistance` in front of `center` along `facing`. */
  approach: (center: THREE.Vector3, facing: THREE.Vector3) => void
  /** Return the position home; with `lookToward`, HOLD that point in view
   *  from there (release grammar — the same framing Tab gave it) instead of
   *  restoring the default aim, which loses edge panels off-screen. */
  home: (lookToward?: THREE.Vector3) => void
  /** 'auto' (default) follows prefers-reduced-motion; 'instant' jump-cuts
   *  every camera move to its end pose. */
  setMotion: (mode: MotionMode) => void
}

type Vec3ish = THREE.Vector3 | [number, number, number]
const toVec3 = (v: Vec3ish) =>
  v instanceof THREE.Vector3 ? v.clone() : new THREE.Vector3(...v)

export interface FocusOrbitRigProps {
  /** The scene's rest pose. The rig applies it on mount and rides back to
   *  it on release/escape. */
  home: { position: Vec3ish; target: Vec3ish }
  /** How far in front of a unit the approach ride parks. Defaults to the
   *  home viewing distance (|position − target|), floored at the controls'
   *  minDistance so the end pose survives the settle clamp. */
  approachDistance?: number
  /** One head-turn increment for arrow-ladder nudges, radians. */
  nudgeAngle?: number
  /** Fraction of the tighter half-FOV that reads as comfortably framed —
   *  the reframe fulfiller turns only until the target re-enters this cone. */
  comfortFraction?: number
  /** Imperative access (double-click-to-approach, HUD buttons, automation). */
  apiRef?: RefObject<FocusRigApi | null>
}

export function FocusOrbitRig({
  home,
  approachDistance,
  nudgeAngle = 0.35,
  comfortFraction = 0.72,
  apiRef,
}: FocusOrbitRigProps) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls as unknown as OrbitLike | null)
  const gl = useThree((s) => s.gl)
  const focus = useFocusScene()

  const homePos = useRef(toVec3(home.position))
  const homeTarget = useRef(toVec3(home.target))
  homePos.current = toVec3(home.position)
  homeTarget.current = toVec3(home.target)

  const tween = useRef<{
    fromPos: THREE.Vector3
    toPos: THREE.Vector3
    toTarget: THREE.Vector3
    /** Gaze rides yaw/pitch decomposition (cameraPose.ts): lerping the
     *  target POINT can sweep it past the camera and lookAt whips —
     *  browser-measured 1.13 rad in one frame on a corner-to-corner ride.
     *  Angular interpolation makes that impossible. */
    gaze: GazeTween
    t: number
    dur: number
  } | null>(null)
  const curTarget = useRef(new THREE.Vector3())
  const motion = useRef<MotionMode>('auto')

  // Home pose on mount (the Canvas camera default belongs to the app).
  useEffect(() => {
    if (!controls) return
    camera.position.copy(homePos.current)
    controls.target.copy(homeTarget.current)
    controls.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls])

  const instantNow = () =>
    motion.current === 'auto'
      ? (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
      : motion.current === 'instant'

  // Every camera move funnels through here. The pose is pre-clamped to the
  // controls' polar/distance limits BEFORE arming: settle hands the pose to
  // OrbitControls, whose update() re-satisfies clamps by MOVING THE POSITION
  // — a last-frame pop otherwise (cameraPose.ts; vitest-pinned: every top-
  // and middle-row approach pose in lab 006 violated the polar limit).
  // Instant mode applies the same end pose as one jump-cut.
  const armTween = (toPosRaw: THREE.Vector3, toTarget: THREE.Vector3, dur: number) => {
    if (!controls) return
    const toPos = clampOrbitPose(toPosRaw, toTarget, controls)
    if (instantNow()) {
      tween.current = null
      camera.position.copy(toPos)
      controls.target.copy(toTarget)
      curTarget.current.copy(toTarget)
      controls.enabled = true
      controls.update()
      focus?.syncProxyRects()
      return
    }
    controls.enabled = false
    // Seed the live aim now — cancel can fire before the first tween frame.
    curTarget.current.copy(controls.target)
    tween.current = {
      fromPos: camera.position.clone(),
      toPos,
      toTarget: toTarget.clone(),
      gaze: gazeTween(camera.position, controls.target, toPos, toTarget),
      t: 0,
      dur,
    }
  }

  const approachDist = () =>
    Math.max(
      controls?.minDistance ?? 0,
      approachDistance ?? homePos.current.distanceTo(homeTarget.current),
    )

  const impl: FocusRigApi = {
    approach: (center, facing) =>
      armTween(center.clone().addScaledVector(facing, approachDist()), center.clone(), 0.9),
    home: (lookToward) => {
      let toTarget = homeTarget.current.clone()
      if (lookToward && controls) {
        const d = lookToward.clone().sub(homePos.current)
        if (d.lengthSq() > 1e-8) {
          clampViewElevation(d.normalize(), controls)
          toTarget = homePos.current
            .clone()
            .addScaledVector(d, homePos.current.distanceTo(homeTarget.current))
        }
      }
      armTween(homePos.current.clone(), toTarget, 0.9)
    },
    setMotion: (mode) => {
      motion.current = mode
    },
  }
  const implRef = useRef(impl)
  implRef.current = impl

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      approach: (center, facing) => implRef.current.approach(center, facing),
      home: (lookToward) => implRef.current.home(lookToward),
      setMotion: (mode) => implRef.current.setMotion(mode),
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef])

  // The camera side of the focus grammar (docs/focus.md): Enter's descend is
  // the commitment gesture — that's the zoom-in moment. Escape's release
  // brings the position home while the view HOLDS the released unit; the
  // ladder's last rung (scene-level Escape) steps fully home. Pointer-caused
  // focus never moves the camera — that rule lives in the bridge itself
  // (maybeReframe skips 'pointer'), not here.
  useFocusSceneEvents((e) => {
    if (e.cause === 'descend' && e.object) {
      implRef.current.approach(
        e.object.getWorldPosition(new THREE.Vector3()),
        e.object.getWorldDirection(new THREE.Vector3()),
      )
    } else if (e.cause === 'release') {
      implRef.current.home(
        e.object ? e.object.getWorldPosition(new THREE.Vector3()) : undefined,
      )
    } else if (e.level === 'scene' && e.cause === 'escape') {
      implRef.current.home()
    }
  })

  // Reframe fulfiller (docs/focus.md "Reframe bridge"): the rig claims
  // visibility, standing the library's bare-camera truck down. 'descend' is
  // ignored — the approach ride already centers that target. Fulfillment is
  // a HEAD-TURN, not a truck: in an arc workspace you survey by turning in
  // place, and screen-space pixel deltas linearize catastrophically for far
  // panels (a box straddling the camera plane projects to absurd rects —
  // browser-verified runaway to x≈−1000). The angular form is exact for any
  // panel direction, minimal (rotates only to the comfort-cone edge), and
  // bounded by π.
  useFocusReframe((req) => {
    if (req.cause === 'descend' || !controls) return
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    const camPos = camera.position
    const panelPos = new THREE.Vector3().setFromMatrixPosition(req.object.matrixWorld)
    // controls.target carries the LIVE aim even mid-tween (useFrame syncs it
    // every frame), so a fast Tab re-aims from the rendered view, and the
    // radius clamp guards mid-flight distances the lerp path can produce.
    const dist = THREE.MathUtils.clamp(
      controls.target.distanceTo(camPos),
      controls.minDistance ?? 0,
      controls.maxDistance ?? Infinity,
    )
    const d = controls.target.clone().sub(camPos).normalize()
    const dStar = panelPos.clone().sub(camPos).normalize()
    const fovRad = THREE.MathUtils.degToRad(camera.fov)
    const hFov = Math.atan(Math.tan(fovRad / 2) * (req.viewport.w / req.viewport.h))
    const allow = Math.min(fovRad / 2, hFov) * comfortFraction
    const between = d.angleTo(dStar)
    if (between <= allow) return
    const axis = new THREE.Vector3().crossVectors(d, dStar)
    if (axis.lengthSq() < 1e-10) return // dead astern — no unique turn
    axis.normalize()
    // The head-turn keeps the POSITION sacred, so legality comes from
    // bending the view elevation, not the pose clamp (cameraPose.ts).
    const dNew = clampViewElevation(d.applyAxisAngle(axis, between - allow), controls)
    armTween(
      camPos.clone(),
      camPos.clone().addScaledVector(dNew, dist),
      // Big turns get a little more time; nudges stay snappy.
      THREE.MathUtils.clamp(0.3 + (between - allow) * 0.3, 0.3, 0.8),
    )
  })

  // No-candidate ladder (docs/focus.md "Directional navigation"): an arrow
  // with nothing in its direction may nudge the VIEW one increment instead —
  // the same head-turn grammar as the fulfiller, so "looking further that
  // way" and "being steered to a panel" read as one body. Yaw is unbounded
  // (no azimuth clamps on this orbit); pitch is bounded by the polar band,
  // and viewPitchRoom is the honest predicate — at the band edge the press
  // is a no-op rather than a dead-feeling half-tween.
  useFocusNavPolicy({
    canMove: (dir) => {
      if (!controls) return false
      if (dir === 'left' || dir === 'right') return true
      const d = controls.target.clone().sub(camera.position).normalize()
      const room = viewPitchRoom(d, controls)
      return (dir === 'up' ? room.up : room.down) > 1e-3
    },
    nudge: ({ dir }) => {
      if (!controls) return
      const camPos = camera.position
      const dist = THREE.MathUtils.clamp(
        controls.target.distanceTo(camPos),
        controls.minDistance ?? 0,
        controls.maxDistance ?? Infinity,
      )
      const d = controls.target.clone().sub(camPos).normalize()
      if (dir === 'left' || dir === 'right') {
        // Positive yaw about +Y turns the view leftward (counter-clockwise
        // seen from above).
        d.applyAxisAngle(WORLD_UP, dir === 'left' ? nudgeAngle : -nudgeAngle)
      } else {
        const room = viewPitchRoom(d, controls)
        const amt = Math.min(nudgeAngle, dir === 'up' ? room.up : room.down)
        if (amt < 1e-4) return
        // d × UP is the rightward horizontal axis; positive rotation about
        // it pitches the view UP. Degenerate only when looking straight
        // down — an extreme user-orbited pose; skip rather than guess.
        const axis = new THREE.Vector3().crossVectors(d, WORLD_UP)
        if (axis.lengthSq() < 1e-10) return
        axis.normalize()
        d.applyAxisAngle(axis, dir === 'up' ? amt : -amt)
        clampViewElevation(d, controls)
      }
      armTween(camPos.clone(), camPos.clone().addScaledVector(d.normalize(), dist), 0.35)
    },
  })

  // A grab of the controls mid-tween should win instantly.
  useEffect(() => {
    const el = gl.domElement
    const cancel = () => {
      const tw = tween.current
      if (!tw || !controls) return
      tween.current = null
      controls.target.copy(curTarget.current)
      controls.enabled = true
      controls.update()
    }
    el.addEventListener('pointerdown', cancel)
    el.addEventListener('wheel', cancel)
    return () => {
      el.removeEventListener('pointerdown', cancel)
      el.removeEventListener('wheel', cancel)
    }
  }, [gl, controls])

  useFrame((_, delta) => {
    const tw = tween.current
    if (!tw || !controls) return
    tw.t = Math.min(1, tw.t + delta / tw.dur)
    const k = tw.t * tw.t * (3 - 2 * tw.t) // smoothstep
    camera.position.lerpVectors(tw.fromPos, tw.toPos, k)
    gazeAt(tw.gaze, camera.position, k, curTarget.current)
    // Publish the live aim every frame (controls are disabled — no fight).
    // Arming a NEW tween mid-flight reads controls.target as "where am I
    // looking"; without this it held the stale settle-time value, and fast
    // Tab snapped the view back to it — instantaneous jank by construction.
    controls.target.copy(curTarget.current)
    camera.lookAt(curTarget.current)
    if (tw.t >= 1) {
      tween.current = null
      camera.position.copy(tw.toPos)
      controls.target.copy(tw.toTarget)
      controls.enabled = true
      controls.update()
      // Tween-settle is the sanctioned proxy-rect sync point (docs/focus.md:
      // on demand, never per frame) — AT reads geometry from wherever the
      // camera came to rest.
      focus?.syncProxyRects()
    }
  })

  return null
}
