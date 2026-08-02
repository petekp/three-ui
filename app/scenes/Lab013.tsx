import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SurfaceApp } from 'three-ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  GlassSdfCompositor,
  MAX_RECTS,
  MAX_RIPPLES,
  SdfGlassPanel,
  sdfPanelLabels,
  sdfPanelParams,
  type GlassRect,
  type GlassRipple,
} from './glassSdf'
import {
  APP_H,
  APP_HH,
  BUBBLE_R,
  CARD_H,
  CARD_R,
  CARD_W,
  COMPOSER_CY,
  COMPOSER_H,
  COMPOSER_W,
  LIFT,
  MSG_CY,
  MSG_H,
  MSG_W,
  PANE_CX,
  PANE_R,
  PANE_W,
  PX,
  RAIL_CX,
  RAIL_W,
  bubbleBoxes,
  css,
  railBoxes,
  w,
  type Box,
  type Msg,
} from './lab013Layout'

// Lab 013 — a liquid layout.
//
// Question under test: if the glass is a distance field rather than a mesh
// (lab 012 inc 2), can a LAYOUT be one too? Not a card that fades into two
// cards — one body of glass that a smooth minimum tears into a rail and a
// pane, with a neck that stretches and snaps between them, while the live
// DOM it is carrying stays live the whole way through.
//
// The sequence:
//
//   1. A sign-in card. Its glass is TWO coincident rounded rects — and
//      smin(d, d, k) is d - k/4, i.e. the same card grown by a quarter of the
//      blend radius, which at k=0.035 is a pixel and a half. Frame zero
//      already contains the layout; it just has nowhere to go yet.
//   2. Sign in. The two rects grow to the app's full height and slide to
//      1/6 and 5/6 of its width. Between them the union necks, thins and
//      lets go; the release fires a capillary ripple across both panes
//      (decisions #40 — the same impulse model the beads in lab 012 use).
//   3. Thread rows well UP OUT of the rail, and message bubbles out of the
//      pane, each as another rounded rect joining that panel's field and
//      each stamping a ripple into the shell below it. They are lifted a
//      hair in z — enough that a row refracts the rail's own glass behind
//      it, not enough to read as a floating card.
//   4. Send a message and a new bubble is BORN the same way: a rect grows
//      out of the column, the transcript slides up under it, and the shell
//      rings. There is no enter animation anywhere in this file's CSS.
//
// What makes it possible: a panel's field is now a UNION OF ROUNDED RECTS
// (glassSdfShader.ts), its DOM is framed independently of that field
// (`uInkRect`), and the ink is masked by the field's own coverage — so ONE
// texture can span many separate pieces of glass and simply not be drawn in
// the gaps. The whole rail is one pass. The whole transcript is one pass.
//
// Cost: four screen-space passes (shell, rail, transcript, composer) plus
// one scene render, whatever the layout contains. Adding a message adds a
// rounded rect to a uniform array. Nothing repaints unless the DOM changes.
//
// Console: `window.__lab013` — `signIn()`, `reset()`, `send(text)`,
// `select(i)`, `set(key, value)` (glass knobs, all panels), `ripple(x, y)`.

const APP_Y = 2.5
const APP_Z = 0.7

/** How long the card takes to become a layout. */
const SPLIT_DUR = 1.15
/** How long one rect takes to well up out of its pane. */
const EMERGE_DUR = 0.55

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const easeInOut = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
/** A little overshoot: a surface that wells up does not stop dead. */
const easeOutBack = (x: number) => {
  const c = 1.1
  const u = x - 1
  return 1 + (c + 1) * u * u * u + c * u * u
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// ---- content ------------------------------------------------------------

interface Thread {
  id: number
  title: string
  snippet: string
  time: string
  msgs: Msg[]
}

const THREADS: Thread[] = [
  {
    id: 0,
    title: 'Refraction budget',
    snippet: 'four passes, one scene render',
    time: 'now',
    msgs: [
      {
        id: 1,
        from: 'ai',
        text: 'The compositor renders the world once, then walks the panels far to near. Each pass reads what the last one wrote, so refraction through refraction is free.',
        lines: 3,
      },
      { id: 2, from: 'user', text: 'And the panel count is the pass count?', lines: 1 },
      {
        id: 3,
        from: 'ai',
        text: 'It is. Which is why this whole transcript is a single panel: the bubbles are rounded rects in one distance field, sharing one DOM texture.',
        lines: 3,
      },
      { id: 4, from: 'user', text: 'So a longer thread costs nothing extra.', lines: 1 },
    ],
  },
  {
    id: 1,
    title: 'The neck, and why it snaps',
    snippet: 'smin is not a crossfade',
    time: '4m',
    msgs: [
      {
        id: 1,
        from: 'ai',
        text: 'Two meshes moving apart stop overlapping. Two distances moving apart neck: the blend radius keeps a bridge of glass between them until the gap exceeds it.',
        lines: 3,
      },
      { id: 2, from: 'user', text: 'That is the tear you see at sign-in.', lines: 1 },
      {
        id: 3,
        from: 'ai',
        text: 'And the release is a real event — the CPU watches the sign change and fires a capillary impulse into both panes at the moment it happens.',
        lines: 3,
      },
    ],
  },
  {
    id: 2,
    title: 'Live DOM, still live',
    snippet: 'type into the composer',
    time: '1h',
    msgs: [
      {
        id: 1,
        from: 'ai',
        text: 'Every glyph here is a real rasterized DOM subtree, not a texture atlas. Click the composer and type — the caret is the browser’s.',
        lines: 2,
      },
      { id: 2, from: 'user', text: 'Through the refraction?', lines: 1 },
      {
        id: 3,
        from: 'ai',
        text: 'The world bends through the glass. The ink sits on it, unrefracted and crisp. That split is the entire thesis.',
        lines: 2,
      },
    ],
  },
  {
    id: 3,
    title: 'Why the rail is one pass',
    snippet: 'one texture, five pieces',
    time: 'Tue',
    msgs: [
      {
        id: 1,
        from: 'ai',
        text: 'The rail’s DOM spans the whole column. The glass only exists where the rows are, and the final composite weights the ink by the field’s coverage — so the gaps simply never draw.',
        lines: 3,
      },
      { id: 2, from: 'user', text: 'The layout is the union.', lines: 1 },
    ],
  },
  {
    id: 4,
    title: 'Ripples that mean something',
    snippet: 'closing speed becomes wave height',
    time: 'Mon',
    msgs: [
      {
        id: 1,
        from: 'ai',
        text: 'Capillary waves disperse: short ones lead. Feeding the stationary-phase condition back into the phase gives theta = K r^3 / t^2, and the train stretches by itself.',
        lines: 3,
      },
      {
        id: 2,
        from: 'user',
        text: 'So the ripple under a new message is the message arriving.',
        lines: 2,
      },
    ],
  },
]

const REPLIES = [
  'Noted. That one is a uniform upload, not a repaint — the DOM never hears about it.',
  'Watch the shell underneath: the bubble did not fade in, it displaced the surface.',
  'Same field, one more rounded rect. The transcript slid up because its boxes are eased, not laid out.',
  'Every pixel of that answer is live DOM being refracted by an equation.',
]

// ---- the driver ---------------------------------------------------------
//
// One useFrame owns every animated number in the lab: the shell's two rects,
// the emergence of each content rect, the smoothing of the transcript as it
// slides, and the ripples all of that stamps into the shell. It writes into
// STABLE ARRAYS the compositor already registered (glassSdf.tsx) — nothing
// here costs a React render, and nothing here touches the DOM.
//
// The alternative would have been springs on React state driving props. That
// is a re-render per frame per panel, and a repaint of every Surface whose
// subtree re-rendered. Here the DOM is painted when its TEXT changes and at
// no other time; the geometry lives entirely in uniforms.

interface Live extends Box {
  key: string
  /** When this rect started welling up; -1 = not yet. */
  t0: number
  /** Smoothed centre, so a transcript that grows slides instead of jumping. */
  sx: number
  sy: number
  seeded: boolean
}

/** Rebuild `out` from `boxes`, preserving each key's animation state. */
function syncLive(out: Live[], boxes: Box[], keys: string[], born: number) {
  const prev = new Map(out.map((l) => [l.key, l]))
  out.length = 0
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    const p = prev.get(keys[i])
    out.push({
      ...b,
      key: keys[i],
      t0: p ? p.t0 : born,
      sx: p ? p.sx : b.cx,
      sy: p ? p.sy : b.cy,
      seeded: p ? p.seeded : false,
    })
  }
}

interface DriverProps {
  phase: React.RefObject<'auth' | 'split' | 'app'>
  splitAt: React.RefObject<number>
  shellRects: GlassRect[]
  shellRipples: GlassRipple[]
  railLive: Live[]
  railRects: GlassRect[]
  msgLive: Live[]
  msgRects: GlassRect[]
  composerLive: Live[]
  composerRects: GlassRect[]
  railGroup: React.RefObject<THREE.Group | null>
  msgGroup: React.RefObject<THREE.Group | null>
  composerGroup: React.RefObject<THREE.Group | null>
}

const CARD_BOX: Box = { cx: 0, cy: 0, hw: CARD_W / 2, hh: CARD_H / 2, r: CARD_R }
const RAIL_END: Box = { cx: RAIL_CX, cy: 0, hw: RAIL_W / 2, hh: APP_HH, r: PANE_R }
const PANE_END: Box = { cx: PANE_CX, cy: 0, hw: PANE_W / 2, hh: APP_HH, r: PANE_R }

function MorphDriver(p: DriverProps) {
  const necked = useRef(true)
  const shellParams = () => sdfPanelParams('lab013-shell')

  // A rect that has not started yet is a bead the size of its own corner —
  // small enough to be invisible under the coverage test, so "not started"
  // and "not there" are the same state and neither needs a flag.
  const SEED = 6

  const writeEmergent = useCallback(
    (live: Live[], rects: GlassRect[], now: number, dt: number, ripples: GlassRipple[], ox: number, oy: number) => {
      // The TAIL, not the head: a transcript grows at the bottom, so when it
      // outruns the uniform array the messages that lose their glass are the
      // ones that have already scrolled off the top. Their ink goes with them
      // — the composite weights it by coverage — so they vanish rather than
      // becoming floating text.
      const start = Math.max(0, live.length - MAX_RECTS)
      const n = live.length - start
      rects.length = n
      const k = 1 - Math.exp(-dt * 13)   // slide-into-place, frame-rate free
      for (let i = 0; i < n; i++) {
        const l = live[start + i]
        l.sx += (l.cx - l.sx) * k
        l.sy += (l.cy - l.sy) * k
        const u = l.t0 < 0 ? 0 : clamp01((now - l.t0) / EMERGE_DUR)
        // The ripple is stamped on the FIRST frame this rect is due, not when
        // it finishes: the surface is disturbed by the thing arriving, not by
        // the thing having arrived.
        if (!l.seeded && u > 0) {
          l.seeded = true
          if (ripples.length >= MAX_RIPPLES) ripples.shift()
          ripples.push({
            x: w(l.cx + ox),
            y: w(l.cy + oy),
            t0: now,
            amp: 0.45 + 0.35 * Math.min(1, (l.hw * l.hh) / 20000),
          })
        }
        const e = u <= 0 ? 0 : u >= 1 ? 1 : easeOutBack(u)
        const r = rects[i] ?? (rects[i] = { x: 0, y: 0, hw: 0, hh: 0, r: 0 })
        r.x = w(l.sx)
        r.y = w(l.sy)
        r.hw = w(lerp(Math.min(l.hw, SEED), l.hw, e))
        r.hh = w(lerp(Math.min(l.hh, SEED), l.hh, e))
        r.r = w(l.r)
      }
    },
    [],
  )

  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime
    const sp = shellParams()
    const ripples = p.shellRipples

    // Console-pushed ripples arrive with t0 < 0 meaning "stamp me": the
    // array's owner knows the time base, the emitter should not have to.
    for (const rp of ripples) if (rp.t0 < 0) rp.t0 = now

    // ---- the shell: one rect, or two -----------------------------------
    const t0 = p.splitAt.current
    const raw = p.phase.current === 'auth' || t0 < 0 ? 0 : clamp01((now - t0) / SPLIT_DUR)
    // Two eases, deliberately out of step. The card inflates to full height
    // first and only then tears sideways, so the neck forms in a body of
    // glass that is already tall — which is what makes it read as a tear
    // rather than as two rectangles drifting apart.
    const ph = easeInOut(clamp01(raw / 0.62))
    const pw = easeInOut(clamp01((raw - 0.16) / 0.84))

    const ends = [RAIL_END, PANE_END]
    for (let i = 0; i < 2; i++) {
      const end = ends[i]
      const r = p.shellRects[i]
      r.x = w(lerp(CARD_BOX.cx, end.cx, pw))
      r.y = 0
      r.hw = w(lerp(CARD_BOX.hw, end.hw, pw))
      r.hh = w(lerp(CARD_BOX.hh, end.hh, ph))
      r.r = w(lerp(CARD_BOX.r, end.r, pw))
    }

    if (sp) {
      // The blend radius is the star of the split. It swells to well past the
      // final gap in the middle of the tear — so the two panes stay joined by
      // a fat lens of glass long after their rects have separated — and then
      // collapses, which is the snap. A constant k would have shown the neck
      // dissolving instead of breaking.
      const bulge = Math.sin(Math.PI * clamp01((raw - 0.05) / 0.8))
      sp.smooth = 0.035 + 0.42 * Math.pow(bulge, 0.8)
      sp.inkOpacity = 1 - clamp01((raw - 0.02) / 0.18)

      // The release, detected the only place it can be: on the CPU, as a
      // sign change over time. Gap between the two rects' facing EDGES
      // against the blend radius that is still bridging them.
      const gap = p.shellRects[1].x - p.shellRects[1].hw - (p.shellRects[0].x + p.shellRects[0].hw)
      const isNecked = gap < sp.smooth * 1.05
      if (necked.current && !isNecked && raw > 0.2 && raw < 1) {
        necked.current = false
        const mid = (p.shellRects[0].x + p.shellRects[0].hw + p.shellRects[1].x - p.shellRects[1].hw) / 2
        // Two ripples, one into each pane, at the two lips of the break —
        // surface tension letting go pulls both sides back at once.
        for (const s of [-1, 1]) {
          if (ripples.length >= MAX_RIPPLES) ripples.shift()
          ripples.push({ x: mid + s * 0.06, y: 0, t0: now, amp: 1.15 })
        }
      }
      if (raw === 0) necked.current = true

      const life = sp.rippleLife
      while (ripples.length && now - ripples[0].t0 > life) ripples.shift()
    }

    // ---- everything that wells out of it -------------------------------
    writeEmergent(p.railLive, p.railRects, now, dt, ripples, RAIL_CX, 0)
    writeEmergent(p.msgLive, p.msgRects, now, dt, ripples, PANE_CX, MSG_CY)
    writeEmergent(p.composerLive, p.composerRects, now, dt, ripples, PANE_CX, COMPOSER_CY)

    // The panels rise as their contents do: z is a single number per panel,
    // driven by the earliest rect in it, so the whole rail lifts once rather
    // than each row carrying its own plane.
    const liftOf = (live: Live[]) => {
      let best = 0
      for (const l of live) {
        if (l.t0 < 0) continue
        best = Math.max(best, clamp01((now - l.t0) / (EMERGE_DUR * 1.4)))
      }
      return LIFT * best
    }
    if (p.railGroup.current) p.railGroup.current.position.z = APP_Z + liftOf(p.railLive)
    if (p.msgGroup.current) p.msgGroup.current.position.z = APP_Z + liftOf(p.msgLive)
    if (p.composerGroup.current)
      p.composerGroup.current.position.z = APP_Z + liftOf(p.composerLive)
  })

  return null
}

// ---- DOM ----------------------------------------------------------------
//
// Every panel here is `hitTest="content"`, which makes `Surface` set the
// source root to `pointer-events: none` and gate the RAYCAST on a real DOM
// hit test at the intersected UV (decisions #20). That is exactly what the
// gaps need — a ray through the space between two thread rows must reach the
// rail's glass behind, not be swallowed by a full-panel slab — and it is why
// every interactive box below re-declares `pointer-events-auto`. The
// container is a stencil; the boxes are the openings.

function SignInCard({ onSubmit }: { onSubmit: () => void }) {
  const [email, setEmail] = useState('ada@lab.dev')
  const [password, setPassword] = useState('')
  return (
    <form
      data-glass-root
      className="pointer-events-auto flex flex-col gap-5 p-7 text-white"
      style={{ width: CARD_W, height: CARD_H }}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-xl font-semibold tracking-tight">Welcome back</span>
        <span className="text-sm text-white/55">One pane of glass, for now</span>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="l13-email" className="text-white/75">
          Email
        </Label>
        <Input
          id="l13-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border-white/20 bg-white/10 text-white placeholder:text-white/35"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="l13-password" className="text-white/75">
          Password
        </Label>
        <Input
          id="l13-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="border-white/20 bg-white/10 text-white placeholder:text-white/35"
        />
      </div>
      <Button
        id="l13-signin"
        type="submit"
        className="mt-auto bg-white/90 text-black hover:bg-white"
      >
        Sign in
      </Button>
    </form>
  )
}

/**
 * What the shell carries once the form is gone: nothing. An unpainted root
 * plus `hitTest="content"` makes the card-sized raycast quad that is now
 * floating between the two panes inert by construction (decisions #20) —
 * there is no z-order rule to get right.
 */
function EmptyShell() {
  return <div data-glass-root style={{ width: CARD_W, height: CARD_H }} />
}

function RailContent({
  boxes,
  selected,
  onSelect,
}: {
  boxes: Box[]
  selected: number
  onSelect: (i: number) => void
}) {
  return (
    <div
      data-glass-root
      className="relative text-white"
      style={{ width: RAIL_W, height: APP_H }}
    >
      <div
        style={css(boxes[0], RAIL_W, APP_H)}
        className="pointer-events-auto flex items-center justify-between px-4"
      >
        <span className="text-[13px] font-semibold tracking-tight">Threads</span>
        <span className="text-[17px] leading-none text-white/50">+</span>
      </div>
      {THREADS.map((t, i) => {
        const b = boxes[i + 1]
        if (!b) return null
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(i)}
            data-selected={selected === i}
            style={css(b, RAIL_W, APP_H)}
            className="pointer-events-auto flex flex-col justify-center gap-1 px-4 text-left text-white/70 hover:text-white/95 data-[selected=true]:text-white"
          >
            <span className="text-[13px] font-medium leading-tight">{t.title}</span>
            <span className="line-clamp-1 text-[11px] text-white/45">{t.snippet}</span>
            <span className="text-[10px] uppercase tracking-wide text-white/30">
              {t.time}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function TranscriptContent({ msgs, boxes }: { msgs: Msg[]; boxes: Box[] }) {
  return (
    <div
      data-glass-root
      className="relative text-white"
      style={{ width: MSG_W, height: MSG_H }}
    >
      {msgs.map((m, i) => {
        const b = boxes[i]
        if (!b) return null
        return (
          <div
            key={m.id}
            style={{ ...css(b, MSG_W, MSG_H), borderRadius: BUBBLE_R }}
            className="pointer-events-auto flex flex-col justify-center px-5"
          >
            <span className="text-[10px] uppercase tracking-[0.14em] text-white/35">
              {m.from === 'ai' ? 'assistant' : 'you'}
            </span>
            <span className="text-[15px] leading-[23px] text-white/85">{m.text}</span>
          </div>
        )
      })}
    </div>
  )
}

function ComposerContent({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <form
      data-glass-root
      className="pointer-events-auto flex h-full items-center gap-3 px-5 text-white"
      style={{ width: COMPOSER_W, height: COMPOSER_H }}
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return
        onSend(text.trim())
        setText('')
      }}
    >
      <Input
        id="l13-composer"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask the glass something…"
        className="h-11 flex-1 border-white/15 bg-white/10 text-[15px] text-white placeholder:text-white/35"
      />
      <Button type="submit" className="h-11 bg-white/90 px-6 text-black hover:bg-white">
        Send
      </Button>
    </form>
  )
}

/** The refraction target: loud, high-frequency, live DOM. */
function Backdrop() {
  return (
    <div
      className="relative overflow-hidden font-sans"
      style={{ width: 2400, height: 1500, background: '#080910' }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(820px 820px at 12% 24%, #ff7a3d 0%, transparent 62%),' +
            'radial-gradient(760px 760px at 88% 16%, #2dd4bf 0%, transparent 60%),' +
            'radial-gradient(940px 940px at 64% 94%, #8b5cf6 0%, transparent 62%),' +
            'radial-gradient(560px 560px at 36% 64%, #f43f5e 0%, transparent 58%)',
          opacity: 0.9,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.13) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgba(255,255,255,0.13) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />
      <div className="absolute inset-0 flex flex-col justify-between p-12">
        <span className="text-[128px] font-bold leading-none tracking-tighter text-white/90">
          liquid
        </span>
        <div className="flex flex-col gap-1.5 text-white/70">
          <span className="text-sm">lab 013 · a layout that is a distance field</span>
          <span className="text-sm">
            the quick brown fox jumps over the lazy dog 0123456789
          </span>
          <span className="text-xs text-white/45">
            the quick brown fox jumps over the lazy dog 0123456789
          </span>
        </div>
      </div>
    </div>
  )
}

// ---- the scene ----------------------------------------------------------

// Content panels are small next to the shell, so they get a narrower rim: a
// 0.16 bezel on a 0.6-unit thread row would be a quarter of the row.
const CHIP_GLASS = { bezel: 0.085, thickness: 0.085, spread: 0.3, edgeLight: 0.42 }
// The shell is metres across, so its ripples need a much longer wavelength:
// the train's front sits at r ~ (2 pi t^2 / K)^(1/3), so K is what decides
// whether a wave crosses the pane in a second or dies as sub-pixel chatter.
const SHELL_GLASS = {
  bezel: 0.18,
  thickness: 0.16,
  spread: 0.5,
  smooth: 0.035,
  rippleK: 0.5,
  rippleSource: 0.1,
  rippleDecay: 1.5,
  rippleLife: 2.2,
  rippleAmp: 0.85,
}

export function Lab013() {
  const [signedIn, setSignedIn] = useState(false)
  const [formGone, setFormGone] = useState(false)
  const [thread, setThread] = useState(0)
  const [msgs, setMsgs] = useState<Msg[]>(THREADS[0].msgs)

  const phase = useRef<'auth' | 'split' | 'app'>('auth')
  const splitAt = useRef(-1)
  const clockRef = useRef<THREE.Clock | null>(null)

  // Stable arrays: the compositor registered these identities, the driver
  // mutates them, and React never sees either.
  const shellRects = useMemo<GlassRect[]>(
    () => [
      { x: 0, y: 0, hw: w(CARD_W / 2), hh: w(CARD_H / 2), r: w(CARD_R) },
      { x: 0, y: 0, hw: w(CARD_W / 2), hh: w(CARD_H / 2), r: w(CARD_R) },
    ],
    [],
  )
  const shellRipples = useMemo<GlassRipple[]>(() => [], [])
  const railRects = useMemo<GlassRect[]>(() => [], [])
  const msgRects = useMemo<GlassRect[]>(() => [], [])
  const composerRects = useMemo<GlassRect[]>(() => [], [])
  const railLive = useMemo<Live[]>(() => [], [])
  const msgLive = useMemo<Live[]>(() => [], [])
  const composerLive = useMemo<Live[]>(() => [], [])

  const railGroup = useRef<THREE.Group | null>(null)
  const msgGroup = useRef<THREE.Group | null>(null)
  const composerGroup = useRef<THREE.Group | null>(null)

  const railGeo = useMemo(() => railBoxes(THREADS.length), [])
  const msgGeo = useMemo(() => bubbleBoxes(msgs), [msgs])

  // Reveal schedule. Everything downstream of the split is expressed as an
  // offset from the moment the card was told to become a layout, so the whole
  // sequence has exactly one clock and no chained timeouts.
  const schedule = useCallback(
    (at: number) => {
      syncLive(
        railLive,
        railGeo,
        railGeo.map((_, i) => `rail:${i}`),
        at,
      )
      for (let i = 0; i < railLive.length; i++) railLive[i].t0 = at + 0.7 + i * 0.07
      syncLive(composerLive, [{ cx: 0, cy: 0, hw: COMPOSER_W / 2, hh: COMPOSER_H / 2, r: 22 }], ['composer'], at)
      composerLive[0].t0 = at + 0.82
    },
    [railGeo, railLive, composerLive],
  )

  // Bubbles are keyed by thread AND message id, so switching threads gives
  // every rect a fresh key — and a fresh key is, by construction, a rect that
  // has to well up again. Sending only ever adds ids, so only the new bubble
  // is fresh and the rest of the transcript merely slides.
  useEffect(() => {
    const clock = clockRef.current
    if (!clock || !signedIn) return
    const now = clock.elapsedTime
    const base = splitAt.current >= 0 ? Math.max(now, splitAt.current + 0.95) : now
    const keys = msgs.map((m) => `msg:${thread}:${m.id}`)
    const before = new Set(msgLive.map((l) => l.key))
    syncLive(msgLive, msgGeo, keys, base)
    let n = 0
    for (const l of msgLive) if (!before.has(l.key)) l.t0 = base + n++ * 0.085
  }, [msgs, msgGeo, msgLive, thread, signedIn])

  const signIn = useCallback(() => {
    if (phase.current !== 'auth') return
    phase.current = 'split'
    const now = clockRef.current?.elapsedTime ?? 0
    splitAt.current = now
    // The click itself is an impulse: the button is at the card's bottom, so
    // that is where the surface is struck.
    shellRipples.push({ x: 0, y: w(-CARD_H / 2 + 40), t0: now, amp: 0.8 })
    schedule(now)
    setSignedIn(true)
    window.setTimeout(() => setFormGone(true), 420)
  }, [schedule, shellRipples])

  const reset = useCallback(() => {
    phase.current = 'auth'
    splitAt.current = -1
    shellRipples.length = 0
    railLive.length = 0
    msgLive.length = 0
    composerLive.length = 0
    railRects.length = 0
    msgRects.length = 0
    composerRects.length = 0
    setSignedIn(false)
    setFormGone(false)
    setThread(0)
    setMsgs(THREADS[0].msgs)
  }, [shellRipples, railLive, msgLive, composerLive, railRects, msgRects, composerRects])

  const select = useCallback((i: number) => {
    const t = THREADS[i]
    if (!t) return
    setThread(i)
    setMsgs(t.msgs)
  }, [])

  const send = useCallback((text: string) => {
    setMsgs((prev) => {
      const id = (prev.at(-1)?.id ?? 0) + 1
      return [
        ...prev,
        { id, from: 'user', text, lines: Math.max(1, Math.ceil(text.length / 46)) },
      ]
    })
    window.setTimeout(() => {
      setMsgs((prev) => {
        const id = (prev.at(-1)?.id ?? 0) + 1
        const reply = REPLIES[id % REPLIES.length]
        return [
          ...prev,
          { id, from: 'ai', text: reply, lines: Math.max(1, Math.ceil(reply.length / 62)) },
        ]
      })
    }, 760)
  }, [])

  useEffect(() => {
    ;(window as unknown as { __lab013?: object }).__lab013 = {
      signIn,
      reset,
      select,
      send,
      state: () => ({ phase: phase.current, thread, msgs: msgs.length, signedIn }),
      set: (key: string, value: number | string) => {
        let n = 0
        for (const label of sdfPanelLabels()) {
          const q = sdfPanelParams(label)
          if (q) {
            ;(q as unknown as Record<string, unknown>)[key] = value
            n++
          }
        }
        return `set ${key}=${value} on ${n} panels`
      },
      setFor: (label: string, key: string, value: number | string) => {
        const q = sdfPanelParams(label)
        if (!q) return `no panel: ${label}`
        ;(q as unknown as Record<string, unknown>)[key] = value
        return `set ${key}=${value} on ${label}`
      },
      ripple: (x = 0, y = 0, amp = 1) => {
        shellRipples.push({ x, y, t0: -1, amp })
        return `ripple at ${x},${y}`
      },
      rects: () => ({
        shell: shellRects.map((r) => ({ ...r })),
        rail: railRects.length,
        msg: msgRects.length,
      }),
      labels: sdfPanelLabels,
      params: (label = 'lab013-shell') => sdfPanelParams(label),
    }
  }, [signIn, reset, select, send, thread, msgs.length, signedIn, shellRipples, shellRects, railRects, msgRects])

  return (
    <>
      <color attach="background" args={['#07080c']} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[5, 8, 6]} intensity={1.3} />
      <pointLight position={[-4, 4, 3]} intensity={14} color="#ffd2a8" distance={18} />
      <FrameApp />
      <ClockGrab into={clockRef} />

      {/* The wall — itself live DOM, and the only thing behind the glass. */}
      <SurfaceApp
        label="lab013-wall"
        width={2400}
        height={1500}
        position={[0, APP_Y, -1.6]}
        content={<Backdrop />}
      >
        <planeGeometry args={[2400 / PX, 1500 / PX]} />
      </SurfaceApp>

      {/* Opaque props between the wall and the glass, so refraction has
          something with edges to bend. */}
      <mesh position={[-3.1, 4.2, -0.4]}>
        <torusKnotGeometry args={[0.24, 0.08, 160, 28]} />
        <meshStandardMaterial color="#ff7a3d" roughness={0.22} metalness={0.2} />
      </mesh>
      <mesh position={[3.5, 0.75, -0.5]}>
        <icosahedronGeometry args={[0.34, 0]} />
        <meshStandardMaterial color="#2dd4bf" roughness={0.15} metalness={0.25} />
      </mesh>

      {/* The shell: two rounded rects that begin life as the same one. */}
      <SdfGlassPanel
        label="lab013-shell"
        width={CARD_W}
        height={CARD_H}
        px={PX}
        hasBase={false}
        rects={shellRects}
        ripples={shellRipples}
        hitTest="content"
        params={SHELL_GLASS}
        position={[0, APP_Y, APP_Z]}
        content={formGone ? <EmptyShell /> : <SignInCard onSubmit={signIn} />}
      />

      {/* Everything that wells out of it. Each sits in a group the driver
          lifts in z; the panel inside is at the group's origin. */}
      <group ref={railGroup} position={[w(RAIL_CX), APP_Y, APP_Z]}>
        <SdfGlassPanel
          label="lab013-rail"
          width={RAIL_W}
          height={APP_H}
          px={PX}
          hasBase={false}
          rects={railRects}
          hitTest="content"
          params={CHIP_GLASS}
          position={[0, 0, 0]}
          content={
            signedIn ? (
              <RailContent boxes={railGeo} selected={thread} onSelect={select} />
            ) : (
              <div data-glass-root style={{ width: RAIL_W, height: APP_H }} />
            )
          }
        />
      </group>

      <group ref={msgGroup} position={[w(PANE_CX), APP_Y + w(MSG_CY), APP_Z]}>
        <SdfGlassPanel
          label="lab013-msgs"
          width={MSG_W}
          height={MSG_H}
          px={PX}
          hasBase={false}
          rects={msgRects}
          hitTest="content"
          params={CHIP_GLASS}
          position={[0, 0, 0]}
          content={
            signedIn ? (
              <TranscriptContent msgs={msgs} boxes={msgGeo} />
            ) : (
              <div data-glass-root style={{ width: MSG_W, height: MSG_H }} />
            )
          }
        />
      </group>

      <group ref={composerGroup} position={[w(PANE_CX), APP_Y + w(COMPOSER_CY), APP_Z]}>
        <SdfGlassPanel
          label="lab013-composer"
          width={COMPOSER_W}
          height={COMPOSER_H}
          px={PX}
          hasBase={false}
          rects={composerRects}
          hitTest="content"
          params={CHIP_GLASS}
          position={[0, 0, 0]}
          content={
            signedIn ? (
              <ComposerContent onSend={send} />
            ) : (
              <div data-glass-root style={{ width: COMPOSER_W, height: COMPOSER_H }} />
            )
          }
        />
      </group>

      <MorphDriver
        phase={phase}
        splitAt={splitAt}
        shellRects={shellRects}
        shellRipples={shellRipples}
        railLive={railLive}
        railRects={railRects}
        msgLive={msgLive}
        msgRects={msgRects}
        composerLive={composerLive}
        composerRects={composerRects}
        railGroup={railGroup}
        msgGroup={msgGroup}
        composerGroup={composerGroup}
      />
      <GlassSdfCompositor lightDir={[5, 8, 6]} />
    </>
  )
}

/**
 * Frame the app once, on mount.
 *
 * The lab picker shares one camera and one OrbitControls across every scene,
 * and whatever ran before this leaves it wherever it left it — so a lab that
 * cares about its own scale has to say so. The distance is not a taste call:
 * at 45° vertical FOV, 7.4 units puts APP_H inside the frustum with a margin
 * and lands the DOM at roughly ONE CSS pixel per screen pixel, which is the
 * only place a rasterized UI is honestly legible. Further away and the text
 * is being minified; nearer and the auto-LOD is re-rastering for detail the
 * layout does not have.
 */
function FrameApp() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null
  useEffect(() => {
    camera.position.set(0, APP_Y, APP_Z + 7.4)
    if (controls) {
      controls.target.set(0, APP_Y, APP_Z)
      controls.update()
    }
    camera.lookAt(0, APP_Y, APP_Z)
  }, [camera, controls])
  return null
}

/**
 * The scene's clock, parked in a ref so DOM handlers can stamp the SAME time
 * base the driver ages ripples against. Lab 012 shipped this bug once:
 * `performance.now()/1000` and `clock.elapsedTime` are different origins, so
 * a console-fired ripple was pruned on the frame it arrived.
 */
function ClockGrab({ into }: { into: React.RefObject<THREE.Clock | null> }) {
  useFrame(({ clock }) => {
    into.current = clock
  })
  return null
}
