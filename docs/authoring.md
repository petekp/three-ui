# Authoring Surfaces — the dialect

**Status of this document:** rules. The facts behind them live in
[platform.md](platform.md); if a fact changes under a future Chrome, the
rule it supports should be revisited.

## The one-line rule

> **If it changes what the surface *says*, mutate the DOM.
> If it changes where the surface *is* or how present it is, move the matter.**

A Surface is a screen skinned onto a physical object. Screens change their
pixels; they don't move themselves — the device moves. Content lives in
the texture; motion and blending live on the mesh.

## What's safe in Surface markup

| Change | Verdict | Notes |
|---|---|---|
| Text/number updates | ✅ | self-paints; coalesced mutations = 1 paint |
| `color`, `background`, `box-shadow`, `border` — static or animated | ✅ | paint properties; animations self-paint per frame |
| Layout: width/height, flex, grid, element insertion/removal | ✅ | layout+paint; transitions fine, count as "animating" while running |
| Static `opacity`, static `transform` (incl. on children) | ✅ | baked into the paint record |
| JS-driven style mutation (set `style.*` per frame) | ✅ | each mutation rebuilds the record |
| Focus rings, caret, selection | ✅ | self-paint (caret blink included) |
| `:hover` / `:active` styling | ✅ via mirror | author as `[data-hover]` / `[data-active]` alongside the pseudo-class — synthetic events can't flip pseudo-classes |
| **Animated/transitioned `opacity` or `transform`** (CSS keyframes, transitions, WAAPI) | ❌ **never** | compositor-owned: keyframes freeze; transitions show no tween *and leave a stale end state* until an unrelated repaint heals it. `paint="always"` cannot fix this. |
| `<video>`, animated GIF, `<canvas>`, CSS filters, `will-change`, inner scrolling | ⚠️ untested | assume broken; route media around the DOM (below) |

## Translate 2D idioms, don't port them

Most web animation is a *simulation of physicality* — pantomime for a
medium without depth. three-ui has the real thing, and the platform limit
lands exactly on the pantomime properties. Every banned idiom has a
strictly better native equivalent:

| 2D idiom (banned in markup) | Native equivalent |
|---|---|
| `translateY(-2px)` hover lift | real lift along the surface normal (`SurfaceLayer` `lift`, or mesh position) |
| modal scales in from 95% | physical arrival: mesh transform driven by `physics1D` |
| fade in/out via `opacity` tween | `material.opacity` on the mesh — blends against the actual scene with correct lighting |
| growing `box-shadow` for elevation | real Z + real shadows (`ContactShadows`) |
| CSS spring/tween libraries | force fields on the 1-DOF integrator — flicks and throws carry real momentum |
| spinner via `transform: rotate` keyframes | rotate the mesh; or pulse a paint property |

Glow/pulse effects stay in markup — as **paint** properties (the lab-004
tip pulses `background` + `box-shadow`, not `opacity`).

## Media

Don't route video through `drawElementImage` — the compositor owns those
pixels. Compose it as matter instead: a `<SurfaceLayer>`-anchored quad
with a `THREE.VideoTexture` material sits inside DOM-driven UI at the
right spot, with the anchoring system doing the layout.

## The paint budget

Two accounts, very different balances:

- **Motion is nearly free.** A moving/rotating mesh doesn't touch its
  texture. Hundreds of physically tumbling idle Surfaces cost the paint
  pipeline nothing.
- **Painting is the scarce resource.** Every *simultaneously changing*
  subtree pays a per-source fixed cost (size barely matters). Budget
  **~64–96 concurrently painting Surfaces at 120Hz** (M-series numbers;
  ~2× headroom at 60Hz). Idle Surfaces — however many — are free under
  `paint="auto"`.

Corollaries: prefer burst-y mutations (a settled value) over per-frame
DOM writes where the feel allows; a layout transition makes that Surface
"animating" for its duration; `paint="always"` opts a Surface out of the
free-idle contract — reserve it for content that changes without paint
records, and expect it to spend budget continuously.

## Resolution

Authors do nothing: `resolution="auto"` (the default) re-rasterizes the
texture when the Surface's projected screen size crosses a tier
boundary — walk up to a panel and its type sharpens; back away and the
memory returns. Each committed tier costs one paint, debounced and
hysteresis-guarded, so it never competes with the animation budget. Pin
`resolution={n}` only when density must not change (e.g. a texture
consumed by a shader that assumes fixed texel coordinates).

## Interaction caveats (current)

- Fast-**moving** interactive Surfaces can dodge a click (press-time UV
  locking is planned). Motion is cheap, but aim before you make small
  targets fly.
- Native `<select>` can't be opened synthetically — render pickers as
  their own Surface (the lab-003/004 pattern).
