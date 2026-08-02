import { use, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeElements, type ThreeEvent } from '@react-three/fiber'
import { createDomTextureSource, type DomTextureSource } from '../lib/htmlInCanvas'
import { DEFAULT_TIERS, clampTiers, selectLodTier, tiersInRange } from '../lib/lodTier'
import {
  clearPointerState,
  deepestElementAt,
  forwardPointer,
  nudgeSelect,
  silenceHoverMove,
  trackDrag,
  trackFocusModality,
  trackWheel,
} from './forwardEvents'
import { FocusGroupContext } from './focusContext'
import { SurfaceContext, type SurfaceContextValue } from './SurfaceContext'
import { useLatest } from './useLatest'

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

// `material` is omitted from the mesh props because Surface owns the material
// slot — the prop below redefines it as a mode, not an instance.
export interface SurfaceProps extends Omit<ThreeElements['mesh'], 'children' | 'material'> {
  html: string
  /** Name for this surface in paint-stats diagnostics (window.__threeUI). */
  label?: string
  /** DOM pixel size of the source subtree (drives texture resolution). */
  width?: number
  height?: number
  children: React.ReactNode
  /** Fires when focus enters/leaves the live subtree. Always the latest one. */
  onFocusWithin?: (focused: boolean) => void
  /**
   * Access the live DOM root — attach listeners, mount a React root into it,
   * mutate it. May return a cleanup function.
   *
   * This is a LIFECYCLE hook: called once when the source is created, cleaned
   * up when it is destroyed, and at no other time. Its identity is
   * deliberately untracked, because re-running it would mean tearing the
   * subtree down and taking every bit of live DOM state with it. So an inline
   * arrow costs nothing here, and a caller who needs current state inside it
   * should reach for a ref rather than expect a re-run.
   */
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
   * Texture density policy, shaped like r3f's `dpr`:
   *
   * - `'auto'` (default) — dynamic LOD over the full tier ladder
   *   (0.25–6×): the texture is re-rasterized (a true vector replay, not
   *   an upscale) whenever the surface's projected screen size crosses a
   *   tier boundary — approach a panel and its glyphs sharpen; back away
   *   and memory is returned. Tier selection has hysteresis and a
   *   two-evaluation debounce, so an orbiting camera can't thrash
   *   resizes. Idle cost is ~zero; a committed swap costs one paint +
   *   one GL realloc + one upload.
   * - `[min, max]` — dynamic LOD constrained to the inclusive range:
   *   `[1, 6]` never lets text drop below 1:1 (kiosk/hero panels),
   *   `[0.25, 2]` caps memory in panel-heavy scenes, `[1, Infinity]`
   *   sets a floor with no ceiling. Same machinery, sliced ladder.
   * - `number` — pins texels-per-CSS-px (1 = legacy behavior, 2 = fixed
   *   retina). No LOD evaluations run.
   *
   * Every form still respects the 4096px long-edge texture guard.
   */
  resolution?: 'auto' | number | [min: number, max: number]
  side?: THREE.Side
  roughness?: number
  metalness?: number
  /**
   * Honor the texture's alpha. Off by default (a panel is a solid slab).
   * On for overlay Surfaces — a floating layer's source paints only its
   * popover/menu/dialog and leaves the rest of the subtree unpainted, so
   * the slab shows the scene through everywhere the DOM drew nothing.
   */
  transparent?: boolean
  /**
   * What the raycaster is allowed to hit.
   *
   * - `'plane'` (default) — the whole quad. A panel is a solid slab.
   * - `'content'` — only where the source DOM accepts the pointer. The slab
   *   becomes glass: rays pass through the clear parts and reach whatever
   *   stands behind it, and the surface never reports a hover it did not get.
   *
   * `'content'` is what makes a floating layer possible. Its slab is full
   * panel size and stands in front of the panel it belongs to, so with
   * `'plane'` the moment a popover opened the layer caught every ray, the
   * panel behind went dead, and — hearing `pointerOut` — dismissed the very
   * thing that had just opened.
   *
   * The declaration lives in CSS, where it already does on a 2D page: the
   * portal container sets `pointer-events: none` and its content sets `auto`.
   * `'content'` also makes the surface's own root transparent, since a bare
   * full-size container is scaffolding, not a thing to touch.
   */
  hitTest?: 'plane' | 'content'
  /**
   * Who owns the mesh's material.
   *
   * - `'standard'` (default) — Surface renders its own `MeshStandardMaterial`
   *   with the DOM texture as its map, and handles the late-texture
   *   needsUpdate bump itself.
   * - `'none'` — Surface renders no material; the children supply one, and
   *   read the texture through `useSurfaceTexture()`. This is the shader
   *   seam: a custom `ShaderMaterial` sampling the live DOM can do to the
   *   pixels what no CSS can — dissolve, refract, aberrate — while every
   *   other Surface contract (paint-driven uploads, LOD re-rasters, input
   *   forwarding) keeps working underneath it, because they act on the
   *   texture and the mesh, not on the material.
   */
  material?: 'standard' | 'none'
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

// Horizontal flip, for geometries whose UVs run backwards under the camera
// (the inside of a cylinder, a back face). Wrapping has to become Repeat for
// a negative repeat to have anything to wrap into.
function applyMirror(tex: THREE.Texture, mirrorU: boolean) {
  tex.wrapS = mirrorU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  tex.repeat.x = mirrorU ? -1 : 1
}

// Mount seed for dynamic LOD: the ladder tier nearest 1×. Normally exactly
// 1, but a range like [2, 4] seeds at 2 so the very first raster is already
// in-range, and a Surface so wide the 4096 guard removed tier 1 seeds at
// its clamped floor instead of transiently allocating an oversize canvas.
function seedTier(ladder: readonly number[]): number {
  let best = ladder[0]
  for (const t of ladder) if (Math.abs(t - 1) < Math.abs(best - 1)) best = t
  return best
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
  transparent = false,
  hitTest = 'plane',
  material = 'standard',
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
  // Everything the source-creation effect needs to READ but must not RE-RUN
  // for. See that effect's dependency note — it is the most consequential
  // line in this file.
  const resolutionRef = useLatest(resolution)
  const hitTestRef = useLatest(hitTest)
  const mirrorURef = useLatest(mirrorU)
  const widthRef = useLatest(width)
  const heightRef = useLatest(height)
  const onSourceRef = useLatest(onSource)
  const onFocusWithinRef = useLatest(onFocusWithin)

  /**
   * The hit region. With `hitTest="content"` the quad is only intersected
   * where the source DOM accepts the pointer — a ray through the clear part of
   * a floating layer carries on to the panel behind, exactly as it would pass
   * through a `pointer-events: none` container on a 2D page.
   *
   * Declining here rather than inside the handlers is the whole point: an
   * intersection r3f never sees is one it never counts as a hover, so the
   * surface behind keeps the pointer instead of being told it lost it.
   *
   * Installed unconditionally and branching on a ref, never swapped out for
   * `undefined`: r3f assigns props onto the instance, and handing back
   * undefined does not restore the class default, it leaves the last function
   * attached — the mesh would stay permanently un-hittable.
   */
  const raycast = useMemo<THREE.Object3D['raycast']>(
    () =>
      function (this: THREE.Mesh, raycaster, intersects) {
        if (hitTestRef.current !== 'content') {
          THREE.Mesh.prototype.raycast.call(this, raycaster, intersects)
          return
        }
        const el = sourceRef.current?.element
        if (!el) return
        const hits: THREE.Intersection[] = []
        THREE.Mesh.prototype.raycast.call(this, raycaster, hits)
        const rect = el.getBoundingClientRect()
        for (const hit of hits) {
          if (!hit.uv) continue
          const u = mirrorURef.current ? 1 - hit.uv.x : hit.uv.x
          const x = rect.left + u * rect.width
          const y = rect.top + (1 - hit.uv.y) * rect.height
          if (deepestElementAt(el, x, y)) intersects.push(hit)
        }
      },
    // Stable ref identities — this memo never actually re-runs.
    [hitTestRef, mirrorURef],
  )
  // Destructure the tuple into primitives so an inline `resolution={[1, 2]}`
  // (fresh array identity every render) can't defeat the memo.
  const [rangeMin, rangeMax] = Array.isArray(resolution)
    ? resolution
    : ([null, null] as const)
  const tiers = useMemo(() => {
    const ladder =
      rangeMin !== null && rangeMax !== null
        ? tiersInRange(DEFAULT_TIERS, rangeMin, rangeMax)
        : DEFAULT_TIERS
    return clampTiers(ladder, width, height)
  }, [width, height, rangeMin, rangeMax])
  const tiersRef = useLatest(tiers)
  const lodRef = useRef({ tier: 1, proposed: 1, agree: 0, frame: 0 })
  const lodPhase = useMemo(() => lodSeq++ % LOD_EVERY, [])

  const context = useMemo<SurfaceContextValue>(
    () => ({ mesh: meshRef, source: sourceEl, width, height, mirrorU, texture }),
    [sourceEl, width, height, mirrorU, texture],
  )

  // Inside a FocusGroup, this Surface is a composite focus member: its
  // source root becomes the group's unit element and its interior is
  // browser-traversed DOM (docs/focus.md). Outside one, nothing changes.
  const focusGroup = use(FocusGroupContext)
  useEffect(() => {
    if (!focusGroup || !sourceEl) return
    return focusGroup.registerComposite({
      root: sourceEl,
      object: meshRef.current,
      label,
    })
  }, [focusGroup, sourceEl, label])

  // A Surface mounted after the scene's first frame compiles its material
  // BEFORE the texture exists; three.js won't recompile the program when
  // .map is later assigned (program choice is keyed on material.version).
  // Without this bump the surface stays blank white forever.
  useEffect(() => {
    if (texture && materialRef.current) materialRef.current.needsUpdate = true
  }, [texture])

  // The document-level half of the focus-modality mirror (see forwardEvents).
  // Reference-counted — any number of Surfaces share one set of listeners.
  useEffect(() => trackFocusModality(), [])
  // Wheel arbitration lives at document capture — the only seat ahead of
  // OrbitControls' canvas listener. See forwardEvents' wheel section.
  useEffect(() => trackWheel(), [])
  // Drag arbitration — while a forwarded press is live, trusted canvas moves
  // are defaultPrevented so drag consumers hear only the forwarded narrator
  // (decisions #32).
  useEffect(() => trackDrag(), [])

  // Creating the source is a TEARDOWN. It destroys the live DOM subtree and
  // with it everything that was alive in there: focus, form values, text
  // selection, scroll offsets, and any second React root a scene mounted
  // inside. So the dependency list below is the most consequential line in
  // this file, and a prop belongs in it only if changing that prop genuinely
  // means "this is different content now". Everything else is handled in
  // place, and each of these was learned the same way — by watching a
  // Surface go dead mid-interaction:
  //
  //   width/height  → re-layout in place (the setSize effect below)
  //   resolution    → re-raster in place (the setScale effect below)
  //   mirrorU       → a texture wrap setting (the mirror effect below)
  //   paint         → read only inside useFrame; there is nothing to rebuild
  //   hitTest       → read through a ref by the raycaster
  //   onFocusWithin → called through a ref, so the listeners stay current
  //   onSource      → a lifecycle hook by contract (see its prop doc)
  //   label         → baked into the stats entry at creation; birth-only
  //
  // `html` is the one real dependency: new markup IS different content, and
  // rebuilding is the only way to be sure nothing from the old tree — a
  // listener a scene attached in `onSource`, say — survives into it.
  useEffect(() => {
    const source = createDomTextureSource(html, widthRef.current, heightRef.current, {
      label,
      // Fixed resolution starts at its final scale; auto/range starts at
      // the ladder tier nearest 1× and lets the first LOD evaluations
      // settle it (~2 cheap re-rasters max).
      scale:
        typeof resolutionRef.current === 'number'
          ? resolutionRef.current
          : seedTier(tiersRef.current),
      onError: (err) => console.warn('[three-ui] Surface paint failed:', err),
    })
    sourceRef.current = source
    setSourceEl(source.element)
    lodRef.current = { tier: source.scale(), proposed: source.scale(), agree: 0, frame: 0 }

    const tex = new THREE.CanvasTexture(source.canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    applyFilterPolicy(tex, source.scale())
    // Set at birth as well as in the effect below: that effect is passive and
    // r3f draws from its own rAF loop, so a mirrored Surface would otherwise
    // get one frame of backwards text before the flip lands.
    applyMirror(tex, mirrorURef.current)
    setTexture(tex)

    lastUploadRef.current = -1
    extraUploadsRef.current = 0
    reallocAfterRef.current = -1

    // A content-hit-tested surface is clear glass by default: the root is a
    // bare container the scene put content into, not a thing to touch. What is
    // inside declares its own. (createDomTextureSource sets 'auto' here to
    // re-root the cascade out of the parking canvas — this is the override,
    // and it lands before onSource so a scene can still have the last word.)
    if (hitTestRef.current === 'content') source.element.style.pointerEvents = 'none'

    const focusIn = () => onFocusWithinRef.current?.(true)
    const focusOut = () => onFocusWithinRef.current?.(false)
    source.element.addEventListener('focusin', focusIn)
    source.element.addEventListener('focusout', focusOut)
    const cleanupSource = onSourceRef.current?.(source.element)

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
  }, [html])

  // Mirroring is a texture setting, not a reason to rebuild anything.
  useEffect(() => {
    if (!texture) return
    applyMirror(texture, mirrorU)
    texture.needsUpdate = true
  }, [texture, mirrorU])

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

  // Size changes re-LAYOUT in place, for the same reason resolution re-rasters
  // in place: `width`/`height` used to sit in the creation effect's deps, so
  // resizing a Surface tore its source down and built a new one — and with it
  // went focus, form values, selection, and any second React root mounted
  // inside. A Surface whose size is *measured* rather than authored resizes
  // constantly, so that had to stop being a teardown.
  //
  // The realloc mark is the same one setScale uses: three allocates
  // CanvasTexture storage immutably at first-upload dimensions, so any change
  // to the backing store needs a dispose on the first upload after the
  // post-resize paint lands (decisions #10).
  useEffect(() => {
    const source = sourceRef.current
    if (!source || !texture) return
    const [prevW, prevH] = source.size()
    source.setSize(width, height)
    const [nextW, nextH] = source.size()
    if (nextW !== prevW || nextH !== prevH) reallocAfterRef.current = source.paintCount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, texture])

  useFrame(() => {
    const source = sourceRef.current
    if (!source || !texture) return
    // Dynamic LOD: every LOD_EVERY-th frame (phase-offset per instance),
    // compare projected screen density — device px per CSS px — against the
    // current tier; setScale re-rasters through the normal onpaint path, so
    // the upload below picks it up like any other content change.
    if ((resolution === 'auto' || Array.isArray(resolution)) && meshRef.current) {
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
    // ...and stop the REAL event at the canvas, so document-level listeners
    // see only the forwarded one.
    //
    // Every pointer that reaches a texture arrives as a native event whose
    // target is the <canvas> — which is outside every portaled layer in the
    // document. Libraries that detect outside-interaction that way (Radix's
    // DismissableLayer, and every menu/popover/dialog built on it) therefore
    // dismiss on *any* click into a Surface, including clicks that landed on
    // their own content. Measured: two pointerdowns arrive at document, the
    // trusted one targeting CANVAS and the synthetic one targeting the real
    // button; the canvas event fires first and closes the popover.
    //
    // Suppressing the canvas event is not a workaround for Radix — it is the
    // truth. The canvas is how the pointer travelled, not what it hit. Only
    // pointerdown is suppressed: OrbitControls registers document-level move
    // and up listeners for the duration of a drag, and silencing those would
    // strand a drag that began on empty space and ended over a panel.
    e.nativeEvent.stopPropagation()
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
    const hit = forwardPointer(source.element, uv.u, uv.v, 'up')
    if (hit?.target instanceof HTMLSelectElement) nudgeSelect(hit.target)
  }

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    // Topmost Surface under the pointer owns it (DOM semantics). Also keeps
    // bubbled child-layer events — which carry the CHILD's UV — from being
    // misread as coordinates on this surface.
    e.stopPropagation()
    const uv = uvOf(e)
    const source = sourceRef.current
    if (!uv || !source) return
    // Real buttons state rides along: a drag consumer deactivates on the
    // first move that claims no button is held (decisions #32).
    forwardPointer(source.element, uv.u, uv.v, 'move', e.nativeEvent.buttons)
    // The forwarded move above is this pointer's true story; the native one —
    // target CANVAS, screen coordinates — must not also reach document-level
    // coordinate reasoners (Radix's tooltip grace tracker dismisses on it).
    // Hover only: drag moves keep bubbling for OrbitControls (decisions #26)
    // — trackDrag neutralizes them for parked drag consumers by
    // preventDefault instead, which leaves the bubble intact.
    silenceHoverMove(e.nativeEvent)
  }

  return (
    <mesh
      ref={meshRef}
      raycast={raycast}
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
      {material === 'standard' && (
        <meshStandardMaterial
          ref={materialRef}
          map={texture ?? undefined}
          color={texture ? '#ffffff' : '#1e293b'}
          roughness={roughness}
          metalness={metalness}
          side={side}
          transparent={transparent}
        />
      )}
    </mesh>
  )
}
