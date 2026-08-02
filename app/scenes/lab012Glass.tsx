import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SurfaceApp, useSurfaceTexture } from 'three-ui'
import { BLIT_FRAGMENT, GLASS_FRAGMENT, QUAD_VERTEX } from './lab012Sdf'

// Lab 012 inc 2 — the SDF glass path.
//
// `SdfGlassPanel` is a Surface that renders NOTHING of its own: the mesh
// carries `material="none"` and an invisible material, so it exists only to
// be raycast (the pointer forwarding still needs a real quad with real UVs —
// see decisions #20). Its pixels are produced later, by `GlassSdfCompositor`,
// from the panel's world matrix and its DOM texture.
//
// Rendering `material.visible = false` costs one skipped draw call
// (WebGLRenderer checks it in renderObjects) and keeps the object visible to
// the raycaster, which is exactly the split we want: invisible matter that
// can still be touched.

export interface GlassParams {
  /** Corner radius, world units. The shape's only geometric input. */
  radius: number
  /** Width of the lensing rim. Everything inside this is flat glass. */
  bezel: number
  /** How far the rim bulges — the "how thick does it look" knob. */
  thickness: number
  /** How far a refracted ray travels before we re-project it: bend strength. */
  spread: number
  ior: number
  chroma: number
  roughness: number
  tint: string
  tintAmount: number
  edgeLight: number
  specular: number
  inkOpacity: number
  /** Smooth-min blend radius for coplanar satellites, world units. */
  smooth: number
}

/**
 * A circle sharing the panel's plane, unioned into its field.
 *
 * Deliberately a plain mutable object, not React state: the scene animates
 * these every frame and the compositor reads them every frame, so the array
 * identity is the contract and nothing in between needs to re-render.
 */
export interface GlassBlob {
  /** Centre in panel-local world units — (0,0) is the panel's centre. */
  x: number
  y: number
  r: number
}

/** How many satellites one panel may carry — must match the shader define. */
export const MAX_BLOBS = 6

// Tuned in the browser against the lab's own wall (loud, high-frequency,
// live DOM) — see the README entry. The two that matter most: `roughness`
// above ~0.15 stops being frost and starts being fog, because the frost is a
// blur of the ALREADY-COMPOSITED image rather than a rough-surface BSDF; and
// `bezel` is the whole look — it is how much of the panel is lens.
export const GLASS_DEFAULTS: GlassParams = {
  radius: 0.09,
  bezel: 0.16,
  thickness: 0.16,
  spread: 0.45,
  ior: 1.42,
  chroma: 0.05,
  roughness: 0.1,
  tint: '#dfe8ff',
  tintAmount: 0.05,
  edgeLight: 0.35,
  specular: 0.6,
  inkOpacity: 1,
  // Roughly a third of a satellite's radius: enough that the neck reads as
  // surface tension rather than a fillet, small enough that a blob still
  // arrives as a distinct object before it dissolves into the card.
  smooth: 0.14,
}

interface SdfPanel {
  label: string
  group: React.RefObject<THREE.Group | null>
  half: THREE.Vector2
  params: GlassParams
  blobs: GlassBlob[]
}

const sdfPanels = new Map<string, SdfPanel>()
// Separate from the panel entry on purpose: React runs child effects before
// parent ones, so the registrar inside `SurfaceApp` cannot write into a
// record its own parent has not created yet. Keyed by label, joined at
// composite time.
const sdfInk = new Map<string, THREE.Texture>()

export function sdfPanelParams(label: string) {
  return sdfPanels.get(label)?.params ?? null
}

export function sdfPanelLabels() {
  return [...sdfPanels.keys()]
}

// ---- the panel ----------------------------------------------------------

// The DOM texture reaches the compositor the same way inc 1's ink quad got
// it — through the material-slot seam — but it never touches a material here.
// Premultiplied for the same reason as inc 1: bilinear filtering of straight
// alpha bleeds the white of `bg-white/10` into every opaque boundary
// (decisions #36), and the compositor's `glass*(1-a) + rgb` is the shader
// spelling of One/OneMinusSrcAlpha.
function InkRegistrar({ label }: { label: string }) {
  const texture = useSurfaceTexture()
  useEffect(() => {
    if (!texture) return
    texture.premultiplyAlpha = true
    texture.needsUpdate = true
    sdfInk.set(label, texture)
    return () => {
      sdfInk.delete(label)
    }
  }, [label, texture])
  return null
}

export interface SdfGlassPanelProps {
  label: string
  /** CSS px; divided by `px` for world units. */
  width: number
  height: number
  px: number
  params?: Partial<GlassParams>
  /**
   * Coplanar circles merged into this panel's glass. Pass a STABLE array and
   * mutate its members per frame — see `BlobDrift` in Lab012.
   */
  blobs?: GlassBlob[]
  content: React.ReactNode
  position: [number, number, number]
  rotation?: [number, number, number]
}

export function SdfGlassPanel({
  label,
  width,
  height,
  px,
  params,
  blobs,
  content,
  position,
  rotation,
}: SdfGlassPanelProps) {
  const group = useRef<THREE.Group | null>(null)
  // One mutable params object per panel, created once and then poked in place
  // by the console knobs — no re-render, no uniform plumbing, and nothing to
  // clobber a live tuning session. `params` is an INITIAL value.
  const live = useMemo(
    () => ({ ...GLASS_DEFAULTS, ...params }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    sdfPanels.set(label, {
      label,
      group,
      half: new THREE.Vector2(width / px / 2, height / px / 2),
      params: live,
      blobs: blobs ?? [],
    })
    return () => {
      sdfPanels.delete(label)
    }
  }, [label, width, height, px, live, blobs])

  return (
    <group ref={group} position={position} rotation={rotation}>
      <SurfaceApp label={label} width={width} height={height} material="none" content={content}>
        <planeGeometry args={[width / px, height / px]} />
        <meshBasicMaterial visible={false} />
        <InkRegistrar label={label} />
      </SurfaceApp>
    </group>
  )
}

// ---- the compositor -----------------------------------------------------
//
// Takes the render loop over (`useFrame` at priority 1 tells r3f to stop
// auto-rendering) and runs:
//
//   scene → sceneFbo (once, panels hidden, depth texture attached)
//   for each panel, far → near:  src → glass pass → dst,  swap
//   src → blit → screen (tone mapping + sRGB, the only such step)
//
// Cost is one scene render plus N full-screen passes, against inc 1's N
// scene renders. The passes are pure fill: at 1× viewport, ~8 taps each.

// drei's useFBO can't express "give me a depth texture" in its types (its
// `depth?: boolean` intersects with three's `RenderTargetOptions.depth?:
// number` and collapses to never), and the pipeline wants exact control over
// the attachments anyway: HalfFloat colour so the composite stays in linear
// light, a depth texture on the scene pass only, MSAA on the scene pass only.
function useTarget(w: number, h: number, opts: { depth?: boolean; samples?: number } = {}) {
  const { depth = false, samples = 0 } = opts
  const target = useMemo(() => {
    const t = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: depth,
    })
    if (depth) t.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType)
    t.samples = samples
    return t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    target.setSize(w, h)
  }, [target, w, h])
  useEffect(() => () => target.dispose(), [target])
  return target
}

const tmpInvProjView = new THREE.Matrix4()
const tmpProjView = new THREE.Matrix4()
const tmpPanelInv = new THREE.Matrix4()
const tmpRot = new THREE.Matrix3()
const tmpPos = new THREE.Vector3()

export function GlassSdfCompositor({ lightDir = [4, 7, 5] }: { lightDir?: [number, number, number] }) {
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const w = Math.max(1, Math.round(size.width * dpr))
  const h = Math.max(1, Math.round(size.height * dpr))

  // MSAA on the scene pass only: the panels get exact analytic coverage from
  // the SDF, but the props and the wall behind them are still triangles.
  // three resolves the depth attachment alongside the colour one
  // (RenderTarget.resolveDepthBuffer defaults true), so occlusion survives.
  const sceneFbo = useTarget(w, h, { samples: 4, depth: true })
  const pingA = useTarget(w, h)
  const pingB = useTarget(w, h)

  const glass = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader: GLASS_FRAGMENT,
        defines: { SAMPLES: 8, MAX_BLOBS },
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tSrc: { value: null },
          tDepth: { value: null },
          tInk: { value: null },
          uHasInk: { value: false },
          uInkOpacity: { value: 1 },
          uCamPos: { value: new THREE.Vector3() },
          uInvProjView: { value: new THREE.Matrix4() },
          uProjView: { value: new THREE.Matrix4() },
          uView: { value: new THREE.Matrix4() },
          uNear: { value: 0.1 },
          uFar: { value: 100 },
          uPanelInv: { value: new THREE.Matrix4() },
          uPanelRot: { value: new THREE.Matrix3() },
          uHalf: { value: new THREE.Vector2() },
          uRadius: { value: 0.09 },
          // Allocated full-length once: three uploads a vec3[] as one
          // uniform3fv, so the array must keep its size even when the panel
          // carries fewer blobs — uBlobCount is what bounds the loop.
          uBlobs: { value: Array.from({ length: MAX_BLOBS }, () => new THREE.Vector3()) },
          uBlobCount: { value: 0 },
          uSmooth: { value: 0.14 },
          uBezel: { value: 0.13 },
          uThickness: { value: 0.1 },
          uSpread: { value: 0.34 },
          uIor: { value: 1.42 },
          uChroma: { value: 0.035 },
          uRough: { value: 0.28 },
          uTint: { value: new THREE.Color('#dfe8ff') },
          uTintAmount: { value: 0.06 },
          uEdgeLight: { value: 0.28 },
          uSpecular: { value: 0.55 },
          uLightDir: { value: new THREE.Vector3(...lightDir) },
        },
      }),
    // lightDir is read into the uniform below every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const blit = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader: BLIT_FRAGMENT,
        depthTest: false,
        depthWrite: false,
        uniforms: { tSrc: { value: null } },
      }),
    [],
  )

  // Two one-mesh scenes. `frustumCulled = false` because the vertex shader
  // writes clip space directly — three's bounding-sphere test would cull a
  // quad it thinks is a 2×2 plane at the origin.
  const [glassScene, blitScene, quadCam] = useMemo(() => {
    const geo = new THREE.PlaneGeometry(2, 2)
    const mk = (m: THREE.Material) => {
      const s = new THREE.Scene()
      const mesh = new THREE.Mesh(geo, m)
      mesh.frustumCulled = false
      s.add(mesh)
      return s
    }
    return [mk(glass), mk(blit), new THREE.Camera()]
  }, [glass, blit])

  useEffect(
    () => () => {
      glass.dispose()
      blit.dispose()
    },
    [glass, blit],
  )

  useFrame(({ gl, scene, camera }) => {
    const panels = [...sdfPanels.values()].filter((p) => p.group.current)

    // 1 — the world, once. The panels are hidden even though their material
    // is invisible: the contract is "the compositor owns these pixels", and a
    // panel that later grows a visible child must not leak into its own
    // refraction source.
    for (const p of panels) p.group.current!.visible = false
    gl.setRenderTarget(sceneFbo)
    gl.render(scene, camera)
    for (const p of panels) p.group.current!.visible = true

    if (panels.length === 0) {
      blit.uniforms.tSrc.value = sceneFbo.texture
      gl.setRenderTarget(null)
      gl.render(blitScene, quadCam)
      return
    }

    // 2 — far → near. Each pass reads what the previous one wrote, so a
    // panel's refraction contains the glass, the ink and the world behind it
    // by construction — the whole cumulative-hide dance of inc 1 is gone.
    panels.sort(
      (a, b) =>
        camera.position.distanceToSquared(b.group.current!.getWorldPosition(tmpPos)) -
        camera.position.distanceToSquared(a.group.current!.getWorldPosition(tmpPos)),
    )

    const u = glass.uniforms
    tmpProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    tmpInvProjView.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse)
    u.uProjView.value.copy(tmpProjView)
    u.uInvProjView.value.copy(tmpInvProjView)
    u.uView.value.copy(camera.matrixWorldInverse)
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld)
    u.uNear.value = (camera as THREE.PerspectiveCamera).near
    u.uFar.value = (camera as THREE.PerspectiveCamera).far
    u.tDepth.value = sceneFbo.depthTexture
    u.uLightDir.value.set(lightDir[0], lightDir[1], lightDir[2])

    let src: THREE.WebGLRenderTarget = sceneFbo
    let dst = pingA
    for (const p of panels) {
      const g = p.group.current!
      tmpPanelInv.copy(g.matrixWorld).invert()
      tmpRot.setFromMatrix4(g.matrixWorld)
      u.uPanelInv.value.copy(tmpPanelInv)
      u.uPanelRot.value.copy(tmpRot)
      u.uHalf.value.copy(p.half)
      const ink = sdfInk.get(p.label) ?? null
      u.tSrc.value = src.texture
      u.tInk.value = ink
      u.uHasInk.value = !!ink
      const q = p.params
      u.uRadius.value = q.radius
      u.uBezel.value = q.bezel
      u.uThickness.value = q.thickness
      u.uSpread.value = q.spread
      u.uIor.value = q.ior
      u.uChroma.value = q.chroma
      u.uRough.value = q.roughness
      u.uTint.value.set(q.tint)
      u.uTintAmount.value = q.tintAmount
      u.uEdgeLight.value = q.edgeLight
      u.uSpecular.value = q.specular
      u.uInkOpacity.value = q.inkOpacity
      u.uSmooth.value = Math.max(q.smooth, 1e-4)   // smin divides by k
      const blobs = p.blobs
      const nb = Math.min(blobs.length, MAX_BLOBS)
      for (let i = 0; i < nb; i++) {
        ;(u.uBlobs.value as THREE.Vector3[])[i].set(blobs[i].x, blobs[i].y, blobs[i].r)
      }
      u.uBlobCount.value = nb

      gl.setRenderTarget(dst)
      gl.render(glassScene, quadCam)
      src = dst
      dst = dst === pingA ? pingB : pingA
    }

    // 3 — out of linear light, once.
    blit.uniforms.tSrc.value = src.texture
    gl.setRenderTarget(null)
    gl.render(blitScene, quadCam)
  }, 1)

  return null
}
