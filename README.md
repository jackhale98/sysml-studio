# SysML Studio

A cross-platform desktop and mobile application for reading, parsing, editing, and visualizing SysML v2 textual notation models.

Built with **Tauri 2.0** + **React 19** + **TypeScript** + **Rust**, powered by the [tree-sitter-sysml](https://github.com/jackhale98/tree-sitter-sysml) grammar.

## Features

### Model Browser
- Hierarchical element tree with parent/child nesting
- Multi-category filtering (Structure, Behavior, Requirements, Interfaces, Attributes, etc.)
- Kind sub-filtering: filter by specific element kinds (e.g., just Part usages, Attributes, States)
- Text search across element names, kinds, and qualified names
- Detail panel with element metadata, source location, and navigation actions
- Swipe actions on element rows: swipe left to delete, swipe right for add/edit (mobile)

### Diagram Views
- **BDD** (Block Definition Diagram) — definitions with composition and specialization edges
- **STM** (State Machine Diagram) — states and transitions with smart edge routing
- **REQ** (Requirements Diagram) — requirement hierarchy with satisfy/verify edges
- **UCD** (Use Case Diagram) — actors (stick figures) and use case ellipses with include/association edges
- **IBD** (Internal Block Diagram) — block container with internal parts, ports, and connection edges

All diagrams support:
- Touch/mouse pan and zoom, node tap highlighting, auto-fit scaling
- **Diagram scoping**: select an element in the browser or tap "Scope" on a diagram node to limit the view to that element's context (e.g., scope BDD to a specific block and its parts, scope STM to a specific state definition). Scope persists across diagram type switches.
- Context-aware element creation via "+ Add" on any highlighted node

### Source Editor
- Syntax-highlighted SysML v2 editor with CodeMirror 6
- Line numbers and scroll-to-line navigation from browser/diagrams
- Live re-parse on edit with error reporting
- Incremental reparsing via tree-sitter edit deltas (Tauri mode)

### CRUD Operations
- Create elements via dialog with category/kind selection, type search, documentation, and parent targeting
- SearchSelect popup with full-text search and grouping for type/parent selection
- Nested insertion: automatically converts `;`-terminated usages to `{ }` blocks when adding children
- Edit element name, type reference, and documentation
- Delete elements with confirmation
- Source text manipulation with live re-parse — no separate backend API needed

### MBSE Dashboard
- **Model Completeness**: Requirements satisfaction, verification, port connectivity, usage typing scores
- **Traceability Matrix**: Requirements linked to satisfying/verifying/allocated elements
- **Validation Engine**: Missing types, unresolved references, empty definitions, orphaned elements
- **Export Tables**: Tabular view of traceability, elements, and validation with CSV export
- Model summary statistics

### File Management
- Open/save with native file dialogs (Tauri) or browser fallback
- Package import resolution from the same directory (`import PackageName::*`)
- Dirty state tracking with save indicator
- PNG diagram export

### Mobile
- Swipe actions on browser rows: left for delete, right for add/edit
- Touch-optimized pan/zoom on diagrams with pinch-to-zoom
- Floating create button with diagram-type context
- Responsive layout for both mobile and desktop

### Theming
- Dark and light mode with CSS variable system
- Persistent theme selection via localStorage
- Theme-aware diagram text and colors

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   React Frontend                     │
│  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │  Element   │ │ Diagram  │ │  Source   │ │  MBSE  │ │
│  │  Browser   │ │  Views   │ │  Editor   │ │ Dash   │ │
│  └─────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │
│        └─────────────┼───────────┼────────────┘      │
│              Zustand State Management                │
│                      │                               │
├──────────────────────┼───────────────────────────────┤
│               Tauri IPC Bridge                       │
│         (browser-parser.ts fallback)                 │
├──────────────────────┼───────────────────────────────┤
│                      │                               │
│  ┌───────────────────┴──────────────────────────────┐│
│  │              Tauri Rust Backend                   ││
│  │  ┌──────────────┐ ┌────────────┐ ┌─────────────┐││
│  │  │ tree-sitter   │ │  Semantic  │ │   File I/O  │││
│  │  │ SysML Parser  │ │  Model +   │ │   + Dialog  │││
│  │  │ (incremental) │ │  Graph     │ │             │││
│  │  └───────────────┘ └────────────┘ └─────────────┘││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

### Hybrid Runtime

The app runs in two modes:

- **Tauri mode**: Rust backend parses SysML with tree-sitter (including incremental reparsing), builds element graph, runs validation, generates diagram layouts. File I/O uses native filesystem. Verified against the official SysML v2 SimpleVehicleModel.sysml (946 elements, 0 errors).
- **Browser mode**: A regex-based browser parser (`browser-parser.ts`) provides functional parsing when running via `npm run dev` without Tauri. All 5 diagram types, validation, traceability, and completeness are generated client-side.

Both modes share the same React UI, Zustand stores, and component tree.

## Project Structure

```
src/                          # React frontend
├── components/
│   ├── browser/              # Element browser, detail panel, filters
│   ├── diagram/              # SVG diagram renderer (BDD, STM, REQ, UCD, IBD)
│   ├── dialogs/              # Create, edit, delete element dialogs
│   ├── editor/               # CodeMirror source editor
│   ├── layout/               # AppShell, Header, TabBar
│   ├── mbse/                 # MBSE dashboard (completeness, traceability, validation, export)
│   └── shared/               # SearchSelect, TypeBadge, SearchInput, etc.
├── lib/
│   ├── browser-parser.ts     # Browser-side SysML parser + all diagram layouts
│   ├── source-editor.ts      # CRUD text manipulation (insert, edit, delete)
│   ├── tauri-bridge.ts       # Tauri IPC wrappers with browser fallbacks
│   ├── element-types.ts      # TypeScript type definitions
│   ├── filter-engine.ts      # Element filtering logic
│   └── constants.ts          # Colors, categories, stdlib types
├── stores/
│   ├── model-store.ts        # Parsed model, source text, file state
│   ├── ui-store.ts           # Active tab, selections, theme, navigation
│   └── filter-store.ts       # Category and text filter state
└── styles/
    └── globals.css            # CSS variables, dark/light themes

src-tauri/src/                # Rust backend
├── parser/
│   ├── sysml_parser.rs       # tree-sitter integration (full + incremental parse)
│   └── node_visitor.rs       # AST visitor for element extraction (60+ node types)
├── model/
│   ├── elements.rs           # SysmlElement, SysmlModel types
│   ├── graph.rs              # ElementGraph with relationship tracking
│   └── query.rs              # Completeness, traceability, validation queries
├── commands/
│   ├── parse_commands.rs     # parse, reparse, open, save, filter, MBSE IPC commands
│   └── diagram_commands.rs   # BDD, STM, REQ, UCD, IBD layout generation
├── lib.rs                    # Tauri plugin registration
└── main.rs                   # Entry point

.github/workflows/            # CI/CD
├── ci.yml                    # Tests + clippy on every PR
├── build-desktop.yml         # macOS (arm64/x64), Windows, Linux builds
├── build-ios.yml             # iOS debug builds
└── build-android.yml         # Android APK builds
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.75 (for Tauri backend)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/) (`cargo install tauri-cli`)

### Development (Browser Only)

```bash
npm install
npm run dev
```

Opens at `http://localhost:1420`. The browser-side parser provides full functionality without Rust.

### Development (Tauri Desktop)

```bash
npm install
cargo tauri dev
```

Launches the native desktop app with the Rust backend.

### Build

```bash
# Desktop (produces .dmg, .msi, .deb, .rpm, .AppImage)
cargo tauri build

# iOS (requires Xcode)
npx tauri ios init
npx tauri ios build

# Android (requires Android SDK + NDK)
npx tauri android init
npx tauri android build
```

### Tests

```bash
# Frontend tests (7 tests)
npm test

# Rust tests (28 tests)
cd src-tauri && cargo test

# Lint
cd src-tauri && cargo clippy
npx tsc --noEmit
```

## CI/CD

GitHub Actions workflows are configured for:

- **CI**: TypeScript type checking, frontend tests, Rust tests, and clippy on every push/PR
- **Desktop**: Builds for macOS (arm64 + x64), Windows (x64), Linux (x64) with automatic GitHub Release drafts on tags
- **iOS**: Debug builds on macOS runners (configure signing secrets for production)
- **Android**: Debug APK builds with NDK (configure signing for production)

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Tauri | 2.0 |
| Frontend | React | 19 |
| Language | TypeScript | 5.8 |
| State | Zustand | 5 |
| Editor | CodeMirror | 6 |
| Build | Vite | 7 |
| Backend | Rust | 2021 edition |
| Parser | tree-sitter-sysml | git (main) |
| Testing | Vitest + Cargo test | 3 / latest |

## SysML v2 Support

The parser handles the full SysML v2 textual notation grammar including:

- **41 definition types**: part def, port def, action def, state def, requirement def, use case def, constraint def, etc.
- **28+ usage types**: part, attribute, port, action, state, connection, flow, requirement, etc.
- **Relationships**: composition, specialization, satisfy, verify, allocate, connect
- **Behavioral**: state machines, transitions, perform/exhibit statements, control flow
- **MBSE**: requirements traceability, completeness scoring, impact analysis, validation
- **Other constructs**: packages, imports, enumerations, doc comments, metadata, visibility modifiers

Tested against the official [SysML v2 SimpleVehicleModel.sysml](https://github.com/Systems-Modeling/SysML-v2-Release/blob/main/sysml/src/examples/Vehicle%20Example/) (1580 lines, 946 elements, 0 parse errors).

## License

MIT
