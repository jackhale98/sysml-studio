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
            current_graph: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::parse_commands::parse_source,
            commands::parse_commands::open_file,
            commands::parse_commands::save_file,
            commands::parse_commands::filter_elements,
            commands::parse_commands::impact_analysis,
            commands::parse_commands::check_completeness,
            commands::parse_commands::get_traceability_matrix,
            commands::parse_commands::get_connected_elements,
            commands::diagram_commands::compute_bdd_layout,
            commands::diagram_commands::compute_stm_layout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
