import { useRef } from 'react'
import * as THREE from 'three'
import type { ThreeElements } from '@react-three/fiber'
import { composeFields, damping, detentField } from '../../lib/physics1D'
import { use1DOF, wrapAngle } from './use1DOF'

// <Dial> — the lab-003 knob as a primitive: a rotary control whose feel is
// detentField + damping. Flicks ratchet through wells; onDetent fires LIVE
// as the index changes (mid-ratchet included), so a readout can tick along.

export interface DialProps extends Omit<ThreeElements['group'], 'children'> {
  detents?: number
  stiffness?: number
  friction?: number
  initialDetent?: number
  radius?: number
  onDetent?: (index: number) => void
}

export function Dial({
  detents = 8,
  stiffness = 50,
  friction = 6,
  initialDetent = 0,
  radius = 0.42,
  onDetent,
  ...groupProps
}: DialProps) {
  const stepAngle = (Math.PI * 2) / detents
  const rotor = useRef<THREE.Group>(null)
  const lastIndex = useRef(initialDetent)

  const indexOf = (q: number) =>
    ((Math.round(-q / stepAngle) % detents) + detents) % detents

  const { bind } = use1DOF({
    field: composeFields(detentField(detents, stiffness), damping(friction)),
    initialQ: -initialDetent * stepAngle,
    localToQ: (local) => Math.atan2(local.y, local.x),
    wrapDelta: wrapAngle,
    onFrame: (q) => {
      if (rotor.current) rotor.current.rotation.z = q
      const idx = indexOf(q)
      if (idx !== lastIndex.current) {
        lastIndex.current = idx
        onDetent?.(idx)
      }
    },
  })

  const ticks = Array.from({ length: detents }, (_, k) => {
    const a = Math.PI / 2 - k * stepAngle
    const r = radius + 0.16
    return (
      <mesh key={k} position={[Math.cos(a) * r, Math.sin(a) * r, 0]} rotation={[0, 0, a]}>
        <boxGeometry args={[0.09, 0.028, 0.02]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
    )
  })

  return (
    <group {...groupProps} {...bind}>
      {ticks}
      <group ref={rotor} rotation={[0, 0, -initialDetent * stepAngle]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[radius, radius + 0.04, 0.22, 48]} />
          <meshStandardMaterial color="#1e293b" roughness={0.35} metalness={0.7} />
        </mesh>
        <mesh position={[0, radius * 0.7, 0.12]}>
          <boxGeometry args={[0.05, radius * 0.42, 0.035]} />
          <meshStandardMaterial color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={1.6} />
        </mesh>
      </group>
    </group>
  )
}
