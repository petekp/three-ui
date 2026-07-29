import { createContext } from 'react'
import type * as THREE from 'three'

// What a Surface exposes to its children (e.g. <SurfaceLayer>): the mesh
// whose geometry UV anchors sample, the live DOM root for selector queries,
// and the DOM pixel dims for rect→UV conversion. `source` is React state, not
// a ref — child effects run BEFORE the parent's, so children must re-render
// when the texture source actually comes up.
export interface SurfaceContextValue {
  mesh: React.RefObject<THREE.Mesh | null>
  source: HTMLElement | null
  width: number
  height: number
  mirrorU: boolean
}

export const SurfaceContext = createContext<SurfaceContextValue | null>(null)
