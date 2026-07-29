import { useState } from 'react'
import { animated, useSpring } from '@react-spring/three'
import { Text } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'

// A button as a physical object: a machined metal well with a soft-touch
// cap that actually travels when you press it. The spring config is doing
// the "material honesty" work — stiff on press, a little bounce on release.

export function PhysicalButton(props: ThreeElements['group']) {
  const [pressed, setPressed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [count, setCount] = useState(0)

  const { capY, glow } = useSpring({
    capY: pressed ? 0.05 : 0.22,
    glow: pressed ? 2.2 : hovered ? 0.9 : 0.25,
    config: pressed
      ? { tension: 1200, friction: 40 } // hard, immediate travel down
      : { tension: 400, friction: 14 }, // springy return with slight overshoot
  })

  return (
    <group {...props}>
      {/* machined base well */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.75, 0.85, 0.3, 48]} />
        <meshStandardMaterial color="#2a2c31" metalness={0.9} roughness={0.35} />
      </mesh>

      {/* glowing indicator ring around the well lip */}
      <mesh position={[0, 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.62, 0.025, 16, 64]} />
        <animated.meshStandardMaterial
          color="#7dd3fc"
          emissive="#38bdf8"
          emissiveIntensity={glow}
          toneMapped={false}
        />
      </mesh>

      {/* the travelling cap */}
      <animated.mesh
        position-y={capY}
        castShadow
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => {
          setHovered(false)
          setPressed(false)
        }}
        onPointerDown={(e) => {
          e.stopPropagation()
          setPressed(true)
          setCount((c) => c + 1)
        }}
        onPointerUp={() => setPressed(false)}
      >
        <cylinderGeometry args={[0.55, 0.58, 0.22, 48]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.1} roughness={0.6} />
      </animated.mesh>

      <Text
        position={[0, 0.9, 0]}
        fontSize={0.16}
        color="#94a3b8"
        anchorX="center"
        anchorY="middle"
      >
        {`<Button /> · pressed ${count}×`}
      </Text>
    </group>
  )
}
