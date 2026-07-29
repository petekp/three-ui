# three-ui

An experimental, futuristic UI component library made of **real materials, real physics, and real depth** — three.js/WebGL underneath, shadcn-like ergonomics on top (eventually).

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
- Physical control kit: generalize the lab-003 knob integrator + detent
  fields into sliders, switches (over-center springs), dials.
- Press-time UV locking so moving surfaces can't dodge a click.
- Focus/keyboard completeness: tab order across Surfaces + layers,
  arrow-key listbox nav, ESC dismissal, `onPointerMissed` dismissal.
- Focus light that *aims* at the focused field — `UVAnchor` now makes
  this trivial (anchor the spotlight target to the focused element).
- How many live Surfaces before paint cost bites — 12? 40?
- UV-space acceleration structure if anchor counts or mesh sizes grow
  (linear triangle scan is fine at lab scale).
