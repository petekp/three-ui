// Pure layout math for Lab 006's amphitheater: rows × cols panel slots on a
// cylindrical arc centered on the origin, facing inward. θ=0 is straight
// ahead of the default camera (-z); positive angles sweep to the viewer's
// right. Pure so it's testable without three.js scene machinery.

export interface ArcSlot {
  position: [number, number, number]
  /** Arc angle in radians, 0 = straight ahead (-z). */
  angle: number
  row: number
  col: number
}

export interface ArcLayoutOptions {
  cols: number
  rows: number
  radius: number
  /** Total angular sweep in radians, centered on θ=0. */
  span: number
  /** World-space y for each row's panel center; length must equal rows. */
  rowYs: number[]
}

export function arcLayout({ cols, rows, radius, span, rowYs }: ArcLayoutOptions): ArcSlot[] {
  if (rowYs.length !== rows) {
    throw new Error(`arcLayout: rowYs has ${rowYs.length} entries for ${rows} rows`)
  }
  const slots: ArcSlot[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = cols === 1 ? 0.5 : col / (cols - 1)
      const angle = -span / 2 + span * t
      slots.push({
        position: [radius * Math.sin(angle), rowYs[row], -radius * Math.cos(angle)],
        angle,
        row,
        col,
      })
    }
  }
  return slots
}
