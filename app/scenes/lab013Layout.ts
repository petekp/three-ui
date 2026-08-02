// Lab 013 — the geometry, in ONE place, in CSS pixels.
//
// Every rect in this lab exists twice: once as a rounded rect in a distance
// field (glass) and once as an absolutely-positioned DOM box (ink). Those two
// have to agree to the pixel or the text slides off its own bubble, so they
// are not authored twice — they are authored here, in px, and each consumer
// converts at its own edge (`w()` for the shader, `css()` for the DOM).
//
// The panel-local convention is the shader's: origin at the panel's centre,
// +y UP, units = CSS px until `w()` divides them down to world units. The DOM
// convention is the browser's: origin top-left, +y DOWN. `css()` is the only
// place that flip happens.

/** CSS px per world unit. */
export const PX = 175

/** px -> world units. */
export const w = (px: number) => px / PX

// ---- the app frame ------------------------------------------------------
// The split the lab is named for: 1/6 and 5/6, which is why the rail and the
// pane are authored as 240 and 1200 rather than as fractions of a total.

export const RAIL_W = 240
export const PANE_W = 1200
export const SPLIT_GAP = 28
export const APP_W = RAIL_W + PANE_W + SPLIT_GAP  // 1468
export const APP_H = 800

/** Panel-local x of each pane's centre, measured in the SHELL's frame. */
export const RAIL_CX = -APP_W / 2 + RAIL_W / 2
export const PANE_CX = APP_W / 2 - PANE_W / 2
export const APP_HH = APP_H / 2
export const PANE_R = 26

// ---- the sign-in card ---------------------------------------------------
// The shell's whole field starts here: BOTH panes are this rect, coincident.
// A union of two identical distances is that distance, so frame zero is a
// card and nothing in the shader knows it is about to become a layout.

export const CARD_W = 360
export const CARD_H = 460
export const CARD_R = 18

// ---- the rail -----------------------------------------------------------

export const RAIL_PAD = 18
export const RAIL_ROW_W = RAIL_W - RAIL_PAD * 2
export const RAIL_HEAD_H = 60
export const RAIL_ROW_H = 108
export const RAIL_ROW_GAP = 14
/** Distance from the rail's top edge to the header's top edge. */
export const RAIL_TOP = 22

// ---- the message column -------------------------------------------------

export const COMPOSER_H = 92
export const COMPOSER_W = PANE_W - 48
/** Gap between the composer's top edge and the message column's bottom. */
export const COMPOSER_GAP = 22
export const PANE_PAD = 24

/** The message column's own panel: the pane minus the composer's band. */
export const MSG_W = PANE_W
export const MSG_H = APP_H - PANE_PAD * 2 - COMPOSER_H - COMPOSER_GAP
/** Its centre, in the SHELL's frame — pushed up by the composer below it. */
export const MSG_CY = APP_HH - PANE_PAD - MSG_H / 2
export const COMPOSER_CY = -APP_HH + PANE_PAD + COMPOSER_H / 2

export const BUBBLE_LINE = 23
export const BUBBLE_PAD_Y = 14
/** The "assistant"/"you" caption above each bubble's text. */
export const BUBBLE_LABEL_H = 16
export const BUBBLE_GAP = 18
export const BUBBLE_R = 20
export const BUBBLE_W_AI = 620
export const BUBBLE_W_USER = 440

/**
 * How far the content panels float in front of the shell. Small on purpose:
 * "emerged from the surface" is a different statement than "hovering over
 * it", and the refraction reads the difference — at this distance a thread
 * row still bends the rail's own glass behind it.
 */
export const LIFT = 0.11

// ---- shapes -------------------------------------------------------------

export interface Box {
  /** Centre, panel-local px, +y up. */
  cx: number
  cy: number
  /** Half extents, px. */
  hw: number
  hh: number
  r: number
}

/** A Box as CSS `left/top/width/height` inside a panel of the given size. */
export function css(b: Box, panelW: number, panelH: number) {
  return {
    position: 'absolute' as const,
    left: panelW / 2 + b.cx - b.hw,
    top: panelH / 2 - b.cy - b.hh,
    width: b.hw * 2,
    height: b.hh * 2,
  }
}

// ---- the rail's rows ----------------------------------------------------

/**
 * Header strip plus `n` thread rows, laid down the rail from its top edge.
 * Index 0 is the header; the rows follow. Panel-local to the RAIL panel.
 */
export function railBoxes(n: number): Box[] {
  const out: Box[] = []
  let top = APP_HH - RAIL_TOP
  out.push({
    cx: 0,
    cy: top - RAIL_HEAD_H / 2,
    hw: RAIL_ROW_W / 2,
    hh: RAIL_HEAD_H / 2,
    r: 16,
  })
  top -= RAIL_HEAD_H + RAIL_ROW_GAP + 8
  for (let i = 0; i < n; i++) {
    out.push({
      cx: 0,
      cy: top - RAIL_ROW_H / 2,
      hw: RAIL_ROW_W / 2,
      hh: RAIL_ROW_H / 2,
      r: 18,
    })
    top -= RAIL_ROW_H + RAIL_ROW_GAP
  }
  return out
}

// ---- the message column's bubbles ---------------------------------------

export interface Msg {
  id: number
  from: 'ai' | 'user'
  text: string
  /** Authored, not measured: the glass rect and the DOM box must agree, and
   *  a wrapped line count is the one number both of them need. */
  lines: number
}

export function bubbleH(m: Msg) {
  return m.lines * BUBBLE_LINE + BUBBLE_PAD_Y * 2 + BUBBLE_LABEL_H
}

/**
 * Bubbles stacked bottom-up inside the message panel, alternating sides.
 * Bottom-aligned like a real transcript: the newest message sits on the
 * composer and the column grows upward off the top of the panel.
 */
export function bubbleBoxes(msgs: Msg[]): Box[] {
  const heights = msgs.map(bubbleH)
  const out: Box[] = []
  // Walk up from the panel's bottom edge; the oldest messages simply run off
  // the top, which is what a transcript does.
  let y = -MSG_H / 2 + PANE_PAD
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    const h = heights[i]
    const hw = (m.from === 'ai' ? BUBBLE_W_AI : BUBBLE_W_USER) / 2
    out[i] = {
      cx: m.from === 'ai' ? -MSG_W / 2 + PANE_PAD + hw : MSG_W / 2 - PANE_PAD - hw,
      cy: y + h / 2,
      hw,
      hh: h / 2,
      r: BUBBLE_R,
    }
    y += h + BUBBLE_GAP
  }
  return out
}
