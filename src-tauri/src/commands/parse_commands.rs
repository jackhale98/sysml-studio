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
    /// Sibling project models (same directory) — cross-file resolution
    /// context and the value pool for W017. The ACTIVE file's spans are
    /// never affected by these: it is always parsed alone.
    pub sibling_models: Mutex<Vec<sysml_core::model::Model>>,
    /// Current source text — needed for simulation extraction (constraint/calc/state/action parsers)
    pub current_source: Mutex<String>,
}

/// Parse the active buffer ALONE (its spans always index this exact
/// text) and, when a file path is known, build cross-file resolution
/// context from sibling .sysml/.kerml files via `resolver::Project` —
/// the same mechanism as `sysml check`. Replaces the old
/// concatenate-imports approach, which corrupted every span.
fn build_core_context(
    source: &str,
    path: Option<&str>,
) -> (sysml_core::model::Model, Vec<sysml_core::model::Model>) {
    use std::path::{Path, PathBuf};

    let label = path.unwrap_or("<buffer>");
    let mut model = sysml_core::parser::parse_file(label, source);
    sysml_core::model::qualify_model(&mut model);

    let mut siblings: Vec<sysml_core::model::Model> = Vec::new();
    if let Some(p) = path {
        if let Some(dir) = Path::new(p).parent() {
            let mut files: Vec<PathBuf> = Vec::new();
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let fp = entry.path();
                    let ext = fp.extension().and_then(|e| e.to_str()).unwrap_or("");
                    if matches!(ext, "sysml" | "kerml" | "sysml2") {
                        files.push(fp);
                    }
                }
            }
            files.sort();
            if files.len() > 1 {
                let proj = sysml_core::resolver::Project::from_files(&files);
                model.resolved_imports = proj.resolve_imports(&model);
                model.resolved_imports.extend(proj.resolve_root_refs(&model));
                model.external_references = proj.external_references_for(&model);
                let (satisfied, verified) = proj.traced_requirements();
                model.external_satisfied = satisfied.into_iter().collect();
                model.external_verified = verified.into_iter().collect();
                siblings = proj
                    .models
                    .into_iter()
                    .filter(|m| m.file != model.file)
                    .collect();
            }
        }
    }
    (model, siblings)
}

#[tauri::command]
pub async fn parse_source(
    source: String,
    path: Option<String>,
    state: State<'_, AppState>,
) -> Result<SysmlModel, String> {
    let start = std::time::Instant::now();

    let source_clone = source.clone();
    let path_clone = path.clone();
    // Parse with sysml-core (catch panics to prevent app crash). Nothing
    // is locked while unwinding, so a panic cannot poison state.
    let parse_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        build_core_context(&source_clone, path_clone.as_deref())
    }));
    let (core_model, siblings) = parse_result
        .map_err(|_| "Parser crashed on this input — please check for syntax errors".to_string())?;

    let parse_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    let convert_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        adapter::convert_model(&core_model, parse_time_ms)
    }));
    let mut model = convert_result
        .map_err(|_| "Model conversion failed — please report this bug".to_string())?;
    model.file_path = path;

    let graph = ElementGraph::build_from_model(&model.elements);
    *state.current_graph.lock().map_err(|e| e.to_string())? = Some(graph);
    *state.core_model.lock().map_err(|e| e.to_string())? = Some(core_model);
    *state.sibling_models.lock().map_err(|e| e.to_string())? = siblings;
    *state.current_model.lock().map_err(|e| e.to_string())? = Some(model.clone());
    *state.current_source.lock().map_err(|e| e.to_string())? = source;

    Ok(model)
}

#[tauri::command]
pub async fn open_file(path: String, state: State<'_, AppState>) -> Result<(SysmlModel, String), String> {
    let source = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let model = parse_source(source.clone(), Some(path), state).await?;
    Ok((model, source))
}

/// Atomic save: write to a temp file in the same directory, then rename
/// over the target — a crash mid-write can no longer truncate the model.
#[tauri::command]
pub async fn save_file(path: String, source: String) -> Result<(), String> {
    use std::path::Path;
    let target = Path::new(&path);
    let dir = target.parent().ok_or("invalid path")?;
    let tmp = dir.join(format!(
        ".{}.tmp",
        target.file_name().and_then(|f| f.to_str()).unwrap_or("sysml-studio-save")
    ));
    std::fs::write(&tmp, &source).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, target).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn filter_elements(
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
pub async fn impact_analysis(
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
pub async fn check_completeness(
    state: State<'_, AppState>,
) -> Result<CompletenessReport, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core_model = core_lock.as_ref().ok_or("No model loaded")?;
    let siblings = state.sibling_models.lock().map_err(|e| e.to_string())?;
    Ok(adapter::core_completeness(core_model, &siblings, &model.elements))
}

/// MBSE: Get traceability matrix for requirements
#[tauri::command]
pub async fn get_traceability_matrix(
    state: State<'_, AppState>,
) -> Result<Vec<TraceabilityEntry>, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core_model = core_lock.as_ref().ok_or("No model loaded")?;
    let siblings = state.sibling_models.lock().map_err(|e| e.to_string())?;
    Ok(adapter::core_traceability(core_model, &siblings, &model.elements))
}

/// MBSE: Run model validation — combines Studio checks with sysml-core lint checks
#[tauri::command]
pub async fn get_validation(
    state: State<'_, AppState>,
) -> Result<ValidationReport, String> {
    // Validation is sysml-core's 16 registered checks plus the
    // project-level W017 value-constraint pass — the same rules as
    // `sysml check`, so Studio and the CLI can never disagree. Studio's
    // former hand-rolled rules (9-entry stdlib list, name-equality
    // resolution) produced false positives core's resolver does not.
    let mut issues = {
        let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
        let core_model = core_lock.as_ref().ok_or("No model loaded")?;
        let siblings = state.sibling_models.lock().map_err(|e| e.to_string())?;
        adapter::run_core_checks(core_model, &siblings)
    };

    // Anchor diagnostics to tree elements by source line so the panel
    // can navigate to them.
    {
        let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
        if let Some(model) = model_lock.as_ref() {
            for issue in issues.iter_mut() {
                if issue.line > 0 {
                    if let Some(id) = query::element_at_line(&model.elements, issue.line) {
                        issue.element_id = id;
                    }
                }
            }
        }
    }

    let errors = issues.iter().filter(|i| i.severity == "error").count() as u32;
    let warnings = issues.iter().filter(|i| i.severity == "warning").count() as u32;
    let infos = issues.iter().filter(|i| i.severity == "info").count() as u32;
    Ok(ValidationReport {
        issues,
        summary: query::ValidationSummary { errors, warnings, infos },
    })
}

/// Get connected elements for a given element (for diagram highlighting)
#[tauri::command]
pub async fn get_connected_elements(
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
pub async fn get_highlight_ranges(_state: State<'_, AppState>) -> Result<Vec<HighlightToken>, String> {
    // The frontend CodeMirror editor handles its own syntax highlighting.
    // This command exists for backwards compatibility.
    Ok(vec![])
}
