# Seed manifest — decisions #1–#62 triaged for the new repo

Phase 0 artifact, 2026-08-02, cut at `d6848c9` (357/357, tsc clean).

This is the executable half of the archive. Every entry in
[decisions.md](../decisions.md) is triaged for the contracts-first
migration: knowledge moves as **contracts** (tests + distilled rules);
code moves only after its contract lands in the new repo's conformance
suite. This repo then freezes as the runnable oracle — cited, diffed
against, never vendored.

**Citation convention for the new repo:** `archive#N` ⇒
`three-ui@d6848c9 docs/decisions.md` entry N. The new decisions ledger
starts at #1; anything inherited cites its archive number instead of
restating the evidence.

## Verdicts

- **test** — the mechanism ports as conformance-suite tests. Phase 1
  lands them red/skipped; a kernel layer is *done* when its slice
  passes against the new implementation and the oracle agrees.
- **rule** — ports as a normative rule (the new CLAUDE.md / docs):
  it constrains authoring, API shape, or process in a way a unit test
  can't pin (browser-only, perceptual, or a prohibition).
- **hist** — stays in the archive. Cited, not ported: superseded, or
  narrative whose durable lesson is already carried by a test/rule
  elsewhere in this manifest.

Most decisions carry two verdicts: the mechanism is a test, the
doctrine is a rule. "test" without an existing carrier file means the
conformance suite owes a **new** test — those are called out explicitly
in the layer sections.

## Layers

Kernel, in Path-1 landing order:

| tag | layer | one-line charter |
|---|---|---|
| `mapping` | coordinate custody | which space answers which question: page ↔ UV ↔ world, ray ∩ plane, calibrated camera, density |
| `paint` | custody + paint | who owns the pixels at rest: upload-on-paint, LOD/tiers, GL storage, source contract, material slot, **premultiply decision** |
| `door` | the forge | input custody: one door out (`forge`), provenance, hit arbitration, boundary protocol, wheel/drag/focus-verdict |
| `transfer` | the handoff | custody excursions: `onFirstUpload`, density schedule, page-side choreography, motion conduction, swap deadlines |
| `chrome` | measurement | the element is visual truth: measured radius/shadow, mapping-never-lies |
| `physics` | the kit | pure steppers/followers + the **perceptual-floor test class** as named peer of the theorems |

Non-kernel: `react` (thinnest binding), `registry` (copyable behaviors
with tuned constants + citations), `platform` (goes to
[platform-reaudit.md](platform-reaudit.md), trusted only after Phase 2),
`charter` (repo-level doctrine).

## Triage table

| # | decision | verdict | layer |
|---|---|---|---|
| 1 | Primitives over components | rule | charter |
| 2 | Motion is physics, not tweens | test+rule | physics |
| 3 | Upload-on-paint over observers | test+rule | paint |
| 4 | `e.ray` ∩ plane, static handlers | test+rule | mapping |
| 5 | Media routes around the DOM path | rule | paint |
| 6 | UV anchors resolve once, sample live | test+rule | mapping |
| 7 | Conceptual DOFs map pointer deltas | rule | mapping |
| 8 | LOD quantized with hysteresis | test+rule | paint |
| 9 | Reading tiers are mip-free | test+rule | paint |
| 10 | Tier swaps realloc GL storage | test+rule | paint |
| 11 | Identity CTM; backing ratio is the scale | test+rule | paint |
| 12 | `resolution` = intent, not structure | test+rule | paint |
| 13 | Legal poses armed; gaze in yaw/pitch | test | registry(focus) |
| 14 | Centroid cone gates the regime | test | registry(focus) |
| 15 | Orthogonality = centroid outside cross-band | test | registry(focus) |
| 16 | Portaled layer = own Surface on overlay plane | test+rule | react (+mapping) |
| 17 | CSS motion translated onto the mesh | test+rule | transfer |
| 18 | Surface stops the native pointerdown | test+rule | door |
| 19 | A forwarded pointer leaves like a real one | test+rule | door |
| 20 | `pointer-events` honored in hit test AND raycast | test+rule | door |
| 21 | Chrome at the eye; modality is occlusion | rule+hist | react / charter |
| 22 | Detached layer revokes placement, sized to content | test+rule | paint+react |
| 23 | The viewer slab IS the viewport | test+rule | react |
| 24 | `:focus-visible` is a verdict | test+rule | door |
| 25 | The DOM is the layout authority | test+rule | react (core split open) |
| 26 | Silence the trusted hover move | test+rule | door |
| 27 | `elementsFromPoint` is the arbiter | test+rule | door |
| 28 | Custom properties are mesh channels | test+rule | paint (state read-back; core candidate) |
| 29 | The forwarder is the scroll engine | test+rule | door |
| 30 | No `mask-image` in a drawn subtree | rule | paint / platform |
| 31 | Hover grace is a screen-space corridor | test+rule | door |
| 32 | A held button is a capture | test+rule | door |
| 33 | The material slot is a prop | test+rule | paint |
| 34 | Glass buffers occlusion-ordered | hist | — (superseded by #38) |
| 35 | "Max" is the library's word | test+rule | paint |
| 36 | Filtering before the shader; ink premultiplies | test+rule+**debt** | paint |
| 37 | Sharpness is a density match, not an allocation | test+rule | paint |
| 38 | The glass is a distance field | rule | registry(glass) |
| 39 | A merged shape needs a merged gradient | rule | registry(glass) |
| 40 | The ripple is a capillary impulse | rule (+testable law) | registry(glass) |
| 41 | A layout is one distance field | rule | registry(glass) |
| 42 | One texture, many pieces of glass | rule | registry(glass) |
| 43 | Compositing order is view-space depth | test+rule | registry(glass) / charter |
| 44 | The world unit is a CSS pixel | test+rule | mapping |
| 45 | The lever is physics, the fingers are a servo | test+rule | physics |
| 46 | Nothing is moved at the handoff | rule | transfer |
| 47 | r3f's wrapper is styled inline | rule | react |
| 48 | Gesture listeners register unconditionally | test+rule | react |
| 49 | A damper connects two things | test+rule | physics |
| 50 | The library forges pointers; `isTrusted` guards | test+rule | door |
| 51 | A foreign capture means silence | test+rule | door |
| 52 | Born at the display's density | test+rule | paint |
| 53 | Crispness is a rest state | test+rule | transfer (+paint) |
| 54 | Paint-only slots; readiness is the first upload | test+rule | transfer |
| 55 | The element is visual truth (measured chrome) | test+rule | chrome |
| 56 | The quad and the uniforms are one contract | test+rule | chrome |
| 57 | Signage keys on a signal that LEADS the swap | rule | transfer |
| 58 | Matter occludes its own shadow by depth | rule | registry(flight) |
| 59 | The aero bend; amplitude set by measurement | test+rule | physics (+registry) |
| 60 | The crumple: phases are theorems | test+rule | registry(flight) |
| 61 | The toss: exit is a place, ✕ is a press | test+rule | registry(flight) |
| 62 | The bend follower: continuity belongs to the smoother | test+rule | physics |

Superseded-in-part markers (keep the archive note, don't port the dead
half): #9 amended by #36/#37 (pinned tiers carry mips), #21's authored
1280×720 superseded by #23, #52's whole-flight pin superseded by #53's
schedule, #60's fade + timer exit superseded by #61.

---

## mapping — coordinate custody

**Ports as tests.**
- `app/scenes/lab014Camera.test.ts` → conformance, near-verbatim: pure
  math, and it checks the fast `screenToPlane` against a real
  `THREE.Raycaster` to six decimals so the shortcut can't become a
  second source of truth (#44).
- `src/lib/uvAnchor.test.ts` → conformance: barycentric pick against
  static UVs, live-buffer sampling, deforming geometry (#6).
- The `use1DOF` static-handler + ray∩plane rules ride the physics-kit
  port of `physics1D` (#4).

**New tests to write** (never had their own carrier here):
- *The parking coincidence*: every parked source is `position: fixed`
  at page (0,0), therefore a point forwarded to any surface is already
  a page point (#16, #20, #22 all lean on it; it was only ever implied).
- *Density identity*: `dpr × planeScale(camZ, z)` as the exact texel
  demand for a plane at z under a #44-calibrated camera (#52/#53 use
  it; only the lab pinned it).

**Rules.**
- Ray ∩ drag-plane fixed at pointer-down, never `e.point`; handlers on
  a static object, moving parts gate drag-start only (#4).
- Conceptual DOF (arc angle, radius, list index) maps pointer *deltas*;
  ray ∩ plane is reserved for DOFs that literally are a world plane (#7).
- A calibrated camera makes screen and world *equal on exactly one
  plane*, not interchangeable — the moment anything leaves that plane,
  every "subtract half the viewport" must become a ray again (#44).
- GPU-side displacement is invisible to anchors and raycasts: CPU
  buffers are the truth (#6).

## paint — custody + paint

**Ports as tests.**
- `src/lib/lodTier.test.ts` → conformance: Schmitt trigger, `seedTier`
  (at dpr, #52), `tiersInRange` (#12), `maxTier`/`clampScale` (#35),
  ladder validity (#8/#9).
- `src/lib/htmlInCanvas.test.ts` → conformance: `setSize` must move the
  closed-over dimensions or the next tier swap silently reverts it
  (#22); the realloc-mark contract (#10).
- `src/lib/styleChannel.test.ts` → conformance: pull-getter channels,
  transition windows, discrete flips (#28).

**New tests to write.**
- Identity-CTM contract as a unit-level pin (the position-aware browser
  probe stays in the re-audit; the code-side "onpaint asserts identity,
  backing supplies scale" invariant deserves a test the way `setSize`
  has one) (#11).
- Filter-policy state machine: pinned ⇒ mips+trilinear, ladder-tracked
  ≥1 ⇒ plain linear, and **unpinning restores the dynamic policy even
  when the tier doesn't change** — the silent-no-op bug #37 caught
  (#9/#36/#37).
- Warn-and-clamp on guard-exceeding fixed resolutions (#35).

**CI gates (browser harness, from first commit).**
- Idle-zero: mounted, quiescent Surfaces = 0 paints/s (#3). This is the
  strongest single invariant the repo owns.
- The `GL_INVALID_VALUE … glCopySubTextureCHROMIUM` console tripwire =
  canvas/storage dimensions diverged again (#10).

**Rules.**
- `paint="auto"` is passive: the compositor's self-firing `onpaint` is
  the change signal. No repaint loops, no MutationObservers, no dirty
  flags in the paint path — measured worse in every variant (#3). The
  general form: when the system already emits the event you're
  inferring, delete the inference.
- Media never goes through `drawElementImage` — SurfaceLayer +
  `VideoTexture` quad (#5; platform list still holds media as
  untested-suspected).
- Every element handed to the rasterizer declares explicit pixel
  dimensions; measure content with `offsetWidth`, never
  `getBoundingClientRect` (#22, platform F).
- No `mask-image` anywhere in a drawn subtree; consumers' dialect
  stylesheets neutralize utility masks; a black-except-widgets Surface
  means grep for masks first (#30).
- `resolution` exposes bounds/intent, never the ladder; tier spacing
  and hysteresis stay private (#12). `'max'` resolves inside the
  library because measured Surfaces can't ask in time (#35).
- Custom materials: fragment ends with `#include <colorspace_fragment>`
  (texture is sRGB, sampler hands back linear — #33/#53); sampler
  uniform pre-declared; uniforms driven by conducted curves or refs,
  never by DOM animation (#33).
- Pinning is a documented trade: deterministic memory + zero re-rasters,
  softer than auto wherever partially minified (#37).

**THE DEBT — decide during this layer, not after it (fourth deferral is
not available):** premultiplied alpha library-wide. Currently app-side
on the glass ink only (#36); every transparent Surface has the halo
class in miniature; going premultiplied changes the material-slot
contract (#33: every custom material must blend One/OneMinusSrcAlpha).
Decide with labs 009/010 in the oracle as the regression net.

## door — the forge

**Ports as tests.**
- `src/primitives/forwardEvents.test.ts` (58 tests — the largest suite)
  → conformance wholesale: boundary protocol in spec order + mouse
  twins (#19), pointer-transparent regions (#20), z-order arbitration
  (#27), focus-modality mirror (#24), wheel protocol — claim, chain,
  containment, arbiter seat (#29), drag capture emulation (#32),
  foreign-drag silence (#51), provenance branding (#50).
- `src/lib/hoverGrace.test.ts` → conformance: hull math, previous-sample
  exit anchors, tracker lifetime (#31).

**New tests to write.**
- *The door duplication test* (named in the migration plan): `forge` is
  a singleton keyed by `Symbol.for`; the test simulates two module
  instances (the measured HMR condition, `toast()` incident 2026-08-01)
  and proves the brand survives — a module-local `Symbol()` must fail
  it (#50 addendum).
- Grep-level tripwire as a test: `dispatchEvent` appears in the kernel
  only inside `forge` and in tests (#50).

**Rules.**
- The canvas is how the pointer travelled, not what it hit: stop the
  native pointerdown (#18) and the trusted hover move after forwarding
  (`buttons === 0` only — drags from empty space must keep orbiting)
  (#26). One pointer, one story at document level.
- Never collapse the departure burst; leave events per element crossed,
  then moves outside the source rect across several frames — consumers
  arm on the leave and need the moves after it (#19).
- `pointer-events` is honored in the forwarded hit test AND the
  raycast; `hitTest="content"` makes empty layers inert by construction
  and subsumes liveness (#20).
- Hit resolution defers to `document.elementsFromPoint` (stacking
  contexts are a tree, not a sort key); the DOM-order walk survives
  only as the fallback for offscreen points and layoutless test
  environments (#27).
- Every synthetic event leaves through `forge()`; page-level pointer
  listeners guard `if (!e.isTrusted) return`; `isForgedEvent()` is the
  exported complement; the forged vocabulary is pointer/mouse +
  boundary + burst + wheel + change, **never keyboard** (#50, #24).
- Capture semantics both directions: our drag defers foreign boundary
  events until release (#32); a foreign held-button gesture gets
  silence from us (#51). Parked matter must never hold the real pointer
  (`guardPointerCapture`, #32).
- The wheel arbiter sits at document capture (the only seat ahead of
  OrbitControls' canvas listener); direct scroll mutation, not
  `scrollBy`; the return value is the camera's verdict (#29).
- Grace corridors live in screen space (the only space where "toward"
  is a statement); arm signals are synthetic, position feeds are
  trusted-only (#31).

**Open edge carried as debt (#51):** during *our* drag, moves route to
whatever surface the ray hits — dragging A's slider across B's face may
forward A's moves into B. Real capture would retarget to A. Unproven;
first thing to check on the next drag bug.

## transfer — the handoff

The custody-protocol core: flight is a custody excursion, idle is
compositor custody, and these are the swap rules.

**Ports as tests.**
- Conductor timing: `src/lib/motionSamples.test.ts` (fixtures are
  Chrome 151 computed-style samples) plus the two load-bearing
  subtleties as explicit conformance tests: `END_EPSILON_MS` (scrubbing
  to the exact end dispatches `animationend` early — Presence unmounts
  130ms early) and cancel-holds-last-pose (#17).
- Readiness: `onFirstUpload` one-shot latch, re-arming on source
  recreation; page-copy hide AND companion chrome (shadow) gate on the
  same signal (#54).
- The density schedule: page density at handoff frames, altitude
  density at cruise, hysteresis on plate z; `carryToPlane` finishes a
  tapped card's climb (#53). Carrier today: `lab014Camera.test.ts` +
  driver logic in the lab — the schedule itself deserves a pure test in
  the new repo.

**Rules.**
- DOM→mesh handoffs key on `onFirstUpload`, never a frame count —
  content first, then its chrome (#54).
- Nothing is moved: `visibility: hidden` on the page copy, second React
  root in the parked source. React event delegation is rooted at the
  root container; hidden keeps the box; no freeze-frame needed. A
  component that can render elsewhere carries its own tokens (#46).
- A vacated slot's empty styling touches PAINT properties only —
  outline/background/box-shadow, never border/padding/size (#54); and
  it keys on a signal that *leads* the swap (`data-away`, the altitude
  verdict), because the two moments a card exactly covers its slot are
  the two moments the page may not change (#57).
- A transitioned outline exists transparently from birth
  (`outline-color`'s initial value is currentColor — an active-only
  outline transitions from text color) (#57).
- Root motion is conducted, not rasterized: seize at `animationstart`,
  scrub with the style engine as the interpolation oracle, park the DOM
  at the visible pole, replay on the mesh, `finish()` on schedule (#17).
- At rest the presentation quantizes to the device-pixel grid — snap
  the GROUP, never the physics; sharpness = supply × phase × transfer,
  three budgets diagnosed separately (#53).
- The swap deadline is real: only free flight (`mode === 'home'`) races
  it, which is why the follower's release constant forks on `held`
  (#62 — the law itself lives in physics).

## chrome — measurement

**Ports as tests.**
- `src/lib/surfaceChrome.test.ts` → conformance: `parseBoxShadow`
  against verbatim Chrome computed strings (color-first, commas inside
  the function, paren-depth splitting), radius overlap clamp,
  `surfaceRadiusSd`, measure-on-paintCount, style-equality dropping
  (#55).
- `shadowQuadFrame` tests (in `app/scenes/lab014Plate.test.ts`) →
  conformance under the sentence that is their contract: **the mapping
  never lies** — geometry and uniforms from one computation (#56).

**Rules.**
- The texture can never say where the element ends: corner texels are
  opaque app background *by design* (the `.ui-root` contract). Chrome
  is measured from computed style — radius as an analytic SDF mask
  (raycast filters through the same SDF), shadow as parsed layers
  delivered as data (#55).
- Re-measurement rides the paint signal; idle Surfaces never measure
  (#55).
- Identity at h=0: every evolved shadow factor is exactly 1 at rest, so
  the liftoff frame draws the DOM's own shadow and swaps have nothing
  to pop (#55; the inverse — an invented look popping against the DOM —
  was the bug report).
- σ = blur/2 (spec); spread expands rect AND radius, clamped at
  half-size; inset layers are dropped (already in the texture) (#55).
- Any shader reconstructing "where am I relative to content" from UVs
  makes its geometry a load-bearing half of the equation: inflate along
  the axes you claim, ship vertices and uniforms from one computation
  (#56).

## physics — the kit

**Ports as tests.**
- `src/lib/physics1D.test.ts` → conformance: one symplectic integrator,
  composed force fields, bit-for-bit determinism trace (#2).
- `app/scenes/lab014Plate.test.ts` (38 tests) → conformance: `stepHeld`
  / `stepFree`, inertia, hand-relative damping (#49), servo-vs-lever
  (#45), `aeroAmplitude`+`aeroGate` flat-at-rest theorem (#59),
  `aeroFollowStep` (#62), `crumplePhase` invariants (#60),
  `wadOffscreen` (#61).
- `app/scenes/lab014Gestures.test.ts` → conformance: `isTrusted`
  filtering at the gesture (door's counterpart from the consumer side),
  crumple irreversibility, ✕-as-toss (#48/#50/#61).

**The perceptual-floor test class** — named peer of the theorems. These
assert *visibility and feel budgets*, not correctness, and they exist
because three separate shipped-but-invisible or correct-but-ugly
mechanisms proved theorems alone are not enough:
- Visibility floors: `aeroAmplitude(600) > 25`, `(1200) > 40`,
  `(300) < 12` — a live pipeline can still ship an invisible effect;
  "tuned by eye" is worthless unless the eye is on the real thing at
  real speeds (#59 addendum).
- Continuity budgets: bounded per-frame amplitude drop on
  browser-measured speed profiles (RAMP/HOLD/CRASH/…); no
  visible-to-exactly-zero frame pair, ever; free settle exactly 0
  within 150ms of gate close; held pause drains lazily (#62).
- Tracking-error flatness: median error flat across speed buckets
  (4.9/5.0/5.3/7.1 px at 4 speeds), under half a frame of hand travel —
  the signature that the physics contributes nothing (#49).
- Identity at rest: rendered aero amplitude exactly 0 on settle frames
  (#59); REST-SNAP footprint = texture texel count on integer device px
  (#53, lives in transfer).

**Rules.**
- Motion is decided by fields, not synthesized by tweens (#2).
- Ask every damper/spring/constraint *what the other end is attached
  to*; a world-anchored damper on a dragged body is a stationary hand,
  paid for in speed-proportional lag reported as anything but lag (#49).
- The physics timestep is fixed (1/240); the frame rate chooses
  substeps; gains are chosen for feel and nothing else (#49).
- Controller gains are accelerations (ω₀², 2ζω₀), never torques through
  the inertia tensor — a hand doesn't grip a big card more limply
  (#45). Orientation error is the full quaternion error with the w<0
  flip, never a normal cross product (blind to in-plane twist) (#45).
- Truth/presentation split: the plate is truth; bend, snap, and shade
  are presentation that annotates and never alters dynamics (#53, #59).
- Continuity belongs to the smoother alone — gates live inside the
  *target*; nothing instantaneous multiplies a rendered output (#62).
- Test corollary: springs at a grab point settle the grab point; an
  assertion on the center of mass fails by exactly the lever arm and it
  is not instability (#45).

## react — the thinnest binding

**Ports as tests.**
- `src/lib/layoutOracle.test.ts` (happy-dom, layout stubbed) → ports
  with the oracle wherever it lands (#25; core-vs-react assignment
  decided at Phase 3 — the measurement half is framework-free, the
  `<DomLayout>`/`<LayoutSlot>` half is binding).
- `tests/boundary.test.ts` → the new repo's boundary tests from first
  commit: barrel-only imports both directions, per workspace package.
  (Note: old CLAUDE.md says `src/boundary.test.ts`; the file lives at
  `tests/boundary.test.ts`.)
- #48's quick-tap race (listener keyed on committed state misses the
  release) deserves a DOM-suite conformance test with the binding.

**Rules.**
- An r3f `<Canvas>` overlay sets `position`, `inset`, `pointerEvents`
  inline (the wrapper's own inline styles outrank any class); toggle
  the canvas, not the wrapper; `frameloop="demand"` when empty (#47).
- `useRef` is the gesture's state; `useState` is only how the gesture
  asks React to render — anything that must be correct within the same
  event-loop turn reads the ref (#48).
- A floating layer is its own Surface on an overlay plane; the
  coordinate math is zero *because* both parked sources sit fixed at
  page (0,0) and Floating UI positions fixed — a coincidence promoted
  to a contract (mapping test above) (#16).
- `raycast` props are stable functions reading refs — r3f applies props
  onto the instance, and `undefined` does not restore the class
  default, it leaves the last function attached (#16).
- The viewer slab has no size of its own: quad from `frustumSize()`,
  source from the quad's aspect at canvas pixel height; read `size`,
  not `camera.aspect` (r3f writes aspect in a layout effect after the
  render that observed the size) (#23).
- Chrome parents to a scene-level group copying the camera pose —
  r3f's default camera is not in the scene graph, children of it never
  draw (#21). Hosts that own React roots are built inside `mount`, not
  hoisted (a remount's `createRoot` on an unmount-pending container
  throws inside CanvasImpl and takes the GL context) (#21).
- Modality is occlusion: Radix's `body { pointer-events: none }` lockout
  is a no-op behind the forwarder's geometric hit test, and nothing is
  lost — the overlay is matter and the obstruction is real. On a page
  the lockout *simulates* obstruction; here it exists natively (#21 —
  charter-grade reframe evidence).
- The DOM is the layout authority: a hidden rig (`visibility: hidden`
  parks layout without paint) measured by offset geometry, projected to
  poses; container queries are the responsive mechanism (the rig is a
  containing block, never a viewport); its observers answer *what
  exists* and *how big* — questions no paint signal reports — and never
  drive repaints (#25, carve-out from #3 stated with it).

## registry — copyable behaviors

Each entry ships as vendorable code carrying its tuned constants, its
perceptual-floor tests, and its citations. Not kernel; the kernel must
be sufficient for consumers to build these without patching it.

- **focus/spatial-nav pack** (#13, #14, #15): `cameraPose.test.ts`
  (pinned browser numbers incl. the 1.13 rad whip), `spatialNav.test.ts`
  (curated mechanisms), `spatialNav.field.test.ts` (33 browser-captured
  rects — the fidelity proof; any formula change must survive the
  full-field captures, not synthetic grids), `focusTree.test.ts` (49),
  `tabbables.test.ts`, `arcLayout.test.ts`. Also `docs/focus.md` (653
  lines) as the behavior's own contract doc with its `?focusprobe=1`
  empirical gate.
- **control kit** (#2, #4, #7): Dial/Toggle/Slider as composed force
  fields over the physics kit.
- **glass** (#38–#43): the SDF compositor — one scene render, N
  screen-space passes, far→near ping-pong; merged-gradient rule (the
  bezel normal is the gradient of the *unioned* field); ink clips to
  the rect, not the coverage; a bead is not a Surface; capillary ripple
  θ = K·r³/t² with 1/√r spreading (testable pure law); authored-once
  layout (one source of CSS px, converters at each edge, #42);
  **view-space z sort, never distance-to-eye** (#43 — testable, and the
  charter lesson: any sort validated on a centered scene is carrying
  this bug). #34 is history (MTM coordinator superseded by the
  compositor). Known dragons parked for Phase 5: coordinator ceiling
  (~N≤4 was the mesh-era bound; compositor scaling measured to 1600
  ballast knots but per-panel passes still scale linearly), many-surface
  focus, floating-layer halo (premultiply debt).
- **flight-card / drag pack** (#58–#61 + transfer/physics cross-refs):
  depth-tested shadow behind the card (blend order cannot express a
  clip; depth can — corner notches via discard writing no depth, #58);
  crumple phase law + coarse fold cells (6×3 + 35% remainder — per-vertex
  noise is confetti, #60); toss (exit is a place — `wadOffscreen` at
  own-plane projection; a released ball is ballistic immediately
  (`tossed` flag — the rise damper bleeds 9148 → 450 px/s); click is the
  degenerate toss, not a code path; `onClick` stays the keyboard path,
  #61); shadow follows its caster (`grab·0.87·crush` corner offsets,
  #61).

## charter — repo-level doctrine

- The product is the bridge/protocol, not a component kit; components
  are demos; scenes are disposable evidence (#1, restated for the new
  shape: kernel + binding + registry).
- The central reframe: **a custody protocol between two renderers that
  each believe they own the pixels.** Idle = compositor custody
  (upload-on-paint, #3); flight = custody excursion (#53/#54); the swap
  rules are the transfer protocol; modality-as-occlusion (#21) is what
  the protocol looks like when it's telling the truth.
- Browser evidence beats reasoning; theorems and perception are
  separate budgets, and each gets its own test class (#53, #59, #62).
- Second-system guard: no new generality (multi-flight, non-planar
  sheets) unless a lab bleeds on it twice; the conformance suite
  defines done.
- Probe/instrument doctrine lives in [instruments.md](instruments.md)
  (atomic evals, position-aware probes, gl.render-wrapped capture,
  instrument-the-probe, dpr-1 captures, grep-the-constant).

## Debts carried forward

1. **Premultiplied alpha** — decided during the paint layer, not
   deferred a fourth time (#36).
2. **#51 open edge** — our-drag cross-surface routing (capture would
   retarget; we don't).
3. **Phase 5 dragons** — glass coordinator ceiling, many-surface focus
   group, floating-layer halo.
4. **Name** — new repo/package name is Pete's call; blocks Phase 1
   repo creation only.
5. **platform.md claims** — none trusted until the Phase 2 re-audit
   ([platform-reaudit.md](platform-reaudit.md)).
