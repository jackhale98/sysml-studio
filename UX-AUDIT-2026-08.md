# SysML Studio — UX and workflow audit, 2026-08

Scope: the whole React front end (`src/`) plus the Tauri command surface
it drives, judged as a tool a systems engineer uses to **create,
analyze, edit, and act on** models — on desktop and on a phone.

One-line verdict: the authoring surface is unusually rich (a create
dialog covering ~50 element kinds, model-aware pickers, live source
preview), but it sits on a shell with no undo, invisible errors, no way
to get results out on mobile, and no path from an analysis result back
to the model. An engineer can create and inspect; they cannot yet
safely change, verify, or deliver.

Status key: **[fixed]** resolved in this pass · **[open]** outstanding.

---

## Blocking

**B1. No undo, and dialogs mutate the file irreversibly.** [open]
Create/Edit/Delete each replace the whole document via `updateSource`.
CodeMirror's own history is destroyed on every tab switch because
`AppShell` conditionally mounts `EditorView`, so a delete performed in
the Browser cannot be undone from the Editor. Rename is whole-file and
unpreviewed.
→ Keep a source-snapshot stack in `model-store` with a global Ctrl/Cmd+Z,
and render `EditorView` always (hide with CSS) instead of unmounting.

**B2. Errors are computed and then discarded.** [partly fixed]
`model-store` sets `error` on every failure path and nothing renders it;
the only consumer colours an 8×8px dot with a `title` tooltip, which
does not exist on touch. Analysis panels now report through a shared
banner **[fixed]**, and the new Risk/Tolerance/Run-Calc panels surface
their own failures **[fixed]**, but the store-level `error` (failed
open, failed save, parse failure) is still invisible **[open]**.
→ Render `error` as a dismissible banner in `AppShell`.

**B3. On mobile you cannot get anything out.** [open]
Save writes into the app sandbox when `filePath` is a bare filename;
`pickSaveFile` has no mobile implementation and `handleSave` has no
try/catch, so the button silently does nothing. CSV and PNG export use
`<a download>`, which WKWebView ignores.
→ Route save/export through Tauri fs + the share sheet; force Save-As
when `filePath` has no directory.

**B4. PNG export produces a broken image everywhere.** [open]
The exporter serializes a detached SVG clone whose fills are CSS custom
properties (`var(--text-primary)`, …). Detached from `:root` they
resolve to nothing, and the canvas gets no background — the only visual
deliverable the app produces does not look like what is on screen.
→ Inline computed colours into the clone; paint the background first.

**B5. Creating a "satisfy" produces a relationship the app then reports
as missing.** [fixed]
The dialog collected only the requirement and emitted `satisfy R;` with
no `by` target, so the MBSE dashboard listed that very requirement as
unsatisfied. The emitter now writes `satisfy R by X;` when a target is
given.

---

## Friction

**Information architecture.** Cross-tab navigation clears the selection
context. Desktop gets the phone layout verbatim — there is no responsive
code at all, while the window opens at 1280×800, so a desktop user gets
one full-width view and a bottom tab bar instead of the browser+editor+
diagram tri-pane the work calls for. No global shortcuts (save, open,
new, undo, go-to-element).

**Creation.** The Browser's Add action passes the parent's *kind* as the
suggested kind and never passes the category, so the kind selector and
the form below it disagree. No duplicate-name check. Multiplicity is
free text with no validation. "New Model" produces an empty package —
no scaffold with the imports, a requirement, a part, and a view that a
real model starts from. The bundled example is mislabelled ("Vehicle
System"; it is a relief valve). **[open]**

**Editing.** The backend computes a unified diff and post-edit parse
errors and the front end reads neither — a "here is what changed"
confirmation is one binding away. Edit exposes only name/short
name/type/value/doc, so multiplicity, specialization, redefinition,
port direction, guards, and requirement text are authorable at creation
but not afterwards. Doc is a single-line input. No batch or multi-select
editing. The text editor has no completion, go-to-definition, hover, or
rename. **[open]**

**Analysis.** Parameter binding guesses by suffix matching, takes the
first match arbitrarily, and presents the result as fact — with no way
to override the binding. What-If and Sweep require typing dotted paths
by hand with no picker and no feedback when a path matches nothing. No
export from the analysis tab at all, and no way to record a result back
into the model, so the loop ends in a screenshot. Results are now
clickable in the three new panels **[fixed]**; the older panels still
dead-end **[open]**.

**Mobile.** Good bones: 44px targets, safe-area insets, bottom sheets,
a well-built swipe row, hand-rolled pinch/pan. But there is no keyboard
handling anywhere (`visualViewport` is never consulted) while every
dialog is bottom-anchored — the primary button sits exactly where the
keyboard appears. Swipe actions are undiscoverable and have no desktop
equivalent. Zoom is disabled app-wide alongside 9–11px mono text.

**Feedback and trust.** Loading is a coloured dot. When a parse fails
the last-good model stays on screen unmarked. Numbers were not traceable
to their source; the new panels link every row to its source line
**[fixed]**, and derived values name the calc that produced them
**[fixed]**, but BOM totals still offer no drill-through **[open]**.

**Accessibility.** No ARIA anywhere, no focus trapping or restoration,
no Escape-to-close, and `--text-muted` on `--bg-primary` is ≈2.8:1 —
below the 4.5:1 threshold — while being used for labels, counts, and
column headers. Interactive `<div onClick>` throughout is not keyboard
reachable. **[open]**

---

## Gaps against the domain

Absent entirely: impact analysis (implemented in Rust, registered, and
called by no component — "what breaks if I change this?" is one import
away); version comparison or diff against a baseline; reporting or
deliverable generation beyond three CSVs and a broken PNG; a
requirements table editor (ID / text / rationale / verification method /
status); review and collaboration state; project/library browsing; and a
parametric diagram despite calc and constraint defs being first-class in
the create dialog.

FMEA and tolerance analysis are deliberately *not* app features: like
the CLI, which has `view <name>` and no `fmea` command, the analysis a
model wants is declared in the model as view defs and calc defs, and the
app renders and evaluates whatever it finds. The Views tab is that
surface (with an empty state that shows what to write), and the Run Calc
panel is its ad-hoc counterpart. **[fixed]**

---

## Suggested order

1. Surface store-level errors (B2 remainder) — everything else is
   unverifiable while failures are invisible.
2. Global undo + persistent editor mount (B1) — makes editing safe.
3. Mobile save/share and correct PNG (B3, B4) — makes the mobile target
   viable at all.
4. Wire the existing `EditOutcome.diff` into a post-edit confirmation and
   `getImpactAnalysis` into the detail sheet — two complete backends
   waiting for a small amount of UI each.
5. Make the older analysis results clickable (every payload already
   carries `element_id`) and add CSV export to the analysis tab.
6. Responsive desktop layout; then accessibility (focus, Escape, ARIA,
   contrast).
