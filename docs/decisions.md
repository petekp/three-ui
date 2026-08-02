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
**Addendum (2026-08-01, lab 010 inc 8): the mouse twins.** The header
comment carried a known gap — the `mouseout`/`mouseleave`/`mouseover`/
`mouseenter` compatibility twins were not mirrored, "add them if a
component ever needs them." Recharts is the component: it is
mouse-native (React synthesizes its `onMouseLeave` from native
`mouseout`), so a chart tooltip appeared on forwarded moves — the move
twins already existed — and then never hid; the departure spoke a
dialect it doesn't listen to. `crossBoundary` now dispatches one mouse
twin after each pointer boundary event, which is what a real browser
does for every crossing. Radix components are pointer-native and hear
the twins as the harmless duplicates they'd receive from a real
pointer anyway. Pinned by a unit test; browser-verified: tooltip hides
on both surface departure and internal crossings.

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
resolves. `.ui-layer > * { pointer-events: auto }` in `three-ui.css` is the
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
**Refuted 2026-08-01:** the trap, not the autofocus, is the wall. With the
dialog open, script-focusing the trigger, the canvas, anything — focus is
yanked back into the dialog before the focus() call even returns (Radix's
trapped FocusScope acts on `focusin`, synchronously). Focus parked at
`body` reads as page level, where FocusScene stands down; every route to
scene/unit altitude runs through a focus move the trap intercepts. Arrows
under an open modal move nothing by any reachable path, autofocus
prevented or not.
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

## 22. A detached layer revokes placement and is sized to its content (2026-07-31, lab 009)

**Context.** #16 gives an anchored popover its own Surface on an overlay
plane, and it works by a coordinate coincidence: the layer canvas is the
same size and origin as the panel's, so a positioner's page coordinates are
*already* panel-local. That coincidence is exactly what makes the layer a
decal — everything it holds is pinned to one plane. #21 aimed the same
one-line lever (`container`) at the viewer instead. What was left is
content that belongs to neither the panel nor the eye, but to the **room**:
a popover standing a foot in front of its card, orbiting with the scene,
occluding it from the side.
**Decision.** `FloatingSurface` is a portal container plus a Surface sized
to whatever the container holds. It gives the coincidence up on purpose.
Placement is **revoked** by a stylesheet rule rather than recomputed by us:

```css
.ui-detached > * {
  position: fixed !important;
  inset: 0 auto auto 0 !important;
  transform: none !important;
}
```

The content falls to the canvas's origin, the canvas is resized to hug it,
and where the thing actually goes is then an ordinary matter of where you
put the mesh. Consumers still author `side`/`align`/`sideOffset` — those
props are simply ignored once placement is revoked, which is documented and
not enforced.
**Measured: revoking placement still rasterizes.** Zeroing the wrapper
dropped content from canvas `(36, 133)` to `(0, 0)`; a magenta dye read
`[255, 0, 255, 255]` at the origin and `[0, 0, 0, 0]` where it used to be,
and the move cost **one** paint (`6 → 7`). It is a paint-record change, so
upload-on-paint carries it with no plumbing.
**`!important` is load-bearing twice over.** Radix rebuilds the popper
wrapper on every open, so a one-shot inline write does not survive a
close/reopen; and Floating UI rewrites the inline transform on every
`autoUpdate` tick. Measured with the rule active: inline read
`translate(36px, 133px)` while computed read `none`. The rule targets the
**wrapper**, not the content — so the entrance animation, which transforms
the content itself, is untouched and still reaches `useAnimationConductor`
(#17).
**The expensive finding: the drawn root must declare its own size.** Every
child of a detached layer is `position: fixed`, hence out of flow, hence
contributes nothing to the container's box. Left to layout the container
measures zero and `drawElementImage` rasterizes an empty rectangle — with
**21 clean paints, zero errors**, and a fully transparent source canvas.
Nothing downstream complains, because nothing downstream is wrong. See
[platform.md](platform.md). So `FloatingSurface` writes
`host.style.width/height` in the same breath as measuring the content: here
the size is a *declaration for the rasterizer*, not a consequence of layout.
**Measure with `offsetWidth`, never `getBoundingClientRect()`.** Caught at
entrance frame 0: rect `273.6 × 115.9` against a layout box of `288 × 122`,
under `zoom-in-95` + `slide-in-from-top-2`. Sizing from the rect would have
shipped as "popovers are sometimes 5% small," intermittently, forever.
**Surface's `width`/`height` had to become live — and a re-layout, not a
teardown.** They were in the creation effect's deps, so resizing a Surface
tore its source down and built a new one, taking focus, form values,
selection, and any second React root mounted inside it. A Surface sized by
*measurement* rather than authored resizes constantly, so that had to stop
being a teardown. `createDomTextureSource` grew `size()` and `setSize()`;
the latter rides the same realloc mark `setScale` uses (#10), because three
allocates `CanvasTexture` storage immutably at first-upload dimensions.
**The trap inside that, which a test now guards.**
`createDomTextureSource` closes over `width`/`height`, and `setScale`
multiplies *those*. A resize that moved only `canvas.width` and
`canvas.style.width` was silently reverted by the very next LOD tier swap:
backing snapped back to `360×460` against a `274×116` CSS box and the two
stayed diverged for good. `setSize` must move the closed-over parameters.
Proven live by deleting the two assignments — four tests fail, including
`a resize SURVIVES a subsequent tier swap`.
**The dismissal worry was wrong, and why is the useful part.** The plan
assumed detachment forces us to own dismissal, since Radix's grace polygon
and hull reason in page coordinates. Measured, all three cases hold with no
new machinery: click **empty space** → nothing was hit, so Surface never
stops the canvas's own `pointerdown` (#18) and it reaches Radix's document
listener → dismissed; click a **different Surface** → the forwarded
synthetic `pointerdown` is dispatched on that Surface's parked DOM, bubbles
to `document` with a target outside the content → dismissed; click **inside
the detached content** → stays open, and the button fires (`width 360 →
380`, with `data-hover` and `data-active` landing through the mesh).

The distinction is worth naming: **containment** dismissal asks a question
about the DOM tree, which detaching does not touch; **geometric** dismissal
— the swept region between a trigger and its content — asks a question
about the plane, which detaching destroys. Click-driven layers are all
containment. The ray-based answer is still owed, but only by *hover*-driven
detached layers, and it belongs to #36.
**Growth is symmetric about the pose.** A plane grows from its centre, so a
detached surface that gains content expands both ways. Measured live:
content `288×122 → 288×234`, canvas backing `432×183 → 432×351`, quad
`1.44×0.61 → 1.44×1.17`, texture image dimensions moving with it (storage
reallocated), the new region rasterizing correctly, all in **two paints**.
That is the right default for furniture — the pose is the object's centre
and stays meaningful. An anchor prop is the fix if a "grows downward"
reading is ever wanted; nothing needs it yet.
**Rejected.** (a) *Compute the content's pose from the trigger's UV and
place it at a 3D offset* — reintroduces exactly the coordinate math the
`container` lever exists to avoid, and re-pins the content to the trigger's
plane, which is the thing being escaped. (b) *Keep the anchored layer and
move it* — the layer is panel-sized and panel-parented; moving it moves a
decal and its host together. (c) *Size the canvas from a repaint loop or a
dirty flag* — but note what the observers here actually do: `childList`
answers "what exists" and `ResizeObserver` answers "how big," neither of
which the compositor ever reports, and neither decides *when* to repaint.
#3 is intact.
**Consequence.** `FloatingSurface` ships in `src/primitives/` and the
public barrel. **Known gaps:** N detached surfaces reintroduce the lab-007
Tab reading-order problem across parked canvases; `side`/`align`/
`avoidCollisions` are silently ignored rather than warned about; hover-driven
detached layers still need the ray answer (#36).

## 23. The viewer slab has no size of its own — it *is* the viewport (2026-08-01, primitives pass)

**Context.** #21 built the chrome slab as "a `Surface` authored at 1280×720
source pixels, with its quad sized to span the frustum" — two independent
statements about the same rectangle, kept in agreement by the author. The
quad was computed as `[h * (width / height), h]`: frustum *height* from the
lens, frustum *width* from the **source** aspect. Those coincide only when
`width / height === camera.aspect`, and they did, because the browser the
increment was measured in happened to be 1280×720 too.
**The failure, measured.** Same scene, window resized to 1000×800 (camera
aspect 1.25). The slab's height was still exact — corners at y=0 and y=800
— and its width projected to x ∈ [−211, 1211]: **1422 px of quad inside a
1000 px viewport**, 42% too wide. A `<Toaster position="bottom-right">`
pins 24px from *its container's* corner, and that container was now off the
screen, so the toast landed at x=1184 — 184px past the right edge, invisible,
with clean paints and no error anywhere. Resize the other way and the same
formula makes the slab too *narrow*, quietly insetting everything that was
supposed to hug an edge.
**Decision.** Delete `width` and `height` from `ViewerSurfaceProps`. The
slab is not a rectangle that *should match* the viewport, it is the viewport,
and its source is measured from the canvas for the same reason `100vw` is
not a number you type in. One `frustumSize()` returns the quad; the source
is then derived **from the quad's aspect** at the canvas's pixel height, so
`source aspect === quad aspect` is true by construction rather than by two
expressions agreeing. Under a perspective camera this reduces exactly to
`[size.width, size.height]` and one source pixel is one screen pixel,
literally, which is what #21 claimed and could not guarantee.
**Read the aspect from `size`, not from `camera.aspect`.** r3f writes
`camera.aspect` in a layout effect, which runs *after* the render that
observed the new size — and mutating the camera doesn't re-render React, so
a `useMemo` reading it on resize gets the previous value and keeps it until
some unrelated render wanders past. `size` is what r3f derives the aspect
*from*, so it is both the earlier and the more honest source. (The
orthographic arm has to read the camera: an ortho frustum's world extent
lives on `left`/`right`/`top`/`bottom`, and isn't derivable from the canvas
at all.)
**Verified live**, one page, no reload, resizing under it: 1000×800,
1400×600, 820×900, 1280×800, 1600×800 — source, quad and canvas aspects
equal at every stop (1.25, 2.33, 0.911, 1.6, 2.0), slab corners landing on
window corners exactly, 2 paints per resize and 0 errors as the in-place
`setSize` + immutable-storage realloc path (#10) carried each one. A real
sonner toast at 1600×800 laid out at `[1220, 702, 356, 74]` and projected
its bottom-right to (1576, 776) — 24px in from (1600, 800).
**Rejected.** (a) *Keep the props and fix only the formula to `h *
cam.aspect`* — the quad would span the frustum while the source kept the
caller's aspect, so the content would simply be stretched instead of
clipped; a circle becomes an ellipse and nothing warns. (b) *Keep the props
and letterbox the given aspect inside the frustum* — no overflow, but
"bottom-right" would stop meaning the screen's bottom-right, which is the
one property the slab exists to provide. (c) *Keep them for texture
economy* — that is `resolution`'s job (#12). Density and layout size are
different questions, and answering the first by lying about the second is
how this bug happened. A knob that can only ever be set wrong is not a knob.
**Consequence.** `ViewerSurface` takes `distance`, `label`, `onHost`,
`content`, `children` and nothing else. This supersedes #21's "authored at
1280×720"; the rest of #21 stands. Note also that #21's closing line —
`CameraChrome` "stays in the lab pending promotion" — is stale: both it and
`ViewerSurface` ship from `src/primitives/floating/` and the public barrel.

## 24. `:focus-visible` is a verdict, and the forwarder must deliver it (2026-08-01, lab 009)

**Context.** Routing `FloatingSurface` through the conductor (#17) removed
the entrance keyframes from the paint path — and the counter didn't move:
19 paints per popover open, before and after. `document.getAnimations()`
mid-flight held the answer: the `enter` animation sat `paused` (the
conductor working), and beside it six CSS *transitions* ran on the Apply
button — border colours to `--ring`, box-shadow `none` → 3px ring,
outline-width 3→1px, 150ms each. The focus ring, fading in under the
entrance flight it was hiding beneath. Two per-frame painters sharing a
window count once per frame, which is why seizing the keyframes changed
nothing measured.
**Why the ring is there at all.** Radix autofocuses the first tabbable of
every popover it opens; shadcn's Button styles the ring under
`focus-visible:` with `transition-all`. On a page, a *pointer*-opened
popover shows no ring: `:focus-visible` is not a state but a verdict —
the browser grants the ring by asking how the user last interacted, and
script focus after a pointer interaction is denied it. That heuristic is
fed **exclusively by trusted events**. Everything the forwarder dispatches
is synthetic, so the browser never hears our pointer story and judges
every post-click autofocus as keyboard. Verified with trusted CDP input
through the mesh — the trusted pointerdown lands on the *canvas*, which
apparently doesn't update the verdict either (`KeepDomFocus` prevents its
default; unproven whether that's the reason): still 19/20 paints, ring
still materializing. Not a probe artifact; every real pointer user pays
it, in fidelity and in paints.
**Decision.** The same shape as #19: the forwarder is the only thing that
knows the pointer's real story, so it mirrors the verdict. `forwardEvents`
keeps a module-level modality — `'pointer'` declared at every forwarded
press (before dispatch, so a consumer focusing synchronously from
`pointerdown` already sees it), `'keyboard'` restored by any real keydown
(capture-phase, so FocusScene's claimed keys still count; lone modifiers
ignored, as the browser ignores them). A document `focusin` listener
stamps `data-pointer-focus` on elements focused under pointer modality —
never on text inputs, textareas or contenteditables, which earn their ring
however focus arrives (the browser's own carve-out) — and `focusout`
removes it. The consumer's side is one dialect line, the fourth:

    @custom-variant focus-visible (&:focus-visible:not([data-pointer-focus]));

Same mechanism as the hover twin, opposite direction — there the mirror
grants a state real hit-testing can't deliver; here it withholds one the
heuristic wrongly granted.
**Verified** (trusted CDP input, lab 009): pointer open = 3 paints,
`data-pointer-focus` stamped on the autofocused Apply, zero ring
transitions; Escape → Enter reopen = ring visible, no stamp, ~20 paints of
ring fade — which keyboard users get on a page too and are entitled to.
Radix's focus-return on dismissal inherits the right verdict with no extra
code. Lab 006's Tab entry and `data-focus` chrome unaffected (that system
never consults `:focus-visible`). 26 forwardEvents tests incl. 7 on the
mirror.
**Rejected.** (a) *Suppress ring transitions in CSS*
(`transition: none` under `.ui-layer`) — kills the paint cost but shows a
ring a page wouldn't show, and steals the ring *animation* from keyboard
users who've earned it. (b) *`onOpenAutoFocus` preventDefault per
component* — breaks byte-verbatim ports and forfeits keyboard a11y of
every popover. (c) *Not preventing the canvas's mousedown default so the
trusted event might teach the heuristic* — that preventDefault is
load-bearing (it stops the canvas stealing focus from parked inputs), and
the untrusted probe path would stay wrong regardless.
**Open.** A trusted Tab pressed while focus sits inside the detached
popover moves nothing — unclaimed (`defaultPrevented` false after full
propagation), unacted. Pre-existing, orthogonal to the mirror, filed under
the #36 umbrella with the two-hop tooltip transit.
**Resolved 2026-08-01:** re-measured with a preventDefault stack trace —
the Tab IS claimed, by Radix's own FocusScope (Popover hardcodes
`loop: true` even non-modal), and the popover holds exactly one tabbable,
so `first === last === focused` and the wrap lands on itself: visually
inert, behaviourally identical to the same DOM on a flat page. Injecting
a second tabbable made Tab cycle both, through trusted keys, inside the
parked canvas. Not a seam; nothing to fix.

## 25. The DOM is the layout authority — a hidden rig, read back as poses (2026-08-01, layout oracle)

**Context.** A scene of panels needs the answers a 2D app gets from CSS:
column widths, gap arithmetic, what collapses when room runs out. Every
consumer already speaks flex/grid, and the style engine is the best
layout solver ever shipped. Reinventing it in world units (constraint
solvers, hand-rolled flex) would be worse *and* different — a port of a
2D app would lay out almost-but-not-quite like the page it came from.
**Decision.** `createLayoutOracle` parks a hidden container at the house
parking spot (fixed, origin, `z-index:-1`) with one deliberate difference
from a texture source: `visibility: hidden`. A source must PAINT, so it
parks visibly; the rig must only LAY OUT, and visibility suppresses
painting alone — layout runs, `offsetWidth` answers, transitions tick
and fire events, zero pixels produced. Panes are marked `data-pane="id"`
(shadcn owns `data-slot`), measured by `offsetWidth`/`offsetHeight` and
offsetParent-chain walking (never `getBoundingClientRect` — #22's
transform-baking trap), and projected center-origin/y-up by
`paneWorldPose`. `<DomLayout html width height px>` wears the rig in
r3f; `<LayoutSlot pane>` renders its box as a positioned group and hands
children the CSS-px size (→ `SurfaceApp width/height`) plus world size
(→ geometry).
**Change detection is three signals**, none of them the banned kind (#3
bans repaint-loop machinery in Surface's paint path; these answer "what
exists / how big", which no paint signal reports, and the rig repaints
nothing by construction):
ResizeObserver on rig + panes (almost every reflow resizes something);
MutationObserver childList/class/style (position-only reflows —
`justify-content` moves panes without resizing any — and pane
add/remove); transition/animation events keying an rAF sampling window
(a transitioned layout property moves boxes every frame with no discrete
signal; `transitionrun`→`end`/`cancel` bounds the loop, so idle rigs
cost nothing).
**The responsive mechanism is container queries.** The rig is NOT a
viewport — `vw`/`@media` stay page-global (the same platform fact as
#21's canvas) — so the rig declares `container-type: size` and
`@container` (and Tailwind v4's `@sm:`/`@lg:` variants) resolve against
the rig's authored size. A pane a query `display:none`s reads as a zero
box and is reported ABSENT: its slot renders no panel, the mesh
dematerializes.
**Verified** (layoutprobe, Chrome 150): four-pane app shell — pixel-exact
box↔pose parity (main column = 1280−240−320−48gap−64pad = 608, nested
offsets accumulate); sidebar collapse under `transition: width 350ms` =
39 distinct poses streamed, main pane growing by exactly the released
168px; **cost model: resizing panes pay ~1 paint+upload/frame (the
content genuinely rewraps — that's the payoff, not a defect), panes the
reflow doesn't touch pay 0, position-only motion is free (group
transform)**; rig 1280→900 hides the log pane by container query with
`window.innerWidth` untouched, back to 1280 rematerializes it; idle = 0
paints on every pane, 0 errors.
**Rejected.** (a) *World-unit layout DSL* — a second layout language that
diverges from the one the ported components were written against. (b)
*Reading boxes from the texture source itself* — sources are per-panel
and already laid out; the arrangement BETWEEN panels is precisely what no
single source knows. (c) *rAF-polling the rig permanently* — the
transition-event window does the same job only while something moves.
**Open.** Animated pane *resizing* costs a GL texture realloc per frame
per resizing pane (immutable storage, decisions #10). Fine at app-shell
scale (3 panes at 120Hz measured clean); a wall of resizing panels would
want a during-motion strategy (scale the mesh, re-raster at settle) —
deferred until a scene actually hits it.

## 26. Silence the trusted hover move at the canvas — one pointer, one story (2026-08-01, lab 009 / #36)

**Context.** The two-hop tooltip transit (trigger → card body → tooltip
content) closed mid-transit even after the departure burst learned to
report real destinations (#19, #23). Captured trace: the forwarded
stream was *correct* — leave on the trigger, enter+move on the content,
burst frames inside the grace hull — and the tooltip closed anyway,
~150ms after arrival (the exit animation trailing a close decision made
at arrival time). Radix source (react-tooltip 1.2.16) names the killer:
the grace tracker is a document-level `pointermove` listener that keeps
the tooltip open if `event.target` is inside trigger/content, else
**closes if `clientX/Y` falls outside the hull**. Every trusted move
over a Surface bubbles to document with `target = <canvas>` and SCREEN
coordinates — judged against a hull built in parked-source page space
(~x 116–245), screen (1203, 405) is "miles outside" and closes a tooltip
the pointer is demonstrably travelling toward. The forwarded content
move Radix hears first can't save it: tearing the tracker down is a
React state update, so the listener is still attached microseconds later
when the trusted event reaches document.
**Decision.** `silenceHoverMove` in forwardEvents: `Surface.handleMove`
stops the native event's propagation after forwarding, **hover moves
only** (`buttons === 0`). This is #18 extended from pointerdown to
pointermove, same doctrine: the canvas is how the pointer travelled, not
what it hit, and the forwarder having retold the move truthfully, the
native's screen-space version must not ALSO reach document-level
coordinate reasoners. Two pointer stories at document is one too many.
**Why dismissal still works everywhere.** A pointer over empty canvas
never reaches a Surface handler — its native move bubbles untouched and
closes what it should. A pointer leaving a Surface gets the departure
burst, whose synthetic moves land provably outside every hull (#19).
**Why drags are exempt.** OrbitControls registers document-level
move/up listeners for the duration of a drag; a drag that began on empty
space must keep orbiting while the ray crosses a panel — the exact
reason #18 confined itself to pointerdown. `buttons === 0` is the line.
**Verified** (lab 009, trusted CDP input, Chrome 150): identical
five-step transit — without the fix the tooltip closes on the first
trusted move after the grace hull arms; with it, transit survives,
hover rests on the content, genuine departure to empty canvas still
dismisses, and an orbit drag from empty space across the panel still
orbits. A/B'd live before shipping by stopping trusted hover moves at
r3f's event root.
**Rejected.** (a) *Dispatching forwarded moves so Radix's `hasEnteredTarget`
branch wins* — it does win, and loses anyway: the teardown is async and
the trusted move closes through the still-attached listener. (b)
*Patching Radix / requiring `disableHoverableContent`* — the seam is
ours; every hover library that reasons about document-level move
coordinates (HoverCard next) would need the same patch. (c) *Silencing
mousemove too* — nothing measured listens to it at document; widen only
on evidence.

## 27. The hit test speaks paint order — elementsFromPoint is the arbiter (2026-08-01, lab 009 / #36)

**Context.** `deepestElementAt` resolved a forwarded pointer by walking the
source subtree in DOM order, later siblings winning — which is paint order
only until `z-index` says otherwise. The chrome slab broke it for real:
sonner's toaster is the FIRST child of the chrome layer at z 999999999,
the dialog overlay a LATER sibling at z 50. A live toast paints above the
open dialog's dim, exactly as on a page — and the walk handed a click on
the visible toast to the overlay underneath it, dismissing the dialog the
user never aimed at. Measured: at the toast's centre,
`document.elementsFromPoint` said toast LI, the walk said overlay.
**Decision.** Ask the browser. `deepestElementAt` now consults
`document.elementsFromPoint(x, y)` first — the engine's own hit test, with
stacking contexts, `pointer-events`, visibility and zero-size resolved
natively — and takes the first element of the stack inside the source
root. Parked sources all share the viewport origin, so the stack holds
every overlapping source's elements; filtering to the root keeps our
subtree's internal order and skips foreign sources. Verified it DOES see
parked canvas-fallback subtrees (Chrome 150). Same doctrine as the layout
oracle (#25): the style engine already solves this; reimplementing
stacking contexts in a walker is the losing move.
**The walk stays as fallback**, for the two places the browser can't
answer: a point outside the visual viewport (elementsFromPoint clamps —
a source taller than the window still forwards, DOM-order-approximate),
and layoutless test environments (happy-dom). When a real stack simply
holds nothing of the root, walker and browser agree the answer is null
(clear glass), so the fallthrough is harmless by construction.
**Verified** (lab 009, trusted CDP input): toast raised, dialog opened,
trusted click at the toast's projected screen point — forwarded
pointerdown targets the toast LI, dialog stays open. Regression sweep
after the change: tooltip two-hop transit, dialog open via forwarded
click, select layer open/Escape, input focus + native typing all intact.
**Scope.** This also answers the stacked-modal half of the #21/#23 gap:
two dialogs portaled into the same chrome source stack by CSS, and the
pointer now follows what CSS painted; focus already stacks (Radix pauses
the outer scope). Cross-surface arbitration was never CSS's — it is
depth, and the raycaster already speaks it.
**Rejected.** (a) *Teaching the walker z-index* — stacking contexts are
not a sort key, they're a tree (isolation, transforms, opacity all spawn
them); any partial implementation lies in exactly the cases that matter.
(b) *Constraining chrome DOM order to match paint order* — fights every
library's portal habits and breaks byte-verbatim vendoring.

## 28. The style bridge — custom properties are mesh channels (2026-08-01, #52)

**Context.** The library's standing doctrine is that the DOM is the
authority and the mesh performs (#17 conducted motion, #25 layout oracle).
But scene *state* — how lifted a card is, how open a drawer is, how warm a
glow is — still lived only in scene code, unreachable by the cascade. CSS
authors express exactly this kind of state as variants and transitions;
Tailwind ships the whole grammar (`[--depth:0.5]`, `hover:[--depth:1]`,
`transition-[--depth]`). The missing piece was a way for the scene to
*hear* it.
**Decision.** `createStyleChannel(el, property)` /
`useStyleChannel(property)` read a registered custom property as a number
channel. Registration (`CSS.registerProperty`, syntax `<number>`) is what
makes it work: a registered property is interpolable, so
`transition: --depth 600ms ease` runs a genuine CSSTransition — timed,
eased, and staged by the style engine — while painting **nothing**,
because a custom property no paint rule consumes never invalidates a
paint record. `getComputedStyle` mid-transition returns the eased
intermediate synchronously: the style engine is the interpolation oracle,
and no easing math exists in our code. The scene polls the getter in
`useFrame` and moves matter.
**Measured** (style probe, Chrome 150, trusted input): a full 600ms
`--depth` 0→1 transition = **0 paints, 0 uploads** on the card's source,
33 mid-flight samples all eased (82% progress at 30% time — the authored
`cubic-bezier(0.22,1,0.36,1)`, not a ramp), mesh z tracking `depth × lift`
every frame. The full transition event lifecycle
(`transitionrun`/`start`/`end`) fires for custom properties with
`propertyName` set, both directions. And the hover twin closes the loop:
a trusted pointer over the mesh → forwarded move → `[data-hover]` on the
card root → variant flips `--depth` → mesh lifts on CSS's curve; leave
reverses it. Hover-driven *mesh* motion with zero per-frame paints —
the thing #17 could not give the drawn root — falls out for free.
**The push half.** `observe()` exists for consumers without a frame loop
(notably `frameloop="demand"`, which needs `invalidate()` on change):
transition events bound an rAF sampling window — the #25 motion-window
shape — and a MutationObserver catches discrete, untransitioned flips
with one coalesced settle sample. The hook itself only polls; polling a
clean computed style is cheap and always correct.
**One-element contract.** A channel's value, transition, and variants
must be authored on the element the channel watches. Transition events
do not descend from ancestors — an inherited value would move and nobody
would hear it. `inherits: false` is the registration default for the
same reason.
**Rejected.** (a) *Watching keyframe animations too* — that's #17's
conductor; a channel is state, not choreography, and the two shapes
compose (a variant can flip a channel that a spring then chases).
(b) *A push-only API* — a subscription that misses its first event
before React commits reads stale forever; the pull getter is
self-healing by construction.

## 29. The forwarder is the scroll engine — wheel arbitration at document capture (2026-08-01, lab 010)

**Context.** No lab had ever put a scrolling region inside a Surface; the
handoff listed scroll containers as the deepest unsolved seam (paint
records, forwarded wheel, and scroll offset vs the hit test all open).
**Measured first:** the rasterization half was never broken. A
`scrollTop` change invalidates the paint record like any descendant
mutation — instant jump = exactly 1 paint, `behavior:'smooth'` = 1
paint/frame while gliding, pixels verified (rows 37–39 baked at the
bottom of an injected scroller). The hit test was never broken either:
`elementsFromPoint` and `getBoundingClientRect` both read scrolled
geometry natively. The seam is *input only*: the default scrolling
action runs exclusively for TRUSTED wheel events, and everything the
forwarder dispatches is synthetic — a forwarded wheel runs handlers and
scrolls nothing.
**Decision.** `forwardWheel` performs the scroll the way the browser
would have: dispatch the cancelable wheel to the deepest element first
(a `preventDefault` is a claim — cmdk and friends are honored), then
walk target→root for the nearest scroll container that can still move
in the delta's direction and mutate `scrollTop`/`scrollLeft` directly.
Direct mutation, not `scrollBy`: user scrolling is exempt from CSS
`scroll-behavior`, so instant is the faithful semantics — and `scroll`
events fire from the mutation for free (measured; message-scroller's
autoscroll machinery runs on them). A container at its end with
`overscroll-behavior: contain|none` stops the chain cold, consuming
nothing — shadcn's scroller viewport declares `overscroll-contain`, so
a chat log at its bottom refuses to become a camera zoom with zero
consumer code.
**The return value is the camera's verdict.** `true` = the surface
consumed it (handler claim, scroller moved, or containment boundary);
`false` = the wheel chained through everything — the ROOM is the next
scroll container, and the camera zooming is exactly scroll chaining
reaching the page.
**Where it listens, and why:** document capture (`trackWheel`,
reference-counted like `trackFocusModality`). OrbitControls listens on
the CANVAS — the wheel's real target — so a mesh-level `onWheel` hears
the wheel *after* the camera has already zoomed; the only seat ahead of
the target phase is capture above it. From there the hover mirrors
already know which surface is under the pointer and where its parked
point is (`hoverRoots`, maintained by updateHover/clearPointerState —
the WeakMap of mirrors can't be iterated). Consumed → `preventDefault` +
`stopImmediatePropagation`, so OrbitControls never hears it; scoped to
`e.target instanceof HTMLCanvasElement`, so page scrolling outside the
scene is untouched and the synthetic wheel (targeting parked DOM) can't
re-enter.
**Verified** (Chrome 150, trusted CDP wheel): wheel over the scroller
scrolls the parked DOM with the camera frozen; over the non-scrollable
card body the camera zooms; wheel-down at the contained scroller's end
moves *nothing* (scroll pinned, camera pinned); over empty canvas the
camera zooms. 11 happy-dom tests pin the protocol (claim, chain,
containment, direction, line-mode normalization, arbiter seat).
**Rejected.** (a) *Mesh-level `onWheel`* — arbitrates after the zoom
already happened (see above). (b) *`scrollBy` with smooth behavior* —
wrong spec semantics for user scrolling, and an animated scroll pays a
paint per frame where one was enough. (c) *Toggling
`controls.enableZoom` from hover state* — a mode flag racing pointer
moves, and it breaks wheel-over-panel zoom, which is correct whenever
nothing under the point can scroll.
**Consumers since** (2026-08-01, lab 010 inc 7): three scroll idioms
ride the seam with zero library changes. shadcn's message-scroller
(the original consumer); a Table inside shadcn's own
`overflow-x-auto` container given `overflow-y-auto` (note: `position:
sticky` pins to the *nearest* scrolling ancestor, and shadcn tables
always ship one — scroll that container, not a wrapper around it, or
the sticky header rides away with the rows; plain CSS, not the
medium); and Radix ScrollArea, whose viewport's inline `overflow:
hidden scroll` passes the same computed-style gate as a Tailwind
class, and whose custom scrollbar thumb is ordinary DOM moved from
`scroll` events — which the forwarder's direct mutation fires
natively, so the thumb tracks a forwarded wheel through the texture
(measured: viewport 0→310px, thumb `translate3d` 0→169.6px, camera
frozen).

## 30. No `mask-image` inside a drawn subtree — the mask blacks out the capture (2026-08-01, lab 010)

**Context.** Lab 010's chat panel mounted and rasterized *black* — the
whole card — except two buttons that painted perfectly, with clean paint
events, zero errors, and healthy DOM (computed background white, 928
chars of text, items laid out). The only novel style in the tree:
shadcn's `scroll-fade-b` on the message-scroller viewport, a
`mask-image` fade driven by @property-registered custom props and a
scroll-timeline animation.
**Measured** (Chrome 150, controlled single-variable toggles on fresh
mounts): with the mask on, black; `mask-image: none` alone, everything
paints; `animation: none` alone (mask kept, computed to a *fully opaque
no-op gradient* — fade size 0), still black. The mask is the killer,
not the scroll-driven animation, and not the mask's visible effect —
a mask that hides nothing still voids the capture.
**The shape of the failure** is the treacherous part: the blackout is
not scoped to the masked element. The viewport sat between a header
and a footer, and *all three* went black — the entire drawn root —
while the two elements that survived (`MessageScrollerButton`, the
composer's Send) are exactly the ones wearing `transition` classes,
i.e. independently composited. So the failure reads as "the panel is
black except random widgets," which points everywhere except the mask.
Same family as the drawn-root opacity/transform rule (#17's ancestor):
compositor-owned rendering never reaches the paint record — but this
one reaches *up* from a descendant and takes the whole capture with it.
**Decision.** No `mask-image` anywhere inside a drawn subtree. The
scroll-fade utilities stay in verbatim shadcn markup (a score, not a
performance — same doctrine as tw-animate-css, #17) and the dialect
stylesheet neutralizes the mechanism: `.ui-root/.ui-layer
[class*='scroll-fade'] { mask-image: none }` in `app/shadcn.css`,
unlayered so it outranks the `@utility` layer without `!important`.
The scroll-timeline animation is left running; with no mask consuming
its custom props it paints nothing.
**Rejected.** (a) *Editing the vendored component* — the class is the
authoring vocabulary; the port owns the dialect, not the score.
(b) *A blanket `* { mask-image: none }` in `src/three-ui.css`* —
silently restyling every consumer's content is the library overstepping;
the constraint is documented (platform.md) and each dialect answers for
its own utilities. (c) *Waiting for the platform* — the origin trial may
well fix mask capture; when it does, delete the neutralization and the
fades simply start working.

## 31. Hover grace is a screen-space corridor — exit points and the projected quad (2026-08-01, lab 010 / #36)

**Context.** #22 detached click-driven layers and proved their dismissal
survives (containment asks about the DOM tree, which detaching never
touched), and named the debt: *geometric* dismissal — the swept region
between a trigger and its content — asks about the plane, which
detaching destroys. #36 owed the ray answer for hover-driven detached
layers. The consumer arrived in lab 010: a HoverCard off the chat
panel's avatar, its content on a `FloatingSurface` in the room. Radix
hover-card has no grace polygon at all — just timers (`pointerleave`
arms a close, default 300ms; `pointerenter` on the content cancels it) —
which works on a page because trigger and content are pixels apart. A
detached layer turns that gap into a mouse flight across the screen,
racing the timer. Radix's page-space reasoning can't be repaired here:
both slabs' parked DOM stacks at (0,0), so no hull built in that space
means anything.
**Decision.** A grace tracker (`lib/hoverGrace.ts`), wired by
`FloatingSurface`'s opt-in `graceFrom` prop, holding the layer open
while the trusted pointer is inside the convex hull of: the padded exit
points (where the pointer left the trigger, and where it left the
content) plus the floating mesh's **projected screen quad**, re-projected
on every judged move so orbiting can't stale it. Screen space is the
load-bearing choice — it is the only space in which "the pointer is
travelling toward that slab" is even a statement, because it is the
space the *viewer's* adjacency lives in. The tracker never touches
Radix: it speaks the forwarder's own synthetic over/enter // out/leave
protocol at the content root, and Radix's stock timers do the rest —
dismissal stays exactly `closeDelay` after the corridor is exited, the
same lag a page hover-card has.
**The two bugs the browser bought, both now regression tests.**
(a) *The self-anchored hull*: anchoring a leave's exit point at the
pointer's current position makes the corridor follow the pointer — its
own pad is inside its own hull by construction. Measured live as a card
that never closed: the departure burst's content-leave re-armed the
tracker at the parked position, and a stopped pointer re-judges
nothing. The exit anchor must be the *previous* sample — where the
pointer was when it crossed — and a leave heard with the pointer
already outside the corridor is judged at arm time and stays silent.
(b) *The open-scoped tracker*: a tracker created when the layer opens
has no position history, so its first sample — mid-flight for a fast
pointer — becomes the corridor's trigger-side anchor, stranding the
return transit. The tracker lives as long as `graceFrom` does; a closed
layer keeps it harmless by construction (no content to speak to, no
quad to project).
**Listener seats, both asymmetries measured facts of the medium:** the
arm signal (a leave on trigger or content root) is always *synthetic* —
parked DOM never hears trusted events (#19) — so the leave listener
must not filter on `isTrusted`; the position feed must be *only*
trusted moves — the forwarder's copies carry parked coordinates — and
document capture hears them even over Surfaces, because #26's silencing
stops propagation at the canvas, downstream of capture.
**Verified** (lab 010, trusted CDP input, Chrome 150): card opens off
the avatar through the texture; pointer parked mid-corridor for 900ms —
three close-timer lifetimes — card holds; arrival holds; full return
transit to the trigger holds through a 900ms rest; wander-away from the
trigger closes; departure from the card off-corridor closes; everything
idles at 0 paints/2s after every close. 18 unit tests on the hull math
and the tracker protocol.
**Rejected.** (a) *A longer `closeDelay`* — tunes a timeout to one
scene's geometry, delays every legitimate dismissal, and still loses to
a slow pointer. (b) *Patching Radix or requiring wrapper props* — the
seam is ours; the tracker speaks a protocol every hover library already
listens to. (c) *A 3D corridor volume tested against the ray* — the
corridor's meaning is visual adjacency, which lives on the screen; a
room-space prism would hold the card open while the pointer visibly
points at empty sky from another camera angle. (d) *Projecting the
trigger's quad through UV plumbing* — exit points suffice (Radix's own
doctrine), and the trigger element's world rect would re-introduce
exactly the coordinate math the `container` lever exists to avoid.

## 32. A held button is a capture — drag consumers and the three lies of the forwarded gesture (2026-08-01, lab 010)

**Decision.** While a forwarded press is live (`surfaceDrag`, set by the
forwarded pointerdown, cleared by any release), the forwarder emulates
pointer-capture semantics, because that is what drag consumers actually
asked for: (a) forwarded moves carry the REAL `buttons` state
(`forwardPointer` gained the parameter; Surface passes
`e.nativeEvent.buttons`); (b) `trackDrag` — the third document-capture
seat in the wheel/hover family — `preventDefault`s trusted
canvas-targeted moves that hold a button; (c) `guardPointerCapture` on
every source-host container releases any pointer capture the instant
it is granted; (d) `clearPointerState` DEFERS: no boundary events, no
departure burst, until the drag ends, then unwinds honestly.

**Context.** react-resizable-panels v4 is the worked example, and it is
built the way most drag libraries are: `pointerdown` (document capture)
hit-tests coordinates against its separator's rect and stores the start
point; `pointermove` (document bubble) computes a delta from
`clientX/Y`, front door `if (e.defaultPrevented) return`, deactivates
on the first move with `buttons === 0`; `setPointerCapture` on the
separator per move. Every piece works in parked coordinates — IF the
narration is consistent. It wasn't, three ways:

**Lie one — forwarded moves said no button was held.** The forwarder
hardcoded `buttons: 0` on moves (hover was the only consumer that had
existed). A drag consumer deactivates on its own first frame. Moves now
carry the caller's state; down stays `1`, up stays `0`.

**Lie two — the trusted move told screen coordinates to a document
listener mid-gesture.** #26 silences trusted HOVER moves at the canvas
(`buttons === 0` only, deliberately, so a drag that began on empty
space keeps orbiting — that carve-out stands). A drag that began ON a
surface leaks its trusted moves to document bubble: two narrators, two
coordinate systems, interleaved in one delta stream. `trackDrag`
prevents them at document capture. `preventDefault`, NOT
`stopPropagation`: the consumer's front door checks `defaultPrevented`,
and propagation must survive because r3f delivers the forwarding
pipeline's own events from the canvas wrapper's bubble — a stop would
cut the branch we're sitting on.

**Lie three — our own departure burst announced `buttons: 0` from
inside the gesture.** Measured killing a drag 13px into an 80px pull:
mid-drag, a transient departure fired the #19 burst, whose moves are
built for hover dismissal and say no button is held — the exact
deactivation signal from lie one, this time self-inflicted. The
capture the consumer asked for (and was refused) means precisely "no
boundary events, no position reports from elsewhere, until release" —
so `clearPointerState` defers to a pending set while `surfaceDrag` is
live and flushes on release, up first, boundary events after, the
order a real capture ends in. Deferred, not dropped: the hover state
still has to unwind or it leaks past the gesture.

**And the capture itself.** The consumer calls
`setPointerCapture(pointerId)` on the parked separator. Synthetic
events share `pointerId: 1` with the real mouse, so the parked element
captures the REAL pointer — every trusted event thereafter retargets to
parked DOM, the canvas goes silent, r3f stops raycasting, and the
pipeline starves itself mid-gesture. `guardPointerCapture` (wired in
`useSourceHost`) releases on `gotpointercapture`; the consumer's
`hasPointerCapture` check simply re-asks next move and is refused
again. Parked matter must never hold the real pointer.

**Verified** (lab 010 workbench, vertical `ResizablePanelGroup`,
trusted CDP input, Chrome 150): an 80 panel-px pull moves the layout
exactly 80px, both directions, camera frozen throughout; a trusted
down at the PARKED separator's page coordinates does not phantom-drag
(v4's own occlusion filter sees the canvas painting above the parked
group and stands down) and correctly orbits the camera instead (#26's
carve-out); no `[data-hover]` leaks after the deferred unwind; idle 0
paints. 7 unit tests: buttons pass-through, arming/disarming, the
prevent's selectivity (synthetic, buttonless, and non-canvas moves
untouched), release-anywhere, capture-refusal, and the deferral round
trip.

**Rejected.** (a) *Suppressing the burst instead of deferring it* —
drops real hover state on the floor; the leave and its grace-area
consequences still have to happen, just not mid-gesture. (b)
*`stopPropagation` on trusted drag moves* — cuts r3f's own delivery
path (see lie two). (c) *Patching or wrapping the panel library* — the
seam is the forwarder's narration, not the consumer; every drag
library reads `buttons`, `defaultPrevented`, and capture the same way,
and fixing the narration fixes them all unpatched.

## 33. The material slot is a prop — `material="none"` and the texture through context (2026-08-01, lab 011)

**Decision.** `Surface` owns its mesh's material slot and exposes it as
a mode: `material="standard"` (default) renders the built-in
`meshStandardMaterial` exactly as before; `material="none"` renders no
material and lets the Surface's children supply one. The live DOM
`CanvasTexture` reaches that child through `useSurfaceTexture()` —
context, held as **state**, so consumers re-render when the texture
arrives instead of sampling null forever.

**Context.** Lab 011's dissolve: a transient card whose enter/exit is
authored as verbatim Tailwind (`animate-in fade-in-0` on a
descendant), seized by `useAnimationConductor`, and PERFORMED by a
`ShaderMaterial` — the conductor's eased `value.opacity` becomes a
`uProgress` uniform sweeping a noise-field burn threshold over the
texture. The reason this is cheap to support: everything else Surface
does — paint-driven uploads, LOD re-rasters, `setScale` tier swaps,
input forwarding — operates on the *texture* and the *mesh*, neither
of which the custom material displaces. The upload path writes into
the same `CanvasTexture` the shader samples; a foreign material
changes only who reads it.

**Constraints a custom material inherits.**
- A raw `ShaderMaterial` bypasses three's color pipeline: the fragment
  shader must end with `#include <tonemapping_fragment>` and
  `#include <colorspace_fragment>` or the texture renders washed out.
- Declare the sampler uniform up front (`uMap: { value: null }`) and
  assign the texture when it lands — no recompile. The
  `material.needsUpdate` bump Surface performs for its own map-keyed
  material is a built-in-material problem (three re-keys the program on
  map presence); a shader with a pre-declared sampler doesn't have it.
- The economics of decisions #17 carry over unchanged: drive uniforms
  from conducted curves or per-frame refs, never from DOM animation
  that would rasterize. The whole point is that the poles paint and
  the flight is free.

**Verified** (lab 011, Chrome 150): full enter+hold+exit toast
lifecycle in 8 paints total (~110 unconducted); trace confirms the
style engine's easing arrives through the conductor (0.817 at 53% of
a 900ms ease-out flight); burn front with ember rim visible in both
directions under trusted screenshots; idle 0 paints; forwarding intact
(`hitTest="content"` composes — the ray still reads DOM occupancy, not
the shader's discards).

**Rejected.** (a) *An `onTexture` callback prop* — children already
receive the mesh through `SurfaceContext`; the texture belongs beside
it, and a hook keeps the wiring inside the tree that owns the
material. (b) *`onBeforeCompile` on the built-in material* — keeps the
standard lighting model wrapped around the effect and welds the
shader to three's material internals; a clean slot is simpler and
strictly more capable. (c) *Compositing DOM into a second canvas the
shader reads* — an extra copy per paint for nothing; the
`CanvasTexture` is already the shared substrate.

## 34. Glass buffers are occlusion-ordered — a panel refracts only what is behind it (2026-08-01, lab 012 spike)

**Decision.** Glass panels (Surface `material="none"` + drei
`MeshTransmissionMaterial`) never let MTM render its own refraction
buffer. A scene-level coordinator owns one FBO per panel and feeds it
through MTM's `buffer` prop (which short-circuits its internal pass
entirely: `if (ref.current.buffer === fboMain.texture)`). Per frame,
panels sort near→far by camera distance and hide CUMULATIVELY: when
panel P's buffer renders, P and every panel nearer than P are
invisible. Buffer renders run under `NoToneMapping`, exactly as MTM's
internal pass does.

**Context — two measured artifacts, one cause: what's in the buffer.**
(a) MTM's self-hide is a DiscardMaterial swap on the HOST MESH ONLY
(`parent.material = discardMaterial`, verified in drei 10.7.7 source)
— children render into the buffer, so a Surface's content overlay quad
ghosted behind its own glass: every label doubled, one crisp copy, one
refracted. (b) These are screen-space buffers rendered from the
camera: hide-only-yourself leaves a panel that is physically IN FRONT
of you inside your buffer, and your refraction shows it — measured as
ghost "Continue" copies inside the front pill, delivered via the rear
card's refraction of the pill (a hall of mirrors, glaring on text,
invisible on blobs, which is why MTM's default survives in demos).
Physics is the tiebreak: light reaching a panel's back face never
passed through anything in front of that panel.

**Why not three's built-in transmission.** Its buffer renders opaques
only (`renderTransmissionPass(opaqueObjects, …)` in WebGLRenderer) —
a glass panel BEHIND another one vanishes entirely through the front
one. Structural; maintainers say "modify the renderer." MTM's
per-material FBO is the established glass-through-glass answer; the
coordinator keeps that property (rear panels render into front
panels' buffers with their own materials, one frame stale) while
fixing (a) and (b).

**The panel anatomy this banks.** World bends THROUGH the slab; ink
sits ON it: extruded rounded-rect glass body (never samples the DOM) +
transparent overlay quad reading `useSurfaceTexture()` at true UV,
lifted past the bevel. Both live under one group so one `visible`
flip hides the whole panel. Forwarding note: ExtrudeGeometry UVs are
shape-space garbage — pointer forwarding works because the ray's
first hit is the overlay quad's proper plane UVs; a glass panel
without an ink quad would need a UV-mapped geometry or
`hitTest="content"` reasoning of its own.

**Verified** (lab 012, Chrome 150, trusted input): three depth levels
in one frame — pill glass bending the password field's outline
(dispersion fringing at the rim) over card glass + ink over the DOM
wall; 121 fps with 2 per-panel buffer renders/frame (768² + 512²);
idle 0 paints on all three sources; click-through-glass landed native
focus, typing live with caret, hover twin stamped; 0 texture errors.

**Rejected.** (a) *MTM default self-render* — artifacts (a)+(b) above.
(b) *three built-in transmission (`transmissionSampler`)* — rear glass
vanishes; also surrenders buffer control. (c) *Excluding ALL ink quads
from every buffer* — kills the demo's best shot (rear panel's text
magnified through front glass) and isn't physical. (d) *depth-sorted
per-pair buffers (N² correctness)* — cumulative near→far hiding gets
the same correctness in N renders because occlusion is transitive
along the view axis. Open, deliberately: N-panel cost is N scene
renders/frame — the shared-buffer variant or the screen-space SDF
compositor (increment 2, the liquid look) is the scale answer.

## 35. "Max" is the library's word — `resolution="max"` and the guard applies to every form (2026-08-01, lab 012)

**Decision.** The `resolution` prop accepts `'max'`: pin the texture at
the highest tier the 4096px long-edge guard admits for this Surface's
size, resolved inside the library (`maxTier`) and re-resolved when the
Surface resizes. No LOD evaluations run, same as a fixed number. And
fixed numbers now actually honor the guard: a value that would exceed
it is clamped to the exact guard boundary (`clampScale` — a density,
not a rung) with a console warning.

**Context.** The glass demo wanted "always render at max res." The API
could pin (`resolution={n}`) but could not express *max*: the answer
depends on the tier ladder and the guard, both deliberately private to
`lodTier.ts` — so the scene hand-copied `[6, 4, 3, 2, 1.5, 1]` and the
4096 constant to compute card/pill 6×, wall 4×. That is the worst kind
of boundary breach: duplication doesn't break the build when the
ladder changes, it silently drifts. The decisive argument for a
keyword over an exported helper: a MEASURED Surface (fit-to-content
floating layers) doesn't know its size in time to ask — only the
library, at resize time, can resolve "max" and keep it resolved.

**The hazard this closed.** The prop doc promised "every form respects
the 4096px guard" but the fixed-number path never consulted it —
`resolution={6}` on the 880px wall would have allocated a 5280px
canvas, past GPU comfort, with no error. Warn-and-clamp, not silent
clamp: deviating from what the caller wrote without saying so is its
own bug.

**Shape notes.** `'max'` stays ON the ladder (wall → tier 4, not the
4.65 guard boundary) so a later switch to auto/range finds the texture
seated on a rung; a clamped *number* lands on the exact boundary
because the caller asked for a density, not a rung. Number-means-
pinned-and-off stays as is — one prop whose type carries the mode
beats a separate `lod={false}` flag that could contradict it.

**Verified.** lodTier suite (maxTier/clampScale, 272 total); browser:
lab 012 on `resolution="max"` resolves 4/6/6 identical to the
hand-computed pins, near/far camera sweep holds 0 paints.

**Rejected.** (a) *Exported `maxResolution(w, h)` helper* — solves the
authored-size case only; measured Surfaces still can't call it in
time. (b) *"Freeze at current tier"* recording mode — subsumed by
'max' for any scene that can afford the memory; build it when a real
scene can't. (c) *Silent clamp* — see above.

## 36. Filtering happens before the shader — pinned tiers carry mips, transparent ink premultiplies (2026-08-01, lab 012)

**Decision.** Two data-level rules, one theme: the GPU sampler acts on
raw texel data, so neither fix can live in a material. (a) A Surface
whose resolution is PINNED ('max'/number) always generates mipmaps and
samples trilinear; the mips-off policy survives only for ladder-tracked
tiers (auto/range) above 0.5. (b) A transparent DOM texture consumed by
an unlit overlay (the glass ink) is uploaded PREMULTIPLIED
(`texture.premultiplyAlpha = true`) and blended One/OneMinusSrcAlpha —
app-side for now, on the material-slot consumer.

**Context (a).** The no-mips policy's reasoning — "the tier ladder IS
the mip chain" — holds only while the tier tracks screen density. A
pinned tier deliberately oversupplies at range: the card's 6× texture
(2160×2640) is minified ~4× from across the room, and bilinear
minification without mips is aliasing by construction — measured as
shredded fine text and grid moiré the moment lab 012 pinned 'max'. The
`anisotropy = 8` set on every texture did nothing at all before this:
anisotropic filtering selects FROM the mip chain, and there wasn't one.
At near-1:1 the GPU samples the top level anyway, so close-up
sharpness — the reason for the pin — is untouched.

**Context (b).** Bilinear averages RAW rgb across texels. A glass root
rasterizes with real alpha, and `bg-white/10` texels are WHITE rgb at
α≈0.1 — straight-alpha filtering mixes that full-strength white into
every boundary with opaque content. Measured: a light halo hugging the
text-selection rectangle. Premultiplied data makes the average correct;
the custom blend factors stop the already-multiplied rgb from being
multiplied again. Exact for an unlit passthrough; under
`material="none"` the ink is the texture's only consumer, so the
upload flag skews nobody else.

**Open, deliberately.** Library-wide premultiplication is the
principled endgame — every transparent Surface (floating layers) has
this artifact class in miniature — but it changes the material-slot
contract (#33: every custom material must blend premultiplied) and
touches lit standard materials where the math is not a passthrough.
Migrate when a floating-layer halo is actually measured, with labs
009/010 in the browser as the regression net.

**Verified.** Lab 012, Chrome 150: selection-rect halo gone from code
(tight-crop A/B); wall fine text and grid lines resolve through
trilinear+aniso; stats confirm mips on all three sources, premultiply
+ CustomBlending on both ink quads, wall (opaque) correctly straight;
272 tests, idle contract untouched.

## 37. Sharpness is a density match, not an allocation — the demo returns to auto (2026-08-01, lab 012)

**Decision.** The glass demo's Surfaces ride the default auto LOD; the
lab-012 pins are gone. `resolution="max"`/number remain in the API for
what pinning actually buys — deterministic memory and zero mid-shot
re-rasters — but the docs and the demo now carry the measured price:
a pinned tier is SOFTER than auto anywhere the view is partially
minified. And Surface gained the missing half of the pin contract:
UNPINNING restores the dynamic filter policy from the live tier, so a
switch back to auto that lands on the same rung doesn't keep trilinear
mips forever.

**Context.** #36 gave pinned textures mips to fix across-the-room
aliasing; the same mips tax the close-up. Trilinear at density d on a
tier t samples mip lod = log2(t/d): the card's pinned 6× at a close
framing's d≈3.5 sits at lod ≈ 0.8 — most of the sample weight on a
box-filtered half-res level. Auto never enters that regime: it picks
the covering tier and, because drawElementImage replays a paint
record, "picking a tier" is a fresh vector rasterization at the
density the screen needs. No pinned allocation can beat that — max
allocation was never max sharpness. Measured at dpr 1, same framing:
pinned (4/6/6) vs auto (1/2/3) = ~6% edge-energy deficit, max pixel
diff 74/255, grid lines and glyphs visibly softer under the pin. At
lod ≈ 0.35 (extreme close-up) the penalty shrinks to near-invisible
(max diff 4/255) — it scales with the blend fraction, so any
mid-distance dolly through a pinned Surface crosses the worst of it.

**The bug the A/B caught.** The first comparison came back
pixel-identical because unpinning was a silent no-op: the pin effect
had no else-branch, so when auto landed on the same tier (no realloc),
nothing ever handed the filter policy back — stale trilinear mips for
the life of the texture, exactly the #35 promise ("a later switch to
auto finds the texture seated") broken at the filtering layer. Fixed
in the pin effect; verified live at the same-tier case (auto holding
6): `generateMipmaps` false, `minFilter` Linear. Corollary documented
in-code: the reverse edge (same-tier PIN on a texture allocated
without mips) is inert until the next realloc — texStorage2D fixes the
level count at first upload, so flipping `generateMipmaps` on
after the fact cannot add levels.

**Evidence-channel note, for future A/Bs.** agent-browser screenshots
are CSS-sized; at dpr 2 the capture is a 2× downsample of the render
buffer and both contested mip levels oversupply it — the difference
Pete sees on a retina display is INVISIBLE in the capture. Sampler
comparisons must run at dpr 1 (capture px = device px) or probe the
texture state directly instead of trusting pixels.

**Rejected.** Sharpening the pin itself (density-driven minFilter
toggling on a mips-always allocation): solvable, but it rebuilds the
tier tracker inside the filter policy to save a feature whose remaining
value — determinism — doesn't want it. If a shot needs no re-rasters,
it accepts the trilinear tax; that trade is now a documented property
of pinning, not a bug.

## 38. The glass is a distance field, not a mesh — one scene render, N screen-space passes (2026-08-01, lab 012 inc 2)

**Decision.** A glass panel renders no geometry. The mesh stays only
to be raycast (`material="none"` + a plain quad + `material.visible =
false`: `WebGLRenderer.renderObjects` skips the draw, the raycaster
ignores the flag, pointer forwarding keeps proper plane UVs). Pixels
come from a compositor that takes the render loop over (`useFrame`
priority 1 stops r3f auto-rendering) and runs: scene → one HalfFloat
target with a depth texture, panels hidden; then far→near, one
full-screen pass per panel ping-ponging between two targets; then one
blit to screen. Per pixel a pass rebuilds the eye ray, intersects the
panel's OWN plane, and evaluates a rounded-rect SDF in panel-local 2D
— so the panel keeps an arbitrary 3D pose while the field stays in its
frame.

**What the distance replaces.** Coverage = `smoothstep` over
`fwidth(d)`: exact analytic AA, no MSAA on the panel. The bezel is a
height field over `d` (quarter-circle profile over `bezel` world
units); the lens normal is the SDF gradient tilted by that profile's
slope — no vertices, no `curveSegments`, corner radius is a uniform.
One sample loop buys dispersion and frost together (each tap steps an
ior across `ior ± chroma` and jitters on a golden-angle spiral,
weighted by a spectral response and normalised, so `chroma = 0`
degrades to a plain blur rather than a tinted one).

**This deletes #34's ordering rule rather than reimplementing it.**
Passes ping-pong far→near, so a panel samples the composite of
everything already behind it — glass, ink and world. Multi-level
refraction is the shape of the loop. Ink composites inside the same
pass at panel-local UV (premultiplied, per #36 — `glass*(1-a) + rgb`
is the shader spelling of One/OneMinusSrcAlpha), which also clips it
to the same coverage that drew the glass.

**Colour pipeline.** Everything composites in linear HalfFloat; tone
mapping and the sRGB transfer happen once, in the blit, via
`<tonemapping_fragment>` + `<colorspace_fragment>` (available because
the passes are `ShaderMaterial`, not `RawShaderMaterial`). Related
correction: three already forces `NoToneMapping` for any render into a
target (`WebGLPrograms.js:176`) — the spike's manual save/restore in
`GlassBufferCoordinator` was belt-and-braces, not load-bearing.

**Two look bugs, both from the same wrong instinct.** (a) Frost scaled
*up* toward the rim → every bezel became a soft white halo. Frost
belongs to the flat glass; the rim is where the lens works. Profile
inverted. (b) The edge hairline ran over 55% of the bezel → a chunky
white border. At 14% it reads as an edge. Both were invisible in
reasoning and obvious in a screenshot.

**Measured** (lab 012, Chrome, 1280×720, 2 panels, `?glass=` A/B live).
Submission ledger, identical in shape at every scene size: MTM submits
**1.95× the draw calls and 1.95× the triangles** (empty: 41 / 105 k vs
20 / 42.8 k; +200 ballast knots: 1 523 / 9.21 M vs 782 / 4.72 M — under
3× because `ContactShadows` renders the scene too and both paths pay
it). At the lab's own size both sit on vsync (8.3 ms). Past the
ceiling the ledger becomes frames: at 1 600 ballast knots (72.5 M vs
37.3 M tris/frame) MTM falls to **102 fps**, the compositor holds
**119.9**. Occlusion, earned back by hand against the resolved depth
texture, cuts glass and ink exactly at a torus knot parked in front and
shows both through its holes. Click at the field's projected screen
position landed native focus on `#l12-email` through the invisible
proxy; typing came out crisp; after blur the card's paint counter froze
at 107 over 4 s (idle 0 paints/s; ~2/s while a caret blinks).

**Note on the timer query.** `EXT_disjoint_timer_query_webgl2` was
useless here — reported GPU-ms *fell* as triangle count rose 100×, so
it paces with the frame, not the work. Ratios from it (~1.7× MTM) are
not evidence; the call/triangle ledger and the past-vsync frame times
are.

**Rejected.** (a) *Keeping MTM and sharing one buffer across panels* —
restores the #34 ghosting the coordinator fixed, and still costs a
scene render. (b) *Screen-space rounded rects (camera-facing panels)* —
cheaper, but surrenders the orbit, which is the whole thesis. (c) *Ink
as a real mesh drawn after the composite* — it would have to leave the
main scene to sit above glass that is composited later; sampling it in
the pass at panel-local UV is one texture read and clips to coverage
for free. (d) *Scissoring each pass to the panel's screen bounds* —
correct optimisation, wrong increment: full-screen ping-pong is pure
fill and the ledger above says fill is not what's expensive yet.

**Open.** Scissoring, per (d). The *liquid* part is now #39.

## 39. A merged shape needs a merged gradient — the smooth-min union is three decisions, not one (2026-08-01, lab 012 inc 2b)

**Decision.** A panel may carry up to `MAX_BLOBS` (6) circles coplanar
with it, unioned into its distance field with a polynomial smooth
minimum. They are `GlassBlob` records — `{x, y, r}` in panel-local
world units — held in a stable array the scene mutates in place and the
compositor reads every frame. One coverage, one bezel, one refraction,
one pass.

**`smin` is the easy part.** The three things that actually make it
work:

1. **The bezel normal must be the gradient of the UNIONED field.** The
   analytic `sdRoundRectGrad` only knows the rectangle, so it gives the
   merged silhouette a rim that still believes it is a rectangle — the
   neck comes out flat and unlit, exactly where the curvature is
   interesting. With `uBlobCount > 0` the shader takes a central
   difference on `fieldAt` instead (`eps = max(fwidth(d), 0.0015)`).
   Four extra field evaluations, paid only by covered pixels — the
   coverage and depth early-outs are above it. The analytic path stays
   for `uBlobCount == 0`.
2. **The ink clips to the RECT, not to the coverage.** A satellite that
   has merged in is glass with nothing written on it. Clipped to
   coverage, the sampler's clamp-to-edge smears the card's border texel
   row across every bead. The texture belongs to the panel's rectangle;
   the glass is free to be any shape.
3. **A bead is not a Surface.** No DOM, so no paint budget, no raycast
   proxy, no registry entry — three floats in a uniform array, animated
   by a `useFrame` that costs no React render. Measured across the full
   animation: wall and pill paint counters frozen, card at 1/s and that
   is the caret. The liquid is outside the upload-on-paint contract by
   construction.

**Measured.** 0 / 3 / 6 beads: 8.3 ms median in all three, vsync-pinned
at 120 fps, 1 draw call, 2 triangles. That is *no regression*, not
headroom — the scene is nowhere near fill-bound. The load-bearing claim
is the shape of the cost, not the number: a bead is ALU inside a pass
that was already running, allocates nothing, and adds no draw call.

**Why it belongs in the record.** Everything else the compositor bought
over #34's mesh path was cheaper-not-different. This is the first thing
the mesh path could not do at any price: two meshes in a plane can only
overlap, and you would see two rims cross. Two distances merge, and the
neck is arithmetic. That asymmetry is the actual argument for the glass
having stopped being geometry.

**Rejected.** (a) *Analytic smin gradient* (blending the two shapes'
gradients by the smin weight) — exact and cheaper, but it has to be
re-derived per primitive pair and the union is already N-ary; the
central difference is one expression that stays correct as primitives
are added. Revisit if a profile ever says the four taps matter. (b)
*Blobs as their own registered panels* — they would each get a
full-screen pass and could then only overlap, which is the thing being
fixed. Merging requires one field, so it requires one pass. (c)
*Non-coplanar blobs* — the pass intersects the eye ray with one plane;
a blob off that plane is a different surface and cannot share a bezel
with the card. Coplanarity is not a simplification here, it is what the
word "merge" means.

## 40. The contact ripple is a capillary impulse, not a scrolled packet (2026-08-01, lab 012 inc 2c)

**Decision.** A satellite making or breaking contact with a panel emits a
`GlassRipple` — an origin in panel-local units, an age, and a signed
amplitude. The shader adds it to the same height field the bezel already
is, so the ripple contributes a second slope along its own radial
direction and refraction bends through it for free. Up to `MAX_RIPPLES`
(4) per panel.

**Contact detection is CPU-side, and that is not laziness.** It is a
sign change over time — the gap between the two *surfaces* crossing zero
— and a fragment shader has no memory of last frame. Three SDF
evaluations per frame in JS, with a hysteresis band borrowed from the
smooth-min's own blend radius so a bead grazing the boundary doesn't
machine-gun ripples on consecutive frames. The shader receives the
conclusion, never the state machine.

**Why the first version read as tacked on.** Three physical omissions,
all of which the eye catches without being able to name:

1. **No geometric spreading.** A circular front carries its energy
   through a circumference 2πr, so amplitude must fall as 1/√r. Decaying
   only with age means the wave hits the far edge as hard as it left.
2. **No dispersion.** A fixed-wavelength packet translated at fixed
   speed is a scrolled decal. The regime here is capillary (surface
   tension, not gravity): ω = C k^(3/2), v_group = (3/2) C √k, so short
   waves lead. Substituting the stationary-phase condition r = v_group·t
   into the phase collapses the whole train to
   **θ = K r³/t²**, with **k = dθ/dr = 3K r²/t²**. Two lines. The
   pattern is self-similar along r ~ t^(2/3) — measured front
   0.16→1.54 while wavelength grows 0.29→0.58 — so it slows and coarsens
   together, which is the part that cannot be faked by amplitude.
3. **It ran over the rim.** The bezel is a thick edge, not a membrane;
   the ripple is masked by the bezel coordinate and dies into it.

**Two consequences of taking it seriously.** (a) A *delta* impulse makes
the opening frames 16× more violent than the closing ones. A bead is not
a point and cannot radiate wavelengths shorter than itself, so a gaussian
source spectrum keyed to its radius flattens the run to a smooth
0.73→0.06 with no hand-authored ramp. (b) Waves break — past a steepness
a surface is no longer a graph over the plane — so a soft saturation on
the accumulated tilt replaces frames that would fold the lens inside out.

**Impulse = closing speed × bead radius**, sampled at the contact frame.
This makes liveliness an authoring input rather than a cosmetic one:
raising the orbit rate moved merge impulses 0.36–0.73 → 0.62–0.94 with
no ripple parameter touched, and releases stay weaker than merges on
their own because separation is gradual where contact is sudden.

**Measured.** Unchanged: 8.3 ms median, vsync-pinned 120 fps, 1 draw
call, 2 triangles. Paint counters did not move across 3.2 s of active
rippling (wall 1, card 48, pill 5) — the simulation is pure uniform
traffic and never touches the DOM. Verified by browser capture: real
contacts produce trains that originate at the neck and sweep across the
panel; the rim hairline stays crisp; text stays crisp.

**Rejected.** (a) *Gaussian packet at constant speed* — the original;
non-dispersive, and no amount of tuning fixes what it structurally
cannot do. (b) *Boundary reflection* — a rounded rect needs four image
sources, so 4× the loop. Absorbing at the rim is cheaper and, for a
thick edge against a thin sheet, closer to true. Open if a panel ever
needs to ring. (c) *Warping the ink with the wave* (`rippleInk`, default
0) — sells the liquid harder and costs the thesis; the world bends
through the glass, the DOM sits on it. Left as a knob, not a default.
(d) *Simulating the surface on a state texture* — a real wave equation
would buy reflection and interference, but needs a per-panel ping-pong
target and a fixed timestep. The analytic impulse is stateless, exact at
any frame rate, and resumable — worth revisiting only if panels need to
interact through the same sheet.

## 41. A layout is one distance field — the union of rounded rects (2026-08-02, lab 013)

**Decision.** `fieldAt` unions an optional base rect with up to
`MAX_RECTS` (12) rounded-rect satellites and `MAX_BLOBS` circles, all
through the same `smin`. A panel is no longer *a* shape; it is a set of
shapes that happen to share a plane, a pass and a texture. Lab 013's rail
is one panel holding a header strip and five thread rows; its transcript
is one panel holding N message bubbles.

**Why it matters more than it sounds.** The old model priced a UI at one
screen-space pass per piece of glass. This one prices it per *plane*.
Five thread rows, six bubbles and a composer cost four passes total, and
adding a seventh message costs nothing — the field just has one more term.
That is the difference between a demo with a fixed cast and a layout.

**The split is a shape animation, not a layout animation.** The sign-in
card's field is two rects that start *coincident* — `smin(d, d, k)` is
`d - k/4`, the same shape dilated by a quarter of the blend radius, which
at k = 0.035 is a pixel and a half nobody will ever see. So frame zero is
a card, and nothing in the shader knows it is about to become an app. The
two rects then walk to the rail's and the pane's ends on separate curves:
height first (`raw / 0.62`), then the tear sideways (`(raw - 0.16) /
0.84`). Doing both at once reads as a rectangle being scaled. Staggering
them reads as something being pulled apart, because that is the order in
which real things fail.

**The blend radius is the animation.** `smooth` runs
`0.035 + 0.42·sin(π·u)^0.8` across the split: the union bulges into a
thick neck as the two halves separate, then collapses back to a hairline.
Without it the panes cross-dissolve; with it there is a *ligament*, and
the eye reads a break. The mid-split value (0.45 world units) is an order
of magnitude past anything lab 012 used for merging beads — a neck is not
a fillet.

**Snap detection falls out of the same geometry as the merge test in
#40.** The gap between the two rects' facing edges is compared against
the live blend radius each frame; the frame it stops being bridged, the
ligament has snapped, and two ripples go out from where it was — one into
each half. Nothing authored the moment; it is read off the field.

## 42. One texture, many pieces of glass — `uInkRect` (2026-08-02, lab 013)

**Decision.** The DOM's rectangle and the field's shape are now separate
uniforms. `uInkRect` (centre + half extents, panel-local) says where the
texture lands; the field says where glass exists; the composite weights
the ink by the field's coverage — `mix(base, glass, cov)` with the ink
already inside `glass`. Where the field is empty the ink simply never
draws.

**What this buys.** A rail's DOM is one 240×800 element spanning the
whole column, with rows absolutely positioned inside it. The glass exists
only where the rows are. The gaps between rows show the world, not the
element's background, and no clipping, no masking and no second texture
were involved — the coverage term was already being computed for the
edge antialias. (Masking would have been the obvious move and is
forbidden anyway: a `mask-image` anywhere in a drawn subtree blacks out
the whole capture. See the hard rules.)

**The corollary is a house rule.** Because one texture now spans many
pieces of glass, the DOM boxes and the SDF rects have to agree to the
pixel or the text slides off its own bubble. They are therefore authored
once — `app/scenes/lab013Layout.ts`, in CSS px — and each consumer
converts at its own edge: `w()` divides down to world units for the
shader, `css()` flips +y and emits `left/top/width/height` for the DOM.
Two conventions, one source, one place where the flip happens.

## 43. Compositing order is view-space depth, not distance to the camera (2026-08-02, lab 013)

**Decision.** The far→near sort key is the panel origin's **z in view
space**, not `camera.position.distanceTo(worldPos)`.

**The bug this was.** Distance and depth agree only for panels near the
view axis, which is exactly where lab 012's two panels sat — so the wrong
key shipped and passed. Lab 013 put a rail one sixth of the way across a
1468-px-wide app. Off-axis by 3.5 world units at a viewing distance of
7.4, the rail is *farther by Pythagoras* (8.09 vs 7.40) while being no
deeper at all, so it composited first — and the shell, genuinely behind
it, then refracted the rail's already-composited ink through eight
dispersion taps. Every glyph in the thread list came out smeared and
ghosted.

**Why it cost so much to find.** There was no error, the paint counters
were clean, `scale` was 1 on every panel, and the parking canvas dumped
via `toDataURL()` was pixel-perfect — the rail's DOM had rasterized
exactly right. Three hypotheses were burned on the ink path (LOD tier,
UV mapping, implicit-derivative mip selection in divergent control flow)
because the artifact *looked* like a sampling problem. It was a sorting
problem two files away. The tell, in hindsight, was that the smear was
directional and repeated: eight ghosts is the dispersion tap count, and
nothing in the ink path has eight of anything.

**The general shape of the lesson.** Painter's algorithm orders by depth.
Distance-to-eye is a different quantity that happens to be monotonic in
depth for a narrow cone around the view axis. Any sort that used the
easy one and was validated on a centred scene is carrying this bug.
