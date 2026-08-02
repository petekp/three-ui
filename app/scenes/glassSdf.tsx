import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SurfaceApp, useSurfaceTexture } from 'three-ui'
import { BLIT_FRAGMENT, GLASS_FRAGMENT, QUAD_VERTEX } from './glassSdfShader'

// The SDF glass path — born in lab 012 inc 2, now the shared kit every glass
// lab builds on (012's beads, 013's morphing chat shell).
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
  /** Peak wave HEIGHT a unit impulse adds, world units. 0 disables ripples. */
  rippleAmp: number
  /** Capillary phase constant K = 4/(27 sigma/rho): sets the wave scale. */
  rippleK: number
  /** Viscosity — how fast the short leading waves are eaten. */
  rippleNu: number
  /** Source radius: a contact is not a delta impulse. World units. */
  rippleSource: number
  /** Bulk loss, seconds. */
  rippleDecay: number
  /** Seconds before a ripple is retired from the array. */
  rippleLife: number
  /** How far the ripple drags the DOM's UV with it. 0 keeps text crisp. */
  rippleInk: number
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

/**
 * A rounded rect sharing the panel's plane, unioned into its field.
 *
 * This is what makes a panel a LAYOUT rather than a card: two of these that
 * start coincident and then move apart *melt* into two panes, because the
 * union of two distances necks and snaps where the union of two meshes would
 * only have stopped overlapping. Same mutable-in-place contract as GlassBlob.
 */
export interface GlassRect {
  /** Centre in panel-local world units — (0,0) is the panel's centre. */
  x: number
  y: number
  /** Half extents. */
  hw: number
  hh: number
  /** Corner radius. */
  r: number
}

/**
 * A wave packet expanding across the panel's surface from where a satellite
 * made or broke contact. `t0` is a clock timestamp; the compositor turns it
 * into an age, so the shader needs no time uniform of its own.
 */
export interface GlassRipple {
  x: number
  y: number
  t0: number
  /** Signed: negative recoils the surface, which is what a release does. */
  amp: number
}

/** How many circular satellites one panel may carry — matches the define. */
export const MAX_BLOBS = 6
/** How many rounded-rect satellites — matches the define. */
export const MAX_RECTS = 12
/**
 * Concurrent ripples per panel — must match the shader define. Six because a
 * staggered emergence (lab 013: five thread rows welling out of the rail one
 * after another) overlaps that many wave trains before the first has died.
 */
export const MAX_RIPPLES = 6

/**
 * The panel's rounded-rect distance, in JS. The same function the shader
 * evaluates per pixel — here it runs three times a frame, to answer "has
 * this bead touched yet". Contact detection belongs on the CPU: it is a
 * sign change over time, and a fragment shader has no memory of last frame.
 */
export function sdRoundRect(px: number, py: number, bx: number, by: number, r: number) {
  const dx = Math.abs(px) - bx + r
  const dy = Math.abs(py) - by + r
  return (
    Math.min(Math.max(dx, dy), 0) +
    Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) -
    r
  )
}

/** Its gradient — the outward direction, for placing the contact point. */
export function sdRoundRectGrad(px: number, py: number, bx: number, by: number, r: number) {
  const sx = Math.sign(px) || 1
  const sy = Math.sign(py) || 1
  const dx = Math.abs(px) - bx + r
  const dy = Math.abs(py) - by + r
  if (dx > 0 && dy > 0) {
    const l = Math.hypot(dx, dy) || 1
    return [(sx * dx) / l, (sy * dy) / l] as const
  }
  return dx > dy ? ([sx, 0] as const) : ([0, sy] as const)
}

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
  // Ripples. `rippleK` is the only scale knob: the train is self-similar
  // along r ~ t^(2/3), so raising K makes the whole pattern finer AND slower
  // together, the way a real change in surface tension would. `rippleNu`
  // decides how far the fine leading waves get before viscosity eats them —
  // it is the difference between water and syrup.
  rippleAmp: 1.1,
  rippleK: 3.0,
  rippleNu: 0.0018,
  rippleSource: 0.04,
  rippleDecay: 1.2,
  rippleLife: 1.8,
  rippleInk: 0,
}

interface SdfPanel {
  label: string
  group: React.RefObject<THREE.Group | null>
  half: THREE.Vector2
  /** Where the DOM lands, in panel-local units: [cx, cy, hw, hh]. */
  inkRect: THREE.Vector4
  hasBase: boolean
  params: GlassParams
  blobs: GlassBlob[]
  rects: GlassRect[]
  ripples: GlassRipple[]
  /** View-space z, refreshed each frame; the compositing order key. */
  depth: number
}

const sdfPanels = new Map<string, SdfPanel>()
// Separate from the panel entry on purpose: React runs child effects before
// parent ones, so the registrar inside `SurfaceApp` cannot write into a
// record its own parent has not created yet. Keyed by label, joined at
// composite time.
const sdfInk = new Map<string, THREE.Texture>()
// Dev handle: `__glassInk.get('lab013-rail').image` is the parking canvas the
// compositor is sampling, which is the only way to tell a UV bug apart from a
// rasterization bug from the outside.
;(window as unknown as { __glassInk: typeof sdfInk }).__glassInk = sdfInk

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
  /**
   * CSS px; divided by `px` for world units. This is the DOM's size and the
   * raycast quad's size — and, unless `hasBase` is false, the field's base
   * rounded rect too.
   */
  width: number
  height: number
  px: number
  params?: Partial<GlassParams>
  /**
   * false = the base rect is NOT in the distance field; the panel's shape is
   * whatever its satellites are. The rect still frames the DOM and still
   * catches rays, so a panel can be a column of separate glass bubbles that
   * share one texture and one pointer target.
   */
  hasBase?: boolean
  /**
   * Coplanar circles merged into this panel's glass. Pass a STABLE array and
   * mutate its members per frame — see `BlobDrift` in Lab012.
   */
  blobs?: GlassBlob[]
  /** Coplanar rounded rects, same stable-array-mutated-in-place contract. */
  rects?: GlassRect[]
  /** Contact ripples, same contract. */
  ripples?: GlassRipple[]
  /** Passed through to the Surface — 'content' gates rays on painted pixels. */
  hitTest?: 'plane' | 'content'
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
  hasBase = true,
  blobs,
  rects,
  ripples,
  hitTest,
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
      inkRect: new THREE.Vector4(0, 0, width / px / 2, height / px / 2),
      hasBase,
      params: live,
      blobs: blobs ?? [],
      rects: rects ?? [],
      ripples: ripples ?? [],
      depth: 0,
    })
    return () => {
      sdfPanels.delete(label)
    }
  }, [label, width, height, px, hasBase, live, blobs, rects, ripples])

  return (
    <group ref={group} position={position} rotation={rotation}>
      <SurfaceApp
        label={label}
        width={width}
        height={height}
        material="none"
        hitTest={hitTest}
        content={content}
      >
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
        defines: { SAMPLES: 8, MAX_BLOBS, MAX_RECTS, MAX_RIPPLES },
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tSrc: { value: null },
          tDepth: { value: null },
          tInk: { value: null },
          uHasInk: { value: false },
          uInkOpacity: { value: 1 },
          uInkRect: { value: new THREE.Vector4(0, 0, 1, 1) },
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
          uHasBase: { value: true },
          // Allocated full-length once: three uploads a vec3[] as one
          // uniform3fv, so the array must keep its size even when the panel
          // carries fewer blobs — uBlobCount is what bounds the loop.
          uBlobs: { value: Array.from({ length: MAX_BLOBS }, () => new THREE.Vector3()) },
          uBlobCount: { value: 0 },
          uRects: { value: Array.from({ length: MAX_RECTS }, () => new THREE.Vector4()) },
          uRectR: { value: new Array(MAX_RECTS).fill(0) as number[] },
          uRectCount: { value: 0 },
          uSmooth: { value: 0.14 },
          uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4()) },
          uRippleCount: { value: 0 },
          uRippleK: { value: 3.0 },
          uRippleNu: { value: 0.0018 },
          uRippleSrc: { value: 0.04 },
          uRippleDecay: { value: 0.9 },
          uRippleInk: { value: 0 },
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

  useFrame(({ gl, scene, camera, clock }) => {
    const panels = [...sdfPanels.values()].filter((p) => p.group.current)
    const now = clock.elapsedTime

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
    //
    // The key is VIEW-SPACE Z, not distance to the camera. Distance was wrong
    // and lab 012 never noticed, because its two panels sat on the view axis
    // where the two orders agree. Put a panel out to the side — lab 013's
    // rail, one sixth of the way across a wide app — and it is FARTHER by
    // Pythagoras while being no deeper at all, so it composited first and the
    // panel actually behind it then refracted its ink: every glyph in the
    // rail came out smeared through eight dispersion taps, with no error and
    // clean paint counters. Depth order is depth, and depth is -z in view
    // space (negative ahead of the camera, so "more negative" is farther).
    for (const p of panels) {
      p.group.current!.getWorldPosition(tmpPos).applyMatrix4(camera.matrixWorldInverse)
      p.depth = tmpPos.z
    }
    panels.sort((a, b) => a.depth - b.depth)

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
      u.uHasBase.value = p.hasBase
      u.uInkRect.value.copy(p.inkRect)
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
      const rects = p.rects
      const nq = Math.min(rects.length, MAX_RECTS)
      const rectSlots = u.uRects.value as THREE.Vector4[]
      const radii = u.uRectR.value as number[]
      for (let i = 0; i < nq; i++) {
        const r = rects[i]
        rectSlots[i].set(r.x, r.y, r.hw, r.hh)
        // A corner radius may never exceed the smaller half extent, or
        // sdRoundRect stops being a distance and the bezel inverts. Clamping
        // here rather than in every caller means a rect can be animated from
        // a wide pane down to a bead without the scene minding the geometry.
        radii[i] = Math.min(r.r, Math.min(r.hw, r.hh))
      }
      u.uRectCount.value = nq

      // Ages, not timestamps: the shader gets `now - t0` so it needs no clock
      // of its own, and a ripple that has outlived `rippleLife` simply never
      // reaches the uniform (the emitter prunes it too — this is the guard).
      u.uRippleK.value = Math.max(q.rippleK, 1e-3)
      u.uRippleNu.value = Math.max(q.rippleNu, 0)
      u.uRippleSrc.value = Math.max(q.rippleSource, 0)
      u.uRippleDecay.value = Math.max(q.rippleDecay, 1e-3)
      u.uRippleInk.value = q.rippleInk
      let nr = 0
      if (q.rippleAmp > 0) {
        const slots = u.uRipples.value as THREE.Vector4[]
        for (const rp of p.ripples) {
          if (nr >= MAX_RIPPLES) break
          const age = now - rp.t0
          if (age < 0 || age > q.rippleLife) continue
          slots[nr++].set(rp.x, rp.y, age, rp.amp * q.rippleAmp)
        }
      }
      u.uRippleCount.value = nr

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
