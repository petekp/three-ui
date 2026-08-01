import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import type { ReactNode } from 'react'
import type { Camera, OrthographicCamera, PerspectiveCamera } from 'three'
import { Surface } from '../Surface'
import { useSourceHost } from '../useSourceHost'
import { CameraChrome } from './CameraChrome'

// <ViewerSurface> — the floating family's third pose: at the eye.
//
// A slab that hangs in front of the camera and spans the frustum exactly, so
// one source pixel lands on one screen pixel. Toasts and modals go here:
// they aren't attached to any object in the scene, they belong to whoever is
// looking. Compare `AnchoredSurface` (belongs to a panel) and
// `FloatingSurface` (belongs to the room).
//
// Two things make it work, and both are somebody else's rule doing the work:
//
//  - A `layoutSubtree` canvas is the CONTAINING BLOCK for `position: fixed`
//    descendants (docs/platform.md), so anything already written against the
//    viewport lands inside this slab with zero plumbing. sonner's `<Toaster>`
//    pins to its corners; Radix's `fixed inset-0` overlay fills it;
//    `top-50% left-50%` centres on it.
//  - `hitTest="content"` (decisions #20) is what makes a full-frustum quad
//    admissible at all. Without it the slab would catch every ray in the
//    scene and nothing behind it could ever be touched. Content-gated, it is
//    reachable exactly where the DOM painted something.
//
// That second point also settles what modality means here. Radix's modal
// lockout (`body { pointer-events: none }`) is a no-op inside a Surface — the
// forwarder runs its own geometric hit test and never consults the browser's.
// Nothing is lost, because when a modal IS open its scrim covers this slab
// and physically occludes the scene. On a page an overlay cannot really block
// anything, so CSS has to simulate obstruction; here the obstruction is real.
//
// There is deliberately no `width`/`height` prop. The slab does not have a
// size of its own — it IS the viewport, and the source is measured from the
// canvas for the same reason a page's `100vw` is not something you type in.
// This used to be a caller-supplied 1280×720 default while the quad spanned
// the frustum, and the two agreed only because the test window happened to be
// 1280×720 as well. Measured at 1000×800: the quad still followed the SOURCE
// aspect and came out 1422px wide inside a 1000px viewport, so a
// bottom-right-pinned toast landed at x=1184 — 184px past the right edge, on
// a slab whose height was exact. A knob that can only ever be set wrong is
// not a knob (decisions #23).

export interface ViewerSurfaceProps {
  /** World units in front of the eye. */
  distance?: number
  /** Name for this surface in paint-stats diagnostics (window.__threeUI). */
  label?: string
  /** Receives the portal container; aim a Radix `container` prop at it. */
  onHost?: (el: HTMLElement | null) => void
  /** A React tree the slab owns outright — a `<Toaster>`, a HUD. */
  content?: ReactNode
  /** Extra scene content parented to the slab (SurfaceLayer, UVAnchor…). */
  children?: ReactNode
}

/**
 * The frustum's cross-section at `distance`, in world units.
 *
 * The perspective arm takes its aspect from the canvas rather than from
 * `camera.aspect` on purpose: r3f writes that in a layout effect *after* the
 * render that observed the new size, so a memo reading it on resize gets the
 * previous frame's value and keeps it until some unrelated render happens by.
 * `size` is the thing r3f derives the aspect from anyway, so reading it
 * directly is both the earlier and the more honest source.
 */
function frustumSize(
  camera: Camera,
  distance: number,
  size: { width: number; height: number },
): [number, number] {
  const cam = camera as PerspectiveCamera & OrthographicCamera
  // An orthographic frustum is a box: same cross-section at every depth, and
  // its world extent lives on the camera rather than being derivable from the
  // canvas. (Derived, not measured — every lab here is perspective.)
  if (cam.isOrthographicCamera) {
    return [
      (cam.right - cam.left) / cam.zoom,
      (cam.top - cam.bottom) / cam.zoom,
    ]
  }
  const h = 2 * Math.tan((cam.fov * Math.PI) / 360) * distance
  return [h * (size.width / size.height), h]
}

export function ViewerSurface({
  distance = 1.15,
  label = 'viewer',
  onHost,
  content,
  children,
}: ViewerSurfaceProps) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const [quadW, quadH] = useMemo(
    () => frustumSize(camera, distance, size),
    [camera, distance, size],
  )

  // Source pixels, derived from the QUAD rather than from `size` directly, so
  // that "source aspect === quad aspect" holds by construction instead of by
  // two expressions agreeing. Under a perspective camera this reduces exactly
  // to the canvas size and one source px is one screen px; under an
  // orthographic one it is whatever pixel grid matches that camera's box.
  const height = Math.max(1, Math.round(size.height))
  const width = Math.max(1, Math.round(height * (quadW / quadH)))

  const { mount } = useSourceHost({
    width,
    height,
    className: 'ui-layer',
    content,
    onHost,
  })

  return (
    <CameraChrome distance={distance}>
      <Surface
        label={label}
        width={width}
        height={height}
        html=""
        onSource={mount}
        transparent
        hitTest="content"
      >
        <planeGeometry args={[quadW, quadH]} />
        {children}
      </Surface>
    </CameraChrome>
  )
}
