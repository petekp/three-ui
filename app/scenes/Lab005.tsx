import { useRef } from 'react'
import { Text } from '@react-three/drei'
import { Dial, Slider, Surface, Toggle } from 'three-ui'

// Lab 005 — the physical control kit. Every control on this wall is the SAME
// integrator (src/lib/physics1D.ts) under a different composed force field:
//   <Dial>    detentField + damping        — flicks ratchet through wells
//   <Toggle>  overCenterField + endStops   — taps either commit past center
//                                            or fall home; physics decides
//   <Slider>  stopsField + endStops        — throws ride momentum into stops
//
// The console readout is a live DOM Surface; controls mutate it directly
// through their callbacks. React renders the scene once — interaction state
// never touches React.

const READ_W = 480
const READ_H = 300
const READ_W3 = READ_W / 200
const READ_H3 = READ_H / 200

const LIGHTS = ['coolant', 'shields', 'aux']
const POWER_STOPS = [0, 0.25, 0.5, 0.75, 1]

function readoutMarkup() {
  const cells = Array.from(
    { length: 8 },
    (_, i) =>
      `<span data-cell="${i}" style="flex:1;height:12px;border-radius:3px;
         background:${i < 4 ? '#38bdf8' : '#1d2b47'}"></span>`,
  ).join('')
  const lights = LIGHTS.map(
    (name, i) => `
      <span data-light="${i}" data-on="${i === 1}" style="display:flex;align-items:center;gap:8px;
            font-size:13px;letter-spacing:.08em;color:#64748b">
        <span class="lamp" style="width:10px;height:10px;border-radius:50%;
              background:${i === 1 ? '#2dd4bf' : '#1d2b47'};
              box-shadow:${i === 1 ? '0 0 10px #2dd4bf' : 'none'}"></span>
        ${name.toUpperCase()}
      </span>`,
  ).join('')
  return `
    <div style="width:${READ_W}px;height:${READ_H}px;box-sizing:border-box;padding:24px 28px;
                font-family:ui-monospace,monospace;background:#0b1120;border:1px solid #1d2b47;
                border-radius:12px;color:#f8fafc;display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:12px;color:#7dd3fc;letter-spacing:.1em">REACTOR CONSOLE</span>
        <span style="font-size:11px;color:#334155">all state written by physics</span>
      </div>
      <div style="display:flex;align-items:center;gap:18px">
        <span style="font-size:40px;font-weight:700;line-height:1">
          <span data-detent>4</span><span style="font-size:15px;color:#64748b"> / 7</span>
        </span>
        <div style="display:flex;gap:4px;flex:1">${cells}</div>
      </div>
      <div style="display:flex;gap:22px">${lights}</div>
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:12px;color:#7dd3fc;letter-spacing:.1em">POWER</span>
        <div style="flex:1;height:12px;border-radius:6px;background:#16233c;overflow:hidden">
          <div data-power-fill style="width:50%;height:100%;
               background:linear-gradient(90deg,#0ea5e9,#38bdf8);transition:width .12s"></div>
        </div>
        <span data-power-text style="font-size:14px;width:44px;text-align:right">50%</span>
      </div>
    </div>`
}

interface Lab005Hooks {
  detent: number
  lights: boolean[]
  power: number
  settledPower: number | null
}

export function Lab005() {
  const readoutEl = useRef<HTMLElement | null>(null)
  const state = useRef<Lab005Hooks>({
    detent: 4,
    lights: [false, true, false],
    power: 0.5,
    settledPower: 0.5,
  })

  const publish = () => {
    ;(window as unknown as { __lab005: Lab005Hooks }).__lab005 = { ...state.current }
  }

  const onDetent = (idx: number) => {
    state.current.detent = idx
    publish()
    const el = readoutEl.current
    if (!el) return
    el.querySelector('[data-detent]')!.textContent = String(idx)
    el.querySelectorAll('[data-cell]').forEach((c, i) => {
      ;(c as HTMLElement).style.background = i < idx ? '#38bdf8' : '#1d2b47'
    })
  }

  const onFlip = (i: number) => (on: boolean) => {
    state.current.lights[i] = on
    publish()
    const light = readoutEl.current?.querySelector(`[data-light="${i}"]`)
    if (!light) return
    light.setAttribute('data-on', String(on))
    const lamp = light.querySelector('.lamp') as HTMLElement
    lamp.style.background = on ? '#2dd4bf' : '#1d2b47'
    lamp.style.boxShadow = on ? '0 0 10px #2dd4bf' : 'none'
  }

  const setPowerDom = (value: number) => {
    const el = readoutEl.current
    if (!el) return
    const pct = Math.round(value * 100)
    ;(el.querySelector('[data-power-fill]') as HTMLElement).style.width = `${pct}%`
    el.querySelector('[data-power-text]')!.textContent = `${pct}%`
  }

  const onPowerChange = (value: number) => {
    state.current.power = value
    state.current.settledPower = null // in motion
    publish()
    setPowerDom(value)
  }

  const onPowerStop = (_idx: number, value: number) => {
    state.current.power = value
    state.current.settledPower = value
    publish()
    setPowerDom(value)
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

      <group rotation={[-0.08, 0, 0]}>
        <Surface
          label="lab005-readout"
          name="lab005-readout"
          html={readoutMarkup()}
          width={READ_W}
          height={READ_H}
          onSource={(el) => {
            readoutEl.current = el
            publish()
            return () => {
              readoutEl.current = null
            }
          }}
          position={[0, 2.75, -0.25]}
          castShadow
        >
          <planeGeometry args={[READ_W3, READ_H3]} />
        </Surface>

        <Dial
          name="lab005-dial"
          position={[-2.15, 1.05, 0.3]}
          initialDetent={4}
          onDetent={onDetent}
        />
        <Text position={[-2.15, 0.05, 0.3]} fontSize={0.11} color="#94a3b8" anchorX="center">
          detentField · flick it
        </Text>

        {LIGHTS.map((name, i) => (
          <Toggle
            key={name}
            name={`lab005-toggle-${i}`}
            position={[-0.55 + i * 0.55, 1.05, 0.3]}
            initialOn={i === 1}
            onFlip={onFlip(i)}
          />
        ))}
        <Text position={[0, 0.05, 0.3]} fontSize={0.11} color="#94a3b8" anchorX="center">
          overCenterField · tap to flip — physics decides
        </Text>

        <Slider
          name="lab005-slider"
          position={[2.15, 1.05, 0.3]}
          initialValue={0.5}
          stops={POWER_STOPS}
          onChange={onPowerChange}
          onStop={onPowerStop}
        />
        <Text position={[2.15, 0.05, 0.3]} fontSize={0.11} color="#94a3b8" anchorX="center">
          stopsField + endStops · throw the cap
        </Text>
      </group>
    </>
  )
}
