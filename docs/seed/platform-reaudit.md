# Platform re-audit checklist — Phase 2 gate

Phase 0 artifact, 2026-08-02. Source:
[platform.md](../platform.md) at `d6848c9`.

Every platform claim the new repo inherits is **dated empiricism on a
moving origin trial**. Baseline for all items unless noted: **Chrome
150.0.7871.187, macOS M-series, 120Hz, dpr 2**, launched with
`--enable-features=CanvasDrawElement`; claims established 2026-07-26
through 2026-08-01. None are trusted in the new repo until this
checklist has been run on current Chrome — the Phase 2 gate.

**Protocol.** Run the smoke pass first; on any surprise, run the full
section it belongs to. Date every verdict. A flipped claim gets an
entry in the new repo's decisions ledger (citing the archive claim it
overturns) *before* any code adapts to it. Probe mechanics (harness
URLs, capture recipes, atomic-eval rules) live in
[instruments.md](instruments.md).

**Audit doctrine** (paid-for process lessons; they bind the re-audit
itself):

- Any claim of the form "property P can't be captured" must name
  **which element P is on**. The el-vs-descendant seam is real in this
  API — the over-broad 2026-07-29 opacity rule survived two days
  because every probe animated the root.
- Any claim about **where** the replay lands needs a position-aware
  probe (marker dot at known CSS coords, or full-element dye against
  expected bounds). Crispness screenshots and edge-width scans are
  scale-blind: a vector re-raster is crisp at any scale, and a k²
  double-apply crops rather than blurs.
- A claim can sit falsified but masked by a *second* bug (the k² error
  hid behind three.js's immutable-storage upload failure). When a probe
  contradicts settled belief, fix the nearest bug and re-run before
  concluding anything.
- The failure modes here are **silent**: clean paints, zero errors,
  healthy-looking textures — for zero-size roots, masked subtrees, and
  frozen roots alike. Absence of errors is not evidence of health;
  only pixels are.

## Smoke pass (minutes; gross-change detector)

- [ ] 1. HUD capability chips on load: `drawElementImage ✓` /
  `texElementImage2D ✓`. (Chips exist because the agent-browser daemon
  relaunches Chrome *without* flags — never trust a run without them.)
- [ ] 2. Self-paint: one DOM mutation fires `onpaint` with zero
  `requestPaint` calls.
- [ ] 3. Resolve: paint red, mutate to blue, no explicit paints —
  exactly one self-paint, buffer reads blue.
- [ ] 4. Root-vs-descendant: identical opacity keyframes on content
  root and on a descendant, sampling the source-canvas pixel under a
  known-position landmark. Expect root frozen at 1 paint; descendant
  full per-frame ramp. **Both directions are hinges — see C.**
- [ ] 5. Scale: `?probe=128` → 120fps at 0 paints/s;
  `?probe=96&live=1` near the ceiling.
- [ ] 6. Rescale: dolly to a high tier — commits with one paint,
  glyphs sharpen, a focused field keeps its caret through the swap.
- [ ] 7. Replay scale (position-aware): 6px marker dot at known CSS
  position, backing resized to k× under identity CTM → centroid at k×
  position, k× size, at k = 0.5 and 3.

## A. Core mechanics (labs 001–003)

- [ ] A1 Source element must be a child of the canvas, with
  `layoutSubtree` set. *Blast:* the entire source-parking scheme.
- [ ] A2 `drawElementImage` succeeds only inside `onpaint` ("No cached
  paint record" otherwise). *Blast:* the draw loop's shape; the
  gl.render-wrapper capture recipes.
- [ ] A3 The draw is deferred — readback trails the DOM by up to one
  frame. *Blast:* the one-extra-upload insurance in the source; probe
  timing assumptions.
- [ ] A4 Parking must be on-screen: `left: -10000px` silently blanks;
  `z-index: -1` under an opaque cover works. *Blast:* parking CSS in
  the source contract; if off-screen parking starts working, parking
  gets simpler and the app-background corner-texel argument (#55)
  needs re-checking.
- [ ] A5 Same-origin readback unrestricted (no taint) → plain
  `CanvasTexture`. *Blast:* everything; also the readPixels probes.
- [ ] A6 Late-mounted Surface needs `material.needsUpdate` when its
  texture arrives. (three.js-side, not Chrome — keep to date the
  three version instead.)
- [ ] A7 Synthetic events never flip `:hover`/`:active`. *Blast:* the
  `data-hover`/`data-active` mirror and the dialect's
  `@custom-variant` lines; if Chrome ever honors untrusted hover, the
  mirror becomes redundant but harmless.

## B. Self-paint contract (2026-07-29)

The compositor fires `onpaint` by itself when the paint record
changes; `requestPaint()` is needed only for initial rasterization.
**Blast radius: the whole paint layer.** `paint="auto"` passivity, the
idle-zero CI gate, measured-chrome's re-measure trigger (#55), and the
"no observers in the paint path" rule (#3) all assume this. If
self-firing stops, that is a stop-the-world finding, not an item to
patch around.

- [ ] B1 DOM mutation → 1 paint per coalesced batch.
- [ ] B2 Paint-property animation (background) → per-frame, measured
  119/s at 120Hz.
- [ ] B3 Caret blink → 4 paints / 2s (~530ms cadence).
- [ ] B4 Focus/blur (focus ring) fires paints.
- [ ] B5 Quiescent subtree → **0** paints over multi-second windows.
- [ ] B6 Resolve without trailing paint: red→blue, one self-paint,
  buffer blue.
- [ ] B7 No starvation: N stacked occluding sources all paint at the
  same rate (per-source min == max); load stretches the frame
  uniformly.

## C. The drawn root's own opacity/transform (corrected 2026-07-31)

Claim: changing the drawn root's **own** opacity/transform does not
invalidate its record — keyframes freeze (1 paint), transitions leave
a stale end state that self-heals on the next unrelated repaint.
Anything on a **descendant** is inside the record: 29/29 distinct
frames, 1 paint each. `requestPaint()` replays without re-reading
(paint policy was never the lever); `getElementTransform()` is the API
conceding the seam.

- [ ] C1 Root keyframe frozen: 1 distinct texture value, 1 paint.
- [ ] C2 Root static set → stale alpha until an unrelated descendant
  mutation bakes it (255 → 255 → 128 sequence).
- [ ] C3 Descendant keyframe: full ramp, per-frame paints (opacity
  AND transform).
- [ ] C4 Cost of descendant animation ≈ 1 paint + 1 upload / frame /
  Surface (the conductor's reason to exist).

**Hinges — both directions change the new repo:**
- Root **starts** self-painting → the "never animate the content
  root" hard rule relaxes; the conductor (#17) becomes an optimization
  only; the stale-transition heisenbug class disappears.
- Descendant **stops** rasterizing → the conductor becomes
  load-bearing for *correctness*, and every registry component with
  descendant animation is broken until routed through it.

## D. `mask-image` voids the whole capture (2026-08-01)

Claim: a mask anywhere in the drawn subtree → entire capture black
except independently-composited descendants; a computed no-op opaque
mask still kills it; the scroll-timeline animation is innocent; clean
paints, no errors.

- [ ] D1 Mask present → black-except-composited-widgets.
- [ ] D2 `animation: none`, mask kept → still black (property, not
  effect).
- [ ] D3 `mask-image: none`, animation kept → everything paints.

*Blast:* hard rule #30; the dialect stylesheet's `scroll-fade-*`
neutralization; the "black Surface ⇒ grep for masks" triage step. If
Chrome fixes masks, delete the neutralization and demote the rule to
history (with a probe date). Worth one targeted check per Chrome
update — the failure is silent and looks like a broken theme.

## E. Containing block, not viewport (2026-07-31)

Claim: a `layoutSubtree` canvas is the containing block for
`position: fixed` descendants (fixed + `inset-0` fills the slab, e.g.
360×460), and **that is the only canvas-local answer** — `vw`/`vh`,
`dvw`/`dvh`, media queries (every Tailwind `sm:`/`md:`), `matchMedia`,
`innerWidth`, `documentElement.client*`, `visualViewport` all answer
with the page. Ordinary CSS (`contain: layout` does the same); nothing
origin-trial-special.

- [ ] E1 `fixed; inset: 0` inside a parked source → the slab's box.
- [ ] E2 The other eight rows still page-global (probe the table,
  slab vs page).
- [ ] E3 JS viewport measurers inherit the gap (Radix
  available-height: `select.tsx:71`, `dropdown-menu.tsx:45` in the
  vendored set).

*Blast:* the viewer-slab design (#21/#23 — sonner/Dialog pin with zero
plumbing *because* of E1); container queries as the registry's
responsive mechanism (#25 — the rig is never a viewport); the
authoring warning that viewport-relative units silently mean the page.
If E1 flips (canvas stops being a containing block), viewer chrome
loses its free positioning; if E2 flips (canvas becomes a viewport),
responsive authoring inside Surfaces changes completely — both are
ledger entries.

## F. Rasterized at the element's own layout box (2026-07-31)

Claim: `drawElementImage` rasterizes at the element's size; a root
whose children are all out-of-flow measures 0 and draws an empty rect
— 21 clean paints, zero errors, every pixel `[0,0,0,0]`. And
`getBoundingClientRect` bakes the entrance transform (273.6×115.9
mid-`zoom-in-95` vs the 288×122 layout box) — measure with
`offsetWidth`/`offsetHeight`.

- [ ] F1 All-fixed-children root → zero-size capture, no error
  signal.
- [ ] F2 Rect-vs-offset divergence mid-entrance animation.

*Blast:* the explicit-pixel-size source contract (#22); floating-layer
measurement. This one is unlikely to change (it's CSS layout, not the
trial) — audit it cheaply, but a flip would be a Chrome layout bug,
not a trial evolution.

## G. Scale envelope (2026-07-29)

Claim: cost is per-source fixed overhead, not texels (N=64 identical
at 320×200 and 640×400); idle Surfaces are free after the
upload-on-paint rewrite (N=128 idle → 120fps at 0 paints/s); ceiling
~64–96 simultaneously painting sources at 120Hz, refresh-relative;
one toggle flip = 2 paints then quiescent.

- [ ] G1 `?probe=128` idle → 120fps, 0 paints/s.
- [ ] G2 Texel-independence spot check (two card sizes, same fps).
- [ ] G3 Ceiling: `?probe=96&live=1` ≈ 100fps; `?probe=128&live=1`
  degrades gracefully (uniform stretch per B7, no starvation).
- [ ] G4 `texElementImage2D` still untried — if the trial ships it,
  it targets exactly this per-source fixed cost; probe before
  adopting.

*Blast:* the perf budget doctrine and the idle-zero CI gate's
thresholds. Numbers are hardware-relative; re-establish per audit
machine rather than porting the absolute figures.

## H. Rescale — the record replays as vectors (2026-07-29/30)

The display-list upside: replay under a new density is a true
re-render (glyphs re-rasterize), which is what makes LOD possible.

- [ ] H8 Replay auto-scales by the **backing/CSS ratio**, CTM
  multiplies **on top** — draw under identity CTM after a backing
  resize; a CTM of k on a k×-resized canvas double-applies (k² crop
  to the top-left 1/k). **Position-aware probe mandatory** (ratio 3 +
  CTM 1 → 3×; ratio 1 + CTM 3 → 3×; ratio 3 + CTM 3 → 9×; ratio 0.5 →
  0.5×). *Blast:* the identity-CTM contract in the new source layer
  must change in lockstep if this flips.
- [ ] H9 Backing resize with CSS size pinned never relayouts: focus,
  caret, selection survive 1.5→0.5→1.5 swaps mid-edit. *Blast:* tier
  swaps being invisible to users (#8–#10).
- [ ] H10 Backing resize does **not** self-fire `onpaint` — explicit
  `requestPaint()` after resize. *Blast:* `setScale`'s explicit
  request in the source.
- [ ] H11 A rescale costs exactly 1 paint + 1 upload (41 tier changes
  across a full orbit at a held 120fps). *Blast:* the density
  schedule's 2-re-rasters-per-round-trip budget (#53).
- [ ] H12 Context state resets on resize (transform asserted inside
  every `onpaint`, not set once).

## I. Untested / suspected-broken list

Assume broken until probed; route media around the DOM path (#5).
Each item, when probed, moves out of this section with a date in
either direction.

- [ ] I1 `<video>` frames — untested; SurfaceLayer + `VideoTexture`
  is the supported path regardless.
- [ ] I2 Animated GIFs — untested.
- [ ] I3 `<canvas>` children — untested.
- [ ] I4 CSS filters — untested.
- [ ] I5 `will-change` side effects — untested (a promotion hint on a
  descendant could plausibly pull it out of the record; probe like C).
- [x] I6 Scroll offsets — **probed WORKING** 2026-08-01: `scrollTop`
  invalidates like any descendant mutation (#29). Keep verifying with
  the wheel-seam tests.
- [x] I7 `mask-image` — probed broken-in-the-worst-way; graduated to
  section D.
