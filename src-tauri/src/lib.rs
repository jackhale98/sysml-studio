pub mod adapter;
pub mod model;
pub mod commands;

use commands::parse_commands::AppState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            current_model: Mutex::new(None),
            current_graph: Mutex::new(None),
            core_model: Mutex::new(None),
            sibling_models: Mutex::new(Vec::new()),
            current_source: Mutex::new(String::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::parse_commands::parse_source,
            commands::parse_commands::open_file,
            commands::parse_commands::save_file,
            commands::edit_commands::edit_element_source,
            commands::edit_commands::delete_element_source,
            commands::edit_commands::insert_element_source,
            commands::analysis_commands::render_model_view,
            commands::analysis_commands::list_model_views,
            commands::parse_commands::filter_elements,
            commands::parse_commands::impact_analysis,
            commands::parse_commands::check_completeness,
            commands::parse_commands::get_traceability_matrix,
            commands::parse_commands::get_connected_elements,
            commands::parse_commands::get_validation,
            commands::parse_commands::get_highlight_ranges,
            commands::diagram_commands::compute_bdd_layout,
            commands::diagram_commands::compute_stm_layout,
            commands::diagram_commands::compute_req_layout,
            commands::diagram_commands::compute_ucd_layout,
            commands::diagram_commands::compute_ibd_layout,
            commands::diagram_commands::compute_act_layout,
            commands::analysis_commands::compute_bom,
            commands::analysis_commands::list_constraints,
            commands::analysis_commands::list_calculations,
            commands::analysis_commands::evaluate_constraint,
            commands::analysis_commands::evaluate_calculation,
            commands::analysis_commands::list_state_machines,
            commands::analysis_commands::simulate_state_machine,
            commands::analysis_commands::list_actions,
            commands::analysis_commands::execute_action,
            commands::analysis_commands::compute_rollup,
            commands::analysis_commands::list_rollup_targets,
            commands::analysis_commands::list_analysis_cases,
            commands::analysis_commands::evaluate_analysis_case,
            commands::analysis_commands::evaluate_trade_study,
            commands::analysis_commands::evaluate_what_if,
            commands::analysis_commands::evaluate_sweep,
            commands::analysis_commands::convert_units,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
