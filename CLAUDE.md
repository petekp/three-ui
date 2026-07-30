# three-ui — working rules

Live DOM as physical matter in WebGL (Chrome HTML-in-canvas origin
trial). README.md is the chronological lab journal; durable knowledge is
in `docs/` — **read `docs/platform.md` before touching
`src/lib/htmlInCanvas.ts` or `Surface`'s paint path**, and
`docs/decisions.md` before "simplifying" anything it covers.

## Hard rules (each one is paid for — see docs/decisions.md)

- **Never animate/transition `opacity` or `transform` inside Surface
  markup** (keyframes, transitions, WAAPI). Compositor-owned: keyframes
  freeze in the texture; transitions leave a *stale* end state that
  self-heals on the next unrelated repaint — an intermittent bug by
  construction. Pulse paint properties (background/box-shadow); move or
  fade the mesh instead. Static opacity/transform values are fine.
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
