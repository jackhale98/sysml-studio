use std::sync::Mutex;
use tauri::State;
use tree_sitter::InputEdit;
use crate::parser::sysml_parser::SysmlParser;
use crate::parser::node_visitor::ModelBuilder;
use crate::model::elements::*;
use crate::model::graph::ElementGraph;
use crate::model::query::{
    self, FilterCriteria, CompletenessReport, TraceabilityEntry, ValidationReport,
};

pub struct AppState {
    pub parser: Mutex<SysmlParser>,
    pub current_model: Mutex<Option<SysmlModel>>,
    pub current_graph: Mutex<Option<ElementGraph>>,
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
        definitions: elements.iter().filter(|e| e.kind.is_definition()).count() as u32,
        usages: elements.iter().filter(|e| e.kind.is_usage()).count() as u32,
        relationships: elements.iter().filter(|e| e.kind.is_relationship()).count() as u32,
        errors: errors.len() as u32,
        parse_time_ms: start.elapsed().as_secs_f64() * 1000.0,
    };

    // Build relationship graph for MBSE features
    let graph = ElementGraph::build_from_model(&elements);
    *state.current_graph.lock().map_err(|e| e.to_string())? = Some(graph);

    let model = SysmlModel {
        file_path: None,
        elements,
        errors,
        stats,
    };

    *state.current_model.lock().map_err(|e| e.to_string())? = Some(model.clone());
    Ok(model)
}

/// Incremental reparse after an editor edit — faster than full parse for large files
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn reparse_source(
    source: String,
    start_byte: u32,
    old_end_byte: u32,
    new_end_byte: u32,
    start_line: u32,
    start_col: u32,
    old_end_line: u32,
    old_end_col: u32,
    new_end_line: u32,
    new_end_col: u32,
    state: State<'_, AppState>,
) -> Result<SysmlModel, String> {
    let mut parser = state.parser.lock().map_err(|e| e.to_string())?;

    // Only use incremental reparse if we have a previous tree
    let start = std::time::Instant::now();
    let tree = if parser.tree().is_some() {
        let edit = InputEdit {
            start_byte: start_byte as usize,
            old_end_byte: old_end_byte as usize,
            new_end_byte: new_end_byte as usize,
            start_position: tree_sitter::Point { row: start_line as usize, column: start_col as usize },
            old_end_position: tree_sitter::Point { row: old_end_line as usize, column: old_end_col as usize },
            new_end_position: tree_sitter::Point { row: new_end_line as usize, column: new_end_col as usize },
        };
        parser.reparse(&source, &edit).ok_or("Incremental reparse failed")?
    } else {
        parser.parse(&source).ok_or("Parse failed")?
    };

    let builder = ModelBuilder::new(&source);
    let (elements, errors) = builder.build(tree);

    let stats = ModelStats {
        total_elements: elements.len() as u32,
        definitions: elements.iter().filter(|e| e.kind.is_definition()).count() as u32,
        usages: elements.iter().filter(|e| e.kind.is_usage()).count() as u32,
        relationships: elements.iter().filter(|e| e.kind.is_relationship()).count() as u32,
        errors: errors.len() as u32,
        parse_time_ms: start.elapsed().as_secs_f64() * 1000.0,
    };

    let graph = ElementGraph::build_from_model(&elements);
    *state.current_graph.lock().map_err(|e| e.to_string())? = Some(graph);

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
pub fn open_file(path: String, state: State<'_, AppState>) -> Result<(SysmlModel, String), String> {
    let source = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut model = parse_source(source.clone(), state)?;
    model.file_path = Some(path);
    Ok((model, source))
}

#[tauri::command]
pub fn save_file(path: String, source: String) -> Result<(), String> {
    std::fs::write(&path, &source).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn filter_elements(
    categories: Vec<String>,
    search_term: Option<String>,
    parent_name: Option<String>,
    kinds: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<SysmlElement>, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    let criteria = FilterCriteria {
        categories,
        search_term,
        parent_name,
        kinds,
        has_type_ref: None,
        has_doc: None,
    };

    Ok(query::filter_elements(&model.elements, &criteria))
}

/// MBSE: Get impact analysis for an element
#[tauri::command]
pub fn impact_analysis(
    element_id: ElementId,
    state: State<'_, AppState>,
) -> Result<Vec<SysmlElement>, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    let graph_lock = state.current_graph.lock().map_err(|e| e.to_string())?;
    let graph = graph_lock.as_ref().ok_or("No graph built")?;

    let impacted_ids = graph.impact_analysis(element_id);
    let impacted_elements: Vec<SysmlElement> = model.elements.iter()
        .filter(|e| impacted_ids.contains(&e.id))
        .cloned()
        .collect();

    Ok(impacted_elements)
}

/// MBSE: Get completeness report
#[tauri::command]
pub fn check_completeness(
    state: State<'_, AppState>,
) -> Result<CompletenessReport, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    let graph_lock = state.current_graph.lock().map_err(|e| e.to_string())?;
    let graph = graph_lock.as_ref().ok_or("No graph built")?;

    Ok(query::check_completeness(&model.elements, graph))
}

/// MBSE: Get traceability matrix for requirements
#[tauri::command]
pub fn get_traceability_matrix(
    state: State<'_, AppState>,
) -> Result<Vec<TraceabilityEntry>, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    let graph_lock = state.current_graph.lock().map_err(|e| e.to_string())?;
    let graph = graph_lock.as_ref().ok_or("No graph built")?;

    Ok(query::build_traceability_matrix(&model.elements, graph))
}

/// MBSE: Run model validation
#[tauri::command]
pub fn get_validation(
    state: State<'_, AppState>,
) -> Result<ValidationReport, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    let graph_lock = state.current_graph.lock().map_err(|e| e.to_string())?;
    let graph = graph_lock.as_ref().ok_or("No graph built")?;

    Ok(query::validate_model(&model.elements, graph))
}

/// Get connected elements for a given element (for diagram highlighting)
#[tauri::command]
pub fn get_connected_elements(
    element_id: ElementId,
    state: State<'_, AppState>,
) -> Result<Vec<ElementId>, String> {
    let graph_lock = state.current_graph.lock().map_err(|e| e.to_string())?;
    let graph = graph_lock.as_ref().ok_or("No graph built")?;

    Ok(graph.connected_elements(element_id).into_iter().collect())
}

/// Syntax highlighting token from tree-sitter parse tree
#[derive(Debug, Clone, serde::Serialize)]
pub struct HighlightToken {
    pub start: u32,
    pub end: u32,
    pub kind: String,  // "keyword", "type", "comment", "string", "number", "punctuation", "definition", "property", "operator"
}

/// Walk the tree-sitter parse tree and extract highlight tokens
#[tauri::command]
pub fn get_highlight_ranges(state: State<'_, AppState>) -> Result<Vec<HighlightToken>, String> {
    let parser = state.parser.lock().map_err(|e| e.to_string())?;
    let tree = parser.tree().ok_or("No parse tree available")?;

    let mut tokens = Vec::new();
    let mut cursor = tree.root_node().walk();
    walk_for_highlights(&mut cursor, &mut tokens);

    // Sort by start position for efficient decoration application
    tokens.sort_by_key(|t| t.start);
    Ok(tokens)
}

fn walk_for_highlights(cursor: &mut tree_sitter::TreeCursor, tokens: &mut Vec<HighlightToken>) {
    loop {
        let node = cursor.node();

        // Process leaf nodes and specific named nodes
        if node.child_count() == 0 {
            // Leaf node — classify it
            let start = node.start_byte() as u32;
            let end = node.end_byte() as u32;
            if start == end {
                // Skip zero-width nodes
                if !cursor.goto_next_sibling() {
                    loop {
                        if !cursor.goto_parent() { return; }
                        if cursor.goto_next_sibling() { break; }
                    }
                }
                continue;
            }

            let kind_str = node.kind();
            let is_named = node.is_named();

            let highlight = if !is_named {
                // Anonymous (literal) nodes — keywords and punctuation
                classify_anonymous(kind_str)
            } else {
                // Named leaf nodes
                classify_named_leaf(kind_str, cursor)
            };

            if let Some(h) = highlight {
                tokens.push(HighlightToken { start, end, kind: h.to_string() });
            }
        } else {
            // Non-leaf named nodes — handle comments and doc_comments as whole spans
            let kind_str = node.kind();
            match kind_str {
                "doc_comment" | "comment_element" | "block_comment" => {
                    tokens.push(HighlightToken {
                        start: node.start_byte() as u32,
                        end: node.end_byte() as u32,
                        kind: "comment".to_string(),
                    });
                    // Don't recurse into comment children
                    if !cursor.goto_next_sibling() {
                        loop {
                            if !cursor.goto_parent() { return; }
                            if cursor.goto_next_sibling() { break; }
                        }
                    }
                    continue;
                }
                _ => {}
            }
        }

        // Depth-first traversal
        if node.child_count() > 0 && cursor.goto_first_child() {
            continue;
        }
        if cursor.goto_next_sibling() {
            continue;
        }
        loop {
            if !cursor.goto_parent() { return; }
            if cursor.goto_next_sibling() { break; }
        }
    }
}

fn classify_anonymous(text: &str) -> Option<&'static str> {
    match text {
        // SysML keywords
        "package" | "part" | "def" | "attribute" | "port" | "connection" | "interface" |
        "item" | "action" | "state" | "transition" | "constraint" | "requirement" |
        "concern" | "view" | "viewpoint" | "rendering" | "allocation" | "analysis" |
        "case" | "use" | "verification" | "enum" | "enumeration" | "occurrence" |
        "flow" | "import" | "alias" | "abstract" | "readonly" | "derived" |
        "in" | "out" | "inout" | "first" | "then" | "do" | "entry" | "exit" |
        "if" | "else" | "accept" | "send" | "assign" | "assert" | "satisfy" |
        "after" | "at" | "when" | "decide" | "merge" | "fork" | "join" |
        "private" | "protected" | "public" | "ref" | "connect" | "to" |
        "allocate" | "expose" | "exhibit" | "include" | "perform" |
        "require" | "assume" | "verify" | "subject" | "actor" | "objective" |
        "stakeholder" | "calc" | "function" | "predicate" | "metadata" |
        "about" | "doc" | "comment" | "variation" | "variant" | "individual" |
        "snapshot" | "timeslice" | "event" | "bind" | "succession" | "message" |
        "dependency" | "filter" | "render" | "return" => Some("keyword"),

        // Operators
        ":>" | ":>>" | "~" | "=" | "==" | "!=" | "<" | ">" | "<=" | ">=" |
        "+" | "-" | "*" | "/" | "**" | ".." | "->" | "." | "::" => Some("operator"),

        // Punctuation
        "{" | "}" | "(" | ")" | "[" | "]" | ";" | ":" | "," | "|" | "&" | "@" | "#" => Some("punctuation"),

        // Boolean/null literals
        "true" | "false" | "null" => Some("literal"),

        _ => None,
    }
}

fn classify_named_leaf(kind: &str, cursor: &tree_sitter::TreeCursor) -> Option<&'static str> {
    match kind {
        "identifier" => {
            // Check parent context to determine if this is a type name or definition name
            let field = cursor.field_name();
            match field {
                Some("name") => {
                    // Check grandparent to see if this is a definition name
                    // We can't easily look at grandparent with the cursor, so just return "definition"
                    Some("definition")
                }
                Some("type") | Some("target") => Some("type"),
                _ => {
                    // Bare identifier — could be a type reference after ":"
                    // We'll let the parent classification handle it
                    None
                }
            }
        }
        "qualified_name" => None, // will be handled by its children
        "number_literal" | "integer_literal" | "real_literal" => Some("number"),
        "string_literal" => Some("string"),
        _ => None,
    }
}
