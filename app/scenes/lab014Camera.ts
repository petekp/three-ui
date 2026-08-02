// Lab 014 — the calibration, and the one place that is allowed to know it.
//
// The lab's premise is that one world unit is one CSS pixel (decisions #44),
// which is true on EXACTLY ONE PLANE: z = 0. Every other plane is magnified by
// perspective, and forgetting that is how a drag stops tracking the hand.

import * as THREE from 'three'

/**
 * How far back the camera has to sit for the plane z = 0 to be the viewport,
 * pixel for pixel. Half the viewport height subtends half the vertical fov.
 */
export function cameraDistance(viewportHeight: number, fovDeg: number) {
  return viewportHeight / 2 / Math.tan((fovDeg * Math.PI) / 360)
}

/**
 * How much bigger something on the plane `z` appears than the same thing on
 * z = 0. Similar triangles from the eye: 1 at z = 0, > 1 nearer, < 1 further.
 */
export function planeScale(camZ: number, z: number) {
  return camZ / (camZ - z)
}

/**
 * The world point on the plane `z` that the cursor is pointing AT — i.e. the
 * point whose projection lands exactly under the cursor.
 *
 * This is decisions #4 ("intersect the ray with the drag plane, never take the
 * hit point") in its cheapest possible form. Because the camera is calibrated
 * and looking down −z, the ray intersection is a single division: a client
 * offset from the screen centre is a z = 0 world offset by construction, and
 * on any other plane it shrinks by the same similar-triangle ratio that makes
 * things on that plane look bigger.
 *
 * Lab 014 shipped without it, computing the drag target as if the card were on
 * z = 0 while actually holding it at z = 96. That is a 1.0796× GAIN error, not
 * an offset: the card tracked the cursor at 108% of its speed, drifting out
 * from under the pointer toward the edges of the screen and back toward the
 * middle. Pete read it, correctly, as "something fighting the drag".
 */
export function screenToPlane(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
  camZ: number,
  z: number,
  out: THREE.Vector3,
) {
  const k = 1 / planeScale(camZ, z)
  return out.set(
    (clientX - viewportWidth / 2) * k,
    (viewportHeight / 2 - clientY) * k,
    z,
  )
}

/**
 * Where a world point lands on screen, in client px. The inverse of
 * `screenToPlane`, and only used to prove that it is one.
 */
export function planeToScreen(
  p: THREE.Vector3,
  viewportWidth: number,
  viewportHeight: number,
  camZ: number,
) {
  const s = planeScale(camZ, p.z)
  return {
    x: viewportWidth / 2 + p.x * s,
    y: viewportHeight / 2 - p.y * s,
  }
}
