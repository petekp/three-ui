// @vitest-environment happy-dom
//
// The window-level flight gesture vs the surface protocol's forgeries.
//
// Pete's report, verbatim: "when i drag a card, it seems to jump towards the
// top left of the screen, sometimes even getting stuck there as long as i
// move my mouse in a particular way while dragging and then keep it
// stationary." The mechanism: the library retells pointer events into a
// card's parked subtree — hover moves at parked-LOCAL coordinates (the host
// is fixed at page (0,0)) and, on every exit, a three-frame departure burst
// at (−16, −16). Those bubble to window by design, the lab's window listener
// read `e.clientX` off them as if they were the hand, and the drag target
// teleported to the top-left corner — permanently, if the burst was the last
// event before the mouse went still. Measured in Chrome: 32 forged moves on
// window in one short drag.

import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { cameraDistance, carryToPlane, planeToScreen } from './lab014Camera'
import { attachLab014Gestures, type GestureFlight } from './lab014Gestures'

// The lab's calibration at the reference viewport — the tests hand the
// gesture the same lift-plane carry the Board does.
const CAM_Z = cameraDistance(720, 42)
const LIFT_Z = 96

function makeFlight(over: Partial<GestureFlight> = {}): GestureFlight {
  return {
    id: 'card-1',
    mode: 'held',
    px: 369,
    py: 284,
    downAt: performance.now(),
    downX: 369,
    downY: 284,
    floated: false,
    crumpleHeld: false,
    tossed: false,
    spin: new THREE.Vector3(),
    anchor: new THREE.Vector3(),
    anchorScroll: 0,
    hold: new THREE.Vector3(-40, 20, 0),
    handVel: new THREE.Vector3(120, -60, 0),
    plate: {
      p: new THREE.Vector3(300, -80, 96),
      v: new THREE.Vector3(),
      q: new THREE.Quaternion(),
    },
    ...over,
  }
}

/**
 * happy-dom constructs every event with `isTrusted: false` — which is exactly
 * what the library's forgeries look like. For the hand we shadow the property
 * on the instance, which is also honest: only the platform can mint a trusted
 * event, and the platform is what we are standing in for.
 */
function pointer(type: string, x: number, y: number, trusted: boolean) {
  const e = new Event(type, { bubbles: true }) as PointerEvent
  Object.defineProperties(e, {
    clientX: { value: x },
    clientY: { value: y },
    isTrusted: { value: trusted },
  })
  return e
}

let detach: (() => void) | null = null
afterEach(() => {
  detach?.()
  detach = null
})

function attach(flight: { current: GestureFlight | null }) {
  const calls: string[] = []
  detach = attachLab014Gestures({
    flight,
    dropTarget: () => null,
    moveTo: () => calls.push('moveTo'),
    snapshot: () => calls.push('snapshot'),
    scrollTop: () => 0,
    toLiftPlane: (a) => carryToPlane(a, CAM_Z, LIFT_Z),
  })
  return calls
}

describe('the hand is the only pointer that moves a held card', () => {
  it('a trusted move updates the flight (the harness can speak as the hand)', () => {
    const flight = { current: makeFlight() }
    attach(flight)
    window.dispatchEvent(pointer('pointermove', 700, 400, true))
    expect(flight.current.px).toBe(700)
    expect(flight.current.py).toBe(400)
  })

  it('the departure burst and parked-local retellings do not drag the card to the top-left', () => {
    const flight = { current: makeFlight() }
    attach(flight)
    window.dispatchEvent(pointer('pointermove', 700, 400, true))

    // What one edge-crossing actually puts on window (captured from Chrome):
    // the hover retold at parked-local coordinates, then the burst.
    window.dispatchEvent(pointer('pointermove', 256, 38, false))
    window.dispatchEvent(pointer('pointermove', -16, -16, false))
    window.dispatchEvent(pointer('pointermove', -16, -16, false))
    window.dispatchEvent(pointer('pointermove', -16, -16, false))

    // The hand has not moved, so neither has the target — the burst being the
    // LAST thing to fire is precisely the "stuck in the corner" report.
    expect(flight.current.px).toBe(700)
    expect(flight.current.py).toBe(400)
  })

  it('a forged pointerup does not release the hold', () => {
    const flight = { current: makeFlight() }
    attach(flight)
    window.dispatchEvent(pointer('pointermove', 700, 400, true))
    window.dispatchEvent(pointer('pointerup', -16, -16, false))

    expect(flight.current.mode).toBe('held')
    expect(flight.current.floated).toBe(false)
    expect(flight.current.plate.v.length()).toBe(0)
  })

  it('a trusted up still ends the gesture: drift past slop throws the card home', () => {
    const flight = { current: makeFlight() }
    attach(flight)
    window.dispatchEvent(pointer('pointermove', 700, 400, true))
    window.dispatchEvent(pointer('pointerup', 700, 400, true))

    expect(flight.current.mode).toBe('home')
    // The throw carried the hand's velocity — the damper's own vector.
    expect(flight.current.plate.v.x).toBe(120)
    expect(flight.current.plate.v.y).toBe(-60)
  })

  it('a trusted up with no travel is a tap, and parks the card in the air', () => {
    // A quick tap releases MID-RISE: the plate never reached the lift plane.
    const flight = {
      current: makeFlight({
        plate: {
          p: new THREE.Vector3(300, -80, 34),
          v: new THREE.Vector3(),
          q: new THREE.Quaternion(),
        },
      }),
    }
    const grab = flight.current.hold
      .clone()
      .applyQuaternion(flight.current.plate.q)
      .add(flight.current.plate.p)
    attach(flight)
    window.dispatchEvent(pointer('pointermove', 372, 286, true))
    window.dispatchEvent(pointer('pointerup', 372, 286, true))

    expect(flight.current.mode).toBe('float')
    expect(flight.current.floated).toBe(true)
    // Anchored at the grab point, not the centre — but carried the rest of
    // the way up to the lift plane, where the texture's pin is 1 : 1. The
    // carry preserves the SCREEN position: the card climbs in place instead
    // of sliding sideways, and it does not hang minified at tap height.
    expect(flight.current.anchor.z).toBe(LIFT_Z)
    const before = planeToScreen(grab, 1280, 720, CAM_Z)
    const after = planeToScreen(flight.current.anchor, 1280, 720, CAM_Z)
    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
  })
})

describe('a crumpling card is beyond rescue', () => {
  // The delete is the one gesture that ends a card's life as matter, and it
  // must be irreversible from the moment the crush begins: escape is "put it
  // back", but there is no back — the board is about to forget the slot.
  it('escape does not resurrect it', () => {
    const flight = { current: makeFlight({ mode: 'crumple' }) }
    attach(flight)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(flight.current.mode).toBe('crumple')
  })

  it('a trusted pointerup on an already-released wad finds nothing to do', () => {
    // The ball has left the hand (a keyboard delete, or a release already
    // handled); a stray up afterwards must not hand it a second throw
    // velocity or park it as a float.
    const flight = { current: makeFlight({ mode: 'crumple' }) }
    attach(flight)
    window.dispatchEvent(pointer('pointermove', 700, 400, true))
    window.dispatchEvent(pointer('pointerup', 700, 400, true))
    expect(flight.current.mode).toBe('crumple')
    expect(flight.current.plate.v.length()).toBe(0)
    expect(flight.current.floated).toBe(false)
    // And it must not mark the flight as tossed — a keyboard delete's rise
    // is the spring steer, and a stray up may not switch it to ballistic.
    expect(flight.current.tossed).toBe(false)
  })

  it('escape does not shake the ball out of the hand either', () => {
    // Irreversible by EVERY input includes the hand that is still holding
    // it: escape neither resurrects the card nor forces the release.
    const flight = { current: makeFlight({ mode: 'crumple', crumpleHeld: true }) }
    attach(flight)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(flight.current.mode).toBe('crumple')
    expect(flight.current.crumpleHeld).toBe(true)
  })
})

describe('the ✕ is a toss, not a timer', () => {
  it('releasing a held crumple hands the wad the throw: velocity and topspin', () => {
    const flight = {
      current: makeFlight({
        mode: 'crumple',
        crumpleHeld: true,
        handVel: new THREE.Vector3(300, 0, 0),
        plate: {
          p: new THREE.Vector3(300, -80, 55),
          v: new THREE.Vector3(900, 0, 0),
          q: new THREE.Quaternion(),
        },
      }),
    }
    attach(flight)
    window.dispatchEvent(pointer('pointerup', 700, 400, true))

    const f = flight.current
    // Still a crumple — the release is the hand letting go, not a mode
    // change; the flight stays owned by the delete until the wad exits.
    expect(f.mode).toBe('crumple')
    expect(f.crumpleHeld).toBe(false)
    expect(f.floated).toBe(false)
    // Released = ballistic, IMMEDIATELY. Without this flag a release during
    // the rise window fell back into the rise's stepFree steer, whose
    // damping ate the throw — measured: a 9148 px/s flick travelled ~450 px
    // before the spring bled it dead. The keyboard delete (never held,
    // never tossed) is the only crumple that spring-rises.
    expect(f.tossed).toBe(true)
    // The velocity handoff is the same one a throw home gets: the damper's
    // own hand vector on top of the plate's.
    expect(f.plate.v.x).toBe(1200)
    // Topspin about ẑ × d̂ for a +x throw is +y; the random wobble is
    // z-only, so x and y are exactly the pure function's verdict.
    expect(f.spin.x).toBeCloseTo(0, 10)
    expect(f.spin.y).toBeCloseTo(Math.min(1200 / 220, 7), 10)
  })

  it('a dead drop still tumbles — lazily, randomly', () => {
    // A plain click: press, no travel, release. The wad gets no throw, but
    // a wad that falls with zero rotation reads as a sprite, so the release
    // rolls the same lazy tumble the keyboard delete gets.
    const flight = {
      current: makeFlight({
        mode: 'crumple',
        crumpleHeld: true,
        handVel: new THREE.Vector3(),
      }),
    }
    attach(flight)
    window.dispatchEvent(pointer('pointerup', 369, 284, true))

    expect(flight.current.crumpleHeld).toBe(false)
    expect(flight.current.spin.length()).toBeGreaterThan(0)
  })

  it('a forged pointerup does not release the ball', () => {
    // The departure burst fires pointer events while the real button is
    // still down; only the hand may open the hand.
    const flight = { current: makeFlight({ mode: 'crumple', crumpleHeld: true }) }
    attach(flight)
    window.dispatchEvent(pointer('pointerup', -16, -16, false))
    expect(flight.current.crumpleHeld).toBe(true)
    expect(flight.current.spin.length()).toBe(0)
  })
})
