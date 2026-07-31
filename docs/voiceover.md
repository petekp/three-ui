# VoiceOver truth session — manual script

Automation has verified everything the DOM can attest: roles, labels,
`aria-valuetext` updates, focus order, `document.activeElement` never
lying. What it cannot attest is **what a screen reader actually says**,
because VoiceOver runs its own cursor, its own interaction model, and
its own opinions about canvases and role-less divs. This script is a
~30-minute session for a human (Pete) to run once, recording verbatim
announcements. Findings feed the announcer kit (task #33) and decide
whether the unit-stop contract needs an ARIA layer before the demo.

Two kinds of checkpoints below:

- **EXPECT** — grounded in ARIA we set; a miss here is a bug.
- **OPEN** — a genuine unknown we are measuring, not asserting. The
  known-weak spots are flagged; "it said nothing useful" is a valid
  and valuable result.

## Setup (5 min)

1. Chrome 148–151 with the origin-trial flag
   (`chrome://flags/#canvas-draw-element` or the usual
   `--enable-features=CanvasDrawElement` launch). Dev server at
   `http://localhost:5173`, **lab 008** tab. Confirm the HUD chip
   `drawElementImage ✓`.
2. VoiceOver on: **⌘F5**. The VO modifier below is **Ctrl+Option**
   (written `VO`).
3. **Turn QuickNav OFF** (tap Left+Right arrows together until
   "QuickNav off"): our scene consumes plain arrow keys, and QuickNav
   would swallow them first.
4. Check the setting VoiceOver Utility → Navigation → "Keyboard focus
   follows VoiceOver cursor" and note its state (either is fine — we
   probe both directions in Part C).
5. Reduced motion: if your system has it on, every camera move will
   jump-cut. That is the rig's `auto` mode working, not a bug.

## Part A — lab 008, the small scene (~10 min)

Walk with **plain Tab / Enter / Escape / arrows** (no VO modifier) and
write down each announcement verbatim.

| # | Action | Checkpoint |
|---|--------|-----------|
| A1 | Click once on the page background, then press **Tab** until something in the scene reacts | **OPEN** — what does VO say at the scene-entry stop? The focus target is the WebGL `<canvas>` (no role, no label). Hypothesis: silence or "HTML content". This is expected to be poor — record exactly what it says. |
| A2 | **Tab** again — the console panel glows (unit selected) | **OPEN / known gap** — the focused element is the panel's root `<div>`: `tabindex="-1"`, **no role, no aria-label**. VO may read the panel's full text, or say nothing. Whatever it says here is the raw material for the announcer kit. |
| A3 | **Enter** on the console (camera rides in) | **EXPECT** — "Callsign, ember-3, edit text" or close: the input is a real, natively focused `<input>`. If VO says this, the whole thesis holds — the parked DOM is first-class to AT. |
| A4 | Type a few characters | **EXPECT** — VO echoes typed characters per your echo settings; text lands in the field (watch the panel repaint). |
| A5 | **Tab** → Transmit | **EXPECT** — "Transmit, button". |
| A6 | **Enter** on Transmit | **OPEN** — the log line under the button changes ("Sent as …"). Does VO announce the change? It is a plain text mutation with **no live region** — hypothesis: silence. A silent result here is the announcer kit's second work order. |
| A7 | **Escape** (release — camera rides home) | **OPEN** — focus moves back to the role-less unit root; same gap as A2. Also note: did Escape reach the page at all? (VO sometimes claims Escape inside its own interactions.) |
| A8 | **ArrowRight** twice → tuner panel, then **Enter** | **EXPECT** — the tuner has no focusable DOM, so descend lands directly on the dial's proxy: "Tuner frequency, slider, 880 Hz" (or whatever detent it holds). Role, label, and value all come from ARIA we set — a miss is a bug. |
| A9 | **ArrowRight / ArrowLeft** on the dial | **EXPECT** — each detent announces the new value ("1.76 kilohertz" …): `aria-valuenow/valuetext` update on the focused slider, which VO announces by default. Note the *timing* — announcements should track detents (~instant), not the physics settle (~2.7s). Note whether "hertz"/"kilohertz" reads sensibly. |
| A10 | **Escape**, **Escape** | **OPEN** — ladder back to unit, then scene/canvas. Same role-less stops as A2/A1. |

## Part B — lab 006, scale (~5 min)

Switch to the **lab 006** tab. Same grammar, 33 panels, three rows.

| # | Action | Checkpoint |
|---|--------|-----------|
| B1 | **Tab** into the scene, then Tab across ~5 panels | **OPEN** — is VO responsive at 33 registered groups while the camera rides? Any lag between the glow moving and the announcement? |
| B2 | **Enter** on a text-heavy panel (a doc), then **VO+Right** a few times | **EXPECT** — VO's cursor walks the panel's interior content (headings, paragraphs) like any web page: the parked subtree is real DOM. If VO+Right escapes the panel into unrelated page chrome immediately, record where it went. |
| B3 | **Enter** on the synth panel, Tab to the dial, arrows | **EXPECT** — same slider contract as A8/A9 ("Cutoff", detent values). |
| B4 | Plain **arrows** at unit level across a row | **OPEN** — does VO say anything as unit selection moves (role-less roots again)? Does anything *interfere* with the spatial pick? |
| B5 | **Escape** from an engaged panel | **OPEN** — same as A7, at scale. |

## Part C — VO-native navigation (~5 min)

The walks above used our keyboard grammar. Now probe VO's own.

| # | Action | Checkpoint |
|---|--------|-----------|
| C1 | **Rotor → Form Controls** (VO+U, arrow to Form Controls) | **OPEN** — hypothesis: the list shows Callsign, Transmit, and "Tuner frequency, slider" (the proxy is a real focusable element). If the dial proxy is *missing*, the proxy layer isn't in VO's content tree and that's a finding. |
| C2 | Jump to the slider from the rotor | **OPEN** — does jumping focus the proxy, and does our focus system follow (panel glows, `data-focus` chrome appears)? This is the "VO cursor vs DOM focus" divergence probe. |
| C3 | With "keyboard focus follows VO cursor" toggled the *other* way, repeat C2 | **OPEN** — record the difference. This setting decides whether we must listen for VO-initiated focus. |
| C4 | **VO+Right** from the page top, straight through | **OPEN** — in what order does VO encounter: HUD chrome → canvas → proxy layer → parked sources? The parked sources are position-fixed at the viewport edge; VO may read all 3 panels' text *after* the canvas. Record the sequence — it tells us whether parked subtrees need `aria-hidden` when not engaged (a real design decision: hiding them also hides them from the rotor). |

## Recording

For each row: its ID, **verbatim announcement** (or "silent"), and a
severity gut-call (fine / awkward / blocker). Screenshots optional;
the words are the data. Drop the notes in a session file or straight
into the next working session — increments get planned from this
table.

## What happens with the findings

- A2/A7/B4 (role-less unit stops) → the announcer kit's design
  input: likely `role` + `aria-label` on unit roots, or a polite live
  region that narrates unit selection ("Console, panel, 2 of 3") —
  decided by what VO actually said, not by spec-reading.
- A6 (silent DOM mutations) → live-region policy for
  Surface-content changes.
- C4 (parked-source reading order) → the `aria-hidden`-when-parked
  decision, weighed against rotor discoverability.
- Anything that contradicts `docs/focus.md`'s contract gets a
  decisions.md entry before code changes.
