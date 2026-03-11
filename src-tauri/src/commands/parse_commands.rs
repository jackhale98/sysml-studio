use std::sync::Mutex;
use tauri::State;
use crate::adapter;
use crate::model::elements::*;
use crate::model::graph::ElementGraph;
use crate::model::query::{
    self, FilterCriteria, CompletenessReport, TraceabilityEntry, ValidationReport,
};

pub struct AppState {
    pub current_model: Mutex<Option<SysmlModel>>,
    pub current_graph: Mutex<Option<ElementGraph>>,
    /// sysml-core Model kept for lint checks and future analysis
    pub core_model: Mutex<Option<sysml_core::model::Model>>,
    /// Current source text — needed for simulation extraction (constraint/calc/state/action parsers)
    pub current_source: Mutex<String>,
}

#[tauri::command]
pub fn parse_source(source: String, state: State<'_, AppState>) -> Result<SysmlModel, String> {
    let start = std::time::Instant::now();

    // Parse with sysml-core (catch panics to prevent app crash)
    let source_clone = source.clone();
    let parse_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut core_model = sysml_core::parser::parse_file("<buffer>", &source_clone);
        sysml_core::model::qualify_model(&mut core_model);
        core_model
    }));
    let core_model = parse_result.map_err(|_| "Parser crashed on this input — please check for syntax errors".to_string())?;

    let parse_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    // Convert to Studio model format (catch panics)
    let convert_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        adapter::convert_model(&core_model, parse_time_ms)
    }));
    let model = convert_result.map_err(|_| "Model conversion failed — please report this bug".to_string())?;

    // Build relationship graph for MBSE features
    let graph = ElementGraph::build_from_model(&model.elements);
    *state.current_graph.lock().map_err(|e| e.to_string())? = Some(graph);
    *state.core_model.lock().map_err(|e| e.to_string())? = Some(core_model);
    *state.current_model.lock().map_err(|e| e.to_string())? = Some(model.clone());
    *state.current_source.lock().map_err(|e| e.to_string())? = source;

    Ok(model)
}

#[tauri::command]
pub fn open_file(path: String, state: State<'_, AppState>) -> Result<(SysmlModel, String), String> {
    let source = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    // Resolve imports: read sibling .sysml files referenced by import statements
    let combined = resolve_sibling_imports(&source, &path);
    let mut model = parse_source(combined, state)?;
    model.file_path = Some(path);
    Ok((model, source)) // Return original source for the editor, not the combined
}

#[tauri::command]
pub fn save_file(path: String, source: String) -> Result<(), String> {
    std::fs::write(&path, &source).map_err(|e| e.to_string())
}

/// Resolve import statements by reading sibling .sysml files from the same directory.
/// Handles recursive imports (imported files may import other files).
fn resolve_sibling_imports(source: &str, file_path: &str) -> String {
    use std::path::Path;
    use std::collections::HashSet;

    let path = Path::new(file_path);
    let dir = match path.parent() {
        Some(d) => d,
        None => return source.to_string(),
    };
    let current_file = path.file_name().and_then(|f| f.to_str()).unwrap_or("");

    let mut resolved_files = HashSet::new();
    resolved_files.insert(current_file.to_string());

    let mut imported_sources: Vec<String> = Vec::new();
    let mut pending_sources = vec![source.to_string()];

    while let Some(current_source) = pending_sources.pop() {
        for line in current_source.lines() {
            let trimmed = line.trim();
            // Match: import Foo, import Foo::*, import Foo::Bar::*, etc.
            let rest = if let Some(r) = trimmed.strip_prefix("import ") {
                r
            } else if let Some(r) = trimmed.strip_prefix("public import ") {
                r
            } else if let Some(r) = trimmed.strip_prefix("private import ") {
                r
            } else {
                continue;
            };

            // Extract the first path component as the file name to look up
            let name: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
            if name.is_empty() { continue; }

            for ext in &["sysml", "sysml2"] {
                let fname = format!("{}.{}", name, ext);
                if resolved_files.contains(&fname) { break; }
                let import_path = dir.join(&fname);
                if let Ok(import_source) = std::fs::read_to_string(&import_path) {
                    resolved_files.insert(fname.clone());
                    imported_sources.push(format!("// --- Imported from {} ---\n{}", fname, import_source));
                    pending_sources.push(import_source);
                    break;
                }
            }
        }
    }

    if imported_sources.is_empty() {
        return source.to_string();
    }

    format!("{}\n\n{}", imported_sources.join("\n\n"), source)
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

/// MBSE: Run model validation — combines Studio checks with sysml-core lint checks
#[tauri::command]
pub fn get_validation(
    state: State<'_, AppState>,
) -> Result<ValidationReport, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    let graph_lock = state.current_graph.lock().map_err(|e| e.to_string())?;
    let graph = graph_lock.as_ref().ok_or("No graph built")?;

    let mut report = query::validate_model(&model.elements, graph);

    // Add sysml-core lint check results (catch panics)
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    if let Some(ref core_model) = *core_lock {
        if let Ok(core_issues) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            adapter::run_core_checks(core_model)
        })) {
            for issue in core_issues {
                match issue.severity.as_str() {
                    "error" => report.summary.errors += 1,
                    "warning" => report.summary.warnings += 1,
                    _ => report.summary.infos += 1,
                }
                report.issues.push(issue);
            }
        }
    }

    Ok(report)
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
    pub kind: String,
}

/// Walk the sysml-core CST dump and produce highlight tokens.
/// For now, return empty — highlighting is handled by the CodeMirror editor
/// in the frontend via the browser-side grammar. In the future we can use
/// tree-sitter queries from sysml-core for richer highlighting.
#[tauri::command]
pub fn get_highlight_ranges(_state: State<'_, AppState>) -> Result<Vec<HighlightToken>, String> {
    // The frontend CodeMirror editor handles its own syntax highlighting.
    // This command exists for backwards compatibility.
    Ok(vec![])
}
