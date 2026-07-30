import { describe, expect, it } from 'vitest'
import { radioIsStop, sortByTabOrder } from './tabbables'

// The DOM-walking half of tabbables.ts is browser-verified (vitest has no
// DOM here); these pin the pure ordering + radio-collapse rules.

describe('sortByTabOrder', () => {
  const e = (tabIndex: number, seq: number) => ({ tabIndex, seq })

  it('keeps document order for the tabindex-0 crowd', () => {
    expect(sortByTabOrder([e(0, 0), e(0, 1), e(0, 2)]).map((x) => x.seq)).toEqual([0, 1, 2])
  })

  it('puts positive tabindexes first, ascending', () => {
    const sorted = sortByTabOrder([e(0, 0), e(2, 1), e(1, 2), e(0, 3)])
    expect(sorted.map((x) => x.seq)).toEqual([2, 1, 0, 3])
  })

  it('breaks positive-tabindex ties by document order (stable)', () => {
    const sorted = sortByTabOrder([e(1, 0), e(1, 1), e(1, 2)])
    expect(sorted.map((x) => x.seq)).toEqual([0, 1, 2])
  })

  it('treats negative tabIndex as ordinary flow (filtering happened upstream)', () => {
    // tabbables() never passes negatives in; if a caller does, they sort
    // with the zero crowd rather than exploding.
    expect(sortByTabOrder([e(-1, 0), e(0, 1)]).map((x) => x.seq)).toEqual([0, 1])
  })
})

describe('radioIsStop', () => {
  const radios = (...checked: boolean[]) => checked.map((c) => ({ checked: c }))

  it('collapses a group with a checked member to just that member', () => {
    const group = radios(false, true, false)
    expect(group.map((_, i) => radioIsStop(group, i))).toEqual([false, true, false])
  })

  it('leaves every member a stop when none is checked (native Chrome)', () => {
    const group = radios(false, false, false)
    expect(group.map((_, i) => radioIsStop(group, i))).toEqual([true, true, true])
  })

  it('first checked wins if markup illegally checks two', () => {
    const group = radios(false, true, true)
    expect(group.map((_, i) => radioIsStop(group, i))).toEqual([false, true, false])
  })
})
