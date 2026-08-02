// @vitest-environment happy-dom
//
// Surface chrome: the parser, the resolver, and the walk.
//
// The parser fixtures are REAL computed-style strings, captured from Chrome
// against the lab 014 card (2026-08-02) — computed box-shadow serializes
// color-FIRST with commas inside the function, which is exactly the form a
// naive comma-split shreds. Layout-dependent radii resolution is tested
// through the pure `resolveRadii` (happy-dom has no layout engine); the walk
// is tested for chain-following and branch-stopping, with the shadow read
// from inline styles.

import { describe, expect, it } from 'vitest'
import {
  chromeEquals,
  measureSurfaceChrome,
  parseBoxShadow,
  resolveRadii,
  surfaceRadiusSd,
} from './surfaceChrome'

describe('parseBoxShadow', () => {
  it('parses the lab card computed form: color-first, two layers, negative spread', () => {
    const layers = parseBoxShadow(
      'rgba(22, 21, 15, 0.04) 0px 1px 0px 0px, rgba(22, 21, 15, 0.3) 0px 6px 18px -12px',
    )
    expect(layers).toHaveLength(2)
    expect(layers[0]).toEqual({
      x: 0,
      y: 1,
      blur: 0,
      spread: 0,
      color: [22 / 255, 21 / 255, 15 / 255, 0.04],
    })
    expect(layers[1].blur).toBe(18)
    expect(layers[1].spread).toBe(-12)
    expect(layers[1].color[3]).toBeCloseTo(0.3)
  })

  it('parses authored form with color last and defaults', () => {
    const layers = parseBoxShadow('0 2px 8px #00000040')
    expect(layers).toHaveLength(1)
    expect(layers[0].x).toBe(0)
    expect(layers[0].y).toBe(2)
    expect(layers[0].blur).toBe(8)
    expect(layers[0].spread).toBe(0)
    expect(layers[0].color[0]).toBe(0)
    expect(layers[0].color[3]).toBeCloseTo(0x40 / 255)
  })

  it('drops inset layers — they are painted inside the box and already in the texture', () => {
    const layers = parseBoxShadow(
      'inset 0px 2px 4px rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.2) 0px 4px 12px 0px',
    )
    expect(layers).toHaveLength(1)
    expect(layers[0].y).toBe(4)
  })

  it('returns [] for none and empty', () => {
    expect(parseBoxShadow('none')).toEqual([])
    expect(parseBoxShadow('')).toEqual([])
  })

  it('missing color means currentColor — falls back to opaque black ink', () => {
    const layers = parseBoxShadow('1px 2px 3px')
    expect(layers).toHaveLength(1)
    expect(layers[0].color).toEqual([0, 0, 0, 1])
  })
})

describe('resolveRadii', () => {
  it('resolves px values straight through', () => {
    expect(resolveRadii(['14px', '14px', '14px', '14px'], 560, 170)).toEqual([14, 14, 14, 14])
  })

  it('resolves % against the shorter side', () => {
    const [tl] = resolveRadii(['50%', '0px', '0px', '0px'], 200, 100)
    expect(tl).toBe(50)
  })

  it('takes the x component of an elliptical corner', () => {
    const [tl] = resolveRadii(['24px 12px', '0px', '0px', '0px'], 200, 100)
    expect(tl).toBe(24)
  })

  it('applies the CSS overlap reduction uniformly', () => {
    // Two 80px radii on a 100px edge: scale everything by 100/160.
    const r = resolveRadii(['80px', '80px', '0px', '0px'], 100, 300)
    expect(r[0]).toBeCloseTo(50)
    expect(r[1]).toBeCloseTo(50)
  })

  it('yields zeros for a box with no layout', () => {
    expect(resolveRadii(['14px', '14px', '14px', '14px'], 0, 0)).toEqual([0, 0, 0, 0])
  })
})

describe('surfaceRadiusSd', () => {
  const radii: [number, number, number, number] = [14, 14, 14, 14]

  it('is negative inside, positive outside the corner arc', () => {
    // v = 1 is content TOP (flipY). Dead center: deep inside.
    expect(surfaceRadiusSd(0.5, 0.5, 560, 170, radii)).toBeLessThan(0)
    // The exact texture corner (u=0, v=1 → top-left): outside the 14px arc
    // by 14·(√2−1) ≈ 5.8px.
    expect(surfaceRadiusSd(0, 1, 560, 170, radii)).toBeCloseTo(14 * (Math.SQRT2 - 1), 3)
    // Edge midpoints sit ON the boundary.
    expect(surfaceRadiusSd(0.5, 1, 560, 170, radii)).toBeCloseTo(0, 6)
    expect(surfaceRadiusSd(0, 0.5, 560, 170, radii)).toBeCloseTo(0, 6)
  })

  it('respects per-corner asymmetry in flipY orientation', () => {
    const lop: [number, number, number, number] = [40, 0, 0, 0]
    // Top-left corner point: 40px arc pushes it well outside…
    expect(surfaceRadiusSd(0, 1, 200, 200, lop)).toBeGreaterThan(10)
    // …while the square top-right corner point is exactly on the boundary.
    expect(surfaceRadiusSd(1, 1, 200, 200, lop)).toBeCloseTo(0, 6)
  })
})

describe('measureSurfaceChrome', () => {
  it('walks a single-child chain to the element that owns the shadow', () => {
    const root = document.createElement('div')
    const host = document.createElement('div')
    const card = document.createElement('div')
    card.style.boxShadow = 'rgba(22, 21, 15, 0.3) 0px 6px 18px -12px'
    host.appendChild(card)
    root.appendChild(host)
    document.body.appendChild(root)
    const chrome = measureSurfaceChrome(root)
    expect(chrome.shadow).toHaveLength(1)
    expect(chrome.shadow[0].blur).toBe(18)
    root.remove()
  })

  it('stops at a branching level — a composite root has no single chrome', () => {
    const root = document.createElement('div')
    for (let i = 0; i < 2; i++) {
      const child = document.createElement('div')
      child.style.boxShadow = 'rgba(0, 0, 0, 0.5) 0px 2px 4px 0px'
      root.appendChild(child)
    }
    document.body.appendChild(root)
    const chrome = measureSurfaceChrome(root)
    expect(chrome.shadow).toEqual([])
    root.remove()
  })
})

describe('chromeEquals', () => {
  it('compares radii and layers by value', () => {
    const a = {
      radii: [14, 14, 14, 14] as [number, number, number, number],
      shadow: parseBoxShadow('rgba(0, 0, 0, 0.3) 0px 6px 18px -12px'),
    }
    const b = {
      radii: [14, 14, 14, 14] as [number, number, number, number],
      shadow: parseBoxShadow('rgba(0, 0, 0, 0.3) 0px 6px 18px -12px'),
    }
    expect(chromeEquals(a, b)).toBe(true)
    b.radii[2] = 12
    expect(chromeEquals(a, b)).toBe(false)
  })
})
