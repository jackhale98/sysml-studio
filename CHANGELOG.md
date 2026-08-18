# Changelog

## 0.6.1 — 2026-08-17

iOS release plumbing; no application changes.

- Build with Xcode 26 on `macos-26`: App Store Connect now rejects
  anything not built with the iOS 26 SDK. A "Select newest Xcode" step
  picks the highest installed Xcode and fails fast with a readable
  message if it predates 26, instead of building for ten minutes and
  being rejected at upload.
- Deployment target raised to iOS 16 (Tauri defaulted to 14). Under
  Xcode 26 the old target failed to link: the Swift 5.x compatibility
  shims are gone, and `SwiftUICore` refuses clients built against
  older releases.
- The Rust cache key carries the toolchain, so a staticlib built
  against an older iOS SDK is never linked into a newer-SDK build.

## 0.6.0 — 2026-08-17

Correctness and generality release. Two audits (`AUDIT-2026-08.md`,
`UX-AUDIT-2026-08.md`) drove it: the first against the SysML v2 standard
and the toolchain, the second against the workflow of creating,
analyzing, editing, and acting on models. Both are in the repo with
their resolution status.

### Correctness — editing is safe now
- **Spans are 1-based end to end.** Every edit previously targeted the
  line *after* the declaration and every displayed line number was off
  by one; the unit tests encoded the wrong convention.
- **No more concatenation parsing.** The active file is parsed alone, so
  its spans always index exactly the text in the editor. Cross-file
  context (imports, root-namespace references, satisfy/verify closure)
  comes from `resolver::Project` over the file's directory, as in
  `sysml check`. With imports or a second file open, edits used to land
  in arbitrary wrong places.
- **Editing runs on `codegen::edit`**: byte-accurate edits at
  parser-recorded offsets, applied back-to-front with overlap
  rejection, re-parsed before acceptance — an edit that would introduce
  parse errors is refused rather than written. Renaming `Wheel` no
  longer corrupts `wheelMass`.
- **Saves are atomic** (temp + rename).

### Correctness — numbers agree with the CLI
- Traceability uses `trace_requirements`: satisfy/verify targets resolve
  through requirement usages, feature chains, `<'ID'>` short names, and
  the specialization closure. The old string matcher reported false
  "unsatisfied" alarms on models the CLI traces at 100%.
- Completeness uses `coverage_report`, including a model-declared
  `QualityScore` weighting, and the model's `QualityGate`/`TraceGate`
  constraints are evaluated and shown as PASS/FAIL.
- One rollup engine: the BOM tab computes through `evaluate_rollup`, so
  it can no longer disagree with the Rollup tab. Unit brackets parse
  (`250 [SI::kg]` used to contribute zero) and conversion warnings are
  visible.
- Validation is sysml-core's checks plus W017, replacing hand-rolled
  rules that flagged every stdlib type as unresolved.
- Impact analysis follows dependency edges; it followed containment
  before, so a package's "impact" was the entire model.

### Generic, model-driven analysis
- No FMEA page, no tolerance page — for the same reason the CLI has no
  `fmea` command. The app provides primitives (`list_data_rows`,
  `list_calcs`, `run_calc_over_rows`) and the model decides what they
  mean. An FMEA worksheet is annotations plus a risk calc; a tolerance
  chain is dimension attributes plus a stack calc.
- Derived values come from the model's own `calc def`s, with a
  **labelled** built-in fallback — results report `model:<CalcName>` or
  `built-in`, so a default is never mistaken for policy.
- Model-declared views render through sysml-core's view engine,
  identical to `sysml view <name>`; `render as` views render as
  diagrams with `-r/--renderer` equivalents.

### Workflow
- Errors are visible: a dismissible banner replaces an 8px dot whose
  tooltip does not exist on touch.
- Undo/redo for structural edits (Ctrl/Cmd+Z, header buttons), and the
  editor stays mounted so its own history survives tab switches.
- Exports work on mobile — everything routes through the Tauri save
  dialog and a real file write (`<a download>` is inert in WKWebView).
  CSV export added to the BOM and Run Calc panels.
- PNG export produces a real image (computed colours inlined, opaque
  background); it was rendering blank.
- Edit diffs are shown as confirmations; impact analysis is surfaced in
  the element detail sheet.
- Dialogs close on Escape, trap and restore focus, carry ARIA roles, and
  sit above the on-screen keyboard. Muted text went from ~2.8:1 to
  ~7.8:1 contrast; pinch-zoom is re-enabled.
- Wide viewports (≥900px) keep the element browser beside the active
  view instead of shipping the phone layout to the desktop.

### Model content
- The bundled demo is a pressure relief valve that passes the OMG pilot
  implementation with zero errors and `sysml check` with zero warnings.
  The old one was rejected by the pilot and taught allocating a
  requirement to a part, `satisfy` without `by`, and view filters that
  parsed to nothing.
- Generated SysML is conformant: `analysis def` / `verification def`,
  `satisfy R by X;`, quoted short names (`<'RV-1'>`), standard metaclass
  filter names.

### Under the hood
- `sysml-core` pinned to **tag** v0.9.0 (was a moving branch frozen 69
  commits back): current grammar, ~12 MB smaller parser tables for iOS,
  quoted-name normalization, metadata annotations, unit-aware rollups.
- 34 Rust tests (including end-to-end tests over a real `.sysml`
  fixture) and 52 TypeScript tests; clippy `-D warnings` clean.
