# Focus — the design contract (lab 007)

**Status:** design, **platform-validated 2026-07-30** (Chrome 150, all
seven probes pass — table at bottom). Informed by a four-source
prior-art deep-read (citations at bottom). Pieces graduate to
decisions.md as they ship and get paid for.

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

Geometry is **camera-projected screen-space AABBs, sampled per
keypress** — the spec's own frame (spatnav computes on final
post-transform layout; projection is the faithful 3D generalization).
Nothing cached across keypresses except the history stack below.

**Two regimes, split before any scoring** (spatnav §8.4 — projected 3D
panels overlap constantly, and overlapping rects must never reach the
distance formula):

1. **Insiders** — candidates whose rect overlaps/contains the origin's,
   filtered by edge-progress in the direction (top edge below origin's
   top edge, for down). Rank by edge progress; tie-break by **depth**
   (our painting order). The FPWD fix is law: fully-overlapped targets
   must remain reachable.
2. **Outsiders** — candidates strictly past the origin's trailing edge.
   Score with the distance function; smallest wins; ties by tree order
   (stable).

**Distance function** — keep spatnav's structure, retune its constants:

```
distance = euclidean + orthogonalDisplacement·Wo − alignmentBonus·Wa − √overlapArea
```

The spec's Wo = 30 horizontal / 2 vertical encodes *row-dominant text
layout*; a spatial workspace isn't one. Start symmetric (Wo ≈ 2 both
axes, Wa = 5) and consider the TAG-prototyped centroid-angle term
(atan2 delta vs requested direction) if diagonals misbehave — the TAG
documented the stock formula over-favoring 0°/90° candidates. Per-group
option: `grid` mode (aligned-candidates-first, axis-distance only) for
regular control panels — likely the better default inside a synth face.

**Directional history — arrows must retrace.** The TAG flagged spatnav's
non-reciprocity (right-then-left doesn't return) as an unresolved
defect; Flutter's per-scope push/pop stack is the fix, and for us it is
load-bearing, not polish: **focus moves the camera, so the geometry that
chose the last target no longer exists by the next keypress** — a pure
geometric argmax cannot be reciprocal here even in principle. Adopt
Flutter's invalidation matrix wholesale: pop on opposite direction;
clear on perpendicular axis, on Tab, on external focus change, on
unmounted entry. External changes are detected by stamping the expected
target before each `.focus()` and comparing on the `focusin` event
(their `lastRequestedFocus` pattern) — works unchanged atop real DOM
focus.

**Directional entry into a group** lands on the member nearest the
entry edge (spatnav's inner-distance rule), not authored-first — Enter
still uses authored-first/memory.

**The no-candidate ladder** (per level): visible candidate → focus it.
None, but the camera can still move that way → **tween one increment,
don't move focus** (repeated presses alternate tween…tween…focus as
targets come into view). Can't move → escalate to the parent group's
ring. At the root → no-op. This requires a **camera-bounds predicate**
(the spec's "can be manually scrolled" analog — OrbitControls
min/max distance and polar clamps define it); without one the
escalation loop is ill-defined. Both spec philosophies stay available
per group: `auto` (only visible candidates, view nudges stepwise) vs
`focus` (offscreen candidates focusable, camera follows focus — the
default; it's our tween-on-focus).

## Ordering

- **Within a group: authored order.** A synth's author knows cutoff
  precedes resonance; camera motion must not reshuffle a designed
  device. Escape hatch: explicit numeric order prop (Flutter's
  `OrderedTraversalPolicy`: ordered members first, stable-sorted, then
  unordered in secondary order).
- **Between groups: screen-space reading order**, via Flutter's band
  algorithm: take the topmost rect; form the infinite horizontal band
  spanning its vertical extent; every rect intersecting the band is a
  member; order members left-to-right; repeat with the remainder.
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
  frame.
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
