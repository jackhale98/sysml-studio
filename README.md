# SysML Studio

A cross-platform desktop and mobile application for reading, parsing, editing, and visualizing SysML v2 textual notation models.

Built with **Tauri 2.0** + **React 19** + **TypeScript** + **Rust**, powered by the [tree-sitter-sysml](https://github.com/jackhale98/tree-sitter-sysml) grammar.

## Features

### Model Browser
- Hierarchical element tree with parent/child nesting
- Multi-category filtering (Structure, Behavior, Requirements, Interfaces, Attributes, etc.)
- Text search across element names, kinds, and qualified names
- Detail panel with element metadata, source location, and navigation actions

### Diagram Views
- **BDD** (Block Definition Diagram) — definitions with composition and specialization edges
- **STM** (State Machine Diagram) — states and transitions with smart edge routing
- **REQ** (Requirements Diagram) — requirement hierarchy with containment edges
- **UCD** (Use Case Diagram) — actors (stick figures) and use case ellipses with association edges
- **IBD** (Internal Block Diagram) — block container with internal parts, ports, and inferred connections

All diagrams support touch/mouse pan and zoom, node tap highlighting, and auto-fit scaling.

### Source Editor
- Syntax-highlighted SysML v2 editor with CodeMirror 6
- Line numbers and scroll-to-line navigation from browser/diagrams
- Live re-parse on edit with error reporting

### CRUD Operations
- Create elements via dialog with category/kind selection, type search, documentation, and parent targeting
- Edit element name, type reference, and documentation
- Delete elements with confirmation
- Source text manipulation with live re-parse — no separate backend API needed

### MBSE Dashboard
- Completeness scoring per element (name, type, documentation, children)
- Traceability matrix linking requirements to satisfying/verifying elements
- Model-wide statistics

### File Management
- Open/save with native file dialogs (Tauri) or browser fallback
- Package import resolution from the same directory (`import PackageName::*`)
- Dirty state tracking with save indicator

### Theming
- Dark and light mode with CSS variable system
- Persistent theme selection via localStorage

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
│  │  │               │ │  Graph     │ │             │││
│  │  └───────────────┘ └────────────┘ └─────────────┘││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

### Hybrid Runtime

The app runs in two modes:

- **Tauri mode**: Rust backend parses SysML with tree-sitter, builds element graph, generates BDD/STM layouts. File I/O uses native filesystem.
- **Browser mode**: A regex-based browser parser (`browser-parser.ts`) provides full functionality when running via `npm run dev` without Tauri. All 5 diagram types are generated client-side.

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
│   ├── mbse/                 # MBSE dashboard (completeness, traceability)
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
│   ├── sysml_parser.rs       # tree-sitter integration
│   └── node_visitor.rs       # AST visitor for element extraction
├── model/
│   ├── elements.rs           # SysmlElement, SysmlModel types
│   ├── graph.rs              # ElementGraph with relationship tracking
│   └── query.rs              # Completeness, traceability queries
├── commands/
│   ├── parse_commands.rs     # parse_source, open_file, save_file IPC
│   └── diagram_commands.rs   # BDD + STM layout generation
├── lib.rs                    # Tauri plugin registration
└── main.rs                   # Entry point
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
cargo tauri build
```

Produces platform-specific installers in `src-tauri/target/release/bundle/`.

### Tests

```bash
# Frontend tests
npm test

# Rust tests
cd src-tauri && cargo test
```

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
- **Other constructs**: packages, imports, enumerations, transitions, doc comments, metadata

## License

MIT
