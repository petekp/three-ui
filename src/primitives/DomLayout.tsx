import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import { createLayoutOracle, paneWorldPose } from '../lib/layoutOracle'
import type { LayoutOracle, PaneRect } from '../lib/layoutOracle'
import { useLatest } from './useLatest'

// <DomLayout> — the layout oracle, worn by a scene (docs: src/lib/layoutOracle.ts).
//
// Author the arrangement of your panels as MARKUP — flex, grid, gap,
// container queries, the whole engine — with each panel's spot marked
// `data-pane="id"`. A hidden in-document rig runs the real layout; every
// `<LayoutSlot pane="id">` in the scene wears the resulting box: positioned
// at the pane's centre in the rig group's space, its children told the box's
// CSS-pixel size. Toggle a class on the rig and the scene reflows; put a
// `transition` on a layout property and the reflow is a glide, streamed
// pose-by-pose at zero paints — the rig is invisible by construction, and
// motion delivered as group transforms never touches a texture.
//
// The rig declares `container-type: size`, so CONTAINER queries are the
// responsive mechanism (`@container`, Tailwind's `@sm:`/`@lg:` variants).
// Media queries and `vw`/`vh` stay page-global — the rig, like a source
// canvas, is not a viewport (docs/platform.md).

interface DomLayoutContextValue {
  subscribe: (cb: () => void) => () => void
  getRect: (pane: string) => PaneRect | undefined
  width: number
  height: number
  px: number
}

const DomLayoutContext = createContext<DomLayoutContextValue | null>(null)

export interface DomLayoutProps {
  /** The layout template. Real CSS layout; panes marked `data-pane="id"`. */
  html: string
  /** The rig's size in CSS px — the layout viewport, and what `@container` sees. */
  width: number
  height: number
  /** CSS pixels per world unit. */
  px?: number
  /**
   * The live rig element — toggle classes here to drive reflow. Lifecycle
   * hook like `Surface`'s `onSource`: called once with the element, once
   * with null on teardown.
   */
  onElement?: (el: HTMLElement | null) => void
  children?: ReactNode
}

export function DomLayout({
  html,
  width,
  height,
  px = 200,
  onElement,
  children,
}: DomLayoutProps) {
  const onElementRef = useLatest(onElement)
  const oracleRef = useRef<LayoutOracle | null>(null)
  const rectsRef = useRef<Map<string, PaneRect>>(new Map())
  // Slot subscriptions live HERE, not on the oracle, so they survive an
  // oracle rebuild (html change) without resubscribing: children's effects
  // run before this component's, so slots are already listening when the
  // first observe() delivery lands.
  const listenersRef = useRef(new Set<() => void>())

  // Rebuilding tears the rig down — same doctrine as Surface's source: `html`
  // is the one prop that means "this is a different layout now". Size changes
  // resize in place below (they're what container queries exist to absorb).
  useEffect(() => {
    const oracle = createLayoutOracle(html, width, height)
    oracleRef.current = oracle
    const unobserve = oracle.observe((rects) => {
      rectsRef.current = rects
      for (const cb of listenersRef.current) cb()
    })
    onElementRef.current?.(oracle.element)
    return () => {
      onElementRef.current?.(null)
      unobserve()
      oracle.dispose()
      oracleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html])

  useEffect(() => {
    oracleRef.current?.setSize(width, height)
  }, [width, height])

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb)
    return () => listenersRef.current.delete(cb)
  }, [])
  const getRect = useCallback((pane: string) => rectsRef.current.get(pane), [])

  const context = useMemo<DomLayoutContextValue>(
    () => ({ subscribe, getRect, width, height, px }),
    [subscribe, getRect, width, height, px],
  )

  return (
    <group>
      <DomLayoutContext value={context}>{children}</DomLayoutContext>
    </group>
  )
}

export interface LayoutSlotBox {
  /** The pane's box in CSS px — hand these straight to a Surface. */
  width: number
  height: number
  /** The same box in world units, for geometry. */
  worldWidth: number
  worldHeight: number
}

export interface LayoutSlotProps {
  /** Which `data-pane` this slot wears. */
  pane: string
  /** Stand-off from the layout plane, world units (a panel's z). */
  lift?: number
  children: (box: LayoutSlotBox) => ReactNode
}

export function LayoutSlot({ pane, lift = 0, children }: LayoutSlotProps) {
  const ctx = use(DomLayoutContext)
  if (!ctx) throw new Error('<LayoutSlot> must be inside a <DomLayout>')
  const { subscribe, getRect, width, height, px } = ctx

  const rect = useSyncExternalStore(
    subscribe,
    // Identity-stable per pane: the oracle reuses rect objects for unchanged
    // panes, so unrelated reflows don't re-render this slot.
    () => getRect(pane),
  )

  if (!rect) return null
  const pose = paneWorldPose(rect, width, height, px)
  return (
    <group position={[pose.x, pose.y, lift]}>
      {children({
        width: rect.width,
        height: rect.height,
        worldWidth: pose.width,
        worldHeight: pose.height,
      })}
    </group>
  )
}
