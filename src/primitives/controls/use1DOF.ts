import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { step, type Body1D, type Field } from '../../lib/physics1D'
import { useLatest } from '../useLatest'

// The shared mechanism under every physical control: a 1-DOF body driven by
// a force field (src/lib/physics1D.ts), coupled kinematically to the hand
// during a drag, free-running otherwise.
//
// Interaction contracts baked in (each one paid for in an earlier lab):
// - Drags compute from e.ray ∩ a drag plane on the control's face — never
//   from e.point, which freezes at the mesh boundary under pointer capture.
// - Pointer capture on the event object keeps the drag alive off-mesh.
// - Gesture velocity is tracked (lerp-smoothed) and handed to the field on
//   release — flicks are real momentum, not synthesized animation.
// - Camera controls are disabled for the duration of a drag.

export interface Use1DOFOptions {
  field: Field
  initialQ?: number
  /** Convert a drag-plane point in the handler object's local space to q. */
  localToQ: (local: THREE.Vector3) => number
  /** Delta wrapper: pass wrapAngle for rotary controls; identity default. */
  wrapDelta?: (delta: number) => number
  /** Clamp kinematic q during drag (a hand can't pull past hard limits). */
  clampQ?: (q: number) => number
  /** Every frame: apply q to transforms, emit live values. */
  onFrame?: (q: number, v: number, dragging: boolean) => void
  /** Once, when the body comes to rest after any disturbance. */
  onSettle?: (q: number) => void
}

const SETTLE_V = 1e-3
const SETTLE_FRAMES = 15

export function use1DOF(opts: Use1DOFOptions) {
  const controls = useThree((s) => s.controls as { enabled?: boolean } | null)
  const body = useRef<Body1D>({ q: opts.initialQ ?? 0, v: 0 })
  // Latest options in a ref so handlers/useFrame never see stale closures.
  const optsRef = useLatest(opts)

  const drag = useRef({ active: false, offset: 0, lastT: 0 })
  const rest = useRef({ settled: true, frames: 0 })
  const plane = useRef(new THREE.Plane())
  const hit = useRef(new THREE.Vector3())

  const disturb = () => {
    rest.current.settled = false
    rest.current.frames = 0
  }

  const rawQ = (e: ThreeEvent<PointerEvent>) => {
    if (!e.ray.intersectPlane(plane.current, hit.current)) return null
    return optsRef.current.localToQ(e.eventObject.worldToLocal(hit.current))
  }

  const wrap = (d: number) => optsRef.current.wrapDelta?.(d) ?? d

  const bind = useMemo(
    () => ({
      onPointerDown: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        const obj = e.eventObject
        plane.current.setFromNormalAndCoplanarPoint(
          obj.getWorldDirection(new THREE.Vector3()),
          obj.getWorldPosition(new THREE.Vector3()),
        )
        const raw = rawQ(e)
        if (raw === null) return
        ;(e.target as Element).setPointerCapture(e.pointerId)
        if (controls) controls.enabled = false
        const d = drag.current
        d.active = true
        d.offset = wrap(body.current.q - raw)
        d.lastT = e.timeStamp
        body.current.v = 0
        disturb()
      },
      onPointerMove: (e: ThreeEvent<PointerEvent>) => {
        const d = drag.current
        if (!d.active) return
        e.stopPropagation()
        const raw = rawQ(e)
        if (raw === null) return
        const b = body.current
        let delta = wrap(raw + d.offset - b.q)
        const clamp = optsRef.current.clampQ
        if (clamp) delta = clamp(b.q + delta) - b.q
        const dt = Math.max((e.timeStamp - d.lastT) / 1000, 1e-4)
        b.v = THREE.MathUtils.lerp(b.v, delta / dt, 0.35)
        b.q += delta
        d.lastT = e.timeStamp
      },
      onPointerUp: (e: ThreeEvent<PointerEvent>) => endDrag(e),
      onLostPointerCapture: (e: ThreeEvent<PointerEvent>) => endDrag(e),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controls],
  )

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d.active) return
    d.active = false
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    if (controls) controls.enabled = true
  }

  /** Kick the body (a toggle tap, a scripted nudge). */
  const impulse = (dv: number) => {
    body.current.v += dv
    disturb()
  }

  useFrame((_, delta) => {
    const b = body.current
    const d = drag.current
    if (!d.active) step(b, optsRef.current.field, Math.min(delta, 1 / 30), 2)
    const r = rest.current
    if (!r.settled) {
      if (!d.active && Math.abs(b.v) < SETTLE_V) {
        if (++r.frames >= SETTLE_FRAMES) {
          r.settled = true
          optsRef.current.onSettle?.(b.q)
        }
      } else {
        r.frames = 0
      }
    }
    optsRef.current.onFrame?.(b.q, b.v, d.active)
  })

  return { bind, body, impulse }
}

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
