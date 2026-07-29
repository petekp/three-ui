import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeElements, type ThreeEvent } from '@react-three/fiber'
import { createDomTextureSource, type DomTextureSource } from '../lib/htmlInCanvas'
import { clearPointerState, forwardPointer, nudgeSelect } from './forwardEvents'

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

export interface SurfaceProps extends Omit<ThreeElements['mesh'], 'children'> {
  html: string
  /** Name for this surface in paint-stats diagnostics (window.__threeUI). */
  label?: string
  /** DOM pixel size of the source subtree (drives texture resolution). */
  width?: number
  height?: number
  children: React.ReactNode
  /** Fires when focus enters/leaves the live subtree. */
  onFocusWithin?: (focused: boolean) => void
  /** Access the live DOM root (attach listeners, mutate). May return cleanup. */
  onSource?: (el: HTMLElement) => void | (() => void)
  /** Flip the texture horizontally (for concave/back-face geometries). */
  mirrorU?: boolean
  side?: THREE.Side
  roughness?: number
  metalness?: number
}

export function Surface({
  html,
  label,
  width = 640,
  height = 480,
  children,
  onFocusWithin,
  onSource,
  mirrorU = false,
  side = THREE.FrontSide,
  roughness = 0.35,
  metalness = 0.05,
  ...meshProps
}: SurfaceProps) {
  const controls = useThree(
    (s) => s.controls as { enabled?: boolean } | null,
  )
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null)
  const sourceRef = useRef<DomTextureSource | null>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial>(null)
  const pressedRef = useRef(false)

  // A Surface mounted after the scene's first frame compiles its material
  // BEFORE the texture exists; three.js won't recompile the program when
  // .map is later assigned (program choice is keyed on material.version).
  // Without this bump the surface stays blank white forever.
  useEffect(() => {
    if (texture && materialRef.current) materialRef.current.needsUpdate = true
  }, [texture])

  useEffect(() => {
    const source = createDomTextureSource(html, width, height, {
      label,
      onError: (err) => console.warn('[three-ui] Surface paint failed:', err),
    })
    sourceRef.current = source

    const tex = new THREE.CanvasTexture(source.canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    if (mirrorU) {
      tex.wrapS = THREE.RepeatWrapping
      tex.repeat.x = -1
    }
    setTexture(tex)

    const focusIn = () => onFocusWithin?.(true)
    const focusOut = () => onFocusWithin?.(false)
    source.element.addEventListener('focusin', focusIn)
    source.element.addEventListener('focusout', focusOut)
    const cleanupSource = onSource?.(source.element)

    return () => {
      source.element.removeEventListener('focusin', focusIn)
      source.element.removeEventListener('focusout', focusOut)
      cleanupSource?.()
      tex.dispose()
      source.dispose()
      sourceRef.current = null
      setTexture(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, width, height, mirrorU])

  useFrame(() => {
    const source = sourceRef.current
    if (!source || !texture) return
    source.repaint()
    if (source.painted()) texture.needsUpdate = true
  })

  const uvOf = (e: ThreeEvent<PointerEvent>) => {
    if (!e.uv) return null
    const u = mirrorU ? 1 - e.uv.x : e.uv.x
    return { u, v: e.uv.y }
  }

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
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
    const { target } = forwardPointer(source.element, uv.u, uv.v, 'up')
    if (target instanceof HTMLSelectElement) nudgeSelect(target)
  }

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    const uv = uvOf(e)
    const source = sourceRef.current
    if (!uv || !source) return
    forwardPointer(source.element, uv.u, uv.v, 'move')
  }

  return (
    <mesh
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
      {children}
      <meshStandardMaterial
        ref={materialRef}
        map={texture ?? undefined}
        color={texture ? '#ffffff' : '#1e293b'}
        roughness={roughness}
        metalness={metalness}
        side={side}
      />
    </mesh>
  )
}
