import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  cameraDistance,
  planeScale,
  planeToScreen,
  screenToPlane,
} from './lab014Camera'

const VW = 1600
const VH = 1000
const FOV = 42
const CAM = cameraDistance(VH, FOV)
const LIFT = 96

const _v = new THREE.Vector3()

describe('the pixel-perfect calibration', () => {
  it('puts the viewport on z = 0', () => {
    // The whole lab rests on this: at the calibrated distance a world unit on
    // z = 0 is a CSS pixel, so the plane's half-height IS half the viewport.
    expect(CAM).toBeCloseTo(1302.54, 1)
    expect(planeScale(CAM, 0)).toBe(1)
  })

  it('magnifies the lift plane by about 8%', () => {
    expect(planeScale(CAM, LIFT)).toBeCloseTo(1.0796, 4)
  })
})

describe('screenToPlane', () => {
  it('round-trips through the projection on z = 0', () => {
    for (const [x, y] of [
      [800, 500],
      [900, 405],
      [1500, 800],
      [12, 990],
    ]) {
      const s = planeToScreen(screenToPlane(x, y, VW, VH, CAM, 0, _v), VW, VH, CAM)
      expect(s.x).toBeCloseTo(x, 9)
      expect(s.y).toBeCloseTo(y, 9)
    }
  })

  it('round-trips on the LIFT plane — this is the bug', () => {
    // The shipped code used the z = 0 mapping for a card held at z = 96. That
    // is not an offset that a user could learn: it is a GAIN, so the error is
    // zero at the screen centre and grows with distance from it.
    for (const [x, y] of [
      [800, 500],
      [900, 405],
      [1500, 800],
      [12, 990],
    ]) {
      const s = planeToScreen(screenToPlane(x, y, VW, VH, CAM, LIFT, _v), VW, VH, CAM)
      expect(s.x).toBeCloseTo(x, 9)
      expect(s.y).toBeCloseTo(y, 9)
    }
  })

  it('quantifies what the z = 0 mapping got wrong on the lift plane', () => {
    // The regression this test exists to prevent, stated as a number.
    const wrong = _v.set(900 - VW / 2, VH / 2 - 405, LIFT)
    const s = planeToScreen(wrong, VW, VH, CAM)
    expect(s.x - 900).toBeCloseTo(7.96, 2)
    expect(s.y - 405).toBeCloseTo(-7.56, 2)

    // …and at the edge of the screen it is an order of magnitude worse, which
    // is why it read as the card sliding around rather than as a fixed offset.
    // Note the signs: the card is pushed AWAY from the screen centre in both
    // axes, so the direction of the error reverses as you cross the middle.
    const edge = _v.set(1500 - VW / 2, VH / 2 - 800, LIFT)
    const se = planeToScreen(edge, VW, VH, CAM)
    expect(se.x - 1500).toBeCloseTo(55.7, 1)
    expect(se.y - 800).toBeCloseTo(23.9, 1)
  })

  it('the error is a pure gain about the screen centre, not a translation', () => {
    // Two cursor positions 100 px apart map to points 107.96 px apart under
    // the wrong mapping — the card outruns the hand by 8% forever, which is
    // the part that feels like fighting rather than like a bad offset.
    const a = _v.set(900 - VW / 2, 0, LIFT).clone()
    const b = _v.set(1000 - VW / 2, 0, LIFT).clone()
    const sa = planeToScreen(a, VW, VH, CAM)
    const sb = planeToScreen(b, VW, VH, CAM)
    expect(sb.x - sa.x).toBeCloseTo(107.96, 2)

    // Corrected, the hand and the card move together exactly.
    const ca = screenToPlane(900, 0, VW, VH, CAM, LIFT, _v).clone()
    const cb = screenToPlane(1000, 0, VW, VH, CAM, LIFT, _v).clone()
    expect(planeToScreen(cb, VW, VH, CAM).x - planeToScreen(ca, VW, VH, CAM).x).toBeCloseTo(100, 9)
  })

  it('agrees with an actual three.js unprojected ray', () => {
    // The cheap division has to be the same answer the general method gives,
    // or the shortcut is a second source of truth.
    const cam = new THREE.PerspectiveCamera(FOV, VW / VH, 1, 4000)
    cam.position.set(0, 0, CAM)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    cam.updateProjectionMatrix()

    const ray = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -LIFT)
    for (const [x, y] of [
      [900, 405],
      [1500, 800],
      [12, 990],
    ]) {
      ray.setFromCamera(
        new THREE.Vector2((x / VW) * 2 - 1, -(y / VH) * 2 + 1),
        cam,
      )
      const hit = ray.ray.intersectPlane(plane, new THREE.Vector3())!
      const ours = screenToPlane(x, y, VW, VH, CAM, LIFT, _v)
      expect(ours.x).toBeCloseTo(hit.x, 6)
      expect(ours.y).toBeCloseTo(hit.y, 6)
      expect(ours.z).toBeCloseTo(hit.z, 6)
    }
  })
})
