import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SurfaceApp, useAnimationConductor, useSurfaceTexture } from 'three-ui'
import { Button } from '@/components/ui/button'

// Lab 011 — shaders on a Surface.
//
// Increment 1: the dissolve. A transient card (a toast, in spirit) whose
// entrance and exit are declared in verbatim Tailwind — `animate-in
// fade-in-0` on a descendant, exactly what a page would author — but
// PERFORMED by a ShaderMaterial: the conductor seizes the animation before
// a frame of it paints, the style engine's own easing comes back as the
// sampled curve, and the curve drives a noise-burn threshold over the live
// DOM texture. The DOM declares intent; the material interprets it
// physically. No filter, no mask, no CSS anywhere can burn an element away
// along a noise field — this is the first thing a Surface can do that a
// page cannot.
//
// The seam underneath is `material="none"` + `useSurfaceTexture()`: the
// Surface yields its material slot to its children and hands them the
// texture. Everything else — paint-driven uploads, LOD re-rasters, input
// forwarding — acts on the texture and the mesh, so it all keeps working
// under a material the library has never seen.

const PX = 200
const CONSOLE_W = 360
const CONSOLE_H = 230
const TOAST_W = 340
const TOAST_H = 110

// ---- the dissolve material ------------------------------------------------

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Value-noise fbm drives the burn front. uProgress 0 = fully dissolved,
// 1 = fully present; the threshold sweeps past both ends by the edge width
// so the extremes are genuinely empty and genuinely clean.
const FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform float uProgress;
  uniform vec3 uEdgeColor;
  uniform float uNoiseScale;
  uniform float uAspect;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    return (0.5 * vnoise(p) + 0.25 * vnoise(p * 2.13) + 0.125 * vnoise(p * 4.31)) / 0.875;
  }

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float n = fbm(vec2(vUv.x * uAspect, vUv.y) * uNoiseScale);
    float edge = 0.09;
    float front = uProgress * (1.0 + 2.0 * edge) - edge;
    float d = n - front;          // > 0: beyond the burn front (gone)
    if (d > edge) discard;
    float t = clamp(d / edge, 0.0, 1.0);   // 0 deep inside … 1 at the front
    vec3 ember = uEdgeColor * (1.0 + 2.5 * t);   // hot rim, HDR-ish
    vec3 color = mix(tex.rgb, ember, smoothstep(0.25, 0.9, t));
    gl_FragColor = vec4(color, tex.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function DissolveMaterial({ progress }: { progress: React.RefObject<number> }) {
  const texture = useSurfaceTexture()
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uMap: { value: null },
          uProgress: { value: 0 },
          uEdgeColor: { value: new THREE.Color('#ff8c3b') },
          uNoiseScale: { value: 9 },
          uAspect: { value: TOAST_W / TOAST_H },
        },
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  // The sampler was declared up front, so the texture's arrival needs no
  // recompile — just the value.
  useEffect(() => {
    material.uniforms.uMap.value = texture
  }, [material, texture])
  useFrame(() => {
    material.uniforms.uProgress.value = progress.current
  })
  return <primitive object={material} attach="material" />
}

// ---- the transient card ---------------------------------------------------

interface Dispatch {
  id: number
  text: string
}

// The card authors its motion the way any page would: tw-animate classes on
// a DESCENDANT of the drawn root (house rule). The conductor seizes both
// flights; the only animation frames that ever rasterize are the two parked
// poles.
function TransientToast({ text, onGone }: { text: string; onGone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), 2800)
    return () => clearTimeout(t)
  }, [])
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-lg ${
        leaving ? 'animate-out fade-out-0' : 'animate-in fade-in-0'
      }`}
      style={{ width: TOAST_W, height: TOAST_H, animationDuration: '900ms' }}
      onAnimationEnd={() => {
        if (leaving) onGone()
      }}
    >
      <span className="text-2xl">🔥</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{text}</span>
        <span className="text-xs text-muted-foreground">
          declared as fade-in-0 · performed as a noise burn
        </span>
      </div>
    </div>
  )
}

function ToastSurface({ dispatch, onGone }: { dispatch: Dispatch | null; onGone: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const progress = useRef(0)

  // The conductor's samples are the style engine's own eased values —
  // opacity 0→1 for the enter, 1→0 for the exit — remapped onto the burn
  // threshold. The curve the page author picked IS the dissolve curve.
  useAnimationConductor(host, (value) => {
    progress.current = value.opacity
  })

  return (
    <SurfaceApp
      label="lab011-toast"
      width={TOAST_W}
      height={TOAST_H}
      material="none"
      hitTest="content"
      position={[0.62, 2.62, 0.55]}
      rotation={[0, -0.18, 0.01]}
      onHost={setHost}
      content={
        dispatch ? (
          <TransientToast key={dispatch.id} text={dispatch.text} onGone={onGone} />
        ) : null
      }
    >
      <planeGeometry args={[TOAST_W / PX, TOAST_H / PX]} />
      <DissolveMaterial progress={progress} />
    </SurfaceApp>
  )
}

// ---- the console ----------------------------------------------------------

const MESSAGES = [
  'Build finished — 266 tests green.',
  'Deploy landed on staging.',
  'The texture is matter now.',
]

function DispatchConsole({ onDispatch }: { onDispatch: () => void }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
      style={{ width: CONSOLE_W, height: CONSOLE_H }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Shader lab</span>
        <span className="text-xs leading-relaxed text-muted-foreground">
          The card above enters and exits through a dissolve shader. Its
          motion is authored as verbatim Tailwind (<code>fade-in-0</code>);
          the conductor hands the eased curve to a ShaderMaterial that burns
          the live DOM texture along a noise field — an effect no CSS can
          produce.
        </span>
      </div>
      <Button onClick={onDispatch} className="mt-auto w-full">
        Dispatch transmission
      </Button>
    </div>
  )
}

// ---- the scene ------------------------------------------------------------

export function Lab011() {
  const [dispatch, setDispatch] = useState<Dispatch | null>(null)
  const nextId = useRef(1)
  const msgIx = useRef(0)

  const fire = () => {
    setDispatch({
      id: nextId.current++,
      text: MESSAGES[msgIx.current++ % MESSAGES.length],
    })
  }

  useEffect(() => {
    ;(window as unknown as { __lab011?: object }).__lab011 = {
      fire,
      live: () => dispatch !== null,
    }
  })

  return (
    <>
      <fog attach="fog" args={['#101014', 10, 26]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 7, 4]} intensity={1.3} castShadow />
      <pointLight position={[-3, 3, 3]} intensity={12} color="#ffb08a" distance={12} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[12, 64]} />
        <meshStandardMaterial color="#15161c" roughness={0.95} />
      </mesh>

      <SurfaceApp
        label="lab011-console"
        width={CONSOLE_W}
        height={CONSOLE_H}
        position={[0, 1.5, 0.2]}
        rotation={[0, 0, 0]}
        castShadow
        content={<DispatchConsole onDispatch={fire} />}
      >
        <planeGeometry args={[CONSOLE_W / PX, CONSOLE_H / PX]} />
      </SurfaceApp>

      <ToastSurface dispatch={dispatch} onGone={() => setDispatch(null)} />
    </>
  )
}
