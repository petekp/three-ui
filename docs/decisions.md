# Decisions

Append-only records of choices with teeth: what we chose, what we
measured-and-rejected, and what it costs us. The rejected alternative is
the load-bearing part — it's what stops a future refactor from
"simplifying" back into a design we already falsified. New decisions get
a number; superseded ones get a note, not an edit.

## 1. Primitives over components (2026-07-28, lab 002)

**Context.** The obvious pitch is "shadcn but 3D" — a themed component
kit. **Decision.** three-ui is the *bridge* that makes the DOM available
as physical matter: `<Surface>`, `<SurfaceLayer>`, forces, anchors.
Components are demos, not the product. **Rejected.** A component kit
would freeze opinions about look-and-feel while the substrate (an origin
trial) is still moving, and every component would re-solve the same
bridge problems. **Consequence.** Labs prove primitives; scenes stay
disposable evidence.

## 2. Motion is physics, not tweens (2026-07-29, lab 003 → 005)

**Context.** Controls need feel; the web reflex is CSS/JS tween
libraries. **Decision.** One 1-DOF symplectic integrator
(`src/lib/physics1D.ts`); a control's feel is a composed force field
(detents, over-center, stops, damping). Interaction hands the body real
velocity; settling is emergent. **Rejected.** Tweens: they synthesize
outcomes rather than deciding them (a toggle tap must be *decided* by the
double-well, or it's theater), don't compose, and duplicate state.
**Consequence.** Dial/Toggle/Slider share ~all their code; new feels are
new fields. Bonus (discovered later, see authoring.md): the platform
can't rasterize compositor tweens anyway — motion had to be matter-side.

## 3. Upload-on-paint over observers and over always-repaint (2026-07-29, scale probe)

**Context.** `Surface` originally repainted + re-uploaded every source
every frame; the probe showed a per-source fixed-cost ceiling (~64
sources at 120Hz) and that 128 *idle* Surfaces cost as much as 128
animating ones (73fps). **Decision.** `paint="auto"` is fully passive:
upload iff the canvas's `paintCount` advanced (+1 trailing frame). The
compositor's self-firing `onpaint` *is* the change signal — no
`requestPaint` loop, no prediction. **Rejected, with data.**
(a) *Always-repaint*: idle costs everything (N=128 static: 73.2fps).
(b) *MutationObserver + dirty windows* — built, measured, killed: missed
CSS animations by design, needed a trail-window heuristic for
transitions, and record construction cost ~17% with 128 all-animating
sources (59.6fps vs 76.9 passive; passive even beats always-repaint's
72.9 because requested paints used to stack on top of content
self-paints). **Consequence.** Idle Surfaces are free (120fps at 0
paints/s with 128 mounted); a toggle flip costs 2 paints total. The
general lesson: when a system already emits the event you're inferring,
delete the inference.

## 4. Drag input reads `e.ray` ∩ plane, on static handlers (2026-07-29, labs 003–005)

**Context.** Two input bugs cost real debugging time. **Decision.**
(a) All drag math starts from `e.ray` intersected with a drag plane fixed
at pointer-down — never `e.point` (r3f pointer capture freezes the
intersection, so `e.point` dies at the mesh boundary). (b) Drag handlers
live on a **static** object; the moving part only gates drag-*start*
(`<Slider>`'s `startOnCapOnly`). Measuring the hand in the moving
handle's own frame is a feedback loop — the cap tracks at half speed.
**Consequence.** `use1DOF` owns both rules once; controls can't
re-introduce the bugs.

## 5. Media routes around the DOM path (2026-07-29)

**Context.** Video/GIF frames are (almost certainly) compositor-side —
invisible to `drawElementImage` even with `paint="always"`.
**Decision.** Media is matter: a `SurfaceLayer`-anchored quad with
`THREE.VideoTexture`, positioned by the same anchoring system as DOM
layers. **Rejected.** Manually blitting video into the source canvas —
fights the compositor for pixels it owns, per-frame cost, and the layer
system already solves placement. **Consequence.** "Video in UI" needs no
new primitive; untested-media risk is contained to a documented rule.

## 6. UV anchors resolve once, sample live (2026-07-29, lab 004)

**Context.** Anchoring floating UI to arbitrary (possibly deforming)
geometry every frame. **Decision.** `UVAnchor` picks its triangle
barycentrically against the **static UV attribute** once, then `sample()`
re-reads the **live** position/normal buffers each frame — O(1)/frame,
so CPU deformation carries anchors for free. **Rejected.** Per-frame
triangle search (O(tris) × anchors), or world-space anchoring (breaks
under deformation). **Consequence.** Same limit as raycast forwarding:
GPU-side displacement is invisible (CPU buffers are the truth). Overlap
caveat: first containing UV triangle wins.

## 7. Conceptual DOFs map pointer deltas; only literal planes get ray ∩ plane (2026-07-29, lab 006)

**Context.** Lab 006 panels reposition on a cylindrical arc (angle +
radius). First implementation followed #4's letter: ray ∩ a horizontal
plane seated at the grab point. **Failure, measured.** Upper-row handles
sit above eye level; a downward-pointing ray meets an overhead plane
receding toward infinity — "pull toward me" read as "fly away" (radius
7 → 8.6, straight to the clamp). **Decision.** When the drag's degree of
freedom is *conceptual* (arc angle, radius, a list index), map pointer
**deltas** to the parameters (screen-x → Δangle, screen-y → Δradius) —
the same shape as `use1DOF`'s pointer→q mapping. Reserve `e.ray` ∩ plane
for DOFs that literally are a world-space plane or axis (#4 unchanged
there: static reference, never `e.point`). **Rejected.** A fixed
below-eye "board" plane — dead whenever the grab-time ray points above
the horizon. **Consequence.** The reference frame stays static
(clientX/Y), capture-safe, and behaves identically at every row height.

## 8. Texture density is dynamic LOD, quantized with hysteresis (2026-07-29, lab 006 addendum)

**Context.** Every Surface rasterized at CSS-pixel size — 2× blurry on
retina at rest, mush on approach. Mipmaps only solve *minification*;
magnification has no GPU answer. But paint records replay as vectors
(platform.md #8), so re-rastering at k× yields genuinely sharper glyphs.
**Decision.** `resolution="auto"` (default): compare each Surface's
projected screen density (device px per CSS px) against a quantized tier
ladder (0.5–3×); switch through a Schmitt trigger (±15% band) plus a
two-evaluation debounce, evaluated every 10th frame, phase-offset per
instance. `setScale` re-rasters through the normal onpaint path — one
paint + one upload per committed tier — and the canvas's pinned CSS size
keeps the subtree un-relayouted, so focus/caret survive swaps.
Downshifting below 1× returns memory on far panels. **Rejected.**
(a) *Fixed retina everywhere* — pays dpr² memory on every panel
including far ones, and still blurs on approach. (b) *Continuous
per-frame matching* — spends the scarce paint budget on camera motion;
quantized+debounced spends ~1 paint per settled boundary crossing
(measured: 41 tier changes across a full orbit sweep, ≤2 per source,
zero oscillators, 120fps held). (c) *CSS `zoom` on the element* — a real
relayout per tier, destroying the resize-never-touches-the-subtree
invariant that keeps focus alive. **Consequence.** Glyph sharpness
tracks proximity automatically; idle cost unchanged (two integer reads +
a dozen flops every 10th frame). The ladder's 3× cap is the memory
guard — extreme close-ups soften rather than allocate unboundedly.
*(Amended same day by #9: cap raised to 6×, mipmap policy added; #10:
tier swaps must realloc GL storage.)*

## 9. Reading tiers are mip-free; the ladder is the mip chain (2026-07-29, LOD follow-up)

**Context.** Pete: "still very fuzzy up close" after #8 shipped.
Diagnosis chain, each link measured: edge-width probe showed the
CTM-scaled re-raster is pixel-equal to natively-3×-authored content
(mean edge 1.0px vs 1.0px; explicit bitmap upscale: 2.0px) — source
crisp; texture registry showed full-res uploads bound (1260×900) —
upload crisp; `magFilter=Nearest` showed single-texel stair-steps on
screen — texels delivered. The softener was three's default
`LinearMipmapLinearFilter`: trilinear blends in the box-filtered
half-res mip whenever the footprint tips past 1:1 — i.e. exactly at
reading range, throwing away the resolution the vector re-raster just
paid for. (Also: ladder capped at 3× while a dpr-2 approach demands ~4
and a grab-pull ~7.) **Decision.** `applyFilterPolicy`: tiers ≤0.5 keep
`generateMipmaps` + trilinear + anisotropy (far/oblique panels need
directional minification control the ladder can't provide — anisotropy
is per-axis, the ladder isn't); reading tiers (≥1) use plain
`LinearFilter`, no mips. Ladder extended to 0.25–6 (0.25 quarters
far-panel memory; 6 covers retina close-ups). **Rejected.** Trilinear
everywhere — measured soft at true 1:1. Nearest — jaggies. A negative
mip bias — not exposed on MeshStandardMaterial without shader surgery.
**Consequence.** Crisp at every reading distance on retina; past ~6×
demand the near edge of a nose-against-glass panel softens instead of
allocating >30MB — deliberate saturation. Probe lesson worth keeping:
verify camera *arrival* in the same eval as the screenshot — a damped
OrbitControls ease faked one "1:1 is soft" data point.

## 10. Tier swaps realloc GL storage on the post-resize paint (2026-07-29, LOD ghost hunt)

**Context.** After #8/#9 shipped, tier swaps left artifacts: a shrunken
ghost of the panel composited in one corner over stale content
(downshift), and "fuzzy despite upshifting" residue (upshift) — uneven
across panels, erratic while zooming. The handoff suspected platform
timing (deferred paint records resolving into resized canvases). All
platform hypotheses were moot — Chrome did everything right.
**Diagnosis, measured.** three.js allocates non-video `CanvasTexture`
storage **immutably** (`texStorage2D`) at first-upload dimensions and
issues `texSubImage2D` at the canvas's *current* size forever after.
`setScale` resizes the backing store, so a shrink sub-blits the whole
re-raster into a corner of the stale storage (the ghost), and a grow
throws `GL_INVALID_VALUE: glCopySubTextureCHROMIUM: Offset overflows
texture dimensions` — every upshift, silently keeping old texels.
Per-panel unevenness was just per-panel swap history. **Decision.**
`Surface` records `paintCount` when a `setScale` commits; on the first
frame the counter moves **strictly past** that mark (⟺ the post-resize
paint itself has landed — onpaint can't interleave mid-rAF),
`texture.dispose()` + re-apply filter policy. three then reallocates at
the new dimensions with a full upload. The mip policy must ride the
same moment: level count bakes into the allocation (`getMipLevels` at
alloc time). **Rejected.** (a) *Dispose at the commit frame* — the
just-resized backing store is cleared and unpainted; the realloc's
first upload would flash a blank panel every swap. (b) *Double-buffer
old texture through the swap* — extra state and a duplicate texture's
memory per swap, to reproduce a signal (`paintCount`) the platform
already gives us; same lesson as #3. (c) *Waiting for three to handle
it* — it can't: immutable storage is by design, and allocation is
keyed on `__version === undefined`, not on image dimensions.
**Consequence.** A tier swap costs paint + realloc + full upload —
measured invisible (71 reallocs across an approach/home storm, both
directions, 120fps held; 33/33 panels canvas-dims == storage-dims
after). Regression tripwire: `GL_INVALID_VALUE …
glCopySubTextureCHROMIUM` in the console means canvas and storage
dimensions have diverged again. Probe lesson, paid for twice now (#9):
sample **all** facts of a claim in one atomic eval — a dye screenshot
compared against GL logs captured minutes apart chased a phantom
contradiction for an hour while camera easing and React re-renders
drifted the scene between captures; the settling probe read the source
canvas (`getImageData`) and the bound GL texture (scratch-FBO
`readPixels`) in a single step.

## 11. onpaint draws under an identity CTM; the backing ratio IS the scale (2026-07-30)

**Context.** The morning after #10 shipped, Pete reported the inverse
artifact: at high tiers the face showed a magnified **top-left crop** of
the document ("the larger textures exceed the size of the surface").
Reproduced at dpr 1 by forcing retina density (`setPixelRatio(2)`).
**Diagnosis, measured.** Position-marker dots at known CSS coordinates
pinned the replay transform exactly: `drawElementImage` auto-scales by
the canvas's **backing/CSS ratio**, and the CTM multiplies on top —
ratio 3 + CTM 1 → 3×; ratio 1 + CTM 3 → 3×; ratio 3 + CTM 3 → 9×. Our
onpaint resized the backing to k× *and* set a k× CTM: effective k² at
every tier (tier 3 → 9×, showing 1/3 of the doc; tier 0.5 → 0.25×, the
doc huddled in the top-left quarter of every far panel). #10's realloc
fix *unmasked* it — before #10, high-tier uploads died at the GL layer
and faces kept stale-but-complete 1× content. **Decision.** `onpaint`
asserts an **identity** transform and just draws; `setScale`'s backing
resize alone supplies the scale. **Rejected.** (a) *CTM-based scaling*
(the original design) — double-applies, measured k². (b) *Compensating
CTM* (`k/ratio`) — identity is that expression's fixed point for exact
backings, and non-integer CSS sizes make ratio ≠ k by rounding; carrying
a second scale source invites re-divergence. **Consequence.** Faces are
correct at every tier; rest-state far panels — quietly quarter-content
since the LOD stack shipped — are full-bleed for the first time.
platform.md claim 8 rewritten with the corrected contract and a
position-aware re-verification step. Probe lesson, the real one this
time: #10 dismissed the magenta-dye quadrant as a confounded probe — it
was a **correct measurement of this bug** at tier 0.5. Crispness and
alpha-coverage are scale-blind; only position-aware probes (dots, dye
against expected bounds) can verify *where* a replay lands. When a
probe's result contradicts the model, instrument the probe before
indicting it.

## 12. `resolution` exposes intent (bounds), not structure (the ladder) (2026-07-30)

**Context.** With the LOD stack stable, the question became its public
face. The internals carry paid-for invariants (#8–#11): tier spacing
must exceed the hysteresis band or a parked camera oscillates; the
upshift-jump/downshift-step asymmetry assumes roughly geometric
spacing; the mip policy and realloc contract key off tier values.
**Decision.** One prop, three forms, shaped like r3f's `dpr` (the
vocabulary the audience already knows): `resolution="auto"` (full
ladder), `resolution={2}` (pinned), `resolution={[min, max]}` (auto
over the inclusive slice — `[1, 6]` "never sub-legible", `[0.25, 2]`
memory cap, `[1, Infinity]` open ceiling). The slice is computed by
`tiersInRange` (pure, tested): any contiguous slice of a valid ladder
is still thrash-free by construction, so bounds grant the useful 90%
of control without ever handing out an invalid ladder. An empty
intersection degrades to the nearest tier (a graceful pin); dynamic
LOD now seeds at the ladder tier nearest 1× so the first raster is
already in-range (side fix: oversize Surfaces no longer transiently
allocate a >4096px canvas at mount). **Rejected.** (a) *A raw
`tiers={[...]}` prop* — `tiers={[1, 1.05, 1.1]}` is a thrash generator
that would present as our bug; users express floor/ceiling intent,
not spacing theory. (b) *`onTierChange` callback* — debugging is
already served by `__threeUI.stats()`; add it the day something must
*react* to commits (e.g. a video layer switching stream quality), not
before. (c) *Renaming to `dpr`* — borrows the shape but would imply
display-tracking; the value is projected density, camera-driven.
**Consequence.** `LOD_EVERY`/`LOD_AGREE`/`BAND` and the ladder stay
internal and freely tunable; the public contract is only "density
between min and max, chosen sensibly."

## 13. Camera rides arm legal poses and interpolate gaze in yaw/pitch (2026-07-30, lab 006 polish)

**Context.** The focus rig tweens `(position, target)` poses and hands
the result to OrbitControls at settle. Three disorientation bugs
arrived together in the second user test: approach rides ended with a
last-frame yank; fast Tab snapped the aim backward; and (found during
verification) a corner-to-corner ride whipped the view 1.13 rad in a
single frame. All three are structural, not tuning: `update()`
re-satisfies polar/distance clamps by MOVING THE POSITION (every top-
and middle-row approach pose violated the polar limit — vitest-pinned);
a tween armed mid-flight read `controls.target`, which held the STALE
settle-time aim; and lerping the target POINT sweeps it past the
camera's path, where `lookAt` of a near-zero difference vector spins.
**Decision.** Every armed pose is pre-clamped legal before the tween
starts (`clampOrbitPose` — target sacred, position slides;
`clampViewElevation` — position sacred, aim bends), so the settle
handoff is a no-op by construction. The live aim is published into
`controls.target` every tween frame (controls are disabled — no fight),
so re-arms read the rendered pose. Gaze interpolates in YAW/PITCH
(`gazeTween`/`gazeAt`): rotate about vertical along the short arc,
morph elevation linearly, carry distance separately. **Rejected.**
(a) *Target-point lerp* — the whip above. (b) *Great-circle slerp of
the view direction* — tried, measured 0.31 rad/frame: near-antiparallel
horizontal aims arc over the ZENITH, where lookAt's up-vector
degenerates and the ride glances at the ceiling. Yaw/pitch elevation
never leaves the endpoints' band, so the pole is unreachable; it is
also the body grammar of turning in place. (c) *Loosening
OrbitControls limits* — the limits are app policy; the old settle pose
WAS the clamped pose, just reached via a yank. **Consequence.** Rides
end where they land (browser: zero tail movement, phi exactly at the
limit, ~0.05 rad/frame peak — the smoothstep bound); `cameraPose.ts`
tests reproduce all three failure modes against the fixes, so a
"simplification" back to lerp fails CI, not a user test.

## 14. Overlap alone is not insider status — the centroid cone gates the regime (2026-07-30, lab 006 arrows)

**Context.** Increment 4's directional pick adopts spatnav §8.4:
overlapping candidates ("insiders") never reach the distance formula,
and any insider outranks every outsider. The registered focus object is
the whole unit group — Surface plane plus its grab-handle mesh — so
each projected rect extends above the panel face.
**Diagnosis, measured.** ArrowRight from doc-4 picked `deploy`, one
full ROW up; the true right neighbor doc-5 was never in contention.
Bare-mesh AABBs said the pick was impossible — no overlap (deploy's
bottom 293.5px vs doc-4's top 297.9px). The contradiction traced to the
handles: handle-extended rects overlap row-neighbors by ~18px slivers,
deploy's rect had ~3px of rightward edge progress, and
minimal-progress-wins made it THE insider — absolute precedence over
the whole outsider pool, where doc-5 sat dismissed. Sliver hijack is
generic to projected 3D: perspective guarantees near-tangent overlaps
somewhere in every arc.
**Decision.** A third insider filter: the candidate's *centroid*
displacement must lie inside the direction's quarter-plane cone
(main-axis component ≥ |cross-axis| − ε, sign included). Near-
coincident centroids pass every cone, preserving FPWD stack
reachability; an offset *contained* candidate is reachable via its
dominant axis only — a documented refinement of "reachable from all
four directions." The real browser rects are pinned as the regression
test. **Rejected.** (a) *Register only the Surface mesh* — the
satellite IS part of the unit's silhouette (entry pick, reframe
visibility, and proxy rects all want the true footprint), and the next
scene's satellite layout would re-break it. (b) *Minimum overlap-area
or edge-progress thresholds* — pixel constants don't survive
projection (camera distance rescales them continuously), and a true
stack's next card can legitimately sit at near-zero progress; the cone
is scale-free. **Consequence.** Sliver hijacks are impossible by
construction (doc-4 → doc-5 verified in-browser); the deploy/doc-5
rects live in `spatialNav.test.ts` as the tripwire.

## 15. Orthogonality is the centroid outside the cross-band — in both regimes (2026-07-31, lab 006 arrows)

**Context.** With the cone shipped (#14), the browser-verified lattice
walk still zig-zagged rows: rightward along the middle row it dropped
to the bottom row and stayed there. History stayed coherent, ruling out
pointer noise; a full-field rect capture (all 33 panels, mirroring
`screenRect` math against the registered groups) replayed the exact
pick in the pure module — the walk was *lawful*, so the formula was
wrong.
**Diagnosis, measured — twice, two mechanisms.** (1) deploy → right
picked doc-5, one row DOWN: the projected arc's rows shear apart toward
the edges until doc-5's top rose to 4px below deploy's bottom. The
outsider distance's orthogonal-displacement term measured band-to-band
separation — 0 for any sliver of cross-overlap — so doc-5 paid nothing
for sitting a row away (centroids 164px apart) and its 9px-nearer left
edge beat synth, the level neighbor, 20.5 to 24.9. (2) Post-fix, one
column further: synth → right picked calendar. At the arc's edge the
projected AABBs bloat until every neighbor overlaps the origin — three
cone-passing *insiders*, one per row (calendar below at progress 278.5,
doc-19 above at 291.8, errors level at 297.9) — and the insider rank
was raw minimal progress, which is a stack rule, not a lattice rule:
it hands the pick to whichever row leans nearest on screen.
**Decision.** One orthogonality measure for both regimes
(`centroidOd`): the candidate *centroid's* distance outside the
origin's cross-band, 0 while the centroid stays inside. Outsiders:
`distance = hypot(gap, od) + od·Wo − aligned·Wa` as before, od
redefined. Insiders: rank by `progress + od·Wo`. The centroid says
which row something is actually in; the band says only whether the
AABBs touch. True stacks are untouched by construction — a contained
candidate's centroid is inside the band by definition, so FPWD
reachability and pure-progress stack ranking survive verbatim.
**Rejected.** (a) *Cranking Wa* until the level neighbor wins — a
constant tuned to one capture loses two columns further into the shear.
(b) *Tightening the cone* below 45° — same problem, and it would break
legitimate diagonal reachability. (c) *An authored 2D lattice*
(`order`'s philosophy extended to arrows) — defensible, deliberate, and
deferred: it's a new API surface, and the geometric pick should be
right on its own before authored overrides exist. **Consequence.** The
3×11 walk is row-true in both directions through the shear zone
(browser-verified); both full-field captures are pinned in
`spatialNav.field.test.ts`, the curated mechanisms in
`spatialNav.test.ts`. Any future formula change must survive four
browser-captured regressions, not synthetic grids.

## 16. A portaled layer is its own Surface on an overlay plane (2026-07-31, lab 009 popovers)

**Context.** Verbatim shadcn/Radix floating components (Popover, Select,
Tooltip, Dropdown, Dialog) render through a portal to `document.body` —
outside every rasterized subtree, so the content simply never appears in
any texture. Radix exposes exactly one lever: `Portal`'s `container`.
**Diagnosis, measured.** Pointing `container` at the panel's own content
root does put the content in the texture, but wrong: Floating UI positions
with `position: fixed`, so the content lands at *page* coordinates while
the panel's DOM is a 360×460 box — the popover clipped at the panel edge,
and a popover that opens upward or outward had nowhere to go. Growing the
panel's source to hold the overflow makes every panel pay for a popover it
usually isn't showing.
**Decision.** The floating content gets its **own** Surface: a same-sized
transparent slab lifted `LAYER_LIFT` along the panel normal, with its own
parked source (`.ui-layer` — the typography without the background). The
coordinate math is *zero*, and not by luck: both parked sources are
`position: fixed` at page (0,0), and Floating UI also positions with
`position: fixed`, so the popover's page rect is **already** layer-local.
Radix's own positioning lands the content in exactly the right place; we
add a Z offset and nothing else. Port cost stays one line per component
(`container` passthrough, deviation #4). The slab is `visible={false}` and
un-raycastable while empty, so an idle panel pays nothing.
**Rejected.** (a) *Portal into the panel's own root* — clipping, above.
(b) *Reparent the DOM after Radix positions it* — fights Presence,
re-runs Floating UI's observers, and breaks on every Radix update.
(c) *Re-implement positioning in world space* — throws away the thing
that makes the port verbatim; Floating UI's collision/flip logic is the
component's actual behavior.
**Consequence.** A popover reads as a separate slab with its own shadow
and specular (browser-verified). Two gotchas are paid for here: the pivot
correction (CSS scales about the content's own `transform-origin` near the
trigger, a group scales about the panel center — `p + (x−p)·s`), and
`raycast` must be a **stable function reading a ref**, never
`raycast={live ? undefined : noop}` — r3f applies props onto the instance
and handing back `undefined` does not restore the class default, it leaves
the last function attached. That spelling left the slab permanently
un-hittable and every click fell through to the card behind it.

## 17. CSS motion is translated onto the mesh, not replayed in the texture (2026-07-31, lab 009)

**Context.** shadcn asks for motion in Tailwind —
`data-[state=open]:animate-in fade-in-0 zoom-in-95 slide-in-from-top-2`.
Those keyframes run on a *descendant* of the drawn root, so they do
rasterize ([platform.md](platform.md), corrected 2026-07-31) — at **1
paint + 1 upload per frame**, ~120/s per open popover, and a translate on
the content slides pixels *within* the slab and clips at its edge, which
reads as a texture glitch rather than a panel moving.
**Decision.** `useAnimationConductor` seizes each animation on
`animationstart`, before a frame of it reaches the texture: `pause()` it,
scrub `currentTime` while reading `getComputedStyle` (the style engine
applies the timing function, so samples come back already eased — we never
implement a cubic-bezier), park the DOM at the **visible pole** so the
texture always holds fully-materialized content, replay the sampled curve
on the mesh from the r3f clock, then `finish()` so `animationend` fires on
schedule. Measured: an open costs **2 texture uploads** instead of ~18,
and the popover physically flies (opacity 0.101→1, scale 0.955→1,
y −7.19→0 over 149ms).
**Rejected.** (a) *Let the keyframes rasterize* — the per-frame upload
cost is the entire reason the paint pipeline is passive (#3), and one
popover would spend a tenth of the whole-scene budget. (b) *Parse
`effect.getKeyframes()` and interpolate ourselves* — means owning
cubic-bezier, `steps()`, and Tailwind's `--tw-enter-*` custom-property
indirection; scrubbing asks the browser instead. (c) *Swallow
`animationend`* — Radix's Presence keeps exiting content mounted until it
hears that event; a bridge that ate it would leak every popover it closed.
**Consequence.** Two subtleties are load-bearing and must not be
"simplified" out. **Never scrub to the exact end time:** a paused
animation whose `currentTime` reaches its end enters the *finished* state,
and finishing **dispatches `animationend`** — so the last scrub sample
announced, one frame in, that a 150ms exit was already over. Presence
unmounted the content 130ms early (measured: `animationend` at +36ms,
mesh still flying to +150ms). `END_EPSILON_MS = 0.5` keeps it merely
paused; verified `animationend` moved 36ms → 161ms. And **`animationcancel`
must hold the last pose, not snap to rest** — "rest" for a dismissed
layer is wherever it was when its content vanished, and REST made a
closing popover flash back to opaque on its final frame.

## 18. The canvas is always "outside" — Surface stops the native pointerdown (2026-07-31, lab 009)

**Context.** With a live Popover in an overlay Surface, clicking its own
Apply button dismissed the popover instead of pressing the button.
**Diagnosis, measured.** Logging document-level `pointerdown` with capture
showed **two** events per click: the trusted one targeting `CANVAS`, and
the forwarded synthetic one targeting `BUTTON#l9-pop-apply`. The canvas
event fires first. Radix's `DismissableLayer` — and every menu, popover,
dialog, and combobox built on it, across every UI library — decides
"outside" from the target of a document-level pointer event. The WebGL
canvas is outside *every* portaled layer in the document, so **any** click
into **any** Surface reads as an outside-interaction.
**Decision.** `Surface` calls `e.nativeEvent.stopPropagation()` in its
pointerdown handler, alongside the existing r3f-level `stopPropagation`.
This is not a Radix workaround: the canvas is *how the pointer travelled*,
not *what it hit*. Once a hit is resolved to a UV and forwarded, the
synthetic event is the truth and the native one is plumbing.
**Rejected.** (a) *Patch Radix / pass `onPointerDownOutside`* — would need
repeating for every library and every component, and the ports must stay
byte-verbatim. (b) *Suppress move and up as well* — OrbitControls
registers document-level `pointermove`/`pointerup` for the duration of a
drag; silencing those strands any drag that began on empty space and ended
over a panel. Only `pointerdown` is suppressed, deliberately.
**Consequence.** Browser-verified both ways: a real CDP click projected
onto the Apply button moved its counter 360 → 380 with the popover
**still open**, and a click on the same slab outside the popover still
dismissed it and retired the layer. This generalizes past Radix — it is
the correct behavior for any portal-based library rendered into a Surface,
and it is a precondition for the floating-layer kit (#36).

## 19. A forwarded pointer must leave the way a real one does (2026-07-31, lab 009)

**Context.** A Tooltip re-plumbed into a Surface opened on hover and then
never closed. Moving the pointer off the mesh un-hovered the trigger —
`[data-hover]` cleared correctly — but the content stayed mounted
indefinitely, and any later unrelated interaction inherited a stale
tooltip.
**Diagnosis, measured.** `forwardEvents` synthesized only the *bubbling*
half of the boundary protocol: `pointerout`/`pointerover`. Radix Tooltip
(react-tooltip 1.6.7) closes in two ordered steps, and neither reads those.
A native, **non-bubbling `pointerleave` on the trigger** builds a grace
polygon from the exit point and the content rect; only once that state
commits does it attach the `document`-level `pointermove` listener that
closes the tooltip when the pointer lands outside the polygon. No leave, no
grace area, no listener, no close.
Fixing the leave alone was still not enough — and the reason is the durable
part. Dispatching the departure `pointermove` **synchronously** after the
leave did nothing; the identical event dispatched later closed the tooltip
immediately. The leave sets React state, and the listener that would have
heard the move is attached by the effect that runs after that commits.
**Decision.** Two changes, both about faithfulness rather than about Radix.
(a) `crossBoundary` synthesizes the full protocol in spec order — `out`,
`leave` (one per element crossed, stopping at the deepest common ancestor),
`over`, `enter` — so "the pointer left ME" is a claim only the elements
actually crossed make. (b) Leaving a Surface sends a short **burst** of
departure moves over the next few animation frames, at a point outside the
source's own rect, cancelled if the pointer returns.
**Why a burst is the honest model.** A real pointer that leaves an element
keeps moving, so a consumer that arms a tracker *in response to* the leave
still receives later moves. Ours is discrete: one exit, one instant. The
burst restores the only property of continuous motion that consumers
actually depend on. Three frames is slack for a React commit plus passive
effects — two separate scheduler tasks, either of which can land after a
given frame — and is far too short to be felt.
**Why outside the rect is provably enough.** Radix pads its exit points
*inward* (`getPaddedExitPoints`, padding 5, always toward the element), so
the hull never escapes the trigger ∪ content bounding box, which is inside
the source root. Any point outside the root's rect is outside the hull —
for any tooltip, at any position. No tuning, no magic number that needs
revisiting.
**Rejected.** (a) *Close the tooltip from the scene when the ray leaves* —
needs a controlled `open` prop on every hover component and breaks the
byte-verbatim ports. (b) *Dispatch the departure move on `document`
directly* — loses the surface that generated it; dispatching on the root
still bubbles to document and keeps per-surface listeners working.
(c) *A single `setTimeout`* — same race, just longer odds.
**Consequence.** Browser-verified 2026-07-31 (Chrome 150, real CDP mouse):
tooltip opens on hover (`delayed-open`, content mounted in the layer),
closes on leave (`closed`, layer emptied), survives rapid re-entry
(`instant-open`, still open 1.2s later — the departure was cancelled), and
click-driven layers are unaffected (Popover and Select both stay open when
the pointer leaves, and still dismiss on outside click). Idle paint
counters flat across 3s. `forwardEvents` now has a DOM test suite
(happy-dom) — the first in the repo, since everything else here is pure
geometry. This is the same seam as #18: the forwarder is the only place
that knows the pointer's real story, so anything it declines to say, no
component downstream can recover.

## 20. `pointer-events` is the raycaster's business too (2026-07-31, lab 009)

**Context.** With #19 in, the tooltip closed correctly on a real exit — and
also closed *instantly on open*, with the mouse held still over its
trigger. Pete: *"it appears and then instantly exits, even leaving the
mouse stationary over the trigger."*
**Diagnosis, measured.** A floating-layer Surface is a full-panel
(360×460) transparent quad standing a few millimetres off the panel it
serves. The instant a tooltip mounts, the layer goes live — and from that
frame on it is the front-most mesh, so it catches every ray. The panel
behind it stops being hovered, fires r3f `onPointerOut` → `clearPointerState`
→ the #19 departure burst → Radix dismisses the tooltip that just opened.
The full document-level timeline showed it plainly: open, then LEAVE on
`CARD:tooltip-trigger` one frame later, then `data-state` → `closed`.
A stationary *real* mouse still emits moves (hand tremor, sub-pixel
resampling), which is why Pete saw it every time and the single-CDP-move
verification in #19 did not.
**Decision.** Two halves, both about telling the truth rather than about
Radix. (a) **`pointer-events` is honored in the forwarded hit test.**
`deepestElementAt` skips any element whose computed `pointer-events` is
`none` and returns `null` when nothing under the point accepts the pointer;
`forwardPointer` then clears pointer state and forwards nothing. (b) **A
Surface can be raycast against its content, not its plane.**
`hitTest="content"` installs a `raycast` that intersects the quad, converts
each hit's UV to a page point, and keeps only the hits `deepestElementAt`
resolves. `.ui-layer > * { pointer-events: auto }` in `ui.css` is the
ordinary portal-container idiom, now load-bearing in three dimensions: the
container is clear, what it holds is not.
**Why at raycast level and not in a handler.** An intersection r3f never
sees is one it never counts as a hover — so the Surface *behind* keeps the
pointer, uninterrupted, instead of being told it lost it. Declining inside
a handler is already too late: by then the front mesh has been recorded as
the hit and the one behind has had its `onPointerOut` fired.
**The cascade had to be re-rooted.** The parking canvas is
`pointer-events: none` (htmlInCanvas.ts) so real hit-testing can never
wander into a parked subtree — and that value *inherits*, so computed style
everywhere inside reads `none` and nothing would ever be hittable.
`createDomTextureSource` now sets `pointerEvents = 'auto'` on the source
root; `hitTest="content"` sets it back to `none`, before `onSource` runs, so
a scene still has the last word. Side effect worth having: shadcn's
`[&_svg]:pointer-events-none` is honored through a Surface for the first
time.
**A second half, cheap once (a) existed.** A departure now reports where
the pointer actually *went* — if another Surface took it since the exit
began, the burst carries that page point instead of the off-page one.
Valid without any conversion because every parked source is `position:
fixed` at page (0,0) (#16), so a point forwarded to any surface is already
a page point in the document Radix measured its hull in. Asked per frame,
not once: the destination can arrive a frame late, and the pointer may
leave everything after all.
**Rejected.** (a) *Keep the liveness gate and shrink the slab to the
content rect* — reintroduces coordinate math the overlay plane exists to
avoid (#16), and re-breaks the moment two layers stack. (b) *Suppress the
departure while a layer is open* — a real exit would then never close
anything. (c) *Let the layer swallow the ray and re-forward it downward* —
one surface guessing at another's business; the raycaster already resolves
depth correctly once it is told the truth.
**Consequence.** Content-gating subsumes liveness: an empty layer accepts
the pointer nowhere, so it is inert by construction, and Lab 009's
`gatedRaycast` was deleted. Browser-verified: five 1px jitter moves over an
open tooltip all land on `CARD:tooltip-trigger`, no leave, no burst, no
close; a real exit still dismisses; trigger → tooltip-content transit now
*stays* open, which was impossible before. Popover/Select unaffected, idle
paints flat. 182 tests. **Known edge, pre-existing:** the two-hop transit
(trigger → card body → tooltip content) still closes ~2ms after the burst's
first frame, even though the reported destination computes as inside the
hull. Not a regression — before this change every exit closed it — and it
belongs to the floating-layer kit (#36).

## 21. Viewer chrome is a Surface at the eye; modality is occlusion (2026-07-31, lab 009)

**Context.** #16 gave a popover its own Surface on an overlay plane — right
for anything *anchored* to a panel. Toasts and modals are anchored to
nothing. They don't belong to an object in the scene; they belong to
whoever is looking at it.
**Decision.** A `CameraChrome` group copies the camera's position and
quaternion each frame and pushes itself `CHROME_DISTANCE` down the view
axis. It carries one `Surface` authored at 1280×720 source pixels, with its
quad sized to span the frustum at exactly that distance — so one source
pixel lands on one screen pixel, and `position: fixed` inside it means what
it says on a page. Same one-line lever as #16 (`container`, now also on
`DialogContent`), aimed one object further out: a panel's layer for
anchored things, the viewer's chrome for unanchored ones.
**Why a scene-level group and not `camera.add()`.** r3f's default camera is
**not in the scene graph** — measured `camera.parent === null`. Children
parented to it compute correct world matrices and never draw, because the
render list is built by walking `scene`. Copying the pose onto a
scene-level group is the fix. It is never a frame stale: drei's
OrbitControls updates at `useFrame` priority −1 and r3f renders after all
priority-0 callbacks, so a pose written at default priority lands in the
same frame that reads it.
**The toast half needed no plumbing at all.** sonner doesn't portal — it
renders inline and pins itself `position: fixed`. A `layoutSubtree` canvas
is the containing block for fixed descendants (platform.md), so `<Toaster>`
mounted in the chrome Surface measured `[900, 622, 356, 74]` in the 1280×720
slab: 24px from the slab's right and bottom, its own default offset, with
zero coordinate math. The overlay lands the same way — `fixed inset-0`
measured `[0, 0, 1280, 720]`, and `DialogContent`'s `top-50% left-50%`
measured `[384, 286, 512, 148]`, symmetric on both axes.
**The finding: modality survives, but not by the mechanism it was written
for.** Radix's modal `DismissableLayer` sets `body { pointer-events: none }`.
Inside a Surface that is a **no-op** — the forwarder resolves hits by
walking the subtree with `getBoundingClientRect` (#20), so it never
consults the browser's hit test and never sees the lockout. Nothing is
lost, because the overlay is a full-frustum slab that *physically occludes*
the scene. Measured with the dialog open: a click aimed at the card's
Deploy button behind it was caught by the overlay
(`chrome:pointerdown → DIV`), dismissed the dialog, and left the card
untouched; with the dialog closed the identical click reached the card and
fired its toast.

That is worth naming, because it inverts the usual relationship. On a page
an overlay cannot actually block anything — it is a sibling painted on
top, and hit-testing would fall straight through it — so the platform
needs a lockout to *simulate* obstruction. Here the obstruction is real.
The CSS lockout was always emulating something we have natively.
**`hitTest="content"` is what makes a full-frustum slab admissible.**
Without #20 a quad spanning the whole view would make the entire scene
untouchable. Measured with the chrome empty: a raycast at the Deploy button
returned three hits with the card mesh nearest (d=3.65) and the chrome slab
**absent entirely**. The slab is only present where the DOM painted
something — which, for `fixed inset-0`, is everywhere, exactly when it
should be.
**Side effects, all landing correctly.** Radix's `aria-hidden` ancestor
walk hid `#root` (the whole visual scene) and the other three parked
canvases, and **spared** the canvas holding the dialog — correct modal
semantics for free, since the visual copy lives in the hidden GL canvas and
the accessible copy is the parked DOM. `Escape` closes: native focus is
inside the parked subtree, so the keydown bubbles to the document listener
with no forwarding. Paints settle dead flat (chrome `215 → 215` over 3s) —
the tw-animate `fade-in`/`zoom-in-95` keyframes run on *descendants* of the
drawn root, so they rasterize (platform.md) and cost paints for the
duration of the transition only. No conductor needed for correctness here;
#17 is still the answer at scale.
**Focus arbitration needed no code, and that was measured rather than
assumed.** Radix's `FocusScope` and our `FocusScene` both want Tab and
Escape while a modal is open. Instrumenting a document listener registered
*after* FocusScene's, with the dialog open: interior Tabs arrive
`defaultPrevented: false` (FocusScene sees them and stands down, because
the lab-007 contract routes interior Tab to native — the browser walks the
dialog's own tab order); the **wrap** Tab arrives `true`, claimed by
FocusScope moving focus manually; Escape arrives `true`, claimed by
`DismissableLayer`, so FocusScene's ascend/home ladder never runs. All four
arrow keys arrive `false` and move nothing — same interior rule. Focus
cycled confirm → Close → X → confirm across six Tabs without once leaving
the dialog. So modality holds by three independent mechanisms — occlusion
for the pointer, FocusScope for Tab, interior routing for arrows — and the
`defaultPrevented` gate is what lets them compose. **Named risk:** all of
this rests on Radix moving focus *into* the dialog on open. A modal that
suppressed that (`onOpenAutoFocus` prevented) would leave focus at scene
level, where FocusScene's arrows own the keys and would move selection out
from under an open modal. Untested, and it belongs to #36.
**The host is built inside `mount`, not hoisted into a `useMemo`.** A
hoisted node is right for a panel's layer, which is only ever a portal
target — but this one also owns a React root, and a remount would call
`createRoot` on a container whose previous root is still waiting on its
unmount microtask. React throws, the throw lands inside `CanvasImpl`, r3f
tears the canvas down, and the GL context goes with it. Cost one context
loss to learn.
**Rejected.** (a) *Parent the chrome to the camera object* — computes fine,
never renders. (b) *Render chrome as HTML above the canvas* — abandons the
premise; it wouldn't occlude, light, or accept depth like the rest of the
scene. (c) *Proxy `body { pointer-events: none }` into the forwarder so
Radix's lockout takes effect* — re-implements obstruction in software when
the geometry already performs it, and would wrongly kill Surfaces the
overlay doesn't actually cover.
**Consequence.** `CameraChrome` stays in the lab pending promotion to
`src/primitives/`, on the FocusOrbitRig precedent (build it in a scene,
extract it once a second consumer exists). **Known gap:** the chrome slab
is a single layer, so two stacked modals — or a modal that should sit above
the toast stack — have no z-arbitration yet. That is #36.
