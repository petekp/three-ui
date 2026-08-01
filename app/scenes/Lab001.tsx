import { Physics, RigidBody } from '@react-three/rapier'
import { PhysicalButton } from '../components/PhysicalButton'
import { GlassCard } from '../components/GlassCard'
import { HtmlPanel } from '../components/HtmlPanel'
import { ChipDispenser } from '../components/ChipDispenser'

// Lab 001 — the original feasibility specimens, kept as regression pieces.

export function Lab001() {
  return (
    <>
      <ambientLight intensity={0.15} />
      <directionalLight
        position={[6, 8, 4]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />

      <Physics gravity={[0, -9.81, 0]}>
        <RigidBody type="fixed">
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]} receiveShadow>
            <planeGeometry args={[40, 40]} />
            <meshStandardMaterial color="#111318" roughness={0.95} />
          </mesh>
        </RigidBody>

        <PhysicalButton position={[-4.2, 0, 0]} />
        <GlassCard position={[-1.4, 1.7, 0]} />
        <HtmlPanel position={[1.8, 1.5, 0]} />
        <ChipDispenser position={[4.6, 0, 0]} />
      </Physics>
    </>
  )
}
