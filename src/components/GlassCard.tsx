import { Float, MeshTransmissionMaterial, RoundedBox, Text } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'

// A card made of actual glass: a transmissive slab floating in front of its
// own content plate, so the type refracts and distorts as you orbit. This is
// the "real materials" thesis in its purest form — depth you can't fake
// with box-shadow.

export function GlassCard(props: ThreeElements['group']) {
  return (
    <group {...props}>
      <Float speed={1.5} rotationIntensity={0.15} floatIntensity={0.4}>
        {/* glass slab */}
        <RoundedBox args={[2.1, 2.8, 0.14]} radius={0.09} smoothness={6} castShadow>
          <MeshTransmissionMaterial
            transmission={1}
            thickness={0.45}
            roughness={0.08}
            chromaticAberration={0.04}
            anisotropicBlur={0.2}
            ior={1.5}
            distortion={0.08}
            distortionScale={0.4}
            color="#ffffff"
          />
        </RoundedBox>

        {/* content plate sitting behind the glass */}
        <group position={[0, 0, -0.35]}>
          <mesh>
            <planeGeometry args={[1.9, 2.6]} />
            <meshStandardMaterial color="#0f172a" roughness={0.9} />
          </mesh>
          <Text
            position={[-0.78, 1.0, 0.01]}
            fontSize={0.22}
            color="#f8fafc"
            anchorX="left"
            anchorY="middle"
            fontWeight="bold"
          >
            Card
          </Text>
          <Text
            position={[-0.78, 0.68, 0.01]}
            fontSize={0.11}
            color="#94a3b8"
            anchorX="left"
            anchorY="middle"
            maxWidth={1.6}
            lineHeight={1.5}
          >
            Real refraction, real thickness. Orbit the camera and watch the
            type bend through the glass.
          </Text>
          <mesh position={[0, -0.85, 0.01]}>
            <planeGeometry args={[1.5, 0.42]} />
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#0ea5e9"
              emissiveIntensity={0.4}
            />
          </mesh>
          <Text position={[0, -0.85, 0.02]} fontSize={0.13} color="#082f49">
            Action
          </Text>
        </group>
      </Float>

      <Text position={[0, -1.8, 0]} fontSize={0.16} color="#94a3b8" anchorX="center">
        {'<Card material="glass" />'}
      </Text>
    </group>
  )
}
