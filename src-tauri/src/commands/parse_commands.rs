use std::sync::Mutex;
use tauri::State;
use crate::parser::sysml_parser::SysmlParser;
use crate::parser::node_visitor::ModelBuilder;
use crate::model::elements::*;
use crate::model::graph::ElementGraph;
use crate::model::query::{
    self, FilterCriteria, CompletenessReport, TraceabilityEntry,
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
