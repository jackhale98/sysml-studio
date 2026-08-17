//! Generic, model-driven data analysis.
//!
//! The tool contains no domain analyses. It contains two primitives —
//! **rows** and **calcs** — and the model decides what they mean. An
//! FMEA worksheet is metadata annotations plus a risk calc; a tolerance
//! chain is dimension attributes plus a stack calc; a power budget is
//! part usages plus a sum. None of those words appear in this file.
//!
//! Analyses that a model wants to keep are written as `view def`s and
//! rendered by sysml-core's view engine (see `render_model_view`), the
//! same arrangement the CLI uses: `sysml view <name>`, never
//! `sysml fmea`.

use serde::Serialize;
use tauri::State;

use crate::commands::parse_commands::AppState;

/// Normalize a name for matching: lowercase, quotes and separators
/// stripped, so `'occurrence'`, `Occurrence`, and `occurrence` compare
/// equal.
fn norm(name: &str) -> String {
    name.trim()
        .trim_matches('\'')
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// Parse a numeric field value: a bare number, or a number carrying a
/// unit bracket.
fn parse_rating(value: &str) -> Option<f64> {
    let v = value.trim().trim_matches('"');
    if let Ok(n) = v.parse::<f64>() {
        return Some(n);
    }
    sysml_core::sim::resolve::parse_value_with_unit(v).map(|(n, _)| n)
}


#[derive(Debug, Clone, Serialize)]
pub struct DataRow {
    pub element_id: u32,
    pub element_name: String,
    /// Provider-specific origin label (metadata type, definition name).
    pub origin: String,
    pub fields: Vec<(String, String)>,
    pub line: u32,
}

/// Rows of model data, by provider — the same vocabulary the CLI's view
/// engine uses:
///   `annotations`         every metadata annotation
///   `annotations:Type`    annotations of one metadata type
///   `type:Def`            usages typed by a definition
///   `members:Def`         the members of a definition, as fields
#[tauri::command]
pub async fn list_data_rows(
    provider: String,
    state: State<'_, AppState>,
) -> Result<Vec<DataRow>, String> {
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core = core_lock.as_ref().ok_or("No model loaded")?;
    let siblings = state.sibling_models.lock().map_err(|e| e.to_string())?;
    let merged = crate::adapter::merged_project_model(core, &siblings);
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let elements = model_lock.as_ref().map(|m| m.elements.clone()).unwrap_or_default();

    let id_of = |name: &str| -> u32 {
        elements
            .iter()
            .find(|e| e.name.as_deref() == Some(name))
            .map(|e| e.id)
            .unwrap_or(0)
    };

    let (kind, arg) = match provider.split_once(':') {
        Some((k, a)) => (k, Some(a.trim())),
        None => (provider.as_str(), None),
    };

    let mut rows = Vec::new();
    match kind {
        "annotations" => {
            for ann in &merged.annotations {
                let simple = ann
                    .metadata_type
                    .rsplit("::")
                    .next()
                    .unwrap_or(&ann.metadata_type);
                if let Some(want) = arg {
                    if simple != want && ann.metadata_type != want {
                        continue;
                    }
                }
                let target = ann.target.clone().unwrap_or_default();
                rows.push(DataRow {
                    element_id: id_of(&target),
                    element_name: target,
                    origin: ann.metadata_type.clone(),
                    fields: ann.values.clone(),
                    line: ann.span.start_row as u32,
                });
            }
        }
        "type" => {
            let want = arg.ok_or("provider `type:` needs a definition name")?;
            for u in merged.usages.iter().filter(|u| {
                u.type_ref
                    .as_deref()
                    .map(|t| t.rsplit("::").next().unwrap_or(t) == want)
                    .unwrap_or(false)
            }) {
                let fields: Vec<(String, String)> = merged
                    .usages
                    .iter()
                    .filter(|c| c.parent_def.as_deref() == Some(u.name.as_str()))
                    .filter_map(|c| c.value_expr.as_ref().map(|v| (c.name.clone(), v.clone())))
                    .collect();
                rows.push(DataRow {
                    element_id: id_of(&u.name),
                    element_name: u.name.clone(),
                    origin: want.to_string(),
                    fields,
                    line: u.span.start_row as u32,
                });
            }
        }
        "members" => {
            let want = arg.ok_or("provider `members:` needs a definition name")?;
            let fields: Vec<(String, String)> = merged
                .usages
                .iter()
                .filter(|c| c.parent_def.as_deref() == Some(want))
                .filter_map(|c| c.value_expr.as_ref().map(|v| (c.name.clone(), v.clone())))
                .collect();
            rows.push(DataRow {
                element_id: id_of(want),
                element_name: want.to_string(),
                origin: want.to_string(),
                fields,
                line: 0,
            });
        }
        other => return Err(format!("unknown row provider `{other}`")),
    }
    Ok(rows)
}

#[derive(Debug, Clone, Serialize)]
pub struct CalcInfo {
    pub name: String,
    pub parameters: Vec<String>,
    pub expression: Option<String>,
    pub doc: Option<String>,
}

/// Every calc def in the model with its parameter names — the menu of
/// computations a user can run over any row set.
#[tauri::command]
pub async fn list_calcs(state: State<'_, AppState>) -> Result<Vec<CalcInfo>, String> {
    use sysml_core::model::DefKind;
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core = core_lock.as_ref().ok_or("No model loaded")?;
    let siblings = state.sibling_models.lock().map_err(|e| e.to_string())?;
    let merged = crate::adapter::merged_project_model(core, &siblings);

    Ok(merged
        .definitions
        .iter()
        .filter(|d| d.kind == DefKind::Calc)
        .map(|d| {
            let members: Vec<&sysml_core::model::Usage> = merged
                .usages
                .iter()
                .filter(|u| u.parent_def.as_deref() == Some(d.name.as_str()))
                .collect();
            CalcInfo {
                name: d.name.clone(),
                parameters: members
                    .iter()
                    .filter(|u| u.kind != "return")
                    .map(|u| sysml_core::model::unquote_name(&u.name).to_string())
                    .collect(),
                expression: members
                    .iter()
                    .find(|u| u.kind == "return")
                    .and_then(|u| u.value_expr.clone()),
                doc: d.doc.clone(),
            }
        })
        .collect())
}

#[derive(Debug, Clone, Serialize)]
pub struct ComputedRow {
    pub element_id: u32,
    pub element_name: String,
    pub fields: Vec<(String, String)>,
    pub value: Option<f64>,
    pub error: Option<String>,
    pub line: u32,
}

/// Run a model-declared calc over every row of a provider, binding
/// calc parameters to row fields by name (case-insensitive, quotes
/// ignored). This is the generic engine: an FMEA worksheet is
/// `annotations` + an Rpn-shaped calc; a cost roll is `type:LineItem`
/// plus a cost calc. No domain knowledge in the tool.
#[tauri::command]
pub async fn run_calc_over_rows(
    calc_name: String,
    provider: String,
    state: State<'_, AppState>,
) -> Result<Vec<ComputedRow>, String> {
    let rows = list_data_rows(provider, state.clone()).await?;
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core = core_lock.as_ref().ok_or("No model loaded")?;
    let siblings = state.sibling_models.lock().map_err(|e| e.to_string())?;
    let merged = crate::adapter::merged_project_model(core, &siblings);

    use sysml_core::model::{unquote_name, DefKind};
    let def = merged
        .definitions
        .iter()
        .find(|d| d.kind == DefKind::Calc && d.name == calc_name)
        .ok_or_else(|| format!("calc `{calc_name}` not found"))?;
    let members: Vec<&sysml_core::model::Usage> = merged
        .usages
        .iter()
        .filter(|u| u.parent_def.as_deref() == Some(def.name.as_str()))
        .collect();
    let expr = members
        .iter()
        .find(|u| u.kind == "return")
        .and_then(|u| u.value_expr.as_deref())
        .ok_or_else(|| format!("calc `{calc_name}` has no return expression"))?;
    let parsed = sysml_core::sim::expr_parser::parse_expr_str(expr)
        .map_err(|e| format!("cannot parse `{calc_name}`: {e}"))?;
    let params: Vec<String> = members
        .iter()
        .filter(|u| u.kind != "return")
        .map(|u| unquote_name(&u.name).to_string())
        .collect();

    Ok(rows
        .into_iter()
        .map(|row| {
            let mut env = sysml_core::sim::expr::Env::new();
            let mut missing = Vec::new();
            for p in &params {
                let found = row.fields.iter().find_map(|(k, v)| {
                    if norm(k) == norm(p) {
                        parse_rating(v)
                    } else {
                        None
                    }
                });
                match found {
                    Some(n) => env.bind(p.as_str(), sysml_core::sim::expr::Value::Number(n)),
                    None => missing.push(p.clone()),
                }
            }
            let (value, error) = if missing.is_empty() {
                match sysml_core::sim::eval::evaluate(&parsed, &env) {
                    Ok(v) => (v.as_number(), None),
                    Err(e) => (None, Some(e.to_string())),
                }
            } else {
                (None, Some(format!("row has no {}", missing.join(", "))))
            };
            ComputedRow {
                element_id: row.element_id,
                element_name: row.element_name,
                fields: row.fields,
                value,
                error,
                line: row.line,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norm_ignores_case_quotes_and_separators() {
        assert_eq!(norm("'occurrence'"), "occurrence");
        assert_eq!(norm("Severity"), "severity");
        assert_eq!(norm("failure_mode"), "failuremode");
    }

    #[test]
    fn parse_rating_handles_plain_and_unit_bracketed_values() {
        assert_eq!(parse_rating("8"), Some(8.0));
        assert_eq!(parse_rating("\"7\""), Some(7.0));
        assert_eq!(parse_rating("250 [SI::kg]"), Some(250.0));
        assert_eq!(parse_rating("\"Seal failure\""), None);
    }
}
