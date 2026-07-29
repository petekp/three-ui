import { useRef, useState } from 'react'
import * as THREE from 'three'
import { Text } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Surface } from '../primitives/Surface'

// Lab 003 — feasibility edges of the primitive set:
//   A. multi-Surface   several live source canvases parked at the same fixed
//                      position (occluding each other) — do they all paint?
//                      Evidence: window.__threeUI.stats() paint counters.
//   B. popover Surface a custom select whose dropdown is a SECOND Surface
//                      floating in front of the panel — retires nudgeSelect.
//   C. deformable      live DOM on CPU vertex-displaced geometry. Raycasting
//                      hits the displaced triangles and UVs ride the
//                      vertices, so input forwarding should survive the wave.
//                      (GPU/shader displacement would NOT — the raycaster
//                      only sees CPU-side positions.)
//   D. physics knob    a 1-DOF rotary control: your gesture velocity feeds a
//                      detent torque field (-K·sin(N·θ) - c·θ̇). The settled
//                      detent index writes straight into the readout DOM —
//                      physics is the input method, the DOM is the state.
//
// State philosophy: React state only decides what exists in the scene
// (popover open/closed). Interaction state lives in the DOM itself — the
// hidden input holds the committed value, labels/status are mutated
// directly, so no texture source is ever torn down by a re-render.

const PX_PER_UNIT = 200

const PANEL_W = 640
const PANEL_H = 400
const PANEL_W3 = PANEL_W / PX_PER_UNIT
const PANEL_H3 = PANEL_H / PX_PER_UNIT

const POP_W = 340
const POP_H = 264
const POP_W3 = POP_W / PX_PER_UNIT
const POP_H3 = POP_H / PX_PER_UNIT

const MODES = ['cruise', 'slingshot', 'drift', 'silent run']

function panelMarkup() {
  return `
    <div style="width:${PANEL_W}px;height:${PANEL_H}px;box-sizing:border-box;padding:32px 36px;
                font-family:system-ui,sans-serif;background:linear-gradient(165deg,#0b1120,#0f1a30);
                color:#f8fafc;" data-mode-root>
      <style>
        .nav { display:flex; flex-direction:column; gap:16px; }
        .nav input[type=text] { padding:13px 14px; border-radius:8px; border:1px solid #2b3b55;
          background:#16233c; color:#f8fafc; font-size:15px; outline:none; width:100%; box-sizing:border-box; }
        .nav input[type=text]:hover { border-color:#3b82f6; }
        .nav input[type=text]:focus { border-color:#38bdf8; box-shadow:0 0 0 3px rgba(56,189,248,.25); }
        .nav .trigger { display:flex; justify-content:space-between; align-items:center;
          padding:13px 14px; border-radius:8px; border:1px solid #2b3b55; background:#16233c;
          color:#f8fafc; font-size:15px; cursor:pointer; width:100%; box-sizing:border-box; text-align:left; }
        .nav .trigger:hover { border-color:#3b82f6; }
        .nav .trigger[aria-expanded=true] { border-color:#38bdf8; box-shadow:0 0 0 3px rgba(56,189,248,.25); }
        .nav .trigger .chev { color:#7dd3fc; transition:transform .15s; }
        .nav .trigger[aria-expanded=true] .chev { transform:rotate(180deg); }
      </style>
      <div class="nav">
        <strong style="font-size:24px;letter-spacing:-0.02em">Nav console</strong>
        <span style="font-size:13px;color:#7dd3fc">the mode picker opens a second Surface — no native dropdown involved</span>
        <input type="text" name="callsign" placeholder="callsign" autocomplete="off" />
        <input type="hidden" name="mode" value="${MODES[0]}" />
        <button type="button" name="mode-trigger" class="trigger" aria-haspopup="listbox" aria-expanded="false">
          <span data-mode-label>${MODES[0]}</span><span class="chev">&#9662;</span>
        </button>
        <span data-status style="font-size:12px;color:#64748b;font-family:ui-monospace,monospace">mode: ${MODES[0]}</span>
      </div>
    </div>`
}

function popoverMarkup(current: string) {
  const items = MODES.map(
    (m) => `
      <button type="button" role="option" data-option="${m}" aria-selected="${m === current}">
        ${m}${m === current ? '<span style="color:#38bdf8">&#10003;</span>' : ''}
      </button>`,
  ).join('')
  return `
    <div style="width:${POP_W}px;height:${POP_H}px;box-sizing:border-box;padding:10px;
                font-family:system-ui,sans-serif;background:#101b33;border:1px solid #2b3b55;
                border-radius:12px;" role="listbox" aria-label="mode">
      <style>
        .pop { display:flex; flex-direction:column; gap:4px; }
        .pop button { display:flex; justify-content:space-between; align-items:center;
          padding:13px 14px; border-radius:8px; border:0; background:transparent; color:#f8fafc;
          font-size:15px; cursor:pointer; text-align:left; }
        .pop button:hover { background:#1d2b47; }
        .pop button[aria-selected=true] { background:#16233c; }
      </style>
      <div class="pop">${items}</div>
    </div>`
}

interface PopoverState {
  /** Panel-local position for the popover center (world units). */
  x: number
  y: number
  current: string
}

export function Lab003() {
  const navRoot = useRef<HTMLElement | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)

  const setExpanded = (open: boolean) => {
    navRoot.current
      ?.querySelector('[name=mode-trigger]')
      ?.setAttribute('aria-expanded', String(open))
  }

  const commitMode = (mode: string) => {
    const el = navRoot.current
    if (!el) return
    ;(el.querySelector('[name=mode]') as HTMLInputElement).value = mode
    el.querySelector('[data-mode-label]')!.textContent = mode
    el.querySelector('[data-status]')!.textContent = `mode: ${mode}`
    setExpanded(false)
    setPopover(null)
  }

  const wireNav = (el: HTMLElement) => {
    navRoot.current = el
    const onClick = (ev: Event) => {
      const trigger = (ev.target as Element).closest('[name=mode-trigger]')
      if (!trigger) {
        // Click anywhere else on the panel dismisses the popover.
        setExpanded(false)
        setPopover(null)
        return
      }
      // Anchor the popover under the trigger: DOM rect → panel-local units.
      const rootRect = el.getBoundingClientRect()
      const r = trigger.getBoundingClientRect()
      const cx = (r.left + r.right) / 2 - rootRect.left
      const bottom = r.bottom - rootRect.top
      const x = (cx / PANEL_W - 0.5) * PANEL_W3
      const y = (0.5 - bottom / PANEL_H) * PANEL_H3 - POP_H3 / 2 - 0.05
      const current = (el.querySelector('[name=mode]') as HTMLInputElement).value
      setPopover((p) => {
        setExpanded(!p)
        return p ? null : { x, y, current }
      })
    }
    el.addEventListener('click', onClick)
    return () => {
      el.removeEventListener('click', onClick)
      navRoot.current = null
    }
  }

  const wirePopover = (el: HTMLElement) => {
    const onClick = (ev: Event) => {
      const option = (ev.target as Element).closest('[data-option]')
      if (option) commitMode((option as HTMLElement).dataset.option!)
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.4} castShadow />
      <pointLight position={[-4, 3, 4]} intensity={30} color="#93c5fd" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#111318" roughness={0.95} />
      </mesh>

      {/* Station A — nav panel + popover-as-second-Surface */}
      <group position={[-1.6, 2.0, 0]} rotation={[0, 0.28, 0]}>
        <Surface
          label="lab003-nav"
          html={panelMarkup()}
          width={PANEL_W}
          height={PANEL_H}
          onSource={wireNav}
          castShadow
        >
          <planeGeometry args={[PANEL_W3, PANEL_H3]} />
        </Surface>

        {popover && (
          <Surface
            label="lab003-popover"
            html={popoverMarkup(popover.current)}
            width={POP_W}
            height={POP_H}
            position={[popover.x, popover.y, 0.3]}
            onSource={wirePopover}
            castShadow
          >
            <planeGeometry args={[POP_W3, POP_H3]} />
          </Surface>
        )}

        <Text position={[0, -1.35, 0]} fontSize={0.13} color="#94a3b8" anchorX="center">
          popover = a second {'<Surface />'} floating off the panel
        </Text>
      </group>

      {/* Station B — live DOM on deforming geometry */}
      <WindFlag position={[1.7, 2.35, -1.3]} />

      {/* Station C — physics-as-input knob writing into a readout Surface */}
      <ThrustStation position={[2.4, 1.75, 0.6]} rotationY={-0.35} />
    </>
  )
}

const DETENTS = 8
const STEP = (Math.PI * 2) / DETENTS
const DETENT_STIFFNESS = 50
const DETENT_DAMPING = 6

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const detentIndex = (theta: number) =>
  ((Math.round(-theta / STEP) % DETENTS) + DETENTS) % DETENTS

// A rotary control whose feel is an integrated force field, not an easing
// curve: drag couples your hand to θ kinematically while velocity is
// tracked; release hands that velocity to -K·sin(N·θ) - c·θ̇, so the knob
// ratchets through detents and clicks home. The settled index is written
// straight into the readout Surface's DOM.
function ThrustStation(props: { position: [number, number, number]; rotationY: number }) {
  const controls = useThree((s) => s.controls as { enabled?: boolean } | null)
  const readoutEl = useRef<HTMLElement | null>(null)
  const knobRoot = useRef<THREE.Group>(null)
  const rotor = useRef<THREE.Group>(null)
  const drag = useRef({
    active: false,
    offset: 0,
    vel: 0,
    lastT: 0,
    theta: -4 * STEP, // start on detent 4, matching the readout markup
  })

  const applyDetent = (idx: number) => {
    const el = readoutEl.current
    const span = el?.querySelector('[data-detent]')
    if (!el || !span || span.textContent === String(idx)) return
    span.textContent = String(idx)
    el.querySelectorAll('[data-cell]').forEach((c, i) => {
      ;(c as HTMLElement).style.background = i < idx ? '#38bdf8' : '#1d2b47'
    })
  }

  const angleOf = (e: ThreeEvent<PointerEvent>) => {
    const p = knobRoot.current!.worldToLocal(e.point.clone())
    return Math.atan2(p.y, p.x)
  }

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    if (controls) controls.enabled = false
    const d = drag.current
    d.active = true
    d.offset = wrapAngle(d.theta - angleOf(e))
    d.vel = 0
    d.lastT = e.timeStamp
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d.active) return
    const dt = Math.max((e.timeStamp - d.lastT) / 1000, 1e-4)
    const delta = wrapAngle(angleOf(e) + d.offset - d.theta)
    d.vel = THREE.MathUtils.lerp(d.vel, delta / dt, 0.35)
    d.theta += delta
    d.lastT = e.timeStamp
  }

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d.active) return
    d.active = false
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    if (controls) controls.enabled = true
  }

  useFrame((_, delta) => {
    const d = drag.current
    if (!d.active) {
      // Semi-implicit Euler, substepped: near a well the effective stiffness
      // is K·N ≈ 400 (ω ≈ 20 rad/s), too stiff for a raw 30fps step.
      const dt = Math.min(delta, 1 / 30)
      const h = dt / 2
      for (let s = 0; s < 2; s++) {
        d.vel += (-DETENT_STIFFNESS * Math.sin(DETENTS * d.theta) - DETENT_DAMPING * d.vel) * h
        d.theta += d.vel * h
      }
    }
    if (rotor.current) rotor.current.rotation.z = d.theta
    applyDetent(detentIndex(d.theta))
    // Dev hook so automation can assert on settle behavior.
    ;(window as unknown as { __lab003Knob: object }).__lab003Knob = {
      theta: d.theta,
      vel: d.vel,
      detent: detentIndex(d.theta),
      offDetent: Math.abs(wrapAngle(d.theta + detentIndex(d.theta) * STEP)),
    }
  })

  const ticks = Array.from({ length: DETENTS }, (_, k) => {
    const a = Math.PI / 2 - k * STEP
    return (
      <mesh key={k} position={[Math.cos(a) * 0.58, Math.sin(a) * 0.58, 0]} rotation={[0, 0, a]}>
        <boxGeometry args={[0.09, 0.028, 0.02]} />
        <meshStandardMaterial color={k === 4 ? '#38bdf8' : '#334155'} />
      </mesh>
    )
  })

  return (
    <group position={props.position} rotation={[0, props.rotationY, 0]}>
      <Surface
        label="lab003-readout"
        html={readoutMarkup()}
        width={READOUT_W}
        height={READOUT_H}
        onSource={(el) => {
          readoutEl.current = el
          return () => {
            readoutEl.current = null
          }
        }}
        castShadow
      >
        <planeGeometry args={[READOUT_W3, READOUT_H3]} />
      </Surface>

      <group ref={knobRoot} position={[0, -1.05, 0.25]}>
        {ticks}
        <group ref={rotor}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow onPointerDown={onDown} onPointerMove={onMove} onPointerUp={endDrag} onLostPointerCapture={endDrag}>
            <cylinderGeometry args={[0.42, 0.46, 0.22, 48]} />
            <meshStandardMaterial color="#1e293b" roughness={0.35} metalness={0.7} />
          </mesh>
          <mesh position={[0, 0.3, 0.12]}>
            <boxGeometry args={[0.05, 0.17, 0.035]} />
            <meshStandardMaterial color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={1.6} />
          </mesh>
        </group>
      </group>

      <Text position={[0, -1.95, 0]} fontSize={0.12} color="#94a3b8" anchorX="center">
        flick it — detents are a torque field, the number is real DOM
      </Text>
    </group>
  )
}

const READOUT_W = 320
const READOUT_H = 180
const READOUT_W3 = READOUT_W / PX_PER_UNIT
const READOUT_H3 = READOUT_H / PX_PER_UNIT

const FLAG_W = 560
const FLAG_H = 360
const FLAG_W3 = FLAG_W / PX_PER_UNIT
const FLAG_H3 = FLAG_H / PX_PER_UNIT

function flagMarkup() {
  const winds: Array<[string, string, boolean]> = [
    ['calm', '0.02', false],
    ['breeze', '0.16', true],
    ['gale', '0.34', false],
  ]
  const buttons = winds
    .map(
      ([name, amp, on]) => `
        <button type="button" data-wind="${amp}" aria-pressed="${on}">${name}</button>`,
    )
    .join('')
  return `
    <div style="width:${FLAG_W}px;height:${FLAG_H}px;box-sizing:border-box;padding:28px 32px;
                font-family:system-ui,sans-serif;background:linear-gradient(150deg,#062821,#0a1f2e);
                color:#f8fafc;border:1px solid #134e4a;">
      <style>
        .wind { display:flex; flex-direction:column; gap:16px; }
        .wind .row { display:flex; gap:10px; }
        .wind button { flex:1; padding:13px 0; border-radius:8px; border:1px solid #155e56;
          background:#0b2f2a; color:#a7f3d0; font-size:15px; cursor:pointer; }
        .wind button:hover { border-color:#2dd4bf; }
        .wind button[aria-pressed=true] { background:#134e4a; border-color:#2dd4bf; color:#ccfbf1;
          box-shadow:0 0 0 3px rgba(45,212,191,.2); }
        .wind input { padding:13px 14px; border-radius:8px; border:1px solid #155e56;
          background:#0b2f2a; color:#f8fafc; font-size:15px; outline:none; width:100%; box-sizing:border-box; }
        .wind input:focus { border-color:#2dd4bf; box-shadow:0 0 0 3px rgba(45,212,191,.25); }
      </style>
      <div class="wind">
        <strong style="font-size:24px;letter-spacing:-0.02em">Wind tunnel</strong>
        <span style="font-size:13px;color:#5eead4">this surface is deforming right now — its controls still work</span>
        <div class="row">${buttons}</div>
        <input type="text" name="log" placeholder="log entry — type while it waves" autocomplete="off" />
      </div>
    </div>`
}

// Live DOM on geometry that never stops moving. The displacement runs on the
// CPU so the raycaster and the render agree about where the triangles are.
function WindFlag(props: { position: [number, number, number] }) {
  const geoRef = useRef<THREE.PlaneGeometry>(null)
  const base = useRef<Float32Array | null>(null)
  const windTarget = useRef(0.16)
  const amp = useRef(0.02)

  const wireFlag = (el: HTMLElement) => {
    const onClick = (ev: Event) => {
      const btn = (ev.target as Element).closest('[data-wind]') as HTMLElement | null
      if (!btn) return
      windTarget.current = Number(btn.dataset.wind)
      el.querySelectorAll('[data-wind]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === btn)),
      )
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }

  useFrame(({ clock }, delta) => {
    const geo = geoRef.current
    if (!geo) return
    const pos = geo.attributes.position as THREE.BufferAttribute
    if (!base.current) {
      base.current = new Float32Array(pos.array as Float32Array)
      // Padded once so per-frame displacement never outruns raycast culling.
      geo.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(0, 0, 0),
        Math.hypot(FLAG_W3, FLAG_H3) / 2 + 0.6,
      )
    }
    amp.current = THREE.MathUtils.damp(amp.current, windTarget.current, 3, delta)
    const t = clock.elapsedTime
    const arr = pos.array as Float32Array
    const b = base.current
    for (let i = 0; i < arr.length; i += 3) {
      const x = b[i]
      const y = b[i + 1]
      // Pinned at the pole (left edge), free at the right — like a real flag.
      const pin = (x + FLAG_W3 / 2) / FLAG_W3
      arr[i + 2] =
        amp.current * pin * Math.sin(x * 2.4 + t * 3.1 + y * 0.9) +
        amp.current * 0.35 * pin * Math.sin(x * 5.1 + t * 5.7)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
  })

  return (
    <group position={props.position} rotation={[0, -0.1, 0]}>
      <mesh position={[-FLAG_W3 / 2 - 0.09, -0.45, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, FLAG_H3 + 1.9, 16]} />
        <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.8} />
      </mesh>
      <Surface
        label="lab003-flag"
        html={flagMarkup()}
        width={FLAG_W}
        height={FLAG_H}
        side={THREE.DoubleSide}
        onSource={wireFlag}
        castShadow
      >
        <planeGeometry ref={geoRef} args={[FLAG_W3, FLAG_H3, 48, 32]} />
      </Surface>
      <Text position={[0, -1.25, 0]} fontSize={0.13} color="#94a3b8" anchorX="center">
        CPU-deformed geometry · raycast still lands on the real triangles
      </Text>
    </group>
  )
}

function readoutMarkup() {
  const cells = Array.from(
    { length: 8 },
    (_, i) =>
      `<span data-cell="${i}" style="flex:1;height:14px;border-radius:3px;
         background:${i < 4 ? '#38bdf8' : '#1d2b47'}"></span>`,
  ).join('')
  return `
    <div style="width:${READOUT_W}px;height:${READOUT_H}px;box-sizing:border-box;padding:20px 22px;
                font-family:ui-monospace,monospace;background:#0b1120;border:1px solid #1d2b47;
                border-radius:10px;color:#f8fafc;display:flex;flex-direction:column;gap:10px;">
      <span style="font-size:12px;color:#7dd3fc;letter-spacing:.08em">THRUST</span>
      <span style="font-size:44px;font-weight:700;line-height:1"><span data-detent>4</span><span style="font-size:16px;color:#64748b"> / 7</span></span>
      <div style="display:flex;gap:5px">${cells}</div>
    </div>`
}
