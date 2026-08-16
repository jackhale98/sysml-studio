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

#[derive(Debug, Clone, Serialize)]
pub struct BomResponse {
    pub nodes: Vec<BomNode>,
    /// Unit per attribute key (from `value [unit]` brackets), as
    /// converted-to by the rollup engine.
    pub units: std::collections::HashMap<String, Option<String>>,
    /// Unit conversions the engine could not perform - non-empty means
    /// a total is suspect. Surfaced, never swallowed.
    pub warnings: Vec<String>,
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
) -> Result<BomResponse, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core_model = core_lock.as_ref().ok_or("No model loaded")?;
    let siblings = state.sibling_models.lock().map_err(|e| e.to_string())?;
    let merged = crate::adapter::merged_project_model(core_model, &siblings);

    // Roots: the named element, or every part def at package level.
    let roots: Vec<&SysmlElement> = if let Some(ref name) = root_name {
        model.elements.iter()
            .filter(|e| e.name.as_deref() == Some(name.as_str()) &&
                matches!(e.kind, ElementKind::PartDef | ElementKind::PartUsage))
            .collect()
    } else {
        model.elements.iter()
            .filter(|e| matches!(e.kind, ElementKind::PartDef) &&
                e.parent_id.map(|pid| model.elements.iter().find(|p| p.id == pid)
                    .map(|p| p.kind == ElementKind::Package).unwrap_or(false))
                    .unwrap_or(true))
            .collect()
    };

    let mut units: std::collections::HashMap<String, Option<String>> = Default::default();
    let mut warnings: Vec<String> = Vec::new();
    let nodes = roots.iter()
        .map(|r| build_bom_node(r, model, &merged, &mut units, &mut warnings))
        .collect();

    warnings.sort();
    warnings.dedup();
    Ok(BomResponse { nodes, units, warnings })
}

/// Build the display tree from Studio elements (usage names, def types)
/// and stamp every number from sysml-core's rollup engine - the same
/// engine as the Rollup tab and `sysml rollup`, so the two can never
/// disagree. Values parse unit brackets (`250 [SI::kg]`).
fn build_bom_node(
    el: &SysmlElement,
    model: &SysmlModel,
    merged: &sysml_core::model::Model,
    units: &mut std::collections::HashMap<String, Option<String>>,
    warnings: &mut Vec<String>,
) -> BomNode {
    use sysml_core::sim::rollup::{evaluate_rollup, AggregationMethod};

    // The def this node rolls up from: itself (def) or its type (usage).
    let def_name: Option<String> = if el.kind == ElementKind::PartDef {
        el.name.clone()
    } else {
        el.type_ref.as_ref().map(|t| t.rsplit("::").next().unwrap_or(t).to_string())
    };

    // Attribute keys reachable from this def, via the engine's target
    // listing on the merged model.
    let mut rollups: std::collections::HashMap<String, f64> = Default::default();
    if let Some(ref dn) = def_name {
        for attr in rollup_attr_keys(merged, dn) {
            let r = evaluate_rollup(merged, dn, &attr, AggregationMethod::Sum);
            rollups.insert(attr.clone(), r.total);
            units.entry(attr).or_insert(r.unit.clone());
            warnings.extend(r.conversion_warnings.iter().cloned());
        }
    }

    let attributes: Vec<BomAttribute> = model.elements.iter()
        .filter(|c| c.parent_id == Some(el.id) && c.kind == ElementKind::AttributeUsage)
        .map(|attr| {
            let parsed = attr.value_expr.as_deref()
                .and_then(sysml_core::sim::resolve::parse_value_with_unit);
            BomAttribute {
                name: attr.name.clone().unwrap_or_default(),
                value: parsed.as_ref().map(|(v, _)| *v),
                unit: parsed.and_then(|(_, u)| u),
                type_ref: attr.type_ref.clone(),
            }
        })
        .collect();

    // Children: part usages under this element (display structure only;
    // numbers above already include them via the engine).
    let children: Vec<BomNode> = model.elements.iter()
        .filter(|c| c.parent_id == Some(el.id) && c.kind == ElementKind::PartUsage)
        .map(|child| build_bom_node(child, model, merged, units, warnings))
        .collect();

    let quantity = el.multiplicity.as_deref()
        .map(parse_multiplicity_quantity)
        .unwrap_or(1.0);

    BomNode {
        element_id: el.id,
        name: el.name.clone().unwrap_or_else(|| "<unnamed>".into()),
        kind: el.kind.display_label().to_string(),
        type_ref: el.type_ref.clone(),
        multiplicity: quantity,
        attributes,
        children,
        rollups,
    }
}

/// Attribute names with numeric values reachable from a def in the
/// merged model - the keys the rollup engine can aggregate.
fn rollup_attr_keys(merged: &sysml_core::model::Model, def_name: &str) -> Vec<String> {
    let mut keys: Vec<String> = Vec::new();
    let mut defs = vec![def_name.to_string()];
    let mut seen = std::collections::HashSet::new();
    while let Some(d) = defs.pop() {
        if !seen.insert(d.clone()) { continue; }
        for u in merged.usages.iter().filter(|u| u.parent_def.as_deref() == Some(d.as_str())) {
            if u.kind == "attribute" {
                if let Some(v) = u.value_expr.as_deref() {
                    if sysml_core::sim::resolve::parse_value_with_unit(v).is_some() {
                        if !keys.contains(&u.name) { keys.push(u.name.clone()); }
                    }
                }
            } else if u.kind == "part" {
                if let Some(t) = u.type_ref.as_deref() {
                    defs.push(t.rsplit("::").next().unwrap_or(t).to_string());
                }
            }
        }
    }
    keys.sort();
    keys
}

/// Multiplicity as a display quantity. The engine handles multiplicity
/// itself for totals; this is only the Qty column. `*`/unbounded shows
/// as 1 with the raw string preserved elsewhere.
fn parse_multiplicity_quantity(mult: &str) -> f64 {
    let s = mult.trim().trim_start_matches('[').trim_end_matches(']');
    if s.contains("..") {
        s.split("..").last().and_then(|p| p.parse::<f64>().ok()).unwrap_or(1.0)
    } else if s == "*" {
        1.0
    } else {
        s.parse::<f64>().unwrap_or(1.0)
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

// ─── Rollup Engine (delegates to sysml-core rollup) ───

#[derive(Debug, Clone, Serialize)]
pub struct RollupContribution {
    pub path: Vec<String>,
    pub definition: String,
    pub quantity: u32,
    pub own_value: f64,
    pub subtotal: f64,
    pub percentage: f64,
    pub children: Vec<RollupContribution>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RollupResponse {
    pub root: String,
    pub attribute: String,
    pub method: String,
    pub total: f64,
    pub own_value: f64,
    /// Unit all values were converted into (from `value [unit]` brackets).
    pub unit: Option<String>,
    /// Conversions the engine could not perform - total is suspect.
    pub conversion_warnings: Vec<String>,
    pub contributions: Vec<RollupContribution>,
}

fn convert_contribution(c: &sysml_core::sim::rollup::Contribution) -> RollupContribution {
    RollupContribution {
        path: c.path.clone(),
        definition: c.definition.clone(),
        quantity: c.quantity,
        own_value: c.own_value,
        subtotal: c.subtotal,
        percentage: c.percentage,
        children: c.children.iter().map(convert_contribution).collect(),
    }
}

fn convert_rollup_result(r: &sysml_core::sim::rollup::RollupResult) -> RollupResponse {
    RollupResponse {
        root: r.root.clone(),
        attribute: r.attribute.clone(),
        method: r.method.label().to_string(),
        total: r.total,
        own_value: r.own_value,
        unit: r.unit.clone(),
        conversion_warnings: r.conversion_warnings.clone(),
        contributions: r.contributions.iter().map(convert_contribution).collect(),
    }
}

#[tauri::command]
pub fn compute_rollup(
    root_def: String,
    attribute: String,
    method: Option<String>,
    state: State<'_, AppState>,
) -> Result<RollupResponse, String> {
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core_model = core_lock.as_ref().ok_or("No model loaded")?;

    let agg = method.as_deref()
        .and_then(sysml_core::sim::rollup::AggregationMethod::from_str)
        .unwrap_or(sysml_core::sim::rollup::AggregationMethod::Sum);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sysml_core::sim::rollup::evaluate_rollup(core_model, &root_def, &attribute, agg)
    })).map_err(|_| "Rollup computation failed".to_string())?;

    Ok(convert_rollup_result(&result))
}

/// List all part definitions that could be rollup roots + their numeric attributes
#[tauri::command]
pub fn list_rollup_targets(
    state: State<'_, AppState>,
) -> Result<Vec<RollupTarget>, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    let mut targets = Vec::new();
    for el in &model.elements {
        if el.kind == ElementKind::PartDef {
            let attrs: Vec<String> = model.elements.iter()
                .filter(|c| c.parent_id == Some(el.id) && c.kind == ElementKind::AttributeUsage)
                .filter(|c| c.value_expr.as_ref().and_then(|v| v.parse::<f64>().ok()).is_some())
                .filter_map(|c| c.name.clone())
                .collect();
            if !attrs.is_empty() || model.elements.iter().any(|c| c.parent_id == Some(el.id) && c.kind == ElementKind::PartUsage) {
                targets.push(RollupTarget {
                    name: el.name.clone().unwrap_or_default(),
                    attributes: attrs,
                });
            }
        }
    }
    Ok(targets)
}

#[derive(Debug, Clone, Serialize)]
pub struct RollupTarget {
    pub name: String,
    pub attributes: Vec<String>,
}

// ─── Analysis Cases & Trade Studies (delegates to sysml-core analysis) ───

#[derive(Debug, Clone, Serialize)]
pub struct AnalysisCaseInfo {
    pub name: String,
    pub subject: Option<String>,
    pub objective: Option<String>,
    pub objective_kind: String,
    pub parameters: Vec<AnalysisParameter>,
    pub alternatives: Vec<String>,
    pub return_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalysisParameter {
    pub name: String,
    pub type_ref: Option<String>,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalysisEvalResult {
    pub name: String,
    pub subject_name: Option<String>,
    pub bindings: Vec<(String, f64)>,
    pub return_value: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TradeStudyResult {
    pub name: String,
    pub objective: String,
    pub alternatives: Vec<AlternativeScoreResult>,
    pub winner: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlternativeScoreResult {
    pub name: String,
    pub score: Option<f64>,
    pub overrides: Vec<(String, String)>,
}

#[tauri::command]
pub fn list_analysis_cases(state: State<'_, AppState>) -> Result<Vec<AnalysisCaseInfo>, String> {
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core_model = core_lock.as_ref().ok_or("No model loaded")?;

    let cases = sysml_core::sim::analysis::extract_analysis_cases_from_model(core_model);
    Ok(cases.iter().map(|c| AnalysisCaseInfo {
        name: c.name.clone(),
        subject: c.subject.as_ref().map(|s| s.name.clone()),
        objective: c.objective.as_ref().map(|o| o.name.clone()),
        objective_kind: match c.objective.as_ref().map(|o| &o.kind) {
            Some(sysml_core::sim::analysis::ObjectiveKind::Maximize) => "maximize".into(),
            Some(sysml_core::sim::analysis::ObjectiveKind::Minimize) => "minimize".into(),
            _ => "general".into(),
        },
        parameters: c.parameters.iter().map(|p| AnalysisParameter {
            name: p.name.clone(),
            type_ref: p.type_ref.clone(),
            direction: match p.direction {
                sysml_core::sim::analysis::ParameterDirection::In => "in".into(),
                sysml_core::sim::analysis::ParameterDirection::Out => "out".into(),
                sysml_core::sim::analysis::ParameterDirection::InOut => "inout".into(),
            },
        }).collect(),
        alternatives: c.alternatives.iter().map(|a| a.name.clone()).collect(),
        return_name: c.return_decl.as_ref().map(|r| r.name.clone()),
    }).collect())
}

#[tauri::command]
pub fn evaluate_analysis_case(
    case_name: String,
    bindings: std::collections::HashMap<String, f64>,
    state: State<'_, AppState>,
) -> Result<AnalysisEvalResult, String> {
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core_model = core_lock.as_ref().ok_or("No model loaded")?;

    let cases = sysml_core::sim::analysis::extract_analysis_cases_from_model(core_model);
    let case = cases.iter().find(|c| c.name == case_name)
        .ok_or_else(|| format!("Analysis case '{}' not found", case_name))?;

    let mut env = Env::new();
    for (k, v) in &bindings { env.bind(k.clone(), Value::Number(*v)); }

    let result = sysml_core::sim::analysis::evaluate_analysis(core_model, case, &env);
    Ok(AnalysisEvalResult {
        name: result.name,
        subject_name: result.subject_name,
        bindings: result.bindings,
        return_value: result.return_value,
    })
}

#[tauri::command]
pub fn evaluate_trade_study(
    case_name: String,
    state: State<'_, AppState>,
) -> Result<TradeStudyResult, String> {
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core_model = core_lock.as_ref().ok_or("No model loaded")?;

    let cases = sysml_core::sim::analysis::extract_analysis_cases_from_model(core_model);
    let case = cases.iter().find(|c| c.name == case_name)
        .ok_or_else(|| format!("Analysis case '{}' not found", case_name))?;

    let result = sysml_core::sim::analysis::evaluate_trade_study(core_model, case);
    Ok(TradeStudyResult {
        name: result.name,
        objective: match result.objective {
            sysml_core::sim::analysis::ObjectiveKind::Maximize => "maximize".into(),
            sysml_core::sim::analysis::ObjectiveKind::Minimize => "minimize".into(),
            sysml_core::sim::analysis::ObjectiveKind::General => "general".into(),
        },
        alternatives: result.alternatives.iter().map(|a| AlternativeScoreResult {
            name: a.name.clone(),
            score: a.score,
            overrides: a.overrides.clone(),
        }).collect(),
        winner: result.winner,
    })
}

// ─── What-If & Sensitivity Analysis (delegates to sysml-core what_if) ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioInput {
    pub name: String,
    pub overrides: Vec<(String, f64)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WhatIfResponse {
    pub attribute: String,
    pub method: String,
    pub root: String,
    pub baseline: f64,
    pub scenarios: Vec<ScenarioResponse>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioResponse {
    pub name: String,
    pub total: f64,
    pub delta: f64,
    pub delta_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SweepInput {
    pub parameter: String,
    pub start: f64,
    pub end: f64,
    pub steps: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SweepResponse {
    pub attribute: String,
    pub parameter: String,
    pub root: String,
    pub points: Vec<(f64, f64)>,
    pub sensitivity: f64,
}

#[tauri::command]
pub fn evaluate_what_if(
    root_def: String,
    attribute: String,
    method: Option<String>,
    scenarios: Vec<ScenarioInput>,
    state: State<'_, AppState>,
) -> Result<WhatIfResponse, String> {
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core_model = core_lock.as_ref().ok_or("No model loaded")?;

    let agg = method.as_deref()
        .and_then(sysml_core::sim::rollup::AggregationMethod::from_str)
        .unwrap_or(sysml_core::sim::rollup::AggregationMethod::Sum);

    let core_scenarios: Vec<sysml_core::sim::what_if::Scenario> = scenarios.iter().map(|s| {
        sysml_core::sim::what_if::Scenario {
            name: s.name.clone(),
            overrides: s.overrides.clone(),
        }
    }).collect();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sysml_core::sim::what_if::evaluate_what_if(core_model, &root_def, &attribute, agg, &core_scenarios)
    })).map_err(|_| "What-if analysis failed".to_string())?;

    Ok(WhatIfResponse {
        attribute: result.attribute,
        method: agg.label().to_string(),
        root: result.root,
        baseline: result.baseline,
        scenarios: result.scenarios.iter().map(|s| ScenarioResponse {
            name: s.name.clone(),
            total: s.total,
            delta: s.delta,
            delta_pct: s.delta_pct,
        }).collect(),
    })
}

#[tauri::command]
pub fn evaluate_sweep(
    root_def: String,
    attribute: String,
    method: Option<String>,
    sweep: SweepInput,
    state: State<'_, AppState>,
) -> Result<SweepResponse, String> {
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core_model = core_lock.as_ref().ok_or("No model loaded")?;

    let agg = method.as_deref()
        .and_then(sysml_core::sim::rollup::AggregationMethod::from_str)
        .unwrap_or(sysml_core::sim::rollup::AggregationMethod::Sum);

    let config = sysml_core::sim::what_if::SweepConfig {
        parameter: sweep.parameter,
        start: sweep.start,
        end: sweep.end,
        steps: sweep.steps,
    };

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sysml_core::sim::what_if::evaluate_sweep(core_model, &root_def, &attribute, agg, &config)
    })).map_err(|_| "Sweep analysis failed".to_string())?;

    Ok(SweepResponse {
        attribute: result.attribute,
        parameter: result.parameter,
        root: result.root,
        points: result.points,
        sensitivity: result.sensitivity,
    })
}

// ─── Unit Conversion ───

#[tauri::command]
pub fn convert_units(value: f64, from: String, to: String) -> Result<f64, String> {
    sysml_core::sim::units::convert(value, &from, &to)
        .map_err(|e| e.message)
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// End-to-end: parse real SysML, then assert the BOM tree's numbers
    /// EQUAL sysml-core's rollup engine on the same model - the invariant
    /// that the BOM tab and the Rollup tab can never disagree.
    fn bom_from_source(source: &str, root: &str) -> (BomNode, std::collections::HashMap<String, Option<String>>, Vec<String>) {
        let mut core = sysml_core::parser::parse_file("test.sysml", source);
        sysml_core::model::qualify_model(&mut core);
        let model = crate::adapter::convert_model(&core, 0.0);
        let root_el = model
            .elements
            .iter()
            .find(|e| e.name.as_deref() == Some(root) && e.kind == ElementKind::PartDef)
            .expect("root def");
        let mut units = Default::default();
        let mut warnings = Vec::new();
        let node = build_bom_node(root_el, &model, &core, &mut units, &mut warnings);
        (node, units, warnings)
    }

    #[test]
    fn test_bom_matches_rollup_engine() {
        let source = r#"package P {
            part def Wheel { attribute mass : Real = 12.5; }
            part def Engine { attribute mass : Real = 150.0; }
            part def Vehicle {
                attribute mass : Real = 100.0;
                part engine : Engine;
                part wheels : Wheel[4];
            }
        }"#;
        let (bom, _units, warnings) = bom_from_source(source, "Vehicle");
        let mut core = sysml_core::parser::parse_file("test.sysml", source);
        sysml_core::model::qualify_model(&mut core);
        let engine_total = sysml_core::sim::rollup::evaluate_rollup(
            &core, "Vehicle", "mass", sysml_core::sim::rollup::AggregationMethod::Sum,
        ).total;

        assert_eq!(bom.name, "Vehicle");
        assert_eq!(bom.children.len(), 2, "engine + wheels");
        let bom_total = bom.rollups.get("mass").copied().unwrap_or(0.0);
        assert!((bom_total - engine_total).abs() < 1e-9,
            "BOM total ({bom_total}) must equal the rollup engine ({engine_total})");
        assert!(warnings.is_empty(), "no unit mixing here: {warnings:?}");
    }

    #[test]
    fn test_bom_units_parsed_not_zeroed() {
        // `250 [SI::kg]` used to contribute 0 (bare parse::<f64> failed).
        let source = r#"package P {
            part def Battery { attribute mass : Real = 250 [SI::kg]; }
        }"#;
        let (bom, units, _warnings) = bom_from_source(source, "Battery");
        let total = bom.rollups.get("mass").copied().unwrap_or(0.0);
        assert!((total - 250.0).abs() < 1e-9, "bracketed value must count: {total}");
        assert_eq!(
            units.get("mass").cloned().flatten().as_deref(),
            Some("kg"),
            "unit must survive to the UI"
        );
    }

    #[test]
    fn test_parse_multiplicity_quantity_variants() {
        assert_eq!(parse_multiplicity_quantity("4"), 4.0);
        assert_eq!(parse_multiplicity_quantity("[4]"), 4.0);
        assert_eq!(parse_multiplicity_quantity("0..4"), 4.0);
        assert_eq!(parse_multiplicity_quantity("[0..4]"), 4.0);
        assert_eq!(parse_multiplicity_quantity("*"), 1.0);
    }
}

// ─── Model-defined views (@TableRendering) — sysml-core's view engine ───

/// Render a model-defined view. Table views (@TableRendering) come back
/// as a RenderedTable computed by the same engine as `sysml view`, so
/// Studio and the CLI render identical reports.
#[tauri::command]
pub fn render_model_view(
    view_name: String,
    state: State<'_, AppState>,
) -> Result<sysml_core::view_render::RenderedTable, String> {
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core_model = core_lock.as_ref().ok_or("No model loaded")?;
    let siblings = state.sibling_models.lock().map_err(|e| e.to_string())?;

    let mut models: Vec<sysml_core::model::Model> = Vec::with_capacity(siblings.len() + 1);
    models.push(core_model.clone());
    models.extend(siblings.iter().cloned());

    sysml_core::view_render::render_view(&models, &view_name)
}

#[derive(Debug, Clone, Serialize)]
pub struct ViewInfo {
    pub name: String,
    pub file: String,
    /// Carries a @TableRendering spec (renders as a table).
    pub renderable_table: bool,
    /// `render as ...` clause, when declared (renders as a diagram).
    pub render_as: Option<String>,
}

/// Every view def in scope, labeled by how it renders.
#[tauri::command]
pub fn list_model_views(state: State<'_, AppState>) -> Result<Vec<ViewInfo>, String> {
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core_model = core_lock.as_ref().ok_or("No model loaded")?;
    let siblings = state.sibling_models.lock().map_err(|e| e.to_string())?;

    let mut models: Vec<sysml_core::model::Model> = Vec::with_capacity(siblings.len() + 1);
    models.push(core_model.clone());
    models.extend(siblings.iter().cloned());

    let tables = sysml_core::view_render::available_views(&models);
    Ok(tables
        .into_iter()
        .map(|(name, file, renderable)| {
            let render_as = models
                .iter()
                .flat_map(|m| &m.views)
                .find(|v| v.name == name)
                .and_then(|v| v.render_as.clone());
            ViewInfo {
                name,
                file,
                renderable_table: renderable,
                render_as,
            }
        })
        .collect())
}
