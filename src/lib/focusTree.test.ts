import { describe, expect, it } from 'vitest'
import {
  createFocusTree,
  createMemoryStack,
  entryPick,
  interiorBoundary,
  needsReframe,
  readingOrder,
  reframeDelta,
  sceneRing,
  visibleFraction,
  type MemberInfo,
  type OrderRect,
  type Viewport,
} from './focusTree'

const member = (id: string, order?: number): MemberInfo<null> => ({
  id,
  kind: 'composite',
  order,
  data: null,
})

describe('focusTree member ordering', () => {
  it('returns members in registration order when no explicit orders', () => {
    const t = createFocusTree<null>()
    t.registerGroup('g')
    t.registerMember('g', member('b'))
    t.registerMember('g', member('a'))
    t.registerMember('g', member('c'))
    expect(t.members('g').map((m) => m.id)).toEqual(['b', 'a', 'c'])
  })

  it('sorts explicitly ordered members first, unordered after (Flutter OrderedTraversalPolicy)', () => {
    const t = createFocusTree<null>()
    t.registerGroup('g')
    t.registerMember('g', member('late'))
    t.registerMember('g', member('second', 2))
    t.registerMember('g', member('first', 1))
    t.registerMember('g', member('unordered'))
    expect(t.members('g').map((m) => m.id)).toEqual(['first', 'second', 'late', 'unordered'])
  })

  it('breaks order ties by registration sequence (stable)', () => {
    const t = createFocusTree<null>()
    t.registerGroup('g')
    t.registerMember('g', member('x', 5))
    t.registerMember('g', member('y', 5))
    t.registerMember('g', member('z', 5))
    expect(t.members('g').map((m) => m.id)).toEqual(['x', 'y', 'z'])
  })

  it('re-registering a member updates in place without duplicating', () => {
    const t = createFocusTree<null>()
    t.registerGroup('g')
    t.registerMember('g', member('a'))
    t.registerMember('g', member('a', 1))
    expect(t.members('g')).toHaveLength(1)
    expect(t.members('g')[0].order).toBe(1)
  })

  it('lists groups in registration order', () => {
    const t = createFocusTree<null>()
    t.registerGroup('two')
    t.registerGroup('one')
    expect(t.groups().map((g) => g.id)).toEqual(['two', 'one'])
  })
})

describe('focusTree memory stack', () => {
  const build = () => {
    const t = createFocusTree<null>()
    t.registerGroup('g')
    for (const id of ['a', 'b', 'c']) t.registerMember('g', member(id))
    return t
  }

  it('recalls the most recently remembered member', () => {
    const t = build()
    t.remember('g', 'a')
    t.remember('g', 'c')
    expect(t.recall('g', () => true)?.id).toBe('c')
  })

  it('dedupes on remember — re-focusing moves to top instead of stacking', () => {
    const t = build()
    t.remember('g', 'a')
    t.remember('g', 'b')
    t.remember('g', 'a')
    // a is top; popping it must land on b (not a second stale a)
    expect(t.recall('g', (m) => m.id !== 'a')?.id).toBe('b')
  })

  it('lazily pops invalid entries and lands on next-most-recent (Flutter cleanout)', () => {
    const t = build()
    t.remember('g', 'a')
    t.remember('g', 'b')
    t.remember('g', 'c')
    // c and b have become unfocusable since they were remembered
    const valid = (m: MemberInfo<null>) => m.id === 'a'
    expect(t.recall('g', valid)?.id).toBe('a')
    // the pops are destructive: even with a permissive validator, b/c are gone
    expect(t.recall('g', () => true)?.id).toBe('a')
  })

  it('returns null when the stack exhausts — caller falls back to first-in-order', () => {
    const t = build()
    t.remember('g', 'a')
    expect(t.recall('g', () => false)).toBeNull()
    expect(t.recall('g', () => true)).toBeNull()
  })

  it('clearMemory forgets everything (Escape-ascend contract)', () => {
    const t = build()
    t.remember('g', 'b')
    t.clearMemory('g')
    expect(t.recall('g', () => true)).toBeNull()
  })

  it('unregisterMember scrubs the memory stack eagerly', () => {
    const t = build()
    t.remember('g', 'a')
    t.remember('g', 'b')
    t.unregisterMember('g', 'b')
    expect(t.recall('g', () => true)?.id).toBe('a')
  })

  it('ignores remember() for unknown members', () => {
    const t = build()
    t.remember('g', 'ghost')
    expect(t.recall('g', () => true)).toBeNull()
  })
})

describe('createMemoryStack — the shared discipline', () => {
  it('dedupes by identity, not equality', () => {
    const s = createMemoryStack<{ v: number }>()
    const a = { v: 1 }
    const twin = { v: 1 }
    s.remember(a)
    s.remember(twin)
    s.remember(a) // a moves to top; twin must remain beneath it
    expect(s.recall((x) => x !== a)).toBe(twin)
  })

  it('recall pops rejects destructively', () => {
    const s = createMemoryStack<string>()
    s.remember('x')
    s.remember('y')
    expect(s.recall((v) => v === 'x')).toBe('x') // y popped on the way down
    expect(s.recall(() => true)).toBe('x')
  })

  it('forget removes mid-stack entries', () => {
    const s = createMemoryStack<string>()
    s.remember('a')
    s.remember('b')
    s.remember('c')
    s.forget('b')
    expect(s.recall((v) => v !== 'c')).toBe('a')
  })

  it('clear empties, recall returns null', () => {
    const s = createMemoryStack<string>()
    s.remember('a')
    s.clear()
    expect(s.recall(() => true)).toBeNull()
  })
})

describe('readingOrder — Flutter band algorithm', () => {
  const r = (id: string, x: number, y: number, w = 100, h = 100): OrderRect => ({ id, x, y, w, h })

  it('orders a single row left to right regardless of input order', () => {
    expect(readingOrder([r('c', 200, 0), r('a', 0, 0), r('b', 100, 0)])).toEqual(['a', 'b', 'c'])
  })

  it('orders rows top to bottom, each row left to right', () => {
    expect(
      readingOrder([r('d', 100, 200), r('b', 100, 0), r('c', 0, 200), r('a', 0, 0)]),
    ).toEqual(['a', 'b', 'c', 'd'])
  })

  it('within a vertically-overlapping band the left rect wins even when slightly lower', () => {
    // b is HIGHER than c but c is left of b, and they overlap vertically →
    // same band → c first. A naive y-sort would emit a, b, c.
    const rects = [r('a', 0, 0), r('b', 200, 20), r('c', 0, 40)]
    expect(readingOrder(rects)).toEqual(['a', 'c', 'b'])
  })

  it('re-anchors the band after each pick (one removal per iteration)', () => {
    // Flutter's loop removes ONE node per pick and re-derives the band from
    // the new topmost ("removing the previously picked node will expose a
    // new band"). After a1 is placed, b1 (top 60) anchors band [60,160);
    // a2 (top 150) overlaps that band and sits further left → precedes b1.
    // A whole-band-emission model would give a1, b1, a2 — that is NOT the
    // reference semantics.
    const rects = [r('a1', 0, 0, 100, 100), r('b1', 200, 60, 100, 100), r('a2', 0, 150, 100, 100)]
    expect(readingOrder(rects)).toEqual(['a1', 'a2', 'b1'])
  })

  it('band membership requires actual overlap, not touching edges', () => {
    // b starts exactly where a ends vertically — separate bands.
    expect(readingOrder([r('b', 0, 100), r('a', 200, 0)])).toEqual(['a', 'b'])
  })

  it('is stable: identical rects keep input order', () => {
    const rects = [r('first', 50, 50), r('second', 50, 50), r('third', 50, 50)]
    expect(readingOrder(rects)).toEqual(['first', 'second', 'third'])
  })

  it('handles empty input', () => {
    expect(readingOrder([])).toEqual([])
  })

  it('a tall rect anchors a band only while it is topmost', () => {
    // tall spans y 0..300 and wins its band by x. Once removed, the band
    // re-derives from short1's extent [0,100) which no longer reaches
    // short2 — so short1 precedes short2 despite short2 being further left.
    const rects = [
      r('short1', 300, 0, 100, 100),
      r('tall', 0, 0, 100, 300),
      r('short2', 150, 200, 100, 100),
    ]
    expect(readingOrder(rects)).toEqual(['tall', 'short1', 'short2'])
  })
})

describe('interiorBoundary (member-boundary Tab routing)', () => {
  // seqs model a group's members: a composite contributes its tabbables in
  // DOM order, a leaf contributes its single proxy. Elements are strings —
  // the decision is identity-based, never DOM-based.

  it('single composite: native mid-sequence, exit past last, ascend before first', () => {
    const seqs = [['a', 'b', 'c']]
    expect(interiorBoundary(seqs, 'a', 1)).toEqual({ type: 'native' })
    expect(interiorBoundary(seqs, 'b', 1)).toEqual({ type: 'native' })
    expect(interiorBoundary(seqs, 'c', 1)).toEqual({ type: 'exit' })
    expect(interiorBoundary(seqs, 'a', -1)).toEqual({ type: 'ascend' })
    expect(interiorBoundary(seqs, 'c', -1)).toEqual({ type: 'native' })
  })

  it('composite then leaf: Tab continues from last tabbable onto the proxy', () => {
    const seqs = [['a', 'b'], ['dial']]
    expect(interiorBoundary(seqs, 'b', 1)).toEqual({ type: 'move', to: 'dial' })
    expect(interiorBoundary(seqs, 'dial', 1)).toEqual({ type: 'exit' })
    expect(interiorBoundary(seqs, 'dial', -1)).toEqual({ type: 'move', to: 'b' })
    expect(interiorBoundary(seqs, 'a', -1)).toEqual({ type: 'ascend' })
  })

  it('leaf-only group: every press is a boundary decision', () => {
    const seqs = [['p'], ['q']]
    expect(interiorBoundary(seqs, 'p', 1)).toEqual({ type: 'move', to: 'q' })
    expect(interiorBoundary(seqs, 'q', 1)).toEqual({ type: 'exit' })
    expect(interiorBoundary(seqs, 'q', -1)).toEqual({ type: 'move', to: 'p' })
    expect(interiorBoundary(seqs, 'p', -1)).toEqual({ type: 'ascend' })
  })

  it('empty members (a read-only panel) are skipped, not stumbled on', () => {
    const seqs: string[][] = [['a'], [], ['dial']]
    expect(interiorBoundary(seqs, 'a', 1)).toEqual({ type: 'move', to: 'dial' })
    expect(interiorBoundary(seqs, 'dial', -1)).toEqual({ type: 'move', to: 'a' })
  })

  it('composite, leaf, composite: boundaries on both proxy sides', () => {
    const seqs = [['a'], ['dial'], ['b', 'c']]
    expect(interiorBoundary(seqs, 'a', 1)).toEqual({ type: 'move', to: 'dial' })
    expect(interiorBoundary(seqs, 'dial', 1)).toEqual({ type: 'move', to: 'b' })
    expect(interiorBoundary(seqs, 'b', 1)).toEqual({ type: 'native' })
    expect(interiorBoundary(seqs, 'c', 1)).toEqual({ type: 'exit' })
    expect(interiorBoundary(seqs, 'b', -1)).toEqual({ type: 'move', to: 'dial' })
    expect(interiorBoundary(seqs, 'c', -1)).toEqual({ type: 'native' })
  })

  it('unknown active element never fights the browser', () => {
    expect(interiorBoundary([['a']], 'ghost', 1)).toEqual({ type: 'native' })
    expect(interiorBoundary([], 'ghost', -1)).toEqual({ type: 'native' })
  })
})

describe('registration order tolerance (React child effects run bottom-up)', () => {
  it('members registered before their group survive registerGroup', () => {
    const t = createFocusTree<null>()
    t.registerMember('g', member('dial'))
    t.registerGroup('g', 'Synth')
    expect(t.members('g').map((m) => m.id)).toEqual(['dial'])
    expect(t.groups()).toEqual([{ id: 'g', label: 'Synth' }])
  })

  it('unordered members sort composites first regardless of arrival time', () => {
    const t = createFocusTree<null>()
    t.registerGroup('g')
    // The satellite dial registers at child-effect time; the Surface's
    // composite arrives late (its source element is created async).
    t.registerMember('g', { id: 'dial', kind: 'leaf', data: null })
    t.registerMember('g', { id: 'panel', kind: 'composite', data: null })
    expect(t.members('g').map((m) => m.id)).toEqual(['panel', 'dial'])
  })

  it('explicit order overrides the composite-first default', () => {
    const t = createFocusTree<null>()
    t.registerGroup('g')
    t.registerMember('g', { id: 'dial', kind: 'leaf', order: 0, data: null })
    t.registerMember('g', { id: 'panel', kind: 'composite', order: 1, data: null })
    expect(t.members('g').map((m) => m.id)).toEqual(['dial', 'panel'])
  })
})

describe('sceneRing (authored order beats geometry)', () => {
  it('sorts authored groups by order, geometry gets no vote', () => {
    const ring = sceneRing(
      [{ id: 'a', order: 2 }, { id: 'b', order: 0 }, { id: 'c', order: 1 }],
      ['a', 'c', 'b'], // scrambled camera order — must be ignored
    )
    expect(ring).toEqual(['b', 'c', 'a'])
  })

  it('unordered groups follow the geometric order, after every authored one', () => {
    const ring = sceneRing([{ id: 'a', order: 0 }, { id: 'x' }, { id: 'y' }], ['y', 'x'])
    expect(ring).toEqual(['a', 'y', 'x'])
  })

  it('unordered groups geometry could not place trail in registration order', () => {
    const ring = sceneRing([{ id: 'x' }, { id: 'y' }, { id: 'z' }], ['y'])
    expect(ring).toEqual(['y', 'x', 'z'])
  })

  it('breaks order ties by registration sequence (stable)', () => {
    expect(sceneRing([{ id: 'a', order: 1 }, { id: 'b', order: 1 }], [])).toEqual(['a', 'b'])
  })

  it('tolerates authored ids appearing in the geometric list without duplicating', () => {
    const ring = sceneRing([{ id: 'a', order: 0 }, { id: 'x' }], ['a', 'x', 'a'])
    expect(ring).toEqual(['a', 'x'])
  })
})

describe('entryPick (first Tab selects what the user is looking at)', () => {
  const vp: Viewport = { w: 1000, h: 600 }
  const r = (id: string, x: number, y: number, w = 100, h = 100): OrderRect => ({ id, x, y, w, h })

  it('picks the fully-visible rect nearest the viewport center', () => {
    expect(entryPick([r('edge', 0, 0), r('center', 450, 250)], vp)).toBe('center')
  })

  it('any fully-visible rect beats any partially-visible one, regardless of distance', () => {
    // 'half' straddles the right edge NEAR center height; 'corner' is far
    // away but entirely on screen. Entry must never select a clipped thing.
    expect(entryPick([r('half', 950, 250), r('corner', 0, 0, 50, 50)], vp)).toBe('corner')
  })

  it('with only partials, the most-visible fraction wins', () => {
    expect(entryPick([r('sliver', 990, 0, 200, 100), r('mostly', 900, 0, 200, 100)], vp)).toBe(
      'mostly',
    )
  })

  it('fraction ties break toward the viewport center', () => {
    // Both are exactly half visible; 'near' is at center height.
    expect(entryPick([r('far', 950, 0, 100, 100), r('near', 950, 250, 100, 100)], vp)).toBe('near')
  })

  it('returns null when nothing projects into the viewport', () => {
    expect(entryPick([r('gone', 2000, 0), r('behind', -500, -500, 100, 100)], vp)).toBeNull()
  })

  it('returns null for an empty scene', () => {
    expect(entryPick([], vp)).toBeNull()
  })
})

describe('focus-visibility geometry (the ported scroll-into-view obligation)', () => {
  const vp: Viewport = { w: 1000, h: 600 }

  it('visibleFraction: full, half, none, degenerate', () => {
    expect(visibleFraction({ x: 100, y: 100, w: 100, h: 100 }, vp)).toBe(1)
    expect(visibleFraction({ x: 950, y: 100, w: 100, h: 100 }, vp)).toBe(0.5)
    expect(visibleFraction({ x: 1200, y: 100, w: 100, h: 100 }, vp)).toBe(0)
    expect(visibleFraction({ x: 0, y: 0, w: 0, h: 100 }, vp)).toBe(0)
  })

  it('needsReframe: mostly-hidden rects violate, fully-visible ones do not', () => {
    expect(needsReframe({ x: 970, y: 100, w: 100, h: 100 }, vp)).toBe(true) // 30% visible
    expect(needsReframe({ x: 100, y: 100, w: 100, h: 100 }, vp)).toBe(false)
    expect(needsReframe({ x: 1100, y: 100, w: 100, h: 100 }, vp)).toBe(true) // fully off
  })

  it('needsReframe: a rect dominating the screen is being looked at, not lost', () => {
    // 15% visible fraction, but it covers the viewport center — a descended
    // panel overflowing the frame must not trigger a reframe fight.
    expect(needsReframe({ x: -500, y: -500, w: 2000, h: 2000 }, vp)).toBe(false)
  })

  it('reframeDelta: zero inside, minimal pull-back at edges (margin 24)', () => {
    expect(reframeDelta({ x: 100, y: 100, w: 100, h: 100 }, vp)).toEqual({ dx: 0, dy: 0 })
    expect(reframeDelta({ x: 950, y: 100, w: 100, h: 100 }, vp)).toEqual({ dx: -74, dy: 0 })
    expect(reframeDelta({ x: -50, y: 100, w: 100, h: 100 }, vp)).toEqual({ dx: 74, dy: 0 })
    expect(reframeDelta({ x: 100, y: 550, w: 100, h: 100 }, vp)).toEqual({ dx: 0, dy: -74 })
  })

  it('reframeDelta: an axis the rect outsizes centers instead of thrashing', () => {
    const d = reframeDelta({ x: 0, y: 100, w: 2000, h: 100 }, vp)
    expect(d.dx).toBe(-500) // center 1000 → viewport center 500
    expect(d.dy).toBe(0)
  })
})
