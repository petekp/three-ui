# Instrument inventory — what measures this system, and what ports

Phase 0 artifact, 2026-08-02, cut at `d6848c9`.

The audit's headline: **almost nothing that measured this system is
committed as code.** The runtime hooks live in scene files; every
capture recipe (strip probes, flight traces, uniform pokes) survives
only as prose in decisions.md/README.md, having been typed into
`agent-browser eval --stdin` and discarded. That worked because the
recipes and the findings were written down together; it fails the
moment someone needs to *re-run* one. In the new repo `instruments/`
is maintained infrastructure: the recipes below become committed
modules with the same review bar as the kernel.

Port verdicts: **kernel seam** (public API of the library itself),
**instruments/** (committed harness/probe code), **pattern**
(re-authored per scene; the convention ports, the instance doesn't),
**archive** (stays here, cited).

## Kernel seams (the library's own measurement API)

These are instrument-shaped but belong to the kernel's public surface;
the conformance suite exercises them directly.

- **`stats()`** (today `window.__threeUI.stats()`,
  `src/lib/htmlInCanvas.ts:103-125`): per-source
  `{label, paints, errors, scale, lastError?}`, returned as copies.
  `[]` after a lifecycle is the canonical *nothing-left-painting*
  proof; `paints` deltas are the idle-zero gate's raw feed.
- **`paintCount`** (`htmlInCanvas.ts:86,229`): the compositor's own
  change signal surfaced as a counter — what measured-chrome re-measure
  rides (#55), and the only honest "did it repaint" oracle.
- **`Surface.onFirstUpload`** (`Surface.tsx:71`, latch 284, fire 706):
  THE readiness signal for handoffs (#54). One-shot, re-arms on source
  recreation. Everything that used to count frames now keys here.
- **`onChrome` / `useSurfaceChrome`** (`Surface.tsx:187`): measured
  radius/shadow delivered as data (#55).
- **`detectHtmlInCanvas()`** (`htmlInCanvas.ts:24-33`): feature-tests
  the actual prototypes. The HUD chips (`App.tsx:157-170`) are a
  consumer — and they exist because the agent-browser daemon relaunches
  Chrome *without* flags when the window closes. **Gap to fix in the
  new lab: chips render on every route** (the Lab 014 route has none,
  so its runs were trusted blind).

## The probe harness (→ instruments/)

- **`__probe`** (`app/scenes/ProbeScale.tsx` ~188; routed in
  `App.tsx:32-46,98`): `?probe=N&live=1&anim=K&w=&h=` grid +
  `await __probe.run(seconds)` → `{n, live, anim, cardW, cardH,
  seconds, frames, fps, frameMs: {mean, p50, p95, p99, max}, over17,
  over34, paintsPerSec: {min, mean, max}}`. `paintsPerSec.min` is the
  starvation detector (platform B7). This is the idle-zero CI gate's
  harness — it ports first, as a page the browser runner drives.
- **`__layoutProbe`** (`ProbeLayout.tsx`, `?layoutprobe=1`): `boxes()`
  reads offset geometry of `[data-pane]` — the layout-oracle harness.
- **`__styleProbe`** (`ProbeStyle.tsx`, `?styleprobe=1`): `trace(ms)`
  → per-frame `{t, depth, z}` — the style-channel harness (#28).
- **`__focusProbe`** (`ProbeFocus.tsx:151-191`, `?focusprobe=1`):
  needs real CDP keys (synthetic keydowns don't move focus);
  `docs/focus.md:599-621` is its 7-claim empirical gate. Ports with
  the focus registry pack, not the kernel.
- **`__r3f`** (`App.tsx:108` + 3 more sites; assigned in `onCreated`):
  canonical use is *projecting world→screen at action time* — the user
  may be orbiting concurrently, so coordinates from an earlier
  screenshot are already stale.

## Capture recipes (prose → committed modules)

Each of these was re-derived at least twice from prose. They become
small exported helpers in `instruments/` with their rules encoded, not
re-remembered.

- **gl.render-wrapped readPixels strip probe** (rule at
  decisions.md:2618-2632; used 2764-2772, 2830-2839). `readPixels` is
  only valid *inside a wrapped `gl.render`* — read at rAF time and you
  sample whatever buffer luck left you; a rAF-order accident once
  manufactured a false "dark window" that indicted an innocent density
  flip (#54 postscript). The helper owns the wrapper; callers get
  `sampleStrip(x, y, w, h)` and cannot hold it wrong. Unpremultiply
  before comparing to DOM colors (#58: the border column unpremults to
  the border color exactly).
- **In-loop `drawImage` crops** (decisions.md:2899-2903): daemon
  screenshots land seconds late; same-frame evidence comes from
  copying the source canvas *inside the render loop*. Pairs with the
  strip probe in one module.
- **Per-frame flight traces**: render-wrapper traverse recording
  `{t, z, amp, mode, …}` per frame (the `__lab009` `recordInto`
  pattern, lines 90-104, is the house form). Termination signature:
  **the trace STOPPING is the swap instant** — drag flight refs never
  null on settle (only crumple commits null), so null-polling is
  meaningless for drags (#62). The recorder ports; each scene feeds it
  its own refs.
- **Forced-uniform poke bisect** (#59 addendum): set the uniform
  inside a wrapped `gl.render` (last writer wins over the driver) —
  e.g. `uAero.value.set(1, 0, 60, 240)`. Instant answer to "shader end
  or driver end?": if the mesh responds, every wire from the driver is
  suspect; if not, the shader is. Ships as a recipe doc + the wrapper
  helper; uniform names are per-material (`uAero` =
  `(dir.x, dir.y, amp, reach)`, `uWad` = `(crush, seed, wadR)` in the
  archive's flight card, `Lab014.tsx:327-337`).
- **Position-aware probes** (platform H8 doctrine): marker dot at
  known CSS coords → centroid + size in canvas space; full-element dye
  against expected bounds. The only probes that can catch a
  where-did-it-land error; crispness checks cannot (scale-blind, k²
  crops instead of blurring). Ships as a helper next to the strip
  probe.
- **Computed-style traces**: `getComputedStyle` mid-transition is the
  eased oracle (#28); **`oklab(...)` with no alpha slash is OPAQUE** —
  parse the slash, don't length-check the string (#57's ghost-outline
  instrument bug). Encode the parser once.
- **Texel-vs-screen-vs-DOM bisect** (#53): one screenshot comparing
  texture texel count, on-screen footprint, and the DOM's own render
  answers "capture, display, or transfer?" before any code is
  suspected. Recipe doc.

## The browser workflow (→ instruments/ wrapper script)

Today this is loose knowledge; port it as a checked-in wrapper so the
hazards are structural, not remembered:

- Launch: `AGENT_BROWSER_EXECUTABLE_PATH` → real Chrome, `--args`
  carrying `--enable-features=CanvasDrawElement` **plus**
  `--disable-backgrounding-occluded-windows,--disable-renderer-backgrounding`
  (an occluded window rAF-throttles and every timing number lies).
- `--session <name>` on **every** call — another daemon client will
  steal the tab mid-run otherwise.
- Multi-line probes via `eval --stdin < probe.js`; there is no
  `--file`.
- **Atomic sampling**: one eval that computes and returns, never
  read-then-read (the #10 probe once summed counters across two evals
  and double-counted a paint).
- **Hard-reload before judging** any "silently does nothing" result:
  r3f HMR fakes broken materials, and a dev-server restart can leave
  the tab holding **two instances of a pre-bundled dep** — a
  module-level singleton then splits brains with no error (measured
  2026-08-01: `toast()` from one instance, `<Toaster>` subscribed to
  the other). This is also why `forge()`'s brand is `Symbol.for` and
  why the door layer gets a duplication test.
- Trust no run without the capability chips (see kernel seams above).
- CLI `computer` drags are too slow to flick — **CDP-driven drags
  deliver real velocity** (#61's toss could only be tested that way).

## Test suites as instruments (20 suites, 357 tests)

Port destinations are in [manifest.md](manifest.md); what matters
here is the *conventions* they carry:

- **Browser-measured fixtures with provenance**: pinned Chrome numbers
  checked in as data — speed profiles RAMP/HOLD/CRASH/REST/FLIGHT/
  DECEL/BAND/TAIL (`lab014Plate.test.ts:421-437,465-476`), the 33-rect
  full-field capture (`spatialNav.field.test.ts`, camera [0,2,3.4] @
  1280×720, 2026-07-31), scrub samples (`motionSamples.test.ts`),
  verbatim computed shadow strings (`surfaceChrome.test.ts`), the
  1.13 rad camera whip (`cameraPose.test.ts`). Every fixture states
  where/when it was captured; re-capture is a documented act, not a
  test edit.
- **happy-dom only where line 1 declares it**, with stubs owning the
  layout answers (`layoutOracle`, `styleChannel`, `surfaceChrome`,
  `hoverGrace`, `htmlInCanvas`, `forwardEvents`, `lab014Gestures`).
  One measured trap: happy-dom events are all untrusted, so gesture
  tests shadow `isTrusted` per instance.
- **Simulation helpers over mocks** for physics (`simulate` in
  `physics1D.test.ts`, `frames()` drivers in `lab014Plate.test.ts`) —
  determinism asserted bit-for-bit, perceptual floors asserted as
  budgets.
- `tests/boundary.test.ts` — filesystem-walk import rules. (Old
  CLAUDE.md says `src/boundary.test.ts`; that path is stale.) The new
  monorepo generalizes it per-package from the first commit.
- Verification pair today: `npm run test` + `npx tsc -b` — there is
  **no typecheck npm script**; the new repo should have one so the
  pair is two named scripts.

## Per-lab hook pattern (pattern, not port)

Every scene exposes `window.__labNNN` with its live refs
(`__lab014 = {flight, cardRef}` at `Lab014.tsx:1145`;
`__lab012` shader knobs; `__glassInk` at `glassSdf.tsx:202` — a
`Map<label, Texture>` registry that is "the only way to tell a UV bug
from a rasterization bug from outside"). The convention ports as a
house rule: **a scene that can't be interrogated from the console
isn't done.** The instances stay here.
