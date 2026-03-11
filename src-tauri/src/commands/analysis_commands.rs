//! Analysis commands: BOM rollups, constraint/calc evaluation, state machine sim, action flow sim.
//!
//! Leverages sysml-core's simulation engine directly — its types already derive Serialize
//! so we pass them through to the frontend with minimal wrapping.

use serde::{Serialize, Deserialize};
use tauri::State;
use crate::commands::parse_commands::AppState;
use crate::model::elements::*;

// Re-export sysml-core types that are already Serialize — no wrapper needed
use sysml_core::sim::constraint_eval::{ConstraintModel, CalcModel};
use sysml_core::sim::state_machine::StateMachineModel;
use sysml_core::sim::state_sim::SimulationState;
use sysml_core::sim::action_flow::ActionModel;
use sysml_core::sim::action_exec::ActionExecState;
use sysml_core::sim::expr::{Env, Value};

// ─── BOM / Rollup (Studio-specific — not in sysml-core) ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BomNode {
    pub element_id: ElementId,
    pub name: String,
    pub kind: String,
    pub type_ref: Option<String>,
    pub multiplicity: f64,
    pub attributes: Vec<BomAttribute>,
    pub children: Vec<BomNode>,
    pub rollups: std::collections::HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BomAttribute {
    pub name: String,
    pub value: Option<f64>,
    pub unit: Option<String>,
    pub type_ref: Option<String>,
}

/// Eval result wrapper — thin envelope around sysml-core's evaluator output
#[derive(Debug, Clone, Serialize)]
pub struct EvalResult {
    pub name: String,
    pub success: bool,
    pub value: String,
    pub error: Option<String>,
}

// ─── BOM Rollup ───

#[tauri::command]
pub fn compute_bom(
    root_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<BomNode>, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    let roots: Vec<&SysmlElement> = if let Some(ref name) = root_name {
        model.elements.iter()
            .filter(|e| e.name.as_deref() == Some(name.as_str()) &&
                matches!(e.kind, ElementKind::PartDef | ElementKind::PartUsage))
            .collect()
    } else {
        model.elements.iter()
            .filter(|e| matches!(e.kind, ElementKind::PartDef | ElementKind::PartUsage) &&
                e.parent_id.map(|pid| model.elements.iter().find(|p| p.id == pid)
                    .map(|p| p.kind == ElementKind::Package).unwrap_or(false))
                    .unwrap_or(true))
            .collect()
    };

    Ok(roots.iter()
        .map(|r| build_bom_node(r, &model.elements, 1.0, &mut std::collections::HashSet::new()))
        .collect())
}

fn build_bom_node(
    el: &SysmlElement,
    all: &[SysmlElement],
    multiplicity: f64,
    visited: &mut std::collections::HashSet<ElementId>,
) -> BomNode {
    visited.insert(el.id);

    let attributes: Vec<BomAttribute> = all.iter()
        .filter(|c| c.parent_id == Some(el.id) && c.kind == ElementKind::AttributeUsage)
        .map(|attr| BomAttribute {
            name: attr.name.clone().unwrap_or_default(),
            value: attr.value_expr.as_ref().and_then(|v| v.trim().parse::<f64>().ok()),
            unit: None,
            type_ref: attr.type_ref.clone(),
        })
        .collect();

    let mut children = Vec::new();
    for child in all.iter().filter(|c| c.parent_id == Some(el.id) && c.kind == ElementKind::PartUsage) {
        if visited.contains(&child.id) { continue; }
        let child_mult = parse_multiplicity(child.multiplicity.as_deref());

        // Resolve type_ref → definition for richer attribute data
        let resolved = child.type_ref.as_deref()
            .and_then(|tref| all.iter().find(|e| e.kind.is_definition() && e.name.as_deref() == Some(tref)))
            .filter(|def| !visited.contains(&def.id));

        children.push(build_bom_node(
            resolved.unwrap_or(child), all, child_mult, visited,
        ));
    }

    // Rollups: compute per-unit value (own attrs + children), then scale by multiplicity
    let mut rollups: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    for attr in &attributes {
        if let Some(val) = attr.value {
            *rollups.entry(attr.name.clone()).or_default() += val;
        }
    }
    for child in &children {
        for (key, &val) in &child.rollups {
            *rollups.entry(key.clone()).or_default() += val;
        }
    }
    // Apply this node's multiplicity to the entire rollup
    for val in rollups.values_mut() {
        *val *= multiplicity;
    }

    BomNode {
        element_id: el.id,
        name: el.name.clone().unwrap_or_else(|| "<unnamed>".into()),
        kind: el.kind.display_label().to_string(),
        type_ref: el.type_ref.clone(),
        multiplicity,
        attributes,
        children,
        rollups,
    }
}

fn parse_multiplicity(mult: Option<&str>) -> f64 {
    match mult {
        None => 1.0,
        Some(s) => {
            let s = s.trim().trim_start_matches('[').trim_end_matches(']');
            if s.contains("..") {
                s.split("..").last().and_then(|p| p.parse::<f64>().ok()).unwrap_or(1.0)
            } else if s == "*" {
                1.0
            } else {
                s.parse::<f64>().unwrap_or(1.0)
            }
        }
    }
}

// ─── Constraints & Calculations (delegates to sysml-core extractors + evaluator) ───

/// Returns sysml-core's ConstraintModel directly — already Serialize
#[tauri::command]
pub fn list_constraints(state: State<'_, AppState>) -> Result<Vec<ConstraintModel>, String> {
    let source = state.current_source.lock().map_err(|e| e.to_string())?;
    if source.is_empty() { return Ok(vec![]); }
    Ok(sysml_core::sim::constraint_eval::extract_constraints("<buffer>", &source))
}

/// Returns sysml-core's CalcModel directly
#[tauri::command]
pub fn list_calculations(state: State<'_, AppState>) -> Result<Vec<CalcModel>, String> {
    let source = state.current_source.lock().map_err(|e| e.to_string())?;
    if source.is_empty() { return Ok(vec![]); }
    Ok(sysml_core::sim::constraint_eval::extract_calculations("<buffer>", &source))
}

#[tauri::command]
pub fn evaluate_constraint(
    constraint_name: String,
    bindings: std::collections::HashMap<String, f64>,
    state: State<'_, AppState>,
) -> Result<EvalResult, String> {
    let source = state.current_source.lock().map_err(|e| e.to_string())?;
    let constraints = sysml_core::sim::constraint_eval::extract_constraints("<buffer>", &source);
    let c = constraints.iter().find(|c| c.name == constraint_name)
        .ok_or_else(|| format!("Constraint '{}' not found", constraint_name))?;
    let expr = c.expression.as_ref().ok_or("Constraint has no expression")?;

    let mut env = Env::new();
    for (k, v) in &bindings { env.bind(k.clone(), Value::Number(*v)); }

    match sysml_core::sim::eval::evaluate_constraint(expr, &env) {
        Ok(result) => Ok(EvalResult { name: constraint_name, success: true, value: result.to_string(), error: None }),
        Err(e) => Ok(EvalResult { name: constraint_name, success: false, value: String::new(), error: Some(e.message) }),
    }
}

#[tauri::command]
pub fn evaluate_calculation(
    calc_name: String,
    bindings: std::collections::HashMap<String, f64>,
    state: State<'_, AppState>,
) -> Result<EvalResult, String> {
    let source = state.current_source.lock().map_err(|e| e.to_string())?;
    let calcs = sysml_core::sim::constraint_eval::extract_calculations("<buffer>", &source);
    let c = calcs.iter().find(|c| c.name == calc_name)
        .ok_or_else(|| format!("Calculation '{}' not found", calc_name))?;
    let expr = c.return_expr.as_ref().ok_or("Calculation has no return expression")?;

    let mut env = Env::new();
    for (k, v) in &bindings { env.bind(k.clone(), Value::Number(*v)); }
    for (name, bind_expr) in &c.local_bindings {
        if let Ok(val) = sysml_core::sim::eval::evaluate(bind_expr, &env) {
            env.bind(name.clone(), val);
        }
    }

    match sysml_core::sim::eval::evaluate_calc(expr, &env) {
        Ok(result) => Ok(EvalResult { name: calc_name, success: true, value: result.to_string(), error: None }),
        Err(e) => Ok(EvalResult { name: calc_name, success: false, value: String::new(), error: Some(e.message) }),
    }
}

// ─── State Machine Simulation (delegates to sysml-core sim engine) ───

/// Returns sysml-core's StateMachineModel directly
#[tauri::command]
pub fn list_state_machines(state: State<'_, AppState>) -> Result<Vec<StateMachineModel>, String> {
    let source = state.current_source.lock().map_err(|e| e.to_string())?;
    if source.is_empty() { return Ok(vec![]); }
    let src = source.clone();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sysml_core::sim::state_parser::extract_state_machines("<buffer>", &src)
    })).map_err(|_| "State machine extraction failed".to_string())
}

/// Returns sysml-core's SimulationState directly
#[tauri::command]
pub fn simulate_state_machine(
    machine_name: String,
    events: Vec<String>,
    max_steps: Option<usize>,
    state: State<'_, AppState>,
) -> Result<SimulationState, String> {
    let source = state.current_source.lock().map_err(|e| e.to_string())?;
    let src = source.clone();
    let machines = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sysml_core::sim::state_parser::extract_state_machines("<buffer>", &src)
    })).map_err(|_| "State machine extraction failed".to_string())?;

    let machine = machines.iter().find(|m| m.name == machine_name)
        .ok_or_else(|| format!("State machine '{}' not found", machine_name))?;

    let config = sysml_core::sim::state_sim::SimConfig {
        max_steps: max_steps.unwrap_or(100),
        initial_env: Env::new(),
        events,
    };

    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sysml_core::sim::state_sim::simulate(machine, &config)
    })).map_err(|_| "State machine simulation crashed".to_string())
}

// ─── Action Flow Execution (delegates to sysml-core action engine) ───

/// Returns sysml-core's ActionModel directly
#[tauri::command]
pub fn list_actions(state: State<'_, AppState>) -> Result<Vec<ActionModel>, String> {
    let source = state.current_source.lock().map_err(|e| e.to_string())?;
    if source.is_empty() { return Ok(vec![]); }
    let src = source.clone();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sysml_core::sim::action_parser::extract_actions("<buffer>", &src)
    })).map_err(|_| "Action extraction failed".to_string())
}

/// Returns sysml-core's ActionExecState directly
#[tauri::command]
pub fn execute_action(
    action_name: String,
    max_steps: Option<usize>,
    state: State<'_, AppState>,
) -> Result<ActionExecState, String> {
    let source = state.current_source.lock().map_err(|e| e.to_string())?;
    let src = source.clone();
    let actions = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sysml_core::sim::action_parser::extract_actions("<buffer>", &src)
    })).map_err(|_| "Action extraction failed".to_string())?;

    let action = actions.iter().find(|a| a.name == action_name)
        .ok_or_else(|| format!("Action '{}' not found", action_name))?;

    let config = sysml_core::sim::action_exec::ActionExecConfig {
        max_steps: max_steps.unwrap_or(1000),
        initial_env: Env::new(),
    };

    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sysml_core::sim::action_exec::execute_action(action, &config)
    })).map_err(|_| "Action execution crashed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::elements::*;

    fn make_el(
        id: ElementId, kind: ElementKind, name: &str,
        parent_id: Option<ElementId>, type_ref: Option<&str>,
        value_expr: Option<&str>, multiplicity: Option<&str>,
    ) -> SysmlElement {
        SysmlElement {
            id, kind,
            name: Some(name.to_string()),
            qualified_name: name.to_string(),
            category: Category::Structure,
            parent_id,
            children_ids: vec![],
            span: SourceSpan { start_line: 0, start_col: 0, end_line: 0, end_col: 0, start_byte: 0, end_byte: 0 },
            type_ref: type_ref.map(String::from),
            specializations: vec![],
            modifiers: vec![],
            multiplicity: multiplicity.map(String::from),
            doc: None,
            short_name: None,
            value_expr: value_expr.map(String::from),
        }
    }

    #[test]
    fn test_bom_rollup_mass_and_cost() {
        // Build: Vehicle { mass=100, cost=500, engine:Engine, wheels:Wheel[4], chassis:Chassis }
        // Engine { mass=150, cost=5000 }
        // Wheel { mass=12.5, cost=200 }
        // Chassis { mass=800, cost=3000 }
        let elements = vec![
            make_el(0, ElementKind::Package, "VehicleBOM", None, None, None, None),
            // Definitions
            make_el(1, ElementKind::PartDef, "Engine", Some(0), None, None, None),
            make_el(2, ElementKind::AttributeUsage, "mass", Some(1), Some("Real"), Some("150.0"), None),
            make_el(3, ElementKind::AttributeUsage, "cost", Some(1), Some("Real"), Some("5000.0"), None),
            make_el(4, ElementKind::PartDef, "Wheel", Some(0), None, None, None),
            make_el(5, ElementKind::AttributeUsage, "mass", Some(4), Some("Real"), Some("12.5"), None),
            make_el(6, ElementKind::AttributeUsage, "cost", Some(4), Some("Real"), Some("200.0"), None),
            make_el(7, ElementKind::PartDef, "Chassis", Some(0), None, None, None),
            make_el(8, ElementKind::AttributeUsage, "mass", Some(7), Some("Real"), Some("800.0"), None),
            make_el(9, ElementKind::AttributeUsage, "cost", Some(7), Some("Real"), Some("3000.0"), None),
            // Vehicle definition
            make_el(10, ElementKind::PartDef, "Vehicle", Some(0), None, None, None),
            make_el(11, ElementKind::AttributeUsage, "mass", Some(10), Some("Real"), Some("100.0"), None),
            make_el(12, ElementKind::AttributeUsage, "cost", Some(10), Some("Real"), Some("500.0"), None),
            // Part usages inside Vehicle
            make_el(13, ElementKind::PartUsage, "engine", Some(10), Some("Engine"), None, None),
            make_el(14, ElementKind::PartUsage, "wheels", Some(10), Some("Wheel"), None, Some("4")),
            make_el(15, ElementKind::PartUsage, "chassis", Some(10), Some("Chassis"), None, None),
        ];

        let mut visited = std::collections::HashSet::new();
        let vehicle = &elements[10]; // Vehicle PartDef
        let bom = build_bom_node(vehicle, &elements, 1.0, &mut visited);

        // Vehicle's own: mass=100, cost=500
        // + engine (Engine): mass=150, cost=5000
        // + wheels (Wheel x4): mass=12.5*4=50, cost=200*4=800
        // + chassis (Chassis): mass=800, cost=3000
        // Total mass: 100 + 150 + 50 + 800 = 1100
        // Total cost: 500 + 5000 + 800 + 3000 = 9300

        let total_mass = bom.rollups.get("mass").copied().unwrap_or(0.0);
        let total_cost = bom.rollups.get("cost").copied().unwrap_or(0.0);

        assert_eq!(bom.name, "Vehicle");
        assert_eq!(bom.children.len(), 3, "Vehicle should have 3 child parts");

        // Check wheel multiplicity
        let wheel_child = bom.children.iter().find(|c| c.name == "Wheel").expect("Wheel child");
        assert_eq!(wheel_child.multiplicity, 4.0);
        let wheel_mass = wheel_child.rollups.get("mass").copied().unwrap_or(0.0);
        assert!((wheel_mass - 50.0).abs() < 0.01, "Wheel mass rollup should be 50, got {}", wheel_mass);

        assert!((total_mass - 1100.0).abs() < 0.01, "Total mass should be 1100, got {}", total_mass);
        assert!((total_cost - 9300.0).abs() < 0.01, "Total cost should be 9300, got {}", total_cost);
    }

    #[test]
    fn test_bom_no_value_expr_skipped() {
        // Attributes without value_expr should not contribute to rollups
        let elements = vec![
            make_el(0, ElementKind::PartDef, "Box", None, None, None, None),
            make_el(1, ElementKind::AttributeUsage, "label", Some(0), Some("String"), None, None),
            make_el(2, ElementKind::AttributeUsage, "mass", Some(0), Some("Real"), Some("25.0"), None),
        ];

        let mut visited = std::collections::HashSet::new();
        let bom = build_bom_node(&elements[0], &elements, 1.0, &mut visited);

        assert_eq!(bom.rollups.len(), 1, "Only 'mass' should roll up, not 'label'");
        assert!((bom.rollups["mass"] - 25.0).abs() < 0.01);
    }

    #[test]
    fn test_bom_nested_multiplicity() {
        // Assembly[4] { SubPart (mass=10) }
        // Total mass should be 4 * 10 = 40, not 10
        let elements = vec![
            make_el(0, ElementKind::Package, "Pkg", None, None, None, None),
            make_el(1, ElementKind::PartDef, "Assembly", Some(0), None, None, None),
            make_el(2, ElementKind::PartUsage, "sub", Some(1), Some("SubPart"), None, None),
            make_el(3, ElementKind::PartDef, "SubPart", Some(0), None, None, None),
            make_el(4, ElementKind::AttributeUsage, "mass", Some(3), Some("Real"), Some("10.0"), None),
            // Top with 4x Assembly
            make_el(5, ElementKind::PartDef, "Top", Some(0), None, None, None),
            make_el(6, ElementKind::PartUsage, "assemblies", Some(5), Some("Assembly"), None, Some("4")),
        ];

        let mut visited = std::collections::HashSet::new();
        let bom = build_bom_node(&elements[5], &elements, 1.0, &mut visited);

        let asm = bom.children.iter().find(|c| c.name == "Assembly").expect("Assembly child");
        let asm_mass = asm.rollups.get("mass").copied().unwrap_or(0.0);
        assert!((asm_mass - 40.0).abs() < 0.01, "Assembly[4] with SubPart(mass=10) should roll up to 40, got {}", asm_mass);

        let top_mass = bom.rollups.get("mass").copied().unwrap_or(0.0);
        assert!((top_mass - 40.0).abs() < 0.01, "Top total mass should be 40, got {}", top_mass);
    }

    #[test]
    fn test_parse_multiplicity_variants() {
        assert_eq!(parse_multiplicity(None), 1.0);
        assert_eq!(parse_multiplicity(Some("4")), 4.0);
        assert_eq!(parse_multiplicity(Some("[4]")), 4.0);
        assert_eq!(parse_multiplicity(Some("0..4")), 4.0);
        assert_eq!(parse_multiplicity(Some("[0..4]")), 4.0);
        assert_eq!(parse_multiplicity(Some("*")), 1.0);
    }
}
