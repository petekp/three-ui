import { createContext, use } from 'react'
import type * as THREE from 'three'
import type { SurfaceChrome } from '../lib/surfaceChrome'

// What a Surface exposes to its children (e.g. <SurfaceLayer>): the mesh
// whose geometry UV anchors sample, the live DOM root for selector queries,
// and the DOM pixel dims for rect→UV conversion. `source` is React state, not
// a ref — child effects run BEFORE the parent's, so children must re-render
// when the texture source actually comes up. `texture` is state for the same
// reason: a child that owns the material (see Surface's `material="none"`)
// must re-render when the texture arrives, or it samples null forever.
// `chrome` likewise: it changes only when a paint actually changes the
// element's measured radii/shadow, and a material that wears them must hear.
export interface SurfaceContextValue {
  mesh: React.RefObject<THREE.Mesh | null>
  source: HTMLElement | null
  width: number
  height: number
  mirrorU: boolean
  texture: THREE.CanvasTexture | null
  chrome: SurfaceChrome | null
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

/**
 * The Surface's measured chrome (corner radii, outer box-shadow layers) and
 * source px size — what a custom material needs to wear the element's own
 * corners (`SURFACE_RADIUS_GLSL`) or render the shadow the rasterizer can't
 * capture. Null until the content's first paint has been measured; a custom
 * material should treat that as "no radii yet" (mask uniforms of zero are a
 * no-op), exactly like the texture being null.
 */
export function useSurfaceChrome(): {
  chrome: SurfaceChrome | null
  width: number
  height: number
} {
  const ctx = use(SurfaceContext)
  if (!ctx) throw new Error('useSurfaceChrome must be used inside a <Surface>')
  return { chrome: ctx.chrome, width: ctx.width, height: ctx.height }
}
