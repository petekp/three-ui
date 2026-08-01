import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import {
  arcLayout,
  Dial,
  FocusGroup,
  FocusOrbitRig,
  Surface,
  useFocusScene,
  type ArcSlot,
  type FocusRigApi,
  type GroupFocusState,
} from 'three-ui'
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

// All this lab needs from OrbitControls directly: the drag handlers pause it
// while a panel is being repositioned. Camera mechanics live in FocusOrbitRig.
interface OrbitLike {
  enabled: boolean
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
  rig: React.RefObject<FocusRigApi | null>
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
  const rig = useRef<FocusRigApi | null>(null)
  const groups = useRef(new Map<string, THREE.Group>())
  const panels = useMemo(buildPanels, [])
  const slots = useMemo(
    () => arcLayout({ cols: COLS, rows: ROWS, radius: RADIUS, span: SPAN, rowYs: ROW_YS }),
    [],
  )

  useEffect(() => injectLab006Styles(), [])

  // Keyboard grammar (docs/focus.md × this lab): Tab SELECTS a panel (glow
  // only), Enter is the commitment gesture (zoom in), Escape's last rung
  // steps home. All of it — descend→approach, release→home-holding-the-
  // panel, scene-escape→home — is FocusOrbitRig's contract now; this scene
  // only supplies the poses. Mouse keeps its own grammar: double-click
  // approaches, and 'pointer'-caused focus never moves the camera.

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

      <FocusOrbitRig
        home={{ position: HOME_POS, target: HOME_TARGET }}
        approachDistance={APPROACH_DIST}
        apiRef={rig}
      />

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
