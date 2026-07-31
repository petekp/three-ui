import { use, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ThreeElements } from '@react-three/fiber'
import { composeFields, damping, detentField, hopImpulse } from '../../lib/physics1D'
import { use1DOF, wrapAngle } from './use1DOF'
import { FocusGroupContext, type LeafHandle } from '../FocusScene'

// <Dial> — the lab-003 knob as a primitive: a rotary control whose feel is
// detentField + damping. Flicks ratchet through wells; onDetent fires LIVE
// as the index changes (mid-ratchet included), so a readout can tick along.
//
// Inside a <FocusGroup> the dial auto-joins as a LEAF member (docs/focus.md):
// an ARIA slider proxy carries real focus, and keys operate the control
// through the physics, not around it — arrows are impulses calibrated to hop
// exactly one detent from rest (key repeat compounds into momentum), Home/End
// are APG-mandatory absolute jumps that snap to the extreme well and settle.

export interface DialProps extends Omit<ThreeElements['group'], 'children'> {
  detents?: number
  stiffness?: number
  friction?: number
  initialDetent?: number
  radius?: number
  /** ARIA name when this dial joins a FocusGroup as a leaf member. */
  focusLabel?: string
  /** Human-readable value for AT (aria-valuetext), by detent index. */
  valueText?: (index: number) => string
  onDetent?: (index: number) => void
}

export function Dial({
  detents = 8,
  stiffness = 50,
  friction = 6,
  initialDetent = 0,
  radius = 0.42,
  focusLabel,
  valueText,
  onDetent,
  ...groupProps
}: DialProps) {
  const stepAngle = (Math.PI * 2) / detents
  const root = useRef<THREE.Group>(null)
  const rotor = useRef<THREE.Group>(null)
  const lastIndex = useRef(initialDetent)
  const leaf = useRef<LeafHandle | null>(null)
  const [focused, setFocused] = useState(false)

  const indexOf = (q: number) =>
    ((Math.round(-q / stepAngle) % detents) + detents) % detents

  const field = useMemo(
    () => composeFields(detentField(detents, stiffness), damping(friction)),
    [detents, stiffness, friction],
  )
  // Keyboard ratchet strength, bisected from the actual field (Toggle's
  // flipImpulse idiom): one press from rest = exactly one detent, any tuning.
  const kick = useMemo(() => hopImpulse(field, stepAngle), [field, stepAngle])

  const { bind, body, impulse } = use1DOF({
    field,
    initialQ: -initialDetent * stepAngle,
    localToQ: (local) => Math.atan2(local.y, local.x),
    wrapDelta: wrapAngle,
    onFrame: (q) => {
      if (rotor.current) rotor.current.rotation.z = q
      const idx = indexOf(q)
      if (idx !== lastIndex.current) {
        lastIndex.current = idx
        onDetent?.(idx)
        // Announce per detent CROSSING (a handful of writes/s at most, and
        // proxy mutations are paint-free — probe 6), never per physics
        // frame. Waiting for full settle alone reads ~2.7s late: the kick's
        // ringdown must decay below the strict rest threshold first.
        leaf.current?.setAria({ now: idx, valuetext: valueText?.(idx) })
      }
    },
    onSettle: (q) => {
      // Authoritative landing value once the body is truly at rest.
      const idx = indexOf(q)
      leaf.current?.setAria({ now: idx, valuetext: valueText?.(idx) })
    },
  })

  // Latest physics handles for the leaf key handler, which registers once.
  const keyRefs = useRef({ kick, impulse, stepAngle, detents })
  keyRefs.current = { kick, impulse, stepAngle, detents }
  const valueTextRef = useRef(valueText)
  valueTextRef.current = valueText

  const group = use(FocusGroupContext)
  useEffect(() => {
    if (!group) return
    const handle = group.registerLeaf({
      label: focusLabel ?? 'Dial',
      role: 'slider',
      object: root.current,
      aria: {
        min: 0,
        max: detents - 1,
        now: lastIndex.current,
        valuetext: valueTextRef.current?.(lastIndex.current),
      },
      onKey: (action) => {
        const { kick, impulse, stepAngle, detents } = keyRefs.current
        if (action.type === 'step') {
          // q runs opposite to index (indexOf negates), so increase = -kick.
          impulse(action.dir === 1 ? -kick : kick)
        } else {
          // Absolute jump = settle-to-extreme, not a spin through every
          // detent: snap q to the target well, let the field seat it, and
          // the settle path announces the landing.
          const idx = action.to === 'max' ? detents - 1 : 0
          body.current.q = -idx * stepAngle
          body.current.v = 0
          impulse(0) // disturb: onFrame applies the pose, onSettle re-arms
        }
      },
      onFocus: setFocused,
    })
    leaf.current = handle
    return () => {
      leaf.current = null
      handle.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, focusLabel, detents])

  const ticks = Array.from({ length: detents }, (_, k) => {
    const a = Math.PI / 2 - k * stepAngle
    const r = radius + 0.16
    return (
      <mesh key={k} position={[Math.cos(a) * r, Math.sin(a) * r, 0]} rotation={[0, 0, a]}>
        <boxGeometry args={[0.09, 0.028, 0.02]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
    )
  })

  return (
    <group {...groupProps} {...bind} ref={root}>
      {ticks}
      <group ref={rotor} rotation={[0, 0, -initialDetent * stepAngle]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[radius, radius + 0.04, 0.22, 48]} />
          {/* Focus-as-light: leaf focus is mesh-level treatment, mirroring
              the unit glow grammar (docs/focus.md "Focus indication"). */}
          <meshStandardMaterial
            color="#1e293b"
            roughness={0.35}
            metalness={0.7}
            emissive="#0ea5e9"
            emissiveIntensity={focused ? 0.42 : 0}
          />
        </mesh>
        <mesh position={[0, radius * 0.7, 0.12]}>
          <boxGeometry args={[0.05, radius * 0.42, 0.035]} />
          <meshStandardMaterial
            color="#7dd3fc"
            emissive="#38bdf8"
            emissiveIntensity={focused ? 2.8 : 1.6}
          />
        </mesh>
      </group>
    </group>
  )
}
