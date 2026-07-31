# three-ui

An experimental, futuristic UI component library made of **real materials, real physics, and real depth** — three.js/WebGL underneath, shadcn-like ergonomics on top (eventually).

This README is the **lab journal** — chronological, evidence-first. The
durable knowledge is distilled in `docs/`:

- [`docs/platform.md`](docs/platform.md) — what Chrome's HTML-in-canvas
  actually does (dated observations + the experiments behind them, and a
  re-verification checklist for new Chrome versions)
- [`docs/authoring.md`](docs/authoring.md) — the Surface dialect: what
  CSS belongs in a texture vs. on the mesh, and the paint budget
- [`docs/decisions.md`](docs/decisions.md) — architecture decisions with
  the measured alternatives we rejected
- [`CLAUDE.md`](CLAUDE.md) — hard rules for anyone (human or agent)
  coding here

## lab 001 — feasibility

```bash
npm install
npm run dev
```

To test the HTML-in-canvas path, run Chrome 148–150 with the flag enabled
(`chrome://flags/#canvas-draw-element`, or launch with
`--enable-features=CanvasDrawElement`). Without it the form panel falls back
to drei's `<Html transform>` (CSS3D overlay).

### Specimens

| Specimen | What it proves |
|---|---|
| `<PhysicalButton />` | Components as physical objects — a cap that actually travels, spring-tuned press/release, emissive state |
| `<GlassCard />` | Real materials — a transmissive glass slab refracting its own content plate |
| `<HtmlPanel />` | **Live DOM as a texture** via the HTML-in-canvas origin trial, with CSS3D fallback |
| `<ChipDispenser />` | UI governed by a physics engine (Rapier) — elements that fall, bounce, pile |

### HTML-in-canvas findings (Chrome 150, empirical)

The origin trial works, but the real contract is stricter than the blog post suggests:

1. **Element placement**: the source element must be a *child of the canvas you draw into*, and that canvas needs `canvas.layoutSubtree = true` (also settable as a `layoutsubtree` attribute) so the child participates in layout.
2. **Paint lifecycle**: `ctx.drawElementImage(el, x, y)` only succeeds inside the canvas's `onpaint` callback, scheduled with `canvas.requestPaint()`. Called anywhere else you get `"No cached paint record for element"`.
3. **Deferred rasterization**: the draw is recorded, not executed — pixels land at paint time. Readback (`getImageData`, `drawImage`, texture upload) sees them one frame later. For a render loop this just means one frame of latency.
4. **Visibility requirement**: the source canvas must be in-document **and on-screen** to receive paint records. `left: -10000px` parking silently produces a blank canvas. Parking it at `z-index: -1` behind the app works.
5. **No readback restriction** (same-origin): after paint, `getImageData` returns real pixels, so a plain `THREE.CanvasTexture` over a 2D canvas works — no need to touch `texElementImage2D` for the naive path.
6. **Full API surface** on `HTMLCanvasElement`: `layoutSubtree`, `onpaint`, `requestPaint()`, `captureElementImage()`, `getElementTransform()`; plus `CanvasRenderingContext2D.drawElementImage` and `WebGL2RenderingContext.texElementImage2D`.
7. **(lab 005 addendum)** `onpaint` also fires *without* `requestPaint`
   whenever the subtree's paint record changes — which makes a fully
   passive upload-on-paint pipeline possible, and compositor-animated
   properties (opacity/transform keyframes *and transitions*) never
   rasterize. Full contract + experiments now live in
   [`docs/platform.md`](docs/platform.md).

Verified live: a ticking clock inside the DOM subtree shows up in the 3D texture in real time.

## lab 002 — the primitive set

Thesis shift: three-ui is not a component kit, it's the bridge that makes DOM
available as *matter*. Three primitives, all verified working:

### `<Surface>` (`src/primitives/Surface.tsx`)
Live DOM as the skin of **any geometry**, with input forwarded back:
r3f raycast → intersection UV → element coordinates → synthetic pointer
events on the real subtree (`src/primitives/forwardEvents.ts`).

Verified on a concave cylinder ("helm console"): clicking a field through
the curved surface focuses the real `<input>`; **native keyboard then types
into it with zero key-forwarding code** (we only stop the canvas stealing
focus — see `KeepDomFocus` in `App.tsx`). `:focus` styles, CSS validation
states, checkboxes and selects all round-trip. The a11y tree stays intact —
automation sees a real textbox/combobox/checkbox on the cylinder.
(`:hover`/`:active` are NOT free — see the pointer-state mirror under
lab 003.)

Gotchas discovered:
- Native `<select>` dropdowns can't be opened by synthetic clicks — we cycle
  the value instead; a real library renders its own popover surface.
- Concave geometry: render `THREE.DoubleSide` (NOT `BackSide` — normals
  aren't flipped for BackSide, so lights can't hit the inner face) and set
  `mirrorU` to un-mirror the texture.
- Spotlight targets must be added to the scene graph or they aim at origin.

### `<MomentumCard>` (`src/primitives/MomentumCard.tsx`)
Motion as forces, not tweens: mass + spring joint + your gesture velocity.
Drag makes the body kinematic (velocity integrated from the pointer),
release hands the smoothed velocity to Rapier. No durations, no easing —
interruption mid-flight is just another grab.

### focus-as-light (`src/scenes/Lab002.tsx`)
Scene lighting bound to DOM state: `focusin`/`focusout` on the live subtree
drives a key spotlight (2 → 320 candela, damped); failed validation pulses a
red point light from inside the console. Attention is literal light, not a
token.

### Environment note
Chrome throttles rAF to 1fps for occluded windows (e.g. display asleep) —
looks exactly like a code hang. Launch test browsers with
`--disable-backgrounding-occluded-windows --disable-renderer-backgrounding`.

## lab 003 — feasibility edges

Four probes to decide where the library should focus. All four edges **held**.

### A. multi-Surface coexistence — HOLDS
The feared failure mode never happened: every parked source canvas
(stacked at the same `left:0;top:0;z-index:-1` spot, fully occluding each
other) keeps receiving paint records. Three live Surfaces painted in
lockstep at the display rate (verified via per-source paint counters —
`window.__threeUI.stats()` in devtools), zero errors, clean disposal.
DOM-over-DOM occlusion does not starve `drawElementImage`; only
off-screen parking does (lab 001 finding).

### B. popover as a second Surface — HOLDS (retires `nudgeSelect`)
A custom select trigger on one Surface spawns a listbox rendered as its
own Surface floating in front of the panel. Option click commits to a
hidden input on the first Surface, click-away dismisses, focus hand-off
works, native typing continues to work with several Surfaces mounted.
The whole floating-UI layer (menus, tooltips, dialogs) is therefore
buildable — in real 3D space, with real shadows.

Gotcha discovered: a Surface mounted *after* the scene's first frame
compiles its material before the texture exists, and three.js keys
program compilation on `material.version` — assigning `.map` later
leaves the shader mapless (blank white mesh). `Surface` now bumps
`material.needsUpdate` when the texture arrives.

### C. live DOM on deforming geometry — HOLDS (CPU displacement)
A flag-waving plane (per-frame CPU vertex displacement, pinned at the
pole) with working buttons and a text input on it. No forwarding changes
needed: the raycaster hits the displaced triangles and UVs ride the
vertices, so UV→DOM mapping stays exact mid-wave. Wind strength is set
by buttons ON the deforming surface; text was typed into the input while
it waved at gale.

Edges recorded, not crossed: GPU/shader displacement breaks forwarding
(the raycaster only sees CPU-side positions — would need a raycast
proxy); a fast-oscillating target can dodge a single click (press-time
UV locking is future work).

### D. physics-as-input knob — HOLDS
A 1-DOF rotary control: dragging couples your hand to θ while gesture
velocity is tracked; release hands that velocity to a detent torque
field `-K·sin(N·θ) - c·θ̇` (semi-implicit Euler, substepped). Flicks
ratchet through detents; settle is machine-exact (off-detent ~1e-16).
The settled index writes straight into a *different* Surface's DOM —
physics is the input method, the DOM is the state store.

### Direction decision
The bridge is robust; stop probing, start productizing. Priority order:

1. **Floating-layer system** — generalize the popover: UV→world
   anchoring on arbitrary geometry (lab 003 used plane math), a
   `<SurfaceLayer>` that any Surface can spawn. Every real component
   (select, menu, tooltip, dialog) needs this.
2. **Physical control kit** — generalize the knob's 1-DOF integrator +
   detent field into sliders, switches (over-center springs), dials.
3. **Focus/keyboard completeness** — tab order across Surfaces,
   arrow-key listbox nav, ESC dismissal.
4. **Scale & perf** — 12+ Surfaces, texture memory budget,
   `texElementImage2D` direct-to-texture upload.

Deformation is a materials/delight layer, not core. XR stays cheap
insurance: the same ray→UV→DOM pipeline works with controller rays.

### Post-lab polish (interaction contracts)

**Hover/active must be mirrored, not forwarded.** `:hover`/`:active` are
set by the browser's real hit-testing, which never reaches the parked
subtree (it sits behind the canvas with `pointer-events:none`) — and
synthetic events cannot flip pseudo-classes. `forwardEvents` now owns
them: it mirrors the chains onto `data-hover`/`data-active` attributes
(target + ancestors, like the real thing), dispatches
`pointerover`/`pointerout` on hover change, and `Surface` clears all
mirrored state when the ray leaves the mesh. Author CSS with both
selectors: `button:hover, button[data-hover] { … }`. Verified: option
rows highlight on hover, brighten + scale while held, and clear when the
cursor leaves the surface.

**Drags must compute from the ray, not the intersection.** r3f's pointer
capture keeps delivering events after the cursor leaves the mesh, but
`e.point` is frozen at capture time — angle math based on it stops dead
at the mesh boundary (the knob-drag bug). Compute from `e.ray` against a
drag plane instead (`setFromNormalAndCoplanarPoint` on the control's
face); the ray is live at any cursor position. Verified: a 135° arc at
~200px radius around a 58px dial tracked exactly (θ moved 3π/4 → 3
detents) with the cursor never over the mesh.

### Automation notes (hard-won, this lab)
- After editing `Surface` internals, hard-reload before judging visuals —
  r3f HMR can leave materials in a broken state that looks like a bug.
- `agent-browser`'s daemon relaunches Chrome *without* your `--args` if
  the window gets closed — origin-trial features silently vanish; check
  the HUD feature chips before trusting any result.
- When a human shares the browser with your automation, never click from
  a stale screenshot: project the target's world position through the
  camera at action time (`window.__r3f` scene → `getWorldPosition` →
  `project`) and aim there.

## lab 004 — the floating-layer system

First productization step (per the lab-003 direction decision): generalize
the popover into `<SurfaceLayer>`, a Surface anchored to a **point on
another Surface's skin** — any geometry, including deforming.

### `UVAnchor` (`src/lib/uvAnchor.ts`) — UV→surface inversion
The raycaster answers "hit → UV"; anchors need the inverse, "UV →
position + normal". Implementation insight that makes it cheap: the
*search* (which triangle contains (u,v), and the barycentric weights
inside it) depends only on the UV attribute, which stays static even
when vertices move. So an anchor resolves its triangle **once**, then
every `sample()` is three reads against the LIVE position/normal
buffers — O(1) per frame, and CPU deformation carries the anchor for
free. 12 vitest cases (`npm test`): plane closed-form, cylinder
shell/seam/antipodes, exact linear-displacement tracking, recomputed and
face-normal fallback normals.

### `<SurfaceLayer>` (`src/primitives/SurfaceLayer.tsx`)
```tsx
<Surface html={panel} …>
  <planeGeometry … />   {/* or a cylinder, or a waving flag */}
  {open && (
    <SurfaceLayer
      anchor="[data-trigger]"      // CSS selector into the parent's live DOM
      align={{ x: 0.5, y: 1 }}     // point on that element's rect
      lift={0.3}                   // float distance along the surface normal
      offset={[0, -popH / 2, 0]}   // nudge in the layer's oriented frame
      orient="normal"              // or "billboard" (face the camera)
      html={popover} …>
      <planeGeometry … />
    </SurfaceLayer>
  )}
</Surface>
```
`Surface` now provides a context (mesh + live DOM root + dims); the
layer resolves the selector to a rect, converts rect → UV, inverts UV
through the parent's geometry, and re-samples **every frame**. Layers
nest (a layer is a Surface, so it can host layers).

### Verified (Chrome 150, agent-browser, human-in-loop)
- **Flat parity**: the lab-003 picker rebuilt with zero anchor math in
  the scene. Popover spawned at panel-local error **0.00000**,
  orientation parallel to **0.00000 rad**; hover mirroring works through
  the layer; option click commits to the hidden input and disposes the
  layer's paint source; click-away dismisses (and the same click focused
  the field under it).
- **Curved skin**: the SAME `usePicker` hook on a cylinder drum. Popover
  mounted at radial distance **2.8200** (R 2.4 + lift 0.42, exact) with
  forward axis · outward radial = **1.0000** — it floats off the curve
  along the true local normal. Committed "thermal" through the tilted
  popover.
- **Deforming skin**: a tooltip anchored to a button on the waving flag
  rode the wave (0.18 units of world motion per 350ms at breeze,
  **0.35 at gale** — amplitude follows the wind) while tilting with the
  recomputed local normal. Clicking "gale" on the moving flag worked.

### Interaction contract added
`Surface` now calls `stopPropagation` on pointer **moves** as well:
the topmost Surface under the pointer owns it (DOM semantics). Required
for nesting — r3f bubbles a child layer's events to the parent mesh
with the *child's* UV attached, which the parent must not misread as
its own coordinates.

### Caveats (v0, recorded not solved)
- Rect→UV happens once at layer mount; a parent-subtree reflow after
  mount won't re-anchor (future: ResizeObserver/MutationObserver).
- Overlapping UV islands: first containing triangle wins.
- Parent meshes assumed unscaled; GPU displacement invisible (same
  contract as raycast forwarding).
- Clicking empty space doesn't dismiss popovers (needs scene-level
  `onPointerMissed`; panel-click-away works).

### Open questions (lab 005+)
- `texElementImage2D` + `THREE.ExternalTexture`: skip the 2D-canvas middleman.
- ~~Physical control kit~~ — done, lab 005.
- Press-time UV locking so moving surfaces can't dodge a click.
- Focus/keyboard completeness: tab order across Surfaces + layers,
  arrow-key listbox nav, ESC dismissal, `onPointerMissed` dismissal.
- Focus light that *aims* at the focused field — `UVAnchor` now makes
  this trivial (anchor the spotlight target to the focused element).
- ~~How many live Surfaces before paint cost bites~~ — answered by the
  scale probe below: idle Surfaces are free (upload-on-paint); ~64–96
  *simultaneously animating* sources at 120Hz.
- UV-space acceleration structure if anchor counts or mesh sizes grow
  (linear triangle scan is fine at lab scale).

## lab 005 — the physical control kit

Direction item 2. Thesis: every physical control is the **same 1-DOF
integrator under a different composed force field**. Proven — one
integrator, three feels, nine unit tests, browser-verified.

### `physics1D` (`src/lib/physics1D.ts`)

A `Body1D {q, v}` stepped by semi-implicit Euler (velocity first, then
position with the *new* velocity — symplectic, so oscillators don't
gain energy) at 2 substeps. A control's feel is a `Field(q, v) → accel`
composed from primitives:

| field | shape | used by |
|---|---|---|
| `detentField(n, k)` | `−k·sin(n·q)` — n wells around the circle | Dial |
| `overCenterField(k, span)` | double-well: stable ±span, unstable 0 | Toggle |
| `stopsField(stops, k)` | spring to *nearest* stop | Slider |
| `endStops(min, max, k)` | one-sided stiff springs at travel limits | Toggle, Slider |
| `damping(c)` | `−c·v` | all |

`flipImpulse(field, span)` bisects the minimum impulse that commits a
toggle across center — against the *actual integrator*, at mount — so
tap strength adapts to any tuning automatically.

Tests worth reading (`physics1D.test.ts`): settle-to-machine-epsilon
uses decay-envelope analysis (e^(−ζωt)) to size the window — 8s for
detent tuning, or 1e-9 assertions flake; the over-center threshold is
bisected to 30 iterations and both sides verified to settle on exact
opposite poles; flick traces are bit-for-bit deterministic.

### `use1DOF` (`src/primitives/controls/use1DOF.ts`)

The shared drag→physics bridge: pointer ray ∩ control plane (from the
handler object's world orientation at pointer-down), mapped to q by a
per-control `localToQ`, velocity estimated by lerp-smoothed finite
difference, handed to the field on release. Settle = |v| < 1e-3 for 15
frames. Two contracts learned the hard way:

- **Handlers must live on a static object.** Measuring the hand in the
  moving cap's own frame is a feedback loop (the cap tracks at half
  speed). `<Slider>` binds on the track and gates drag-*start* to the
  cap (`startOnCapOnly`).
- Use `e.ray`, never `e.point` — the intersection point is on the
  moved geometry; the ray is the ground truth.

### Controls

- `<Dial>` — detents + damping; flicks ratchet through wells with real
  momentum; `onDetent` fires live mid-ratchet.
- `<Toggle>` — over-center + end stops; a tap applies `flipImpulse` and
  *the physics decides* whether it commits or falls home; `onFlip`
  reports settled state only.
- `<Slider>` — stops + end stops; throws ride momentum into a stop;
  `onChange` live, `onStop(index, value)` on settle.

### Verified (Chrome 150, agent-browser)

Lab 005 wall: dial + 3 toggles + slider writing into a reactor-console
Surface. Dial dragged 4→7 (quarter arc + release momentum ratcheted 3
wells); toggle taps flipped both directions with lamps following
settled state only; slider drag settled exactly 0.75; a −70px throw
from 0.75 carried momentum past 0.5 and settled exactly 0.25. DOM
readout matched `window.__lab005` hooks at every step.

## scale probe — the ceiling, found and then moved

`?probe=N&live=1&anim=K&w=&h=` mounts N card Surfaces with a
`window.__probe.run()` harness (rAF frame-time percentiles +
per-source paint rates). M-series MacBook, 120Hz, dpr 2, Chrome 150.

**The ceiling is per-source fixed cost, not pixels.** With the original
always-repaint pipeline: N=64 locked at 120fps at *both* 320×200 and
640×400 (4× the texels — no difference); N=96 → 95.6fps; N=128 →
72.9fps. Occluded parked canvases never starve (per-source paint rates
stay uniform); the frame just stretches.

**Static cost the same as animating** (73fps at 128 idle Surfaces) —
because `Surface` repainted + re-uploaded unconditionally. That led to
three raw-canvas experiments that rewrote the paint contract:

1. **The compositor fires `onpaint` by itself** whenever the subtree's
   paint record changes: DOM mutations, transitions (any duration),
   paint-property CSS animations (measured 119 self-paints/s),
   caret blink. `requestPaint()` is only needed for the first paint.
2. **The deferred draw resolves by its own paint pass** — mutate
   red→blue with zero `requestPaint` and the 2D buffer holds blue
   after exactly one self-paint.
3. **Compositor-side properties are invisible.** Animated opacity
   rasterizes at alpha 255 through a full keyframe cycle even when
   repainting every frame — a `drawElementImage` platform limit, not a
   policy choice. Animate paint properties (color/background/
   box-shadow) instead; mesh transforms already cover motion.

So `<Surface paint="auto">` (default) is now **fully passive**: upload
iff `paintCount` advanced (+1 trailing frame), zero requested paints,
no observers. `paint="always"` remains for content that changes
without paint records (embedded media). A MutationObserver draft cost
~17% at 128 all-animating sources; the passive design *beats the
original* there instead (requested paints used to stack on top of
content self-paints — two paints per source per frame).

| config (320×200) | always-repaint | passive |
|---|---|---|
| N=128 static | 73.2 fps | **120.0 fps, 0 paints/s** |
| N=128, 32 animating | — | **120.0 fps** |
| N=96 all animating | 95.6 | **100.6** |
| N=128 all animating | 72.9 | **76.9** |

Real-scene shape: a lab-005 toggle flip is **2 paints total** (mount +
the coalesced flip mutations), then quiescent. The practical answer to
"how many Surfaces?": *idle ones are free; budget ~64–96 simultaneously
animating ones at 120Hz.*

## lab 006 — the spatial workspace (falsified, usefully)

Concept under test: **attention is a place** — ~33 real DOM panels
(live feeds, editable notes, working forms) on a 210° arc around the
viewer; periphery stays ambient via paint pulses, approach makes panels
fully real, drag repositions them. One day on the existing kit:
`arcLayout` (pure, 5 tests) + `Lab006.tsx` + a content module authored
in the dialect. The *plumbing* held completely; the *framing* did not.

### What held (Chrome 150, agent-browser, flags chip-checked)

- 33 Surfaces at **0 paints/s idle, 120fps**; each feed pulse is one
  background transition (~120 paints/s for <1s), then silence — the
  corner HUD narrates the upload-on-paint contract live.
- Canvas click → UV → focus landed in a `contenteditable`; 12 native
  keypresses put "typing is real" in the DOM (16 paints, caret blinks
  included). Hover mirrored onto a 3D-angled button; the deploy form
  ran its full arc ("deploying v1.4.2 → staging…" → "live ✓").
- Grab-and-pull: a panel dragged off the arc, radius 7.0 → 3.9.

### What falsified the framing

1. **On a monitor, "periphery" is not peripheral vision.** All 33
   panels land in the same foveal rectangle; oblique ones are just
   smaller, hazier text, and panels past the viewport edge are worse
   than a tab (no badge). The paradigm's sensory claim only transfers
   to displays that wrap you. XR concept, demoed prematurely on a desk.
2. **The navigation tax loses to cmd-tab.** Double-click + 0.9s dolly
   round-trips slower than a 200ms window switch. Space-as-container
   adds travel cost to content 2D serves instantly — the same reason
   Data Mountain and Task Gallery never shipped.
3. **Same-origin quietly guts "your tools in one room."** Sources must
   be same-origin children of the canvas: no Gmail, no Linear. Panels
   can only be *this app's own DOM* — a real product would have to be
   the whole workspace, not aggregate existing ones.
4. **The API wasn't load-bearing.** Occlusion incidental, lighting
   decorative, physics unused: as built, CSS perspective transforms
   could fake ~90% of it. Fails the demo bar's first criterion.

Drag yielded a real contract refinement — ray ∩ horizontal-plane drags
die for handles above eye level; conceptual DOFs want pointer-delta
mapping instead ([decisions.md #7](docs/decisions.md)).

### Verdict

**Container vs referent.** This scene made 3D a *container* for flat
work. Every commercially real use of the bridge makes 3D the
*referent* — configurator, twin, CAD, game world — with DOM attached
to the thing that is already legitimately 3D. There, occlusion,
curvature, and anchoring all earn their keep and same-origin doesn't
bite. Next lab points there; the workspace framing goes in the drawer
marked "reopen in a headset." The scene stays in-tree as the best
scale/focus/typing harness we have.

## lab 006 addendum — dynamic LOD: the DOM as a procedural texture

Pete called out that every DOM render to date has been low-res and
hard to read. Root cause was two missing pieces: the source canvas was
sized in CSS pixels (devicePixelRatio never consulted), and nothing
answered *magnification* — mipmaps + anisotropy only help far away;
walk up to a 420-texel panel filling 1200 screen px and you get
bilinear soup. The fix fell out of the platform mental model: paint
records are vector draw commands, so replaying one under a scaled CTM
is a **true re-render** — crisper glyphs, like a PDF, not an upscaled
screenshot. We are generating the mip level the GPU wishes it had,
on demand, from the live source.

What shipped (`resolution="auto"`, the new Surface default):

- **A tier ladder, not a dial.** Projected density (device px per CSS
  px, from camera distance / fov / drawing-buffer height / bounding
  sphere) picks from quantized tiers 0.5–3×. Selection is a Schmitt
  trigger (±15% hysteresis band) plus a two-evaluation debounce,
  evaluated every 10th frame, phase-offset per Surface — a camera
  parked on a boundary cannot thrash. Pure + unit-tested
  (`src/lib/lodTier.ts`).
- **Re-raster rides the normal paint path.** `setScale` resizes the
  backing store (CSS size pinned — the subtree never relayouts) and
  requests one paint; upload-on-paint consumes it like any content
  change. No new observers, no new loops.

Verified in the lab-006 arc (33 panels, headed Chrome 150):

- doc-0 lifetime across mount → approach → 1.15-unit close-up:
  **3 paints total** (one per committed tier), text sharp at 3×.
- Full orbit sweep: 41 tier changes, **≤2 per source, zero
  oscillators**, 120fps held. At rest: 9 far panels downshifted to
  0.5× (memory returned), all else quiet.
- A contenteditable held **focus, caret, and content through
  1.5→0.5→1.5 swaps mid-edit** — typing lands while the panel
  renders at any tier.

Platform contract grew claims #8–11 (CTM-scaled replay is vector;
pinned-CSS resize never touches the subtree; resize needs an explicit
requestPaint; one paint per rescale) and decision #8 records the
rejected alternatives (fixed retina everywhere, continuous matching,
CSS zoom).

### Follow-up, same day: "still very fuzzy up close"

Pete falsified "sharp." The re-raster was never the problem — an
edge-width probe put the CTM-scaled draw at 1.0px mean edge, pixel-
equal to natively-3x-authored content (bitmap upscale: 2.0px) — and
the full-res textures were bound. `magFilter=Nearest` showed crisp
single-texel stairs on screen: the resolution was being thrown away
by the *filter*. Three's default trilinear mipmapping blends in the
box-filtered half-res mip the moment the footprint tips past 1:1 —
exactly at reading range. The classic reason game engines ship UI
atlases mip-free, rediscovered the measured way.

Fix (decision #9): reading tiers use plain linear filtering — the
tier ladder already is the mip chain, CPU-side and vector-sourced —
while far tiers (<=0.5) keep mips + anisotropy for oblique-panel
shimmer. Ladder extended to 0.25-6x for retina demand (approach ~4,
grab-pull ~7). Verified: approach view crisp at 1:1; tier 6 commits
in one paint with the ladder jumping 1.5->6 directly; extreme 0.7-
unit close-ups saturate softly at the near edge by design. Probe
lesson: verify camera arrival in the same eval as the screenshot — a
damped OrbitControls ease faked one data point.

### Follow-up, same night: the tier-swap ghost

One more falsification: tier swaps were leaving a shrunken ghost of
the panel composited in one corner over stale content, panels behaved
unevenly, and zooming popped erratically. The handoff suspected exotic
platform timing — deferred paint records resolving into resized
canvases. Wrong neighborhood entirely: **Chrome was doing everything
right. three.js was the culprit.**

three allocates non-video `CanvasTexture` storage *immutably*
(`texStorage2D`) at first-upload dimensions, then `texSubImage2D`s the
canvas's current size forever after. `setScale` resizes the backing
store — so a downshift sub-blitted the whole re-raster into a corner
of the stale storage (the ghost), and an upshift threw
`GL_INVALID_VALUE` (offset overflows texture dimensions) on every
frame, silently keeping the old texels — the real source of "fuzzy
despite upshifting." Per-panel unevenness was nothing but per-panel
swap history.

Fix (decision #10): `Surface` marks `paintCount` when a `setScale`
commits, and `dispose()`s the texture on the first frame the counter
moves strictly *past* the mark — i.e. the post-resize paint itself has
landed. three reallocates at the new dimensions with a full upload;
the mip policy rides the same moment because level count bakes in at
allocation. Never from the commit frame — the just-resized backing
store is a cleared, unpainted buffer that would flash blank.

Verified with GL-call instrumentation (every `createTexture` /
`texStorage2D` / `texSubImage2D` tagged): **33/33 panels report
canvas dims == storage dims** at rest and through an approach/home
storm that forced **71 reallocs in both directions** — console clean
of GL errors (pre-fix: every upshift errored), no ghosts, idle back
to 0 paints/s with only the authored periphery pulses bursting,
120fps held. Caveat for morning eyes: automation Chrome runs dpr 1;
the mechanism is proven at the GL level, but the retina judgement
call on residual pop is Pete's.

Probe lesson, paid for twice now: sample every fact of a claim in one
atomic eval. A magenta-dye screenshot compared against GL logs from
minutes earlier manufactured a phantom contradiction — camera easing
and re-renders drift the scene between captures. The probe that
settled it read the source canvas (`getImageData`) and the bound GL
texture (scratch-FBO `readPixels`) in a single step.

### Follow-up, next morning: the dye was right

Pete woke to the inverse artifact: zoom in and panels showed a
magnified top-left crop — "the larger textures exceed the size of the
surface." Reproduced at dpr 1 by forcing retina density
(`setPixelRatio(2)` → tiers 3+ commit), then measured with the probe
this saga finally taught us to write: **position-marker dots** at known
CSS coordinates, read back from the canvas by centroid and size.

Verdict: `drawElementImage` scales the replay by the canvas's
**backing/CSS ratio** all by itself, and the CTM multiplies on top.
Our onpaint did both — resize to k× *and* CTM k× — so every tier
rendered at **k²**: tier 3 drew at 9× (a third of the doc visible),
tier 0.5 at 0.25× (far panels quietly showing quarter-size content in
a corner — the "murky far panel" look we'd been accepting as normal).
Yesterday's realloc fix (#10) didn't cause it; it **unmasked** it —
before #10, every high-tier upload died at the GL layer, so faces kept
stale-but-complete 1× content instead of the mis-scaled raster.

The fix deletes a line: onpaint draws under an identity transform; the
backing resize *is* the scale (decision #11). Dot-verified through the
real pipeline (tier 3 → exactly 3×, tier 1 → exactly 1×), storm-tested
with zero GL errors, and the rest state is full-bleed legible on every
panel for the first time since the LOD stack shipped.

Two reckonings for the record. Platform claim 8 — "the CTM scales the
replay, verified 0.5/1.5/3" — stood for a day on evidence that could
not falsify it: crispness screenshots and edge-width probes are
scale-blind (vectors are crisp at *every* wrong scale), and alpha
coverage can't tell a full doc from a magnified crop. And last night's
magenta-dye quadrant, written off as a confounded probe, was a correct
measurement of this exact bug at tier 0.5. The probe wasn't flawed;
the model it contradicted was. Claim 8 is rewritten, the checklist
gains a position-aware step, and the standing rule is now: probes that
claim *where* content lands must mark positions, not vibes.

### Follow-up, same day: the dev API — `resolution` learns the dpr shape

With the stack stable, LOD got its public face (decision #12). One
prop, three forms, borrowed from the `dpr` vocabulary every r3f user
already knows: `resolution="auto"` (default, full 0.25–6× ladder),
`resolution={2}` (pinned), and new — `resolution={[min, max]}`, dynamic
LOD constrained to a slice: `[1, 6]` never lets a hero panel go
sub-legible, `[0.25, 2]` caps memory in panel-heavy scenes,
`[1, Infinity]` is a floor with no ceiling. The deliberate omission is
the ladder itself: tier spacing is coupled to the hysteresis band, so a
user-authored ladder is a thrash generator waiting to present as our
bug — bounds expose the intent while any contiguous slice stays
thrash-free by construction. `tiersInRange` is pure and tested
(46/46); mount now seeds at the in-range tier nearest 1×, which as a
side effect stops oversize Surfaces from transiently allocating a
>4096px canvas on their first raster.

## lab 007 — focus: routing the browser's focus model through 3D space (in progress)

The last open item from the post-lab-003 roadmap: keyboard
completeness. Kicked off with a four-source prior-art deep-read
(react-three-a11y source, Flutter's focus_traversal.dart, the CSS
spatial-navigation spec + TAG review, ARIA APG + tabbable) — findings
distilled into `docs/focus.md`, the design contract. The headline
reversal: flow-through Tab died in review. APG's composite convention
(one tab stop per unit, Enter/F2 descends, Escape ascends) replaces
it — eight screens must be eight Tab stops, not forty-eight. Two
mechanisms adopted wholesale from Flutter: focus memory as a lazily
validated stack per group, and the directional-history stack that
makes arrow navigation reciprocal — load-bearing here, because focus
moves our camera, so the geometry that chose a target is gone by the
next keypress. Distance scoring adapts css-spatial-nav's structure
with its known defects corrected (symmetric weights; overlap handled
as a separate regime ranked by depth, never fed to the formula).

Then the platform got a vote: `?focusprobe=1` (ProbeFocus.tsx) ran
seven probes through real CDP keys on Chrome 150. All seven passed —
real Tab walks into parked source subtrees in document order; focus
rings self-paint into the record; a capture-phase keydown can eat Tab
at a boundary and re-route with preventScroll cleanly; :focus-visible
survives programmatic routing inside a key handler; opacity:0 ARIA
proxies are fully tabbable and receive arrows; aria mutations on
proxies are paint-isolated from every source; and fixed positioning
means focus can never scroll-jump the page. Every load-bearing
assumption of the design is now measured, not argued. Next: the focus
tree + boundary interception, then spatial ordering.

**Increment 1 shipped — the Tab/Enter/Escape spine.** Pure core first:
`focusTree.ts` (group registry, focus-memory stacks, Flutter's band
reading-order — where writing the tests caught my own mental model
being wrong: the reference algorithm removes ONE rect per pick and
re-derives the band from the new topmost, it never emits whole bands;
the suite now pins the traced semantics) and `tabbables.ts` (the
tabbable-library subset that can occur in Surface markup; radio
collapse, `:disabled` propagation, `getClientRects` visibility — the
sort and radio rules unit-tested pure). On top: `<FocusScene>` routes
Tab/Enter/F2/Escape at the document level with zero shadow state —
every decision starts from `document.activeElement` — and
`<FocusGroup>` + Surface auto-registration (via `FocusGroupContext`)
make a lab-006 panel a focus group with one line. The unit element is
the Surface source root itself at `tabindex="-1"`: selecting a panel
IS document focus, and a `[data-focus]` stamp lets the shared
stylesheet paint selection into the texture (border/box-shadow — paint
properties, so it just repaints like any content change).

Browser-verified with real CDP keys on the live arc: canvas is the
page's entry stop; Tab walks units in camera-derived reading order;
Enter descends into the deploy form (and approaches — the camera ride
is keyed to `cause: 'descend'`, the commitment gesture, so Tab surveys
without travel and mouse grammar is untouched); typing lands natively;
Tab exits at the last-element identity to the next unit; Shift+Tab
from the first interior element ascends to its own unit; re-Enter
restores the remembered element; Escape clears that memory
(Flutter's rule), then unit → scene → camera home down the ladder.
One design find during verification: most panels (29 of 33) have no
focusables at all, so "descend" now fires its intent regardless —
you zoom into a read-only dashboard to read it. Idle contract held
throughout: 33 surfaces at ~2 paints/s with the focus system live.
Not in yet, deliberately: arrows/spatial nav, ARIA proxies for the
physical controls, the announcer — and the scene ring closes into a
loop rather than handing off to the page (that needs the proxy layer
to own the page-side stops first).

**Increment 2 shipped — the mixed group: a knob in the panel's Tab
order.** The unproven half of the design was the leaf member — a WebGL
control with no DOM of its own joining a Surface's traversal. Lab 006
now proves it synth-style: `filter — voice a` is one FocusGroup holding
the panel (three wave buttons, live DOM) and a physical `<Dial>`
floating beside the glass. Tab descends into the panel, walks saw →
square → sine natively, and the next press crosses the member boundary
onto the knob — an opacity-0 ARIA slider proxy at its projected rect
carrying real document focus while the cylinder answers with emissive
glow. Arrows are impulses, not setState: `hopImpulse` bisects the
actual integrator (flipImpulse's idiom) so one press from rest hops
exactly one detent at any tuning, key repeat compounds into momentum,
and the cutoff readout in the DOM panel ticks with every detent the
physics crosses. Home/End snap to the extreme well and let the field
seat it. The proxy layer is ONE imperative div beside the canvas — no
React anywhere near it, which retires react-three-a11y's
root-per-proxy crash class by construction — and rects re-project at
focus transitions, camera tween-settle, and drag-end, never per frame.

Two lessons were paid for in browser time. Registration order: React
child effects run bottom-up, so the dial registered before its own
FocusGroup existed and the tree silently dropped it — proxy present in
the layer, absent from the traversal, Tab sailing past the knob to the
next unit. `registerMember` now creates group records implicitly, and
unordered members sort composites-first (a Surface's composite
registers LATE — its source element is async), so mount timing can't
reorder a designed device; `order` stays as the authored escape hatch.
Announce timing: waiting for physical settle reads ~2.7s late, because
the arrow kick's ringdown must decay below the strict rest threshold
first — `aria-valuenow` now lands at each detent crossing (paint-free,
probe 6), with the settle write authoritative.

Verified end-to-end with real CDP keys: ring → Enter → native interior
walk → boundary move onto the proxy → arrows/Home/End through the
physics → Shift+Tab back into the panel at its last tabbable → memory
restore onto the knob → Escape ladder, idle contract intact (33
surfaces · 0 paints/s between feed ticks). Carried debt: the leaf-only
proxy-as-unit fallback is implemented but unexercised; the ring is
still a closed loop; ring sampling isn't gated on tween-settle yet —
and the run-1 Tab anomaly never recurred across ~40 real presses.

**Increment 3 shipped — the first user test rewrote the defaults.**
Pete drove the increment-2 build and filed four complaints: the first
Tab focused something off-screen; the ring order read as scrambled;
once past the dial there was no obvious way back; and a zoomed-into
panel didn't hold Tab. The design dialogue that followed ratified a
rework, and every point traced to either a designed-but-unshipped rule
or a real hole in the contract. Shipped: an **entry policy** (with no
live cursor, Tab/Enter selects the nearest fully-visible unit to the
viewport center — `entryPick`, `initialFocus` overrides; the home
pose's view ray turns out to meet the arc exactly at the bottom row,
and entry picks that row's center panel); **authored ring order**
(`FocusGroup order` → `sceneRing` — the roster grid IS the intent,
Flutter's band algorithm demoted to a fallback for unordered groups,
and ordered groups never project during a walk, which retires the
mid-tween-sampling worry for the authored case); the **reframe
bridge** (the ported scrollIntoView obligation: `preventScroll:true`
suppressed the page's fulfillment of focus's implicit
bring-into-view contract, so the camera inherits it — the library
detects violations and emits `ReframeRequest`s, the app's rig
fulfills via `useFocusReframe`, a clamped built-in fulfiller covers
rigless scenes, and XR is why the inversion is load-bearing: a
fulfiller may refuse to move your head); and the **altitude rule**
(Tab traverses peers at your current altitude — scene level walks
units; a DESCENDED group is modal, Tab cycling its mixed DOM+WebGL
members with wrap — saw → square → sine → Cutoff → saw — and one
Escape is the release: un-latch, land on the unit, `cause:'release'`,
camera home). Click-in interior focus without Enter never traps — APG
exit-at-edge holds, because the trap binds to *camera commitment*,
not interior focus. The latch itself is a gesture-stamped
`data-engaged` on the unit root — the one deliberate exception to
zero-shadow-state, honest because a gesture can't be derived from
`activeElement`, and it doubles as the CSS hook for the new
survey-vs-engaged chrome (dim 2px inset vs unmistakable 3px cyan
ring).

Three lessons were paid for in browser time. **The pixel-space
reframe ran away**: a panel far around the arc straddles the camera
plane, its projected AABB explodes to ~100k px, and a faithful
world-per-pixel truck flew the camera to x≈−1058 — and even a correct
truck can't frame a panel *beside* you. The rig's fulfiller became a
head-turn: rotate the view direction just to the comfort-cone edge —
exact at any angle, minimal, bounded by π. **The settle pop**: handing
the pose back to OrbitControls tripped its polar clamp, which
re-satisfies limits by MOVING the position (y 2→3.05 on a steep
up-turn) — the fulfiller now pre-clamps view elevation to the app's
own limits so the handoff is a no-op. **The inc-2 focus chrome was
dead CSS**: the stamped unit element IS the `.p6` root, so the
descendant selector `[data-focus] .p6` never matched — every visible
"focus" this whole time was the grab-handle mesh. Self selectors
(`.p6[data-focus]`) now, verified by computed style and screenshot.

Verified end-to-end with real CDP keys: entry lands on `pr`; the
33-panel ring follows the roster top row → middle → bottom, each
left-to-right; a six-step survey walk (including the wrap to the
far-top-left panel) kept every focused panel on-screen with the camera
position pinned at home — pure head-turns; 18 more Tabs to the synth,
Enter → engaged + approach ride, the trap cycle + backward wrap,
Escape → release with the exact home pose restored; programmatic
click-in then exits at the edge to the next unit (no trap); idle
contract intact (33 surfaces · 0 paints/s · 120 fps). 106/106 vitest,
tsc clean. Deferred: arrows (increment 4), the announcer, page-edge
handoff; tween-settle gating for the geometric fallback stays a watch
item; flow-through Tab stays a possible future opt-in policy.
