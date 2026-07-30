import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeElements, type ThreeEvent } from '@react-three/fiber'
import { createDomTextureSource, type DomTextureSource } from '../lib/htmlInCanvas'
import { DEFAULT_TIERS, clampTiers, selectLodTier } from '../lib/lodTier'
import { clearPointerState, forwardPointer, nudgeSelect } from './forwardEvents'
import { SurfaceContext, type SurfaceContextValue } from './SurfaceContext'

// <Surface> — the atom of three-ui: a live DOM subtree as the skin of any
// geometry. Pass geometry as children; the DOM is rasterized into the
// material's map every frame, and pointer events on the mesh are forwarded
// back into the DOM via the intersection's UV coordinates.
//
// Because the DOM is real: :focus styles show up in the texture, form state
// is real state, the accessibility tree is intact, and once a field is
// focused the browser types into it natively — no key forwarding. :hover and
// :active are the exception — real hit-testing never reaches the parked
// subtree — so forwardEvents mirrors them as data-hover/data-active
// attributes; author CSS with both selectors.

export interface SurfaceProps extends Omit<ThreeElements['mesh'], 'children'> {
  html: string
  /** Name for this surface in paint-stats diagnostics (window.__threeUI). */
  label?: string
  /** DOM pixel size of the source subtree (drives texture resolution). */
  width?: number
  height?: number
  children: React.ReactNode
  /** Fires when focus enters/leaves the live subtree. */
  onFocusWithin?: (focused: boolean) => void
  /** Access the live DOM root (attach listeners, mutate). May return cleanup. */
  onSource?: (el: HTMLElement) => void | (() => void)
  /**
   * Texture upload policy. 'auto' (default) uploads only when the canvas
   * reports a real paint: the compositor fires onpaint by itself whenever
   * the subtree's paint record changes (mutations, transitions of any
   * duration, paint-property CSS animations, caret blink), so idle
   * Surfaces cost nothing and no observer or heuristic is involved.
   * 'always' requests + uploads every frame — escape hatch for content
   * that changes without paint-record updates (e.g. embedded media).
   * Platform limit either way: compositor-animated properties (opacity/
   * transform keyframes) never reach drawElementImage — animate paint
   * properties (color, background, box-shadow) instead.
   */
  paint?: 'auto' | 'always'
  /** Flip the texture horizontally (for concave/back-face geometries). */
  mirrorU?: boolean
  /**
   * Texture density policy. 'auto' (default) is dynamic LOD: the texture is
   * re-rasterized (a true vector replay, not an upscale) whenever the
   * surface's projected screen size crosses a tier boundary — approach a
   * panel and its glyphs sharpen; back away and memory is returned. Tier
   * selection has hysteresis and a two-evaluation debounce, so an orbiting
   * camera can't thrash resizes. A number pins texels-per-CSS-px (1 =
   * legacy behavior, 2 = fixed retina).
   */
  resolution?: 'auto' | number
  side?: THREE.Side
  roughness?: number
  metalness?: number
}

// LOD evaluations run every Nth frame, phase-offset per Surface so a scene
// of many panels spreads the (tiny) projection math and never re-rasters a
// cohort on the same frame.
const LOD_EVERY = 10
const LOD_AGREE = 2
let lodSeq = 0
const _camPos = new THREE.Vector3()
const _surfPos = new THREE.Vector3()
const _surfScale = new THREE.Vector3()

// GPU mipmaps sabotage text at reading range: trilinear blends in the
// box-filtered half-res mip whenever the footprint tips past 1:1, softening
// glyphs that the vector re-raster just paid to sharpen (measured: the
// no-mips A/B at true 1:1 density). The tier ladder already IS the mip
// chain — CPU-side, distance-driven — so mipmaps are redundant at reading
// tiers. Far tiers (≤0.5) keep them: there a panel is small/oblique, and
// trilinear + anisotropy tame minification shimmer the ladder can't
// (anisotropy is directional; the ladder isn't).
function applyFilterPolicy(tex: THREE.Texture, tier: number) {
  const mips = tier <= 0.5
  if (tex.generateMipmaps !== mips) {
    tex.generateMipmaps = mips
    tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
    tex.needsUpdate = true
  }
}

export function Surface({
  html,
  label,
  width = 640,
  height = 480,
  children,
  onFocusWithin,
  onSource,
  paint = 'auto',
  mirrorU = false,
  resolution = 'auto',
  side = THREE.FrontSide,
  roughness = 0.35,
  metalness = 0.05,
  ...meshProps
}: SurfaceProps) {
  const controls = useThree(
    (s) => s.controls as { enabled?: boolean } | null,
  )
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null)
  const [sourceEl, setSourceEl] = useState<HTMLElement | null>(null)
  const sourceRef = useRef<DomTextureSource | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial>(null)
  const pressedRef = useRef(false)
  const lastUploadRef = useRef(-1)
  const extraUploadsRef = useRef(0)
  // paintCount at the moment setScale resized the canvas; -1 = none pending.
  // The GL realloc below waits for the counter to move strictly PAST this
  // (onpaint can't interleave mid-rAF, so count > mark ⟺ the post-resize
  // paint itself has landed — not some same-frame unrelated self-paint).
  const reallocAfterRef = useRef(-1)
  const resolutionRef = useRef(resolution)
  resolutionRef.current = resolution
  const tiers = useMemo(() => clampTiers(DEFAULT_TIERS, width, height), [width, height])
  const lodRef = useRef({ tier: 1, proposed: 1, agree: 0, frame: 0 })
  const lodPhase = useMemo(() => lodSeq++ % LOD_EVERY, [])

  const context = useMemo<SurfaceContextValue>(
    () => ({ mesh: meshRef, source: sourceEl, width, height, mirrorU }),
    [sourceEl, width, height, mirrorU],
  )

  // A Surface mounted after the scene's first frame compiles its material
  // BEFORE the texture exists; three.js won't recompile the program when
  // .map is later assigned (program choice is keyed on material.version).
  // Without this bump the surface stays blank white forever.
  useEffect(() => {
    if (texture && materialRef.current) materialRef.current.needsUpdate = true
  }, [texture])

  useEffect(() => {
    const source = createDomTextureSource(html, width, height, {
      label,
      // Fixed resolution starts at its final scale; auto starts at 1 and
      // lets the first LOD evaluations settle it (~2 cheap re-rasters max).
      scale: typeof resolutionRef.current === 'number' ? resolutionRef.current : 1,
      onError: (err) => console.warn('[three-ui] Surface paint failed:', err),
    })
    sourceRef.current = source
    setSourceEl(source.element)
    lodRef.current = { tier: source.scale(), proposed: source.scale(), agree: 0, frame: 0 }

    const tex = new THREE.CanvasTexture(source.canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    applyFilterPolicy(tex, source.scale())
    if (mirrorU) {
      tex.wrapS = THREE.RepeatWrapping
      tex.repeat.x = -1
    }
    setTexture(tex)

    lastUploadRef.current = -1
    extraUploadsRef.current = 0
    reallocAfterRef.current = -1

    const focusIn = () => onFocusWithin?.(true)
    const focusOut = () => onFocusWithin?.(false)
    source.element.addEventListener('focusin', focusIn)
    source.element.addEventListener('focusout', focusOut)
    const cleanupSource = onSource?.(source.element)

    return () => {
      source.element.removeEventListener('focusin', focusIn)
      source.element.removeEventListener('focusout', focusOut)
      cleanupSource?.()
      tex.dispose()
      source.dispose()
      sourceRef.current = null
      setSourceEl(null)
      setTexture(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, width, height, mirrorU, paint])

  // Fixed-resolution changes re-raster in place — never recreate the source
  // (that would destroy live DOM state: focus, form values, selection).
  useEffect(() => {
    const source = sourceRef.current
    if (typeof resolution === 'number' && source) {
      const prev = source.scale()
      source.setScale(resolution)
      if (source.scale() !== prev) reallocAfterRef.current = source.paintCount()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution, texture])

  useFrame(() => {
    const source = sourceRef.current
    if (!source || !texture) return
    // Dynamic LOD: every LOD_EVERY-th frame (phase-offset per instance),
    // compare projected screen density — device px per CSS px — against the
    // current tier; setScale re-rasters through the normal onpaint path, so
    // the upload below picks it up like any other content change.
    if (resolution === 'auto' && meshRef.current) {
      const lod = lodRef.current
      if (lod.frame++ % LOD_EVERY === lodPhase) {
        const cam = camera as THREE.PerspectiveCamera
        const geom = meshRef.current.geometry
        if (cam.isPerspectiveCamera && geom) {
          if (!geom.boundingSphere) geom.computeBoundingSphere()
          const sphere = geom.boundingSphere
          if (sphere) {
            meshRef.current.getWorldPosition(_surfPos)
            meshRef.current.getWorldScale(_surfScale)
            cam.getWorldPosition(_camPos)
            const dist = Math.max(_camPos.distanceTo(_surfPos), 1e-3)
            const worldDiag =
              2 * sphere.radius * Math.max(_surfScale.x, _surfScale.y, _surfScale.z)
            const pxPerWorld =
              gl.domElement.height / (2 * dist * Math.tan((cam.fov * Math.PI) / 360))
            const density = (pxPerWorld * worldDiag) / Math.hypot(width, height)
            const proposal = selectLodTier(density, lod.tier, tiers)
            if (proposal === lod.tier) {
              lod.agree = 0
            } else if (proposal === lod.proposed) {
              if (++lod.agree >= LOD_AGREE) {
                lod.tier = proposal
                lod.agree = 0
                source.setScale(proposal)
                reallocAfterRef.current = source.paintCount()
              }
            } else {
              lod.proposed = proposal
              lod.agree = 1
            }
          }
        }
      }
    }
    // A committed setScale resized the canvas backing store. three allocates
    // GL texture storage immutably (texStorage2D) at FIRST-upload dimensions
    // and texSubImage2Ds every upload after — against a resized canvas, a
    // shrink lands the whole re-raster in one corner of the stale texture
    // (the LOD ghost) and a grow fails GL_INVALID_VALUE, silently keeping
    // the old texels. dispose() exactly once, on the first upload after the
    // post-resize paint has landed, so three reallocates at the new size —
    // never from the swap frame itself, where the canvas is still a cleared,
    // unpainted backing store. The filter policy rides the same moment: the
    // realloc picks its mip-level count from generateMipmaps at alloc time.
    const count = source.paintCount()
    if (reallocAfterRef.current >= 0 && count > reallocAfterRef.current && source.painted()) {
      texture.dispose()
      applyFilterPolicy(texture, source.scale())
      reallocAfterRef.current = -1
    }
    if (paint === 'always') {
      source.repaint()
      if (source.painted()) texture.needsUpdate = true
      lastUploadRef.current = count
      return
    }
    // Upload-on-paint: the compositor already tells us exactly when the
    // subtree's pixels changed (paintCount advances on its own — no
    // requestPaint loop, no MutationObserver). Idle Surfaces cost nothing;
    // the probe showed unconditional repainting caps an app at ~64 sources.
    // One extra upload after the counter stops covers the draw's deferred
    // resolve trailing the paint by up to a frame.
    if (count !== lastUploadRef.current) {
      lastUploadRef.current = count
      extraUploadsRef.current = 1
      if (source.painted()) texture.needsUpdate = true
    } else if (extraUploadsRef.current > 0) {
      extraUploadsRef.current -= 1
      if (source.painted()) texture.needsUpdate = true
    }
  })

  const uvOf = (e: ThreeEvent<PointerEvent>) => {
    if (!e.uv) return null
    const u = mirrorU ? 1 - e.uv.x : e.uv.x
    return { u, v: e.uv.y }
  }

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const uv = uvOf(e)
    const source = sourceRef.current
    if (!uv || !source) return
    pressedRef.current = true
    if (controls) controls.enabled = false
    forwardPointer(source.element, uv.u, uv.v, 'down')
  }

  const handleUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const uv = uvOf(e)
    const source = sourceRef.current
    if (controls) controls.enabled = true
    if (!uv || !source || !pressedRef.current) return
    pressedRef.current = false
    const { target } = forwardPointer(source.element, uv.u, uv.v, 'up')
    if (target instanceof HTMLSelectElement) nudgeSelect(target)
  }

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    // Topmost Surface under the pointer owns it (DOM semantics). Also keeps
    // bubbled child-layer events — which carry the CHILD's UV — from being
    // misread as coordinates on this surface.
    e.stopPropagation()
    const uv = uvOf(e)
    const source = sourceRef.current
    if (!uv || !source) return
    forwardPointer(source.element, uv.u, uv.v, 'move')
  }

  return (
    <mesh
      ref={meshRef}
      {...meshProps}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerMove={handleMove}
      onPointerOut={() => {
        pressedRef.current = false
        if (controls) controls.enabled = true
        // The ray left the mesh — un-hover/un-press the mirrored DOM state.
        const el = sourceRef.current?.element
        if (el) clearPointerState(el)
      }}
    >
      <SurfaceContext value={context}>{children}</SurfaceContext>
      <meshStandardMaterial
        ref={materialRef}
        map={texture ?? undefined}
        color={texture ? '#ffffff' : '#1e293b'}
        roughness={roughness}
        metalness={metalness}
        side={side}
      />
    </mesh>
  )
}
