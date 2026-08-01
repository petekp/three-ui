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
| Static `opacity`, static `transform` on a **descendant** | ✅ | baked into the paint record |
| Static `opacity`/`transform` **on the content root**, *changed after mount* | ⚠️ | bakes only when some unrelated mutation next re-records — until then the texture shows the old value. Set it before first paint or not at all |
| JS-driven style mutation (set `style.*` per frame) | ✅ | each mutation rebuilds the record |
| Focus rings, caret, selection | ✅ | self-paint (caret blink included) |
| `:hover` / `:active` styling | ✅ via mirror | author as `[data-hover]` / `[data-active]` alongside the pseudo-class — synthetic events can't flip pseudo-classes |
| **Animated/transitioned `opacity`/`transform` on the content root** | ❌ **never** | changing the drawn element's own opacity/transform doesn't invalidate its record, so nothing repaints: keyframes freeze; transitions show no tween *and leave a stale end state* until an unrelated mutation heals it. `paint="always"` cannot fix this — it replays the cached record |
| Animated/transitioned `opacity`/`transform` on a **descendant** | ⚠️ works, costs | genuinely rasterizes per frame (measured) — but at **1 paint + 1 upload per frame**, ~120/s. Fine for one-off UI; ruinous at scale. Prefer `useAnimationConductor` (2 paints total) or move the mesh |
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

## "Viewport" means the page — except for `position: fixed`

A Surface's source canvas is the **containing block** for `position: fixed`
descendants, but it is **not a viewport**. Exactly one construct is
Surface-local; everything else still measures the browser window
([platform.md](platform.md) has the probe table).

| In Surface markup | Resolves against |
|---|---|
| `position: fixed`, `inset`, `top/right/bottom/left` | ✅ **the Surface** |
| `vw` `vh` `dvw` `dvh` `svh` `lvh` | ⚠️ the page |
| `@media (min-width: …)`, so every `sm:` `md:` `lg:` variant | ⚠️ the page |
| `matchMedia`, `innerWidth/Height`, `visualViewport` (JS) | ⚠️ the page |
| `%`, `em`, `rem`, `cq*` units | ✅ normal, as anywhere |

So a 360px-wide Surface on a 1280px page is styled as though it were
1280px wide: `md:flex-row` applies, `w-[50vw]` is 640px and overflows the
slab four times over. The fix is **container queries**, which ask the
element instead of the window — put `@container` on the content root and
use `@sm:`/`@md:` variants. That is the element-relative mechanism the
responsive variants only approximate.

This cuts the other way too, and it's the good half: anything already
written against the containing block lands inside the slab for free. A
toast stack pinned `fixed bottom-4 right-4` pins to the *Surface's* bottom
right. A modal overlay at `fixed inset-0` covers exactly that Surface. No
coordinate plumbing, no measurement — see [decisions.md #21](decisions.md).

Watch for libraries that measure the viewport **in JavaScript** rather than
declaring themselves in CSS: they get the page number and size themselves
wrong. Radix's `--radix-*-content-available-height` is the live example
(`select.tsx`, `dropdown-menu.tsx`).

## Where a portaled thing goes: three containers

Floating content is aimed with one lever — the `container` prop — and the
choice of container is the whole decision. Nothing else changes.

| Aim it at | Idiom | Use for |
|---|---|---|
| a panel's layer (`.ui-layer` on an overlay plane) | **anchored** — a decal in front of the panel it belongs to | Select, Tooltip, DropdownMenu: anything whose meaning is "attached to this control" |
| `CameraChrome`'s slab | **at the eye** — spans the frustum, one source px per screen px | Toasts, modals: anything anchored to the viewer rather than to an object |
| a `FloatingSurface` | **detached** — its own object at its own pose in the room | content that should be furniture: orbit-able, occluding, casting shadows |

The first two keep the positioner's answer, because their canvas shares an
origin with the thing being positioned against. A `FloatingSurface`
**revokes** it (`.ui-detached` in `ui.css`) and takes the pose from the
scene graph instead, so `side` / `align` / `sideOffset` / `avoidCollisions`
are still authored and are silently ignored. Its canvas is sized to the
content, so the content root's size is written for it — this is the one
place you do *not* declare your own pixel size ([decisions.md
#22](decisions.md)).

Dismissal survives detachment for click-driven layers, because
pointer-down-outside is a containment question about the DOM tree and
detaching doesn't touch the DOM tree. **Hover**-driven layers reason about
the swept region between trigger and content in page coordinates; that
region is meaningless once the two are separate meshes, so don't detach a
tooltip or a hover menu yet.

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
