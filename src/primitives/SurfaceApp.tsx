import type { ComponentProps, ReactNode } from 'react'
import { Surface } from './Surface'
import { useSourceHost } from './useSourceHost'

// <SurfaceApp> — mount a React tree as a Surface's live DOM.
//
// This is the seam that makes an entire component library usable as matter.
// A second React root renders into the parked source subtree, so state,
// effects, refs and event delegation all run against real DOM; every commit
// changes the paint record, and the Surface uploads it like any other
// mutation. Nothing in the tree knows it is being rasterized into a material.
//
// The tree is a root, not a portal: an r3f scene is rendered by the three.js
// reconciler, and `react-dom`'s createPortal cannot cross that boundary. The
// practical consequence is that the inner tree does not see React context
// from the scene — pass what it needs through `content`.

export interface SurfaceAppProps
  extends Omit<ComponentProps<typeof Surface>, 'html' | 'onSource'> {
  /** The React tree to render into the Surface's source DOM. */
  content: ReactNode
  /**
   * Receives the live container element when it exists, `null` when it goes
   * away — the handle a scene needs to listen to the tree from outside
   * (e.g. `useAnimationConductor` hears its animations here).
   */
  onHost?: (el: HTMLElement | null) => void
}

export function SurfaceApp({
  content,
  width = 640,
  height = 480,
  children,
  onHost,
  ...surfaceProps
}: SurfaceAppProps) {
  const { mount } = useSourceHost({ width, height, className: 'ui-root', content, onHost })

  return (
    <Surface
      {...surfaceProps}
      width={width}
      height={height}
      html=""
      onSource={mount}
    >
      {children}
    </Surface>
  )
}
