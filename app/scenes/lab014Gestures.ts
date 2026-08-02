// Lab 014 — the window-level half of the gesture: the three listeners that
// read the REAL pointer while a card is in flight.
//
// Extracted from Lab014.tsx so this seam can be tested as DOM: these handlers
// live on `window`, and `window` is a busy place in this codebase — the
// surface pointer protocol (decisions #19/#20) retells events into parked
// subtrees, and those subtrees bubble to the same window. What arrives here is
// therefore a MIXTURE of the user's hand and the library's forgeries, and
// which one a listener wants depends on which side of the glass it lives on.
// This one lives on the page side: it is the hand, and only the hand.

import * as THREE from 'three'

/** The slice of `Flight` the window gesture actually touches. */
export interface GestureFlight {
  id: string
  mode: 'held' | 'float' | 'home'
  px: number
  py: number
  downAt: number
  downX: number
  downY: number
  floated: boolean
  anchor: THREE.Vector3
  anchorScroll: number
  hold: THREE.Vector3
  handVel: THREE.Vector3
  plate: { p: THREE.Vector3; v: THREE.Vector3; q: THREE.Quaternion }
}

export interface GestureDeps<Col> {
  flight: { current: GestureFlight | null }
  dropTarget: (x: number, y: number, id: string) => { col: Col; index: number } | null
  moveTo: (col: Col, index: number, id: string) => void
  snapshot: () => void
  scrollTop: () => number
}

/**
 * Attach the flight gesture to `window`; returns the detach.
 *
 * Every pointer handler begins with an `isTrusted` check, and it is the whole
 * reason this file exists. The surface protocol dispatches synthetic pointer
 * events into a card's parked subtree — hover retold at PARKED-LOCAL
 * coordinates (the host is fixed at page (0,0), so "local" IS "near the
 * screen's top-left corner"), and on exit a multi-frame departure burst at
 * (−16, −16) (`AWAY_MARGIN_PX`, decisions #19). Those events bubble to window
 * BY DESIGN — Radix listens for them on document — and a drag that mistakes
 * them for the hand flies the card hard toward the top-left of the screen.
 * When the burst is the last thing to fire (cross the card's edge, then hold
 * the mouse still), the forged coordinates are never corrected and the card
 * STAYS there. Measured: one short drag put 32 forged moves on window.
 *
 * The user's hand is the only pointer with `isTrusted: true`; everything the
 * library retells is constructed, and constructed events cannot lie about it.
 */
export function attachLab014Gestures<Col>({
  flight,
  dropTarget,
  moveTo,
  snapshot,
  scrollTop,
}: GestureDeps<Col>) {
  const onMove = (e: PointerEvent) => {
    if (!e.isTrusted) return
    const f = flight.current
    if (!f) return
    f.px = e.clientX
    f.py = e.clientY
    if (f.mode !== 'held') return

    const t = dropTarget(e.clientX, e.clientY, f.id)
    if (t) {
      snapshot()
      moveTo(t.col, t.index, f.id)
    }
  }

  const onUp = (e: PointerEvent) => {
    if (!e.isTrusted) return
    const f = flight.current
    if (!f || f.mode !== 'held') return

    // A tap is a gesture, a drag is a different gesture, and the only thing
    // that separates them is that a tap did not go anywhere. 6 px is the
    // usual slop for "the hand did not mean to move"; 320 ms is long enough
    // that a slow, deliberate pick-up still counts.
    const moved = Math.hypot(f.px - f.downX, f.py - f.downY)
    const tap = moved < 6 && performance.now() - f.downAt < 320
    if (tap && !f.floated) {
      f.floated = true
      f.mode = 'float'
      // Hang it exactly where the fingers were, not where the centre is —
      // otherwise a card tapped by its corner jumps half its width sideways
      // at the moment of release.
      f.anchor.copy(f.hold).applyQuaternion(f.plate.q).add(f.plate.p)
      f.anchorScroll = scrollTop()
      return
    }

    f.mode = 'home'
    // Hand the swing over as real velocity. It is already world px/s on
    // the plane the card was flying at, because that is what the damper
    // needed it to be — so there is no conversion to get wrong and no
    // screen-y-is-down sign to flip.
    f.plate.v.add(f.handVel)
  }

  // Escape always puts it back. A floating card is a modeless state and
  // modeless states need an exit that does not require aim. (Keyboard is not
  // guarded: the library forges no keyboard — typing through a surface is
  // real focus and real keys, decisions #24.)
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    const f = flight.current
    if (!f || f.mode === 'home') return
    f.mode = 'home'
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  window.addEventListener('keydown', onKey)
  return () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    window.removeEventListener('keydown', onKey)
  }
}
