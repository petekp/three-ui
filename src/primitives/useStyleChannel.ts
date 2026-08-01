import { useContext, useEffect, useMemo, useRef } from 'react'
import { createStyleChannel, type StyleChannelOptions } from '../lib/styleChannel'
import { SurfaceContext } from './SurfaceContext'

/**
 * Read a CSS custom property as a mesh channel (the style bridge, decisions
 * #28). Defaults to the enclosing Surface's source root — the element the
 * texture is drawn from — or takes an explicit element for channels authored
 * deeper in the subtree.
 *
 * Returns a stable getter. Poll it in useFrame:
 *
 *   const depth = useStyleChannel('--depth')
 *   useFrame(() => { mesh.position.z = rest + depth() * lift })
 *
 * Mid-transition the getter returns the eased intermediate value — CSS's
 * own timing and easing, at zero paints (see src/lib/styleChannel.ts).
 * Before the source exists (or outside a Surface with no element given) the
 * getter returns the registered initial value.
 */
export function useStyleChannel(
  property: string,
  opts?: StyleChannelOptions & { element?: HTMLElement | null },
): () => number {
  const surface = useContext(SurfaceContext)
  const el = opts?.element ?? surface?.source ?? null

  const fallback = parseFloat(opts?.initialValue ?? '0') || 0
  const getRef = useRef<() => number>(() => fallback)

  // Options are read at (re)creation only — a channel is cheap to rebuild
  // and its identity follows the element it watches.
  const syntax = opts?.syntax
  const initialValue = opts?.initialValue
  const inherits = opts?.inherits
  useEffect(() => {
    if (!el) return
    const channel = createStyleChannel(el, property, { syntax, initialValue, inherits })
    getRef.current = channel.get
    return () => {
      getRef.current = () => fallback
      channel.dispose()
    }
  }, [el, property, syntax, initialValue, inherits, fallback])

  return useMemo(() => () => getRef.current(), [])
}
