# three-ui — working rules

Live DOM as physical matter in WebGL (Chrome HTML-in-canvas origin
trial). README.md is the chronological lab journal; durable knowledge is
in `docs/` — **read `docs/platform.md` before touching
`src/lib/htmlInCanvas.ts` or `Surface`'s paint path**, and
`docs/decisions.md` before "simplifying" anything it covers.

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
  `ui.css` — and note `createDomTextureSource` re-roots the cascade to
  `auto`, because the parking canvas's `none` inherits (decisions.md #20).
- **Don't add repaint loops, MutationObservers, or dirty-flag heuristics
  to `Surface`.** `paint="auto"` is passive on purpose: the compositor's
  self-firing `onpaint` is the change signal (`paintCount`). Measured
  alternatives were all worse (decisions.md #3).
- **Drag math: `e.ray` ∩ drag-plane, never `e.point`; handlers on a
  static object**, moving parts only gate drag-start (decisions.md #4).
- **Media never goes through `drawElementImage`** — use a
  `SurfaceLayer` + `THREE.VideoTexture` quad (decisions.md #5).
- Late-mounted Surfaces must bump `material.needsUpdate` when the
  texture arrives (already handled inside `Surface` — don't remove it).
- `:hover`/`:active` must be authored as `[data-hover]`/`[data-active]`
  alongside the pseudo-classes.

## Verifying changes

- `npm run test` (vitest — physics + UV anchor suites), `npx tsc -b`.
- Browser evidence beats reasoning: dev server + agent-browser with
  `AGENT_BROWSER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
  headed, `--args "--enable-features=CanvasDrawElement,--disable-backgrounding-occluded-windows,--disable-renderer-backgrounding"`.
  Check the HUD chips (`drawElementImage ✓`) before trusting results —
  the daemon relaunches Chrome *without* flags if the window closes.
- Perf: `?probe=N&live=1&anim=K&w=&h=` + `await __probe.run(5)`.
  Idle Surfaces must stay at 0 paints/s; budget ~64–96 concurrently
  painting sources at 120Hz.
- Scene state: `window.__r3f` (project coordinates at action time — the
  user may be orbiting concurrently), `window.__threeUI.stats()` for
  per-source paint counters, `window.__lab005` etc. for scene hooks.
- r3f HMR can fake broken materials — hard-reload before judging visuals.
