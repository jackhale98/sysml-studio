# SysML Studio — Implementation Guide

## For AI Agent: Systematic Development Plan

**App**: SysML Studio — a cross-platform mobile + desktop app for reading, parsing, editing, and visualizing SysML v2 textual notation.

**Stack**: Tauri 2.0 + React + TypeScript + Rust

**Parser**: [tree-sitter-sysml](https://github.com/jackhale98/tree-sitter-sysml) (existing grammar, 41 definition types, 28+ usage types, 195 corpus tests)

-----

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│  ┌───────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐ │
│  │  Element   │ │ Diagram  │ │  Editor   │ │  Filter  │ │
│  │  Browser   │ │  Views   │ │(CodeMirror)│ │  Panel   │ │
│  └─────┬─────┘ └────┬─────┘ └─────┬─────┘ └────┬─────┘ │
│        │             │             │             │       │
│  ┌─────┴─────────────┴─────────────┴─────────────┴─────┐ │
│  │            Zustand State Management                  │ │
│  └─────────────────────┬───────────────────────────────┘ │
│                        │ Tauri invoke() / listen()       │
├────────────────────────┼────────────────────────────────┤
│                        │                                 │
│  ┌─────────────────────┴───────────────────────────────┐ │
│  │              Tauri Rust Backend                       │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │ │
│  │  │  tree-sitter  │ │  Semantic    │ │  File I/O    │ │ │
│  │  │  Parser       │ │  Model       │ │  Service     │ │ │
│  │  │  (native)     │ │  Builder     │ │              │ │ │
│  │  └──────┬───────┘ └──────┬───────┘ └──────────────┘ │ │
│  │         │                │                           │ │
│  │  ┌──────┴────────────────┴──────────────────────┐   │ │
│  │  │         Query / Filter Engine                 │   │ │
│  │  └──────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Why This Stack

**Tauri 2.0** provides iOS, Android, macOS, Windows, and Linux from one codebase. The Rust backend runs tree-sitter-sysml as native compiled code (not WASM), giving maximum parse performance with incremental reparsing. The WebView frontend means CodeMirror 6 runs natively for the editor, avoiding the limited text editing capabilities of React Native.

**tree-sitter-sysml** runs via the `tree-sitter` Rust crate with zero overhead — no WASM compilation, no JS bridge. Incremental parsing means real-time feedback as users edit.

-----

## 2. Project Structure

```
sysml-studio/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   ├── src/
│   │   ├── lib.rs                    # Tauri app builder, command registration
│   │   ├── main.rs                   # Desktop entry point
│   │   ├── parser/
│   │   │   ├── mod.rs                # tree-sitter integration
│   │   │   ├── sysml_parser.rs       # Parse orchestration, incremental updates
│   │   │   └── node_visitor.rs       # CST → semantic model walker
│   │   ├── model/
│   │   │   ├── mod.rs
│   │   │   ├── elements.rs           # SysML element types (structs)
│   │   │   ├── graph.rs              # Element relationship graph
│   │   │   └── query.rs              # Filter/search engine
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── file_commands.rs      # open, save, recent files
│   │   │   ├── parse_commands.rs     # parse, reparse, get_elements
│   │   │   ├── query_commands.rs     # filter, search, navigate
│   │   │   └── diagram_commands.rs   # layout computation
│   │   └── layout/
│   │       ├── mod.rs
│   │       ├── bdd_layout.rs         # Block Definition Diagram layout
│   │       ├── ibd_layout.rs         # Internal Block Diagram layout
│   │       └── stm_layout.rs         # State Machine layout
│   └── gen/                          # iOS/Android generated
├── src/
│   ├── App.tsx                       # Root component, routing
│   ├── main.tsx                      # Entry point
│   ├── stores/
│   │   ├── model-store.ts            # Zustand: parsed model state
│   │   ├── editor-store.ts           # Zustand: editor state, cursor, dirty flag
│   │   ├── filter-store.ts           # Zustand: active filters, search term
│   │   └── ui-store.ts              # Zustand: active tab, selected element, panels
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx          # Tab bar, header, safe areas
│   │   │   ├── TabBar.tsx            # Bottom navigation
│   │   │   └── Header.tsx            # File name, parse status, stats
│   │   ├── browser/
│   │   │   ├── ElementBrowser.tsx    # Main browser view
│   │   │   ├── ElementRow.tsx        # Single element list item
│   │   │   ├── FilterPanel.tsx       # Category chips, search bar
│   │   │   ├── ElementDetail.tsx     # Bottom sheet detail view
│   │   │   └── TypeBadge.tsx         # Colored type indicator
│   │   ├── diagram/
│   │   │   ├── DiagramView.tsx       # Container with pan/zoom
│   │   │   ├── DiagramCanvas.tsx     # SVG rendering layer
│   │   │   ├── BlockNode.tsx         # BDD block node component
│   │   │   ├── StateNode.tsx         # State machine node
│   │   │   ├── Edge.tsx              # Connection/transition edge
│   │   │   ├── DiagramToolbar.tsx    # Diagram type picker, zoom controls
│   │   │   └── NodeDetailPopover.tsx # Tap-to-inspect popover
│   │   ├── editor/
│   │   │   ├── EditorView.tsx        # CodeMirror 6 wrapper
│   │   │   ├── sysml-language.ts     # CM6 language support (highlighting, folding)
│   │   │   ├── sysml-linter.ts       # CM6 linter (parse errors from Rust)
│   │   │   └── EditorToolbar.tsx     # Insert snippets, format, undo/redo
│   │   └── shared/
│   │       ├── SearchInput.tsx
│   │       ├── BottomSheet.tsx
│   │       └── LoadingSpinner.tsx
│   ├── hooks/
│   │   ├── use-tauri-command.ts      # Generic invoke wrapper with loading/error
│   │   ├── use-parse-result.ts       # Subscribe to parse events
│   │   ├── use-diagram-layout.ts     # Request + cache diagram layout
│   │   └── use-mobile-gestures.ts    # Pan, pinch-zoom, long-press
│   ├── lib/
│   │   ├── tauri-bridge.ts           # Typed wrappers around all Tauri commands
│   │   ├── element-types.ts          # TypeScript interfaces matching Rust structs
│   │   ├── diagram-types.ts          # Layout node/edge types
│   │   ├── filter-engine.ts          # Client-side fast filter (supplement Rust)
│   │   └── constants.ts              # Colors, categories, type metadata
│   └── styles/
│       └── globals.css               # Base styles, CSS variables, mobile resets
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
└── README.md
```

-----

## 3. Phase-by-Phase Implementation

### Phase 1: Foundation (Scaffold + Parser Integration)

**Goal**: Tauri app launches on desktop and mobile, loads a .sysml file, parses it with tree-sitter-sysml, and displays the raw element list.

#### Step 1.1 — Scaffold Tauri Project

```bash
npm create tauri-app@latest sysml-studio -- --template react-ts
cd sysml-studio
npm install

# Initialize mobile targets
npx tauri android init
npx tauri ios init    # macOS only
```

Configure `src-tauri/tauri.conf.json`:

```json
{
  "productName": "SysML Studio",
  "identifier": "com.sysmlstudio.app",
  "build": {
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "SysML Studio",
        "width": 430,
        "height": 900
      }
    ]
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/icon.png"]
  }
}
```

#### Step 1.2 — Integrate tree-sitter-sysml in Rust

Add to `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tree-sitter = "0.24"
tree-sitter-sysml = { git = "https://github.com/jackhale98/tree-sitter-sysml", branch = "main" }
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
```

> **IMPORTANT**: The tree-sitter-sysml repo includes a `Cargo.toml` and Rust bindings in `bindings/rust/`. The crate exposes `LANGUAGE` (or `language()`) which returns the `tree_sitter::Language` needed by the parser. If the crate name differs, check `bindings/rust/lib.rs` for the exact export and adjust the import accordingly.

#### Step 1.3 — Rust Parser Module

`src-tauri/src/parser/sysml_parser.rs`:

```rust
use std::sync::Mutex;
use tree_sitter::{Parser, Tree, Language};

/// Holds parser state for incremental reparsing
pub struct SysmlParser {
    parser: Parser,
    current_tree: Option<Tree>,
    current_source: String,
}

impl SysmlParser {
    pub fn new() -> Self {
        let mut parser = Parser::new();
        // tree-sitter-sysml exposes its language via the Rust binding
        let language: Language = tree_sitter_sysml::LANGUAGE.into();
        parser.set_language(&language)
            .expect("Failed to set SysML language");
        Self {
            parser,
            current_tree: None,
            current_source: String::new(),
        }
    }

    /// Full parse of source text
    pub fn parse(&mut self, source: &str) -> Option<&Tree> {
        self.current_source = source.to_string();
        self.current_tree = self.parser.parse(source, None);
        self.current_tree.as_ref()
    }

    /// Incremental reparse after an edit
    pub fn reparse(&mut self, new_source: &str, edit: &tree_sitter::InputEdit) -> Option<&Tree> {
        if let Some(ref mut old_tree) = self.current_tree {
            old_tree.edit(edit);
            self.current_tree = self.parser.parse(new_source, Some(old_tree));
        } else {
            self.current_tree = self.parser.parse(new_source, None);
        }
        self.current_source = new_source.to_string();
        self.current_tree.as_ref()
    }

    pub fn tree(&self) -> Option<&Tree> {
        self.current_tree.as_ref()
    }

    pub fn source(&self) -> &str {
        &self.current_source
    }
}
```

#### Step 1.4 — Semantic Model (Rust Structs)

`src-tauri/src/model/elements.rs`:

```rust
use serde::{Serialize, Deserialize};

/// Unique ID for each element in the model
pub type ElementId = u32;

/// The category grouping for filtering
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Structure,
    Behavior,
    Requirement,
    Interface,
    Property,
    Relationship,
    Constraint,
    Analysis,
    View,
}

/// Core element types from tree-sitter-sysml grammar
/// Maps to the 41 definition types + 28 usage types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ElementKind {
    // --- KerML / SysML definition types ---
    Package,
    PartDef,
    PartUsage,
    AttributeDef,
    AttributeUsage,
    PortDef,
    PortUsage,
    ConnectionDef,
    ConnectionUsage,
    InterfaceDef,
    InterfaceUsage,
    ItemDef,
    ItemUsage,
    ActionDef,
    ActionUsage,
    StateDef,
    StateUsage,
    TransitionUsage,
    ConstraintDef,
    ConstraintUsage,
    RequirementDef,
    RequirementUsage,
    ConcernDef,
    ConcernUsage,
    ViewDef,
    ViewUsage,
    ViewpointDef,
    ViewpointUsage,
    RenderingDef,
    RenderingUsage,
    AllocationDef,
    AllocationUsage,
    AnalysisCaseDef,
    AnalysisCaseUsage,
    UseCaseDef,
    UseCaseUsage,
    VerificationCaseDef,
    VerificationCaseUsage,
    EnumDef,
    EnumUsage,
    OccurrenceDef,
    OccurrenceUsage,
    FlowConnectionUsage,
    SuccessionFlowConnectionUsage,
    // --- Behavioral ---
    PerformActionUsage,
    ExhibitStateUsage,
    IncludeUseCaseUsage,
    AssertConstraintUsage,
    SatisfyRequirementUsage,
    // --- Relationships ---
    Specialization,
    Redefinition,
    Subclassification,
    FeatureTyping,
    Conjugation,
    Binding,
    Succession,
    // --- Other ---
    Import,
    Alias,
    Comment,
    Doc,
    MetadataUsage,
    // Catch-all for grammar nodes not yet mapped
    Other(String),
}

/// A single SysML element extracted from the parse tree
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SysmlElement {
    pub id: ElementId,
    pub kind: ElementKind,
    pub name: Option<String>,
    pub qualified_name: String,
    pub category: Category,
    pub parent_id: Option<ElementId>,
    pub children_ids: Vec<ElementId>,
    /// Source location for editor navigation
    pub span: SourceSpan,
    /// Type reference (e.g., `engine : Engine` → "Engine")
    pub type_ref: Option<String>,
    /// Modifiers: abstract, readonly, derived, etc.
    pub modifiers: Vec<String>,
    /// Multiplicity if present (e.g., "[2]", "[0..*]")
    pub multiplicity: Option<String>,
    /// Doc comment text
    pub doc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceSpan {
    pub start_line: u32,
    pub start_col: u32,
    pub end_line: u32,
    pub end_col: u32,
    pub start_byte: u32,
    pub end_byte: u32,
}

/// The complete parsed model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SysmlModel {
    pub file_path: Option<String>,
    pub elements: Vec<SysmlElement>,
    pub errors: Vec<ParseError>,
    pub stats: ModelStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseError {
    pub message: String,
    pub span: SourceSpan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStats {
    pub total_elements: u32,
    pub definitions: u32,
    pub usages: u32,
    pub relationships: u32,
    pub errors: u32,
    pub parse_time_ms: f64,
}
```

#### Step 1.5 — CST to Semantic Model Walker

`src-tauri/src/parser/node_visitor.rs`:

This module walks the tree-sitter CST and builds `SysmlElement` instances. The visitor pattern should map tree-sitter node kinds to `ElementKind` variants.

```rust
use tree_sitter::{Node, Tree};
use crate::model::elements::*;

pub struct ModelBuilder {
    elements: Vec<SysmlElement>,
    next_id: ElementId,
    source: String,
}

impl ModelBuilder {
    pub fn new(source: &str) -> Self {
        Self {
            elements: Vec::new(),
            next_id: 0,
            source: source.to_string(),
        }
    }

    pub fn build(mut self, tree: &Tree) -> (Vec<SysmlElement>, Vec<ParseError>) {
        let mut errors = Vec::new();
        let root = tree.root_node();
        self.visit_node(root, None, &mut errors);
        (self.elements, errors)
    }

    fn visit_node(
        &mut self,
        node: Node,
        parent_id: Option<ElementId>,
        errors: &mut Vec<ParseError>,
    ) {
        // Collect parse errors
        if node.is_error() || node.is_missing() {
            errors.push(ParseError {
                message: format!(
                    "Parse error: unexpected '{}'",
                    node.kind()
                ),
                span: span_from_node(&node),
            });
        }

        // Map tree-sitter node kind → ElementKind + Category
        // The grammar produces node kinds like:
        //   "package_definition", "part_definition", "part_usage",
        //   "attribute_definition", "port_definition", "state_definition",
        //   "action_definition", "connection_definition", "requirement_definition",
        //   "enum_definition", "specialization", "redefinition", etc.
        //
        // Check actual node kinds by running:
        //   tree-sitter parse example.sysml --output-dot
        //
        // AGENT NOTE: Run `tree-sitter parse` on sample .sysml files from
        //             the test corpus to discover exact node kind strings.
        //             Then populate this match with all 41+ definition types
        //             and 28+ usage types.

        if let Some((kind, category)) = map_node_kind(node.kind()) {
            let id = self.next_id;
            self.next_id += 1;

            // Extract name: look for child named "name" or
            // first "identifier"/"qualified_name" child
            let name = self.extract_name(&node);

            let element = SysmlElement {
                id,
                kind,
                name: name.clone(),
                qualified_name: self.build_qualified_name(parent_id, &name),
                category,
                parent_id,
                children_ids: Vec::new(),
                span: span_from_node(&node),
                type_ref: self.extract_type_ref(&node),
                modifiers: self.extract_modifiers(&node),
                multiplicity: self.extract_multiplicity(&node),
                doc: self.extract_doc(&node),
            };

            self.elements.push(element);

            // Update parent's children list
            if let Some(pid) = parent_id {
                if let Some(parent) = self.elements.iter_mut().find(|e| e.id == pid) {
                    parent.children_ids.push(id);
                }
            }

            // Recurse into children with this element as parent
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                self.visit_node(child, Some(id), errors);
            }
        } else {
            // Not a model element node — recurse with same parent
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                self.visit_node(child, parent_id, errors);
            }
        }
    }

    fn extract_name(&self, node: &Node) -> Option<String> {
        // Try field "name" first, then look for identifier child
        if let Some(name_node) = node.child_by_field_name("name") {
            return Some(
                name_node.utf8_text(self.source.as_bytes()).unwrap_or("").to_string()
            );
        }
        // Fallback: first identifier child
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "identifier" || child.kind() == "name" {
                return Some(
                    child.utf8_text(self.source.as_bytes()).unwrap_or("").to_string()
                );
            }
        }
        None
    }

    fn extract_type_ref(&self, node: &Node) -> Option<String> {
        // Look for typed_by or feature_typing child
        node.child_by_field_name("type")
            .and_then(|n| n.utf8_text(self.source.as_bytes()).ok())
            .map(|s| s.to_string())
    }

    fn extract_modifiers(&self, node: &Node) -> Vec<String> {
        // Collect prefix keywords: abstract, readonly, derived, in, out, inout
        let mut mods = Vec::new();
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            match child.kind() {
                "abstract" | "readonly" | "derived" | "end"
                | "in" | "out" | "inout" | "private" | "protected" => {
                    mods.push(child.kind().to_string());
                }
                _ => {}
            }
        }
        mods
    }

    fn extract_multiplicity(&self, node: &Node) -> Option<String> {
        node.child_by_field_name("multiplicity")
            .and_then(|n| n.utf8_text(self.source.as_bytes()).ok())
            .map(|s| s.to_string())
    }

    fn extract_doc(&self, node: &Node) -> Option<String> {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "documentation_comment" || child.kind() == "doc" {
                return child.utf8_text(self.source.as_bytes())
                    .ok().map(|s| s.to_string());
            }
        }
        None
    }

    fn build_qualified_name(
        &self,
        parent_id: Option<ElementId>,
        name: &Option<String>
    ) -> String {
        let name_str = name.as_deref().unwrap_or("<anonymous>");
        if let Some(pid) = parent_id {
            if let Some(parent) = self.elements.iter().find(|e| e.id == pid) {
                return format!("{}::{}", parent.qualified_name, name_str);
            }
        }
        name_str.to_string()
    }
}

/// Map tree-sitter node kind string to (ElementKind, Category)
///
/// AGENT NOTE: The exact node kind strings must be verified by running
/// `tree-sitter parse` on sample files and inspecting the CST output.
/// The grammar.js in tree-sitter-sysml defines the rule names.
/// Common pattern: grammar rule `part_definition` → node kind `part_definition`.
fn map_node_kind(kind: &str) -> Option<(ElementKind, Category)> {
    match kind {
        "package_definition" => Some((ElementKind::Package, Category::Structure)),
        "part_definition" => Some((ElementKind::PartDef, Category::Structure)),
        "part_usage" => Some((ElementKind::PartUsage, Category::Structure)),
        "attribute_definition" => Some((ElementKind::AttributeDef, Category::Property)),
        "attribute_usage" => Some((ElementKind::AttributeUsage, Category::Property)),
        "port_definition" => Some((ElementKind::PortDef, Category::Interface)),
        "port_usage" => Some((ElementKind::PortUsage, Category::Interface)),
        "connection_definition" => Some((ElementKind::ConnectionDef, Category::Relationship)),
        "connection_usage" => Some((ElementKind::ConnectionUsage, Category::Relationship)),
        "interface_definition" => Some((ElementKind::InterfaceDef, Category::Interface)),
        "interface_usage" => Some((ElementKind::InterfaceUsage, Category::Interface)),
        "item_definition" => Some((ElementKind::ItemDef, Category::Structure)),
        "item_usage" => Some((ElementKind::ItemUsage, Category::Structure)),
        "action_definition" => Some((ElementKind::ActionDef, Category::Behavior)),
        "action_usage" => Some((ElementKind::ActionUsage, Category::Behavior)),
        "state_definition" => Some((ElementKind::StateDef, Category::Behavior)),
        "state_usage" => Some((ElementKind::StateUsage, Category::Behavior)),
        "transition_usage" => Some((ElementKind::TransitionUsage, Category::Behavior)),
        "constraint_definition" => Some((ElementKind::ConstraintDef, Category::Constraint)),
        "constraint_usage" => Some((ElementKind::ConstraintUsage, Category::Constraint)),
        "requirement_definition" => Some((ElementKind::RequirementDef, Category::Requirement)),
        "requirement_usage" => Some((ElementKind::RequirementUsage, Category::Requirement)),
        "concern_definition" => Some((ElementKind::ConcernDef, Category::Requirement)),
        "concern_usage" => Some((ElementKind::ConcernUsage, Category::Requirement)),
        "view_definition" => Some((ElementKind::ViewDef, Category::View)),
        "view_usage" => Some((ElementKind::ViewUsage, Category::View)),
        "viewpoint_definition" => Some((ElementKind::ViewpointDef, Category::View)),
        "viewpoint_usage" => Some((ElementKind::ViewpointUsage, Category::View)),
        "rendering_definition" => Some((ElementKind::RenderingDef, Category::View)),
        "rendering_usage" => Some((ElementKind::RenderingUsage, Category::View)),
        "allocation_definition" => Some((ElementKind::AllocationDef, Category::Relationship)),
        "allocation_usage" => Some((ElementKind::AllocationUsage, Category::Relationship)),
        "analysis_case_definition" => Some((ElementKind::AnalysisCaseDef, Category::Analysis)),
        "analysis_case_usage" => Some((ElementKind::AnalysisCaseUsage, Category::Analysis)),
        "use_case_definition" => Some((ElementKind::UseCaseDef, Category::Behavior)),
        "use_case_usage" => Some((ElementKind::UseCaseUsage, Category::Behavior)),
        "verification_case_definition" => Some((ElementKind::VerificationCaseDef, Category::Analysis)),
        "verification_case_usage" => Some((ElementKind::VerificationCaseUsage, Category::Analysis)),
        "enum_definition" => Some((ElementKind::EnumDef, Category::Property)),
        "enum_usage" => Some((ElementKind::EnumUsage, Category::Property)),
        "occurrence_definition" => Some((ElementKind::OccurrenceDef, Category::Structure)),
        "occurrence_usage" => Some((ElementKind::OccurrenceUsage, Category::Structure)),
        "flow_connection_usage" => Some((ElementKind::FlowConnectionUsage, Category::Interface)),
        "specialization" => Some((ElementKind::Specialization, Category::Relationship)),
        "redefinition" => Some((ElementKind::Redefinition, Category::Relationship)),
        "subclassification" => Some((ElementKind::Subclassification, Category::Relationship)),
        "conjugation" => Some((ElementKind::Conjugation, Category::Relationship)),
        "import_declaration" => Some((ElementKind::Import, Category::Structure)),
        "alias_declaration" => Some((ElementKind::Alias, Category::Structure)),
        "comment" => Some((ElementKind::Comment, Category::Property)),
        "documentation_comment" => Some((ElementKind::Doc, Category::Property)),
        "metadata_usage" => Some((ElementKind::MetadataUsage, Category::Property)),
        _ => None,
    }
}

fn span_from_node(node: &Node) -> SourceSpan {
    let start = node.start_position();
    let end = node.end_position();
    SourceSpan {
        start_line: start.row as u32,
        start_col: start.column as u32,
        end_line: end.row as u32,
        end_col: end.column as u32,
        start_byte: node.start_byte() as u32,
        end_byte: node.end_byte() as u32,
    }
}
```

**CRITICAL AGENT INSTRUCTION**: The `map_node_kind` function above is a best-guess mapping. Before implementing, you MUST:

1. Clone `https://github.com/jackhale98/tree-sitter-sysml`
1. Run `npm install && npx tree-sitter generate`
1. Parse sample .sysml files: `npx tree-sitter parse test/corpus/*.sysml` or create a sample file
1. Inspect the CST output to verify exact node kind strings
1. Read `grammar.js` to identify all rule names — those become the node kinds
1. Adjust the match arms accordingly

#### Step 1.6 — Tauri Commands

`src-tauri/src/commands/parse_commands.rs`:

```rust
use std::sync::Mutex;
use tauri::State;
use crate::parser::sysml_parser::SysmlParser;
use crate::parser::node_visitor::ModelBuilder;
use crate::model::elements::*;

pub struct AppState {
    pub parser: Mutex<SysmlParser>,
    pub current_model: Mutex<Option<SysmlModel>>,
}

#[tauri::command]
pub fn parse_source(source: String, state: State<'_, AppState>) -> Result<SysmlModel, String> {
    let mut parser = state.parser.lock().map_err(|e| e.to_string())?;

    let start = std::time::Instant::now();
    let tree = parser.parse(&source).ok_or("Parse failed")?;

    let builder = ModelBuilder::new(&source);
    let (elements, errors) = builder.build(tree);

    let stats = ModelStats {
        total_elements: elements.len() as u32,
        definitions: elements.iter().filter(|e| is_definition(&e.kind)).count() as u32,
        usages: elements.iter().filter(|e| is_usage(&e.kind)).count() as u32,
        relationships: elements.iter().filter(|e| e.category == Category::Relationship).count() as u32,
        errors: errors.len() as u32,
        parse_time_ms: start.elapsed().as_secs_f64() * 1000.0,
    };

    let model = SysmlModel {
        file_path: None,
        elements,
        errors,
        stats,
    };

    *state.current_model.lock().map_err(|e| e.to_string())? = Some(model.clone());
    Ok(model)
}

#[tauri::command]
pub fn open_file(path: String, state: State<'_, AppState>) -> Result<SysmlModel, String> {
    let source = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut model = parse_source(source, state)?;
    model.file_path = Some(path);
    Ok(model)
}

#[tauri::command]
pub fn filter_elements(
    categories: Vec<String>,
    search_term: Option<String>,
    parent_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<SysmlElement>, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    let filtered: Vec<SysmlElement> = model.elements.iter()
        .filter(|el| {
            // Category filter
            let cat_str = serde_json::to_string(&el.category)
                .unwrap_or_default()
                .trim_matches('"').to_string();
            if !categories.is_empty() && !categories.contains(&cat_str) {
                return false;
            }

            // Search term filter
            if let Some(ref term) = search_term {
                let lower = term.to_lowercase();
                let matches_name = el.name.as_ref()
                    .map(|n| n.to_lowercase().contains(&lower))
                    .unwrap_or(false);
                let matches_qname = el.qualified_name.to_lowercase().contains(&lower);
                let matches_type = el.type_ref.as_ref()
                    .map(|t| t.to_lowercase().contains(&lower))
                    .unwrap_or(false);
                if !matches_name && !matches_qname && !matches_type {
                    return false;
                }
            }

            // Parent filter
            if let Some(ref pname) = parent_name {
                if let Some(pid) = el.parent_id {
                    let parent_matches = model.elements.iter()
                        .find(|p| p.id == pid)
                        .and_then(|p| p.name.as_ref())
                        .map(|n| n == pname)
                        .unwrap_or(false);
                    if !parent_matches { return false; }
                } else {
                    return false;
                }
            }

            true
        })
        .cloned()
        .collect();

    Ok(filtered)
}

fn is_definition(kind: &ElementKind) -> bool {
    matches!(kind,
        ElementKind::PartDef | ElementKind::AttributeDef | ElementKind::PortDef |
        ElementKind::ConnectionDef | ElementKind::InterfaceDef | ElementKind::ItemDef |
        ElementKind::ActionDef | ElementKind::StateDef | ElementKind::ConstraintDef |
        ElementKind::RequirementDef | ElementKind::ConcernDef | ElementKind::ViewDef |
        ElementKind::ViewpointDef | ElementKind::RenderingDef | ElementKind::AllocationDef |
        ElementKind::AnalysisCaseDef | ElementKind::UseCaseDef | ElementKind::EnumDef |
        ElementKind::OccurrenceDef | ElementKind::VerificationCaseDef | ElementKind::Package
    )
}

fn is_usage(kind: &ElementKind) -> bool {
    matches!(kind,
        ElementKind::PartUsage | ElementKind::AttributeUsage | ElementKind::PortUsage |
        ElementKind::ConnectionUsage | ElementKind::InterfaceUsage | ElementKind::ItemUsage |
        ElementKind::ActionUsage | ElementKind::StateUsage | ElementKind::TransitionUsage |
        ElementKind::ConstraintUsage | ElementKind::RequirementUsage | ElementKind::ConcernUsage |
        ElementKind::ViewUsage | ElementKind::ViewpointUsage | ElementKind::RenderingUsage |
        ElementKind::AllocationUsage | ElementKind::AnalysisCaseUsage | ElementKind::UseCaseUsage |
        ElementKind::EnumUsage | ElementKind::OccurrenceUsage | ElementKind::FlowConnectionUsage |
        ElementKind::VerificationCaseUsage
    )
}
```

`src-tauri/src/lib.rs`:

```rust
mod parser;
mod model;
mod commands;

use commands::parse_commands::AppState;
use parser::sysml_parser::SysmlParser;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            parser: Mutex::new(SysmlParser::new()),
            current_model: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::parse_commands::parse_source,
            commands::parse_commands::open_file,
            commands::parse_commands::filter_elements,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### Step 1.7 — TypeScript Bridge Types

`src/lib/element-types.ts`:

```typescript
export type ElementId = number;

export type Category =
  | "structure" | "behavior" | "requirement" | "interface"
  | "property" | "relationship" | "constraint" | "analysis" | "view";

export type ElementKind =
  | "package" | "part_def" | "part_usage"
  | "attribute_def" | "attribute_usage"
  | "port_def" | "port_usage"
  | "connection_def" | "connection_usage"
  | "interface_def" | "interface_usage"
  | "item_def" | "item_usage"
  | "action_def" | "action_usage"
  | "state_def" | "state_usage"
  | "transition_usage"
  | "constraint_def" | "constraint_usage"
  | "requirement_def" | "requirement_usage"
  | "concern_def" | "concern_usage"
  | "view_def" | "view_usage"
  | "viewpoint_def" | "viewpoint_usage"
  | "rendering_def" | "rendering_usage"
  | "allocation_def" | "allocation_usage"
  | "analysis_case_def" | "analysis_case_usage"
  | "use_case_def" | "use_case_usage"
  | "verification_case_def" | "verification_case_usage"
  | "enum_def" | "enum_usage"
  | "occurrence_def" | "occurrence_usage"
  | "flow_connection_usage"
  | "specialization" | "redefinition" | "subclassification"
  | "conjugation" | "binding" | "succession"
  | "import" | "alias" | "comment" | "doc" | "metadata_usage"
  | { other: string };

export interface SourceSpan {
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  start_byte: number;
  end_byte: number;
}

export interface SysmlElement {
  id: ElementId;
  kind: ElementKind;
  name: string | null;
  qualified_name: string;
  category: Category;
  parent_id: ElementId | null;
  children_ids: ElementId[];
  span: SourceSpan;
  type_ref: string | null;
  modifiers: string[];
  multiplicity: string | null;
  doc: string | null;
}

export interface ParseError {
  message: string;
  span: SourceSpan;
}

export interface ModelStats {
  total_elements: number;
  definitions: number;
  usages: number;
  relationships: number;
  errors: number;
  parse_time_ms: number;
}

export interface SysmlModel {
  file_path: string | null;
  elements: SysmlElement[];
  errors: ParseError[];
  stats: ModelStats;
}
```

`src/lib/tauri-bridge.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { SysmlModel, SysmlElement } from "./element-types";

export async function parseSource(source: string): Promise<SysmlModel> {
  return invoke<SysmlModel>("parse_source", { source });
}

export async function openFile(path: string): Promise<SysmlModel> {
  return invoke<SysmlModel>("open_file", { path });
}

export async function filterElements(
  categories: string[],
  searchTerm?: string,
  parentName?: string
): Promise<SysmlElement[]> {
  return invoke<SysmlElement[]>("filter_elements", {
    categories,
    searchTerm: searchTerm ?? null,
    parentName: parentName ?? null,
  });
}
```

#### Step 1.8 — Zustand Store

`src/stores/model-store.ts`:

```typescript
import { create } from "zustand";
import type { SysmlModel, SysmlElement } from "../lib/element-types";
import { parseSource, openFile } from "../lib/tauri-bridge";

interface ModelState {
  model: SysmlModel | null;
  source: string;
  loading: boolean;
  error: string | null;

  loadSource: (source: string) => Promise<void>;
  loadFile: (path: string) => Promise<void>;
  updateSource: (source: string) => Promise<void>;
  getElement: (id: number) => SysmlElement | undefined;
}

export const useModelStore = create<ModelState>((set, get) => ({
  model: null,
  source: "",
  loading: false,
  error: null,

  loadSource: async (source) => {
    set({ loading: true, error: null, source });
    try {
      const model = await parseSource(source);
      set({ model, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadFile: async (path) => {
    set({ loading: true, error: null });
    try {
      const model = await openFile(path);
      // Also read the source for the editor
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const source = await readTextFile(path);
      set({ model, source, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updateSource: async (source) => {
    set({ source });
    // Debounced reparse — the calling component should debounce this
    try {
      const model = await parseSource(source);
      set({ model });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  getElement: (id) => {
    return get().model?.elements.find((e) => e.id === id);
  },
}));
```

-----

### Phase 2: Element Browser + Filtering UI

**Goal**: Full element browser with category filtering, text search, element detail sheet, and navigation to source location.

#### Key Components

**FilterPanel.tsx** — Render category chips from the model’s distinct categories. Chips are toggle buttons. A search input at top does instant client-side filtering (name, qualified_name, type_ref). The Rust `filter_elements` command can be used for heavy queries, but client-side filtering on the already-loaded `model.elements` array is faster for <5000 elements.

**ElementBrowser.tsx** — Virtualized list (use `react-window` or similar) for performance with large models. Each row shows: element name in monospace, parent path in muted text, and a colored TypeBadge. Tap opens ElementDetail bottom sheet.

**ElementDetail.tsx** — Bottom sheet showing: name, kind, category, parent chain, type reference, modifiers, multiplicity, doc comment, children list. Action buttons: “View in Diagram” (switches to diagram tab and highlights), “Go to Source” (switches to editor and scrolls to line).

#### Mobile UX Patterns

- Use `position: sticky` for FilterPanel so it stays visible during scroll
- Bottom sheet should be a slide-up panel, not a modal, to preserve context
- Swipe-right on an element row for quick actions (bookmark, hide)
- Pull-to-refresh should re-parse the current source

-----

### Phase 3: Interactive Diagram Views

**Goal**: Pannable, zoomable, tap-to-select diagrams for BDD and State Machine views, with auto-layout.

#### Diagram Types to Implement (Priority Order)

1. **Block Definition Diagram (BDD)** — Shows part definitions and their composition/specialization relationships. Most commonly used SysML diagram.
1. **State Machine Diagram (STM)** — Shows states and transitions within a state definition.
1. **Internal Block Diagram (IBD)** — Shows parts within a specific block and their port connections. Phase 4.
1. **Requirements Diagram** — Shows requirement definitions and satisfy/verify relationships. Phase 4.

#### Layout Engine (Rust-side)

Add `dagre`-equivalent layout in Rust, or use a simple layered layout algorithm. For an MVP, a modified Sugiyama layout works well:

`src-tauri/src/commands/diagram_commands.rs`:

```rust
use serde::{Serialize, Deserialize};
use tauri::State;
use crate::commands::parse_commands::AppState;
use crate::model::elements::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagramNode {
    pub element_id: ElementId,
    pub label: String,
    pub kind: String,       // "block", "state", "port", "requirement"
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub color: String,
    pub children: Vec<DiagramNode>,  // For nested views (IBD)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagramEdge {
    pub from_id: ElementId,
    pub to_id: ElementId,
    pub label: Option<String>,
    pub edge_type: String,  // "composition", "specialization", "transition", "flow"
    pub points: Vec<(f64, f64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagramLayout {
    pub diagram_type: String,
    pub nodes: Vec<DiagramNode>,
    pub edges: Vec<DiagramEdge>,
    pub bounds: (f64, f64, f64, f64),  // min_x, min_y, max_x, max_y
}

#[tauri::command]
pub fn compute_bdd_layout(
    root_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<DiagramLayout, String> {
    let model = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model.as_ref().ok_or("No model loaded")?;

    // 1. Collect definition elements as nodes
    // 2. Collect composition (part usage parent→type) and
    //    specialization relationships as edges
    // 3. Apply layered layout algorithm
    // 4. Return positioned nodes and routed edges

    // Implementation: use a simple top-down tree layout
    // or integrate a Rust graph layout library like `layout-rs`
    todo!("Implement BDD layout algorithm")
}

#[tauri::command]
pub fn compute_stm_layout(
    state_def_name: String,
    state: State<'_, AppState>,
) -> Result<DiagramLayout, String> {
    let model = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model.as_ref().ok_or("No model loaded")?;

    // 1. Find the named state definition
    // 2. Collect child state usages as nodes
    // 3. Collect transition usages as edges
    // 4. Apply force-directed or layered layout
    todo!("Implement STM layout algorithm")
}
```

**Layout library options for Rust**:

- `layout-rs` — Pure Rust graph layout (Sugiyama algorithm)
- Manual implementation of a simple layered layout (recommended for MVP — fewer dependencies)
- Alternatively, compute layout in JS using `dagre` or `elkjs` and keep Rust for data extraction only

#### Frontend Diagram Renderer

Use SVG in the WebView — it performs well for diagrams up to a few hundred nodes and supports CSS transitions for smooth interactions.

`src/components/diagram/DiagramCanvas.tsx` should:

- Render nodes as `<rect>` with rounded corners, header bar, and label `<text>`
- Render edges as `<path>` with arrow markers
- Use CSS `transform: translate(${panX}px, ${panY}px) scale(${zoom})` on a `<g>` wrapper
- Handle touch gestures: single-finger pan, pinch-to-zoom, tap-to-select
- Highlight selected node and its connected edges; dim unconnected nodes
- Double-tap a node to navigate to its source or open detail view

**Touch Gesture Implementation**:

```typescript
// Pan: track single touch delta
// Zoom: track two-touch distance ratio
// Tap: detect touch start → touch end < 200ms with < 10px movement
// Long-press: setTimeout on touch start, clear on move/end
```

-----

### Phase 4: Source Editor

**Goal**: Syntax-highlighted editor with line numbers, bracket matching, and real-time parse error display.

#### CodeMirror 6 Integration

Install: `npm install @codemirror/view @codemirror/state @codemirror/language codemirror`

`src/components/editor/sysml-language.ts` — Define a CodeMirror 6 language support:

```typescript
import { LanguageSupport, StreamLanguage } from "@codemirror/language";

// StreamLanguage for initial implementation (simpler than full Lezer grammar)
// Can be upgraded to a Lezer grammar later for tree-sitter parity
const sysmlStreamParser = {
  token(stream: any, state: any) {
    // Keyword highlighting
    if (stream.match(/\b(package|part|def|attribute|port|connection|interface|item|action|state|transition|constraint|requirement|concern|view|viewpoint|rendering|allocation|analysis|case|use|verification|enum|occurrence|flow|import|alias|abstract|readonly|derived|in|out|inout|first|then|do|entry|exit|if|else|accept|send|assign|assert|satisfy|after|at|when|decide|merge|fork|join|private|protected|public)\b/)) {
      return "keyword";
    }
    // Type names (capitalized identifiers)
    if (stream.match(/\b[A-Z][a-zA-Z0-9_]*\b/)) {
      return "typeName";
    }
    // Numbers
    if (stream.match(/\b\d+(\.\d+)?\b/)) {
      return "number";
    }
    // Strings
    if (stream.match(/"[^"]*"/)) {
      return "string";
    }
    // Comments
    if (stream.match(/\/\/.*/)) {
      return "comment";
    }
    if (stream.match(/\/\*/)) {
      // Block comment — simplified, doesn't handle nesting
      while (!stream.match(/\*\//) && !stream.eol()) {
        stream.next();
      }
      return "comment";
    }
    // Doc comments
    if (stream.match(/doc\b/)) {
      return "meta";
    }
    // Operators
    if (stream.match(/[:;{}\[\]=><,.|&+\-*\/~@#]/)) {
      return "operator";
    }
    // Identifiers
    if (stream.match(/[a-zA-Z_][a-zA-Z0-9_]*/)) {
      return "variableName";
    }
    stream.next();
    return null;
  },
};

export function sysmlLanguage() {
  return new LanguageSupport(StreamLanguage.define(sysmlStreamParser));
}
```

#### Real-time Parse Error Marking

The editor should debounce source changes (~300ms), call `parse_source` via Tauri, and mark errors as CodeMirror diagnostics using `@codemirror/lint`.

```typescript
import { linter, Diagnostic } from "@codemirror/lint";
import { parseSource } from "../../lib/tauri-bridge";

export const sysmlLinter = linter(async (view) => {
  const source = view.state.doc.toString();
  try {
    const model = await parseSource(source);
    return model.errors.map((err): Diagnostic => ({
      from: err.span.start_byte,
      to: err.span.end_byte,
      severity: "error",
      message: err.message,
    }));
  } catch {
    return [];
  }
}, { delay: 300 });
```

#### Editor Toolbar (Mobile)

Since on-screen keyboards limit screen space, provide a compact toolbar above the keyboard:

- Common construct buttons: `part`, `attribute`, `port`, `state`, `action`
- Bracket pairs: `{ }`, `[ ]`, `: `, `= `
- Undo / Redo
- This toolbar should appear when the editor is focused and hide otherwise

-----

### Phase 5: File Management + Polish

#### File Open / Save

Use Tauri plugins:

```typescript
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

async function openSysmlFile() {
  const path = await open({
    filters: [{ name: "SysML", extensions: ["sysml", "kerml"] }],
  });
  if (path) {
    await modelStore.loadFile(path);
  }
}

async function saveSysmlFile() {
  const path = await save({
    filters: [{ name: "SysML", extensions: ["sysml"] }],
  });
  if (path) {
    await writeTextFile(path, editorStore.source);
  }
}
```

#### Recent Files

Store recent file paths using Tauri’s `tauri-plugin-store` for persistence across sessions.

#### Export / Share

- Export diagram as SVG (serialize the diagram SVG element)
- Export diagram as PNG (use html2canvas or svg-to-png conversion)
- Share file via system share sheet (use `tauri-plugin-sharesheet` on mobile)

-----

## 4. Key Design Decisions

### tree-sitter Node Kind Discovery Process

The node_visitor.rs file maps tree-sitter node kinds to the semantic model. Since the exact node kind strings depend on the grammar.js rule names, the implementing agent must:

1. Clone the grammar repo and run `npx tree-sitter generate`
1. Create a comprehensive test .sysml file covering all 41 definition types
1. Run `npx tree-sitter parse test.sysml` and capture the CST
1. Extract every unique node kind from the output
1. Map each to the appropriate `ElementKind` variant
1. Special attention to: field names used for “name”, “type”, modifiers, multiplicity

The grammar’s `queries/highlights.scm` file is also an excellent reference for understanding which node kinds and fields exist.

### Incremental Parse Strategy

For editor integration, use tree-sitter’s incremental parsing:

1. User types in CodeMirror
1. CM6 emits a transaction with change ranges
1. Frontend debounces (300ms) then sends the edit description to Rust:
- `start_byte`, `old_end_byte`, `new_end_byte`
- `start_position`, `old_end_position`, `new_end_position`
- New source text
1. Rust calls `SysmlParser::reparse()` which applies `tree.edit()` and reparses
1. Only changed subtrees are rebuilt in the semantic model
1. Updated model is sent back to frontend

### Filter Architecture

Two-tier filtering for responsiveness:

**Tier 1 (Client-side, instant)**: The full element list is held in Zustand. Simple filters (category toggle, name substring) run in JS for instant UI updates. This handles 99% of filter interactions with zero latency.

**Tier 2 (Rust-side, complex queries)**: Cross-reference queries like “show all ports connected to Engine” or “show all requirements satisfied by BrakeSystem” require graph traversal and run in Rust via `filter_elements` or dedicated query commands.

### Mobile-Specific Considerations

- **Safe areas**: Use `env(safe-area-inset-*)` CSS for notch/dynamic island
- **Viewport height**: Use `100dvh` (dynamic viewport height) not `100vh`
- **Touch targets**: Minimum 44×44pt for all interactive elements
- **Bottom sheet**: Use CSS `overscroll-behavior: contain` to prevent background scroll
- **Keyboard handling**: Listen for `visualViewport` resize to adjust editor layout
- **Dark mode**: Use `prefers-color-scheme` media query; SysML tooling users predominantly prefer dark themes

-----

## 5. Dependencies Summary

### Rust (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
tauri-plugin-store = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tree-sitter = "0.24"
tree-sitter-sysml = { git = "https://github.com/jackhale98/tree-sitter-sysml", branch = "main" }
```

### JavaScript (package.json)

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "@tauri-apps/plugin-fs": "^2",
    "@tauri-apps/plugin-store": "^2",
    "react": "^18",
    "react-dom": "^18",
    "zustand": "^4",
    "@codemirror/view": "^6",
    "@codemirror/state": "^6",
    "@codemirror/language": "^6",
    "@codemirror/lint": "^6",
    "codemirror": "^6"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "typescript": "^5",
    "vite": "^5",
    "@vitejs/plugin-react": "^4"
  }
}
```

-----

## 6. Testing Strategy

### Rust Unit Tests

- Parse each of the 195 corpus test files and verify element counts
- Test filter_elements with various category/search combinations
- Test incremental reparse produces correct results after edits
- Benchmark parse time on large .sysml files (Annex A examples)

### Frontend Tests

- Component tests with Vitest + Testing Library for each major component
- Filter interaction tests: toggle categories, type search, clear filters
- Diagram interaction: verify tap-to-select, zoom controls
- Editor: verify syntax highlighting tokens for each SysML keyword

### Integration Tests

- End-to-end: open file → verify element count → filter → verify filtered count
- Edit source → verify model updates → verify diagram reflects changes
- Mobile-specific: gesture tests on iOS simulator and Android emulator

-----

## 7. Build & Distribution

### Desktop

```bash
npx tauri build          # Produces .dmg (macOS), .msi (Windows), .deb/.AppImage (Linux)
```

### Mobile

```bash
npx tauri ios build      # Produces .ipa
npx tauri android build  # Produces .apk / .aab
```

### CI/CD

Use GitHub Actions with the Tauri action:

```yaml
- uses: tauri-apps/tauri-action@v0
  with:
    tagName: v__VERSION__
    releaseName: "SysML Studio v__VERSION__"
```

Mobile builds require macOS runners for iOS and Ubuntu/macOS for Android.

-----

## 8. Future Enhancements (Post-MVP)

- **Git integration**: `isomorphic-git` or Tauri Rust-side git for version-controlled models
- **Model diff**: Compare two .sysml files with visual diff in browser and diagram views
- **Collaborative editing**: WebSocket sync for multi-user editing sessions
- **AI assist**: Integrate LLM for SysML model suggestions, completions, and validation
- **Additional diagram types**: Activity diagrams, parametric diagrams, sequence diagrams
- **SysML v2 API integration**: Connect to SysML v2 API services for model interchange
- **Offline-first**: Full functionality without network; sync when connected
- **Accessibility**: VoiceOver/TalkBack support for diagram navigation, screen reader labels for all elements
