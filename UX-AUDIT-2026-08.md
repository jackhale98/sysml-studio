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

**B1. No undo, and dialogs mutate the file irreversibly.** [fixed]
Create/Edit/Delete each replace the whole document via `updateSource`.
CodeMirror's own history is destroyed on every tab switch because
`AppShell` conditionally mounts `EditorView`, so a delete performed in
the Browser cannot be undone from the Editor. Rename is whole-file and
unpreviewed.
Fixed: per-file source snapshots (capped at 50) with `applyEdit`,
Ctrl/Cmd+Z, Ctrl+Shift+Z / Ctrl+Y, header undo/redo buttons, and the
editor now always mounted (hidden with CSS) so its own history, scroll
position, and folds survive tab switches. Ctrl+S saves from anywhere.

**B2. Errors are computed and then discarded.** [fixed]
`model-store` sets `error` on every failure path and nothing renders it;
the only consumer colours an 8×8px dot with a `title` tooltip, which
does not exist on touch. Analysis panels now report through a shared
banner **[fixed]**, and the new Risk/Tolerance/Run-Calc panels surface
their own failures, and the store-level `error` (failed open, save, or
parse) now renders as a dismissible `role="alert"` banner in `AppShell`.

**B3. On mobile you cannot get anything out.** [fixed]
Save writes into the app sandbox when `filePath` is a bare filename;
`pickSaveFile` has no mobile implementation and `handleSave` has no
try/catch, so the button silently does nothing. CSV and PNG export use
`<a download>`, which WKWebView ignores.
Fixed: `src/lib/export.ts` routes every export through the Tauri save
dialog and a real file write (the anchor remains only as a browser-dev
fallback); save forces Save-As when the path has no directory component,
and a rejected save reports why. CSV export also added to the BOM and
Run Calc panels, which had none.

**B4. PNG export produces a broken image everywhere.** [fixed]
The exporter serializes a detached SVG clone whose fills are CSS custom
properties (`var(--text-primary)`, …). Detached from `:root` they
resolve to nothing, and the canvas gets no background — the only visual
deliverable the app produces does not look like what is on screen.
Fixed: computed fill/stroke/font values are copied node-for-node into
the clone, the canvas is painted with `--bg-primary` first, and an
`onerror` handler reports failure instead of doing nothing.

**B5. Creating a "satisfy" produces a relationship the app then reports
as missing.** [fixed]
The dialog collected only the requirement and emitted `satisfy R;` with
no `by` target, so the MBSE dashboard listed that very requirement as
unsatisfied. The emitter now writes `satisfy R by X;` when a target is
given.

---

## Friction

**Information architecture.** [partly fixed] A `useViewport` hook now
keeps the element browser beside the active view at ≥900px, and Ctrl+S /
Ctrl+Z / Ctrl+Shift+Z are global. Still open: cross-tab navigation
clears the selection context, and there is no open/new/go-to-element
shortcut.

**Creation.** The Browser's Add action passes the parent's *kind* as the
suggested kind and never passes the category, so the kind selector and
the form below it disagree. No duplicate-name check. Multiplicity is
free text with no validation. "New Model" produces an empty package —
no scaffold with the imports, a requirement, a part, and a view that a
real model starts from. **[open]** The Add-action kind/category desync
and the mislabelled example are **[fixed]**.

**Editing.** [partly fixed] The unified diff is now shown as a
dismissible confirmation (expandable to the changed lines). Still open:
edit exposes only name/short
name/type/value/doc, so multiplicity, specialization, redefinition,
port direction, guards, and requirement text are authorable at creation
but not afterwards. Doc is a single-line input. No batch or multi-select
editing. The text editor has no completion, go-to-definition, hover, or
rename. **[open]**

**Analysis.** Parameter binding guesses by suffix matching, takes the
first match arbitrarily, and presents the result as fact — with no way
to override the binding. What-If and Sweep require typing dotted paths
by hand with no picker and no feedback when a path matches nothing. No
no way to record a result back into the model, so the loop still ends
outside the model **[open]**. CSV export and clickable rows that select
the contributing element are **[fixed]** for the BOM and Run Calc
panels; the remaining panels still dead-end **[open]**.

**Mobile.** [partly fixed] Dialogs now track `visualViewport` and sit
above the on-screen keyboard, and pinch-zoom is re-enabled. Still open:
swipe actions are undiscoverable and have no desktop equivalent.

**Feedback and trust.** Loading is a coloured dot. When a parse fails
the last-good model stays on screen unmarked. Numbers were not traceable
to their source; the new panels link every row to its source line
**[fixed]**, and derived values name the calc that produced them
**[fixed]**, but BOM totals still offer no drill-through **[open]**.

**Accessibility.** [partly fixed] Dialogs close on Escape, trap and
restore focus, and carry `role="dialog"`/`aria-modal`/`aria-label`;
`--text-muted` went from ≈2.8:1 to ≈7.8:1. Still open: interactive
`<div onClick>` throughout is not keyboard reachable, tabs lack
`role="tab"`, and diagram nodes are bare `<rect onClick>`. **[open]**

---

## Gaps against the domain

Impact analysis is now wired into the element detail sheet, and its
traversal was corrected — it followed containment outward, so a
package's "impact" was the whole model; it now follows dependency edges
(what refers to this element, transitively, plus a requirement's
satisfiers and verifiers). **[fixed]**

Absent entirely: version comparison or diff against a baseline; reporting or
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

## Remaining work, in order

All five blocking findings are fixed. What is left:

1. Record analysis results back into the model (write a computed value
   into an attribute, attach a verdict to a verification case) — the
   analysis loop still ends outside the model.
2. Editing parity with creation: multiplicity, specialization,
   redefinition, port direction, guards, requirement text, and
   multi-line docs are authorable at creation but not afterwards; add
   batch/multi-select editing.
3. Editor as a first-class path: completion, go-to-definition, hover,
   rename — the LSP-shaped features the CLI's server already implements.
4. Model scaffolds for "New Model", duplicate-name checks, and
   multiplicity validation.
5. Remaining accessibility: keyboard-reachable rows and diagram nodes,
   `role="tab"` on the tab bar, light-theme type badges.
6. Domain gaps: model diff against a baseline, reporting/deliverables, a
   requirements table editor, project/library browsing, parametric
   diagrams.
