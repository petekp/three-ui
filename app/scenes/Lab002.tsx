import { useRef, useState } from 'react'
import * as THREE from 'three'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Physics, RigidBody } from '@react-three/rapier'
import { MomentumCard, Surface } from 'three-ui'

const CONSOLE_W = 768
const CONSOLE_H = 448

// Lab 002 — the primitive set:
//   Surface        live DOM as the skin of curved geometry, inputs forwarded
//   MomentumCard   motion as forces (mass + spring + your velocity)
//   focus-as-light scene lighting bound to DOM focus & validation state

function consoleMarkup() {
  return `
    <div style="width:${CONSOLE_W}px;height:${CONSOLE_H}px;box-sizing:border-box;padding:32px 40px;
                font-family:system-ui,sans-serif;background:linear-gradient(160deg,#0b1120,#101b33);
                color:#f8fafc;display:flex;flex-direction:column;gap:14px;">
      <style>
        .con input, .con select { padding:12px 14px; border-radius:8px; border:1px solid #2b3b55;
          background:#16233c; color:#f8fafc; font-size:15px; outline:none; width:100%; box-sizing:border-box; }
        .con input:hover, .con select:hover { border-color:#3b82f6; }
        .con input:focus, .con select:focus { border-color:#38bdf8; box-shadow:0 0 0 3px rgba(56,189,248,.25); }
        .con.error input[name=callsign] { border-color:#f87171; box-shadow:0 0 0 3px rgba(248,113,113,.3); }
        .con button { padding:13px; border-radius:8px; border:0; background:#38bdf8; color:#082f49;
          font-size:15px; font-weight:600; cursor:pointer; }
        .con button:hover { background:#7dd3fc; }
        .con label { display:flex; align-items:center; gap:10px; font-size:14px; color:#cbd5e1; }
        .con .row { display:flex; gap:14px; }
        .con .row > * { flex:1; }
      </style>
      <div class="con" style="display:flex;flex-direction:column;gap:14px;">
        <strong style="font-size:24px;letter-spacing:-0.02em">Helm console</strong>
        <span style="font-size:13px;color:#7dd3fc">live DOM on a curved surface · every control below is a real element</span>
        <div class="row">
          <input name="callsign" placeholder="callsign (required)" />
          <select name="mode">
            <option>cruise</option><option>slingshot</option><option>drift</option><option>silent run</option>
          </select>
        </div>
        <label><input type="checkbox" name="stealth" style="width:18px;height:18px" /> stealth mode</label>
        <button name="engage">Engage</button>
        <span data-status style="font-size:12px;color:#64748b;font-family:ui-monospace,monospace">status: idle</span>
      </div>
    </div>`
}

export function Lab002() {
  const [focusWithin, setFocusWithin] = useState(false)
  // Spotlight targets must live in the scene graph or their matrix never
  // updates and the light silently aims at the origin.
  const [lightTarget] = useState(() => new THREE.Object3D())
  const keyLight = useRef<THREE.SpotLight>(null)
  const errorLight = useRef<THREE.PointLight>(null)
  const errorPending = useRef(false)
  const errorAt = useRef(-1)

  // focus-as-light: no tokens, no classes — attention is literal light.
  useFrame(({ clock }, delta) => {
    if (errorPending.current) {
      errorPending.current = false
      errorAt.current = clock.elapsedTime
    }
    if (keyLight.current) {
      // Physical lights decay with distance²; candela numbers need to be
      // big to read. Dark room → interrogation lamp.
      const target = focusWithin ? 320 : 2
      keyLight.current.intensity = THREE.MathUtils.damp(
        keyLight.current.intensity, target, 5, delta,
      )
    }
    if (errorLight.current) {
      const since = clock.elapsedTime - errorAt.current
      const pulse = errorAt.current >= 0 && since < 1.6
        ? Math.max(0, Math.sin(since * Math.PI * 3)) * 60 * (1 - since / 1.6)
        : 0
      errorLight.current.intensity = pulse
    }
  })

  const wireConsole = (el: HTMLElement) => {
    const root = el.querySelector('.con') as HTMLElement
    const status = el.querySelector('[data-status]') as HTMLElement
    const report = () => {
      const callsign = (el.querySelector('[name=callsign]') as HTMLInputElement).value
      const mode = (el.querySelector('[name=mode]') as HTMLSelectElement).value
      const stealth = (el.querySelector('[name=stealth]') as HTMLInputElement).checked
      status.textContent = `status: ${callsign || '—'} · ${mode}${stealth ? ' · stealth' : ''}`
    }
    const onInput = () => {
      root.classList.remove('error')
      report()
    }
    const onClick = (ev: Event) => {
      const btn = (ev.target as Element).closest('[name=engage]')
      if (!btn) return
      const callsign = (el.querySelector('[name=callsign]') as HTMLInputElement).value
      if (!callsign) {
        root.classList.add('error')
        status.textContent = 'status: ERROR — callsign required'
        errorPending.current = true
      } else {
        status.textContent = `status: ENGAGED — godspeed, ${callsign}`
      }
    }
    el.addEventListener('input', onInput)
    el.addEventListener('change', onInput)
    el.addEventListener('click', onClick)
    return () => {
      el.removeEventListener('input', onInput)
      el.removeEventListener('change', onInput)
      el.removeEventListener('click', onClick)
    }
  }

  return (
    <>
      <ambientLight intensity={0.12} />
      <directionalLight position={[6, 8, 4]} intensity={0.7} castShadow />

      {/* key light that answers to DOM focus */}
      <primitive object={lightTarget} position={[0, 1.9, -1]} />
      <spotLight
        ref={keyLight}
        position={[0, 5, 3.5]}
        angle={0.42}
        penumbra={0.85}
        intensity={2}
        color="#bfe3ff"
        castShadow
        target={lightTarget}
      />
      {/* validation-error light, pulsed from just in front of the console */}
      <pointLight ref={errorLight} position={[0, 1.9, 0.4]} intensity={0} color="#ef4444" />

      <Physics gravity={[0, -9.81, 0]}>
        <RigidBody type="fixed">
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]} receiveShadow>
            <planeGeometry args={[40, 40]} />
            <meshStandardMaterial color="#111318" roughness={0.95} />
          </mesh>
        </RigidBody>

        {/* THE experiment: a real form on a concave cylindrical console.
            Arc bulges away from camera; we view the inside (BackSide), so
            the texture is mirrored back to readable with mirrorU. */}
        {/* cylinder center sits toward the camera so the far-side arc
            (theta≈π) lands near z≈-0.9, filling the view concavely */}
        <Surface
          html={consoleMarkup()}
          width={CONSOLE_W}
          height={CONSOLE_H}
          position={[0, 1.9, 2.2]}
          side={THREE.DoubleSide}
          mirrorU
          onFocusWithin={setFocusWithin}
          onSource={wireConsole}
        >
          <cylinderGeometry
            args={[3.1, 3.1, 2.4, 64, 1, true, Math.PI - 0.66, 1.32]}
          />
        </Surface>

        <MomentumCard home={[3.6, 1.9, 0.6]} />
      </Physics>

      <Text position={[0, 0.35, -0.4]} fontSize={0.15} color="#94a3b8" anchorX="center">
        {'<Surface /> on a cylinder · focus a field and watch the light answer'}
      </Text>
    </>
  )
}
