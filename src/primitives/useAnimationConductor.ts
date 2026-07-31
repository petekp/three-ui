import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  decomposeMatrix,
  isStatic,
  sampleAt,
  type MotionSample,
  type MotionValue,
} from '../lib/motionSamples'

// The conductor — the bridge between CSS-declared motion and mesh motion.
//
// Verbatim shadcn markup asks for movement in Tailwind:
// `data-[state=open]:animate-in fade-in-0 zoom-in-95 slide-in-from-top-2`.
// Inside a Surface those keyframes are the wrong instrument. They DO
// rasterize — they run on a descendant of the drawn root, which is inside
// the replayed paint record (Chrome 150.0.7871.187; see docs/platform.md
// for the root-vs-descendant seam) — but at one paint AND one texture
// upload per frame, ~120/s on this hardware. And a translate on the
// content slides pixels *within* the slab and clips at its edge, which
// reads as a texture glitch rather than a panel moving.
//
// So the conductor seizes each animation the moment it starts, before the
// compositor paints a frame of it:
//
//   1. pause() — the animation is now ours.
//   2. Scrub it: set currentTime, read getComputedStyle. The style engine
//      applies the timing function for us, so the samples come back already
//      eased. We never implement a cubic-bezier.
//   3. Park the DOM at the VISIBLE pole (an enter's end frame, an exit's
//      start frame) so the texture always holds fully-materialized content.
//   4. Replay the sampled curve on the mesh from the r3f clock.
//   5. finish() at the end, so `animationend` fires on schedule — Radix's
//      Presence keeps exiting content mounted until it hears that event, and
//      a bridge that swallowed it would leak every popover it ever closed.
//
// Cost: ~2 paints per open/close instead of 60/s. Entirely event-driven —
// no polling, no MutationObserver, nothing added to the paint path.

const REST: MotionValue = { opacity: 1, scale: 1, x: 0, y: 0 }

/** Scrub resolution. 9 points reconstructs an ease to well under a pixel. */
const SAMPLE_COUNT = 9

/**
 * Never seek to the exact end. A paused animation whose currentTime reaches
 * its end time enters the *finished* state, and finishing dispatches
 * `animationend` — so the last scrub sample would announce, one frame in,
 * that a 150ms exit was already over. Radix's Presence is listening for
 * exactly that event and unmounts on hearing it, which tore the content out
 * of the DOM 130ms early (measured: animationend at +17ms, mesh still
 * flying until +150ms).
 *
 * Half a millisecond short of the end is visually the same frame and keeps
 * the animation merely paused, so the only `animationend` anyone hears is
 * the one the conductor fires deliberately when the mesh lands.
 */
const END_EPSILON_MS = 0.5

interface Flight {
  anim: Animation
  samples: MotionSample[]
  durationMs: number
  elapsedMs: number
}

/** A CSSAnimation carries the @keyframes name; a plain Animation does not. */
function animationNameOf(a: Animation): string | null {
  const named = a as Animation & { animationName?: string }
  return typeof named.animationName === 'string' ? named.animationName : null
}

/**
 * Watch `root` for CSS animations and hand their curves to `apply`, which
 * runs once per frame while a flight is in progress and receives the pose
 * the DOM would have been wearing.
 *
 * `apply` is called with REST exactly once when a flight ends or is
 * cancelled, so a consumer can return the mesh to its resting pose without
 * tracking state of its own.
 */
export function useAnimationConductor(
  root: HTMLElement | null,
  apply: (value: MotionValue, done: boolean) => void,
) {
  const applyRef = useRef(apply)
  applyRef.current = apply
  const flightRef = useRef<Flight | null>(null)
  const lastValueRef = useRef<MotionValue>(REST)

  useEffect(() => {
    if (!root) return

    const onStart = (e: AnimationEvent) => {
      const el = e.target
      if (!(el instanceof HTMLElement)) return
      const anim = el
        .getAnimations()
        .find((a) => animationNameOf(a) === e.animationName)
      if (!anim?.effect) return

      const duration = anim.effect.getComputedTiming().duration
      const durationMs = typeof duration === 'number' ? duration : 0
      if (!durationMs) return

      // animationstart arrives one frame after the animation actually
      // began, so it has already advanced. Start the mesh from there
      // rather than replaying that frame — the two stay in lockstep, and
      // our finish() lands when CSS would have finished.
      const started = anim.currentTime
      const elapsedMs = typeof started === 'number' ? started : 0

      // Seize it before a single frame of it reaches the texture.
      anim.pause()

      const end = Math.max(0, durationMs - END_EPSILON_MS)
      const samples: MotionSample[] = []
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const t = i / (SAMPLE_COUNT - 1)
        anim.currentTime = t * end
        const cs = getComputedStyle(el)
        samples.push({
          t,
          opacity: Number.parseFloat(cs.opacity) || 0,
          ...decomposeMatrix(cs.transform),
        })
      }

      // Park at whichever end is fully materialized: enters resolve TO
      // visible, exits resolve FROM it. Either way the rasterized pixels
      // stay complete and the mesh does the appearing and disappearing.
      const entering = samples[samples.length - 1].opacity >= samples[0].opacity
      anim.currentTime = entering ? end : 0

      if (isStatic(samples)) {
        // `animate-in` with no fade/zoom/slide modifier — nothing to perform.
        anim.finish()
        return
      }
      flightRef.current = { anim, samples, durationMs, elapsedMs }
    }

    // The animation was taken away — usually because the element it was
    // running on got unmounted. Stop driving and report the flight over,
    // but hold the pose: "rest" for a floating layer is wherever it was
    // when its content vanished, not fully-materialized. Snapping to REST
    // here made a dismissed popover flash back to opaque on its last frame.
    const onCancel = () => {
      if (!flightRef.current) return
      flightRef.current = null
      applyRef.current(lastValueRef.current, true)
    }

    root.addEventListener('animationstart', onStart)
    root.addEventListener('animationcancel', onCancel)
    return () => {
      root.removeEventListener('animationstart', onStart)
      root.removeEventListener('animationcancel', onCancel)
      flightRef.current = null
    }
  }, [root])

  useFrame((_, delta) => {
    const flight = flightRef.current
    if (!flight) return
    flight.elapsedMs += delta * 1000
    const p = Math.min(1, flight.elapsedMs / flight.durationMs)
    const done = p >= 1
    const value = sampleAt(flight.samples, p)
    lastValueRef.current = value
    applyRef.current(value, done)
    if (done) {
      flightRef.current = null
      // Hand the animation back. finish() fires animationend, which is what
      // Radix Presence is waiting on to unmount exiting content.
      try {
        flight.anim.finish()
      } catch {
        // The element was already torn down — nothing left to release.
      }
    }
  })
}
