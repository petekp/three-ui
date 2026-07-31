import { describe, expect, it } from 'vitest'
import {
  OPPOSITE,
  createDirectionalHistory,
  directionalPick,
  edgeProgress,
  isOutsider,
  outsiderDistance,
  type NavRect,
} from './spatialNav'

const r = (id: string, x: number, y: number, w = 150, h = 100, depth?: number): NavRect => ({
  id,
  x,
  y,
  w,
  h,
  depth,
})

describe('insiders (overlapping rects — the projected-3D regime)', () => {
  const origin = { x: 100, y: 100, w: 200, h: 150 }

  it('picks the minimal edge progress — the next card in the stack, not the farthest', () => {
    const near = r('near', 110, 115, 200, 150) // down-progress 15
    const far = r('far', 120, 130, 200, 150) // down-progress 30
    expect(directionalPick(origin, [far, near], 'down')).toBe('near')
  })

  it('keeps a concentric fully-overlapped candidate reachable from all four directions (FPWD fix)', () => {
    const concentric = r('inner', 180, 160, 40, 30) // same center as origin
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      expect(directionalPick(origin, [concentric], dir)).toBe('inner')
    }
  })

  it('an offset contained candidate is reachable via its dominant direction', () => {
    // Center displaced (−30, −20) from the origin's: dominant axis is LEFT.
    const contained = r('inner', 150, 140, 40, 30)
    expect(directionalPick(origin, [contained], 'left')).toBe('inner')
    expect(directionalPick(origin, [contained], 'right')).toBe(null)
  })

  it('a sliver overlap must not hijack the regime (browser-caught: doc-4 → deploy)', () => {
    // Real lab-006 projection: the grab handle extends every panel's rect
    // upward, so the row above overlaps the origin by ~18px. deploy sits a
    // full row UP with ~3px of rightward edge progress — without the
    // centroid cone it wins 'right' as the minimal-progress insider while
    // doc-5, the true right neighbor, is dismissed as a mere outsider.
    const doc4 = { x: 762.9, y: 275.4, w: 200.9, h: 160.8 }
    const deploy = r('deploy', 766.2, 153.6, 202.2, 139.9)
    const doc5 = r('doc-5', 989.6, 302.3, 264.3, 170.2)
    expect(directionalPick(doc4, [deploy, doc5], 'right')).toBe('doc-5')
    expect(directionalPick(doc4, [deploy, doc5], 'up')).toBe('deploy')
  })

  it('bloated-projection insiders rank by centroid orthogonality, not raw edge progress (browser-caught: synth → calendar)', () => {
    // Real lab-006 projection, camera home: at the arc's edge the projected
    // AABBs grow until every neighbor overlaps the origin — the insider
    // regime, designed for stacks, swallows the whole neighborhood. Three
    // cone-passing right-insiders: calendar (row below, progress 278.5),
    // doc-19 (row above, progress 291.8), errors (level, progress 297.9).
    // Pure minimal-progress picks calendar — the browser walk dropped a row.
    // Ranked by progress + centroid-outside-band·Wo, the level neighbor
    // wins: errors' centroid sits inside synth's band (penalty 0) while
    // calendar's sits 121px below and doc-19's 151px above. True stacks are
    // untouched: a contained candidate's centroid is inside the band by
    // definition, so their ranking stays pure progress.
    const synth = { x: 998.94, y: 100.86, w: 408.72, h: 204.38 }
    const field = [
      r('errors', 1296.84, 57.27, 428.44, 260.72),
      r('calendar', 1277.42, 297.14, 418.19, 257.44),
      r('doc-19', 1290.7, -214.03, 511.11, 327.26),
      r('doc-6', 1731.18, 315.01, 921.31, 465.74),
      r('doc-12', 1775.04, -115.63, 995.12, 482.4),
      r('chat', 991.78, -74.37, 312.37, 216.37),
      r('doc-5', 989.58, 289.53, 265.54, 182.95),
    ]
    expect(directionalPick(synth, field, 'right')).toBe('errors')
    // Down from synth: doc-5 overlaps as a genuine below-insider (centroid
    // inside the x-band) and calendar fails the down-cone — lattice answer.
    expect(directionalPick(synth, field, 'down')).toBe('doc-5')
  })

  it('breaks a coincident-rect tie by depth: the panel painted on top wins', () => {
    const under = r('under', 100, 100, 200, 150, 8)
    const over = r('over', 100, 100, 200, 150, 3)
    expect(directionalPick(origin, [under, over], 'down')).toBe('over')
    expect(directionalPick(origin, [over, under], 'up')).toBe('over')
  })

  it('takes absolute precedence over outsiders — regimes never mix', () => {
    const overlapping = r('overlapping', 110, 115, 200, 150)
    const clearBelow = r('clear-below', 100, 400)
    expect(directionalPick(origin, [clearBelow, overlapping], 'down')).toBe('overlapping')
  })

  it('an overlapping candidate behind the direction of travel is not an insider for it', () => {
    // Overlaps but sits higher: down must not select it (it is an up-insider).
    const above = r('above', 100, 60, 200, 150)
    expect(directionalPick(origin, [above], 'down')).toBe(null)
    expect(directionalPick(origin, [above], 'up')).toBe('above')
  })
})

describe('outsiders (distance function — spatnav structure, symmetric tuning)', () => {
  const origin = { x: 100, y: 100, w: 100, h: 100 }

  it('prefers the aligned candidate over a nearer-by-hypotenuse diagonal', () => {
    const aligned = r('aligned', 100, 250, 100, 100) // gap 50, aligned
    const diagonal = r('diagonal', 230, 240, 100, 100) // gap 40 but displaced
    expect(directionalPick(origin, [diagonal, aligned], 'down')).toBe('aligned')
    expect(outsiderDistance(origin, aligned, 'down')).toBeLessThan(
      outsiderDistance(origin, diagonal, 'down'),
    )
  })

  it('a sliver band-overlap must not out-rank the level neighbor (browser-caught: deploy → doc-5)', () => {
    // Real lab-006 projection, camera home gazing at deploy: the arc's rows
    // shear apart at the edges, so doc-5 (one row DOWN) rises until its top
    // is 4px shy of deploy's bottom — cross-bands overlap, orthogonal
    // displacement reads 0, and its 9px-nearer left edge beat synth, the
    // same-row neighbor, by 4.4 points. Orthogonality must come from the
    // candidate's centroid vs the origin's cross-band (synth's centroid sits
    // inside deploy's band; doc-5's sits 87px below it), not from band
    // separation. chat is the mirror defector from the row above (1.4px
    // sliver); doc-4 directly below genuinely overlaps deploy and must keep
    // reaching it as a down-insider — the regime split is not in question.
    const deploy = { x: 766.2, y: 140.55, w: 202.81, h: 152.92 }
    const field = [
      r('synth', 998.94, 100.86, 408.72, 204.38),
      r('doc-5', 989.58, 289.53, 265.54, 182.95),
      r('chat', 991.78, -74.37, 312.37, 216.37),
      r('errors', 1296.84, 57.27, 428.44, 260.72),
      r('calendar', 1277.42, 297.14, 418.19, 257.44),
      r('doc-4', 762.89, 286.41, 201.46, 149.74),
    ]
    expect(directionalPick(deploy, field, 'right')).toBe('synth')
    expect(directionalPick(deploy, field, 'down')).toBe('doc-4')
  })

  it('euclidean is the pure axis gap when cross-axis ranges overlap', () => {
    const below = r('below', 100, 260, 100, 100)
    // gap 60, od 0, aligned 1 → 60 − 5
    expect(outsiderDistance(origin, below, 'down')).toBeCloseTo(55, 6)
  })

  it('touching edges is an outsider with zero gap, not an insider', () => {
    const touching = r('touching', 100, 200, 100, 100)
    expect(isOutsider(origin, touching, 'down')).toBe(true)
    expect(directionalPick(origin, [touching], 'down')).toBe('touching')
  })

  it('breaks exact ties by input order — panels must not shuffle between keypresses', () => {
    const a = r('a', 300, 100, 100, 100)
    const b = r('b', 300, 100, 100, 100)
    expect(directionalPick(origin, [a, b], 'right')).toBe('a')
    expect(directionalPick(origin, [b, a], 'right')).toBe('b')
  })

  it('returns null when nothing lies in the direction — the ladder takes over', () => {
    const below = r('below', 100, 260, 100, 100)
    expect(directionalPick(origin, [below], 'up')).toBe(null)
    expect(directionalPick(origin, [], 'down')).toBe(null)
  })
})

describe('arc-workspace realism (a skewed 3×3, as projection produces)', () => {
  // Rows curve in projection: edge panels sit slightly higher than their
  // row-mates. Center panel of the middle row is the origin.
  const grid = [
    r('top-left', 100, 40),
    r('top-center', 300, 50),
    r('top-right', 500, 45),
    r('mid-left', 100, 195),
    r('mid-right', 500, 195),
    r('bot-left', 100, 355),
    r('bot-center', 300, 350),
    r('bot-right', 500, 352),
  ]
  const origin = { x: 300, y: 200, w: 150, h: 100 }
  const others = (exclude: string) => grid.filter((g) => g.id !== exclude)

  it('each arrow from the center hits the expected neighbor despite the skew', () => {
    expect(directionalPick(origin, grid, 'right')).toBe('mid-right')
    expect(directionalPick(origin, grid, 'left')).toBe('mid-left')
    expect(directionalPick(origin, grid, 'up')).toBe('top-center')
    expect(directionalPick(origin, grid, 'down')).toBe('bot-center')
  })

  it('a corner has no candidate outward — ladder territory', () => {
    const midRight = grid.find((g) => g.id === 'mid-right')!
    expect(directionalPick(midRight, others('mid-right'), 'right')).toBe(null)
  })

  it('edge progress is symmetric across the four directions', () => {
    const o = { x: 0, y: 0, w: 10, h: 20 }
    const c = { x: 3, y: 5, w: 4, h: 8 }
    expect(edgeProgress(o, c, 'down')).toBe(5)
    expect(edgeProgress(o, c, 'up')).toBe(20 - 13)
    expect(edgeProgress(o, c, 'right')).toBe(3)
    expect(edgeProgress(o, c, 'left')).toBe(10 - 7)
  })
})

describe('directional history (Flutter trail — reciprocity under a moving camera)', () => {
  const always = () => true

  it('retraces a run in reverse, one pop per press, then exhausts to null', () => {
    const h = createDirectionalHistory()
    h.record('A', 'right') // A→B
    h.record('B', 'right') // B→C
    expect(h.onArrow('left', always)).toBe('B')
    expect(h.onArrow('left', always)).toBe('A')
    expect(h.onArrow('left', always)).toBe(null)
    expect(h.size()).toBe(0)
  })

  it('a retrace pops without recording — ping-pong cannot grow the trail', () => {
    const h = createDirectionalHistory()
    h.record('A', 'right')
    expect(h.onArrow('left', always)).toBe('A')
    expect(h.size()).toBe(0)
    expect(h.onArrow('right', always)).toBe(null) // nothing to retrace forward
  })

  it('a perpendicular press clears the whole trail', () => {
    const h = createDirectionalHistory()
    h.record('A', 'right')
    h.record('B', 'right')
    expect(h.onArrow('down', always)).toBe(null)
    expect(h.size()).toBe(0)
  })

  it('a same-direction press leaves the trail intact for the caller to extend', () => {
    const h = createDirectionalHistory()
    h.record('A', 'right')
    expect(h.onArrow('right', always)).toBe(null)
    expect(h.size()).toBe(1)
    h.record('B', 'right')
    expect(h.size()).toBe(2)
  })

  it('an unmounted retrace target clears the trail — it describes a world that is gone', () => {
    const h = createDirectionalHistory()
    h.record('A', 'right')
    h.record('B', 'right')
    expect(h.onArrow('left', (id) => id !== 'B')).toBe(null)
    expect(h.size()).toBe(0)
  })

  it('clear() empties, and the opposite table is involutive', () => {
    const h = createDirectionalHistory()
    h.record('A', 'up')
    h.clear()
    expect(h.onArrow('down', always)).toBe(null)
    for (const d of ['up', 'down', 'left', 'right'] as const) {
      expect(OPPOSITE[OPPOSITE[d]]).toBe(d)
    }
  })
})
