# Focus — the design contract (lab 007)

**Status:** design, **platform-validated 2026-07-30** (Chrome 150, all
seven probes pass — table at bottom). Informed by a four-source
prior-art deep-read (citations at bottom). Pieces graduate to
decisions.md as they ship and get paid for.

**Implementation status (increment 1, shipped 2026-07-30):** the tree
core (`src/lib/focusTree.ts` — registry, memory stacks, Flutter band
reading-order; vitest-pinned including the one-removal-per-pick band
re-anchoring semantics), `src/lib/tabbables.ts` (tabbable-subset rules,
pure halves tested), and `<FocusScene>`/`<FocusGroup>`
(`src/primitives/FocusScene.tsx`) with Surface auto-registration via
`FocusGroupContext`. Browser-verified in lab 006 with real CDP keys:
ring walk, descend/typing, boundary exit at last-element identity,
memory restore + clear-on-Escape, ascend-from-first, Escape ladder to
camera home. Implementation decisions layered on this contract:

- **Scene ring is a closed loop for now.** Native edge handoff exists
  (probe 1) but parked subtrees still sit in the page's tab order, so a
  "hand back to browser" exit would immediately re-enter panel DOM.
  Real page-embed handoff needs the proxy layer to own page-side stops
  — next increment.
- **Unit element = the Surface source root** with `tabindex="-1"` —
  focusing it makes unit selection real document focus, and the
  `[data-focus="unit"|"interior"]` attribute the manager stamps lets
  authored CSS paint the state into the texture (paint properties
  only).
- **Scene-level Tab advances FROM the cursor, never re-enters it.**
  After Escape-from-unit, Tab means "move on" — re-entry is Enter's
  job. Avoids both Flutter memory bugs without clearing the cursor.
- **Descend intent always fires.** Enter on a group with no interior
  tabbables keeps unit focus but still emits `cause: 'descend'` —
  read-only panels are zoomed into to *read*; camera reactions key on
  the commitment, not on whether the DOM had an input.
- **Spatial arrows, the announcer, and page-edge handoff are NOT in
  yet** — later increments, per the sections below.

**Implementation status (increment 2, shipped 2026-07-30):** the leaf
half of the model, proven in lab 006 as a synth-style mixed group — the
`filter — voice a` Surface plus a `<Dial>` satellite sharing ONE
FocusGroup traversal, browser-verified with real CDP keys: Tab continues
from the last wave button onto the knob's slider proxy; arrows ratchet
the physics one detent per press; Home/End settle-to-extreme; Shift+Tab
re-enters the panel at its *last* tabbable; Tab past the knob exits
upward to the next unit; interior memory restores onto the leaf and
Escape still clears it. Idle contract held on-screen (33 surfaces ·
0 paints/s between feed ticks). Decisions layered on this contract:

- **One imperative proxy layer** (`FocusScene.registerLeaf`): plain DOM
  appended beside the canvas. Inside the r3f reconciler a react-dom
  portal can't reach, so no React touches proxies at all — which also
  closes react-three-a11y's root-per-proxy crash class by construction.
  Proxy rects re-project on focus transitions plus `syncProxyRects()` at
  camera tween-settle and drag-end — never per frame.
- **Member boundaries are the manager's; composite interiors stay the
  browser's.** `interiorBoundary` (focusTree.ts, vitest-pinned) turns
  per-member element sequences into native / move / exit / ascend.
- **Registration order is a trap the tree now absorbs.** React child
  effects run bottom-up, so members register BEFORE their FocusGroup —
  and a Surface's composite registers LATE (its source element is
  async). `registerMember` creates the group record implicitly, and
  unordered members default to composites-first-then-leaves so mount
  timing can't reorder a designed device; explicit `order` is the
  escape hatch. The silent-drop version of this shipped and cost a
  browser session to find: the dial sat in the proxy layer but not in
  its group's traversal.
- **Announce per detent crossing; settle stays authoritative.** The
  strict rest threshold fires ~2.7s after an arrow kick (the ringdown
  must decay first) — correct physics, unacceptable AT latency.
  `aria-valuenow` lands at each crossing (a handful of writes/s,
  paint-free per probe 6) and once more at true rest.
- **Keyboard-as-force is calibrated by simulation**: `hopImpulse`
  bisects the actual integrator (flipImpulse's idiom) so one press from
  rest is exactly one detent at any tuning; key repeat compounds
  impulses into momentum, as designed.
- **Leaf-only groups fall back to proxy-as-unit** (a free-standing
  control is its own stop). Implemented; not yet browser-exercised.
- **Disposing a focused proxy hands focus up first** (own unit, else
  the canvas) before removal — never a silent drop to `<body>`.

**Implementation status (increment 3, shipped 2026-07-30):** the
scoped-down-then-ratified rework driven by the first real user test
(Pete, four-point critique — every point traced to a designed-but-
unshipped or genuinely-missing rule). Browser-verified in lab 006 with
real CDP keys: entry lands on the panel under the viewport center; the
ring follows the authored roster; a descended group traps and wraps Tab
through mixed DOM+WebGL members; one Escape releases and zooms home;
survey focus can never land off-frame (camera position pinned through a
full ring walk including the wrap — pure head-turns). Decisions layered
on this contract:

- **Reframe bridge** (see Camera integration): the library detects
  focus-visibility violations and emits `ReframeRequest`s; the app's
  rig fulfills (`useFocusReframe`). A clamped built-in fulfiller covers
  rigless scenes and stands down when any app fulfiller registers.
- **The altitude rule.** Tab traverses peers at your current altitude:
  scene level walks units; a DESCENDED group is modal — Tab cycles its
  members and WRAPS (composite tabbables and leaf proxies in one ring),
  and Escape is the release that un-latches, lands on the unit, and
  emits `cause:'release'` (the rig's cue to zoom home). Click-in
  interior focus WITHOUT Enter never traps — APG exit-at-edge holds, so
  the trap binds to *camera commitment*, not to interior focus. WCAG
  no-keyboard-trap is satisfied by Escape as the documented exit.
- **Engaged is a gesture-latched DOM stamp**, the one deliberate
  exception to zero-shadow-state: `data-engaged` on the unit root, set
  only inside `descend()`, cleared on every release path and whenever
  focus leaves the group. Honest because the *gesture* is the source of
  truth (activeElement can't encode commitment), and the stamp doubles
  as the CSS chrome hook and dies with its subtree.
- **Authored ring order** (`sceneRing`): `FocusGroup order` wins;
  the band algorithm is demoted to a fallback for unordered groups.
  Ordered groups never project during a ring walk, so mid-tween camera
  sampling can't touch the authored case (settle-gating the geometric
  fallback stays a watch item).
- **Entry policy**: with no live cursor, Tab/Enter selects the nearest
  *fully-visible* unit to the viewport center (`entryPick`), falling
  back to most-visible; `initialFocus` overrides. Validated in lab 006:
  the home pose's view ray meets the arc exactly at the bottom row, and
  entry chose that row's center panel.
- **Survey vs engaged chrome must differ.** Lab 006: dim 2px inset at
  unit, bright 3px cyan ring + brighter border while engaged. Found in
  the process: the inc-2 chrome selectors were DEAD CSS — the stamped
  unit element IS the `.p6` root, so the descendant form
  (`[data-focus] .p6`) never matched and all visible "focus" came from
  the handle mesh; the self form (`.p6[data-focus]`) is the shipped
  fix. Computed-style + screenshot verified.
- **Fulfiller lessons (browser-bought):** screen-space pixel deltas
  linearize catastrophically for far-off-frame panels — a box
  straddling the camera plane projects to absurd rects, and a faithful
  truck flew the camera to x≈−1058. Lab 006's fulfiller is therefore a
  minimal HEAD-TURN (rotate the view direction to a comfort cone —
  exact at any angle, bounded by π), with elevation pre-clamped to
  OrbitControls' polar limits so the settle handoff can't pop the
  position (observed y 2→3.05 otherwise). The library's default
  fulfiller keeps pixel math but clamps to one viewport per event.
- Arrows, the announcer, and page-edge handoff remain deferred.

**Polish pass (second user test, shipped 2026-07-30):** five noticings,
each verified fixed in browser with real CDP input, plus one discovered
mid-verification. (1) Release aims the home ride at the released panel
— position comes home, the view holds the panel Tab framed (a corner
panel released to dead-center NDC (0,0) where bare `home()` lost it
off-screen). (2) Fast Tab interpolates continuously — the rig publishes
the live aim into `controls.target` every tween frame, so mid-flight
re-arms read the rendered pose, not the stale settle value (5-Tab burst:
max 0.018 rad/frame, no snaps). (3) Motion modes: rig `setMotion`, auto
honoring `prefers-reduced-motion` end to end (emulated media query →
one-frame jump cut), and the library's default fulfiller jump-cuts under
reduced motion too. (4) Pointer selection (see Camera integration):
click selects the unit, buttons keep their focus, dead-space clicks
select instead of dropping focus. (5) Approach settle pop: every armed
pose is pre-clamped legal (`clampOrbitPose`), so the controls-handoff
`update()` is a no-op — top-row approach lands phi exactly at the limit
with zero tail movement. The discovery: the corner-to-corner ride
whipped 1.13 rad in one frame — target-point lerp swept the target past
the camera; the great-circle fix then arced over the zenith (0.31
rad/frame of up-vector spin); yaw/pitch gaze interpolation landed at
the mathematical bound (0.052 rad/frame). All three schemes are pinned
as `cameraPose.ts` tests.

**Increment 4 (arrows, shipped 2026-07-31):** directional navigation at
scene/unit level — the §8.4 regime split, Flutter's directional
history, and the no-candidate ladder (contract above under "Directional
navigation"), all browser-verified with real CDP keys. Evidence:
retraces walk back exact paths under the moving camera and perpendicular
presses clear; the yaw nudge's tween target matched prediction to a
millimeter and the pitch nudge reproduced the `asin` math exactly, with
the top row a clean `canMove`-false no-op; engaged units pass arrows
through with byte-identical camera poses; the synth dial's proxy
consumed Arrow/Home/End without router interference (an agent-reported
"dial regression" proved to be a concurrent pointer click —
click-selects-unit clearing `data-engaged` — and the instrumented repro
is clean). The lasting find: **the lattice walk zig-zagged rows**, twice,
by two different mechanisms. Full-field rect captures (mirroring
`screenRect` against the registered groups, pinned as
`spatialNav.field.test.ts`) replayed both browser picks exactly in the
pure module — lawful picks, therefore formula defects: a 4px projected
sliver zeroed the outsider orthogonality (deploy → doc-5), and
projection bloat at the arc's edge made the whole neighborhood
"insiders" ranked by raw progress (synth → calendar past a cone-passing
row-above candidate at 291.8 vs errors at 297.9). One vocabulary fixed
both — centroid-vs-band orthogonality in both regimes (decision #15) —
and the 3×11 walk is row-true in both directions through the shear
zone, verticals land in-column, and idle Surfaces stayed at zero paints
throughout navigation. Deferred: member-level arrows, `grid` mode,
directional entry refinements, the `auto` philosophy, announcer,
page-edge handoff.

**Thesis tie-in.** The library's claim is that the DOM is load-bearing,
not a texture. Until focus works, that claim is mouse-only. The goal is
keyboard-complete operation of a 3D workspace with the browser's real
focus model underneath — nothing here invents a focus system; it *routes*
the browser's.

## The model

A **focus tree**: scene → groups → targets. Two target kinds, one
distinction (the same one desktop toolkits and ARIA converged on):

- **Composite** — a Surface's live DOM subtree. Focus descends *into*
  it; the browser owns interior Tab, form semantics, `:focus-visible`,
  the screen-reader tree. We never reimplement any of that.
- **Leaf** — a WebGL-only control (Dial/Toggle/Slider, any app mesh),
  backed by a visually-hidden ARIA proxy element (`role="slider"`,
  `role="switch"`…). Keys operate it directly.

A **group** is a unit of co-located targets (a lab-006 screen + its
satellite switch; a synth's knobs + its display). Composites and leaves
are interchangeable members. Membership rides the scene graph — a
`<Dial>` nested under a `<Surface>` auto-joins via SurfaceContext; a
`<FocusGroup label="Synthesizer">` wrapper groups free-standing targets.

**The invariant: scene focus IS document focus.** Every focusable thing
is a real DOM element — Surface interiors natively, leaves via proxies,
a group-as-unit via real focus on a `tabindex="-1"` container. The
manager is a *router* of real browser focus plus a renderer of glows;
`document.activeElement` never lies, screen readers follow for free, and
there is no shadow-focus state to desynchronize. (This dissolves the
web's roving-tabindex vs `aria-activedescendant` schism on the side APG
favors; VoiceOver's activedescendant tracking is historically the weak
one.)

## Tab model — one stop per group

*(Revised from an earlier flow-through draft: APG's core convention is
"the tab sequence should include only one focusable element of a
composite UI component" — grouping exists to reduce tab stops. Eight
screens × six controls must not be a 48-press sweep, and no screen
reader has a model for Tab hopping between scene panels mid-form.)*

- The GL canvas is the page's single entry stop (ARIA composite-widget
  pattern). Tab enters the scene; Shift+Tab from the first unit leaves
  it. The page never sees scene internals.
- **Scene ring: Tab moves group-to-group** (units glow via
  focus-as-light). A *free-standing leaf* is its own stop, focused
  directly — no descend ceremony (APG single-widget-cell rule: a lone
  switch/button gets focus itself; enter/exit machinery is only for
  multi-control or arrow-hungry content).
- **Enter descends** into a group (grid pattern: "places focus on the
  first widget" — or the remembered one, see focus memory). **F2** is
  the APG toggle-descend key; support it as an alias. **Escape
  ascends** — control → group-as-unit → scene → (optionally) release to
  page. Escape also dismisses popovers/layers first (lab 004's missing
  dismissal semantics land here).
- Enter-descend exists **only at unit level**. Once a control has
  focus, Enter belongs to the control (switch/button activation) —
  the grid pattern's mode distinction, kept strictly.
- **Inside a descended group, Tab walks members in authored order** —
  composite interiors first-class: the Surface's own tabbables in DOM
  order (browser-owned), then satellite leaves. At the group's **last
  member, Tab exits upward** to the next unit at scene level — never
  into a neighboring group's interior. This is Flutter's
  `TraversalEdgeBehavior.parentScope`, including its guard: after
  delegating upward, *verify focus actually moved*, else you recurse
  forever at the root.
- Edge behavior is a per-group knob, defaulting to `parentScope`;
  `closedLoop` (wrap inside) for modal-ish panels. Flutter's deliberate
  asymmetry is adopted: Tab wraps/exits, **arrows stop at edges** by
  default.
- At the scene's outer edge, hand Tab back to the browser (Flutter's
  `leaveFlutterView` analog): don't preventDefault, let the native move
  reach the surrounding page.

## Focus memory — a stack, not a pointer

Per group, a stack of previously-focused members (Flutter's
`_focusedChildren`), because a single pointer ships two bugs:

- **Restore validates lazily.** On re-entry, pop entries whose target
  is unmounted or unfocusable; land on the *next-most-recent* valid
  one, not "first in order."
- **Explicit unfocus clears.** Escape-ascend clears the group's stack —
  otherwise Tab immediately after Escape re-focuses the thing you just
  left (Flutter documents exactly this bug in a source comment).
- Role nuance (APG): grid-like groups restore last-focused;
  *selection-bearing* groups (radio-like, tab-like) restore the
  **selected** member instead.
- Disposing a focused target restores from the stack (never drop focus
  to `<body>`).

## Directional navigation (arrows, at scene/unit level)

**Shipped increment 4** (`src/lib/spatialNav.ts`, pure + vitest-pinned)
at scene and unit level; member-level arrows, per-group `grid` mode,
and directional entry stay deferred — arrows stop at unit edges
(Flutter's Tab-wraps/arrows-stop asymmetry, kept).

Geometry is **camera-projected screen-space AABBs, sampled per
keypress** — the spec's own frame (spatnav computes on final
post-transform layout; projection is the faithful 3D generalization).
Nothing cached across keypresses except the history stack below.

**Two regimes, split before any scoring** (spatnav §8.4 — projected 3D
panels overlap constantly, and overlapping rects must never reach the
distance formula):

1. **Insiders** — candidates whose rect overlaps/contains the origin's,
   filtered by edge-progress in the direction (top edge below origin's
   top edge, for down), **and by the centroid cone** (decision #14,
   browser-bought): the candidate's centroid displacement must lie in
   the direction's quarter-plane — overlap alone is not insider status,
   because projected neighbors overlap by slivers (grab handles,
   perspective) and a ~3px sliver otherwise outranks the true neighbor.
   Rank by edge progress **plus centroid orthogonality** (`od·Wo`,
   decision #15, also browser-bought): at the arc's edge projection
   bloat makes every neighbor an "insider", and raw minimal progress
   then hands the pick to whichever row leans nearest on screen. True
   stacks pay no penalty — a contained candidate's centroid is inside
   the band by definition — so the FPWD fix is law, refined: concentric
   stacks stay reachable from all four directions; an offset *contained*
   candidate is reachable via its dominant axis only. Tie-break by
   **depth** (our painting order).
2. **Outsiders** — candidates strictly past the origin's trailing edge.
   Score with the distance function; smallest wins; ties by tree order
   (stable).

**Distance function** — keep spatnav's structure, retune its constants:

```
distance = euclidean + orthogonalDisplacement·Wo − alignmentBonus·Wa
```

The spec's Wo = 30 horizontal / 2 vertical encodes *row-dominant text
layout*; a spatial workspace isn't one. Shipped symmetric (Wo ≈ 2 both
axes, Wa = 5). **`orthogonalDisplacement` is the candidate centroid's
distance outside the origin's cross-band — not band-to-band separation**
(decision #15, browser-bought): band separation reads 0 for any sliver
of cross-overlap, and the projected arc's rows shear apart toward the
edges until a row-below neighbor's top grazes the origin's bottom — a
4px sliver zeroed the penalty and its nearer edge beat the level
neighbor. The centroid says which row something is actually in; the
band says only whether the AABBs touch. Both regimes use this one
measure (`centroidOd`). The spec's −√overlapArea term is omitted: the
regime split guarantees outsiders share zero area with the origin, so
the term is structurally 0 here. The TAG-prototyped centroid-angle term
(their fix for the stock formula over-favoring 0°/90° candidates) did
land — as the insider *gate* above, not as a distance term. Per-group
`grid` mode (aligned-candidates-first, axis-distance only) stays
deferred with member-level arrows.

**Directional history — arrows must retrace.** The TAG flagged spatnav's
non-reciprocity (right-then-left doesn't return) as an unresolved
defect; Flutter's per-scope push/pop stack is the fix, and for us it is
load-bearing, not polish: **focus moves the camera, so the geometry that
chose the last target no longer exists by the next keypress** — a pure
geometric argmax cannot be reciprocal here even in principle. Adopt
Flutter's invalidation matrix wholesale: pop on opposite direction;
clear on perpendicular axis, on Tab, on external focus change, on
unmounted entry. External-change detection needs no stamping atop a
single router: `notify()` clears the trail whenever
`cause !== 'directional'` — Tab, Enter, Escape, pointer, disposal all
funnel through the same chokepoint. A retrace pops without
re-recording, so ping-pong cannot grow the stack; an invalid retrace
target clears the whole trail (it describes a world that's gone).

**Directional entry into a group** lands on the member nearest the
entry edge (spatnav's inner-distance rule), not authored-first — Enter
still uses authored-first/memory.

**The no-candidate ladder** (per level): visible candidate → focus it.
None, but the camera can still move that way → **tween one increment,
don't move focus** (repeated presses alternate tween…tween…focus as
targets come into view). Can't move → no-op. Shipped as a mirror of
the reframe bridge — detect here, fulfill there: the library asks
registered `NavPolicy`s (`useFocusNavPolicy`) `canMove(dir)` and hands
the first taker a `nudge` request; nudges never move focus and never
record history. The **camera-bounds predicate** (the spec's "can be
manually scrolled" analog) is `viewPitchRoom` (cameraPose.ts): pitch
room to the polar-band edges, yaw unbounded for orbit rigs — without
it the ladder is ill-defined. A rigless scene registers nothing and
simply stops at the last projectable candidate. Of the spec's two
per-group philosophies — `auto` (only visible candidates, view nudges
stepwise) vs `focus` (offscreen candidates focusable, camera follows
focus) — `focus` shipped as the default; `auto` stays deferred.

## Ordering

- **Within a group: authored order.** A synth's author knows cutoff
  precedes resonance; camera motion must not reshuffle a designed
  device. Escape hatch: explicit numeric order prop (Flutter's
  `OrderedTraversalPolicy`: ordered members first, stable-sorted, then
  unordered in secondary order).
- **Between groups: authored order first** (`FocusGroup order` →
  `sceneRing`, shipped increment 3) — a designed roster IS the intent;
  the first user test read the band algorithm's arc-projection output
  as scrambled. Unordered groups fall back to **screen-space reading
  order**, via Flutter's band algorithm: take the topmost rect; form
  the infinite horizontal band spanning its vertical extent; every rect
  intersecting the band is a member; order members left-to-right;
  repeat with the remainder. Ordered groups never project at all
  during a ring walk.
- **Every sort stable** (Flutter treats this as contract): equal
  coordinates must not shuffle between keypresses.
- **Sample order at boundary-hop time, and at tween-settle** — never
  against a mid-tween camera (band near-ties flicker), never
  continuously (mid-sequence re-sorts make Tab nondeterministic).
- Traversal order lives in **no React state** — derived imperatively at
  keypress time (Flutter's `updateShouldNotify => false` discipline).
- Force-include the *current* target in sort input even if it just
  became disabled — else Tab away from a freshly-disabled control
  silently no-ops (Flutter).

## Proxy contract (leaves)

- **One portal layer for all proxies** — never a React root per proxy
  (react-three-a11y's `createRoot`-per-element is its open React-19/
  StrictMode crash class). A single fixed-position container adjacent
  to the GL canvas.
- **Never inside a Surface's source canvas subtree** — proxy mutations
  (`aria-valuenow` during a physics settle) would be paint-record
  changes, storming repaints on an unrelated texture.
- **Positioned at the target's projected screen rect** — not decoration:
  VoiceOver/TalkBack one-finger exploration and double-tap dispatch
  touches at the element's screen position, and magnifiers track
  focused-element geometry. (react-three-a11y ships a fixed 50px disc;
  true rects are strictly stronger. Their per-proxy per-frame sync is
  also their open perf bug — 14 instances → 3fps. **Update positions at
  tween-settle / on demand**, one shared projection pass, not per
  frame.)
- **Hiding recipe:** `opacity:0` + clipped box. Natively, opacity-zero
  elements are focusable and tabbable (tabbable's maintainers, verbatim
  in source). Never `display:none`, `visibility:hidden`, `inert`, or
  zero-area (the last is a flagged a11y anti-pattern) — all make the
  proxy unreachable. **Never `display:none` a focused proxy**
  (react-three-a11y's behind-camera culling silently drops focus to
  `<body>`): hand focus off (ascend to group) before hiding.
- **Native semantics do the key handling.** Real `<button>` gives
  Enter/Space; `role="slider"` + our keydown gives arrows. Zero
  synthetic events. APG slider contract: all four arrows (Up/Right
  increase), **Home/End mandatory as absolute jumps** — the physics
  layer needs a settle-to-extreme operation, not just impulses;
  optional PageUp/Down for large steps. `aria-valuenow/min/max`,
  `aria-valuetext` for human units, `aria-orientation` when vertical.
  Switch: `role="switch"`, `aria-checked`, Space (Enter optional).
  Update `aria-valuenow` at settle (or throttled), not per physics
  frame — measured in increment 2: settle-only announces ~2.7s late
  after a kick, so the shipped rule is *per detent crossing* plus an
  authoritative settle write.
- **Keyboard input as force:** arrows inject impulses into the 1-DOF
  integrator (reuse `flipImpulse`-style calibration); the dial ratchets
  detent-to-detent with momentum under key repeat. Keyboard a11y that
  goes *through* the physics, not around it.
- **Pointer-events decision:** proxies are `pointer-events:none`
  (react-three-a11y's hit-testable invisible discs are its largest bug
  class — stuck hover, event stealing). The trade, made consciously:
  mobile SR double-tap dispatches a click at the focused element's
  screen point, which now falls through to the GL canvas — the canvas
  raycast path MUST activate the control that owns SR focus (they
  coincide spatially because proxies sit at projected rects). Verify on
  device; if it fails, flip pointer-events on only while AT interaction
  is detected.
- **Announcer kit** (lifted nearly verbatim, expert-reviewed):
  `aria-live="polite"` + `aria-atomic="true"` sibling-of-canvas div,
  sr-only clip styling; clear-then-100ms-re-set to re-announce identical
  messages; announce *activation feedback only* — never what native
  semantics already convey.
- Focus hygiene: window-level click listener that blurs scene focus on
  real mouse clicks (`e.detail !== 0` — keyboard-synthesized clicks
  carry `detail === 0`).
- `prefers-reduced-motion`: focus-driven camera moves become jump cuts.

## Camera integration

Focus changes emit events; **the manager never moves the camera**
(primitives over components, decision #1). Two events mirroring
spatnav's, both cancelable:

- `onFocusChange(target, cause)` — before commit (their
  `navbeforefocus`). The scene's typical response: tween to frame the
  target. Canceling redirects/suppresses.
- `onNoTarget(direction, group)` — a direction exhausted a group (their
  `navnotarget`). App-level wrap-around or camera nudge lives here.

Spatnav removed its cancelable pre-scroll event for scroll-performance
reasons that don't apply to a camera tween — a cancelable pre-move
event is viable for us where it wasn't for them.

Descend-fires-the-zoom: entering a group emits the focus event the
scene answers with a dolly-in (the lab 006 flow — Tab, Tab, Enter,
glide, then interior Tab). The mode boundary is a keypress, never a
camera-distance threshold (no ambiguous mid-zoom band). Mouse users who
dollied in manually get the entry heuristic: first Tab enters the group
dominating the viewport.

**Reframe bridge (shipped increment 3).** DOM `focus()` carries an
implicit obligation — the scroll container brings the element into view
(WCAG 2.4.11's floor). Our `preventScroll:true` suppresses the page's
fulfillment (correct: panels aren't in page flow), so the obligation
transfers to the camera — which is APP state. So the library only
*detects and requests*: after every focus transition it caused (never
`pointer`/`escape`/`release`), if the focused unit or leaf projects
<50% visible without covering the viewport center, it emits
`ReframeRequest {groupId, object, rect, viewport, cause, level}` to
registered fulfillers (`useFocusReframe` / `registerReframeFulfiller`).
The DOM precedent is exact: focus() requests, the scroll container
fulfills, `scroll-margin` tunes (`reframeMargin` is its analog). XR is
why the split is load-bearing — a fulfiller may refuse to move the
user's head and highlight instead. A built-in minimal fulfiller (bare
camera truck, clamped to one viewport per event) keeps the invariant in
rigless scenes and stands down while any app fulfiller is registered.
`'descend'` requests are emitted (the rigless floor) but rigs ignore
them — their approach ride already centers the target.

**Pointer selection (shipped with the increment-3 polish).** Clicking a
Surface selects its unit — the pointer analog of Tab, minus the camera:
the click proves the panel visible, so the `'pointer'` cause never
reframes, and the ring cursor updates so the next Tab continues from
the clicked panel. Mechanics: forwarded synthetic clicks bubble to a
document-level capture listener (capture because focus-follows-click is
browser behavior, not an event contract markup can `stopPropagation`
away). The listener defers one microtask — `forwardPointer` runs its
focus fixup *after* dispatching the click, including a blur when
nothing focusable sat under the point, which would immediately undo a
focus set synchronously — then fills in `focusUnit(id, 'pointer')` only
if the group ended up without focus. Clicks that land real focus (a
button) therefore win; clicking dead space in a panel now selects it
instead of dropping focus to nothing. Click-in still never engages
(APG exit-at-edge preserved — the trap binds to Enter's camera
commitment, not to mouse entry).

**Motion.** The built-in fulfiller honors `prefers-reduced-motion` by
applying its correction as a jump-cut — vestibular safety is a library
floor, not app policy. Rigs are expected to do the same (lab 006's rig:
`setMotion('animated' | 'instant' | 'auto')`, auto following the media
query). Two rig lessons paid for in browser traces, pinned in
`cameraPose.ts` tests, for any fulfiller that tweens `(position,
target)` poses against OrbitControls: (1) **arm only poses already
legal under the controls' polar/distance limits** — settle hands the
pose to `update()`, which re-satisfies clamps by *moving the position*,
a visible last-frame yank otherwise (every top- and middle-row approach
in lab 006 violated the polar limit); (2) **interpolate gaze in
yaw/pitch, never by lerping the target point** (the target's straight
path can sweep past the camera — measured 1.13 rad in one frame) **and
not on the great circle either** (near-antiparallel horizontal aims arc
over the zenith, where lookAt's up-vector degenerates — measured 0.31
rad/frame). Yaw/pitch is turning-in-place body grammar; its elevation
never leaves the endpoints' band, so the pole is unreachable. And for
re-arms mid-flight: publish the live aim into `controls.target` every
tween frame — arming a new tween from the stale settle-time target is
what made fast Tab jank.

## Surface markup rules (tab hygiene)

Boundary interception must compute a subtree's tab sequence (transcribe
tabbable's rules; it's the de-facto standard). To keep the computed
sequence and Chrome's actual behavior identical:

- **No positive `tabindex`** inside Surface markup (browser orders
  positives document-wide; any local computation diverges — and expert
  consensus bans them anyway).
- **Keep one radio checked per group** — with none checked, browsers
  disagree on which radios are tabbable.
- **No native media `controls`** in Surface markup (one element to the
  algorithm, multiple internal shadow-DOM stops to Chrome; media
  bypasses the DOM path anyway, decisions.md #5).
- `<details>`: the `<summary>` is the tab stop, not the details.
- `contenteditable` detection requires the attribute on the element
  itself.
- **Intercept on element identity, not press counting**: macOS
  settings make Safari-family browsers skip links while tabbing —
  "count N presses" desyncs. The rule is: focus is on the computed-last
  tabbable AND Tab arrives → intercept.
- **Cache the sequence per subtree, invalidate on `paintCount`** —
  tabbability checks force layout reflow (tabbable's known perf issue),
  and we uniquely own a free "subtree changed" signal.

## Autofocus

Deferred queue, resolved end-of-tick, first-valid-wins per group; a
request is valid only if the target is still mounted, still in the
group, and the group has no focused member (Flutter's `_Autofocus`
mechanics). Async-mounting Surfaces make this non-optional.

## Focus indication

APG requires a visible indicator on whatever holds focus, including the
`tabindex="-1"` group root. Interior focus: the browser's ring, painted
into the texture (self-paints per platform.md). Unit/leaf focus:
mesh-level treatment (rim glow, focus-as-light) — and because
compositor-owned properties are off-limits in markup (hard rule), any
DOM-side indication uses paint properties only. `:hover`-style
mirroring applies: if `:focus-visible` doesn't survive our programmatic
routing (probe 4), mirror as `data-focus-visible` exactly like
`data-hover`.

## Probes (the empirical gate)

Run via `?focusprobe=1` (ProbeFocus.tsx, `window.__focusProbe`), real
keys through the automation CDP path (synthetic keydowns don't move
focus). Trial-flag evidence: parked sources' `paints > 0` in stats().

| # | Claim to verify | Expected | Result (2026-07-30, Chrome 150) |
|---|---|---|---|
| 1 | Real Tab reaches focusables inside parked source canvases; order is document (mount) order | reach, doc order | **✓** full sweep: page-before → proxy-slider → proxy-off → page-after → a-btn → a-input → b-btn → b-input; past the last, Tab leaves to browser chrome (the scene-edge handoff exists natively) |
| 2 | Focusing a parked-subtree element self-paints the focus ring into the record (`paintCount` advances) | yes (platform.md self-paint table) | **✓** paints 1→2 on the focused source, neighbor untouched; blur paints too |
| 3 | Document-capture keydown sees Tab targeted inside a parked subtree; `preventDefault` suppresses the native move; `.focus({preventScroll:true})` re-routes without viewport jump | all yes | **✓** intercept entry `prevented:true`, focus landed on hop target, scroll pinned at base |
| 4 | `:focus-visible` matches after programmatic `.focus()` inside a Tab-key handler (heuristic credits keyboard) | yes, per spec heuristic | **✓** true on the hop target inside the handler and on every Tab-focused element in the sweep. (Observed: eval-context programmatic focus *also* got `:focus-visible` — don't rely on it; `data-focus-visible` mirroring stays the fallback) |
| 5 | An `opacity:0` fixed-position proxy (`role="slider"`, `tabindex="0"`) is Tab-reachable and receives arrow keydowns | yes | **✓** both proxies in the Tab ring; ArrowDown/ArrowUp/Home all delivered |
| 6 | Arrow keys on the focused proxy don't scroll the page; `aria-*` mutations on proxies never advance any Surface source's `paintCount` | yes / 0 paints | **✓** scroll pinned through all presses (handler preventDefaults per contract); 6 `aria-valuenow` writes → paint delta 0 on both sources |
| 7 | Focusing an offscreen fixed element with `preventScroll` leaves scroll untouched; without it, measure | untouched / measure | **✓** untouched **both ways** — fixed positioning sits outside scroll geometry entirely, so parked sources and the fixed proxy layer can never yank the viewport |

Every load-bearing platform assumption of this design is confirmed. The
probe page stays (`?focusprobe=1`) as the re-verification harness for
future Chrome versions.

Deferred to manual verification (Pete + VoiceOver): proxy announcement
("Volume, slider, 4 of 11"), group labels (`role="group"`), one-finger
exploration over projected rects, double-tap-through-canvas activation.

## Prior art (what we took, what we rejected)

- **react-three-a11y** (pmndrs): validated the proxy pattern + screen-
  rect positioning rationale (mobile AT); took the announcer kit, the
  `e.detail` click hygiene, native-semantics-over-key-handlers. Rejected
  its architecture: per-proxy React roots (crash class), per-frame sync
  (perf class), flat leaf list (no tree/groups/composites — its issue
  tracker requested sliders and grouping for five years).
- **Flutter focus system**: the tree architecture, memory-as-stack with
  lazy validation, `parentScope` edge behavior + guards, the band
  algorithm, ordered-policy mixing, the directional history stack and
  its invalidation matrix, autofocus queue, stable-sort discipline.
- **CSS spatial navigation** (css-nav-1 → css-spatial-nav-1; browser-
  unimplemented, quietly revived 2026-06): insiders/outsiders regime
  split, the distance-function structure (weights retuned — theirs were
  fitted to 2D text rows; TAG documented the defects), the no-candidate
  ladder incl. the scroll-boundary predicate, inner-distance group
  entry, per-container `action`/`function` knobs, both cancelable
  events. Its unsolved problems we sidestep by design: implicit descend
  (we have Enter/Escape), non-reciprocity (history stack), hostile
  iframes (single-origin scene).
- **APG + tabbable**: the one-stop-per-group reversal, Enter/F2/Escape
  semantics, single-widget-cell rule, memory-vs-selection restore
  nuance, roving-tabindex preference, slider/switch key+ARIA contracts,
  the full focusability rule set and its edge cases.

The seam nobody occupies: a focus tree whose composites are live DOM
and whose leaves are physical objects, ordered by a camera that focus
steers back. Flutter has the tree but no 3D; tvOS has spatial focus but
no DOM; react-three-a11y has proxies but no composites; spatnav scopes
Tab out entirely.
