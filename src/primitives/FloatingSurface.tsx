import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ThreeElements } from '@react-three/fiber'
import { Surface } from './Surface'

// <FloatingSurface> — a portal target that is its own object in the scene.
//
// The anchored floating layer (lab 009 inc 2) works by coincidence: its canvas
// is the same size and origin as the panel's, so the page coordinates a
// positioner computes are *already* panel-local and the popover lands in the
// right place with no math. That is exactly why it can only ever be a decal on
// the panel it belongs to. Everything it holds is pinned to one plane.
//
// This gives the coincidence up. The content is detached from its trigger — the
// container revokes the positioner's placement (`.ui-detached` in ui.css) so the
// content falls to its canvas's origin, the canvas is resized to hug it, and
// where the thing actually *goes* is then an ordinary matter of where you put
// the mesh. A popover can stand a foot in front of its card, orbit with the
// scene, or hang off the eye.
//
// The two facts this is built on were measured, not assumed (2026-07-31):
//
//  - Zeroing the wrapper's transform lands the content at the source canvas's
//    origin AND it still rasterizes there — a layoutSubtree canvas is the
//    containing block for `position: fixed` descendants (docs/platform.md), and
//    the move is a paint-record change, so upload-on-paint carries it for free.
//  - The content must be measured with `offsetWidth`/`offsetHeight`, never
//    `getBoundingClientRect()`. At entrance frame 0 the rect read 273.6×115.9
//    against a layout box of 288×122 — `zoom-in-95` and `slide-in-from-top-2`,
//    baked straight into the canvas size. The layout box ignores transforms;
//    the visual rect is exactly the thing that must not be trusted here.

export interface FloatingSurfaceProps
  extends Omit<ThreeElements['group'], 'children' | 'ref'> {
  /**
   * Receives the portal container once it exists, and `null` on unmount. Aim a
   * Radix `container` prop (or any portal target) at it.
   */
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
 * simplification is *bought* by the pinning; it would be wrong for an anchored
 * layer, where children sit at computed offsets.
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

  // One stable container for this surface's whole life: consumers portal into
  // it, the Surface rasterizes it. `.ui-detached` revokes positioner placement;
  // `.ui-layer` supplies the transparent typography root and the
  // clear-to-the-pointer container idiom.
  const host = useMemo(() => {
    const el = document.createElement('div')
    el.className = 'ui-layer ui-detached'
    return el
  }, [])

  const mount = useCallback(
    (el: HTMLElement) => {
      el.appendChild(host)
      onHost?.(host)
      return () => {
        onHost?.(null)
        host.remove()
      }
    },
    [host, onHost],
  )

  // What is in the layer, and how big is it?
  //
  // Two different questions with two different signals, and both are needed.
  // `childList` catches mount and unmount — the moments a popover opens and
  // closes — and fires at no other time. A ResizeObserver catches the content
  // changing size while it stays mounted (a menu filtering itself down, a
  // popover whose text reflows), which childList cannot see at all.
  //
  // This is not the MutationObserver the house rules ban. That prohibition is
  // about Surface's PAINT path, where `onpaint` is already a better change
  // signal than any observer. Neither of these decides when to repaint; they
  // decide what exists and how large it is, which the compositor never reports.
  useEffect(() => {
    const sync = () => {
      const [w, h] = measureContent(host)

      // Declare the host's size in the same breath as measuring it, rather
      // than in a downstream effect. The drawn root must carry explicit pixel
      // dimensions — that is the house rule every Surface content root follows
      // — and here it is not negotiable: everything in a detached layer is
      // `position: fixed`, so it is out of flow and contributes NOTHING to the
      // host's height. Left to layout, the host measures zero and
      // drawElementImage rasterizes an empty box. (Measured 2026-07-31: the
      // canvas reported 21 clean paints and every pixel of it was transparent.)
      // So the size is a declaration for the rasterizer, not a consequence of
      // layout, and it belongs wherever the number is known.
      if (w > 0 && h > 0) {
        host.style.width = `${w}px`
        host.style.height = `${h}px`
      }

      setSize((prev) => {
        const next: [number, number] | null = w > 0 && h > 0 ? [w, h] : null
        if (prev === next) return prev
        if (prev && next && prev[0] === next[0] && prev[1] === next[1]) return prev
        return next
      })
    }

    const ro = new ResizeObserver(sync)
    const mo = new MutationObserver(() => {
      ro.disconnect()
      for (const child of host.children) ro.observe(child)
      sync()
    })
    mo.observe(host, { childList: true })
    for (const child of host.children) ro.observe(child)
    sync()

    return () => {
      mo.disconnect()
      ro.disconnect()
    }
  }, [host])

  // Hold the last real size through an unmount so the Surface keeps a valid
  // canvas instead of collapsing to 1×1 (and re-allocating on the next open).
  const lastSize = useRef<[number, number]>([1, 1])
  if (size) lastSize.current = size
  const [w, h] = size ?? lastSize.current

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
