import { useState } from 'react'
import { Text } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'
import { CylinderCollider, RigidBody } from '@react-three/rapier'

// Proof that UI elements can be governed by an actual physics engine:
// click the hopper and it dispenses "toast" chips that fall, bounce, and
// pile up. Imagine notifications that physically stack.

const CHIP_COLORS = ['#38bdf8', '#f472b6', '#a3e635', '#fbbf24', '#c084fc']
const MAX_CHIPS = 24

interface Chip {
  id: number
  color: string
  x: number
  z: number
  rot: number
}

export function ChipDispenser(props: ThreeElements['group'] & { origin?: [number, number, number] }) {
  const [chips, setChips] = useState<Chip[]>([])

  const dispense = () => {
    setChips((prev) => {
      const chip: Chip = {
        id: (prev.at(-1)?.id ?? 0) + 1,
        color: CHIP_COLORS[Math.floor(Math.random() * CHIP_COLORS.length)],
        x: (Math.random() - 0.5) * 0.5,
        z: (Math.random() - 0.5) * 0.5,
        rot: Math.random() * Math.PI,
      }
      return [...prev.slice(-(MAX_CHIPS - 1)), chip]
    })
  }

  return (
    <group {...props}>
      {/* hopper — click it */}
      <mesh
        position={[0, 2.6, 0]}
        castShadow
        onPointerDown={(e) => {
          e.stopPropagation()
          dispense()
        }}
      >
        <cylinderGeometry args={[0.5, 0.3, 0.6, 6]} />
        <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
      </mesh>

      {chips.map((chip) => (
        <RigidBody
          key={chip.id}
          position={[chip.x, 2.1, chip.z]}
          rotation={[Math.random() * 0.4, chip.rot, 0]}
          colliders={false}
          restitution={0.4}
          friction={0.8}
        >
          <CylinderCollider args={[0.05, 0.32]} />
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[0.32, 0.32, 0.1, 24]} />
            <meshStandardMaterial
              color={chip.color}
              metalness={0.2}
              roughness={0.4}
            />
          </mesh>
        </RigidBody>
      ))}

      <Text position={[0, 3.3, 0]} fontSize={0.16} color="#94a3b8" anchorX="center">
        {`<Toast /> · click to dispense (${chips.length})`}
      </Text>
    </group>
  )
}
