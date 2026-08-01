import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import type { ReactNode } from 'react'
import type { PerspectiveCamera } from 'three'
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

export interface ViewerSurfaceProps {
  /**
   * Source size in CSS pixels. The quad is computed to span the frustum at
   * `distance`, so these are also the pixel dimensions the contents believe
   * they are laid out in — pick the aspect you want to author against.
   */
  width?: number
  height?: number
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

export function ViewerSurface({
  width = 1280,
  height = 720,
  distance = 1.15,
  label = 'viewer',
  onHost,
  content,
  children,
}: ViewerSurfaceProps) {
  const { mount } = useSourceHost({
    width,
    height,
    className: 'ui-layer',
    content,
    onHost,
  })

  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  // Span the frustum at `distance`. Recomputed when the aspect or the lens
  // changes — never per frame.
  const [quadW, quadH] = useMemo(() => {
    const cam = camera as PerspectiveCamera
    const h = 2 * Math.tan(((cam.fov ?? 45) * Math.PI) / 360) * distance
    return [h * (width / height), h]
    // `size` is not read directly: it is here because a resize is what
    // changes the aspect the caller's width/height are meant to match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, distance, width, height, size.width, size.height])

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
