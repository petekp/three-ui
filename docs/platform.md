# Platform contract — Chrome HTML-in-canvas, empirically

**Status of this document:** observations, not rules. Every claim is dated,
tied to a Chrome version, and paired with the experiment that established
it, so a future Chrome can be re-tested claim by claim. For what to *do*
about these facts, see [authoring.md](authoring.md). All trial-API contact
in code is confined to `src/lib/htmlInCanvas.ts`.

Last verified: **2026-07-29, Chrome 150, macOS (M-series, 120Hz, dpr 2)**,
launched with `--enable-features=CanvasDrawElement`.

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

## Compositor-owned properties (the hard limit)

Properties the compositor animates on promoted layers never enter the
paint record. **No paint policy can capture them** — `paint="always"`
repainting every frame reads the same stale record.

| Case | Result | Evidence (2026-07-29) |
|---|---|---|
| `opacity` keyframe animation | **frozen** at pre-animation raster | alpha constant 255 through a full 1↔0.1 cycle, sampled per frame with per-frame `requestPaint` |
| `opacity` **static** (no animation) | **bakes correctly** | `opacity:0.3` → alpha 77 |
| `transform` static, on a child of the drawn element | **bakes correctly** | `translateX(100px)` child rasterizes at the transformed position |
| `opacity` transition | **no tween AND stale end state**: raster keeps the old value after the transition completes | `.4s` transition 1→0.2: mid = 255, 600ms past end = 255 |
| …until any unrelated repaint | **self-heals** | subsequent `textContent` change re-bakes: alpha 51 (= 0.2) |

The transition case is the dangerous one: it produces an *intermittently
wrong* texture that silently corrects on the next incidental mutation — a
heisenbug generator hiding inside `transition: opacity`, the most common
idiom on the web.

Mechanism: animating opacity/transform promotes the element to its own
compositor layer; the record then carries the base value and the real one
lives on the layer. Any fresh re-record (an unrelated mutation) bakes the
current computed value again. The API itself hints at this division:
`getElementTransform()` exists precisely because transforms are handed to
you *separately* from the paint.

**Untested, suspected compositor-side:** `<video>` frames, animated GIFs,
`<canvas>` children, CSS filters, `will-change` side effects, scroll
offsets inside the subtree. Assume broken until probed; route media around
the DOM path (see authoring.md).

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
| 8 | `drawElementImage` honors the 2D context transform: `setTransform(k,0,0,k,0,0)` replays the record at k× with crisp re-rasterized text (verified k = 0.5, 1.5, 3) | lab 006 close-up screenshots, before/after |
| 9 | Resizing the backing store while the canvas's **CSS size is pinned** never relayouts the subtree: focus, caret, selection, and form state survive | contenteditable held focus + caret through 1.5→0.5→1.5 swaps mid-edit |
| 10 | A backing-store resize does **not** self-fire `onpaint` (the element's record didn't change) — an explicit `requestPaint()` is required after resize | `setScale` in htmlInCanvas.ts |
| 11 | A rescale costs exactly one paint + one upload | doc-0 lifetime: 3 paints total across mount → 1.5× → 3×; 41 tier changes during a full orbit sweep at a held 120fps |

Context state resets on resize, so the transform is reapplied inside
every `onpaint` (cheap), not set once.

## Re-verification checklist (when Chrome updates)

1. HUD chips: `drawElementImage ✓ / texElementImage2D ✓` on load.
2. Self-paint: does a mutation fire `onpaint` with no `requestPaint`?
3. Resolve: red→blue single-mutation experiment — buffer shows blue?
4. Compositor: animated-opacity experiment — alpha still frozen? (If this
   *starts working*, the authoring rules in authoring.md can be relaxed.)
5. Probe: `?probe=128` → 120fps at 0 paints/s; `?probe=96&live=1` ceiling.
6. Rescale: dolly inside 1.5 world units of a lab-006 panel → tier 3
   commits with one paint, glyphs sharpen; a focused field keeps its
   caret through the swap.
