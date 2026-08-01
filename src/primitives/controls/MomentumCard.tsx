import { useRef } from 'react'
import * as THREE from 'three'
import { RoundedBox, Text } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import {
  RigidBody,
  useSpringJoint,
  type RapierRigidBody,
} from '@react-three/rapier'
import { RigidBodyType } from '@dimforge/rapier3d-compat'

// Motion as forces, not tweens. This card has mass and hangs from an
// invisible spring anchored at its home position. Dragging makes it
// kinematic (it follows your pointer while we integrate its velocity);
// releasing hands that velocity straight to the physics engine. Fling it —
// it leaves with YOUR momentum, the spring reels it back, and it settles
// with real oscillation. There is no animation code here: no durations, no
// easing curves, no keyframes. Interruption isn't an edge case — grabbing a
// moving card mid-flight just works, because position is always emergent.

export interface MomentumCardProps {
  home: [number, number, number]
}

export function MomentumCard({ home }: MomentumCardProps) {
  const anchor = useRef<RapierRigidBody>(null)
  const card = useRef<RapierRigidBody>(null)
  const controls = useThree((s) => s.controls as { enabled?: boolean } | null)

  // restLength 0, stiffness 40, damping 3 — a lazy, readable spring.
  useSpringJoint(
    anchor as React.RefObject<RapierRigidBody>,
    card as React.RefObject<RapierRigidBody>,
    [[0, 0, 0], [0, 0, 0], 0, 40, 3],
  )

  const drag = useRef<{
    plane: THREE.Plane
    last: THREE.Vector3
    lastT: number
    velocity: THREE.Vector3
    active: boolean
  }>({
    plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -home[2]),
    last: new THREE.Vector3(),
    lastT: 0,
    velocity: new THREE.Vector3(),
    active: false,
  })

  const pointOnPlane = (e: ThreeEvent<PointerEvent>) => {
    const hit = new THREE.Vector3()
    e.ray.intersectPlane(drag.current.plane, hit)
    return hit
  }

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (!card.current) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    if (controls) controls.enabled = false
    const d = drag.current
    d.active = true
    d.last.copy(pointOnPlane(e))
    d.lastT = e.timeStamp
    d.velocity.set(0, 0, 0)
    card.current.setBodyType(RigidBodyType.KinematicPositionBased, true)
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d.active || !card.current) return
    const p = pointOnPlane(e)
    const dt = Math.max((e.timeStamp - d.lastT) / 1000, 1e-4)
    // Exponential smoothing so the release velocity reflects the last few
    // frames of the gesture, not one noisy sample.
    const instant = p.clone().sub(d.last).divideScalar(dt)
    d.velocity.lerp(instant, 0.35)
    d.last.copy(p)
    d.lastT = e.timeStamp
    card.current.setNextKinematicTranslation(p)
  }

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d.active || !card.current) return
    d.active = false
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    if (controls) controls.enabled = true
    card.current.setBodyType(RigidBodyType.Dynamic, true)
    card.current.setLinvel(d.velocity, true)
    // A flick of spin proportional to sideways speed makes releases read
    // as physical, not scripted.
    card.current.setAngvel({ x: 0, y: 0, z: -d.velocity.x * 0.15 }, true)
  }

  return (
    <group>
      <RigidBody ref={anchor} type="fixed" position={home} />
      <RigidBody
        ref={card}
        position={home}
        colliders="cuboid"
        linearDamping={0.4}
        angularDamping={2}
        restitution={0.3}
        canSleep={false}
      >
        <RoundedBox
          args={[1.7, 2.3, 0.09]}
          radius={0.07}
          smoothness={4}
          castShadow
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          <meshStandardMaterial color="#e2e8f0" roughness={0.5} metalness={0.15} />
        </RoundedBox>
        <Text position={[0, 0.6, 0.06]} fontSize={0.17} color="#0f172a" fontWeight="bold">
          momentum
        </Text>
        <Text
          position={[0, 0.1, 0.06]}
          fontSize={0.1}
          color="#475569"
          maxWidth={1.3}
          lineHeight={1.6}
          textAlign="center"
        >
          drag me, then let go mid-gesture. no tweens — mass, a spring, and
          whatever velocity you hand over.
        </Text>
      </RigidBody>
    </group>
  )
}
