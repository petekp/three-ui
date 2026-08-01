import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ThreeElements } from '@react-three/fiber'
import { Surface } from '../Surface'
import { useSourceHost } from '../useSourceHost'

// <FloatingSurface> — the floating family's third pose: its own object.
//
// `AnchoredSurface` works by a coordinate coincidence: its canvas is the same
// size and origin as the panel's, so the page coordinates a positioner
// computes are *already* panel-local and the content lands correctly with no
// math. That is exactly why it can only ever be a decal on the panel it
// belongs to — everything it holds is pinned to one plane.
//
// This gives the coincidence up. The content is detached from its trigger:
// the container revokes the positioner's placement (`.ui-detached` in
// ui.css), so the content falls to its canvas's origin, the canvas is resized
// to hug it, and where the thing actually *goes* is then an ordinary matter
// of where you put the mesh. A popover can stand a foot in front of its card,
// orbit with the scene, or hang off the eye.
//
// Consumers still author `side` / `align` / `sideOffset` / `avoidCollisions`;
// those props are simply ignored once placement is revoked.
//
// Dismissal survives detachment for click-driven layers, and the reason is
// worth knowing before detaching anything else: pointer-down-outside is a
// *containment* question about the DOM tree, which detaching does not touch.
// A hover layer's grace polygon is a *geometric* question about the plane,
// which detaching destroys — so don't detach a tooltip yet (decisions #22).
//
// The two facts this is built on were measured, not assumed (2026-07-31):
//
//  - Zeroing the wrapper's transform lands the content at the source canvas's
//    origin AND it still rasterizes there — a layoutSubtree canvas is the
//    containing block for `position: fixed` descendants (docs/platform.md),
//    and the move is a paint-record change, so upload-on-paint carries it.
//  - The content must be measured with `offsetWidth`/`offsetHeight`, never
//    `getBoundingClientRect()`. At entrance frame 0 the rect read 273.6×115.9
//    against a layout box of 288×122 — `zoom-in-95` and `slide-in-from-top-2`,
//    baked straight into the canvas size. The layout box ignores transforms;
//    the visual rect is exactly the thing that must not be trusted here.

export interface FloatingSurfaceProps
  extends Omit<ThreeElements['group'], 'children' | 'ref'> {
  /** Receives the portal container; aim a Radix `container` prop at it. */
  onHost?: (el: HTMLElement | null) => void
  /** Name for this surface in paint-stats diagnostics (window.__threeUI). */
  label?: string
  /**
   * CSS pixels per world unit — the scale that turns a measured content box
   * into a quad. 200 is the house default.
   */
  px?: number
  /** Extra scene content parented to the surface (SurfaceLayer, UVAnchor…). */
  children?: ReactNode
}

/**
 * The size a detached layer's content occupies, in CSS pixels.
 *
 * Every child is pinned to the container's origin by the `.ui-detached` rule,
 * so the union of their boxes is just the largest of them — no offset
 * arithmetic, and none of it depending on where anything was positioned. That
 * simplification is *bought* by the pinning; it would be wrong for an
 * anchored layer, where children sit at computed offsets.
 */
function measureContent(host: HTMLElement): [number, number] {
  let w = 0
  let h = 0
  for (const child of host.children) {
    const el = child as HTMLElement
    // Layout box, not visual rect — see the header note on entrance transforms.
    if (el.offsetWidth > w) w = el.offsetWidth
    if (el.offsetHeight > h) h = el.offsetHeight
  }
  return [w, h]
}

export function FloatingSurface({
  onHost,
  label = 'floating',
  px = 200,
  children,
  ...groupProps
}: FloatingSurfaceProps) {
  // [width, height] in CSS px, or null when the layer holds nothing. Null is
  // the "not worth drawing" state — see the visibility note below.
  const [size, setSize] = useState<[number, number] | null>(null)

  // Hold the last real size through an unmount so the Surface keeps a valid
  // canvas instead of collapsing to 1×1 and re-allocating on the next open.
  const lastSize = useRef<[number, number]>([1, 1])
  if (size) lastSize.current = size
  const [w, h] = size ?? lastSize.current

  const measure = useCallback((host: HTMLElement) => {
    const [mw, mh] = measureContent(host)
    setSize((prev) => {
      if (mw <= 0 || mh <= 0) return null
      if (prev && prev[0] === mw && prev[1] === mh) return prev
      return [mw, mh]
    })
  }, [])

  // How big is the content?
  //
  // Two questions, two signals, both needed. `childList` catches mount and
  // unmount — the moments a popover opens and closes — and fires at no other
  // time. A ResizeObserver catches the content changing size while it stays
  // mounted (a menu filtering itself down, a popover whose text reflows),
  // which childList cannot see at all.
  //
  // The observer is built on the first childList callback rather than in an
  // effect of its own: `useSourceHost`'s effects are declared above this one
  // and therefore run first, so an effect here would arrive too late to
  // observe the children that were already there.
  const hostRef = useRef<HTMLElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  useEffect(() => () => roRef.current?.disconnect(), [])

  const { mount } = useSourceHost({
    width: w,
    height: h,
    className: 'ui-layer ui-detached',
    onHost,
    onChildList: (host) => {
      hostRef.current = host
      const ro = (roRef.current ??= new ResizeObserver(() => {
        if (hostRef.current) measure(hostRef.current)
      }))
      ro.disconnect()
      for (const child of host.children) ro.observe(child)
      measure(host)
    },
  })

  return (
    <group {...groupProps}>
      {/* Empty means invisible, not unmounted: tearing the Surface down would
          destroy the portal container mid-flight, and Radix's exit animation
          still has content to show. `hitTest="content"` already makes an empty
          layer inert to the raycaster, so this is purely about not drawing a
          transparent quad nobody can see. */}
      <group visible={size !== null}>
        <Surface
          label={label}
          width={w}
          height={h}
          html=""
          onSource={mount}
          transparent
          hitTest="content"
          castShadow
        >
          <planeGeometry args={[w / px, h / px]} />
          {children}
        </Surface>
      </group>
    </group>
  )
}
