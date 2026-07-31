# Platform contract — Chrome HTML-in-canvas, empirically

**Status of this document:** observations, not rules. Every claim is dated,
tied to a Chrome version, and paired with the experiment that established
it, so a future Chrome can be re-tested claim by claim. For what to *do*
about these facts, see [authoring.md](authoring.md). All trial-API contact
in code is confined to `src/lib/htmlInCanvas.ts`.

Last verified: **2026-07-31, Chrome 150.0.7871.187, macOS (M-series, 120Hz,
dpr 2)**, launched with `--enable-features=CanvasDrawElement`.

## The mental model

The browser renders in stages: **style → layout → paint → raster →
composite**. Paint produces a *display list* (Chrome: "paint record") — a
recorded sequence of drawing commands. `drawElementImage` does not
screenshot an element; it **replays its paint record**. Two consequences
own everything below:

1. Whatever is *in* the record rasterizes; whatever is applied *after*
   paint (by the compositor, to a promoted layer) does not exist for us.
2. The canvas repaints exactly when the record changes — which gives a
   free, ground-truth "content changed" signal (`onpaint`).

This is the same class of limit as GPU vertex displacement breaking
raycast forwarding: a later pipeline stage diverges from the CPU-side
representation we sample. three-ui lives on CPU-visible truth.

## Core mechanics (established lab 001–003)

| # | Claim | Evidence |
|---|---|---|
| 1 | Source element must be a child of the canvas it's drawn into, with `canvas.layoutSubtree = true` | lab 001 |
| 2 | `drawElementImage` only succeeds inside `onpaint` (else "No cached paint record") | lab 001 |
| 3 | The draw is deferred: readback trails the DOM by up to one frame | lab 001 |
| 4 | Source canvas must be in-document **and on-screen**; `left:-10000px` parking silently blanks. `z-index:-1` parking works | lab 001 |
| 5 | Same-origin readback is unrestricted → plain `CanvasTexture` works | lab 001 |
| 6 | A Surface mounted after first render must bump `material.needsUpdate` when its texture arrives (three keys program compilation on material.version) | lab 003 |
| 7 | Synthetic events never flip `:hover`/`:active`; mirrored as `data-hover`/`data-active` attributes instead | lab 003 |

## Self-paint contract (established 2026-07-29, raw-canvas experiments)

The compositor fires `onpaint` **by itself** whenever the paint record
changes. `requestPaint()` is only needed for the initial rasterization.

| Trigger | Self-paints? | Measured |
|---|---|---|
| DOM mutation (text, attribute, style) | yes | 1 paint per coalesced mutation batch |
| CSS animation on a **paint** property (background) | yes, per frame | 119 paints/s at 120Hz |
| CSS transition on a paint property | yes, per frame | (same mechanism) |
| Caret blink in a focused field | yes | 4 paints / 2s (~530ms cadence) |
| Focus/blur (focus ring) | yes | observed in lab scenes |
| Quiescent subtree | **never** | 0 paints over multi-second windows |

**Resolve timing:** the deferred draw resolves into the 2D buffer by its
own paint pass. Experiment: paint red once, mutate to blue with *zero*
`requestPaint` calls → exactly one self-paint fires and the buffer reads
blue. No trailing paint is required (Surface still uploads one extra frame
as insurance).

**No starvation:** N stacked, mutually-occluding parked canvases all paint
at the same rate at every N tested (per-source min == max) — under load
the frame stretches uniformly; no source stalls.

## The drawn root's own opacity/transform (corrected 2026-07-31)

**This section was wrong from 2026-07-29 to 2026-07-31.** It claimed
opacity/transform animations are compositor-owned and can never rasterize.
The observations were real; the explanation was too broad, and the rule it
justified banned things that work. Corrected claim:

> `drawElementImage(el)` replays **el's own paint record**. Changing el's
> **own** `opacity`/`transform` does **not invalidate** that record, so it
> never self-fires `onpaint`. The value bakes correctly whenever something
> *else* forces a re-record. Anything on a **descendant** is inside the
> record: it rasterizes per frame and self-paints per frame.

The discriminating experiment (Chrome 150.0.7871.187, lab 009): identical
`@keyframes { opacity: 1 → 0 }`, identical tree, only the target differs.
Texture sampled per frame by reading the source canvas pixel under a
known-position landmark div.

| Animated target | DOM opacity swept | Distinct texture values / 29 frames | Paints |
|---|---|---|---|
| a **descendant** div | 1 → 0 | **29** (`255,0,0` → `255,119,119` → `255,238,238`) | **29** |
| the **drawn root** itself | 0.97 → 0.03 | **1** — frozen at `255,0,0` | **1** |

A `background` keyframe run alongside as a known-paint control gave 29
distinct values (`255,0,0` → `136,0,119` → `17,0,238`), and `transform`
on a descendant moved a hard edge across a fixed sample point. So
descendants animate, self-paint, and rasterize — for opacity and transform
alike.

The static case, same landmark, watching alpha:

| Step | Texture alpha |
|---|---|
| baseline | 255 |
| root `opacity: 0.5` set, nothing else touched | **255** — stale, no paint fired |
| unrelated descendant mutation (`textContent`) | **128** — the fresh record bakes 0.5 correctly |
| root opacity cleared | 255 |

That is the old "self-heals on the next unrelated repaint" observation,
reproduced exactly — and it is the whole heisenbug. A `transition: opacity`
on the content root shows no tween and leaves a stale end state because
nothing in that sequence ever invalidates the record; the *next* unrelated
mutation bakes whatever the value happens to be by then. An animation on
the root is the same bug with no healing mutation ever arriving.

It also explains why `paint="always"` couldn't rescue it: `requestPaint()`
schedules a **replay**, and a replay of a still-valid record re-reads
nothing. Record invalidation is driven by changes *inside* the element's
own subtree. Paint policy was never the lever.

**Consequence for authoring:** animating opacity/transform on descendants
is correct and supported (see [authoring.md](authoring.md)) — but it costs
**1 paint + 1 texture upload per frame per Surface**, ~120/s on this
hardware. That cost, not a rasterization limit, is what
`useAnimationConductor` exists to avoid ([decisions.md #16](decisions.md)).
The content root stays off-limits.

**How the over-broad version survived two days.** The original probes
animated the drawn root — the natural thing to reach for when the question
is "does this Surface fade?" — and every reading was accurate for that
target. Nothing contradicted it until a *descendant* was animated for an
unrelated reason (verbatim shadcn markup, whose `animate-in` keyframes run
on portaled content deep inside the subtree) and visibly worked. Any claim
of the form "property P can't be captured" must name **which element P is
on**; el-vs-descendant is a real seam in this API, not a detail.

`getElementTransform()` existing at all is the API conceding the same
seam: the drawn element's own transform is handed to you *separately*,
because it is not part of what gets replayed.

**Untested, suspected compositor-side:** `<video>` frames, animated GIFs,
`<canvas>` children, CSS filters, `will-change` side effects, scroll
offsets inside the subtree. Assume broken until probed; route media around
the DOM path (see authoring.md).

## A `layoutSubtree` canvas is a containing block, not a viewport (2026-07-31, lab 009)

A parked source root establishes the **containing block for `position:
fixed` descendants** — and that is the *only* thing about it that is
canvas-local. Everything that asks "how big is the viewport" still answers
with the page.

Probe: a 360×460 source canvas on a 1280×720 page, measuring the same
constructs inside the parked subtree and on the page.

| Construct | Inside a 360×460 Surface | On the page |
|---|---|---|
| `position: fixed; inset: 0` | **360×460** — the slab | 1280×720 |
| `width: 100vw; height: 100vh` | 1280×720 | 1280×720 |
| `100dvw` / `100dvh` | 1280×720 | 1280×720 |
| `width: 100%` (control) | 360×460 | 1280×720 |
| `@media (min-width: 900px)` | matches | matches |
| `matchMedia('(max-width: 500px)')` | `false` | `false` |
| `innerWidth` / `innerHeight` | 1280 / 720 | 1280 / 720 |
| `documentElement.clientWidth` / `clientHeight` | 1280 / 720 | 1280 / 720 |
| `visualViewport` | 1280×720 | 1280×720 |

This is the ordinary CSS distinction between a **containing block** and the
**viewport**. For `position: fixed` those are normally the same object,
which is why the two ideas get conflated — a `layoutSubtree` canvas pries
them apart. Nothing here is special-cased for the origin trial: `contain:
layout`, `filter`, and `transform` all establish fixed-positioning
containing blocks the same way. The canvas is just another one.

**What it buys.** A whole category of "chrome" component needs no plumbing
at all, because it was already written against the containing block:

- sonner's `<Toaster>` doesn't portal — it renders inline and pins itself
  `position: fixed` with corner offsets. Mount it in a Surface and it pins
  to *that slab*: measured at 24px from the slab's right and bottom edges,
  its default offset, with zero coordinate math ([decisions.md
  #21](decisions.md)).
- Radix's `DialogOverlay` is `fixed inset-0` — it fills the slab exactly.
- `DialogContent`'s `top-50% left-50%` centres on the slab.

**What it costs.** Viewport-relative *authoring* silently means the page.
See [authoring.md](authoring.md): `vw`/`vh` and every Tailwind responsive
variant (`sm:`, `md:`) resolve against the browser window, not the Surface
they are inside.

**It also explains an earlier mystery.** In lab 009 increment 2 a Radix
`Select` measured 568px tall inside a 460px panel. Radix computes
`--radix-select-content-available-height` in **JavaScript**, from
`window.innerHeight` — page-global by the table above, while the slab it
was sizing itself into is canvas-local. Anything that measures the viewport
*in JS* rather than declaring itself *in CSS* inherits that gap. In the
vendored shadcn set exactly two files consume available-height —
`select.tsx:71` and `dropdown-menu.tsx:45` — and there are no `vh`/`vw`
literals anywhere.

## Scale (probe results, 2026-07-29)

Harness: `?probe=N&live=1&anim=K&w=&h=` + `window.__probe.run(seconds)` —
rAF frame-time percentiles + per-source paint rates. Hardware context
matters: M-series MacBook, 120Hz display (8.33ms budget), dpr 2.

**Cost is per-source fixed overhead, not pixels.** With the pre-rewrite
pipeline (repaint + upload every source every frame): N=64 locked at
120fps at **both** 320×200 and 640×400 per card (4× the texels — no
difference); N=96 → 95.6fps; N=128 → 72.9fps. And 128 *idle* Surfaces
cost the same as 128 animating ones (73.2fps) — which motivated the
upload-on-paint rewrite ([decisions.md #3](decisions.md)).

After the rewrite (`paint="auto"`, passive):

| config (320×200) | fps | paints/s |
|---|---|---|
| N=128, all idle | 120.0 | 0 |
| N=128, 32 animating | 120.0 | 0 idle / 120 animating |
| N=128, 64 animating | 108.0 | — |
| N=96, all animating | 100.6 | 100.6 |
| N=128, all animating | 76.9 | 76.9 |

Practical budget: **idle Surfaces are free; ~64–96 simultaneously
painting sources at 120Hz** on this hardware (roughly double the headroom
at 60Hz — the ceiling is refresh-relative). Weaker hardware unmeasured.
`texElementImage2D` (untried) targets exactly this per-source fixed cost.

A real interaction for scale: one lab-005 toggle flip = **2 paints
total** (mount + the coalesced flip mutations), then quiescent.

## Rescale — the record replays as vectors (2026-07-29, lab 006 addendum)

The display-list model has an upside as load-bearing as its limits:
paint records are **resolution-independent draw commands**. Replaying
one under a scaled CTM is a true re-render — glyphs re-rasterize at the
new density — not a bitmap upscale. This is what makes dynamic texture
LOD possible at all; a screenshot API could never do it.

| # | Claim | Evidence |
|---|---|---|
| 8 | **(corrected 2026-07-30)** The replay auto-scales by the canvas's **backing/CSS ratio**, and the CTM multiplies **on top**: effective scale = ratio × CTM. Resize the backing and draw under an **identity** CTM; a CTM of k on a k×-resized canvas double-applies (k² — content crops to the top-left 1/k of the face) | position-marker dots at known CSS coords: ratio 3 + CTM 1 → 3×; ratio 1 + CTM 3 → 3×; ratio 3 + CTM 3 → 9×; ratio 0.5 + CTM 1 → 0.5× |
| 9 | Resizing the backing store while the canvas's **CSS size is pinned** never relayouts the subtree: focus, caret, selection, and form state survive | contenteditable held focus + caret through 1.5→0.5→1.5 swaps mid-edit |
| 10 | A backing-store resize does **not** self-fire `onpaint` (the element's record didn't change) — an explicit `requestPaint()` is required after resize | `setScale` in htmlInCanvas.ts |
| 11 | A rescale costs exactly one paint + one upload | doc-0 lifetime: 3 paints total across mount → 1.5× → 3×; 41 tier changes during a full orbit sweep at a held 120fps |

Context state resets on resize, so the (identity) transform is asserted
inside every `onpaint` (cheap), not set once.

**How claim 8's original version survived falsified for a day.** The
first form — "the CTM scales the replay, verified k = 0.5/1.5/3" — was
established with crispness screenshots and an edge-width probe. Both are
**scale-blind**: a vector re-raster is crisp at *any* effective scale,
and alpha-coverage scans can't tell "full doc at k×" from "top-left crop
at k²×" (both fill the canvas with opaque pixels). The k² error shipped
invisibly because a *second* bug (three.js immutable texture storage,
decisions #10) ate every high-tier upload; fixing that unmasked this.
Only **position-aware** probes discriminate: marker dots at known CSS
coordinates (measure centroid and size in the canvas), or a full-element
dye read against expected bounds. Any future claim about *where* the
replay lands must be established that way.

## Re-verification checklist (when Chrome updates)

1. HUD chips: `drawElementImage ✓ / texElementImage2D ✓` on load.
2. Self-paint: does a mutation fire `onpaint` with no `requestPaint`?
3. Resolve: red→blue single-mutation experiment — buffer shows blue?
4. Root-vs-descendant: run the same opacity keyframe on the content root
   and on a descendant div, sampling the source-canvas pixel under a
   known-position landmark. Expect frozen + 1 paint for the root, a full
   per-frame ramp + 1 paint/frame for the descendant. If the **root** case
   starts self-painting, the authoring rule can be relaxed further; if the
   **descendant** case stops, `useAnimationConductor` is load-bearing for
   correctness and not just for cost.
5. Probe: `?probe=128` → 120fps at 0 paints/s; `?probe=96&live=1` ceiling.
6. Rescale: dolly inside 1.5 world units of a lab-006 panel → tier 3
   commits with one paint, glyphs sharpen; a focused field keeps its
   caret through the swap.
7. Replay scale (position-aware — crispness alone cannot verify this):
   inject a 6px marker dot at a known CSS position, resize backing to
   k× with identity CTM → dot centroid at k× its CSS position, k× its
   size, at k = 0.5 and 3. If the auto-ratio behavior changed, the
   identity-CTM contract in `htmlInCanvas.ts` must change with it.
