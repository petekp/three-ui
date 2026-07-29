import { useRef } from 'react'
import * as THREE from 'three'
import type { ThreeElements, ThreeEvent } from '@react-three/fiber'
import { composeFields, damping, endStops, stopsField } from '../../lib/physics1D'
import { use1DOF } from './use1DOF'

// <Slider> — linear travel with named stops. q is normalized 0..1 along the
// rail; the feel is stopsField (detents at the stops) + endStops (travel
// bounds) + damping. Throws ride momentum into a stop; the hand is clamped
// to the rail during drag (you can't pull a physical cap off its track).

export interface SliderProps extends Omit<ThreeElements['group'], 'children'> {
  stops?: number[]
  length?: number
  stiffness?: number
  friction?: number
  initialValue?: number
  /** Live value while moving (throttled to meaningful changes). */
  onChange?: (value: number) => void
  /** Settled on a stop: index into `stops` + the value. */
  onStop?: (index: number, value: number) => void
}

export function Slider({
  stops = [0, 0.25, 0.5, 0.75, 1],
  length = 1.6,
  stiffness = 200,
  friction = 10,
  initialValue = 0,
  onChange,
  onStop,
  ...groupProps
}: SliderProps) {
  const cap = useRef<THREE.Group>(null)
  const lastEmit = useRef(initialValue)

  const nearestStop = (q: number) => {
    let idx = 0
    for (let i = 1; i < stops.length; i++) {
      if (Math.abs(q - stops[i]) < Math.abs(q - stops[idx])) idx = i
    }
    return idx
  }

  const { bind } = use1DOF({
    field: composeFields(
      stopsField(stops, stiffness),
      endStops(0, 1, 800),
      damping(friction),
    ),
    initialQ: initialValue,
    localToQ: (local) => local.x / length + 0.5,
    clampQ: (q) => THREE.MathUtils.clamp(q, -0.015, 1.015),
    onFrame: (q) => {
      if (cap.current) cap.current.position.x = (q - 0.5) * length
      if (Math.abs(q - lastEmit.current) > 1e-3) {
        lastEmit.current = q
        onChange?.(q)
      }
    },
    onSettle: (q) => {
      const idx = nearestStop(q)
      onStop?.(idx, stops[idx])
    },
  })

  // Handlers live on the STATIC track group — the cap's local frame moves
  // with q, and measuring the hand in a frame the hand itself moves is a
  // feedback loop (the cap would track at half speed). Drags may only START
  // on the cap, though: you grab the handle, not the rail.
  const startOnCapOnly = (e: ThreeEvent<PointerEvent>) => {
    for (let n: THREE.Object3D | null = e.object; n; n = n.parent) {
      if (n === cap.current) return bind.onPointerDown(e)
    }
  }

  return (
    <group {...groupProps} {...bind} onPointerDown={startOnCapOnly}>
      <mesh castShadow>
        <boxGeometry args={[length + 0.2, 0.07, 0.06]} />
        <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.4} />
      </mesh>
      {stops.map((s, i) => (
        <mesh key={i} position={[(s - 0.5) * length, -0.11, 0]}>
          <boxGeometry args={[0.024, 0.07, 0.02]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
      ))}
      <group ref={cap} position={[(initialValue - 0.5) * length, 0, 0]}>
        <mesh position={[0, 0, 0.06]} castShadow>
          <boxGeometry args={[0.18, 0.3, 0.14]} />
          <meshStandardMaterial color="#1e293b" roughness={0.3} metalness={0.7} />
        </mesh>
        <mesh position={[0, 0, 0.135]}>
          <boxGeometry args={[0.05, 0.24, 0.02]} />
          <meshStandardMaterial color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={1.4} />
        </mesh>
      </group>
    </group>
  )
}
