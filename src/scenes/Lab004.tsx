import { useRef, useState } from 'react'
import * as THREE from 'three'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Surface } from '../primitives/Surface'
import { SurfaceLayer } from '../primitives/SurfaceLayer'

// Lab 004 — the floating-layer system. Lab 003 proved a popover can be a
// second Surface, but placed it with hand-written flat-plane math. This lab
// generalizes that into <SurfaceLayer>: anchor = a CSS selector into the
// parent's live DOM, inverted through the parent's GEOMETRY (UV → position +
// normal, src/lib/uvAnchor.ts). Three stations, one claim each:
//
//   A. flat panel     the lab-003 picker rebuilt on <SurfaceLayer> — the
//                     scene no longer does any anchor math at all.
//   B. sensor drum    the SAME picker hook on a cylinder. The popover lifts
//                     off the curved skin along the local surface normal.
//   C. wind flag      a tooltip anchored to a button on deforming geometry.
//                     Anchors sample live vertices every frame, so it rides
//                     the wave with zero extra wiring.
//
// State philosophy unchanged: React decides what exists (popover mounted or
// not); values live in the DOM (hidden inputs, direct mutation).

const PX_PER_UNIT = 200

const PANEL_W = 640
const PANEL_H = 400
const PANEL_W3 = PANEL_W / PX_PER_UNIT
const PANEL_H3 = PANEL_H / PX_PER_UNIT

const POP_W = 340
const POP_H = 264
const POP_W3 = POP_W / PX_PER_UNIT
const POP_H3 = POP_H / PX_PER_UNIT

const DRUM_W = 720
const DRUM_H = 420
const DRUM_W3 = DRUM_W / PX_PER_UNIT
const DRUM_H3 = DRUM_H / PX_PER_UNIT
const DRUM_R = 2.4
const DRUM_ARC = DRUM_W3 / DRUM_R // radians of cylinder the DOM wraps around

const MODES = ['cruise', 'slingshot', 'drift', 'silent run']
const BANDS = ['radar', 'lidar', 'thermal', 'quantum']

// One picker wiring for every station: trigger toggles, option commits into
// the hidden input, any other panel click dismisses. Geometry never appears
// here — that's the point.
function usePicker(options: string[]) {
  const rootRef = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)

  const setExpanded = (o: boolean) =>
    rootRef.current?.querySelector('[data-trigger]')?.setAttribute('aria-expanded', String(o))

  const current = () =>
    (rootRef.current?.querySelector('[data-value]') as HTMLInputElement | null)?.value ??
    options[0]

  const commit = (value: string) => {
    const el = rootRef.current
    if (!el) return
    ;(el.querySelector('[data-value]') as HTMLInputElement).value = value
    el.querySelector('[data-label]')!.textContent = value
    const status = el.querySelector('[data-status]')
    if (status) status.textContent = `→ ${value}`
    setExpanded(false)
    setOpen(false)
  }

  const wirePanel = (el: HTMLElement) => {
    rootRef.current = el
    const onClick = (ev: Event) => {
      const trigger = (ev.target as Element).closest('[data-trigger]')
      if (!trigger) {
        setExpanded(false)
        setOpen(false)
        return
      }
      setOpen((o) => {
        setExpanded(!o)
        return !o
      })
    }
    el.addEventListener('click', onClick)
    return () => {
      el.removeEventListener('click', onClick)
      rootRef.current = null
    }
  }

  const wirePopover = (el: HTMLElement) => {
    const onClick = (ev: Event) => {
      const option = (ev.target as Element).closest('[data-option]') as HTMLElement | null
      if (option) commit(option.dataset.option!)
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }

  return { open, current, wirePanel, wirePopover }
}

const pickerCss = `
  .panel { display:flex; flex-direction:column; gap:16px; }
  .panel input[type=text] { padding:13px 14px; border-radius:8px; border:1px solid #2b3b55;
    background:#16233c; color:#f8fafc; font-size:15px; outline:none; width:100%; box-sizing:border-box; }
  .panel input[type=text]:hover, .panel input[type=text][data-hover] { border-color:#3b82f6; }
  .panel input[type=text]:focus { border-color:#38bdf8; box-shadow:0 0 0 3px rgba(56,189,248,.25); }
  .panel [data-trigger] { display:flex; justify-content:space-between; align-items:center;
    padding:13px 14px; border-radius:8px; border:1px solid #2b3b55; background:#16233c;
    color:#f8fafc; font-size:15px; cursor:pointer; width:100%; box-sizing:border-box; text-align:left; }
  .panel [data-trigger]:hover, .panel [data-trigger][data-hover] { border-color:#3b82f6; background:#1a2a48; }
  .panel [data-trigger]:active, .panel [data-trigger][data-active] { background:#0f1c33; }
  .panel [data-trigger][aria-expanded=true] { border-color:#38bdf8; box-shadow:0 0 0 3px rgba(56,189,248,.25); }
  .panel [data-trigger] .chev { color:#7dd3fc; transition:transform .15s; }
  .panel [data-trigger][aria-expanded=true] .chev { transform:rotate(180deg); }
`

function navMarkup() {
  return `
    <div style="width:${PANEL_W}px;height:${PANEL_H}px;box-sizing:border-box;padding:32px 36px;
                font-family:system-ui,sans-serif;background:linear-gradient(165deg,#0b1120,#0f1a30);
                color:#f8fafc;">
      <style>${pickerCss}</style>
      <div class="panel">
        <strong style="font-size:24px;letter-spacing:-0.02em">Nav console</strong>
        <span style="font-size:13px;color:#7dd3fc">lab 003's picker, rebuilt on &lt;SurfaceLayer&gt; — zero anchor math in the scene</span>
        <input type="text" name="callsign" placeholder="callsign" autocomplete="off" />
        <input type="hidden" data-value name="mode" value="${MODES[0]}" />
        <button type="button" data-trigger aria-haspopup="listbox" aria-expanded="false">
          <span data-label>${MODES[0]}</span><span class="chev">&#9662;</span>
        </button>
        <span data-status style="font-size:12px;color:#64748b;font-family:ui-monospace,monospace">→ ${MODES[0]}</span>
      </div>
    </div>`
}

function drumMarkup() {
  const bars = [72, 45, 88, 31]
    .map(
      (p, i) => `
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:64px;font-size:12px;color:#64748b;font-family:ui-monospace,monospace">CH ${i + 1}</span>
          <div style="flex:1;height:10px;border-radius:5px;background:#16233c;overflow:hidden">
            <div style="width:${p}%;height:100%;background:linear-gradient(90deg,#0ea5e9,#38bdf8)"></div>
          </div>
        </div>`,
    )
    .join('')
  return `
    <div style="width:${DRUM_W}px;height:${DRUM_H}px;box-sizing:border-box;padding:34px 44px;
                font-family:system-ui,sans-serif;background:linear-gradient(150deg,#0a0f1e,#101b33);
                color:#f8fafc;">
      <style>${pickerCss}</style>
      <div class="panel">
        <strong style="font-size:26px;letter-spacing:-0.02em">Sensor drum</strong>
        <span style="font-size:14px;color:#7dd3fc">this skin is a cylinder — the anchor doesn't care</span>
        <button type="button" data-trigger aria-haspopup="listbox" aria-expanded="false">
          <span data-label>${BANDS[0]}</span><span class="chev">&#9662;</span>
        </button>
        <input type="hidden" data-value name="band" value="${BANDS[0]}" />
        ${bars}
        <span data-status style="font-size:12px;color:#64748b;font-family:ui-monospace,monospace">→ ${BANDS[0]}</span>
      </div>
    </div>`
}

function popMarkup(options: string[], current: string) {
  const items = options
    .map(
      (m) => `
      <button type="button" role="option" data-option="${m}" aria-selected="${m === current}">
        ${m}${m === current ? '<span style="color:#38bdf8">&#10003;</span>' : ''}
      </button>`,
    )
    .join('')
  return `
    <div style="width:${POP_W}px;height:${POP_H}px;box-sizing:border-box;padding:10px;
                font-family:system-ui,sans-serif;background:#101b33;border:1px solid #2b3b55;
                border-radius:12px;" role="listbox">
      <style>
        .pop { display:flex; flex-direction:column; gap:4px; }
        .pop button { display:flex; justify-content:space-between; align-items:center;
          padding:13px 14px; border-radius:8px; border:0; background:transparent; color:#f8fafc;
          font-size:15px; cursor:pointer; text-align:left; }
        .pop button:hover, .pop button[data-hover] { background:#1d2b47; }
        .pop button:active, .pop button[data-active] { background:#294066; transform:scale(0.985); }
        .pop button[aria-selected=true] { background:#16233c; }
      </style>
      <div class="pop">${items}</div>
    </div>`
}

export function Lab004() {
  const nav = usePicker(MODES)
  const band = usePicker(BANDS)

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.4} castShadow />
      <pointLight position={[-4, 3, 4]} intensity={30} color="#93c5fd" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#111318" roughness={0.95} />
      </mesh>

      {/* Station A — flat parity: the lab-003 popover, now a SurfaceLayer */}
      <group position={[-2.9, 2.0, 0.1]} rotation={[0, 0.35, 0]}>
        <Surface
          label="lab004-nav"
          name="lab004-nav"
          html={navMarkup()}
          width={PANEL_W}
          height={PANEL_H}
          onSource={nav.wirePanel}
          castShadow
        >
          <planeGeometry args={[PANEL_W3, PANEL_H3]} />
          {nav.open && (
            <SurfaceLayer
              anchor="[data-trigger]"
              lift={0.3}
              offset={[0, -POP_H3 / 2 - 0.06, 0]}
              label="lab004-nav-pop"
              name="lab004-nav-pop"
              html={popMarkup(MODES, nav.current())}
              width={POP_W}
              height={POP_H}
              onSource={nav.wirePopover}
              castShadow
            >
              <planeGeometry args={[POP_W3, POP_H3]} />
            </SurfaceLayer>
          )}
        </Surface>
        <Text position={[0, -1.35, 0]} fontSize={0.13} color="#94a3b8" anchorX="center">
          flat panel · anchor="[data-trigger]"
        </Text>
      </group>

      {/* Station B — the same picker hook, but the skin is a cylinder */}
      <group position={[0.95, 2.1, -1.35]} rotation={[0, -0.12, 0]}>
        <Surface
          label="lab004-drum"
          name="lab004-drum"
          html={drumMarkup()}
          width={DRUM_W}
          height={DRUM_H}
          onSource={band.wirePanel}
          position={[0, 0, -DRUM_R]}
          castShadow
        >
          {/* open-ended arc, centered on θ=0 so the convex face looks at the camera */}
          <cylinderGeometry
            args={[DRUM_R, DRUM_R, DRUM_H3, 64, 1, true, -DRUM_ARC / 2, DRUM_ARC]}
          />
          {band.open && (
            <SurfaceLayer
              anchor="[data-trigger]"
              lift={0.42}
              offset={[0, -POP_H3 / 2 - 0.06, 0]}
              label="lab004-band-pop"
              name="lab004-band-pop"
              html={popMarkup(BANDS, band.current())}
              width={POP_W}
              height={POP_H}
              onSource={band.wirePopover}
              castShadow
            >
              <planeGeometry args={[POP_W3, POP_H3]} />
            </SurfaceLayer>
          )}
        </Surface>
        <Text position={[0, -1.45, 0]} fontSize={0.13} color="#94a3b8" anchorX="center">
          curved skin · same hook, same anchor — lifted along the local normal
        </Text>
      </group>

      {/* Station C — anchor riding CPU-deformed geometry */}
      <WindFlag position={[3.35, 2.15, 0.55]} />
    </>
  )
}

const FLAG_W = 560
const FLAG_H = 300
const FLAG_W3 = FLAG_W / PX_PER_UNIT
const FLAG_H3 = FLAG_H / PX_PER_UNIT

const TIP_W = 240
const TIP_H = 88
const TIP_W3 = TIP_W / PX_PER_UNIT
const TIP_H3 = TIP_H / PX_PER_UNIT

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
        .wind button:hover, .wind button[data-hover] { border-color:#2dd4bf; background:#0e3a34; }
        .wind button:active, .wind button[data-active] { background:#0a2622; }
        .wind button[aria-pressed=true] { background:#134e4a; border-color:#2dd4bf; color:#ccfbf1;
          box-shadow:0 0 0 3px rgba(45,212,191,.2); }
      </style>
      <div class="wind">
        <strong style="font-size:24px;letter-spacing:-0.02em">Wind tunnel</strong>
        <span style="font-size:13px;color:#5eead4">the tag above "gale" is anchored to this waving skin</span>
        <div class="row">${buttons}</div>
      </div>
    </div>`
}

function tipMarkup() {
  return `
    <div style="width:${TIP_W}px;height:${TIP_H}px;box-sizing:border-box;padding:14px 18px;
                font-family:system-ui,sans-serif;background:#042f2e;border:1px solid #2dd4bf;
                border-radius:14px;color:#ccfbf1;display:flex;flex-direction:column;gap:4px;">
      <style>
        @keyframes tip-pulse { 0%,100% { opacity:1 } 50% { opacity:.25 } }
        .dot { display:inline-block;width:8px;height:8px;border-radius:50%;background:#2dd4bf;
          margin-right:8px;animation:tip-pulse 1.2s ease-in-out infinite; }
      </style>
      <strong style="font-size:15px"><span class="dot"></span>UV-anchored</strong>
      <span style="font-size:12px;color:#5eead4">sampling live vertices every frame</span>
    </div>`
}

// Lab 003's flag, kept deforming on the CPU — but now wearing a SurfaceLayer
// tooltip pinned to the "gale" button. The anchor's triangle was resolved
// once against the static UV attribute; every frame it re-reads the displaced
// positions and recomputed normals, so the tag surfs the wave and tilts with
// the local surface.
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
    <group position={props.position} rotation={[0, -0.42, 0]}>
      <mesh position={[-FLAG_W3 / 2 - 0.09, -0.45, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, FLAG_H3 + 1.9, 16]} />
        <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.8} />
      </mesh>
      <Surface
        label="lab004-flag"
        name="lab004-flag"
        html={flagMarkup()}
        width={FLAG_W}
        height={FLAG_H}
        side={THREE.DoubleSide}
        onSource={wireFlag}
        castShadow
      >
        <planeGeometry ref={geoRef} args={[FLAG_W3, FLAG_H3, 48, 32]} />
        <SurfaceLayer
          anchor='[data-wind="0.34"]'
          align={{ x: 0.5, y: 0 }}
          lift={0.3}
          offset={[0, TIP_H3 / 2 + 0.05, 0]}
          label="lab004-tip"
          name="lab004-tip"
          html={tipMarkup()}
          width={TIP_W}
          height={TIP_H}
        >
          <planeGeometry args={[TIP_W3, TIP_H3]} />
        </SurfaceLayer>
      </Surface>
      <Text position={[0, -1.3, 0]} fontSize={0.13} color="#94a3b8" anchorX="center">
        deforming skin · the tag rides the wave, tilting with the local normal
      </Text>
    </group>
  )
}
