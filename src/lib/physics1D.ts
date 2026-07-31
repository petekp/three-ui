// The physics core of the control kit: one 1-DOF body, one integrator, and
// control "feel" expressed as composable force fields. A dial IS
// detentField + damping; a toggle IS overCenterField + damping; a slider IS
// stopsField + endStops + damping. No easing curves, no durations — release
// velocity flows into the field and the field decides where things land.
//
// q is the generalized coordinate (an angle for rotary controls, travel for
// linear ones); fields return acceleration for a unit mass. Semi-implicit
// (symplectic) Euler with substeps: velocity first, then position with the
// NEW velocity — this is what keeps stiff spring fields from gaining energy
// and exploding at coarse timesteps, where naive Euler does.

export interface Body1D {
  q: number
  v: number
}

/** Acceleration as a function of state. Compose by summation. */
export type Field = (q: number, v: number) => number

export const composeFields = (...fields: Field[]): Field => {
  return (q, v) => {
    let a = 0
    for (const f of fields) a += f(q, v)
    return a
  }
}

/** Viscous damping — every real control has some. */
export const damping = (c: number): Field => {
  return (_q, v) => -c * v
}

/**
 * Periodic detents: n wells per revolution at q = 2πj/n (the dial).
 * Near a well the effective stiffness is k·n.
 */
export const detentField = (n: number, k: number): Field => {
  return (q) => -k * Math.sin(n * q)
}

/**
 * Detents at arbitrary positions (a slider's named stops): a spring toward
 * the NEAREST stop. Piecewise linear force with well boundaries at the
 * midpoints between stops — how a physical detent strip behaves.
 */
export const stopsField = (stops: number[], k: number): Field => {
  return (q) => {
    let nearest = stops[0]
    let best = Math.abs(q - nearest)
    for (let i = 1; i < stops.length; i++) {
      const d = Math.abs(q - stops[i])
      if (d < best) {
        best = d
        nearest = stops[i]
      }
    }
    return -k * (q - nearest)
  }
}

/**
 * Bistable double-well (the toggle): stable poles at q = ±span, unstable
 * equilibrium at q = 0. Crossing center hands you to the far pole — the
 * over-center snap IS this instability. Beyond the poles the force is
 * restoring, so the field self-limits overtravel.
 */
export const overCenterField = (k: number, span: number): Field => {
  return (q) => {
    const x = q / span
    return k * x * (1 - x * x)
  }
}

/** Stiff one-sided springs bounding travel to [min, max] (slider ends). */
export const endStops = (min: number, max: number, k: number): Field => {
  return (q) => (q < min ? -k * (q - min) : q > max ? -k * (q - max) : 0)
}

/**
 * Advance the body by dt. Substeps split dt for stability — a field with
 * effective stiffness K needs h well under 2/√K; substeps=2 at 30fps holds
 * for everything in the kit's tuning range.
 */
export function step(body: Body1D, field: Field, dt: number, substeps = 2): void {
  const h = dt / substeps
  for (let i = 0; i < substeps; i++) {
    body.v += field(body.q, body.v) * h
    body.q += body.v * h
  }
}

/**
 * The minimum impulse that flips a bistable field from the pole at -span to
 * the pole at +span, found by bisection against the actual integrator. A
 * toggle uses this at mount so its tap strength adapts to ANY tuning instead
 * of hardcoding a magic number. ~30 short simulations; sub-millisecond.
 */
export function flipImpulse(field: Field, span: number, margin = 1.5): number {
  const settlesPositive = (v0: number) => {
    const body: Body1D = { q: -span, v: v0 }
    for (let i = 0; i < 4 * 120; i++) step(body, field, 1 / 120, 2)
    return body.q > 0
  }
  let lo = 0
  let hi = 1
  while (!settlesPositive(hi) && hi < 1024) hi *= 2 // find an upper bound
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (settlesPositive(mid)) hi = mid
    else lo = mid
  }
  return hi * margin
}

/**
 * flipImpulse's sibling for periodic fields: the minimum impulse that carries
 * a body from one well center past the barrier into the next well (the
 * dial's keyboard ratchet — one arrow press, one detent). Same bisection
 * against the actual integrator; returns a positive speed, caller signs it.
 * margin keeps single presses decisive; key-repeat compounds impulses into
 * momentum by design, so margin stays small enough not to skip a second
 * well from rest (pinned by test).
 */
export function hopImpulse(field: Field, wellSpacing: number, margin = 1.25): number {
  const landsNext = (v0: number) => {
    const body: Body1D = { q: 0, v: v0 }
    for (let i = 0; i < 4 * 120; i++) step(body, field, 1 / 120, 2)
    return body.q > wellSpacing / 2
  }
  let lo = 0
  let hi = 1
  while (!landsNext(hi) && hi < 1024) hi *= 2
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (landsNext(mid)) hi = mid
    else lo = mid
  }
  return hi * margin
}
