import { describe, expect, it } from 'vitest'
import { arcLayout } from './arcLayout'

describe('arcLayout', () => {
  const opts = {
    cols: 11,
    rows: 3,
    radius: 7,
    span: (210 * Math.PI) / 180,
    rowYs: [0.75, 2.31, 3.87],
  }

  it('produces rows × cols slots, row-major', () => {
    const slots = arcLayout(opts)
    expect(slots).toHaveLength(33)
    expect(slots[0]).toMatchObject({ row: 0, col: 0 })
    expect(slots[11]).toMatchObject({ row: 1, col: 0 })
  })

  it('keeps every slot exactly on the cylinder radius', () => {
    for (const s of arcLayout(opts)) {
      expect(Math.hypot(s.position[0], s.position[2])).toBeCloseTo(7, 10)
      expect(s.position[1]).toBe(opts.rowYs[s.row])
    }
  })

  it('centers the sweep: middle column sits dead ahead at -z', () => {
    const slots = arcLayout(opts)
    const mid = slots.find((s) => s.row === 0 && s.col === 5)!
    expect(mid.angle).toBeCloseTo(0, 10)
    expect(mid.position[0]).toBeCloseTo(0, 10)
    expect(mid.position[2]).toBeCloseTo(-7, 10)
  })

  it('spans symmetrically and stays inside the requested arc', () => {
    const slots = arcLayout(opts)
    const angles = slots.map((s) => s.angle)
    expect(Math.min(...angles)).toBeCloseTo(-opts.span / 2, 10)
    expect(Math.max(...angles)).toBeCloseTo(opts.span / 2, 10)
  })

  it('rejects mismatched rowYs', () => {
    expect(() => arcLayout({ ...opts, rowYs: [1] })).toThrow()
  })
})
