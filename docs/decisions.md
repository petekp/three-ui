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
