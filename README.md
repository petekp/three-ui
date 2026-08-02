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

To test the HTML-in-canvas path, run Chrome 148–151 with the flag enabled
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

### focus-as-light (`app/scenes/Lab002.tsx`)
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

**Polish pass — the second user test's five noticings.** Every one
reproduced, fixed, and re-verified with real CDP input; two turned out
to be the same structural disease, and the verification tracer caught a
sixth bug none of us had seen. (1) *Escape stranded edge panels*:
release now rides the position home while the view HOLDS the released
panel — `home(lookToward)` aims along the elevation-clamped panel
direction, and the released corner panel lands at NDC (0.000, 0.000)
where bare `home()` used to lose it off-screen entirely. (2) *Fast Tab
janked*: by construction — the rig only wrote `controls.target` at
settle, so a tween armed mid-flight read the STALE pre-ride aim as its
start and snapped the view backward one whole step. The fix publishes
the live aim into `controls.target` every tween frame (controls are
disabled during rides — nothing fights); a 5-Tab burst now traces
0.018 rad/frame max, no snap frames. (3) *Instant mode*: rig
`setMotion('animated'|'instant'|'auto')`, auto following
`prefers-reduced-motion` — verified through real emulated media (one
0.38 rad frame, nothing else), and the library's default fulfiller
jump-cuts under reduced motion too. (4) *Click should select*: shipped
as library grammar — a document-level capture listener sees the
forwarded click bubble and, one microtask later (after `forwardPointer`
's focus fixup, whose no-focusable branch BLURS and would undo an
eager focus), selects the unit iff the click left the group bare.
Verified: clicking a doc panel selects it with the camera provably
frozen (Δ = 0.000000 — 'pointer' never reframes); clicking a button
keeps the button; clicking dead space in the synth selects it where
before focus dropped to nothing; Tab afterward continues the ring FROM
the clicked panel. (5) *The approach settle pop*: same disease as the
head-turn pop fixed in increment 3, one layer up — the approach pose
itself was illegal. Panels face the eye-level look target, so top-row
approach poses put the camera BELOW the panel: phi 1.88 rad against
OrbitControls' 1.532 limit (middle row violates too — 1.667; nearly
every approach popped at settle). `clampOrbitPose` pre-clamps every
armed pose about its sacred target, so the settle `update()` is a
fixed point: browser trace shows zero tail movement, phi landing at
exactly 87.8°.

The discovery: riding corner-to-corner (release-aim poses made these
reachable), the tracer measured a 1.13 rad single-frame whip. Lerping
the target POINT sweeps it close past the camera's path, and lookAt of
a near-zero difference vector spins. First fix — slerp the view
direction on the great circle — measured 0.31 rad/frame: these aims
are near-antiparallel and near-horizontal, so their great circle arcs
over the ZENITH, where lookAt's up-vector degenerates (and the ride
looks at the ceiling). The stable parametrization is YAW/PITCH
decomposition — turn about vertical along the short arc, morph
elevation linearly: elevation never leaves the endpoints' band, the
pole is unreachable, and it is literally how a body turns in place.
Final trace: 0.052 rad/frame — the smoothstep mathematical bound for a
168° turn. All three schemes (lerp whip, great-circle zenith spin,
yaw/pitch bound) plus the settle-pop reconciliation are pinned as pure
`cameraPose.ts` vitest (14 tests; the suite simulates OrbitControls'
clamp verbatim), so the next "simplification" fails CI instead of a
user test. 119/119 vitest, tsc clean, idle contract intact (only the
four live-feed panels paint; docs and chrome at zero; 120 fps).
Decision #13 records the ride rules; `docs/focus.md` gains the pointer-
selection and motion contracts.

**Increment 4 shipped — arrows, and the projection that lied twice.**
Directional navigation at scene/unit level: `spatialNav.ts` is pure and
camera-blind (it sees screen-space AABBs sampled fresh per keypress,
never the camera), built on spatnav §8.4's regime split — overlapping
"insiders" never reach the distance formula and outrank every outsider
— plus Flutter's directional-history stack, which here is load-bearing
rather than polish: focus moves the camera, so the geometry that chose
the last target is GONE by the next keypress, and a pure geometric
argmax cannot be reciprocal even in principle. Pop on opposite, clear
on perpendicular, and one chokepoint clears on everything external
(`notify()` whenever `cause !== 'directional'`). The no-candidate
ladder mirrors the reframe bridge — detect here, fulfill there: a
`NavPolicy` answers `canMove(dir)` from `viewPitchRoom` (pitch room to
the polar-band edges, yaw unbounded) and fulfills as a head-turn nudge
that never moves focus and never records history.

Browser verification with real CDP keys bought three findings, each a
formula defect the vitest grids were too polite to produce. First the
sliver hijack: ArrowRight from doc-4 picked deploy, a full row UP, on
~3px of edge progress — grab handles extend every rect, row-neighbors
overlap by slivers, and minimal-progress-wins crowned the sliver THE
insider. The centroid cone (decision #14) gates the regime: overlap
alone is not insider status. Then the walk zig-zagged rows, twice, by
two different mechanisms. Rightward along the middle row, deploy →
doc-5 (a row down): the arc's rows shear apart toward the projection's
edges until doc-5's top rose to 4px below deploy's bottom, the
band-separation orthogonality term read 0 through the sliver, and a
9px-nearer left edge beat synth, the LEVEL neighbor, 20.5 to 24.9.
Fixed — orthogonality became the candidate centroid's distance outside
the origin's cross-band — and the walk promptly dropped a row one
column later: synth → calendar, because at the arc's edge projected
AABBs bloat until every neighbor overlaps the origin and the insider
regime swallowed the whole neighborhood — three cone-passing insiders,
one per row (calendar below, progress 278.5; doc-19 above, 291.8;
errors level, 297.9), ranked by a stack rule that hands the pick to
whichever row leans nearest on screen. One vocabulary fixed both
(decision #15): `centroidOd` in both regimes — outsiders pay it in the
distance, insiders rank by `progress + od·Wo`, and true stacks pay
nothing by construction since a contained candidate's centroid cannot
leave the band. The method matters as much as the fix: each defect was
captured as the FULL 33-panel projected field (mirroring `screenRect`
math against the registered groups, to the pixel), replayed through the
pure module node-side to prove the browser pick lawful BEFORE calling
it wrong, and pinned — mechanisms in `spatialNav.test.ts`, whole
neighborhoods in `spatialNav.field.test.ts`. The two captures agree to
the pixel because the rig only reframes when a target leaves the
comfortable view: at home pose, projection is a fixed function of the
lattice.

The rest of the verification ledger: retraces walk back exact paths
under the moving camera; the yaw nudge's tween target matched
prediction to a millimeter (z 2.837 vs 2.836 computed by hand) and
pitch-down reproduced the `asin` math exactly; the top row is a clean
`canMove`-false no-op with gaze pinned at the polar limit to four
decimals; engaged units pass arrows through with byte-identical camera
poses; and an agent-reported "dial regression" (ArrowUp landing on a
role-less div) proved to be a concurrent pointer click — the
click-selects-unit grammar clearing `data-engaged` mid-run — with the
instrumented controlled repro clean: Cutoff 3 → 4, zero focus events,
proxy handler consuming the arrow at element level before the router
ever sees it. Post-fix, the full 3×11 walk is row-true in both
directions through the shear zone, verticals land in-column, and the
leftward walk after an engage/release trail-clear retraces the row
geometrically. 149/149 vitest, tsc clean, idle contract intact — every
doc panel at zero paints throughout navigation; only the live feeds
advance. Deferred, deliberately: member-level arrows, per-group `grid`
mode, the spec's `auto` philosophy (view nudges before focus moves),
the announcer, page-edge handoff — and an authored 2D lattice stays
rejected-for-now (decision #15) until the geometric pick has earned
its keep on its own.

## lab 008 — consolidation: the rig becomes a primitive

Seven labs of findings, and the load-bearing camera knowledge still
lived in a scene file. Lab 006's `CameraRig` earned each of its 240
lines in browser traces — great-circle gaze against the whip, pose
pre-clamping against the settle yank, live-aim publishing against
fast-Tab snaps — and lab 007 wired its grammar by hand: a
`useFocusSceneEvents` block every consumer would have to re-type, and
hand-copied contracts are where drift starts. Lab 008 is the
consolidation lab: extract the rig as a primitive, re-seat lab 006 on
it, then prove the public surface by building a new scene that imports
nothing else — with a VoiceOver script ready for the first real
assistive-tech session.

**Increment 1 shipped — `FocusOrbitRig`, and the event that carries
its own object.** The one genuine design question: the grammar needs
each event's `Object3D` (approach parks `approachDistance` in front of
`getWorldPosition` along `getWorldDirection`), but the id→group map
was scene state — exporting the wiring meant exporting the
bookkeeping. Inverted instead: `FocusSceneEvent` now carries `object`,
resolved once at the notify chokepoint from the registry the manager
already keeps. A rig subscribes and needs no map; a scene supplies
poses (`home`, `approachDistance`) and nothing else. Lab006.tsx
dropped from 663 lines to 377, its grammar block now a comment saying
the contract moved.

The proof is a ledger, not a diff review: same entry (Tab×2 → pr),
same approach (3.05 from the panel, exact, interior engaged), same
release — position home, view holding the released unit; pr's held aim
matches the hand-computed 1.601 to the millimeter, and far-left doc-8
released to a hard-left hold at x=−3.33 — Tab resuming the authored
ring (pr→doc-4, doc-21→doc-8), arrows column-true through the walk
(doc-4→deploy→synth→errors→doc-12→doc-13), the right-edge press
yaw-nudging the view with the camera position byte-stable, the top
row a clean no-op with the view pinned at the polar band's elevation
floor, and scene-Escape's bare home landing [0, 1.6, 0] exact from a
hard-right aim. Idle contract intact: 29 of 33 sources flat through
the whole session; only the four live feeds painted. 149/149 vitest,
tsc clean. Two of my own ledger expectations turned out wrong — Tab
RESUMES a parked ring rather than re-running entry, and pitch-up room
at the top row is already spent (maxPolarAngle keeps the camera above
the target plane, so the view can never rise past −2.2°) — both
dissolved by reading the emitter and recomputing the fingerprints by
hand. The lesson increment 4 taught, again: the report is data; the
code is the verdict.

**Increment 2 shipped — the barrel, and the scene that proves it.**
`src/index.ts` is the public surface now: Surface, SurfaceLayer,
MomentumCard, the control kit, the FocusScene kit with its four hooks,
FocusOrbitRig — curated on purpose, with the lib/ internals
(cameraPose, focusTree, spatialNav, physics1D, lodTier) staying
private behind the primitives that wrap them. The proof is Lab008.tsx:
a three-panel drafting wall — read-only brief, console with native
typing, tuner whose Dial shares the panel's traversal — that imports
from the barrel alone. If it needed to reach into src/lib, the barrel
would be lying about being a library. It also runs a deliberate
contrast to lab 006: no feeds, no timers, so idle is exactly zero —
two stats samples four seconds apart, byte-identical, all three
sources flat.

The keyboard ledger, on a scene the focus system had never seen:
entry policy picked the center console; the ring wraps
console→tuner→brief in authored order; arrows clamp at the wall's
edge; Enter parked the camera 3.05 from the console with the input
natively focused; typed "x9" landed as `x9ember-3` in the parked
subtree and Transmit's DOM handler logged "Sent as x9ember-3."; the
read-only tuner descended straight onto its dial leaf (role slider,
"Tuner frequency", 440 Hz) and one ArrowRight moved valuetext and the
painted readout together to 880 Hz; the Escape ladder stepped
interior→unit→scene with the camera landing home exact. One
verification stall was my own script, twice over: `agent-browser
type` takes a selector before the text, and I'd passed text alone —
the CLI sat waiting for an element named after my payload. The app
never had a bug; the harness did.

**Increment 3 shipped — the VoiceOver script, written before the
session.** `docs/voiceover.md` is a ~30-minute manual protocol with
its expectations split honestly: **EXPECT** rows are grounded in ARIA
we set (the dial proxy's slider role and valuetext, native inputs
announcing as inputs) where a miss is a bug; **OPEN** rows are genuine
unknowns we are measuring — what VO says at the role-less unit roots
and the bare canvas stop, whether silent DOM mutations stay silent,
what order the VO cursor reads parked sources in, and whether the
rotor lists the dial proxy at all. The known-weak spots are flagged as
the announcer kit's design input, not papered over: the point of the
session is to let VoiceOver, not spec-reading, decide what the unit
stop should say. Lab 008 closes here — the rig is a primitive, the
barrel is honest, and the next accessibility increment waits on a
human ear.

## lab 009 — the port: shadcn/ui as physical matter (in progress)

The demo direction is decided, and it wasn't one of the three concepts
on the scorecard. Pete's call: the world's most popular component
library, in full 3D — with the note that the engineering problems it
forces (the floating-family re-plumb, the animation dialect, the
layout oracle) are worth solving whatever the demo becomes. That
second clause is what makes the call cheap to commit to: the seams are
infrastructure for *any* demo, and the benched referent concepts (a
configurator is the obvious one) would be built FROM this kit anyway.
The corollary discipline still applies — a static shadcn page floating
in space is fakeable with CSS perspective, so every increment has to
bank something perspective can't fake: real typing into the material,
real occlusion between floating layers, modals that are camera
grammar. Virality is a distribution property; the port has to stay an
interaction-paradigm claim.

**Increment 1 shipped — verbatim shadcn leaves painting as matter.**
The word "verbatim" is load-bearing: Button, Card, Input, Label, and
Badge came from the shadcn registry by `curl`
(`ui.shadcn.com/r/styles/new-york-v4/*.json`), written to
`app/components/ui/` byte-identical, imports from the unified
`radix-ui` package and `@/lib/utils` resolved by alias rather than
edited. shadcn's copy-into-your-repo model is what makes this
legitimate rather than a fork — vendoring IS the install path. The
Tailwind side (`app/shadcn.css`) replaces the generated globals
with exactly three deviations, each one a dialect rule of DOM-as-
matter: `tw-animate-css` is refused (opacity/transform keyframes are
compositor-owned and never rasterize — motion belongs to the mesh),
the `body` base rule is scoped to `.ui-root` (the host page owns
body; Surface-mounted trees get the class), and the `hover`/`active`
variants are overridden to also match `[data-hover]`/`[data-active]`
— one `@custom-variant` line that makes every `hover:` utility in
untouched shadcn code work through the texture, because forwardEvents
already mirrors pointer state as data attributes. The scene mounts the
classic Create-project card through a small `SurfaceApp` adapter: a
second React root rendered into the parked source subtree, state and
event delegation running in real DOM, every commit just another paint
the Surface uploads.

The one bug of the increment was mine, and it minted a house rule.
First render showed the card in the top-left of the panel with a
black L-shaped band right and below — which read as the LOD ghost
until the ratios said otherwise. The parked source element measured
232×400 with no inline styles: `createDomTextureSource`'s element is
content-sized, every previous lab sized its content root in its own
CSS (`.p8{width:320px;height:220px}`), and my host div's `100%` chain
resolved against a shrink-to-fit `position:fixed` ancestor — down to
the card's natural size. 232/360 = 0.64 and 400/460 = 0.87, exactly
the band proportions on screen: the texture was faithfully showing a
small element on a big canvas. The rule, now explicit in the adapter:
**the content root declares its own pixel size; Surface's
width/height size only the canvas.**

The ledger, all through the untouched components: hover twin proven
numerically (`data-hover` flips the Deploy button's computed
background from `oklch(0.21 0.006 285.885)` to the `/90` composite —
and the probe's own attribute flips each cost a paint, the counter
accounting for themselves); React state committed inside the texture
(Deploy's `onClick` → `setState` → one paint, 4→5); "Nebula" typed
natively into the shadcn Input and redeployed as "Deploying Nebula…";
idle flat at 69→69 across 2.5s once blurred (caret blink paints while
focused, as it always has); and the focus spine composed for free —
Tab selected the unit, Enter descended with native focus landing on
the Input, Escape ascended, the `data-focus` outline riding the card
via one dialect selector in the app stylesheet. Zero edits to any component
source. The leaf set turned out animation-free, so the compositor
rule cost nothing here — that bill arrives with the floating family,
which is increment 2's whole subject.

The other risk of the increment — Tailwind's preflight reset landing
on eight labs of pre-Tailwind CSS — resolved to nothing: a scripted
sweep across labs 001–008 (plus a direct lab-002 recheck after a
mid-sweep reload ate its first pass) found every panel styled exactly
as before, chips green throughout. The labs' CSS always set its
properties explicitly, so the reset had nothing to reset. One
distribution fact worth recording while it's true: the origin trial
runs M148–M151 and stable Chrome is 151 *today*, so a token'd live
URL reaches plain-Chrome users for only a few more weeks — the
public-push moment that actually matters is the API's estimated
late-2026 stable ship, and until then the demo travels as video with
the live URL as a bonus.

### Increment 2 — the floating family, and a platform rule that was wrong

The increment's stated subject was the portal seam. It delivered that,
and then it overturned one of the project's two founding platform
facts, which is the part worth leading with.

**Portals, probed before re-plumbed.** Popover, Dialog, Select, and
Tooltip went in *unmodified* first, purely to record what they do.
They render to `document.body` — outside every rasterized subtree — so
the content lands in no texture at all: present in the DOM, live to
the accessibility tree, invisible as matter. Dialog additionally locks
scroll and `aria-hidden`s the host page, which for a canvas app means
hiding the entire scene from assistive tech. Radix exposes exactly one
lever, `Portal`'s `container`, so the port deviation is one line per
component and the components stay byte-verbatim.

**The overlay plane.** Aiming `container` at the panel's own content
root paints the popover but clips it at the panel edge. The shipped
answer gives the floating content its **own** Surface: a same-sized
transparent slab lifted along the panel normal, with its own parked
source (`.ui-layer` — the typography, no background). What makes it
cheap is a coincidence worth naming: both parked sources sit
`position: fixed` at page (0,0), and Floating UI also positions with
`position: fixed`, so a portaled popover's page rect is *already*
layer-local. Radix's own collision and flip logic lands the content in
exactly the right place and we add a Z offset and nothing else — zero
coordinate math, and the panel keeps paying nothing while the slab is
empty.

**The conductor, and the bug hiding in a scrub.** shadcn asks for
motion in Tailwind (`animate-in fade-in-0 zoom-in-95
slide-in-from-top-2`). `useAnimationConductor` seizes each animation on
`animationstart`, pauses it, scrubs `currentTime` while reading
`getComputedStyle` — the style engine applies the timing function, so
the samples come back already eased and we never implement a
cubic-bezier — parks the DOM at the visible pole, and replays the
curve on the mesh. An open costs **2 texture uploads**; the popover
physically flies (opacity 0.101→1, scale 0.955→1, y −7.19→0 over
149ms). Then exits started ending 130ms early. The first theory was
`animationcancel`; the event log killed it (one clean start/end pair,
no cancel). Monkeypatching `Animation.prototype` found it: **seeking a
paused animation to its exact end time puts it in the *finished* state,
and finishing dispatches `animationend`** — so the last scrub sample
was announcing, one frame in, that a 150ms exit was already over, and
Radix's Presence unmounted on hearing it. Half a millisecond short of
the end is the same frame visually and keeps it merely paused;
`animationend` moved 36ms → 161ms.

**The canvas is always outside.** With a live popover in the overlay
Surface, clicking its own Apply button *dismissed* it. Capture-phase
logging showed two `pointerdown`s per click — the trusted one
targeting `CANVAS`, the forwarded synthetic one targeting the real
button — and the canvas one arrives first. Radix's `DismissableLayer`,
and every menu/popover/dialog/combobox built on it in any library,
decides "outside" from a document-level pointer target. The WebGL
canvas is outside *every* portaled layer, so any click into any
Surface reads as outside-interaction. `Surface` now stops the native
pointerdown once the hit is forwarded, which isn't a Radix workaround
but the truth: the canvas is how the pointer travelled, not what it
hit. `pointerdown` only — OrbitControls needs document-level move and
up, or a drag that starts on empty space and ends over a panel is
stranded. Verified both directions with real CDP clicks projected onto
the button: the counter moved 360 → 380 with the popover still open,
and a click on the same slab outside the popover still dismissed it
and retired the layer.

**And the fact that was wrong.** Increment 1's entry above says
opacity/transform keyframes are "compositor-owned and never
rasterize." Half of that is false, and the half that's true is true
for a different reason. The discriminating experiment — same
`@keyframes { opacity: 1 → 0 }`, same tree, only the *target* differs,
texture sampled per frame under a known-position landmark div:

| animated target | DOM opacity swept | distinct texture values / 29 frames | paints |
|---|---|---|---|
| a **descendant** div | 1 → 0 | **29** — a clean ramp | **29** |
| the **drawn root** itself | 0.97 → 0.03 | **1** — frozen | **1** |

Descendants animate, self-paint, and rasterize; the drawn root does
not. The mechanism isn't compositor promotion at all — changing the
drawn element's **own** opacity/transform doesn't *invalidate* its
paint record, so nothing ever repaints. Set the root's opacity to 0.5
and the texture holds the old alpha; touch any descendant's
`textContent` and the fresh record bakes 0.5 correctly. That is the
old "self-heals on the next unrelated repaint" heisenbug, reproduced
exactly and finally explained, and it's why `paint="always"` never
helped: `requestPaint()` schedules a *replay*, and replaying a
still-valid record re-reads nothing. Paint policy was never the lever.

The over-broad version survived two days because every original probe
animated the drawn root — the natural thing to reach for when the
question is "does this Surface fade?" — and each reading was accurate
for that target. Nothing contradicted it until a descendant got
animated for an unrelated reason (verbatim shadcn markup, whose
keyframes run deep inside a portaled subtree) and visibly worked. The
lesson generalizes past this API: a claim of the form "property P
can't be captured" is incomplete until it names **which element P is
on**.

So the authoring rule relaxes and sharpens at once. Descendant motion
is supported; the content root stays off-limits. The conductor doesn't
become unnecessary — it becomes a *cost* decision rather than a
correctness one, and the cost is stark: one paint plus one upload per
frame, ~120/s per open popover, against 2 uploads for the whole
flight. A single animating popover would otherwise spend a tenth of
the entire scene's paint budget.

One smaller trap, recorded because it cost an hour and will recur:
`raycast={live ? undefined : noop}` does not work in r3f. Props are
applied onto the instance, and handing back `undefined` doesn't
restore the class default — it leaves the last function attached. The
slab stayed permanently un-hittable and every click fell through to
the card behind it. One stable function reading a ref instead.

Dialog is deliberately left unplumbed in the scene, labelled as such:
a modal belongs to the camera, not to a panel, and that's increment
3's subject.

### Increment 2a — the tooltip that would not leave

Pete, looking at the finished increment: *"i'm only seeing the select
menu and the portaled dialog. i don't see a tooltip in 3d space."*

Two bugs, stacked, and the second one is the interesting one.

The first was mine and shallow. The floating slab's liveness was wired
to the Popover's `open` state, because the Popover was the component
being re-plumbed when the slab was written. So a Select or a Tooltip
opened into a mesh nobody was drawing — the content was there, in the
layer, correctly positioned, invisible. Worse, any animation landing
while the popover happened to be shut retired the slab out from under
whatever else was showing. The fix is a one-line reframing that turns
out to matter: **liveness is occupancy**, not any component's opinion
about itself. Is anything mounted in the layer? Then draw it. That is
also the only formulation that keeps the ports byte-verbatim — asking
components would mean wrapping every one of them, and the next
library's components wouldn't fit at all.

Then the tooltip appeared, and would not go away.

Moving the pointer off the mesh un-hovered the trigger correctly —
`[data-hover]` cleared, the mirror emptied — and the tooltip stayed
mounted forever. Reading Radix's source explains why, and indicts our
input layer rather than theirs. `forwardEvents` was synthesizing only
the *bubbling* half of the boundary protocol: `pointerout` and
`pointerover`. Radix Tooltip reads neither. It wants the non-bubbling
half — a native `pointerleave` **on the trigger** — which builds a
grace polygon from the exit point and the content rect, and only then
attaches the `document` listener that closes the tooltip once the
pointer lands outside that polygon. No leave, no grace area, no
listener, no close.

That distinction is not Radix trivia. `out`/`over` bubble, so one
dispatch tells every ancestor "something under me changed".
`leave`/`enter` don't bubble, and the browser fires one per element
actually crossed, stopping at the deepest common ancestor — because
the pointer never left *that*. They mean "the pointer left **me**",
which is a claim only the crossed elements are entitled to make. We
were emitting the announcement and withholding the testimony.

Adding the leave was still not enough, and this is the part worth
keeping. Sending the departure `pointermove` synchronously right after
the leave did nothing at all. The identical event, sent a moment
later, closed the tooltip instantly. The leave sets React state; the
listener that would have heard the move is attached by the effect that
runs after that commits. Our synthetic move arrived before its own
audience existed.

The bug is in the model, not the timing. A real pointer that leaves an
element **keeps moving** — so anything that arms a tracker in response
to a leave still gets later moves for free. Ours is discrete: one
exit, one instant, one event. So leaving a Surface now sends a short
burst of departure moves across the next few frames, cancelled if the
pointer comes back. Three frames is slack for a React commit plus
passive effects (two separate scheduler tasks, either of which can
land after any given frame) and far too short to feel.

The destination needs no tuning, which is the nice part. Radix pads
its exit points *inward*, so the grace hull can never escape the
trigger ∪ content bounding box — which lives inside the source root.
Any point outside the root's own rect is therefore outside the hull,
for any tooltip, at any position. Sixteen pixels out, and it is a
theorem rather than a constant.

This also bought the repo its first DOM test suite. Everything tested
here so far has been pure geometry, which runs happily in node; but
the thing under test this time *is* a sequence of DOM events — which
ones, on which elements, carrying which coordinates — so `happy-dom`
earns its place. Twelve tests now pin the protocol, including the two
that reproduce Pete's bug and the one that proves coming back cancels
the goodbye.

Verified end to end with a real projected mouse: tooltip opens on
hover, closes on leave, survives rapid re-entry, and the click-driven
layers are untouched — Popover and Select both stay open when the
pointer wanders off, and still dismiss on an outside click. Idle paint
counters flat across three seconds.

The through-line with the pointerdown finding (#18) is that both live
at the same seam. The forwarder is the only thing in the system that
knows the pointer's real story. Whatever it declines to say, no
component downstream can reconstruct.

### Increment 2b — clear glass is not a wall

Pete, on the freshly-fixed tooltip: *"it appears and then instantly
exits, even leaving the mouse stationary over the trigger."*

Which is a better bug report than it looks, because *stationary* is the
whole clue. A held-still mouse is not a still mouse — a hand tremors, a
sensor resamples, and the browser keeps emitting moves at a pixel or
two. My verification in 2a had used one CDP move and then measured. The
real pointer kept talking, and the scene kept answering.

Here is what it was answering. A floating-layer Surface is a full-panel
transparent quad standing a few millimetres off the panel it serves. The
instant the tooltip mounts, that layer goes live — and from that frame
it is the front-most mesh, so it catches every ray. The panel behind it
stops being hovered. It fires `onPointerOut`. That runs the departure
burst I had just built in 2a, faithfully, into a tooltip that was one
frame old. The fix from the previous increment was the murder weapon.

The correct read is that the slab was lying. It is transparent —
everywhere except the small popover rectangle, the DOM painted nothing
at all — and we were treating it as solid. A pane of glass you cannot
see through *and* cannot reach through is not glass; it is a wall.

So `pointer-events` became the raycaster's business. `Surface` grew
`hitTest="content"`: intersect the quad, convert the UV to a page point,
and keep the hit only if some element there actually accepts the
pointer. Rays through the clear part carry on and land on the card
behind, exactly as they did before the layer existed. The CSS side is
the portal idiom every 2D app already writes — container clear, contents
opaque, `.ui-layer > * { pointer-events: auto }` — which is satisfying:
the rule was already true on a page, and it turns out to be true in
three dimensions once the raycaster is told to read it.

Two things about the shape of this fix are worth keeping.

**It has to happen at raycast level, not in a handler.** An intersection
r3f never sees is one it never counts as a hover — so the Surface behind
simply *keeps* the pointer, uninterrupted. Declining inside a handler
would already be too late: by then the front mesh is the recorded hit
and the one behind has had its `onPointerOut` fired. The bug is not
"the layer responded wrongly", it is "the layer was asked at all".

**It deleted code.** The layer used to carry a liveness gate — a custom
`raycast` that refused everything while the slab was empty. Content
gating subsumes it completely: an empty layer accepts the pointer
nowhere, so it is inert *by construction*, not by bookkeeping. The gate
went in the bin. A special case that dissolves into a general rule is
usually the sign the general rule was the right one.

One inherited trap surfaced on the way. The parking canvas is
`pointer-events: none` so that real hit-testing can never wander into a
parked subtree — and that value **inherits**, so every element in every
Surface computed as `none`, and the first version of the content hit
test found nothing hittable anywhere. `createDomTextureSource` now
re-roots the cascade to `auto` on the source root, and `hitTest="content"`
sets it back to `none` for layers specifically. Pleasant side effect:
shadcn's `[&_svg]:pointer-events-none` is now honored through a Surface
for the first time, which it never has been.

While the hit test was being taught to tell the truth, the departure got
the same treatment. It used to always park the pointer sixteen pixels
off the source rect — a deliberate lie, guaranteed outside any grace
hull. Now, if a neighbouring Surface has taken the pointer since the
exit began, the burst reports *that* point instead. This costs nothing
in coordinate math, and the reason is the overlay-plane decision from
increment 2 paying rent: every parked source sits at page (0,0), so a
point forwarded to any surface is already a page point in the same
document Radix measured its hull in. Moving from trigger to tooltip
content now keeps the tooltip open — which was impossible before, since
every exit was a lie about leaving.

Verified with a real projected mouse: five one-pixel jitters over an
open tooltip, all five landing on the trigger, no leave, no burst, no
close. Real exits still dismiss. Popover and Select untouched, idle
paint counters flat, 182 tests.

One edge stays open and I'd rather name it than bury it: the two-hop
path — trigger, across the card body, into the tooltip — still closes,
about two milliseconds after the burst's first frame, even though the
reported destination computes as *inside* Radix's hull. It predates this
work (before today, every exit closed it), so it's not a regression, but
it isn't explained either. It goes to the floating-layer kit, along with
dismissal, stacking, and focus arbitration.

### Increment 3 — a modal that is actually modal

Increment 2 gave a popover its own Surface floating off the panel it
belongs to. That's the right answer for anything *anchored*. Toasts and
modals are anchored to nothing. A toast isn't about the card you clicked,
and a confirmation dialog isn't about any object in the scene — they
belong to whoever is looking. So they get a Surface at the eye: a group
that copies the camera's pose every frame, holding one 1280×720 slab sized
to span the frustum exactly, so a source pixel is a screen pixel.

Building that taught me something about r3f I had assumed the other way.
Parenting the chrome to the camera produces perfectly correct world
matrices and draws absolutely nothing. The reason is that a three.js scene
is walked *twice* by two different traversals, and only one of them starts
where you'd think: transforms propagate down the parent graph, but the
render list is built by walking `scene`. r3f's default camera isn't in
`scene` — `camera.parent === null`. Anything hanging off it is positioned
correctly in a world nobody renders. Copying the pose onto a scene-level
group is the whole fix, and it's never a frame stale, because drei's
OrbitControls writes at `useFrame` priority −1 and r3f renders after the
priority-0 callbacks.

Then the toast needed no plumbing whatsoever, which took a minute to
believe. sonner doesn't portal — it renders inline and pins itself with
`position: fixed` and corner offsets. And it turns out a `layoutSubtree`
canvas is the **containing block** for fixed descendants. So `<Toaster>`
mounted inside the chrome Surface pinned to *that slab*: measured 24px
from its right and bottom edges, which is simply sonner's own default
offset, arriving correctly with no coordinate math on our side. The Deploy
button in the card now has two destinations — `setState` mutates its own
texture, `toast()` raises a notice in a different Surface at a different
pose — and the card knows nothing about where a toast lives.

That containing-block fact is sharper than it first looks, so I probed the
boundary properly. Exactly **one** thing about a source canvas is
canvas-local: the fixed-positioning containing block. Everything that asks
"how big is the viewport" still answers with the page — `vw`/`vh`,
`dvw`/`dvh`, media queries and therefore every Tailwind `sm:`/`md:`
variant, `matchMedia`, `innerWidth`. It's the ordinary CSS distinction
between a containing block and the viewport, which nobody has to think
about because for `fixed` they're normally the same object. A canvas pries
them apart. It also retroactively explains the weirdest measurement of
increment 2, where a `Select` came out 568px tall inside a 460px panel:
Radix computes its available height *in JavaScript* from
`window.innerHeight`. Declare yourself in CSS and you get the slab; measure
the viewport in JS and you get the page.

The dialog went to the same slab, through the same one-line lever as the
popover — `container`, aimed one object further out. Overlay filled the
slab, content centred on the eye, both to the pixel. And then the part I
had flagged as the increment's real risk: Radix's modal sets
`body { pointer-events: none }`, which sounded like it would make the
entire scene unclickable.

I was wrong about it twice, in opposite directions, and only measuring
settled it. First guess: the lockout kills the WebGL canvas and nothing in
the scene can be touched. Measured — the canvas computes `pointer-events:
auto`; the lockout doesn't reach it. Second guess: fine, but then it must
at least block the *dialog*, sitting as it does inside a parked subtree
under a locked-out body. Also wrong, and for a much more interesting
reason: the forwarder never consults the browser's hit test at all. It
resolves a hit by walking the subtree with `getBoundingClientRect`. The
lockout isn't overcome, it's simply *not in the path*.

Which should have been alarming — a modal whose containment mechanism is a
no-op — except nothing at all is lost. The overlay is `fixed inset-0` on a
slab that spans the frustum, so it is a real object standing in front of
the entire scene. I aimed a click at the Deploy button on the card behind
it. The overlay caught it, dismissed the dialog, and the card never heard
a thing. Closed the dialog, clicked the identical coordinate, and the card
fired its toast.

That inversion is my favourite thing in this lab so far. On a page, an
overlay cannot actually block anything. It's a sibling element painted on
top; hit-testing would fall straight through it. So the platform grew a
lockout to *simulate* obstruction, and every modal on the web ships that
simulation. Here the obstruction is real, because the overlay is matter
standing between the eye and everything else. The CSS mechanism turns out
to be scaffolding for a limitation this medium doesn't have.

None of which would work without increment 2b. A quad spanning the whole
view is exactly the wall that increment was about — without content
gating, viewer chrome would make the scene permanently untouchable.
Measured with the chrome empty, a raycast at the Deploy button returns
three hits, the card nearest, and the chrome slab **absent entirely**. It
becomes solid precisely where the DOM painted something, which for `fixed
inset-0` is everywhere, exactly when it should be.

The remaining side effects all landed right, which after the last two
increments I no longer assume. Radix's `aria-hidden` walk hid the whole
visual scene and *spared* the canvas holding the dialog — correct modal
semantics for free, since the visible copy lives in the hidden GL canvas
and the accessible copy is the parked DOM. `Escape` closes with no
forwarding at all, because native focus is already inside the parked
subtree and the keydown bubbles to the document listener on its own.
Paints go flat the moment the open transition ends (chrome 215 → 215 over
three seconds).

One context loss paid for along the way: the chrome host owns a React
root, and hoisting it into a `useMemo` the way the panel's layer does
means a remount calls `createRoot` on a container whose previous root is
still waiting on its unmount microtask. React throws, the throw lands
inside r3f's canvas, and the GL context goes with it. Hosts that own a
root get built inside `mount`.

The last thing I expected to have to build turned out to need nothing at
all. Radix's `FocusScope` and our `FocusScene` both want Tab and Escape
while a modal is open, and I had that filed as the increment's real
integration work. Instrumenting a document listener behind FocusScene's
own, with the dialog open: interior Tabs arrive unclaimed and FocusScene
stands down, because the focus contract from lab 007 routes interior Tab
to native and the browser walks the dialog's tab order itself. The *wrap*
Tab arrives claimed, by FocusScope moving focus by hand. Escape arrives
claimed, by `DismissableLayer`, so our ascend ladder never runs. Arrows
arrive unclaimed and move nothing, by the same interior rule. Focus went
confirm → Close → X → confirm across six presses and never once left the
dialog.

So modality holds by three entirely independent mechanisms — occlusion for
the pointer, `FocusScope` for Tab, interior routing for arrows — none of
which know about each other. What lets them compose is the
`defaultPrevented` gate we put at the front of FocusScene's key handler
back in lab 007, for unrelated reasons. That's the second time this
increment that a thing built for one purpose turned out to be the load-
bearing piece of another, which I'm choosing to read as the design being
roughly right rather than as luck.

One risk I'll name rather than discover later: all of that rests on Radix
moving focus *into* the dialog when it opens. A modal that suppressed
that would leave focus at scene level, where our arrows own the keys and
would happily move selection out from under an open modal.

Open, and going to the floating-layer kit: the chrome is a single layer,
so two stacked modals — or a modal that ought to sit above the toast
stack — have no z-arbitration yet.

### Increment 4 — furniture, not decals

There were two places a portaled thing could go, and both of them were
somebody else's coordinate system. Increment 2 gave a popover its own
Surface on an overlay plane in front of the panel, which works because of
a coincidence I've since come to distrust: the layer canvas is the same
size and origin as the panel's, so Floating UI's page coordinates are
*already* panel-local and land in exactly the right place with no math.
Increment 3 aimed the same one-line lever at the viewer instead. Both are
decals. Everything either one holds is pinned to a plane it didn't choose.

This increment is the third place: the room. A popover that stands a foot
in front of its card, that you can orbit around, that occludes the card
from the side and casts a shadow on the floor. Not a layer on an object —
an object.

The way to get there is to stop asking the positioner for help. There is
no 2D offset that could be right once the trigger and the content are
separate meshes at arbitrary poses, so the answer isn't a better offset,
it's revoking placement entirely:

```css
.ui-detached > * {
  position: fixed !important;
  inset: 0 auto auto 0 !important;
  transform: none !important;
}
```

Three lines of CSS, and the content falls to its canvas's origin. Then
size the canvas to hug it, and where the thing *goes* becomes an ordinary
question about where you put a mesh. I checked the first half before
building anything: zeroing the wrapper moved the content from canvas
(36,133) to (0,0), a magenta dye read `[255,0,255,255]` at the origin and
`[0,0,0,0]` where it used to be, and the move cost exactly one paint. It's
a paint-record change, so upload-on-paint carries it for free.

The `!important` is doing real work in two directions. Radix rebuilds the
popper wrapper on every open, so anything written inline once doesn't
survive a close and reopen; and Floating UI rewrites its inline transform
on every `autoUpdate` tick, which is to say continuously. With the rule
active the inline style reads `translate(36px, 133px)` and the computed
style reads `none`, which is a fairly satisfying way to lose an argument
with a library. Note it targets the *wrapper*, not the content — the
entrance animation transforms the content itself, so it's untouched and
still gets seized by the animation conductor.

Then I lost an evening to a bug with no error message.

Everything measured perfectly. Container class right, computed transform
`none`, layout box 288×122, content at canvas (0,0), canvas CSS 288×122,
backing 432×183, quad 1.44×0.61, mesh on screen at (127,241), whole parent
chain visible, material fine, texture uploaded at the right dimensions, 21
paints, zero errors, no GL errors. And the slab rendered as absolutely
nothing. When I finally sampled the source canvas itself instead of
reasoning about the things downstream of it, every pixel read
`[0,0,0,0]` — the canvas was painting, cleanly and repeatedly, and
painting nothing.

The cause is a sentence I could have written down two increments ago and
hadn't: `drawElementImage` rasterizes an element at *its own layout box*.
Every child of a detached layer is `position: fixed`, so every child is out
of flow, so the container measures zero high no matter what's inside it.
The compositor did exactly what I asked and drew a zero-size element,
which is not an error and has no signal. Every other Surface in the repo
happens to declare `style.width`/`style.height` on its content root as a
matter of house style; this is the first place where that style is
load-bearing, and the fix is one line each way — write the host's size in
the same breath as measuring the content. Here the size is a *declaration
for the rasterizer*, not a consequence of layout, because there is nothing
in flow to derive it from.

The measurement itself has a trap I did fall into and caught early, which
felt like a small victory. `getBoundingClientRect()` includes transforms.
A floating layer's first frame is mid-entrance, and at frame 0 the rect
read 273.6 × 115.9 against a real layout box of 288 × 122 — `zoom-in-95`
and `slide-in-from-top-2`, about to be baked into the canvas size
permanently. That ships as "popovers are sometimes five percent small,"
intermittently, forever. `offsetWidth`/`offsetHeight` are the
transform-immune layout box and are the only correct measure here.

Fitting a canvas to measured content meant Surface's `width`/`height` had
to become live, and specifically had to become a *re-layout* rather than a
*teardown*. They'd been sitting in the creation effect's dependency array,
so changing either one destroyed the source and built a new one — taking
focus, form values, selection, and any second React root mounted inside it
along with it. Fine for a size you author once; catastrophic for a size
that's measured and therefore changes constantly.

Underneath that was the one bug in this increment that genuinely scared
me, because it hid. `createDomTextureSource` closes over `width` and
`height`, and the LOD tier ladder's `setScale` multiplies *those*, not the
canvas attributes. So a resize that moved only `canvas.width` and
`canvas.style.width` looked completely correct — until the next tier swap,
whenever that happened to be, at which point the backing store snapped
back to its birth size against a CSS box that had moved on, and the two
stayed diverged for good. An intermittent corruption whose trigger is the
camera moving. `setSize` has to move the closed-over parameters, and
there's now a test called `a resize SURVIVES a subsequent tier swap` that
I proved by deleting the two assignments and watching four tests go red.

What I'd budgeted the most time for turned out to need nothing at all,
for the second increment running. The plan said detachment forces us to
own dismissal, because Radix's grace polygon and hull reason in page
coordinates and those stop meaning anything once the trigger and content
are separate objects. All three cases already work. Click empty space:
nothing was hit, so Surface never stops the canvas's own `pointerdown`,
and it reaches Radix's document listener → dismissed. Click a *different*
Surface: the forwarded synthetic `pointerdown` is dispatched on that
Surface's parked DOM, bubbles to `document`, target is outside the content
→ dismissed. Click inside the detached popover: stays open, and the button
fires — `width 360` became `width 380`, with `data-hover` and
`data-active` landing on it through the mesh.

The reason is worth keeping. *Containment* dismissal asks a question about
the DOM tree, and detaching a layer doesn't touch the DOM tree — the
content is still inside the container it was portaled into, wherever that
container's pixels ended up in the world. *Geometric* dismissal — the
swept region between a trigger and its content — asks a question about the
plane, and detaching destroys the plane. Click-driven layers are all
containment. So the ray-based answer is still owed, but only by hover-driven
detached layers, which narrows it from "a thing this increment must
build" to "a thing the floating-layer kit should build."

Last thing, because it rides the riskiest path in the codebase: I grew the
content at runtime to watch the whole chain re-fit. Content 288×122 →
288×234, canvas backing 432×183 → 432×351, quad 1.44×0.61 → 1.44×1.17,
texture image dimensions moving with it, the new region rasterizing
correctly out of storage that had to be reallocated after the fact — in
two paints. A plane grows from its centre, so a detached surface that
gains content expands both ways rather than downward. I think that's
right: the pose is the object's centre, and furniture that grew out from
under its own position would be worse.

Open: N detached surfaces bring back the reading-order problem from lab
007 across parked canvases, and `side`/`align`/`avoidCollisions` are
silently ignored in detached mode rather than warned about.

## the seam — separating the library from the labs, and a pass over what's left

Everything above was written as one project. `src/` held the primitives,
`app/scenes/` held nine labs, and the labs reached into `src/` on relative
paths because there was no reason not to. That's fine right up until you
want to know what the library actually *is*, and discover the honest answer
is "whatever the labs happen to import."

So: `src/` is three-ui, `app/` is an application that consumes it, and the
only specifiers `app/` may use are `three-ui` and `three-ui/style.css` — the
exact strings a published package would expose, aliased in `vite.config.ts`
and `tsconfig.app.json`. A test walks the tree and fails on any violation in
either direction, and I proved it bites by injecting one. The value isn't
tidiness. It's that a gap in the barrel now shows up as a broken lab, which
is a thing you can't ignore, instead of as a relative path quietly reaching
around it, which is a thing nobody ever notices.

Drawing the line found four things that had been sitting in Lab009 as scene
code and were plainly library: the second-React-root adapter (`SurfaceApp`),
the panel-local floating layer (`AnchoredSurface`), the frustum-spanning slab
at the eye (`ViewerSurface`), and the pose it rides on (`CameraChrome`). None
of them were *written* as scene code — they'd just never been asked where they
lived. All four turned out to want the same DOM plumbing underneath, which is
now `useSourceHost`, and every hard-won rule in it — build the container
inside `mount` and never hoist it, declare the size rather than let layout
find it, one childList observer for occupancy, a `mount` identity that never
changes — is paid for exactly once instead of four times.

Then a pass over the primitives themselves, which is where the interesting
part is.

**The viewer slab had a size, and it should never have had one.** It took
`width`/`height` props, authored at 1280×720, and drew itself at the
frustum's cross-section. Those are two different rectangles the moment the
window isn't 16:9, and at 1000×800 the slab spanned x ∈ [−211, 1211] — 1422
pixels of quad in a 1000-pixel viewport, 42% too wide, with a toast that
believed it was 24px from the right edge sitting at x=1184. The fix is to
delete the props: the viewer surface has no size of its own, it *is* the
viewport, and both its quad and its source pixels derive from `size`.

One subtlety made it a two-attempt fix. The obvious aspect source is
`camera.aspect`, and it's wrong — r3f writes that in a layout effect that
runs *after* the render which observed the new `size`, and mutating a camera
doesn't re-render React, so a memo reading it on resize gets the previous
frame's value and then keeps it until some unrelated render wanders past.
`size` is the earlier and more honest source. Verified across five viewports
on one page without a reload — 1.25, 2.3333, 0.9111, 1.6, 2.0 — source, quad
and canvas aspects equal at every stop, slab corners landing on window
corners, two paints per resize. A real sonner toast at 1600×800 projected its
bottom-right to (1576, 776): exactly 24px in from the corner, which is what
it was asking for all along.

**`Surface`'s creation effect was a teardown wearing a dependency array.**
That effect destroys a live DOM subtree and everything living inside it —
focus, form values, selection, any second React root a scene mounted in
there. `width` and `height` had already been pulled out of it during the
detached-surface work. Three more were still in: `mirrorU`, `resolution`,
`paint`. Same class of bug each time, and `paint` is the one that makes the
shape of the mistake obvious — the creation effect doesn't even read it. A
flag consulted once per frame in `useFrame` was destroying and rebuilding a
live subtree because it happened to be listed. The effect's deps are now
`[html]`, with a comment enumerating where each other prop is handled, and
the read-a-prop-without-depending-on-it idiom is a named hook (`useLatest`)
whose docstring carries the reasoning, so the next person to add a prop finds
the argument rather than the pattern.

**The focus manager was three documents wearing one filename.** 1200 lines:
a contract, a state machine, and four consumer hooks. The linter had been
saying so the whole time via `only-export-components`, which reads like style
advice until you notice what it costs — Fast Refresh gives up entirely on a
module that mixes components with anything else, so the file you iterate on
most reloaded the page on every keystroke and threw away the focus state you
were in the middle of inspecting. Three files now, and the knock-on is the
better half: `Surface` reads one context object to auto-register, and had
been importing 1200 lines of state machine to get it. So had `Dial`.

I did *not* decompose the state machine, and that's a decision rather than
laziness. Those 800 lines are about fifteen mutually recursive closures over
one shared `tree`/`runtimes`/`camera`/`gl` — genuinely coupled, not layered.
Splitting coupled code into files makes it look organized and read worse, and
this particular subsystem is verifiable only in a browser, which is the worst
possible place to discover you've broken something subtle. The file-level
split earns its risk because the linter points at it and it fixes HMR. Cutting
the machine itself would be churn on measured code, and I'd be doing it at one
in the morning with no user awake to catch me.

Which is also why I stashed the branch mid-verification. A leaf ARIA proxy
read 34679×7198px and my first instinct was that the `proxyLayer` hoist had
broken projection. It hadn't — that's just what projecting an off-screen
object looks like after the reframe fulfiller has trucked the camera away
from it, and I'd been Tabbing around for a minute before I looked. Measured
the baseline at the home pose, restored, measured again: 171×118 at
(1229,178) both times, identical. It cost four minutes and it's the
difference between knowing and assuming. (Left as noted debt: that
projection probably ought to clamp. It predates this pass, and inventing a
fix mid-refactor muddies the diff.)

## the flight debt — the detached surface joins the conductor

The seam pass left one number on the table: opening the popover on the
detached surface cost 19 paints a transition where the anchored layer's
Select cost 2, because `FloatingSurface` had never been routed through the
animation conductor. The change itself is the anchored apply with the
arithmetic collapsed. `AnchoredSurface` pivot-corrects because CSS scales
about the content's box, up near the trigger, while a group scales about
its own origin at the panel's centre. On a detached layer there is nothing
to correct: `.ui-detached` pins the content to the canvas origin and the
canvas is sized to hug it, so the content's centre *is* the mesh's centre
and the pivot term is identically zero. Scale, translate, opacity-traverse,
done — and no `getBoundingClientRect`, which the file's own header warns
about for other reasons.

The verification is where the evening went. With the conductor
demonstrably flying — 35 frames of trace wearing the sampled curve,
entrance from scale 0.955 / y −7.2 / opacity 0.1, exit landing at 0.95 /
0 / 0 — the paint counter still read 19. Enumerating
`document.getAnimations()` mid-flight told it straight: the `enter`
animation on the content sat `paused` (the conductor's signature), and
next to it *six CSS transitions* ran on the Apply button. Border colours
to `--ring`, box-shadow from `none` to a 3px ring, outline-width 3→1px,
all at 150ms. That's the focus ring materializing. Radix autofocuses the
first tabbable on open — the Apply button — and shadcn's Button carries
`transition-all`, so the ring *fades in*, one paint per frame, for
exactly the duration of the entrance it was hiding under. Two per-frame
paint sources sharing a 150ms window count once per frame; seizing the
keyframes changed the measurement by nothing at all.

Suppress that one transition and the A/B comes clean under an otherwise
identical probe: 19 open / 21 close before, **3 / 4** after, right in the
anchored layer's band. Content resize while open (the size-hugging
realloc path this shipped worrying about) is untouched — the conductor
parks the DOM at its fully-materialized pole and `measure` reads
`offsetWidth`, which never saw a transform in the first place. Apply
mid-open still bumps `width 360 → 380`, zero source errors, clean close.
The detached surface also gained the `onFlight` diagnostics prop, and the
lab's `__lab009` hook a `detachedTrace`, so the next probe can read a
flight back without racing the render loop.

The ring itself stays, noted as its own seam. It isn't a probe artifact:
forwarded pointer events are untrusted, so Chrome's input-modality
heuristic doesn't hear them, treats Radix's script autofocus as
keyboard-ish, and `:focus-visible` matches — every popover open pays ~18
frames of ring fade on a page that would only pay them for keyboard
users. That's shadcn behaving correctly downstream of a modality signal
the forwarder doesn't yet speak. Whether it *should* — whether a
forwarded pointerdown ought to count as pointer modality for the focus
that follows — is a real question about the event bridge, not a paint
bug, and it goes in the queue rather than in this diff.

## the verdict — teaching the forwarder to say how focus arrived

The queue lasted about an hour. Before building anything I went back to
check the one thing the last entry had reasoned rather than measured:
maybe a *real* user's click — a trusted pointerdown on the canvas, even
though the canvas isn't the button — updates the browser's modality and
the ring never shows outside probes. Projected the trigger through the
mesh, drove it with trusted CDP input: 19 and 20 paints, ring
materializing. The strong version is true. Every pointer user pays it,
and worse than the paints, the *look* diverges from the page —
byte-verbatim shadcn, opening its popovers with a focus ring no page
would show.

Which reframes what `:focus-visible` is. It isn't a state like `:hover`;
it's a *verdict*. The browser grants or withholds the ring by asking how
the user last interacted, and the heuristic that answers is fed
exclusively by trusted events. The forwarder dispatches synthetic ones,
so the browser judges every post-click autofocus as if the user had been
tabbing. This is the same shape as decisions #19 — the forwarder is the
only thing that knows the pointer's real story, and whatever it declines
to say, nothing downstream can reconstruct — except this time the
missing testimony doesn't suppress a behavior, it acquits the wrong one.

So the forwarder now delivers the verdict itself, and the mechanism is
the hover twin pointed the other way. A module-level modality flips to
`pointer` at every forwarded press — declared *before* dispatch, because
a consumer may focus synchronously from its pointerdown handler — and
back to `keyboard` on any real keydown (capture phase, so keys FocusScene
claims still count; lone modifiers ignored, as the browser ignores
them). A document-level `focusin` listener stamps `data-pointer-focus`
on whatever gains focus under pointer modality, `focusout` cleans it,
and text inputs are never stamped at all — click into a field and the
ring is information, not noise, which is the browser's own carve-out.
The dialect grows its fourth line:

```css
@custom-variant focus-visible (&:focus-visible:not([data-pointer-focus]));
```

Where the hover twin *grants* a state real hit-testing can't deliver,
this one *withholds* a state the heuristic wrongly granted. Same mirror,
opposite direction.

The differential came out textbook. Trusted click through the mesh:
popover opens at **3 paints**, Apply autofocused and stamped, zero ring
transitions — page parity for the mouse. Escape, then Enter on the
returned-focus trigger: popover opens at 20 paints, no stamp, ring
visible and fading in — page parity for the keyboard, who earned those
paints. Radix's focus-return on dismissal inherits the right verdict
with no code at all. Lab 006's spine doesn't blink: its chrome runs on
`[data-focus]`, which never consults the pseudo-class.

One oddity surfaced and is parked rather than chased: a trusted Tab
pressed while focus sits inside the detached popover moves nothing —
unclaimed after full propagation, unacted by the browser. Pre-existing,
orthogonal to the mirror, filed with the #36 pile next to the two-hop
tooltip transit. Decisions #24 has the full argument, including the
three rejected fixes.

The rest of the verification was the ladder itself, because a refactor of a
focus manager that typechecks proves nothing. Canvas → `scene`, Tab → `unit`,
Enter descends into all four groups that have tabbable interiors and
correctly does nothing on the twenty-nine that don't, interior Tab wraps at
the boundary instead of escaping to the page, Escape ascends and disengages,
re-descent restores memory, arrows move between units. Eight labs sweep with
every source painted and zero errors.

One number worth writing down, since I measured it on the way past. Opening
and closing the Select on the anchored layer costs about two paints per
transition — the conductor doing its job. The same gesture on the detached
surface costs nineteen, each way. That's one paint and one upload per frame
of a 150ms entrance at 120Hz, and it's precisely what `FloatingSurface` not
being routed through the conductor looks like. It shipped with "measure
first" attached to it; measuring is done, the number is 19 versus 2, and it
lands on the `fit="content"` texture-realloc path, which is the riskiest code
in the floating family. That makes it its own increment, not a rider on a
cleanup pass.

## the oracle — CSS lays out the room

Board item #49, the oldest unstarted seam on the list, and the one the
Lab 010 handoff says everything else leans on. The question it answers:
when a scene holds a sidebar, a main column, a composer and a log, who
decides where they go? Every answer we could hand-roll in world units is
a worse copy of the one shipping in the style engine — and a ported 2D
app would lay out *almost* like the page it came from, which is the
uncanny valley of ports.

So the DOM stays the layout authority, literally. `createLayoutOracle`
parks a hidden container at the house parking spot with one deliberate
difference from a texture source: `visibility: hidden`. A source must
paint, so it parks visibly behind the page; the rig must only lay out,
and visibility suppresses exactly the painting half — layout runs,
`offsetWidth` answers, transitions tick, zero pixels ever produced. You
author the arrangement as markup — flex, grid, gap, the whole engine —
mark each panel's spot `data-pane="side"`, and `<LayoutSlot pane="side">`
wears the resulting box in the scene: positioned at the pane's centre,
children handed the CSS-px size for their Surface and the world size for
their geometry.

The probe banked four findings. Parity is pixel-exact — the main column
measured 1280−240−320−48−64 = 608 and the mesh stood at precisely that
centre. A `transition: width 350ms` on the sidebar streamed 39 distinct
poses: the collapse is a *glide*, panels sliding and the freed 168px
flowing into the main column frame by frame. The cost model came out the
way you'd want: panes the reflow resizes pay one paint per frame —
because their content is genuinely rewrapping, which is the payoff —
and panes it doesn't touch pay zero; pure position moves are free, being
group transforms. And the responsive story: the rig is not a viewport
(`vw` and `@media` stay page-global, the same platform fact the viewer
slab hit), so the rig declares `container-type: size` and CONTAINER
queries are the mechanism — shrink the rig to 900 and the log pane's
`@container` rule `display:none`s it, the oracle reports it absent, and
its panel dematerializes from the scene while `window.innerWidth` never
moves. Tailwind v4 speaks this natively as `@sm:`/`@lg:` variants, so a
responsive 3D layout is authored in the same vocabulary as a responsive
page.

Decisions #25 has the full argument. The one open cost: an animated
*resize* pays a GL realloc per frame per resizing pane — clean at
app-shell scale, deferred as a during-motion strategy until a wall of
panels actually hits it.

## the second story — silencing the trusted move

First debt on the floating-layer kit's ledger (#36): the two-hop tooltip
transit. Hover the tooltip trigger, glide across the card toward the
tooltip's own content, and it closes in your face — even though the
departure burst (the fix before last) reports the destination correctly,
and even though the forwarded stream says, truthfully: leave trigger,
cross card, arrive on content.

The trace made the shape obvious once it was captured with trusted CDP
input. The close decision lands at the exact moment the pointer arrives
on the content, and the DOM removal 150ms later is just the exit
animation finishing. The Radix source names the mechanism: its grace
tracker is a document-level `pointermove` listener that closes the
tooltip whenever a move's *coordinates* fall outside the trigger∪content
hull. And every trusted move over a Surface reaches document twice — once
retold by the forwarder with the coordinates of what it actually hit,
and once in the original, target `<canvas>`, carrying screen
coordinates. Screen (1203, 405) measured against a hull built at the
parking spot (x ≈ 116–245) is not a near miss; it's a different
coordinate system. The tooltip was closed by the pointer's own shadow.

The fix is the pointerdown suppression of decisions #18, extended to
hover: after forwarding a move, `Surface` stops the native event from
bubbling on to document. One pointer, one story. Hover moves only —
`buttons === 0` is the line, because OrbitControls listens at document
for the duration of a drag, and a drag that began on empty space must
keep orbiting while the ray crosses a panel. Dismissal survives
untouched on both routes: empty-canvas moves never meet a Surface
handler and bubble as before, and leaving a Surface still fires the
burst, whose moves land provably outside every hull.

Verified live with the same five-step transit that used to die: transit
survives, rest on content holds, genuine departure still dismisses, and
an orbit drag dragged straight across the panel still orbits. Decisions
#26 has the full autopsy, including why "Radix hears the forwarded
content-move first" isn't enough — tearing down its tracker is a React
state update, and the trusted move slips through the still-attached
listener microseconds later.

## the ledger — three debts measured, two dead on arrival

With the transit fixed, the rest of the floating-layer kit's ledger (#36)
got the same treatment: measure first, build only what the measurement
demands. Two of the three remaining debts dissolved under instrumentation.

The "trusted Tab is inert in the detached popover" anomaly — filed when a
Tab arrived unclaimed and unacted — re-measured as neither. A
preventDefault stack trace shows Radix's own FocusScope claiming it:
Popover hardcodes `loop: true`, the popover holds exactly one tabbable,
and a loop of one wraps onto itself. Inject a second tabbable and Tab
cycles both, through trusted keys, inside the parked canvas. The same DOM
does the same thing on a flat page. Not a seam.

The onOpenAutoFocus risk — "a modal that prevents autofocus leaves focus
at scene level, where FocusScene's arrows would move selection under it"
— refuted outright. The wall was never the autofocus; it's the trap.
Script-focus the trigger, the canvas, anything, while the dialog is open:
Radix's trapped FocusScope acts on `focusin` and yanks focus back before
the call returns. Every route to scene altitude runs through a focus move
the trap intercepts; focus abandoned at `body` reads as page level, where
FocusScene already stands down.

The third debt was real and is now paid. The forwarder resolved hits by
walking the source subtree in DOM order — later siblings win — which
matches paint order right up until `z-index` disagrees. The chrome slab
disagrees hard: sonner's toaster is the chrome layer's *first* child at
z 999999999, the dialog overlay a *later* sibling at z 50. Toast up,
dialog open, click the toast you can plainly see: the walk forwarded it
to the overlay underneath and dismissed the dialog. The fix is the layout
oracle's doctrine applied to hit testing — stop reimplementing the style
engine, ask it. `deepestElementAt` now consults
`document.elementsFromPoint`, the browser's own paint-order stack
(which, measured, sees straight into parked canvas-fallback subtrees),
filtered to the source's root; the DOM-order walk survives only as the
fallback for points the browser can't answer. Same click now lands on
the toast, dialog stays open — and stacked modals inherit the answer for
free, because whatever CSS paints on top, the pointer now follows.

What's left of #36 is exactly one item: ray-based dismissal for
hover-driven *detached* layers — which has no consumer until Lab 010
hangs a hover card off a chat message, and gets built when that scene
exists to measure it. Decisions #26 and #27 carry the autopsies.

## the bridge — CSS custom properties as mesh channels

The last board item before Lab 010 was #52, and it closes a loop the
library has been circling since the conductor. Doctrine so far: the DOM
declares, the mesh performs — keyframes conducted to the mesh (#17),
layout read back as poses (#25). But scene *state* — how lifted, how
open, how warm — still lived only in scene code, deaf to the cascade.
Which is backwards, because CSS authors already have a grammar for
exactly this: variants and transitions. Tailwind will happily write
`hover:[--depth:1] transition-[--depth]` on a card today. Nothing was
listening.

Now something is. `useStyleChannel('--depth')` returns a getter the
scene polls in `useFrame`. The whole trick is property registration:
a registered `<number>` custom property is *interpolable*, so its
transition is a genuine CSSTransition — the style engine stages it,
times it, eases it — while painting nothing at all, because a custom
property that no paint rule consumes never invalidates a paint record.
And `getComputedStyle` mid-transition returns the eased intermediate,
synchronously. The style engine is the interpolation oracle. There is
no easing math anywhere in our code; there is a question, asked once
per frame, that the browser answers with the authored curve.

The probe (`?styleprobe=1`) measured all three claims at once. A full
600ms `--depth` transition: zero paints, zero uploads, thirty-three
mid-flight samples all riding the authored bezier (82% of the distance
at 30% of the time — that's `cubic-bezier(0.22,1,0.36,1)`, not a ramp),
mesh z locked to `depth × lift` every frame. Then the hover twin closed
the loop end to end: trusted pointer over the mesh, forwarded move sets
`[data-hover]` on the card root, the variant flips `--depth`, and the
*mesh* glides up on CSS's own curve — hover-driven motion at zero
per-frame paints, the exact thing the drawn root's frozen paint record
(#1) could never give us. The card lifts off its own texture. The
texture never repaints. That's the demo sentence for the whole library,
and it costs nothing.

One contract came out of the measurement: a channel lives on ONE
element. Transition events don't descend from ancestors, so the value,
the transition, and the variants must be authored on the element the
channel watches — an inherited value would move and nobody would hear
it. Registration defaults to `inherits: false` for the same reason.
Decisions #28 has the full autopsy, including why `observe()` (the push
half, for `frameloop="demand"` consumers) is transition-event-bounded
rAF sampling rather than a poll loop, and why the pull getter is the
primary API: a subscription can miss its first event; a live read
cannot be stale.

The board is clear. Lab 010 is next.

## lab 010 opens — the wheel finds its seat

Lab 010 is the destination the whole board was clearing toward: an
agentic coding UI in full 3D, every shadcn/ui component including the
new chat set (`message`, `message-scroller`, `bubble`, `attachment` —
the registry inventory confirmed all four ship today). The handoff's
orders were to design around the seams, and the deepest one listed was
scroll containers: no lab has ever put a scrolling region inside a
Surface, and a chat log is nothing but one.

Measurement dissolved most of it before any code. Scroll *rasterizes*:
a `scrollTop` jump invalidates the paint record like any descendant
mutation — one paint, pixels verified — and smooth scrolling glides at
a paint per frame. The hit test never cared: `elementsFromPoint` reads
scrolled geometry natively. The seam was input, and input alone: the
platform only scrolls for TRUSTED wheels, and every event the forwarder
tells is synthetic. A forwarded wheel runs your handlers and moves
nothing.

So the forwarder became the scroll engine. `forwardWheel` dispatches
the cancelable wheel first (a preventDefault is a claim), then walks up
from the target for the nearest scroll container that can still move
and mutates it directly — instant, because user scrolling is exempt
from CSS `scroll-behavior`, and one paint, with `scroll` events firing
from the mutation for free. `overscroll-behavior: contain` stops the
chain cold, which matters more here than on any page: shadcn's scroller
viewport declares it, so a chat log at its bottom refuses to hand the
wheel onward — and onward, in this medium, means the camera.

That's the finding worth the entry: **the room is the outermost scroll
container.** On a page, a wheel that chains through every scroller
reaches the document and scrolls the page; here it reaches the scene
and zooms the camera. `forwardWheel`'s boolean is exactly that chain
boundary. And it cannot be enforced from inside r3f — OrbitControls
listens on the canvas, the wheel's real target, so any mesh-level
handler hears about the wheel after the camera has already moved. The
arbiter (`trackWheel`) sits at document capture, the only seat ahead of
the target phase, asks the hover mirrors which surface owns the pointer,
and stops consumed wheels before the camera ever hears them.

Verified with trusted wheels end to end: over the scroller, the parked
DOM scrolls and the camera holds; over the card's plain body, the
camera zooms; at the contained scroller's end, *nothing* moves — scroll
pinned, camera pinned; over empty canvas, the room takes it. Decisions
#29. The chat log now has everything it needs; next, the components
themselves come in byte-verbatim.

## the shipment — sixteen components, two claims checked at the door

The chat set came in the way everything comes in: byte-verbatim from
the registry (curl into node, never retyped). Sixteen files — the AI
four (`message`, `message-scroller`, `bubble`, `attachment`), the
palette (`command`, on cmdk), both scroll idioms (`scroll-area`,
`table`), and the supporting cast (`avatar`, `kbd`, `spinner`, `empty`,
`textarea`, `separator`, `hover-card`, `skeleton`, `tabs`). Two new
packages: `@shadcn/react` (the scroller primitive message-scroller
stands on) and `cmdk`.

Two things needed judgment. `hover-card` is the only new portal-er, so
it gained the same one-line `container` passthrough as popover and
dialog — port deviation #4, third application. And the scroller's
classes (`scroll-fade-b`, `scrollbar-thin`) come from a stylesheet the
registry's base CSS now imports: `shadcn/tailwind.css`, shipped in the
`shadcn` package. It joins `tw-animate-css` in shadcn.css under the
same doctrine — a score, not a performance: scroll-fade animates
@property-registered custom props consumed by `mask-image` on
descendants, which is paint-level and rasterizes honestly. No vh/vw
anywhere in the set; no component animates a drawn root. 240 tests,
tsc and build clean, all labs load. Now the scene.

## the scene opens black — a mask, and the claim it refuted

The last entry closed with a claim I hadn't measured: scroll-fade "is
paint-level and rasterizes honestly." Lab 010's first scene called the
bluff. The chat panel — message-scroller with the seeded conversation,
composer, verbatim everything — mounted, painted five times, reported
zero errors, and rendered as a solid black slab with exactly two
survivors: the scroll-to-end button and Send, both painted perfectly in
the right theme. Healthy DOM behind it — computed background white, 928
characters of text, every item laid out. The failure looked like a
broken theme, then like a stale texture. It was neither; forcing extra
repaints healed nothing.

The culprit fell out of single-variable toggles on fresh mounts. Kill
the viewport's `mask-image` alone: everything paints. Kill the
scroll-timeline animation alone, leaving the mask computed to a fully
opaque no-op gradient — a mask hiding *nothing*: still black. The mask
property's mere presence voids the capture, and not scoped to the masked
element — the viewport sat between a header and a footer and all three
went black, the entire drawn root. The two survivors are exactly the
elements wearing `transition` classes: independently composited, so they
kept painting into the void. That's the treacherous shape — the blackout
reaches *up* from a descendant and takes the whole record, then leaves a
few widgets alive to point the diagnosis anywhere but the mask.

Same compositor-owned family as the drawn root's opacity/transform
freeze, so the fix follows the same doctrine: the score stays, the
performance moves. `scroll-fade-b` remains in the verbatim markup;
`app/shadcn.css` neutralizes the mask inside `.ui-root`/`.ui-layer`
(unlayered, so it outranks the `@utility` layer without `!important`).
Deviation 5, decisions #30, and a new platform.md section with the
toggle table.

With the mask gone the increment closed on measurement: wheel over the
log scrolls the parked DOM with the camera frozen to the third decimal;
wheel-down at the bottom hits `overscroll-contain` and moves *nothing*;
wheel over the floor zooms the room. A probe-sent message became a user
bubble, the reply streamed word-by-word — 147 paints for the flight,
the honest cost of streaming text — autoscroll rode the growth, and the
panel settled back to zero paints per second. The chat log is matter,
and the scroll seam has its consumer.

## the sidebar lifts — the bridge earns its keep in a scene

Second panel: a session list, angled toward the chat like a real
workspace. It exists to put the style bridge (#28) on stage. The
sidebar's root carries `--lift: 0`, a 400ms ease-out transition, and
one variant — `[data-hover] { --lift: 1 }`. The mesh polls the channel
in useFrame and glides forward and slightly open when the pointer
crosses it. Measured: 39 distinct eased values over the flight (0 to
0.415 in the first 34ms — the authored curve's fast attack), the held
state costs zero paints per second, and the texture never repaints for
the lift itself. The 19 paints that do occur during a flight are the
hovered row's `transition-colors` background fade — 150ms at 120Hz,
bounded, honest, over.

One repaint loop caught at the door: shadcn's `Skeleton` wears
`animate-pulse`, an infinite opacity keyframe on a descendant — which
rasterizes correctly and therefore costs one paint and one upload per
frame *forever*. 417 paints before the first screenshot finished.
`animate-none` keeps the shape and kills the loop; the idle contract
(0 paints/s) is the budget every decorative animation has to clear,
and an unbounded one never can.

## the palette belongs to the eye — ⌘K on the viewer slab

Third pose. The chat panel belongs to the room and the sidebar angles
toward it, but a command palette belongs to no panel — it belongs to
the *viewer*, which is exactly what ViewerSurface is for. `cmdk` comes
in verbatim, the palette mounts on the eye-slab behind a `bg-black/40`
backdrop (occlusion that is matter, same as the dialog in inc 3), and a
persistent ⌘K hint chip sits in the slab's corner via `position:
fixed` — the containing-block-not-viewport rule doing chrome layout
with zero math.

The wiring is two document-level listeners. ⌘K works from anywhere
because keydown is delivered to the page regardless of which parked
subtree holds focus — the keyboard never needed forwarding, only the
pointer did. Escape is the interesting one: FocusScene's ladder also
listens for it, so the palette claims the key with `preventDefault` and
FocusScene's `defaultPrevented` gate stands down. Verified: Escape
closes the palette and the camera holds [0, 2, 3.4] to the third
decimal — the ladder never fired.

cmdk holds *native* focus inside the parked subtree, so typing filters
through the texture with no forwarding at all — "mask" narrows the
list to the one matching item. And that native caret turned out to be
the increment's honest cost: an open palette paints twice a second,
the input's blinking caret, a real animation the compositor reports
like any other. Closed, the slab returns to zero. A caret is the
smallest possible violation of the idle contract, and it's not a
violation — it's the contract working: things that are genuinely
animating cost paints, things that aren't cost nothing.

The actions are the demo's connective tissue: Enter on "Ask about the
mask bug" closes the palette, reaches into the chat panel's React root
— a different Surface, a different tree — and streams a reply about
this very bug into the log; "Scroll log to top" moves another
surface's viewport to 0 and confirms with a toast on the same slab it
was invoked from. Three surfaces, three poses, one keystroke touching
all of them. Idle after: 0 paints/2s across every source.

## the corridor — hover grace for a card standing in the room

The last debt on #36: hover-driven detached layers. Hover the chat
panel's avatar and an identity card opens on a FloatingSurface in
front of the panel's upper edge — detached, its own slab, occluding
the panel from the side. Radix hover-card turns out to have no grace
polygon at all, just timers: leave the trigger and a 300ms close is
armed; enter the content and it's cancelled. Pixels apart on a page,
that's invisible. With the content standing in the room, the
trigger-to-card gap is a mouse flight across the screen, and the
geometric grace question #22 said detachment destroys came back as a
race against a timer.

The answer is a corridor in *screen* space — the only space where
"travelling toward that slab" means anything, because it's the space
the viewer's adjacency lives in. A tracker (armed by the forwarder's
synthetic leaves, fed by trusted moves at document capture) holds the
card while the pointer is inside the hull of the padded exit points
and the mesh's projected quad, re-projected every move so orbiting
can't stale it. It never touches Radix — it dispatches the same
enter/leave protocol the forwarder speaks, and the stock timers do
the rest. Exit the corridor and the card closes exactly `closeDelay`
later, the same lag a page gets.

The browser sold two corrections before it passed. A hull anchored at
the pointer's *current* position follows the pointer — its own pad is
inside its own hull by construction — measured as a card that never
closed once the departure burst re-armed the tracker at a parked
position. The anchor must be the previous sample, where the pointer
was when it crossed, and a leave heard with the pointer already
outside the corridor is judged and ignored. And a tracker created at
open-time has no position history, so a fast pointer's first sample —
mid-flight — became the corridor's trigger end and stranded the
return transit; the tracker now lives as long as the surface's
`graceFrom` does. Both are regression tests now.

The ledger, trusted input end to end: park mid-corridor for 900ms —
three close-timer lifetimes — and the card holds; arrive, hold;
return all the way to the trigger, hold; wander off the corridor and
it closes; leave the card downward and it closes; 0 paints/2s
everywhere after every close. Decisions #31. The floating family's
hover story is complete.

## the workbench — three scroll idioms, one seam

A third panel joins the room, angled in from the right: a workbench
with a Tabs strip, a Table of the lab ledger, and a Radix ScrollArea
holding the decisions record. It was built as a stress test of #29's
claim that the forwarder is a *general* scroll engine, not a
message-scroller accessory — and the claim held with zero library
changes. Three idioms now ride the seam: the chat's scroller, a plain
`overflow-y-auto` region around the table, and Radix ScrollArea, whose
viewport hides the native scrollbar behind an inline `overflow: hidden
scroll` (which passes the same computed-style gate as a Tailwind
class) and paints its own thumb as ordinary DOM. The thumb is the
part worth watching: Radix moves it from `scroll` events, the
forwarder's direct mutation fires those natively, so a wheel through
the texture drags a custom scrollbar the compositor has never heard
of. Viewport 0→310px, thumb 0→169.6px, camera frozen throughout, and
the ledger at its bottom refuses the camera three wheels in a row.

Two costs of honesty got measured on the way. A motionless click that
swaps tabs costs 25 paints — not the subtree swap, which is one, but
the registry trigger's `transition-all` easing both triggers' colors
for ~150ms, a bounded burst that ends in silence, same class as the
palette's caret. And the table's sticky header shipped broken: shadcn
wraps every table in its own `overflow-x-auto` container, `position:
sticky` pins to the *nearest* scrolling ancestor, so scrolling a
wrapper outside it carried the header away with the rows. That one is
plain CSS that would bite identically on a flat page — the medium
didn't bend it, which is its own kind of evidence. The scroll region
is now the table's own container and the header holds at offset 0
while the rows slide beneath it.

One process lesson, paid for twice: hand-derived screen offsets lie.
The panel stands rotated away on its far side, so perspective
foreshortens it to ~0.6 screen px per panel px — a click aimed by
linear interpolation from a neighboring landmark missed a 64px-wide
tab. Every aimed point now goes through the mesh's own
`localToWorld → project` math, fresh each run. Idle after all of it:
0 paints/3s across five sources.

## the chart draws the ledger — and collects an old debt

The workbench gains a third tab: a recharts bar chart of the lab's own
measured paint costs, idle's zero bar included. The seam this
increment was named for turned out to be no seam at all — SVG is
ordinary DOM to the rasterizer, and the whole chart (grid, axes,
bars, the animated mount) came through the texture on the first try.
The mount costs a bounded ~70-paint burst — the tab transition plus
recharts growing its bars for a second and a half — and then the
counters go flat, tooltip open or not.

The real find was waiting in a comment. The tooltip appeared on
forwarded hover and tracked the pointer perfectly — recharts hears
`mousemove`, and the forwarder has always sent the move twins — but
it never hid. `crossBoundary`'s header carried a known gap since lab
009: the mouse boundary twins (`mouseout`/`mouseleave`/`mouseover`/
`mouseenter`) were not mirrored, because "nothing in the port listens
for them (Radix is pointer-event native); add them here if a
component ever needs them." Recharts is that component — React
synthesizes its `onMouseLeave` from native `mouseout` — and so the
departure burst was announcing the exit in a dialect the chart
doesn't speak. The forwarder now dispatches one mouse twin after each
pointer boundary event, which is nothing more than what a real
browser does on every crossing. One unit test pins it; the tooltip
now hides on surface departure and internal crossings alike, and the
Radix components hear the twins as the duplicates a real pointer
always sent them. 259 tests. Decisions #19 addendum.

## the handle moves — a drag consumer through the texture

The workbench splits: a vertical `ResizablePanelGroup` (byte-verbatim,
react-resizable-panels v4 underneath), the tabs above, a console strip
below, and a grip handle between them that you can grab through the
canvas and pull. The drag lands in parked coordinates end to end — the
library hit-tests its separator's rect at document capture, computes
deltas from `clientX/Y`, and never learns it is being operated from
inside a texture. An 80-pixel pull moves the layout exactly 80 pixels,
both directions, with the camera frozen; a press on empty space still
orbits.

Getting there surfaced three lies the forwarder had been telling, all
of one shape: a drag consumer listens for the *gesture*, and the
narration kept breaking character mid-gesture. Forwarded moves said no
button was held (hover was the only consumer moves had ever had), so
the drag deactivated on its own first frame — `forwardPointer` now
carries the real `buttons` state. The trusted canvas move told screen
coordinates to the same document listener the forwarded move was
telling parked coordinates to — `trackDrag` now prevents (not stops:
the consumer's front door reads `defaultPrevented`, and r3f's own
delivery rides the propagation) trusted canvas moves while a surface
drag is live. And our own departure burst — built for hover dismissal,
announcing `buttons: 0` from provably outside the panel — fired
mid-drag and was heard as a release, killing the gesture 13 pixels in.
The consumer had asked for pointer capture on every move; we refuse
that capture (parked matter must never hold the real pointer —
`guardPointerCapture` releases it the instant it is granted, or the
canvas goes silent and the pipeline starves itself), so the forwarder
owes the *semantics* of the capture instead: no boundary events, no
position reports from elsewhere, until release. `clearPointerState`
now defers departures while the drag is live and unwinds them when it
ends — up first, boundary events after, the order a real capture ends
in. Deferred, not dropped: the hover state still has to unwind or it
leaks past the gesture.

Verified with trusted input: full-fidelity bidirectional drag, camera
frozen; a trusted press at the parked separator's own page coordinates
does not phantom-drag — the panel library's occlusion filter sees the
canvas painting above the parked group and stands down, which is the
second time a consumer's own defenses have turned out to compose with
the medium unpatched. Idle stays at 0. 266 tests. Decisions #32.

## lab 011 — the toast burns: a shader performs the CSS

The question this lab was built to answer: can a Surface do something
to an element's entrance and exit that no page could? A DOM element can
fade, slide, scale — every exit CSS can express is an affine transform
plus an opacity ramp. It cannot *burn away along a noise field*,
because CSS has no per-pixel program. A Surface's material does.

The seam is two small things. `material="none"` makes the Surface
yield its material slot to its children — everything else it does
(paint-driven uploads, LOD re-rasters, input forwarding) acts on the
texture and the mesh, so it all keeps working under a material the
library has never seen. And `useSurfaceTexture()` hands that child the
live DOM `CanvasTexture` through context — held as state, not a ref,
so the child re-renders when the texture arrives; a `ShaderMaterial`
whose sampler was declared up front needs no recompile, just the
value.

The choreography is the part worth keeping. The toast authors its
motion the way any page would — `animate-in fade-in-0` on a
descendant, verbatim Tailwind. The conductor seizes the animation
before a frame of it paints and hands back the style engine's own
eased samples; the scene maps `value.opacity` onto a `uProgress`
uniform; the fragment shader sweeps a threshold through a value-noise
fbm, discarding beyond the front and rimming it with ember. The
declared curve IS the dissolve curve — an author who swaps
`ease-out` for a bounce has re-choreographed the burn without knowing
the shader exists. Declared as `fade-in-0`, performed as a noise burn.

The economics hold up: the entire lifecycle — enter, hold, exit — is
**8 paints total**, versus ~110 had the two 900ms flights rasterized
at the compositor's rate. The card is drawn once per pole; every frame
in between is the GPU re-reading the same texture through a different
threshold. Measured trace: enter 0.132 → 0.817 → 0.995 → 1 (eased —
0.817 at 53% of the flight is the style engine's ease-out, not ours),
hold at 1, exit back to 0, idle 0 paints after settle, 0 errors.
Decisions #33.

## lab 012 — the glass spike: the world bends through it, the ink sits on it

The liquid-glass direction needed three questions answered before any
shader gets written: can a Surface wear a physically-based transmission
material, does refraction survive multiple levels of glass, and does
the DOM stay live and legible through all of it. All three: yes,
measured.

Architecture — the second consumer of lab 011's material-slot seam. A
glass panel is a `material="none"` Surface on an extruded rounded rect
(flat faces, rounded corner *edges* — a card, not a soap bar) wearing
drei's `MeshTransmissionMaterial`, with the DOM riding a hair-lifted
transparent quad that samples `useSurfaceTexture()` at true UV. The
rule that makes it read as glass rather than soup: **the world bends
through the slab; the ink sits on it and never refracts.**

Research first (three's transmission internals, drei MTM source,
Heckel's per-channel-IOR technique, the 2025 liquid-glass SDF
recipes). The load-bearing fact: three's built-in transmission buffer
renders OPAQUES ONLY — a glass panel behind a glass panel simply
vanishes through the front one, structurally, no knob to turn. drei's
MTM instead hides only itself from its own per-material FBO, which is
why stacked MTM panels can see each other and why it's the shipping
answer for glass-through-glass.

Two defects, both browser-bought, both about what's IN the buffer:

**The ink ghosted behind its own glass.** MTM's hide is a
DiscardMaterial swap on the host mesh — children keep rendering, so
the content quad landed in its own refraction buffer and every label
appeared twice, one crisp, one refracted. Fix: MTM's `buffer` prop
(hand it a texture and it renders nothing itself) fed by a scene-level
coordinator that renders one FBO per panel with that panel's WHOLE
group hidden — glass and ink together.

**The hall of mirrors.** With naive hide-only-yourself buffers, ghost
"Continue" copies appeared inside the pill — via the CARD's
refraction. These are screen-space buffers rendered from the camera,
so the card's buffer contained the pill (which is physically in FRONT
of the card), and the card's glass sampled the pill's image right
behind the pill itself. A panel's refraction must contain only what is
BEHIND it: the coordinator sorts panels near→far and hides
cumulatively — when panel P's buffer renders, P and everything nearer
are hidden. The rear panel still appears in the front panel's buffer;
the front one never appears in the rear's. (Matched detail from MTM's
own pass: buffer renders run under NoToneMapping or glass double
tonemaps.)

The ledger: pill glass visibly bends the password field's outline with
dispersion fringing at the rim — three depth levels in one frame (pill
glass → card glass + ink → wall, all live DOM). **121 fps with both
per-panel buffers rendering every frame; idle paints 0/0/0** — the
glass pipeline is pure GPU and the upload-on-paint contract never
hears about it. Trusted click through the glass landed native focus in
the email field (through EXTRUDED geometry — the ink quad's proper
plane UVs carry the forwarding), typed `glass@lab.dev` with live caret
(52 bounded paints), no ring on the text input (decisions #24's
carve-out), hover twin stamps through glass. Every transmission
parameter is live on `window.__lab012` for tuning.

Cost model to carry forward: one extra scene render per panel per
frame. Fine at 2–4 panels; the shared-buffer variant (one FBO, every
panel samples it) is the documented fallback at scale, and the
screen-space SDF compositor — one render + one full-screen pass, true
multi-level by construction, native squircle-bezel lensing — is the
increment-2 direction for the actual liquid look. Decisions #34.

**Addendum — the fuzzy-edge autopsy.** Pete called the refraction
edges fuzzy, and the fuzz turned out to be three separate things, only
one of them a choice. The spike's buffers were square (768² card, 512²
pill) but MTM samples them with *screen-space* UVs — so a square
target stretched across a widescreen viewport delivers barely half the
screen's horizontal detail to every refracted edge, and it delivered
zero MSAA on top, so geometry edges inside the buffer aliased and the
frost blur smeared the jaggies into mush. Both are undersampling, not
material. The fix answers the question the fuzz raised: **refraction
sharpness is a per-panel budget, not a scene setting** — each panel
owns its FBO, so one mesh can be sharpened (or cheapened) alone. New
default: every buffer matches the drawing buffer, `size × dpr`,
aspect-correct, with 4× MSAA; `__lab012.setResolution(label, px)`
drops any single panel back to a square target live (useFBO resizes
the same render target in place, so the MTM binding and the
coordinator's registration both survive). With frost zeroed
(`anisotropicBlur` 0, `roughness` 0) the refraction resolves
single-pixel grid lines through the glass — the remaining softness in
the default look is entirely the frost knobs, which are taste. Cost of
full-resolution buffers: **120 fps at dpr 1 and at dpr 2** (2560×1440
×2 panels + main render) — the budget doesn't notice. And the 256px
downgrade test showed the architecture's signature: the refracted wall
went mushy while the ink stayed crisp, because the ink never passes
through the buffer at all.

Same session, the other half of "max res": the demo's Surfaces now pin
their DOM textures with a fixed `resolution` — a number disables the
dynamic LOD entirely (the tier-selection branch only runs for
auto/range), so distance never softens the ink and no tier swap can
re-raster mid-shot. Pinned at the library's own ceiling — the highest
ladder tier under the 4096px long-edge guard: card and pill at 6, the
wall at 4. Verified with a close-approach → pull-back → return camera
sweep: zero paints, scales immobile at 4/6/6 — a pinned Surface is
idle-free exactly like an auto one, it just never renegotiates.

Then the reflection the pin earned. Getting to those numbers meant
hand-copying the tier ladder and the 4096 guard into the scene —
duplication of library-private knowledge, which never breaks the
build, it just drifts. So the library learned the word the demo
actually meant: `resolution="max"` pins at the highest tier the guard
admits, resolved per-surface inside the library and re-resolved on
resize — which is the part a helper function could never do, because a
measured Surface doesn't know its size in time to ask. And the audit
caught the prop doc promising what the code didn't deliver: fixed
numbers bypassed the guard entirely (`resolution={6}` on the wall
would have silently allocated a 5280px canvas). Now every form is
guarded — numbers clamp to the exact boundary with a warning, `'max'`
stays on the ladder rung. The scene deleted its copied constants and
says `resolution="max"`; the browser resolves the same 4/6/6.
Decisions #35.

And then the pin exposed what it had broken. Pete: still fuzzy, still
aliased, white halo on the text selection. Both artifacts lived below
the material, in the sampler. First: the no-mips filter policy ("the
tier ladder IS the mip chain") is only true while the tier tracks
density — a pinned 6× texture minified ~4× from across the room is
bilinear soup, and the anisotropy=8 on every texture had been doing
nothing, because anisotropic filtering selects from a mip chain that
didn't exist. Pinned textures now always carry mips + trilinear; the
top level is what gets sampled up close, so the pin's whole purpose is
untouched. Second: the halo was straight-alpha filtering — bilinear
averages raw rgb, and the glass root's `bg-white/10` texels are
full-strength WHITE at α≈0.1, bleeding into every boundary with
opaque content. The ink texture now uploads premultiplied and blends
One/OneMinusSrcAlpha — exact for an unlit passthrough, and under
`material="none"` the ink is the texture's only consumer. Both fixes
verified live-A/B-then-from-code with tight-crop screenshots.
Decisions #36; library-wide premultiplication deliberately deferred
until a floating-layer halo is measured.

**Addendum — the pin loses the argument.** Pete, third round: better,
but the DOM texture still has fuzz close up. The math said why before
the pixels did: a pinned 6× texture viewed at density ~3.5 sits at mip
lod ≈ 0.8, and trilinear spends most of its weight on the box-filtered
half-res level — the mips that fixed the across-the-room aliasing are
now *taxing the close-up*. Auto never pays this tax: a density-matched
tier samples one sharp level, and because the source is a paint record,
"picking the right tier" means *re-rastering the vectors at exactly the
density the screen needs* — which no amount of allocated texels can
beat. Max allocation was never max sharpness; sharpness is a density
MATCH, and matching density is precisely the thing auto LOD does.

The A/B that proved it also caught a bug on the way. First attempt:
HMR the pin off, compare — pixel-identical (max diff 2/255). Not
because the theory was wrong, but because unpinning *did nothing*:
auto landed on the same tier, no realloc fired, and no code path ever
handed the filter policy back — the texture kept its trilinear mips
forever. (Also the capture couldn't have seen it anyway: screenshots
are CSS-sized, so at dpr 2 both mip levels oversupply the evidence
channel. Redone at dpr 1, where capture px = device px.) The clean
A/B: pinned 4/6/6 vs auto 1/2/3 at the same close framing — auto
carries ~6% more edge energy, max diff 74/255, and the crops agree:
grid lines and glyph edges visibly crisper. Surface grew the missing
unpin branch (filter policy restored from the live tier), verified in
the browser at the nastiest case — auto holding the SAME tier 6 the
pin had, `generateMipmaps` false, `minFilter` back to Linear. The
demo's Surfaces ride auto again; the pin remains in the API for what
it actually buys — memory determinism and no mid-shot re-rasters — at
a price that is now measured and written down. Decisions #37.

## lab 012 inc 2 — the glass stops being a mesh

The spike left one thing open, and #34 said so out loud: N panels cost
N scene renders per frame. MTM refracts by sampling a screen-space
buffer, so every panel needs its own, with itself and everything in
front of it hidden — plus the ordering rule that keeps a panel from
refracting things it stands in front of. Increment 2 pays that debt by
deleting the geometry.

**What a panel is now.** Nothing. The mesh survives only as something
to raycast: `material="none"`, a plain quad, `material.visible =
false` — three skips the draw call in `renderObjects`, the raycaster
never looks at the flag, and pointer forwarding keeps the proper plane
UVs it has always needed. The pixels come from somewhere else
entirely. Once per frame the scene renders into one HalfFloat target
with a depth texture attached; then each panel is a full-screen pass
that, per pixel, rebuilds the eye ray, intersects it with **that
panel's own plane**, and evaluates a rounded-rect SDF in panel-local
2D. The panel keeps an arbitrary 3D pose — the distance field lives in
the panel's frame, not in screen space, which is the difference
between a UI trick and something you can orbit.

Everything falls out of the distance. Coverage is
`smoothstep` across `fwidth(d)` — exact analytic antialiasing, no MSAA
on the panel at all. The bezel is a height field *over* the distance
(a quarter-circle profile rising from the outline over `bezel` world
units), so the lens normal is the SDF's gradient tilted by that
profile's slope: a rim with no vertices in it, no `curveSegments`, and
a corner radius that is a uniform rather than a rebuild. Refraction
walks the bent ray a short distance and re-projects it to screen — one
loop buys dispersion and frost together, each tap stepping an ior
across `ior ± chroma` while jittering on a golden-angle spiral.

**The ordering rule from #34 is gone, not reimplemented.** The passes
ping-pong far→near, so a panel samples the composite of everything
already laid down behind it — glass, ink and world. Multi-level
refraction stopped being a feature and became the shape of the loop.

Two things the shader got wrong, and looking fixed both. The frost
*widened* toward the rim, which turned every bezel into a soft white
halo — exactly backwards: frost belongs to the flat glass, and the rim
is where the lens does its work, so the profile now eases off as the
bezel takes over. And the hairline was 55% of the bezel wide, which is
not a hairline but a chunky white border; at 14% it reads as an edge.

**The cost, honestly.** At the lab's own size both paths sit on vsync
and are indistinguishable — 8.3 ms, 120 fps, either one. The
`EXT_disjoint_timer_query_webgl2` numbers are worse than useless here:
GPU-ms *fell* as triangle count rose 100×, so the query is pacing with
the frame, not with the work. What does hold is the submission ledger,
identical in shape at every scene size: **MTM submits 1.95× the draw
calls and 1.95× the triangles.** Empty scene, 41 calls / 105 k tris
against 20 / 42.8 k. With 200 ballast knots, 1 523 / 9.21 M against
782 / 4.72 M. (The ratio is under 3 because drei's `ContactShadows`
renders the scene too, and both paths pay it.)

Push past the vsync ceiling and the ledger turns into frames. At 1 600
ballast knots — 72.5 M triangles a frame for MTM against 37.3 M for the
compositor — MTM falls to **102 fps** while the compositor is still
pinned at **119.9**. The win was never the intercept; it's the slope.
MTM's cost is panels × scene, the compositor's is panels × pixels, and
a UI scene is small and a viewport is fixed.

What had to be earned back: occlusion. The mesh path got it free from
the depth buffer; the compositor rejects per pixel against the
resolved depth texture instead. Verified by parking the torus knot in
front of both panels — glass and ink cut exactly at its silhouette,
both visible again through its holes. And the thesis survived the
rewrite intact: a click at the projected screen position of the email
field landed native focus on `#l12-email` through an invisible proxy,
typing came out crisp on the glass, and after blur the card's paint
counter froze at 107 across four seconds. Idle Surfaces still cost
nothing; the caret's ~2 paints/s while focused is the only traffic.

Both paths stay live and switchable — `?glass=mtm`, or
`__lab012.setMode('mtm')` — because the comparison is the evidence.
Footnote paid on the way past: three already forces `NoToneMapping`
for any render into a target (`WebGLPrograms.js:176`), so the spike's
manual save/restore was belt-and-braces. The compositor leans on it
deliberately — every pass runs in linear HalfFloat and tone mapping
happens exactly once, in the blit. Decisions #38.

Still open, and now cheap: the *liquid* part. Two panels that merge
instead of overlap is a smooth-min union of two distance fields — a
handful of lines in a shader that already speaks distance, and
impossible in the mesh path at any price.

## lab 012 inc 2b — the glass learns to merge

The last paragraph was a promise, so: three circles sharing the sign-in
card's plane, unioned into its field with a smooth minimum, orbiting on
an ellipse whose radii breathe. Each bead cycles the whole range —
swallowed by the card, grazing it with a neck stretched between them,
free and refracting the wall on its own.

`smin` is six lines and everyone has seen it. What the lab wanted to
know is what it costs to make it *the card* rather than a decoration
next to it, and the answer turned out to be three things, none of them
the union itself.

**The gradient has to come from the merged field.** The bezel is a
height profile over the distance, and its normal is the SDF's gradient
tilted by the profile's slope — so an analytic `sdRoundRectGrad` that
only knows the rectangle gives the merged shape a rim that goes on
believing it is a rectangle: the neck stretches out with no lens in it,
a flat smear where the interesting curvature is. A central difference
on the *unioned* field is four extra evaluations and it is what makes
the two read as one body of glass — through the neck the normal turns
continuously from card to bead, so the refraction does too. Only
covered pixels pay it; the coverage and occlusion early-outs are above.

**The ink is clipped to the rect, not to the coverage.** A satellite
that has merged into the card is glass with nothing written on it. Left
clipped to coverage, the sampler's clamp-to-edge smears the card's
border row of texels out across every bead — the DOM would flow into
the merge, which is exactly backwards. The panel's texture belongs to
the panel's rectangle; the glass is free to be any shape it likes.

**And it is not a Surface.** A bead has no DOM, so it never enters the
paint budget, the raycast proxy, or the registry — it is three floats
in a uniform array, mutated in place by a `useFrame` that costs no
React render. Paint counters across the whole animation: wall frozen at
23, pill at 54, card at 1/s and that is the caret. The liquid is free
of the upload-on-paint contract by construction, because it is shape,
not surface.

Cost, measured 0 / 3 / 6 beads: 8.3 ms median all three, pinned to
vsync at 120 fps, one draw call and two triangles. That proves no
regression rather than headroom — this scene is nowhere near
fill-bound — but the shape of the cost is the point: a bead is a few
ALU ops inside a pass that was already running, and adding one changes
no draw call, allocates nothing, and touches no geometry.

The two meshes could only ever have overlapped. You would have seen two
rims crossing, and the fix would have been a remesh per frame. Two
distances merge, and the merge is an equation. This is the first thing
in the lab that the mesh path could not have done at any price, rather
than done more expensively — which is the real reason the glass stopped
being geometry. Decisions #38.

## lab 012 inc 2c — the ripple had to earn it

First attempt at a contact ripple was a gaussian packet with a fixed
wavelength, translated outward at a fixed speed. Pete's verdict, and it
was right: *a bit tacked on*. Worth writing down exactly why, because
the reasons are all physical and none of them are "needs more polish".

**It didn't weaken as it spread.** A circular wave on a sheet pushes its
energy through a front of circumference 2πr, so the amplitude must fall
as 1/√r. Ours only decayed with age, so it arrived at the far edge as
strong as it left the contact. Nothing on a real surface does that, and
the eye knows it immediately even when it can't say why.

**It didn't disperse.** A rigid packet translated at constant speed is a
decal being scrolled. A real impact ring *stretches*, because different
wavelengths travel at different speeds. At this scale the regime is
capillary — surface tension, not gravity — so ω = C·k^(3/2), the group
velocity is (3/2)·C·√k, and SHORT waves lead. Feed the stationary-phase
condition r = v_group·t back into the phase and the entire train
collapses to one expression:

    theta(r,t) = K r^3 / t^2,   k(r,t) = d(theta)/dr = 3 K r^2 / t^2

Two lines in the shader. The pattern is then self-similar along
r ~ t^(2/3): measured across a run, the front travels
0.16 → 0.48 → 0.88 → 1.54 world units while the wavelength grows
0.29 → 0.37 → 0.45 → 0.58. The wave slows down and coarsens *together*,
which is the thing a fixed-wavelength packet cannot fake at any
amplitude. (The two expressions are consistent by construction — the
derivative of the phase must equal the stationary wavenumber, which is a
free correctness check, and it was run before either was typed.)

**It ran over the rim.** The bezel is a thick edge, not a membrane. The
wave is masked by the bezel coordinate so it dies into the rim instead
of wobbling the one hairline that has to stay crisp.

Two more things fell out of taking it seriously. A delta impulse makes
the first frames *sixteen times* more violent than the last — the ring
arrives as a crack and then behaves. But a bead is not a point and
cannot radiate wavelengths shorter than itself; a gaussian source
spectrum keyed to its radius flattens the run to a smooth 0.73 → 0.06
decay with no hand-drawn ramp anywhere. And waves break: past a certain
steepness a surface stops being a graph over the plane, so a soft
saturation replaces the early frames that would otherwise fold the lens
inside out.

The impulse itself is closing speed × bead radius, sampled at the
contact frame. That has a nice consequence for authoring: making the
orbit livelier doesn't make the ripples bigger because a knob was
turned, it makes them bigger because the beads arrive with more
momentum. Measured across the change — merge impulses went 0.36–0.73 →
0.62–0.94 from one edit to an orbit rate. Releases stay smaller than
merges without being told to, because separation is gradual where
contact is sudden.

Cost is unchanged and the contract holds: 8.3 ms median, vsync-pinned at
120 fps, one draw call, two triangles — and across 3.2 seconds of active
rippling the paint counters did not move (wall 1, card 48, pill 5). The
whole liquid simulation is uniform traffic. Nothing about it touches the
DOM, which is also why the ink stays crisp: the wave warps the glass and
the world behind it, and the text sits on top unbent. There is a knob to
warp the ink too (`rippleInk`), left at 0 — the thesis is legibility.


## lab 013 — the card tears into an app

An auth card, a Sign in, and then the card *becomes* the interface: it
stretches, necks, snaps, and what is left is a 1/6 rail and a 5/6 pane
with thread rows welling up out of one and message bubbles out of the
other. It is a chat client, and every rectangle in it is a term in a
distance field.

The thing that made this possible was not new refraction. It was
noticing that a screen-space glass pass is priced per *plane*, not per
piece of glass, the moment the field can hold more than one shape. Teach
`fieldAt` a rounded-rect satellite array and the rail — a header and five
threads — becomes one pass. Teach it that the DOM's rectangle is a
separate uniform from the field's shape (`uInkRect`) and the rail's five
rows become one 240×800 texture, one element, with the gaps between rows
showing the world because the ink is weighted by the field's own coverage
and there is no glass there to carry it. No clipping. No masking — which
is forbidden in this project anyway, since a `mask-image` anywhere in a
drawn subtree blacks out the entire capture. The coverage term was
already sitting there being computed for the edge antialias.

Four planes for the whole app: shell, rail, transcript, composer. Send a
message and the transcript's field gets one more term. That's the cost.

**The split had to be a shape, not a layout.** Both panes start as the
same rect, because a smooth-min union of two identical distances is that
distance dilated by k/4 — a pixel and a half at rest, invisible. So frame
zero is a card and the shader does not know it is about to become an app.
Then the two rects walk to their ends on deliberately different curves:
the height goes first, and the sideways tear starts 16% later and finishes
last. Run them together and it reads as a rectangle being scaled. Stagger
them and it reads as something being pulled apart, because that is the
order in which real things fail.

And the blend radius is animated across the tear —
`0.035 + 0.42·sin(π·u)^0.8`, up by more than a factor of ten and back
down. That's the whole trick. Without it the two panes cross-dissolve
past each other; with it there is a visible ligament between them that
thins as they separate. The frame the gap stops being bridged, the
ligament has snapped, and two ripples go out from where it was. Nothing
authored that moment — it's the same geometric test the beads in lab 012
used to detect contact, read backwards.

The ripples needed one honest retune. `rippleK` is a scale knob, and the
capillary front sits at r ≈ (2πt²/K)^(1/3), so a shell two orders of
magnitude wider than a card needs K ≈ 0.5 where the card wanted 3.0. That
is a derivation, not a taste adjustment, and it landed first try.

**And then a real bug, which is the best part of the lab.** The rail's
text came out smeared — stretched horizontally, ghosted, badly aliased —
while the transcript six inches to the right was crisp. Same shader, same
frame, same texture path. Three hypotheses went into the ink path and all
three died: `__threeUI.stats()` said `scale: 1` on every panel, so it was
not an LOD tier; zeroing chroma, roughness and spread left the smear
untouched, so it was not refraction; and dumping the rail's parking canvas
through `toDataURL()` and decoding it locally showed a *pixel-perfect*
240×800 rasterization with the glyph metrics exactly where they were
authored. The DOM was innocent, the sampler was innocent, and the pixels
on screen were still wrong.

The fault was two files away, in the compositor's sort. Panels are
composited far to near, and the key was `camera.position.distanceTo(...)`.
Distance and depth agree only near the view axis — which is precisely
where lab 012's two panels sat, so the wrong key shipped and passed. Put a
rail 3.5 units off-axis at a viewing distance of 7.4 and it is farther by
Pythagoras (8.09) than the shell it is in front of (7.40). It composited
first. The shell then refracted the rail's already-composited ink through
its eight dispersion taps, which is exactly what eight ghosts of every
glyph look like. The tell was there the whole time and I read past it:
nothing in the ink path has eight of anything.

The fix is one line — sort by view-space z — and it is worth writing down
as a general shape. The painter's algorithm orders by *depth*.
Distance-to-eye is a different quantity that is merely monotonic in depth
inside a narrow cone. Any sort that reached for the easy one and was
validated on a centred scene is carrying this bug and does not know it.

Measured with the app open, a thread selected and messages sent: 120 fps
vsync-pinned, and across two seconds of live scene the paint counters on
all five sources moved by exactly zero. Signing in, tearing the card,
growing six rows, welling up four bubbles and ringing the shell is all
uniform traffic — the DOM is never told any of it happens. Clicking into
the composer at raw screen coordinates focuses a real `<input>` that lives
in a parked canvas and has never been in the visible document, and typing
into it repaints only that one 1152×92 texture.

## lab 014 — the page has a third dimension

Every lab up to here built a *scene*: a canvas that owns its rectangle, and
DOM that lives inside it as matter. Lab 014 turns that inside out. It starts
from an ordinary page — a two-column board of task cards over a few hundred
words of prose, scrollable, selectable, tabbable, styled with nothing but a
plain stylesheet — and gives it a third dimension it can borrow when it wants
one. Press a card and it peels off the page: the same component, still live,
now a rigid plate with real inertia hanging off your pointer and casting a
real shadow back down onto the paragraph it came from. Let go and it flies
into whatever slot you were over, the document reflows around it for real,
and it lies back down as ordinary DOM.

The whole thing rests on one line of camera setup. Put the camera at
`(viewportHeight/2) / tan(fov/2)` and the plane `z = 0` *is* the viewport,
exactly. A card's `getBoundingClientRect()` is then already a world pose, and
there is not one conversion function anywhere in the lab. Everything
downstream follows for free: lifting a card toward the camera is honest
perspective, so it gets bigger because it is nearer, and the LOD ladder
re-rasterizes it sharper on the way up because it genuinely covers more
pixels. A "1 px" spring constant in the physics file is a real pixel.

**Nothing is ever moved.** The obvious implementation — reparent the card's
DOM into the parked canvas — cannot work, because React's event delegation is
rooted at the React root container: a node moved out of `#root` stops
receiving synthetic events, and the controlled `<input>` inside the card goes
dead the instant you pick it up. So the page copy does not go anywhere. It
turns `visibility: hidden`, which keeps its box (the layout does not twitch,
and the slot is already exactly the right size to be a drop target), while a
second React root renders the *same component from the same state* into the
parked subtree. For the two frames where both exist they are pixel-identical
and in the same place, so there is no flash to hide and no freeze-frame clone
to make.

The physics is a rigid thin plate, and the reason it has to be one is the
swing. Grab a card by a corner and pull, and the card must rotate — that is
a lever arm between where the hand is and where the mass is, which is a
torque, and a torque needs an orientation to act on. `Ixx = m·h²/12`,
`Iyy = m·w²/12`, so a wide card resists yaw four times as hard when you
double its width, and that is not a tuned feel, it is the aspect ratio.

Two bugs in that file are worth keeping. The first is a **units** bug that
only exists because the world unit is a pixel: the fingers' restoring torque
was being divided by the inertia tensor like any other torque, and at pixel
units a 320-wide plate has `I ≈ 8533`, so a gain that felt right in the
abstract was four orders of magnitude too small and a tilted card took eight
seconds to lie flat. The fix is a distinction worth naming — **the lever is
physics and the fingers are a servo.** The lever is a real torque and pays
the inertia tensor, because a big card really should swing lazily. The
fingers are specified as an angular frequency and applied as angular
acceleration directly, never touching the inertia, because a hand does not
grip a large card more limply than a small one, and any gain expressed as a
torque says that it does.

The second was **roll blindness**. The restoring term crossed the plate's
normal with the target normal, which is cheap and wrong in a way that only
shows up at rest: the cross product of two normals cannot see rotation
*about* the normal, so a card set down with a 6° in-plane twist stayed
twisted forever — zero error, zero correction, a perfectly stable wrong
answer. Fingers hold an orientation, not a direction, so the error has to be
a full quaternion error, with the shortest-arc sign handling that comes with
it. And a third one that was mine rather than the code's: a test asserting
that the *centre* settles at the hand failed at 183.57, which is exactly
`hypot(160, 90)` — the spring pulls the *grab point* to the target, and the
centre is one lever arm away by construction.

**The canvas is only solid where there is matter.** The overlay is
`pointer-events: none` at rest — a canvas stretched over somebody's document
must not be able to eat a click, a text selection or a scroll — and is
switched to `auto` for exactly as long as a raycast says the pointer is over
an airborne card. That is decisions #20 one level up: hit-test first, then
decide whether you are there at all. It is also enforced twice, because r3f
writes `position: relative` *and* `pointer-events: auto` onto its own wrapper
div as **inline** styles, and inline outranks any class. That cost two
separate bug hunts. First the overlay was laid out as an ordinary block after
the article, a full viewport below the fold — the scene graph probed
perfectly correct the entire time, camera, size, matrices, both programs
compiled, and it was simply somewhere else. Then, once it was in the right
place, an invisible full-viewport div sat over the whole page swallowing
every `pointerdown`, so no card could be picked up at all and nothing
anywhere reported an error.

The gesture that makes the point is the **tap**. A card you have to keep the
mouse button held down on is a card you cannot click *into*, so a press that
does not go anywhere (< 6 px, < 320 ms) parks the card in mid-air instead of
sending it home. It hangs there, still solid, still a live DOM subtree: you
can put the caret in its note field and type, 96 px off the page, while it
casts a shadow on the prose below it. Tap again or press Escape and it flies
back. The float anchor rides the scroller, too — a card hanging over a
particular paragraph has to keep hanging over that paragraph, or its shadow
slides off the thing it is supposed to be falling on, which reads as fake
instantly.

Two smaller lessons, both about things being outside something. The airborne
card's DOM is in the same *document* but nowhere near the page's root
element, so every `.l14-*` class rule still matched and every custom property
scoped to the page container silently did not exist. The tell was tiny and
exact: the card kept all of its own colours and lost precisely the two
declarations that read a variable — the tag went from blue to grey at the
moment of liftoff. Inherited context is a dependency, and a component that
can be rendered somewhere else has to carry its own. And the release listener
was registered in an effect keyed on the flight state, which does not run
until React commits the render that `pointerdown` scheduled — later than a
quick tap's `pointerup`, so the listener that was supposed to hear the
release did not exist yet.

Measured, headed, at 1600×1000: with nothing in the air the overlay renders
**zero GL frames** and holds zero programs — `frameloop` is `demand` until a
card is airborne, because an overlay across somebody's document does not get
to burn a frame every 8 ms for the privilege of being empty. With a card
flying it is 120 fps vsync-pinned at two draw calls and four triangles. An
eight-move drag with a swing, a throw across columns, the reflow and the
landing cost **zero** rasterizations — a card's entire physical life is
matrix traffic, and the DOM is never told any of it is happening. The only
things that repaint are the things that actually change: about 2.4 paints per
keystroke, and a steady ~2.5/s while the caret is blinking in a floating
card, which is a real DOM repaint honestly reported rather than a leak.

The loop closes in CSS. The physics writes `--l14-near` onto the slot it is
aimed at, and the slot's `color-mix()` reads it — so a rigid-body simulation
running in WebGL is restyling real DOM through an ordinary custom property,
at the same time as that DOM is being rasterized into the material of the
thing doing the simulating.

Then Pete dragged a card and said it jittered — *"like something is fighting
the drag event."* Three suspects, and the two obvious ones died on the
instruments: frame timing was clean (`dt` p05 7.6 ms, p99 9.3 ms, no drops),
and a thirty-move drag caused six React renders and one FLIP, so the
reflow-during-drag feedback loop I was braced for was not happening either.
With the pointer perfectly still, angular velocity was flat zero for 266
consecutive frames. Nothing was oscillating.

The projection told the story. Camera at z = 937.8, card held at z = 96,
cursor at (900, 600) — and the grab point rendering at (929.7, 627.4). The
drag target was being computed as `(clientX − vw/2, vh/2 − clientY)`, which
is the identity from the calibration above, and the calibration is true on
**exactly one plane**. The lift plane is magnified 1.08×, so a hundred pixels
of hand became a hundred and eight pixels of card: zero error at the screen
centre, tens of pixels near the edges, reversing sign as you cross the middle,
and *still ramping* for 0.22 s after the hand stopped while `z` eased 0 → 96.
You correct, it overshoots, you correct again. Not a fight — a gain.

The galling part is that this repo has had the rule since lab 002: **intersect
the ray with the drag plane, never take the hit point.** Lab 014 obeyed the
letter of it and intersected the wrong plane. The fix is a module that owns
the calibration so `PixelPerfect` and the drag cannot disagree about where the
camera is, plus `screenToPlane(...)` — the general ray∩plane written as a
single division, because a calibrated camera looking down −z makes it one.
Its test quantifies the old error at the centre and at the edge, proves it was
a pure gain rather than an offset, and checks the shortcut against a real
`THREE.Raycaster` so the fast path can't quietly become a second answer.
Measured in the browser afterwards, the grab point lands on the cursor to
0.0 px at (640, 360), at (200, 150) and at (900, 600).

What I want to remember is the shape of the report. "It jitters" and "something
is fighting it" are what a *velocity* error feels like from the outside, and my
first three hypotheses were all about things that oscillate. A constant 8%
overspeed feels exactly the same from the driver's seat, and the only way to
tell them apart was to stop watching the motion and project a single point.

Then Pete dragged a card again: *"it still changes position erratically and
doesn't stay anchored to the cursor."* Two reports, two different bugs, and
the first fix was real — it just wasn't the whole thing.

This one is embarrassing in a useful way. Every test in `lab014Plate.test.ts`
passed, and every one of them measured where the card came to **rest**. A
system with any amount of tracking lag passes a test like that. So the first
thing I wrote was a test that drags a hand in a straight line and asks where
the grab point is *while it is moving*, and it reported 44.6 px of lag at
500 px/s, 89.3 at 1000, 178 at 2000 — a tenth of a second of travel, whatever
that happened to be worth.

The line:

```js
_pointVel.copy(plate.w).cross(_r).add(plate.v)   // ← relative to WHAT?
_f.addScaledVector(_pointVel, -g.kd)
```

A damper connects two bodies and resists their relative motion. That one names
one body, so the other end is bolted to the world: a card dragged through
treacle by a hand nailed to the floor. Treacle needs a standing force to push
through, a spring can only make force out of displacement, so the card sits
`kd / ks` seconds of travel behind the cursor — 98 ms of it, which at a normal
drag speed is a hundred pixels. With a lever it is a phantom torque too, so the
card also flew at a permanent speed-dependent tilt. Both scale with speed and
both reverse when you turn around, which is why it never read as lag. It read
as the card having opinions. The fix is `.sub(handVel)`.

Two things fell out that I value more than the fix. First: **the smoothing
constant on my own velocity estimate was most of the remaining error.** One
time constant of smoothing tells the damper the hand is slower than it is by
`τ·a`, and the spring pays for that too — total error `(m·a/ks)·(1 + kd·τ)`,
which at 41 and 45 ms made the surcharge nearly twice the honest compliance.
Second: **the gains were secretly coupled to the frame rate.** Stiffening the
grip made the anchor firm and made the whole thing diverge at 60 Hz, because
the term that runs out of integrator headroom first isn't the spring — it's the
lever turning the grab point's damper into an angular damping rate of
`grip·kd·|r|²/I`. The physics timestep is fixed now and the frame rate only
picks how many substeps to take, which is what made the retune safe.

And the retune is the actual lesson. Stiffening the grip buys anchoring and
costs *nothing* in character, because the lever torque is `grip · (r × F)` and
at any sustained acceleration `F ≈ m·a` no matter how stiff the spring is.
Position and swing are separate knobs — but only once a phantom drag force
stops setting `F`. Before, they were the same knob, which is why the lab felt
like it had to choose between tracking the cursor and having weight.

Measured in the browser, one pointer sample per frame across a 480-frame
lissajous, median error in four speed buckets: **26 / 47 / 74 / 123 px →
4.9 / 5.0 / 5.3 / 7.1 px** — and flat instead of proportional, which is the
signature that matters. Unchanged with the pointer polling at half the display
rate. The screen-space throw estimator got deleted on the way past: the
world-space hand velocity the damper needed is the same number, already in the
right units, without the `screen-y-is-down` sign flip the old one carried.

Both bugs in this lab were the same mistake at different scales. The first
answered "where is the cursor" on the wrong plane; the second answered "how
fast is the card moving" relative to the wrong body. Neither is a physics
error you can see by reading the physics — you have to name the frame out loud
and ask whether it is the one you meant.

Then Pete dragged a card a third time: *"it seems to jump towards the top left
of the screen, sometimes even getting stuck there as long as I move my mouse
in a particular way while dragging and then keep it stationary."* Not a
physics bug at all this time — and the evidence had been in my own traces
twice, dismissed twice.

The lab's flight gesture listens on `window` for the hand. But in this
codebase `window` is a party line. The surface pointer protocol *retells*
pointer events into a card's parked DOM subtree — that is the entire reason a
card you hover in WebGL shows `:hover` — and those retold events bubble back
up to the same window, on purpose, because Radix listens for them on
`document` and builds its grace areas out of them (#19/#20). The parked host
is fixed at page (0, 0), so parked-*local* coordinates **are** coordinates
near the screen's top-left corner. And every exit fires the three-frame
departure burst at `(−16, −16)`. One wiggle-and-flick drag put **32 forged
moves** on my window listener, each one read off as the hand. Card flies to
the corner. When the burst happens to land *last* and the mouse then goes
still, nothing ever corrects it — "stuck there as long as I move my mouse in
a particular way" is a bug report of event *ordering*, stated more precisely
than my first two hypotheses managed.

During the damper hunt those `(−16, −16)` entries were sitting in my debug
traces and I wrote them off as "harness artifact — pointer leaving the
window." Twice. The number was the answer, printed, both times:
`AWAY_MARGIN_PX = 16` was one grep away. When a "harness artifact" contains a
suspiciously specific constant, grep for the constant.

The fix is one line of question: `if (!e.isTrusted) return`. The user's hand
is the only pointer that can say trusted — the platform stamps it, and a
constructed event cannot lie about it through any dispatch path. The window
half of the gesture moved into `lab014Gestures.ts` where happy-dom can test
it, and happy-dom turned out to be the perfect forger: it constructs every
event with `isTrusted: false`, exactly like the library. The test replays the
captured Chrome sequence verbatim — hover retold at (256, 38), then the
triple burst — and asserts the drag target never moves. Red run, guards
commented out: `expected -16 to be 700`. The same guard went on the raycast
handler that decides whether the canvas is solid, and *didn't* go on the
Escape handler, because the library forges no keyboard — typing through a
surface is real focus and real keys (#24).

Verified in a fresh session: the forgeries still flow (ten on window in one
drag — they are load-bearing and this fix doesn't touch them), the card sits
at the cursor plus the hold offset to the pixel, burst-last-then-stationary
leaves it exactly there, and reflow, tap-to-float, regrab and Escape all
still work. Decision #50.

Three reports, three bugs, one family. Wrong plane, wrong body — and now
wrong *speaker*. The first two were frames of reference; this one is
provenance. A library whose whole premise is retelling events through glass
had, of course, built a second voice into the page, and a listener I wrote
assumed there was only ever one. The question every window listener here has
to ask isn't "where is the pointer" — it's "*whose* pointer is this."

## the hardening pass — provenance becomes architecture

Pete asked whether #50 deserved library-level hardening. The tempting answer
was to stop the forgeries from reaching window at all — and it is exactly
wrong, twice. Radix's grace areas are *document* listeners; the bubble is
load-bearing (inc 2a was the measured proof). And `isTrusted` can't be
granted to our events by any dispatch path, so the library cannot make its
voice honest — it can only make it *identifiable*. Hardening here means
discipline, not rerouting: every synthetic event leaves through one door,
every page-level listener states which voice it wants, and tests pin both.

The audit found the listeners already correct but *implicitly* — each one
now carries its stance in a comment. Three stances exist: trusted-only (the
position feeds: `trackDrag`'s arbiter, `hoverGrace`'s corridor), forged-only
(`FocusScene`'s document click — structurally safe, because a *trusted*
click targets the canvas, which lives in no composite root), and
trusted-by-vocabulary (keyboard and focus — the library forges no keys, and
`el.focus()` fires trusted focus events even from inside a synthetic click
handler, which is the kind of fact you want written down before you need it).

Then the audit found a bug nobody had reported. OrbitControls attaches a
document `pointermove` listener for exactly the duration of its own drag and
does raw delta math on whatever arrives — no provenance check, and our
forgeries share its pointer identity. Orbit from empty space, sweep the
cursor across a panel edge, and the forwarder speaks: hover retelling at
parked coordinates, departure burst at `(−16, −16)`, each one silently
poisoning `_rotateStart`. Proven live before fixing: a 10 px hand move threw
the camera from `[8.65, 1.75, 2.68]` to `[4.09, 7.25, 5.59]`. A user would
have reported it eventually as "sometimes the camera teleports"; nobody
would ever have reproduced it on demand.

The fix is not a guard on OrbitControls — #50 already concedes we can't
patrol other people's listeners. It's capture semantics, which the forwarder
was enforcing from the inside while violating from the outside. #32 says:
while a drag is *ours*, other surfaces' departures defer. The mirror rule
says: while a drag is *not ours*, we are not a participant — a held-button
move that began off-surface forwards nothing. One line in `forwardPointer`,
and the entire class of listeners-that-only-exist-during-foreign-drags goes
quiet. Decision #51, with one open edge noted there rather than fixed blind:
during *our* drag, moves still route by ray hit rather than retargeting to
the captured surface.

The door itself is `src/lib/forged.ts`: `forge(target, ev)` brands and
dispatches, `isForgedEvent(ev)` answers — exported, because the `isTrusted`
guard has a hole exactly where accessibility middleware and test harnesses
live, consumers whose input is legitimately untrusted and who need to reject
specifically *our* voice. The brand is `Symbol.for`, not a module-local
symbol, because this repo has already measured a dev server holding two
instances of one module across an HMR reload (the toast that never appeared)
— a local symbol would quietly split into two unequal brands.

Eight new tripwires pin the contracts: the forged vocabulary
(pointer/mouse, boundary, burst, wheel, change) reaches document *branded*;
leave/enter stay non-bubbling; a foreign-drag move forwards nothing and
hover resumes on release; and the one that will matter in a year — the
departure burst must keep bubbling to document, so the next "simplification"
that stops it fails in CI instead of in every consumer's tooltips. 304/304.

## the card is born blurry — a texture's first frame is a prior

Pete: *"when you begin to drag a card, the card content becomes jarringly
blurry."* The handoff (#46) hides the browser-rendered page copy on the
exact frame the texture is revealed, so whatever the texture looks like on
its first frame is a hard cut from full device density. And its first frame
was tier 1: the LOD seed picked the ladder tier nearest 1×, because when
the first raster runs the mesh has never been projected and true density is
unknowable. On a retina display the card demands ~2.23 texels per CSS px
(dpr 2 × the 1.114 lift-plane magnification), so the reveal was a 2.2×
bilinear upscale, and the Schmitt trigger's agreement window meant the
corrective re-raster landed ~130ms later (measured under dpr-2 emulation:
born at scale 1, tier-3 swap at +130ms). Sharp → soup → pop, every grab.

Two fixes, one per side of the library line. The library now seeds dynamic
LOD at the tier nearest the *renderer's pixel ratio* — birth density is a
prior, and with world ≈ CSS px being the house calibration (#44), dpr is
the informed one. Every consumer inherits this: lab 009's panels now come
up at tier 2 on retina and relax to their measured ~1.5 within two
seconds, instead of coming up soft and sharpening while you watch. And the
lab pins its flight card outright: held or floating, the card sits on the
lift plane under a static camera, so its density is not a guess but a
constant — `dpr × planeScale(camZ, LIFT_Z)` — and a pinned Surface is born
at its final scale. Verified: born at 2.22807 (the prediction, to six
decimals), zero tier swaps, two paints for the whole grab, and no frame in
the card's airborne life below full density. Decision #52: guessing
machinery should only run where there is genuinely something to guess.

## still blurry — because the blur was never the tier

Pete, after all of that shipped: *"hm it looks exactly the same to me,
still a stark difference in clarity."* The pin was real — stats reported
2.22807, zero swaps — and it didn't matter. The lesson sits at the top of
this entry as a correction to the last one: supply was never the dominant
term. Cue the instrument this lab should have built first: copy the flight
card's source canvas into the page (`drawImage` to a probe canvas shown at
1 canvas px = 1 CSS px, `image-rendering: pixelated`), so a single
screenshot holds the texture's actual texels, the mesh rendering those
texels, and resting DOM, side by side, then read all three at 4×
nearest-neighbor. The texels were crisp — `drawElementImage` rasterizes
perfect glyphs at fractional scales; capture was innocent all along. The
same texture on screen was fat and smeared. Everything wrong was
downstream of a perfect raster.

Three convictions. First: a *tapped* card never reached the lift plane.
The float anchor keeps whatever z the plate had when the fingers let go —
a 100ms tap releases mid-rise at z ≈ 20 — so the card hung there forever,
573 texels squeezed into ~515 screen px, 11% minified. The 4× crops
measured it directly: the on-screen glyphs were 11% smaller than the
texels. `carryToPlane` now finishes the climb the tap interrupted, along
the anchor's own line of sight, so it rises in place instead of sliding.
Second: even at exactly 1 : 1, a mesh at a fractional screen position
resamples every texel at that fraction — bilinear at half-phase is a two-
pixel box blur, the fattened-fuzzy look in every "held still" screenshot.
And third, the grab moment itself: the texture was born at *altitude*
density, so the #46 hard cut minified it into the resting rect on the
exact frame crisp DOM vanished beneath it. Jarring, one frame after
perfect, precisely where the eye was pointed.

The fixes are #53's three-part answer. The pin became a *schedule* —
page density on the page, altitude density at altitude, toggled by the
driver on the plate's actual z — so both handoffs (grab and landing) are
pixel-for-pixel copies of the DOM they exchange with, and cruise is
exactly 1 : 1; two re-rasters per round trip, both hidden inside motion.
And at rest, the *presentation* quantizes: when plate speed dies, the
group — never the plate, same truth/presentation split as the grounded
damper — glides onto the device-pixel grid, footprint set to exactly the
texture's texel count, corner on an integer device pixel, residual tilt
slerped flat. Bilinear degenerates to the identity map. A moving card is
pure physics; a resting card is pure grid; the blend is plate speed, so
nothing pops.

The bisect also caught a fourth thing that was never blur: the gloss
shader sampled the sRGB texture (which the GPU hands over as linear) and
wrote it back out raw — linear values into an sRGB canvas, every AA
midtone sunk, the card's text darker and heavier than its own pixels.
One line — `#include <colorspace_fragment>` — and now a new hard rule,
because that failure has no error and looks exactly like "the texture is
slightly wrong somehow." Final state, measured at dpr 1 and emulated
dpr 2: the floating card's 4× crops are indistinguishable from the texel
probe, the texel probe indistinguishable from resting DOM, and on retina
the rest state is literally an identity map — projected footprint
1145.0000 × 351.0000 device px, corner residue 0.0000. The card at rest
is its own pixels again, in position, in size, and in color.

## the seam had two leaks — one in the box model, one in the clock

Pete, after the crispness fix landed: the elements under a newly-3D card
move by a few pixels, and there's a black flicker as the card leaves the
page. Both live on the handoff frame, and neither was the mechanism I
went in expecting.

The shift was CSS wearing an engineering costume. The vacated slot's
empty state drew a `1.5px dashed border` — and a border is a *box*
property, so the slot grew and everything below it marched 2px down the
page at liftoff and 2px back at landing. The slot's one job is to hold
the card's box; its empty styling was quietly contradicting it. The same
dashes are an `outline` now (a paint property, zero layout), and the
rule went into the stylesheet as prose: an empty slot may repaint, it
may never remeasure.

The flicker was the shadow beating its own card into existence. On the
first rendered frame the source hasn't painted yet — the card quad draws
nothing — but the shadow drew anyway: a card-shaped 30% veil stamped
over the still-visible page copy for exactly one frame, at every grab.
The lab was hiding the page copy on a frame count (`frames === 3`),
which is a race dressed as a constant; the only honest readiness signal
is "the texture uploaded real pixels," and only the library's upload
path knows that moment. `Surface` now says it out loud — `onFirstUpload`
fires once, and both the page-copy hide and the shadow key on it. Card
first, then its shadow, structurally.

The probe that found all this lied to me once first: v1 sampled the
WebGL buffer from its own rAF, whose ordering against r3f's render is
pure registration luck, and a mid-session flip manufactured a 12-frame
dark window that perfectly indicted the (innocent) density schedule.
v3 samples inside a `gl.render` wrapper — the only moment a
`preserveDrawingBuffer: false` canvas is defined. Post-fix trace, same
gesture: zero shift frames across the whole cycle, nothing drawn over
the visible copy, card pixels one frame before the copy hides.
decisions.md #54.

## the corners were never transparent — the mesh learns to wear the element's chrome

Pete's list was two items long and read like polish: the card's quad
shows square corners outside the DOM's 14px radius, and the shadow
changes character when you pick a card up. Both turned out to be the
same missing idea — the mesh was *authoring* chrome the element already
owned.

The corner fix everyone reaches for first is alpha: surely the texture
is transparent outside the arc, just let it through. Measured: the
parked source's corner texel is `255,255,255,255`. Opaque white. The
`.ui-root` contract paints the consumer's app background across the
content root, so outside the card's curve there is real paint, by
design — the pixels a resting card sits on. "Where does the element
end" simply isn't in the texture, and no capture-path cleverness can
recover what was never encoded. Only the computed style knows. So
`Surface` asks it: `radius="auto"` measures the border-radius and
enforces it as an analytic SDF mask spliced into the material —
uniform-driven, no recompile, MSAA-dithered edge, crisp at every LOD
tier precisely because it is math and not texels. The raycast filters
through the same SDF, so a click past the arc hits what's actually
behind it. Custom materials get the one-liner: `SURFACE_RADIUS_GLSL`
plus a multiply.

The shadow was the same disease in a heavier coat. The DOM card wears a
two-layer whisper — a 1px hairline at 4% and a `0 6px 18px -12px` at
30% — and the lab's airborne shadow was a hand-tuned SDF that had never
met either of them: radius hardcoded to 14, its own blur curve, its own
color. Two systems disagreeing about what a shadow is, swapping at the
exact moment the eye is looking. Now the library parses the computed
`box-shadow` into layers (outer only — inset ones are already in the
texture; color-first serialization, σ = blur/2, spread clamps like CSS
clamps) and hands them to the scene through `onChrome`. The lab's
shader renders those layers with an erf ramp — the analytic form of a
Gaussian-blurred edge, so σ→0 draws the hairline as a hairline — and
evolves them with height: blur grows, weight fades, the authored
negative spread relaxes. Every factor is 1 at h = 0. The liftoff frame
draws the DOM's own shadow, verified down to the uniform values, and
the swap has nothing left to pop.

The through-line joins #52–#54 as the fourth face of the same rule: the
element is visual truth. Pixels at matching density, presentation on
the pixel grid, readiness from the upload, and now chrome by
measurement. The mesh doesn't imitate the DOM — it inherits it.
decisions.md #55.

## the shadow that vanished at touchdown

Pete again, after the chrome shipped: better, but the landing still
pops — the surface card comes to rest with *no shadow at all*, then the
DOM card appears wearing one. A shadow that exists at altitude and
evaporates exactly at h = 0 is a strange creature, and the culprit
turned out to be geometry lying to the shader.

The shadow shader reconstructs world position from UVs: `p =
(vUv·2−1)·uQuadHalf`. That equation makes the quad's true size a
load-bearing input — and the quad was built by pushing each corner
*radially* out from the centroid, which hands a wide card only 29% of
the margin vertically while `uQuadHalf` claims all of it. The shader's
coordinate space was stretched 1.26× vertically at rest; every pixel
below the card asked "how much shadow is here?" about a point 2–3σ
farther out. The measured rest layer — spread −12, σ 9 — keeps its
whole visible fringe within a dozen pixels of the edge, so the stretch
relocated the *entire shadow* to coordinates underneath the card quad,
where the card promptly drew over it. At altitude the same lie only
squished the halo, and a soft blob 36% thinner than intended looks
like a soft blob. The measured layers made the lie fatal precisely
because they made rest *exact*: identity in a coordinate system that
wasn't world space.

The fix is a frame, not a nudge: `shadowQuadFrame` treats the projected
footprint as what it provably is — a parallelogram (a planar rectangle
projected along a fixed direction is an affine image) — summarizes it
by two half-edge vectors, adds the margin along each axis, and returns
the vertices *and* the shader's halves from the same numbers. Geometry
and uniforms can no longer disagree, structurally. The instrument that
confirmed it is #54's readPixels-inside-gl.render probe, watching a
strip below the card's edge through a live drop: the final frames
before the swap now read a decaying Gaussian fringe (α 15/9/5/2/0 at
3/6/9/14/22 px) within a few counts of the DOM shadow that replaces
it — where the old code read zero, every time. decisions.md #56.

## the outline that outstayed the card

One seam left, and it wasn't the card at all. The vacated slot's dashed
outline — bluest exactly when the card is about to land, because the
proximity glow peaks at zero distance — was keyed to the swap, so it
vanished the frame the DOM card returned. Through the card's slightly
translucent border you could watch it happen: dark, then abruptly
lighter. The page was changing at the one instant the page must not
change.

The fix keys the outline on the flight's own altitude verdict instead —
the same signal that already drives the texture density schedule. It
flips the moment a drop begins, so the 140 ms fade-out spends itself
under a card that is still falling, and it flips on during the climb,
so the fade-in plays under a card that is leaving. Both swap instants
now remove nothing that is visible. The trace agrees: the outline's
computed color is true transparent for the final eight frames before
every touchdown.

And one small ghost exorcised on the way: `outline-color`'s initial
value is currentColor, so an outline declared only in the active state
transitions *from the text color* the first time it appears — a faint
outline fading out under every freshly lifted card. The colorless dash
now exists on every slot from birth; lighting it is a pure color
change. decisions.md #57.

## the shadow was in front of the card

One more seam, and this one had been lying about its address the whole
time: the shadow quad lived at z = +0.5 — half a pixel in FRONT of a
resting card. Order made it look right: shadow first, card blended
over. But the card texture's outer column is the border at α ≈ 0.85
(the browser AA's honest edge), and a blend lets whatever is behind
show through the translucent part. Behind was the shadow's interior —
CSS clips box-shadow out of the border box, we were painting it under
the whole card — and the leak read as a thin dark line hugging the
border. Pete saw it as an extra border that vanished at the swap.

The fix is the physical sentence: matter occludes its own shadow. Card
first, writing depth; shadow after, depth-tested, on a plane strictly
behind (z = −0.5). Every pixel the card touches now deletes its shadow
— CSS's outside-the-box clip, enforced by geometry — while the corner
notches keep their fringe because the radius mask discards there and
writes no depth. The strip probe agrees with the DOM to within 4
counts at every column, and the at-rest profile is monotonic again:
border, then paper. decisions.md #58.

## the card learns it is paper

Pete's verdict on the flight card was the right kind of harsh: "it
looks like something you could fake with CSS with enough time." Fair —
a rigid rectangle tilting under a shadow is a transform and a
box-shadow. So the card stops being rigid. A bow field around the
pinned grab point, amplitude from the plate's own velocity, the leading
half catching more air than the trailing, normals the analytic
derivative of the bow — and the physics never learns, because the sheet
is presentation the same way the rest-snap is: dynamics annotated,
never altered.

The first build failed twice, instructively, and both reports had one
root. "i'm not seeing the card geometry actually change at all" — and
"grainy artifacts on the card edges corresponding with the direction
that i threw it." The bow aimed straight down the camera axis, away
from the viewer: a pure away-bow is nearly invisible head-on (~2% of
perspective at the edges), and it pushed the bent leading edge behind
the shadow plane during a fast descent, where the depth test flips
per-pixel. The only thing the bend visibly did was grain. Flip the sign
and both die together — edges lifting toward the camera bulge the
silhouette, and a +z bow can never reach behind the shadow, so the #58
carve cannot fight its own card.

The other half of invisibility: the gloss band is additive, and a white
card clips at white. Darkening is the only direction paper can show. So
the bend carries its own multiplicative shade on the local bend normal
— zero whenever the sheet is flat, at any tilt — and the curl now
throws a sweeping shadow across its own face. The swap stays a theorem
throughout: rendered amplitude is smoothed × gate, hard zero below
30 px/s, because the smoother alone left 0.45 px of bend aboard at
touchdown. Trace: peak 17 px mid-sweep, settle tail exactly 0, descent
regime clean. decisions.md #59.

## the card dies as matter

The second half of the ask: "a really cool delete animation like the
paper crumpling up or something that is obviously not possible with even
the most clever CSS." So the ✕ does not remove the card — it ends its
life as matter. The page copy hands off exactly like a grab (the rise IS
the handoff window; crush is held at exactly zero through it, by
constructed theorem rather than decayed tuning), and then the sheet
crushes: every vertex staggers toward a noise target, gravity arrives
only once the thing falling is genuinely a wad, and the board forgets
the slot only after the wad has faded — a FLIP snapshot first, so the
neighbours close the gap as a motion you can watch.

Two lessons paid for in captures. First: per-vertex random targets are
not a crumple, they are confetti — every triangle torn from its
neighbours mid-crush. Paper folds in CHUNKS; the target field now
samples its noise on a coarse uv grid with a per-vertex remainder, and
the shards became folds. Second: the bend's analytic normals are
hopeless on a crumple field, and the answer was free the whole time —
screen-space derivatives of world position are the facet normal of
whatever triangle is under the fragment, automatically faceted because
interpolation is piecewise planar. Crumpled paper shading for the cost
of two `dFdx` calls.

A crumpling card is beyond rescue — esc and pointerup are guarded,
because "put it back" needs a back and the slot is already condemned.
Deletes work from both worlds through one entry: a page card becomes
matter first; a floating card crumples where it hangs, momentum and all
(the ✕ arrives through the canvas, forwarded like every other pointer).
Traced: crush 0.000 across the whole rise, wad off the bottom of the
viewport at fade exactly 0, five cards then four then three, and
`stats()` returns [] when it is over — nothing left painting, nothing
left at all. decisions.md #60.
