import { useRef } from 'react'
import type { ReactNode } from 'react'
import type { Group, Mesh } from 'three'
import { Surface } from '../Surface'
import { useSourceHost } from '../useSourceHost'
import { useAnimationConductor } from '../useAnimationConductor'
import { useLatest } from '../useLatest'
import type { MotionValue } from '../../lib/motionSamples'

// <AnchoredSurface> — the floating family's first pose: in front of a panel.
//
// Give a panel one of these as a sibling in its group, aim its portals at
// `onHost`, and every menu, select and tooltip the panel opens becomes a
// second slab standing off it: its own shadow, its own specular, occluding
// the card from the side. Compare `ViewerSurface` (belongs to the eye) and
// `FloatingSurface` (belongs to the room).
//
// The thing that makes it nearly free is a coordinate coincidence that is not
// a coincidence at all. Every parked source canvas is `position: fixed` at
// (0,0), and positioners (Floating UI, and anything else worth using) place
// with `position: fixed` too. So a popover's page rect is ALREADY
// panel-local, as long as this layer is the same size as the panel and shares
// its origin — which is why `width`/`height` here are the *panel's*, not the
// content's. Radix's own positioning lands the content in exactly the right
// place with no projection, no unprojection, and no math from us
// (decisions #16).
//
// Three things it owns so consumers don't have to get them wrong:
//
//  - **Liveness is occupancy**, not any component's open state. Tying the
//    slab to one component meant a Select or Tooltip opened into a mesh
//    nobody drew, and any animation landing while the popover was shut
//    retired the slab out from under whatever else was showing. Occupancy is
//    also the only signal that keeps ports verbatim — per-component `open`
//    props would mean wrapping every one of them (decisions #20).
//  - **`hitTest="content"`**, which is not optional for a full-panel slab
//    standing in front of another Surface: with `'plane'` it catches every
//    ray from the frame it goes live, the panel behind hears `pointerOut`,
//    and dismisses the very thing that just opened (decisions #20).
//  - **The entrance flight belongs on the mesh.** shadcn asks for
//    `fade-in-0 zoom-in-95 slide-in-from-top-2` in Tailwind. Left alone those
//    keyframes cost a paint and a texture upload per frame and slide pixels
//    *within* the slab, clipping at its edge. The conductor reads the curve
//    out of the paused animation and this wears it on the mesh instead — two
//    uploads for a whole flight (decisions #17).

export interface AnchoredSurfaceProps {
  /**
   * Source size in CSS pixels — the PANEL's, not the content's. The
   * coincidence above is the whole mechanism, and it needs both slabs to
   * agree.
   */
  width: number
  height: number
  /** CSS pixels per world unit; must match the panel's. */
  px?: number
  /**
   * How far the layer stands off the panel along its normal. Big enough to
   * read as a separate slab without breaking the illusion that it belongs to
   * the card.
   */
  lift?: number
  /** Name for this surface in paint-stats diagnostics (window.__threeUI). */
  label?: string
  /** Receives the portal container; aim a Radix `container` prop at it. */
  onHost?: (el: HTMLElement | null) => void
  /**
   * Diagnostics: the pose the mesh just wore, once per frame of a flight.
   * The house pattern for browser-verifying motion — a probe can read the
   * flight back without racing the render loop.
   */
  onFlight?: (value: MotionValue, done: boolean) => void
  /** Extra scene content parented to the layer (SurfaceLayer, UVAnchor…). */
  children?: ReactNode
}

export function AnchoredSurface({
  width,
  height,
  px = 200,
  lift = 0.13,
  label = 'anchored',
  onHost,
  onFlight,
  children,
}: AnchoredSurfaceProps) {
  const layerGroup = useRef<Group>(null)
  const { mount, host, occupied } = useSourceHost({
    width,
    height,
    className: 'ui-layer',
    onHost,
  })

  // Where the flying content sits in the layer, in world units from the
  // layer's centre. Held across frames because the final call after a cancel
  // arrives with the element already unmounted.
  const pivot = useRef<[number, number]>([0, 0])
  const onFlightRef = useLatest(onFlight)

  useAnimationConductor(host, (v, done, el) => {
    const g = layerGroup.current
    if (!g) return

    // CSS scales about the content's own transform-origin, up near the
    // trigger. A group scales about its own origin, at the panel's centre —
    // so pivot-correct: p + (x − p)·s is the same as scaling about the origin
    // and translating by p·(1 − s).
    //
    // `getBoundingClientRect` is right HERE and wrong in `FloatingSurface`,
    // which warns against it in as many words — worth knowing before
    // "fixing" this to match. The visual rect bakes in the entrance transform,
    // which is exactly what ruins a size measurement. But the conductor has
    // already paused the animation and parked the DOM at its fully-materialized
    // pole, so during a flight this element is wearing no transform at all and
    // the visual rect IS the layout box. And it must be the *rect*: what's
    // wanted is a position within the panel, which `offsetLeft`/`offsetTop`
    // report against the offset parent rather than the source origin.
    if (el) {
      const rect = el.getBoundingClientRect()
      pivot.current = [
        (rect.left + rect.width / 2 - width / 2) / px,
        -(rect.top + rect.height / 2 - height / 2) / px,
      ]
    }
    const [pivotX, pivotY] = pivot.current

    g.scale.setScalar(v.scale)
    g.position.set(
      pivotX * (1 - v.scale) + v.x / px,
      pivotY * (1 - v.scale) - v.y / px, // DOM y grows down; world y grows up
      lift,
    )
    g.traverse((o) => {
      const mat = (o as Mesh).material
      if (mat && !Array.isArray(mat)) mat.opacity = v.opacity
    })

    // Nothing to retire when a flight lands. The mesh landing makes the
    // conductor call finish(), which fires animationend, which lets Radix's
    // Presence unmount the content — and that unmount is itself the childList
    // mutation that turns `occupied` off. Retiring the slab from here instead
    // was the bug: `done` arrives for entrances too.
    onFlightRef.current?.(v, done)
  })

  return (
    <group ref={layerGroup} position={[0, 0, lift]} visible={occupied}>
      <Surface
        label={label}
        width={width}
        height={height}
        html=""
        onSource={mount}
        transparent
        castShadow
        hitTest="content"
      >
        <planeGeometry args={[width / px, height / px]} />
        {children}
      </Surface>
    </group>
  )
}
