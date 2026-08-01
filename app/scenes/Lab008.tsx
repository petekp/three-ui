import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import {
  Dial,
  FocusGroup,
  FocusOrbitRig,
  Surface,
  type FocusRigApi,
  type GroupFocusState,
} from 'three-ui'

// Lab 008 — the consumer scene: three-ui through its own front door.
//
// Everything here imports from `src/index.ts` alone (plus React/three peer
// deps). That's the lab's entire point: if this scene needs to reach into
// src/lib or src/primitives directly, the barrel is lying about being a
// library. Three panels on a drafting wall — a read-only brief, a console
// with native typing, a tuner whose Dial shares the panel's traversal —
// wired to FocusOrbitRig with nothing but poses. No feeds, no timers: the
// whole scene is event-driven, so idle is exactly zero paints.

const PANEL_W = 320
const PANEL_H = 220
const W3 = PANEL_W / 200
const H3 = PANEL_H / 200
const HOME_POS = new THREE.Vector3(0, 1.55, 4.6)
const HOME_TARGET = new THREE.Vector3(0, 1.15, 0)

const STYLE_ID = 'lab008-css'
const CSS = `
.p8{width:${PANEL_W}px;height:${PANEL_H}px;box-sizing:border-box;display:flex;
  flex-direction:column;gap:8px;padding:14px 16px;font:13px/1.45 'Avenir Next',
  'Helvetica Neue',sans-serif;color:#2d2417;background:#f5eddc;
  border:1px solid #c9b98f;border-radius:10px}
.p8 h2{margin:0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:#8a744a}
.p8 p{margin:0;color:#4a3d28}
.p8 .fine{font-size:11px;color:#8a744a}
.p8 label{display:flex;flex-direction:column;gap:3px;font-size:11px;
  color:#8a744a;letter-spacing:.06em}
.p8 input{font:13px 'Avenir Next','Helvetica Neue',sans-serif;color:#2d2417;
  background:#fffaf0;border:1px solid #c9b98f;border-radius:6px;
  padding:5px 8px;outline:none}
.p8 input:focus{border-color:#b8860b;box-shadow:0 0 0 2px rgba(184,134,11,.25)}
.p8-btn{align-self:flex-start;font:12px 'Avenir Next','Helvetica Neue',
  sans-serif;color:#f5eddc;background:#7a5f2a;border:1px solid #5d4820;
  border-radius:6px;padding:5px 12px;cursor:pointer}
.p8-btn:hover,.p8-btn[data-hover]{background:#8f7134}
.p8-btn:active,.p8-btn[data-active]{background:#5d4820}
.p8 .readout{font:26px 'Avenir Next','Helvetica Neue',sans-serif;
  font-weight:600;color:#7a5f2a}
.p8 .log{min-height:16px}
/* Scene focus painted into the texture — paint properties only. */
.p8[data-focus]{border-color:#b8860b}
.p8[data-focus="unit"]{box-shadow:inset 0 0 0 2px rgba(184,134,11,.35)}
.p8[data-focus="interior"]{box-shadow:inset 0 0 0 3px rgba(184,134,11,.6)}
`

function injectLab008Styles(): () => void {
  if (document.getElementById(STYLE_ID)) return () => {}
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
  return () => el.remove()
}

const FREQS = ['110 Hz', '220 Hz', '440 Hz', '880 Hz', '1.76 kHz', '3.52 kHz']

interface PanelSpec {
  id: string
  x: number
  html: string
  dial?: boolean
}

const PANELS: PanelSpec[] = [
  {
    id: 'brief',
    x: -2.05,
    html: `<div class="p8">
      <h2>Mission brief</h2>
      <p>This whole scene imports from <b>src/index.ts</b> — the public
      barrel. Camera grammar, focus routing, and the dial's physics all
      arrive through the front door.</p>
      <p class="fine">Tab surveys · Enter approaches · Escape steps home ·
      arrows walk the wall.</p>
    </div>`,
  },
  {
    id: 'console',
    x: 0,
    html: `<div class="p8">
      <h2>Console — it's just the DOM</h2>
      <label>Callsign <input data-callsign value="ember-3" /></label>
      <button class="p8-btn" data-transmit>Transmit</button>
      <p class="fine log" data-log>Standing by.</p>
    </div>`,
  },
  {
    id: 'tuner',
    x: 2.05,
    html: `<div class="p8">
      <h2>Tuner — the knob is matter</h2>
      <p>The dial beside this panel is WebGL physics; its detents paint
      this readout. Content in the document, consequence in the scene.</p>
      <div class="readout" data-freq>${FREQS[2]}</div>
    </div>`,
    dial: true,
  },
]

function WallPanel({
  spec,
  order,
  rig,
  register,
}: {
  spec: PanelSpec
  order: number
  rig: React.RefObject<FocusRigApi | null>
  register: (id: string, group: THREE.Group | null) => void
}) {
  const group = useRef<THREE.Group>(null)
  const [, setFocus] = useState<GroupFocusState>('none')
  const sourceRoot = useRef<HTMLElement | null>(null)

  const approach = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const g = group.current
    if (!g || !rig.current) return
    rig.current.approach(
      g.getWorldPosition(new THREE.Vector3()),
      g.getWorldDirection(new THREE.Vector3()),
    )
  }

  return (
    <group
      position={[spec.x, 1.35, -0.18 * Math.abs(spec.x)]}
      rotation={[0, -spec.x * 0.13, 0]}
      ref={(g) => {
        group.current = g
        register(spec.id, g)
      }}
    >
      <FocusGroup id={spec.id} order={order} objectRef={group} onStateChange={setFocus}>
        <Surface
          label={`lab008-${spec.id}`}
          name={`lab008-${spec.id}`}
          html={spec.html}
          width={PANEL_W}
          height={PANEL_H}
          onSource={(root) => {
            sourceRoot.current = root
            // The console transmits by mutating its own log line — a real
            // DOM change, one paint, then quiet again.
            const btn = root.querySelector<HTMLButtonElement>('[data-transmit]')
            const onClick = () => {
              const log = root.querySelector('[data-log]')
              const call = root.querySelector<HTMLInputElement>('[data-callsign]')
              if (log) log.textContent = `Sent as ${call?.value ?? 'unknown'}.`
            }
            btn?.addEventListener('click', onClick)
            return () => {
              btn?.removeEventListener('click', onClick)
              sourceRoot.current = null
            }
          }}
          onDoubleClick={approach}
          castShadow
        >
          <planeGeometry args={[W3, H3]} />
        </Surface>
        {spec.dial && (
          <Dial
            position={[W3 / 2 + 0.44, -H3 * 0.1, 0.14]}
            scale={0.72}
            detents={FREQS.length}
            initialDetent={2}
            focusLabel="Tuner frequency"
            valueText={(i) => FREQS[i]}
            onDetent={(i) => {
              const el = sourceRoot.current?.querySelector('[data-freq]')
              if (el) el.textContent = FREQS[i]
            }}
            castShadow
          />
        )}
      </FocusGroup>
    </group>
  )
}

export function Lab008() {
  const rig = useRef<FocusRigApi | null>(null)
  const groups = useRef(new Map<string, THREE.Group>())

  useEffect(() => injectLab008Styles(), [])

  const register = (id: string, g: THREE.Group | null) => {
    if (g) groups.current.set(id, g)
    else groups.current.delete(id)
  }

  // Automation hooks, same shape as __lab006 — deterministic camera moves.
  useEffect(() => {
    const w = window as unknown as { __lab008?: unknown }
    w.__lab008 = {
      panelIds: PANELS.map((p) => p.id),
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
      delete w.__lab008
    }
  }, [])

  return (
    <>
      <fog attach="fog" args={['#171310', 10, 24]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 7, 5]} intensity={1.3} castShadow />
      <pointLight position={[0, 3.5, 2]} intensity={18} color="#ffd9a0" distance={12} />

      <FocusOrbitRig
        home={{ position: HOME_POS, target: HOME_TARGET }}
        approachDistance={3.05}
        apiRef={rig}
      />

      {/* Floor is the step-back affordance, same grammar as lab 006. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
        receiveShadow
        onDoubleClick={(e) => {
          e.stopPropagation()
          rig.current?.home()
        }}
      >
        <circleGeometry args={[12, 64]} />
        <meshStandardMaterial color="#241d15" roughness={0.9} />
      </mesh>

      {PANELS.map((spec, i) => (
        <WallPanel key={spec.id} spec={spec} order={i} rig={rig} register={register} />
      ))}
    </>
  )
}
