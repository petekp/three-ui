import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ThreeElements, ThreeEvent } from '@react-three/fiber'
import {
  composeFields,
  damping,
  endStops,
  flipImpulse,
  overCenterField,
} from '../../lib/physics1D'
import { use1DOF } from './use1DOF'

// <Toggle> — a bistable paddle switch. The over-center field owns the feel:
// a tap applies an impulse toward the far pole; whether it commits or falls
// home is decided by the physics, and onFlip reports only SETTLED state. The
// tap strength is bisected from the actual field at mount (flipImpulse), so
// any tuning stays flippable.

export interface ToggleProps extends Omit<ThreeElements['group'], 'children'> {
  initialOn?: boolean
  span?: number
  snap?: number
  friction?: number
  onFlip?: (on: boolean) => void
}

export function Toggle({
  initialOn = false,
  span = 0.38,
  snap = 120,
  friction = 8,
  onFlip,
  ...groupProps
}: ToggleProps) {
  const paddle = useRef<THREE.Group>(null)
  const capMat = useRef<THREE.MeshStandardMaterial>(null)
  const reported = useRef(initialOn)

  const field = useMemo(
    () =>
      composeFields(
        overCenterField(snap, span),
        endStops(-span * 1.35, span * 1.35, 600),
        damping(friction),
      ),
    [snap, span, friction],
  )
  const tap = useMemo(() => flipImpulse(field, span), [field, span])

  const { body, impulse } = use1DOF({
    field,
    initialQ: initialOn ? span : -span,
    localToQ: (local) => Math.atan2(local.y, local.z), // tilt about local X
    onFrame: (q) => {
      if (paddle.current) paddle.current.rotation.x = q
      if (capMat.current) {
        capMat.current.emissiveIntensity = THREE.MathUtils.clamp(
          ((q / span + 1) / 2) * 2.2,
          0.05,
          2.2,
        )
      }
    },
    onSettle: (q) => {
      const on = q > 0
      if (on !== reported.current) {
        reported.current = on
        onFlip?.(on)
      }
    },
  })

  // A toggle is tapped, not dragged (v0): kick toward the opposite pole and
  // let the double-well decide. bind's down handler is replaced by the tap.
  const onTap = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    impulse(body.current.q >= 0 ? -tap : tap)
  }

  return (
    <group {...groupProps} onPointerDown={onTap}>
      <mesh castShadow>
        <boxGeometry args={[0.34, 0.5, 0.16]} />
        <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.4} />
      </mesh>
      <group ref={paddle} position={[0, 0, 0.08]} rotation={[initialOn ? span : -span, 0, 0]}>
        <mesh position={[0, 0, 0.14]} castShadow>
          <boxGeometry args={[0.22, 0.4, 0.28]} />
          <meshStandardMaterial color="#1e293b" roughness={0.35} metalness={0.6} />
        </mesh>
        <mesh position={[0, 0.14, 0.29]}>
          <boxGeometry args={[0.16, 0.08, 0.02]} />
          <meshStandardMaterial
            ref={capMat}
            color="#5eead4"
            emissive="#2dd4bf"
            emissiveIntensity={initialOn ? 2.2 : 0.05}
          />
        </mesh>
      </group>
    </group>
  )
}
