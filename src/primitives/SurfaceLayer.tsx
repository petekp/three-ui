import { useContext, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Surface, type SurfaceProps } from './Surface'
import { SurfaceContext } from './SurfaceContext'
import { UVAnchor, type SurfaceSample } from '../lib/uvAnchor'

// <SurfaceLayer> — a Surface anchored to a POINT ON another Surface's skin.
// This is the floating-UI layer (popovers, menus, tooltips, dialogs) made
// geometry-agnostic: the anchor is a CSS selector into the parent's live DOM,
// resolved to a (u, v) texture coordinate, inverted through the parent's
// geometry to a surface point + normal (src/lib/uvAnchor.ts), and lifted off
// the skin along that normal.
//
// The anchor samples the parent's LIVE vertex data every frame, so a layer on
// a deforming or moving surface rides it — no extra wiring. Orientation:
// 'normal' faces along the local surface normal (a popover growing out of the
// skin), 'billboard' faces the camera.
//
// Render it as a child of the parent <Surface>; conditional mounting is the
// caller's job, same as any popover ({open && <SurfaceLayer …>}).
//
// Caveats (v0): the DOM rect → UV conversion happens once at mount, so a
// reflow of the parent subtree after mount won't re-anchor; parent meshes are
// assumed unscaled (lift is in parent-local units).

export interface SurfaceLayerProps extends SurfaceProps {
  /** CSS selector into the parent Surface's live subtree to anchor to. */
  anchor: string
  /**
   * Point on the anchor element's rect, 0..1 in DOM orientation (y=0 is the
   * element's top). Default bottom-center — where a dropdown hangs from.
   */
  align?: { x: number; y: number }
  /** How far to float off the surface along its normal (parent-local units). */
  lift?: number
  /**
   * Nudge in the LAYER's oriented frame, applied after anchoring — e.g.
   * [0, -h/2, 0] hangs a popover's body below the anchor point.
   */
  offset?: [number, number, number]
  /** 'normal': face along the surface normal. 'billboard': face the camera. */
  orient?: 'normal' | 'billboard'
}

const Z_AXIS = new THREE.Vector3(0, 0, 1)

export function SurfaceLayer({
  anchor,
  align = { x: 0.5, y: 1 },
  lift = 0.25,
  offset,
  orient = 'normal',
  ...surfaceProps
}: SurfaceLayerProps) {
  const ctx = useContext(SurfaceContext)
  if (!ctx) throw new Error('<SurfaceLayer> must be rendered inside a <Surface>')

  const group = useRef<THREE.Group>(null)
  const anchorRef = useRef<UVAnchor | null>(null)
  const [ready, setReady] = useState(false)

  const { source, mesh, mirrorU } = ctx
  useEffect(() => {
    const root = source
    const parentMesh = mesh.current
    if (!root || !parentMesh) return
    const el = root.querySelector(anchor)
    if (!el) {
      console.warn(`[three-ui] SurfaceLayer: anchor "${anchor}" not found in parent Surface`)
      return
    }
    // Element rect → parent UV. The parked subtree is laid out for real, so
    // rects are exact; v flips to GL's bottom-up convention, u un-mirrors for
    // concave parents.
    const rootRect = root.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const px = r.left - rootRect.left + align.x * r.width
    const py = r.top - rootRect.top + align.y * r.height
    const uDom = px / rootRect.width
    const u = mirrorU ? 1 - uDom : uDom
    const v = 1 - py / rootRect.height
    const uvAnchor = new UVAnchor(parentMesh.geometry, u, v)
    if (!uvAnchor.valid) {
      console.warn(
        `[three-ui] SurfaceLayer: anchor "${anchor}" resolves to uv(${u.toFixed(3)}, ${v.toFixed(3)}) which is outside the parent geometry's UV coverage`,
      )
      return
    }
    anchorRef.current = uvAnchor
    setReady(true)
    return () => {
      anchorRef.current = null
      setReady(false)
    }
  }, [source, mesh, mirrorU, anchor, align.x, align.y])

  const scratch = useRef<SurfaceSample>({
    position: new THREE.Vector3(),
    normal: new THREE.Vector3(),
  })
  const scratchOffset = useRef(new THREE.Vector3())
  const scratchCam = useRef(new THREE.Vector3())

  // Re-sample every frame: reads three vertices' worth of live attributes, so
  // it's effectively free — and it's what glues the layer to deforming or
  // animated parents.
  useFrame(({ camera }) => {
    const g = group.current
    const uvAnchor = anchorRef.current
    if (!g || !uvAnchor) return
    const s = uvAnchor.sample(scratch.current)
    if (!s) return
    g.position.copy(s.position).addScaledVector(s.normal, lift)
    if (orient === 'billboard') {
      g.lookAt(camera.getWorldPosition(scratchCam.current))
    } else {
      g.quaternion.setFromUnitVectors(Z_AXIS, s.normal)
    }
    if (offset) {
      g.position.add(
        scratchOffset.current
          .set(offset[0], offset[1], offset[2])
          .applyQuaternion(g.quaternion),
      )
    }
  })

  return (
    <group ref={group} visible={ready}>
      <Surface {...surfaceProps} />
    </group>
  )
}
