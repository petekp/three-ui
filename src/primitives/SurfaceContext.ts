import { createContext, use } from 'react'
import type * as THREE from 'three'

// What a Surface exposes to its children (e.g. <SurfaceLayer>): the mesh
// whose geometry UV anchors sample, the live DOM root for selector queries,
// and the DOM pixel dims for rect→UV conversion. `source` is React state, not
// a ref — child effects run BEFORE the parent's, so children must re-render
// when the texture source actually comes up. `texture` is state for the same
// reason: a child that owns the material (see Surface's `material="none"`)
// must re-render when the texture arrives, or it samples null forever.
export interface SurfaceContextValue {
  mesh: React.RefObject<THREE.Mesh | null>
  source: HTMLElement | null
  width: number
  height: number
  mirrorU: boolean
  texture: THREE.CanvasTexture | null
}

export const SurfaceContext = createContext<SurfaceContextValue | null>(null)

/**
 * The Surface's live DOM texture, for a child that supplies its own material
 * (`<Surface material="none">`). Null until the source first paints — a
 * custom material should render regardless and pick the texture up on the
 * re-render its arrival triggers; a `ShaderMaterial` whose sampler uniform
 * was declared up front needs no recompile when the value lands (the
 * needsUpdate bump Surface performs for its own map-keyed material is a
 * built-in-material problem, not a shader one).
 */
export function useSurfaceTexture(): THREE.CanvasTexture | null {
  const ctx = use(SurfaceContext)
  if (!ctx) throw new Error('useSurfaceTexture must be used inside a <Surface>')
  return ctx.texture
}
