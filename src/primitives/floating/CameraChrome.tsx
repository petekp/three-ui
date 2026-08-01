import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeElements } from '@react-three/fiber'
import type { Group } from 'three'

// <CameraChrome> — a group that rides the eye.
//
// Children sit `distance` in front of the camera and follow it exactly:
// orbit the scene and they stay put in the view. This is where anything
// belonging to the *viewer* goes rather than to an object — a toast stack,
// a modal, a reticle, a debug readout.
//
// The obvious implementation is `camera.add(children)`, and it does not work.
// r3f's default camera is NOT in the scene graph (measured — `camera.parent
// === null`), and a three.js scene is walked twice by two different
// traversals that start in different places: transforms propagate down the
// parent graph, but the render list is built by walking `scene`. Children of
// the camera get perfectly correct world matrices in a world nobody renders.
//
// So the pose is copied onto an ordinary scene-level group instead. Nothing
// shared is mutated, and it is never a frame stale: drei's OrbitControls
// updates at `useFrame` priority −1 and r3f renders after every
// default-priority callback, so the pose written here is the pose drawn.
// (decisions #21)

export interface CameraChromeProps
  extends Omit<ThreeElements['group'], 'ref'> {
  /** World units in front of the eye. */
  distance?: number
}

export function CameraChrome({
  distance = 1.15,
  children,
  ...groupProps
}: CameraChromeProps) {
  const group = useRef<Group>(null)

  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    g.position.copy(camera.position)
    g.quaternion.copy(camera.quaternion)
    g.translateZ(-distance)
  })

  return (
    <group ref={group} {...groupProps}>
      {children}
    </group>
  )
}
