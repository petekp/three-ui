import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Surface } from '../primitives/Surface'
import {
  FocusGroup,
  useFocusReframe,
  useFocusScene,
  useFocusSceneEvents,
  type GroupFocusState,
} from '../primitives/FocusScene'
import { Dial } from '../primitives/controls/Dial'
import { arcLayout, type ArcSlot } from '../lib/arcLayout'
import {
  clampOrbitPose,
  clampViewElevation,
  gazeAt,
  gazeTween,
  type GazeTween,
  type OrbitLimits,
} from '../lib/cameraPose'
import {
  buildPanels,
  injectLab006Styles,
  PANEL_W,
  PANEL_H,
  type PanelSpec,
} from './lab006Content'

// Lab 006 — the spatial workspace: attention is a place.
//
// ~33 real DOM panels on a cylindrical arc around the viewer. The periphery
// stays ambient (perspective compresses it; paint pulses surface changes
// pre-attentively); approaching a panel makes it fully real — caret, focus,
// native typing. The upload-on-paint contract is what makes the paradigm
// affordable: every idle panel is free, so the scene's cost tracks *change*,
// exactly like attention does.
//
// Interaction grammar:
//   double-click a panel  → camera dollies to face it head-on
//   double-click the floor → step back to the room view
//   drag a panel's title bar → reposition it (ray ∩ horizontal plane,
//     MomentumCard's capture idiom — decisions.md #4)
//   click into text and type → it's just the DOM

const W3 = PANEL_W / 200
const H3 = PANEL_H / 200
const COLS = 11
const ROWS = 3
const RADIUS = 7
const SPAN = THREE.MathUtils.degToRad(210)
const ROW_YS = [0.78, 2.36, 3.94]
const LOOK_TARGET = new THREE.Vector3(0, 1.7, 0)
const HOME_POS = new THREE.Vector3(0, 2.0, 3.4)
const HOME_TARGET = new THREE.Vector3(0, 1.6, 0)
const APPROACH_DIST = 3.05 // ≥ OrbitControls minDistance so the tween's end pose survives

interface OrbitLike extends OrbitLimits {
  enabled: boolean
  target: THREE.Vector3
  update: () => void
}

type MotionMode = 'animated' | 'instant' | 'auto'

interface RigApi {
  approach: (center: THREE.Vector3, facing: THREE.Vector3) => void
  /** Return the position home; with `lookToward`, HOLD that point in view
   *  from there (release grammar — the same framing Tab gave it) instead of
   *  restoring the default aim, which loses edge panels off-screen. */
  home: (lookToward?: THREE.Vector3) => void
  /** 'auto' (default) follows prefers-reduced-motion; 'instant' jump-cuts
   *  every camera move to its end pose. */
  setMotion: (mode: MotionMode) => void
}

// ---------------------------------------------------------------------------
// CameraRig: owns the approach/home tween. OrbitControls is disabled for the
// duration; any pointer/wheel input cancels the tween where it stands and
// hands the pose back to the user.

function CameraRig({ api }: { api: React.RefObject<RigApi | null> }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls as unknown as OrbitLike | null)
  const gl = useThree((s) => s.gl)
  const focus = useFocusScene()

  const tween = useRef<{
    fromPos: THREE.Vector3
    toPos: THREE.Vector3
    toTarget: THREE.Vector3
    /** Gaze rides the great circle between the two aims (cameraPose.ts):
     *  lerping the target POINT can sweep it past the camera and lookAt
     *  whips — browser-measured 1.13 rad in one frame on a corner-to-
     *  corner ride. Angular interpolation makes that impossible. */
    gaze: GazeTween
    t: number
    dur: number
  } | null>(null)
  const curTarget = useRef(new THREE.Vector3())
  const motion = useRef<MotionMode>('auto')

  // Home pose on mount (App's Canvas camera default belongs to other labs).
  useEffect(() => {
    if (!controls) return
    camera.position.copy(HOME_POS)
    controls.target.copy(HOME_TARGET)
    controls.update()
  }, [camera, controls])

  const instantNow = () =>
    motion.current === 'auto'
      ? (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
      : motion.current === 'instant'

  // Every camera move funnels through here. The pose is pre-clamped to the
  // controls' polar/distance limits BEFORE arming: settle hands the pose to
  // OrbitControls, whose update() re-satisfies clamps by MOVING THE POSITION
  // — a last-frame pop otherwise (cameraPose.ts; vitest-pinned: every top-
  // and middle-row approach pose violated the polar limit). Instant mode
  // applies the same end pose as one jump-cut.
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

  const impl: RigApi = {
    approach: (center, facing) =>
      armTween(center.clone().addScaledVector(facing, APPROACH_DIST), center.clone(), 0.9),
    home: (lookToward) => {
      let toTarget = HOME_TARGET.clone()
      if (lookToward && controls) {
        const d = lookToward.clone().sub(HOME_POS)
        if (d.lengthSq() > 1e-8) {
          clampViewElevation(d.normalize(), controls)
          toTarget = HOME_POS.clone().addScaledVector(d, HOME_POS.distanceTo(HOME_TARGET))
        }
      }
      armTween(HOME_POS.clone(), toTarget, 0.9)
    },
    setMotion: (mode) => {
      motion.current = mode
    },
  }
  const implRef = useRef(impl)
  implRef.current = impl

  useEffect(() => {
    api.current = {
      approach: (center, facing) => implRef.current.approach(center, facing),
      home: (lookToward) => implRef.current.home(lookToward),
      setMotion: (mode) => implRef.current.setMotion(mode),
    }
    return () => {
      api.current = null
    }
  }, [api])

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
    // Inside ~72% of the tighter half-angle reads as comfortably framed.
    const allow = Math.min(fovRad / 2, hFov) * 0.72
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

// ---------------------------------------------------------------------------
// One workspace panel: a Surface plus a grab handle. Dragging follows
// MomentumCard's idiom — pointer capture on the handle, all math from
// e.ray ∩ a horizontal plane seated at grab time (decisions.md #4).

function WorkPanel({
  spec,
  slot,
  order,
  rig,
  register,
}: {
  spec: PanelSpec
  slot: ArcSlot
  order: number
  rig: React.RefObject<RigApi | null>
  register: (id: string, group: THREE.Group | null) => void
}) {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls as unknown as OrbitLike | null)
  const drag = useRef({ active: false, lastX: 0, lastY: 0, angle: 0, radius: 0 })
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState<GroupFocusState>('none')
  const focusScene = useFocusScene()
  // The live source root, for satellite controls that paint into the panel
  // (the dial's readout is real DOM — that's the point).
  const sourceRoot = useRef<HTMLElement | null>(null)

  const approachNow = () => {
    const g = group.current
    if (!g || !rig.current) return
    const center = g.getWorldPosition(new THREE.Vector3())
    const facing = g.getWorldDirection(new THREE.Vector3()) // +z = panel front
    rig.current.approach(center, facing)
  }

  const approach = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    approachNow()
  }

  // Drag is a parametric polar mapping from pointer DELTAS, not a plane
  // intersection: screen-x slides the panel around the arc, screen-y pulls
  // it closer / pushes it away. A ray ∩ horizontal-plane version was tried
  // and failed geometrically: upper-row handles sit above eye level, and a
  // downward ray meets an overhead plane receding toward infinity — "pull
  // toward me" read as "fly away". Deltas keep the reference frame static
  // (decisions.md #4's actual point) and behave identically at every row
  // height. Same shape as use1DOF's pointer→coordinate mapping.
  const onHandleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const g = group.current
    if (!g) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    if (controls) controls.enabled = false
    const d = drag.current
    d.active = true
    d.lastX = e.nativeEvent.clientX
    d.lastY = e.nativeEvent.clientY
    d.angle = Math.atan2(g.position.x, -g.position.z)
    d.radius = Math.hypot(g.position.x, g.position.z)
  }

  const onHandleMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    const g = group.current
    if (!d.active || !g) return
    const dx = e.nativeEvent.clientX - d.lastX
    const dy = e.nativeEvent.clientY - d.lastY
    d.lastX = e.nativeEvent.clientX
    d.lastY = e.nativeEvent.clientY
    d.angle += dx * 0.0032
    d.radius = THREE.MathUtils.clamp(d.radius - dy * 0.011, 2.2, 8.6)
    g.position.x = d.radius * Math.sin(d.angle)
    g.position.z = -d.radius * Math.cos(d.angle)
    g.lookAt(camera.position.x, g.position.y, camera.position.z)
  }

  const onHandleUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d.active) return
    d.active = false
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    if (controls) controls.enabled = true
    // The panel (and its satellite dial) came to rest somewhere new.
    focusScene?.syncProxyRects()
  }

  return (
    <group
      position={slot.position}
      ref={(g) => {
        group.current = g
        register(spec.id, g)
        if (g) g.lookAt(LOOK_TARGET.x, LOOK_TARGET.y, LOOK_TARGET.z)
      }}
    >
      <FocusGroup id={spec.id} order={order} objectRef={group} onStateChange={setFocus}>
        <Surface
          label={`lab006-${spec.id}`}
          name={`lab006-${spec.id}`}
          html={spec.html}
          width={PANEL_W}
          height={PANEL_H}
          onSource={(root) => {
            sourceRoot.current = root
            const cleanup = spec.feed?.(root)
            return () => {
              sourceRoot.current = null
              cleanup?.()
            }
          }}
          onDoubleClick={approach}
          castShadow
        >
          <planeGeometry args={[W3, H3]} />
        </Surface>
        {/* Satellite knob: a WebGL leaf in the SAME focus group — Tab flows
            from the panel's last button onto it (lab 007's mixed-group
            proof). Its detents paint the panel's readout: physics in the
            scene, consequence in the document. */}
        {spec.dial && (
          <Dial
            position={[W3 / 2 + 0.46, -H3 * 0.12, 0.14]}
            scale={0.72}
            detents={spec.dial.detents}
            initialDetent={spec.dial.initialDetent}
            focusLabel={spec.dial.label}
            valueText={(i) => spec.dial!.values[i]}
            onDetent={(i) => {
              const el = sourceRoot.current?.querySelector('[data-cutoff]')
              if (el) el.textContent = spec.dial!.values[i]
            }}
            castShadow
          />
        )}
        {/* Grab handle: the one part of a panel that is matter, not screen.
            Doubles as the focus lamp — unit selection glows it steady,
            interior engagement brightens it. */}
        <mesh
          position={[0, H3 / 2 + 0.09, 0]}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerOver={() => {
            setHover(true)
            document.body.style.cursor = 'grab'
          }}
          onPointerOut={() => {
            setHover(false)
            document.body.style.cursor = 'auto'
          }}
        >
          <boxGeometry args={[W3 * 0.42, 0.09, 0.045]} />
          <meshStandardMaterial
            color={hover || focus !== 'none' ? '#38bdf8' : '#22314f'}
            emissive={focus === 'interior' ? '#22d3ee' : hover || focus === 'unit' ? '#0ea5e9' : '#000000'}
            emissiveIntensity={focus === 'interior' ? 1.15 : hover || focus === 'unit' ? 0.6 : 0}
            roughness={0.4}
          />
        </mesh>
      </FocusGroup>
    </group>
  )
}

// ---------------------------------------------------------------------------

export function Lab006() {
  const rig = useRef<RigApi | null>(null)
  const groups = useRef(new Map<string, THREE.Group>())
  const panels = useMemo(buildPanels, [])
  const slots = useMemo(
    () => arcLayout({ cols: COLS, rows: ROWS, radius: RADIUS, span: SPAN, rowYs: ROW_YS }),
    [],
  )

  useEffect(() => injectLab006Styles(), [])

  // Keyboard grammar (docs/focus.md × this lab): Tab SELECTS a panel (glow
  // only — the ring is for surveying, not travel). Enter is the commitment
  // gesture: descend fires whether or not the panel's DOM has focusables
  // (most are read-only — you zoom in to READ), and that's the zoom-in
  // moment. Escape's last rung (interior → unit → scene → here) steps the
  // camera home. Mouse keeps its own grammar: double-click approaches, and
  // 'pointer'-caused focus never moves the camera.
  useFocusSceneEvents((e) => {
    if (e.cause === 'descend' && e.groupId) {
      const g = groups.current.get(e.groupId)
      if (g && rig.current) {
        rig.current.approach(
          g.getWorldPosition(new THREE.Vector3()),
          g.getWorldDirection(new THREE.Vector3()),
        )
      }
    } else if (e.cause === 'release') {
      // Escape released an ENGAGED panel — the matching un-commit gesture.
      // The position comes home but the view HOLDS the released panel (the
      // framing Tab gave it); a bare home() lost edge panels off-screen.
      const g = e.groupId ? groups.current.get(e.groupId) : undefined
      rig.current?.home(g?.getWorldPosition(new THREE.Vector3()))
    } else if (e.level === 'scene' && e.cause === 'escape') {
      rig.current?.home()
    }
  })

  // Automation hooks: deterministic camera moves for agent-browser runs.
  useEffect(() => {
    const w = window as unknown as { __lab006?: unknown }
    w.__lab006 = {
      panelIds: panels.map((p) => p.id),
      approach: (id: string) => {
        const g = groups.current.get(id)
        if (!g || !rig.current) return false
        rig.current.approach(
          g.getWorldPosition(new THREE.Vector3()),
          g.getWorldDirection(new THREE.Vector3()),
        )
        return true
      },
      home: () => rig.current?.home(),
      setMotion: (mode: 'animated' | 'instant' | 'auto') => rig.current?.setMotion(mode),
      panelWorldPos: (id: string) => {
        const g = groups.current.get(id)
        return g ? g.getWorldPosition(new THREE.Vector3()).toArray() : null
      },
    }
    return () => {
      delete w.__lab006
    }
  }, [panels])

  const register = (id: string, g: THREE.Group | null) => {
    if (g) groups.current.set(id, g)
    else groups.current.delete(id)
  }

  return (
    <>
      <fog attach="fog" args={['#0a0d14', 9, 22]} />
      <ambientLight intensity={0.38} />
      <directionalLight position={[4, 9, 4]} intensity={1.15} castShadow />
      <pointLight position={[0, 4.5, 0]} intensity={26} color="#7dd3fc" distance={14} />
      <pointLight position={[-6, 1.5, 3]} intensity={12} color="#38bdf8" distance={10} />

      <CameraRig api={rig} />

      {/* Floor doubles as the "step back" affordance. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
        receiveShadow
        onDoubleClick={(e) => {
          e.stopPropagation()
          rig.current?.home()
        }}
      >
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial color="#0e1119" roughness={0.95} />
      </mesh>

      {panels.map((spec, i) => (
        <WorkPanel
          key={spec.id}
          spec={spec}
          slot={slots[i]}
          // Authored ring order: the roster grid read as designed — top row
          // first, left to right (roster row 0 is the BOTTOM row).
          order={(ROWS - 1 - Math.floor(i / COLS)) * COLS + (i % COLS)}
          rig={rig}
          register={register}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// DOM-side HUD (rendered by App outside the Canvas): the contract, live.
// surfaces / paints-per-second / fps — the "40 live documents, zero cost"
// claim as numbers rather than an assertion.

interface ThreeUIStats {
  stats: () => Array<{ paints: number }>
}

export function Lab006Hud() {
  const [line, setLine] = useState('…')

  useEffect(() => {
    let frames = 0
    let raf = 0
    const countFrame = () => {
      frames++
      raf = requestAnimationFrame(countFrame)
    }
    raf = requestAnimationFrame(countFrame)

    let lastPaints = -1
    const interval = window.setInterval(() => {
      const threeUI = (window as unknown as { __threeUI?: ThreeUIStats }).__threeUI
      const stats = threeUI?.stats() ?? []
      const total = stats.reduce((sum, s) => sum + s.paints, 0)
      const pps = lastPaints < 0 ? 0 : (total - lastPaints) * 2
      lastPaints = total
      const fps = frames * 2
      frames = 0
      setLine(`${stats.length} surfaces · ${pps} paints/s · ${fps} fps`)
      ;(window as unknown as { __lab006Hud?: unknown }).__lab006Hud = {
        surfaces: stats.length,
        paintsPerSec: pps,
        fps,
      }
    }, 500)

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(interval)
    }
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        right: 18,
        bottom: 16,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
        letterSpacing: '0.04em',
        color: '#7dd3fc',
        background: 'rgba(10, 15, 28, 0.72)',
        border: '1px solid #1e2b45',
        borderRadius: 8,
        padding: '6px 10px',
        pointerEvents: 'none',
      }}
    >
      {line}
    </div>
  )
}
