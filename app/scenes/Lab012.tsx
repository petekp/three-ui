import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MeshTransmissionMaterial, useFBO } from '@react-three/drei'
import { SurfaceApp, useSurfaceTexture } from 'three-ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Lab 012 — the glass spike.
//
// Question under test: can a Surface wear a physically-based glass material
// (the "liquid glass" direction) while its DOM stays legible and live, and
// does refraction survive MULTIPLE levels of depth — glass in front of glass
// in front of a bright wall?
//
// Architecture per glass panel, all through the lab-011 material-slot seam:
//   - `material="none"` Surface wearing drei's MeshTransmissionMaterial on
//     an extruded rounded-rect (flat faces, rounded corner EDGES — a card,
//     not a soap bar). The glass body never samples the DOM.
//   - The DOM rides a hair-lifted transparent quad reading
//     `useSurfaceTexture()` at true UV — the world bends THROUGH the glass,
//     the ink sits ON it and never distorts.
//   - `.ui-root:has(> [data-glass-root])` (app CSS) clears the opaque
//     bg-background so the texture rasterizes with real alpha.
//
// Depth ladder, back to front: wall (DOM refraction target) → opaque props
// → glass sign-in card → glass pill overlapping the card in screen space.
// The pill's refraction must show the card's glass AND its ink AND the wall
// behind both — that's the multi-level verdict.
//
// Tuning: every transmission parameter is live on `window.__lab012`
// (`set('ior', 1.4)` hits every panel; `setFor('lab012-pill', ...)` one).

const PX = 200
const WALL_W = 880
const WALL_H = 560
const CARD_W = 360
const CARD_H = 440
const PILL_W = 220
const PILL_H = 72

// ---- geometry: an extruded rounded rect --------------------------------

function roundedRectGeometry(w: number, h: number, r: number, depth: number) {
  const shape = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  shape.moveTo(x + r, y)
  shape.lineTo(x + w - r, y)
  shape.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  shape.lineTo(x + w, y + h - r)
  shape.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  shape.lineTo(x + r, y + h)
  shape.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  shape.lineTo(x, y + r)
  shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 4,
    curveSegments: 24,
  })
  geo.translate(0, 0, -depth / 2)
  return geo
}

// ---- the glass panel ----------------------------------------------------

const BEVEL = 0.02
// The front face sits at depth/2 + BEVEL (bevels extend past the extrusion);
// the ink floats just above it.
const INK_LIFT = 0.012

type GlassKnobs = Record<string, number | boolean>

const glassMaterials = new Map<string, THREE.MeshPhysicalMaterial>()

// ---- the refraction buffers --------------------------------------------
//
// MTM's default mode hides ONLY the host mesh from its own buffer (a
// DiscardMaterial swap on `parent.material`) — children keep rendering, so
// the ink quad ghosted behind its own glass (measured: every label doubled,
// one crisp copy + one refracted). The documented escape hatch is the
// `buffer` prop: hand MTM a texture and it renders nothing itself. So a
// scene-level coordinator renders one FBO per panel with that panel's WHOLE
// group hidden (glass + ink), leaving every OTHER panel — glass, ink and
// all — visible in it. Glass-through-glass survives (a rear panel renders
// into a front panel's buffer with its own material, sampling its own
// last-frame buffer — one frame stale, invisible in practice), and nobody
// refracts their own ink. Tone mapping must be OFF during buffer renders,
// exactly as MTM's internal pass does it, or glass double-tonemaps.

interface GlassPass {
  group: React.RefObject<THREE.Group | null>
  fbo: THREE.WebGLRenderTarget
}

const glassPasses = new Map<string, GlassPass>()

// A second constraint, browser-bought: these are SCREEN-SPACE buffers,
// rendered from the camera, so a naive "hide only yourself" pass leaves a
// panel that is IN FRONT of you inside your buffer — and your refraction
// then shows the front panel's image through itself (measured: ghost
// "Continue" copies inside the pill, via the card's refraction of it).
// Physically a panel's refraction contains only what is BEHIND it. So:
// sort near→far and hide cumulatively — when panel P's buffer renders, P
// and every panel nearer than P are hidden. The rear panel still appears
// in the front panel's buffer (glass-through-glass survives); the front
// panel never appears in the rear one's.
const worldPos = new THREE.Vector3()

function GlassBufferCoordinator() {
  useFrame((state) => {
    if (glassPasses.size === 0) return
    const { gl, scene, camera } = state
    const entries = [...glassPasses.values()].filter((e) => e.group.current)
    if (entries.length === 0) return
    const dist = (e: GlassPass) =>
      camera.position.distanceTo(e.group.current!.getWorldPosition(worldPos))
    entries.sort((a, b) => dist(a) - dist(b))
    const oldTone = gl.toneMapping
    gl.toneMapping = THREE.NoToneMapping
    for (const e of entries) {
      // Hide, render, and STAY hidden for the farther panels' passes.
      e.group.current!.visible = false
      gl.setRenderTarget(e.fbo)
      gl.render(scene, camera)
    }
    for (const e of entries) e.group.current!.visible = true
    gl.setRenderTarget(null)
    gl.toneMapping = oldTone
  })
  return null
}

function GlassInk({ w, h, depth }: { w: number; h: number; depth: number }) {
  const texture = useSurfaceTexture()
  if (!texture) return null
  return (
    <mesh position={[0, 0, depth / 2 + BEVEL + INK_LIFT]}>
      <planeGeometry args={[w / PX, h / PX]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

interface GlassPanelProps {
  label: string
  width: number
  height: number
  radius?: number
  depth?: number
  resolution?: number
  content: React.ReactNode
  position: [number, number, number]
  rotation?: [number, number, number]
}

function GlassPanel({
  label,
  width,
  height,
  radius = 0.09,
  depth = 0.12,
  resolution = 768,
  content,
  position,
  rotation,
}: GlassPanelProps) {
  const geo = useMemo(
    () => roundedRectGeometry(width / PX, height / PX, radius, depth),
    [width, height, radius, depth],
  )
  useEffect(() => () => geo.dispose(), [geo])

  const group = useRef<THREE.Group | null>(null)
  const fbo = useFBO(resolution)
  useEffect(() => {
    glassPasses.set(label, { group, fbo })
    return () => {
      glassPasses.delete(label)
    }
  }, [label, fbo])

  return (
    <group ref={group} position={position} rotation={rotation}>
      <SurfaceApp
        label={label}
        width={width}
        height={height}
        material="none"
        content={content}
      >
        <primitive object={geo} attach="geometry" />
        <MeshTransmissionMaterial
          ref={(m: unknown) => {
            if (m) glassMaterials.set(label, m as THREE.MeshPhysicalMaterial)
            else glassMaterials.delete(label)
          }}
          buffer={fbo.texture}
          transmission={1}
          thickness={depth * 2.5}
          roughness={0.08}
          ior={1.5}
          chromaticAberration={0.06}
          anisotropicBlur={0.2}
          distortion={0}
          samples={6}
          resolution={resolution}
        />
        <GlassInk w={width} h={height} depth={depth} />
      </SurfaceApp>
    </group>
  )
}

// ---- DOM content --------------------------------------------------------

function SignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  return (
    <div
      data-glass-root
      className="flex flex-col gap-5 p-7 text-white"
      style={{ width: CARD_W, height: CARD_H }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-xl font-semibold tracking-tight">Welcome back</span>
        <span className="text-sm text-white/60">Sign in to the glass lab</span>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="l12-email" className="text-white/80">
          Email
        </Label>
        <Input
          id="l12-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@lab.dev"
          className="border-white/20 bg-white/10 text-white placeholder:text-white/35"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="l12-password" className="text-white/80">
          Password
        </Label>
        <Input
          id="l12-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="border-white/20 bg-white/10 text-white placeholder:text-white/35"
        />
      </div>
      <Button className="mt-auto bg-white/90 text-black hover:bg-white">Sign in</Button>
    </div>
  )
}

function PillChip() {
  return (
    <div
      data-glass-root
      className="flex items-center justify-center gap-2 text-white"
      style={{ width: PILL_W, height: PILL_H }}
    >
      <span className="text-sm font-medium">Continue</span>
      <span aria-hidden>→</span>
    </div>
  )
}

// The refraction target: loud, high-frequency, live DOM. Fine text rows
// prove distortion is real (fake displacement smears them; refraction bends
// them but keeps strokes intact), the grid gives the eye straight lines to
// watch bend, the blobs give the dispersion something colorful to split.
function WallArt() {
  return (
    <div
      className="relative overflow-hidden font-sans"
      style={{ width: WALL_W, height: WALL_H, background: '#0b0c11' }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(340px 340px at 18% 30%, #ff8c3b 0%, transparent 62%),' +
            'radial-gradient(300px 300px at 82% 22%, #38bdf8 0%, transparent 60%),' +
            'radial-gradient(360px 360px at 60% 85%, #a78bfa 0%, transparent 62%)',
          opacity: 0.85,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.14) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgba(255,255,255,0.14) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div className="absolute inset-0 flex flex-col justify-between p-8">
        <span className="text-7xl font-bold tracking-tighter text-white/90">
          matter
        </span>
        <div className="flex flex-col gap-1 text-white/70">
          <span className="text-xs">refraction target · live DOM · lab 012</span>
          <span className="text-xs">
            the quick brown fox jumps over the lazy dog 0123456789
          </span>
          <span className="text-[10px] text-white/50">
            the quick brown fox jumps over the lazy dog 0123456789
          </span>
        </div>
      </div>
    </div>
  )
}

// ---- the scene ----------------------------------------------------------

export function Lab012() {
  useEffect(() => {
    ;(window as unknown as { __lab012?: object }).__lab012 = {
      set: (key: string, value: GlassKnobs[string]) => {
        for (const m of glassMaterials.values()) {
          ;(m as unknown as GlassKnobs)[key] = value
        }
        return `set ${key}=${value} on ${glassMaterials.size} materials`
      },
      setFor: (label: string, key: string, value: GlassKnobs[string]) => {
        const m = glassMaterials.get(label)
        if (!m) return `no material: ${label}`
        ;(m as unknown as GlassKnobs)[key] = value
        return `set ${key}=${value} on ${label}`
      },
      labels: () => [...glassMaterials.keys()],
      params: (label?: string) => {
        const m = glassMaterials.get(label ?? 'lab012-card')
        if (!m) return null
        const u = m as unknown as Record<string, unknown>
        return {
          transmission: u.transmission,
          thickness: u.thickness,
          roughness: u.roughness,
          ior: u.ior,
          chromaticAberration: u.chromaticAberration,
          anisotropicBlur: u.anisotropicBlur,
          distortion: u.distortion,
        }
      },
    }
  }, [])

  return (
    <>
      <fog attach="fog" args={['#101014', 12, 30]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 7, 5]} intensity={1.4} castShadow />
      <pointLight position={[-3, 3.5, 3]} intensity={10} color="#ffd9b8" distance={14} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial color="#14151b" roughness={0.95} />
      </mesh>

      {/* Layer 0 — the wall, itself live DOM */}
      <SurfaceApp
        label="lab012-wall"
        width={WALL_W}
        height={WALL_H}
        position={[0, 1.7, -0.8]}
        content={<WallArt />}
      >
        <planeGeometry args={[WALL_W / PX, WALL_H / PX]} />
      </SurfaceApp>

      {/* Layer 1 — opaque props between wall and glass */}
      <mesh position={[-1.35, 1.15, 0.25]} castShadow>
        <torusKnotGeometry args={[0.16, 0.055, 128, 24]} />
        <meshStandardMaterial color="#ff8c3b" roughness={0.25} metalness={0.15} />
      </mesh>
      <mesh position={[1.15, 2.15, 0.35]} castShadow>
        <sphereGeometry args={[0.16, 48, 48]} />
        <meshStandardMaterial color="#38bdf8" roughness={0.2} metalness={0.1} />
      </mesh>

      {/* Layer 2 — the glass card */}
      <GlassPanel
        label="lab012-card"
        width={CARD_W}
        height={CARD_H}
        position={[0, 1.7, 0.9]}
        content={<SignInForm />}
      />

      {/* Layer 3 — the glass pill, overlapping the card in screen space */}
      <GlassPanel
        label="lab012-pill"
        width={PILL_W}
        height={PILL_H}
        radius={0.18}
        depth={0.1}
        resolution={512}
        position={[0.42, 1.62, 1.5]}
        content={<PillChip />}
      />

      <GlassBufferCoordinator />
    </>
  )
}
