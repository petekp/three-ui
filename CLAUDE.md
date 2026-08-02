# three-ui — working rules

Live DOM as physical matter in WebGL (Chrome HTML-in-canvas origin
trial). README.md is the chronological lab journal; durable knowledge is
in `docs/` — **read `docs/platform.md` before touching
`src/lib/htmlInCanvas.ts` or `Surface`'s paint path**, and
`docs/decisions.md` before "simplifying" anything it covers.

## Two trees

- **`src/`** — the library. Public surface is `src/index.ts`, plus the
  stylesheet at `src/three-ui.css` (all mechanism; it documents the three
  things it asks of a consumer's CSS in return). Nothing in here may
  import from `app/`.
- **`app/`** — the lab application, a *consumer*. It reaches the library
  only through the `three-ui` / `three-ui/style.css` specifiers (aliased
  in `vite.config.ts` and `tsconfig.app.json`), exactly as an outside
  project would — so anything missing from the barrel breaks the build
  instead of slipping past on a relative path. `app/shadcn.css` is this
  app's Tailwind theme and its answers to what `three-ui.css` asks for.

Both directions are enforced by `src/boundary.test.ts`. When a scene
wants something that isn't exported, export it — don't reach around.

## Hard rules (each one is paid for — see docs/decisions.md)

- **Never animate/transition `opacity` or `transform` on a Surface's
  *content root*** (keyframes, transitions, WAAPI). Changing the drawn
  element's own opacity/transform doesn't invalidate its paint record, so
  nothing repaints: keyframes freeze; transitions leave a *stale* end
  state that self-heals on the next unrelated repaint — an intermittent
  bug by construction. On **descendants** they work correctly (measured
  2026-07-31 — platform.md was wrong about this until then), but cost one
  paint + one upload per frame; route them through
  `useAnimationConductor` or move the mesh (decisions.md #17).
- **No `mask-image` anywhere inside a drawn subtree.** A mask on any
  descendant — even one computed to a fully opaque no-op gradient — makes
  the ENTIRE capture come out black except independently-composited
  descendants, with clean paints and no error. shadcn's `scroll-fade-*`
  utilities are neutralized in `app/shadcn.css`; a Surface rendering
  black-except-some-widgets means grep the subtree for masks first
  (platform.md, decisions.md #30).
- **Don't unstop the native pointerdown in `Surface`.** The canvas is
  outside every portaled layer, so without
  `e.nativeEvent.stopPropagation()` any click into a Surface dismisses
  every open Radix popover/menu/dialog. `pointerdown` only — OrbitControls
  needs document-level move/up (decisions.md #18).
- **Don't collapse the departure burst in `clearPointerState`.** Leaving a
  Surface sends `pointerleave` (per element crossed, non-bubbling) and then
  a few frames of `pointermove` outside the source rect. Both halves are
  load-bearing: without the leave, Radix never builds the grace area that
  arms its close listener; sent synchronously, the move lands before that
  listener exists. A real pointer keeps moving after it leaves — ours has
  to as well (decisions.md #19).
- **A Surface that floats in front of another one must be
  `hitTest="content"`.** A full-panel transparent slab is the front-most
  mesh from the frame it goes live, so it catches every ray and the panel
  behind hears `onPointerOut` — which fires the departure burst above and
  dismisses whatever just opened. Content-gating makes the ray pass through
  wherever the DOM painted nothing, and subsumes liveness gating entirely
  (an empty layer is inert by construction). Its container needs
  `pointer-events: none` with `auto` on its children — `.ui-layer > *` in
  `src/three-ui.css` — and note `createDomTextureSource` re-roots the cascade to
  `auto`, because the parking canvas's `none` inherits (decisions.md #20).
- **Every element handed to `drawElementImage` must declare explicit pixel
  dimensions.** It rasterizes an element at its *own layout box*, and a
  container whose children are all `position: fixed` (any portal target, so
  every floating layer) has nothing in flow to size it — it measures zero
  and draws an empty rectangle with clean paints and no error. Measure the
  content with `offsetWidth`/`offsetHeight`, never
  `getBoundingClientRect()`: the rect includes the entrance transform and
  bakes `zoom-in-95` into the texture (platform.md, decisions.md #22).
- **`createDomTextureSource`'s `setSize` must move the closed-over
  `width`/`height`, not just the canvas attributes** — `setScale` multiplies
  the closed-over pair, so a resize that skips them is silently reverted by
  the next LOD tier swap and stays diverged. Guarded by
  `htmlInCanvas.test.ts` (decisions.md #22).
- **Don't add repaint loops, MutationObservers, or dirty-flag heuristics
  to `Surface`.** `paint="auto"` is passive on purpose: the compositor's
  self-firing `onpaint` is the change signal (`paintCount`). Measured
  alternatives were all worse (decisions.md #3). (`FloatingSurface`'s
  observers are not this: they answer *what exists* and *how big*, which the
  compositor never reports, and neither one triggers a repaint.)
- **Drag math: `e.ray` ∩ drag-plane, never `e.point`; handlers on a
  static object**, moving parts only gate drag-start (decisions.md #4).
- **Media never goes through `drawElementImage`** — use a
  `SurfaceLayer` + `THREE.VideoTexture` quad (decisions.md #5).
- Late-mounted Surfaces must bump `material.needsUpdate` when the
  texture arrives (already handled inside `Surface` — don't remove it).
- `:hover`/`:active` must be authored as `[data-hover]`/`[data-active]`
  alongside the pseudo-classes — and `:focus-visible` must exclude
  `[data-pointer-focus]` (the browser's ring verdict never hears synthetic
  events, so Surface mirrors it; decisions.md #24).
- **Window is a party line — every synthetic event leaves through
  `forge()`, and page-level pointer listeners guard `if (!e.isTrusted)
  return`.** The retellings bubble to document BY DESIGN (Radix's grace
  areas live there — never stop them), so provenance is the listener's job:
  `isTrusted` is the default guard, exported `isForgedEvent()` the
  complement for legitimately-untrusted input. Never dispatch a synthetic
  event outside `forge()` — the brand (`Symbol.for`, HMR-proof) is what
  makes the predicate complete. The forged vocabulary is pointer/mouse +
  boundary + burst + wheel + change, NEVER keyboard (that's why keyboard
  listeners stay unguarded). And a held-button move that began off-surface
  is a foreign capture — the forwarder stays silent until release
  (OrbitControls' rotate anchor was measured taking a departure burst as a
  10px→teleport delta; decisions.md #50/#51).
- **A DOM→mesh handoff keys on `Surface`'s `onFirstUpload`, never on a
  frame count — and companion chrome (shadows, glows) gates on the same
  signal.** "Three frames until the upload" is a race that loses under
  load: the page copy hides early and the slot flashes through. Worse, on
  the first rendered frame the source hasn't painted, the quad draws
  nothing, and an ungated shadow stamps a card-shaped veil over the
  still-visible DOM — a black flicker at every grab. Content first, then
  its chrome. And a vacated slot's `[data-empty]` styling may touch PAINT
  properties only (outline/background, never border/padding/size): a
  1.5px border marched the page 2px at every liftoff (decisions.md #54).
- **A custom `ShaderMaterial` sampling `useSurfaceTexture` must end its
  fragment shader with `#include <colorspace_fragment>`.** The texture is
  `SRGBColorSpace`, so the sampler hands the shader LINEAR values; built-in
  materials re-encode on output, a raw shader does not, and the miss writes
  linear into the sRGB canvas — every AA midtone sinks, text renders darker
  and heavier than the same pixels at rest, no error anywhere. Sampling
  softness is a different diagnosis path: texels vs screen vs DOM in one
  screenshot (decisions.md #53).

## Verifying changes

- `npm run test` (vitest — physics + UV anchor suites), `npx tsc -b`.
- Browser evidence beats reasoning: dev server + agent-browser with
  `AGENT_BROWSER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
  headed, `--args "--enable-features=CanvasDrawElement,--disable-backgrounding-occluded-windows,--disable-renderer-backgrounding"`.
  Check the HUD chips (`drawElementImage ✓`) before trusting results —
  the daemon relaunches Chrome *without* flags if the window closes. Pass
  `--session <name>` on **every** call (right after `agent-browser`), or
  another client sharing the daemon will steal the tab mid-run. Multi-line
  probes go in via `eval --stdin < probe.js`; there is no `--file`.
- Perf: `?probe=N&live=1&anim=K&w=&h=` + `await __probe.run(5)`.
  Idle Surfaces must stay at 0 paints/s; budget ~64–96 concurrently
  painting sources at 120Hz.
- Scene state: `window.__r3f` (project coordinates at action time — the
  user may be orbiting concurrently), `window.__threeUI.stats()` for
  per-source paint counters, `window.__lab005` etc. for scene hooks.
- r3f HMR can fake broken materials — hard-reload before judging visuals.
  It also fakes broken *modules*: after a dev-server restart the tab can
  end up holding two instances of a pre-bundled dep, and a module-level
  singleton then quietly stops working across them (measured 2026-08-01 —
  `toast()` from one instance, `<Toaster>` subscribed to the other, no
  error anywhere, toasts simply never appeared). Reload before believing
  any "it silently does nothing" result.
