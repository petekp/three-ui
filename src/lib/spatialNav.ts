// Directional (arrow-key) navigation — pure logic for docs/focus.md
// "Directional navigation". Geometry is camera-projected screen-space AABBs,
// sampled fresh per keypress; this module never sees the camera, only rects.
//
// The spec lineage is CSS spatial-navigation §8.4 with the TAG's findings
// folded in: projected 3D panels overlap constantly, and overlapping rects
// must never reach the distance formula — so candidates split into two
// regimes BEFORE any scoring, and the regimes never mix. The directional
// history stack is Flutter's per-scope push/pop trail, and here it is
// load-bearing rather than polish: focus moves the camera, so the geometry
// that chose the last target no longer exists by the next keypress — a pure
// geometric argmax cannot be reciprocal even in principle.

export type Dir = 'up' | 'down' | 'left' | 'right'

export const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

const isVertical = (d: Dir) => d === 'up' || d === 'down'

export interface NavRect {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** Camera distance. Stacked insiders tie-break by painting order — the
   *  transparent-sort rule means nearer paints later, i.e. ON TOP, so the
   *  smaller depth wins. Optional: omitted depths tie-break by input order. */
  depth?: number
}

export interface NavWeights {
  /** Penalty per px of displacement orthogonal to the direction. The spec's
   *  30/2 split encodes row-dominant text layout; a spatial workspace isn't
   *  one, so the default is symmetric. */
  orthogonal?: number
  /** Bonus (scaled by 0..1 aligned fraction) for candidates sharing the
   *  origin's cross-axis band. */
  alignment?: number
}

// Per-direction rect algebra. `main` is the axis of travel, `cross` the
// other; `sign` +1 for down/right. All four directions reduce to one code
// path through these accessors.
const mainStart = (r: NavRect | Rect, vertical: boolean) => (vertical ? r.y : r.x)
const mainSize = (r: NavRect | Rect, vertical: boolean) => (vertical ? r.h : r.w)
const crossStart = (r: NavRect | Rect, vertical: boolean) => (vertical ? r.x : r.y)
const crossSize = (r: NavRect | Rect, vertical: boolean) => (vertical ? r.w : r.h)

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** How far the candidate's leading edge has advanced past the origin's, in
 *  the direction of travel. Insiders rank by this (ascending: the next card
 *  in the stack, not the farthest). ≥ 0 is the insider filter — the FPWD
 *  reachability fix means equality counts, so a fully-overlapped or even
 *  coincident candidate stays reachable (depth breaks the tie). */
export function edgeProgress(origin: Rect, c: Rect, dir: Dir): number {
  const v = isVertical(dir)
  return dir === 'down' || dir === 'right'
    ? mainStart(c, v) - mainStart(origin, v)
    : mainStart(origin, v) + mainSize(origin, v) - (mainStart(c, v) + mainSize(c, v))
}

const overlap1D = (aStart: number, aSize: number, bStart: number, bSize: number) =>
  Math.max(0, Math.min(aStart + aSize, bStart + bSize) - Math.max(aStart, bStart))

const rectsOverlap = (a: Rect, b: Rect) =>
  overlap1D(a.x, a.w, b.x, b.w) > 0 && overlap1D(a.y, a.h, b.y, b.h) > 0

/**
 * Insider direction gate — the TAG's centroid-angle finding applied as a
 * filter: an overlapping candidate lies in `dir` only when its centroid
 * displacement falls inside the direction's quarter-plane cone (main-axis
 * component ≥ |cross-axis component|, sign included). A near-coincident
 * centroid passes every cone, which is what keeps the FPWD reachability
 * rule for true stacks; an offset contained candidate is reachable via its
 * dominant axis. Without this gate, sliver overlaps hijack the regime:
 * projected arc neighbors overlap by a few pixels (grab handles,
 * perspective), and a panel one full row away would win 'right' with ~zero
 * edge progress while the true right neighbor sat dismissed in the
 * outsider pool (browser-caught in lab 006: doc-4 → deploy).
 */
function insiderCone(origin: Rect, c: Rect, dir: Dir): boolean {
  const dxc = c.x + c.w / 2 - (origin.x + origin.w / 2)
  const dyc = c.y + c.h / 2 - (origin.y + origin.h / 2)
  const main =
    (isVertical(dir) ? dyc : dxc) * (dir === 'down' || dir === 'right' ? 1 : -1)
  const cross = Math.abs(isVertical(dir) ? dxc : dyc)
  return main >= cross - 1e-9
}

/**
 * Cross-axis displacement of the candidate's CENTROID outside the origin's
 * cross-band — 0 while the centroid stays inside. Both regimes use this as
 * their orthogonality measure: band-to-band separation reads 0 for any
 * sliver of cross-overlap, and projected 3D hands out slivers freely (the
 * arc's rows shear apart toward the edges until a row-below neighbor's top
 * grazes the origin's bottom). The centroid says which row something is
 * actually in; the band says only whether the AABBs touch.
 */
function centroidOd(origin: Rect, c: Rect, v: boolean): number {
  const center = crossStart(c, v) + crossSize(c, v) / 2
  return Math.max(
    0,
    crossStart(origin, v) - center,
    center - (crossStart(origin, v) + crossSize(origin, v)),
  )
}

/** Strictly past the origin's trailing edge (touching counts — gap 0). */
export function isOutsider(origin: Rect, c: Rect, dir: Dir): boolean {
  const v = isVertical(dir)
  return dir === 'down' || dir === 'right'
    ? mainStart(c, v) >= mainStart(origin, v) + mainSize(origin, v)
    : mainStart(c, v) + mainSize(c, v) <= mainStart(origin, v)
}

/**
 * The outsider distance function — spatnav's structure, retuned constants:
 *
 *   distance = euclidean + orthogonalDisplacement·Wo − alignedFraction·Wa
 *
 * euclidean is the gap between closest points (pure axis gap when the
 * cross-axis ranges overlap). orthogonalDisplacement is how far the
 * CANDIDATE'S CENTROID sits outside the origin's cross-band — not the
 * band-to-band separation. Band separation reads 0 for any sliver of
 * cross-overlap, and projected 3D hands out slivers freely: the arc's rows
 * shear apart toward the edges until the row-below neighbor's top grazes
 * the origin's bottom, zeroing its penalty while its centroid sits a full
 * row away (browser-caught in lab 006: deploy → right picked doc-5 over
 * synth on a 4px sliver). A same-row neighbor's centroid falls inside the
 * band — od stays 0 where it should. The spec's −√overlapArea term is
 * omitted: the regime split guarantees outsiders share zero area with the
 * origin, so the term is structurally 0 here.
 */
export function outsiderDistance(
  origin: Rect,
  c: Rect,
  dir: Dir,
  weights?: NavWeights,
): number {
  const v = isVertical(dir)
  const wOrtho = weights?.orthogonal ?? 2
  const wAlign = weights?.alignment ?? 5
  const gap =
    dir === 'down' || dir === 'right'
      ? mainStart(c, v) - (mainStart(origin, v) + mainSize(origin, v))
      : mainStart(origin, v) - (mainStart(c, v) + mainSize(c, v))
  const od = centroidOd(origin, c, v)
  const crossOverlap = overlap1D(
    crossStart(origin, v),
    crossSize(origin, v),
    crossStart(c, v),
    crossSize(c, v),
  )
  const aligned =
    crossOverlap / Math.max(Math.min(crossSize(origin, v), crossSize(c, v)), 1e-9)
  return Math.hypot(gap, od) + od * wOrtho - aligned * wAlign
}

/**
 * The §8.4 pipeline: split candidates into regimes against the origin, pick
 * within the winning regime. Insiders (rect overlaps the origin's, leading
 * edge at-or-past the origin's in the direction, centroid inside the
 * direction cone) take absolute precedence — rank by edge progress plus
 * centroid orthogonality (od·Wo — projection bloat makes whole
 * neighborhoods "insiders" at the arc's edge, and raw progress then hands
 * the pick to whichever row leans nearest; true stacks pay no penalty
 * because a contained candidate's centroid is inside the band by
 * definition). Ties by depth (painting order — nearer is on top and wins),
 * then input order. No insiders: outsiders score with the distance
 * function, smallest wins, ties by input order (stable — equal-coordinate
 * panels must not shuffle between keypresses).
 *
 * `candidates` must not include the origin. Returns null when nothing lies
 * in the direction — the caller's no-candidate ladder takes over.
 */
export function directionalPick(
  origin: Rect,
  candidates: readonly NavRect[],
  dir: Dir,
  weights?: NavWeights,
): string | null {
  const v = isVertical(dir)
  const wOrtho = weights?.orthogonal ?? 2
  let insider: { c: NavRect; score: number } | null = null
  let outsider: { c: NavRect; dist: number } | null = null
  for (const c of candidates) {
    if (rectsOverlap(origin, c)) {
      const progress = edgeProgress(origin, c, dir)
      if (progress < 0 || !insiderCone(origin, c, dir)) continue
      const score = progress + centroidOd(origin, c, v) * wOrtho
      if (
        !insider ||
        score < insider.score ||
        (score === insider.score &&
          (c.depth ?? Infinity) < (insider.c.depth ?? Infinity))
      ) {
        insider = { c, score }
      }
      continue
    }
    if (!isOutsider(origin, c, dir)) continue
    const dist = outsiderDistance(origin, c, dir, weights)
    if (!outsider || dist < outsider.dist) outsider = { c, dist }
  }
  return (insider ?? outsider)?.c.id ?? null
}

// ---------------------------------------------------------------------------
// Directional history — Flutter's per-scope push/pop trail, adopted because
// the TAG flagged spatnav's non-reciprocity (right-then-left doesn't return)
// as an unresolved defect. Invalidation matrix, wholesale:
//   opposite direction  → pop; the popped move's origin is the retrace target
//   perpendicular axis  → clear (then the geometric pick runs fresh)
//   same direction      → no-op here; the caller records the new move
//   Tab / external move → caller clears (any focus change we didn't cause
//                         directionally — one rule covers the whole row)
//   unmounted entry     → the popped target fails validation: clear the
//                         whole trail, it describes a world that's gone
// A retrace is a pop, never also a push — the move pair annihilates, so
// ping-ponging cannot grow the stack.

export interface DirectionalHistory {
  /**
   * Consult the trail for a press in `dir` BEFORE picking geometrically.
   * Returns the id to retrace to, or null (caller falls through to the
   * geometric pick). `valid` guards against retracing to an unmounted or
   * unprojectable unit.
   */
  onArrow(dir: Dir, valid: (id: string) => boolean): string | null
  /** Record a geometric move FROM `from` in `dir` — only after focus
   *  actually moved. Retraces are never recorded. */
  record(from: string, dir: Dir): void
  clear(): void
  /** Trail length — for tests and debug HUDs. */
  size(): number
}

export function createDirectionalHistory(): DirectionalHistory {
  let moves: { from: string; dir: Dir }[] = []
  return {
    onArrow(dir, valid) {
      const top = moves[moves.length - 1]
      if (!top) return null
      if (top.dir === OPPOSITE[dir]) {
        moves.pop()
        if (valid(top.from)) return top.from
        moves = []
        return null
      }
      if (isVertical(top.dir) !== isVertical(dir)) moves = []
      return null
    },
    record(from, dir) {
      moves.push({ from, dir })
    },
    clear() {
      moves = []
    },
    size() {
      return moves.length
    },
  }
}
