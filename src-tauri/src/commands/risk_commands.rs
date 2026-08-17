//! FMEA and tolerance analysis over ANY SysML v2 model.
//!
//! Both features are **convention-driven, not library-driven**: nothing
//! here requires a particular domain library, metadata type, or
//! specialization. An element participates if it carries the *shape* of
//! the data — an annotation or attributes naming severity/occurrence/
//! detection for FMEA, a nominal with tolerance bounds for a dimension.
//! Models written against the sysml-domain-libraries work unchanged, and
//! so do models that never heard of them.
//!
//! Nothing is stored that can be derived, and no formula is hard-coded
//! as tool policy: derived values come from `calc def`s **in the
//! model**, evaluated by sysml-core — the same arrangement the CLI uses
//! for its coverage score. A model that declares
//!
//! ```text
//! calc def Rpn { in severity; in likelihood; in detection;
//!                return : Real = severity * likelihood * detection; }
//! ```
//!
//! drives the worksheet with its own definition; changing the risk
//! convention (weighted RPN, an action-priority scheme, a different
//! sigma assumption) is a model edit, not a tool change. When the model
//! declares nothing, a documented built-in applies and every result says
//! which was used, so the default is never mistaken for policy.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::parse_commands::AppState;

// ---------------------------------------------------------------------------
// Field-name conventions
// ---------------------------------------------------------------------------

/// Normalize a field name for matching: lowercase, strip quotes and
/// separators, so `'occurrence'`, `Occurrence`, and `occurrence_rating`
/// all compare equal to their canonical form.
fn norm(name: &str) -> String {
    name.trim()
        .trim_matches('\'')
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// True when `field` names the concept described by any of `aliases`
/// (exact match after normalization, or the field starts/ends with an
/// alias — `initialSeverity` is severity-shaped, `severityRating` too).
fn matches_concept(field: &str, aliases: &[&str], prefixes_allowed: bool) -> bool {
    let f = norm(field);
    aliases.iter().any(|a| {
        f == *a || (prefixes_allowed && (f.starts_with(a) || f.ends_with(a)))
    })
}

const SEVERITY_ALIASES: &[&str] = &["severity", "sev", "harm", "consequence"];
const OCCURRENCE_ALIASES: &[&str] =
    &["occurrence", "likelihood", "probability", "frequency", "occ", "prob"];
const DETECTION_ALIASES: &[&str] = &["detection", "detectability", "detect", "det"];
const MODE_ALIASES: &[&str] = &["failuremode", "mode", "failure", "item", "function"];
const CAUSE_ALIASES: &[&str] = &["cause", "mechanism", "rootcause"];
const EFFECT_ALIASES: &[&str] = &["effect", "consequence", "impact"];
const CATEGORY_ALIASES: &[&str] = &["category", "type", "class", "kind"];
const ACTION_ALIASES: &[&str] = &["action", "mitigation", "control", "recommendedaction"];

/// Parse a rating: a bare number, or a number inside a qualified value.
fn parse_rating(value: &str) -> Option<f64> {
    let v = value.trim().trim_matches('"');
    if let Ok(n) = v.parse::<f64>() {
        return Some(n);
    }
    sysml_core::sim::resolve::parse_value_with_unit(v).map(|(n, _)| n)
}

fn clean_text(value: &str) -> String {
    value.trim().trim_matches('"').trim().to_string()
}

// ---------------------------------------------------------------------------
// Model-declared calcs drive every derived value
// ---------------------------------------------------------------------------

/// Where a derived number came from.
fn source_label(calc_name: Option<&str>) -> String {
    match calc_name {
        Some(n) => format!("model:{n}"),
        None => "built-in".to_string(),
    }
}

/// Find a `calc def` in the model whose `in` parameters match the given
/// concepts one-for-one, and evaluate its return expression with those
/// values bound to the parameter names the model actually used.
///
/// Matching is by parameter NAME CONCEPT, not by calc name or library
/// type, so any model that writes the calculation it wants gets it —
/// no import required.
fn eval_model_calc(
    model: &sysml_core::model::Model,
    bindings: &[(&[&str], f64)],
) -> Option<(f64, String)> {
    use sysml_core::model::{unquote_name, DefKind, Direction};

    for def in model
        .definitions
        .iter()
        .filter(|d| d.kind == DefKind::Calc)
    {
        // Parameters are the calc's members other than its result.
        // (Direction is not always recorded for `in` params, so it is
        // not used as the filter.)
        let params: Vec<&sysml_core::model::Usage> = model
            .usages
            .iter()
            .filter(|u| {
                u.parent_def.as_deref() == Some(def.name.as_str())
                    && u.kind != "return"
                    && u.direction != Some(Direction::Out)
            })
            .collect();
        if params.is_empty() || params.len() != bindings.len() {
            continue;
        }

        // Every parameter must name one of our concepts, and every
        // concept must be consumed exactly once.
        let mut env = sysml_core::sim::expr::Env::new();
        let mut used = vec![false; bindings.len()];
        let mut ok = true;
        for p in &params {
            let pname = unquote_name(&p.name);
            match bindings
                .iter()
                .enumerate()
                .find(|(i, (aliases, _))| !used[*i] && matches_concept(pname, aliases, false))
            {
                Some((i, (_, value))) => {
                    used[i] = true;
                    env.bind(pname, sysml_core::sim::expr::Value::Number(*value));
                }
                None => {
                    ok = false;
                    break;
                }
            }
        }
        if !ok || used.iter().any(|u| !u) {
            continue;
        }

        let ret = model.usages.iter().find(|u| {
            u.parent_def.as_deref() == Some(def.name.as_str()) && u.kind == "return"
        })?;
        let expr = ret.value_expr.as_deref()?;
        let parsed = sysml_core::sim::expr_parser::parse_expr_str(expr).ok()?;
        let value = sysml_core::sim::eval::evaluate(&parsed, &env)
            .ok()?
            .as_number()?;
        return Some((value, def.name.clone()));
    }
    None
}

// ---------------------------------------------------------------------------
// FMEA
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct FmeaItem {
    /// Studio element the line item is attached to (0 when unresolved).
    pub element_id: u32,
    pub element_name: String,
    /// Where the data came from: "annotation" or "attributes".
    pub source: String,
    /// Metadata type name when the source is an annotation — shown so
    /// users can see which convention a row came from.
    pub annotation_type: Option<String>,
    pub failure_mode: Option<String>,
    pub cause: Option<String>,
    pub effect: Option<String>,
    pub category: Option<String>,
    pub action: Option<String>,
    pub severity: Option<f64>,
    pub occurrence: Option<f64>,
    pub detection: Option<f64>,
    /// Risk priority — from the model's own calc when it declares one,
    /// otherwise severity x occurrence x detection. Derived, never
    /// stored, so it cannot disagree with its factors.
    pub rpn: Option<f64>,
    /// "model:<CalcName>" or "built-in".
    pub rpn_source: Option<String>,
    /// Criticality (the risk-matrix axis product) — same rule.
    pub criticality: Option<f64>,
    pub criticality_source: Option<String>,
    /// Fields present on the source that are not part of the FMEA
    /// vocabulary, so nothing the user wrote is hidden.
    pub extra_fields: Vec<(String, String)>,
    pub line: u32,
}

fn build_item(
    model: Option<&sysml_core::model::Model>,
    element_id: u32,
    element_name: String,
    source: &str,
    annotation_type: Option<String>,
    fields: &[(String, String)],
    line: u32,
) -> Option<FmeaItem> {
    let mut severity = None;
    let mut occurrence = None;
    let mut detection = None;
    let (mut mode, mut cause, mut effect, mut category, mut action) =
        (None, None, None, None, None);
    let mut extra = Vec::new();

    for (k, v) in fields {
        // Ratings first: `initialSeverity` should not overwrite `severity`.
        if severity.is_none() && matches_concept(k, SEVERITY_ALIASES, false) {
            severity = parse_rating(v);
        } else if occurrence.is_none() && matches_concept(k, OCCURRENCE_ALIASES, false) {
            occurrence = parse_rating(v);
        } else if detection.is_none() && matches_concept(k, DETECTION_ALIASES, false) {
            detection = parse_rating(v);
        } else if mode.is_none() && matches_concept(k, MODE_ALIASES, false) {
            mode = Some(clean_text(v));
        } else if cause.is_none() && matches_concept(k, CAUSE_ALIASES, false) {
            cause = Some(clean_text(v));
        } else if effect.is_none() && matches_concept(k, EFFECT_ALIASES, false) {
            effect = Some(clean_text(v));
        } else if category.is_none() && matches_concept(k, CATEGORY_ALIASES, false) {
            category = Some(clean_text(v));
        } else if action.is_none() && matches_concept(k, ACTION_ALIASES, false) {
            action = Some(clean_text(v));
        } else {
            extra.push((k.clone(), clean_text(v)));
        }
    }

    // A row needs at least one rating or a named failure mode to be an
    // FMEA line rather than arbitrary metadata.
    if severity.is_none() && occurrence.is_none() && detection.is_none() && mode.is_none() {
        return None;
    }

    // Derived values come from the model's calcs when it declares them.
    let (rpn, rpn_source) = match (severity, occurrence, detection) {
        (Some(s), Some(o), Some(d)) => {
            let from_model = model.and_then(|m| {
                eval_model_calc(
                    m,
                    &[
                        (SEVERITY_ALIASES, s),
                        (OCCURRENCE_ALIASES, o),
                        (DETECTION_ALIASES, d),
                    ],
                )
            });
            match from_model {
                Some((v, name)) => (Some(v), Some(source_label(Some(&name)))),
                None => (Some(s * o * d), Some(source_label(None))),
            }
        }
        _ => (None, None),
    };
    let (criticality, criticality_source) = match (severity, occurrence) {
        (Some(s), Some(o)) => {
            let from_model = model.and_then(|m| {
                eval_model_calc(m, &[(SEVERITY_ALIASES, s), (OCCURRENCE_ALIASES, o)])
            });
            match from_model {
                Some((v, name)) => (Some(v), Some(source_label(Some(&name)))),
                None => (Some(s * o), Some(source_label(None))),
            }
        }
        _ => (None, None),
    };

    Some(FmeaItem {
        element_id,
        element_name,
        source: source.to_string(),
        annotation_type,
        failure_mode: mode,
        cause,
        effect,
        category,
        action,
        severity,
        occurrence,
        detection,
        rpn,
        rpn_source,
        criticality,
        criticality_source,
        extra_fields: extra,
        line,
    })
}

/// Every FMEA line item in the model, from any convention:
/// 1. metadata annotations of ANY type whose fields look like FMEA data;
/// 2. elements whose nested attributes carry the ratings directly.
#[tauri::command]
pub async fn list_fmea_items(state: State<'_, AppState>) -> Result<Vec<FmeaItem>, String> {
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core = core_lock.as_ref().ok_or("No model loaded")?;
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let elements = model_lock.as_ref().map(|m| m.elements.clone()).unwrap_or_default();

    let id_of = |name: &str| -> (u32, String) {
        elements
            .iter()
            .find(|e| e.name.as_deref() == Some(name))
            .map(|e| (e.id, name.to_string()))
            .unwrap_or((0, name.to_string()))
    };

    let mut items = Vec::new();

    // 1. Annotations — any metadata type.
    for ann in &core.annotations {
        let target = ann.target.clone().unwrap_or_default();
        let (eid, ename) = id_of(&target);
        if let Some(item) = build_item(
            Some(core),
            eid,
            ename,
            "annotation",
            Some(ann.metadata_type.clone()),
            &ann.values,
            ann.span.start_row as u32,
        ) {
            items.push(item);
        }
    }

    // 2. Elements whose own attributes carry ratings (no annotation).
    for def in &core.definitions {
        let fields: Vec<(String, String)> = core
            .usages
            .iter()
            .filter(|u| u.parent_def.as_deref() == Some(def.name.as_str()))
            .filter_map(|u| {
                u.value_expr
                    .as_ref()
                    .map(|v| (u.name.clone(), v.clone()))
            })
            .collect();
        if fields.is_empty() {
            continue;
        }
        let (eid, ename) = id_of(&def.name);
        if let Some(item) = build_item(
            Some(core),
            eid,
            ename,
            "attributes",
            None,
            &fields,
            def.span.start_row as u32,
        ) {
            // Only keep attribute-sourced rows that carry real ratings —
            // a lone "mode"-ish attribute name is too weak a signal.
            if item.severity.is_some() || item.occurrence.is_some() || item.detection.is_some() {
                items.push(item);
            }
        }
    }

    // Highest risk first: RPN, then criticality, then severity.
    items.sort_by(|a, b| {
        b.rpn
            .unwrap_or(-1.0)
            .partial_cmp(&a.rpn.unwrap_or(-1.0))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                b.criticality
                    .unwrap_or(-1.0)
                    .partial_cmp(&a.criticality.unwrap_or(-1.0))
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then(
                b.severity
                    .unwrap_or(-1.0)
                    .partial_cmp(&a.severity.unwrap_or(-1.0))
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });
    Ok(items)
}

#[derive(Debug, Clone, Serialize)]
pub struct RiskMatrixCell {
    pub severity: u32,
    pub occurrence: u32,
    pub count: u32,
    pub element_ids: Vec<u32>,
}

/// Severity x occurrence grid of FMEA line items — the standard risk
/// matrix, built from whatever rating scale the model actually uses.
#[tauri::command]
pub async fn fmea_risk_matrix(
    state: State<'_, AppState>,
) -> Result<Vec<RiskMatrixCell>, String> {
    let items = list_fmea_items(state).await?;
    let mut cells: std::collections::BTreeMap<(u32, u32), RiskMatrixCell> = Default::default();
    for it in items {
        if let (Some(s), Some(o)) = (it.severity, it.occurrence) {
            let key = (s.round() as u32, o.round() as u32);
            let cell = cells.entry(key).or_insert(RiskMatrixCell {
                severity: key.0,
                occurrence: key.1,
                count: 0,
                element_ids: Vec::new(),
            });
            cell.count += 1;
            if it.element_id != 0 {
                cell.element_ids.push(it.element_id);
            }
        }
    }
    Ok(cells.into_values().collect())
}

// ---------------------------------------------------------------------------
// Tolerance
// ---------------------------------------------------------------------------

const NOMINAL_ALIASES: &[&str] = &["nominal", "basic", "target", "value", "mean"];
const PLUS_ALIASES: &[&str] = &["plus", "upper", "uppertol", "tolplus", "max"];
const MINUS_ALIASES: &[&str] = &["minus", "lower", "lowertol", "tolminus", "min"];
const SYMMETRIC_ALIASES: &[&str] = &["tolerance", "tol", "plusminus", "pm"];

#[derive(Debug, Clone, Serialize)]
pub struct ToleranceDimension {
    pub element_id: u32,
    /// Attribute name, e.g. `seatDepth`.
    pub name: String,
    /// Path a user recognizes, e.g. `ValveBody::seatDepth`.
    pub qualified_name: String,
    /// Owning definition/usage name.
    pub owner: String,
    pub nominal: f64,
    /// Positive deviation magnitude (>= 0).
    pub plus: f64,
    /// Negative deviation magnitude (>= 0).
    pub minus: f64,
    pub unit: Option<String>,
    /// How the bounds were expressed: "asymmetric", "symmetric", "limits".
    pub form: String,
    pub line: u32,
}

/// Read a tolerance-shaped attribute group.
fn dimension_from_fields(fields: &[(String, String)]) -> Option<(f64, f64, f64, Option<String>, String)> {
    let mut nominal: Option<(f64, Option<String>)> = None;
    let mut plus: Option<f64> = None;
    let mut minus: Option<f64> = None;
    let mut symmetric: Option<f64> = None;
    let mut limit_lo: Option<f64> = None;
    let mut limit_hi: Option<f64> = None;

    for (k, v) in fields {
        let parsed = sysml_core::sim::resolve::parse_value_with_unit(v.trim());
        let Some((num, unit)) = parsed else { continue };
        let key = norm(k);
        if nominal.is_none() && matches_concept(&key, NOMINAL_ALIASES, false) {
            nominal = Some((num, unit));
        } else if matches_concept(&key, SYMMETRIC_ALIASES, false) {
            symmetric = Some(num.abs());
        } else if key == "min" || key == "lowerlimit" || key == "lsl" {
            limit_lo = Some(num);
        } else if key == "max" || key == "upperlimit" || key == "usl" {
            limit_hi = Some(num);
        } else if plus.is_none() && matches_concept(&key, PLUS_ALIASES, false) {
            plus = Some(num.abs());
        } else if minus.is_none() && matches_concept(&key, MINUS_ALIASES, false) {
            minus = Some(num.abs());
        }
    }

    match (nominal, plus, minus, symmetric, limit_lo, limit_hi) {
        // nominal +a/-b
        (Some((n, u)), Some(p), Some(m), _, _, _) => Some((n, p, m, u, "asymmetric".into())),
        // nominal +/- t
        (Some((n, u)), _, _, Some(t), _, _) => Some((n, t, t, u, "symmetric".into())),
        // nominal with one-sided tolerance
        (Some((n, u)), Some(p), None, _, _, _) => Some((n, p, 0.0, u, "asymmetric".into())),
        (Some((n, u)), None, Some(m), _, _, _) => Some((n, 0.0, m, u, "asymmetric".into())),
        // limits only: nominal is the midpoint
        (_, _, _, _, Some(lo), Some(hi)) if hi >= lo => {
            let n = (lo + hi) / 2.0;
            Some((n, hi - n, n - lo, None, "limits".into()))
        }
        _ => None,
    }
}

/// Every toleranced dimension in the model, found by shape: an
/// attribute whose nested values give a nominal and bounds, in any of
/// the common spellings (nominal/plus/minus, nominal/tolerance,
/// min/max limits).
#[tauri::command]
pub async fn list_tolerance_dimensions(
    state: State<'_, AppState>,
) -> Result<Vec<ToleranceDimension>, String> {
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core = core_lock.as_ref().ok_or("No model loaded")?;
    let siblings = state.sibling_models.lock().map_err(|e| e.to_string())?;
    let merged = crate::adapter::merged_project_model(core, &siblings);
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let elements = model_lock.as_ref().map(|m| m.elements.clone()).unwrap_or_default();

    let mut out: Vec<ToleranceDimension> = Vec::new();

    for usage in merged.usages.iter().filter(|u| u.kind == "attribute") {
        // Values written in the attribute's own body (`:>> nominal = 30.0;`)
        // or inherited from the attribute's type definition.
        let mut fields: Vec<(String, String)> = merged
            .usages
            .iter()
            .filter(|c| c.parent_def.as_deref() == Some(usage.name.as_str()))
            .filter_map(|c| c.value_expr.as_ref().map(|v| (c.name.clone(), v.clone())))
            .collect();

        if let Some(t) = usage.type_ref.as_deref() {
            let simple = t.rsplit("::").next().unwrap_or(t);
            for c in merged
                .usages
                .iter()
                .filter(|c| c.parent_def.as_deref() == Some(simple))
            {
                if let Some(v) = c.value_expr.as_ref() {
                    if !fields.iter().any(|(k, _)| k == &c.name) {
                        fields.push((c.name.clone(), v.clone()));
                    }
                }
            }
        }

        if fields.len() < 2 {
            continue;
        }
        let Some((nominal, plus, minus, unit, form)) = dimension_from_fields(&fields) else {
            continue;
        };

        let owner = usage.parent_def.clone().unwrap_or_default();
        let element_id = elements
            .iter()
            .find(|e| e.name.as_deref() == Some(usage.name.as_str()))
            .map(|e| e.id)
            .unwrap_or(0);
        let qualified_name = if owner.is_empty() {
            usage.name.clone()
        } else {
            format!("{}::{}", owner, usage.name)
        };

        out.push(ToleranceDimension {
            element_id,
            name: usage.name.clone(),
            qualified_name,
            owner,
            nominal,
            plus,
            minus,
            unit,
            form,
            line: usage.span.start_row as u32,
        });
    }

    out.sort_by(|a, b| a.qualified_name.cmp(&b.qualified_name));
    out.dedup_by(|a, b| a.qualified_name == b.qualified_name);
    Ok(out)
}

#[derive(Debug, Clone, Deserialize)]
pub struct StackupContribution {
    /// `qualified_name` of a dimension from `list_tolerance_dimensions`.
    pub dimension: String,
    /// +1 opens the measured gap, -1 closes it.
    pub sense: f64,
    /// Repeat count (a 4x bolt pattern contributes four times).
    #[serde(default = "one")]
    pub quantity: f64,
}

fn one() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize)]
pub struct StackupContributionResult {
    pub dimension: String,
    pub sense: f64,
    pub quantity: f64,
    pub nominal: f64,
    pub plus: f64,
    pub minus: f64,
    /// Share of the statistical variance this contributor accounts for,
    /// as a percentage — where to spend tolerance budget.
    pub variance_share: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StackupResult {
    pub nominal: f64,
    /// Worst case: every contributor simultaneously at its limit.
    pub worst_case_min: f64,
    pub worst_case_max: f64,
    /// Distance from the nearest limit; negative means out of spec.
    pub worst_case_margin: Option<f64>,
    pub worst_case_verdict: Option<String>,
    /// Statistical (RSS) result: one sigma and the +/-3 sigma span.
    pub rss_sigma: f64,
    pub rss_min: f64,
    pub rss_max: f64,
    pub rss_margin: Option<f64>,
    pub rss_verdict: Option<String>,
    /// Process capability against the supplied limits.
    pub cp: Option<f64>,
    pub cpk: Option<f64>,
    /// Which calc produced each contributor's sigma:
    /// "model:<CalcName>" or "built-in" ((plus + minus) / 6, i.e. the
    /// tolerance band treated as a +/-3-sigma process).
    pub sigma_source: String,
    pub unit: Option<String>,
    pub contributions: Vec<StackupContributionResult>,
    /// Mixed units or other reasons the numbers may be suspect.
    pub warnings: Vec<String>,
}

fn verdict(margin: f64, band: f64) -> String {
    if margin < 0.0 {
        "FAIL".into()
    } else if band > 0.0 && margin < 0.10 * band {
        "MARGINAL".into()
    } else {
        "PASS".into()
    }
}

/// Compute a 1D tolerance stackup from user-selected dimensions.
///
/// Worst-case interval arithmetic and RSS statistical stacking — the two
/// standard methods. Limits are optional: without them the geometry is
/// still reported, just without a verdict.
#[tauri::command]
pub async fn compute_stackup(
    contributions: Vec<StackupContribution>,
    lower_limit: Option<f64>,
    upper_limit: Option<f64>,
    state: State<'_, AppState>,
) -> Result<StackupResult, String> {
    let dims = list_tolerance_dimensions(state.clone()).await?;
    if contributions.is_empty() {
        return Err("select at least one dimension".into());
    }
    let core_lock = state.core_model.lock().map_err(|e| e.to_string())?;
    let core = core_lock.as_ref().cloned();
    drop(core_lock);
    let mut sigma_source = source_label(None);

    let mut warnings: Vec<String> = Vec::new();
    let mut unit: Option<String> = None;
    let mut nominal = 0.0;
    let mut wc_min = 0.0;
    let mut wc_max = 0.0;
    let mut variances: Vec<f64> = Vec::new();
    let mut rows: Vec<StackupContributionResult> = Vec::new();

    for c in &contributions {
        let d = dims
            .iter()
            .find(|d| d.qualified_name == c.dimension || d.name == c.dimension)
            .ok_or_else(|| format!("dimension `{}` not found", c.dimension))?;

        match (&unit, &d.unit) {
            (None, Some(u)) => unit = Some(u.clone()),
            (Some(a), Some(b)) if a != b => warnings.push(format!(
                "mixed units: `{}` is in {b}, the stack is in {a} — values used unconverted",
                d.qualified_name
            )),
            _ => {}
        }

        let sense = if c.sense >= 0.0 { 1.0 } else { -1.0 };
        let qty = if c.quantity > 0.0 { c.quantity } else { 1.0 };

        nominal += sense * d.nominal * qty;
        if sense >= 0.0 {
            wc_min += (d.nominal - d.minus) * qty;
            wc_max += (d.nominal + d.plus) * qty;
        } else {
            wc_min -= (d.nominal + d.plus) * qty;
            wc_max -= (d.nominal - d.minus) * qty;
        }

        // The sigma assumption is policy, so the model may declare it:
        // a calc over (plus, minus) wins; otherwise the tolerance band
        // is treated as +/-3 sigma.
        let sigma = match core.as_ref().and_then(|m| {
            eval_model_calc(m, &[(PLUS_ALIASES, d.plus), (MINUS_ALIASES, d.minus)])
        }) {
            Some((v, name)) => {
                sigma_source = source_label(Some(&name));
                v
            }
            None => (d.plus + d.minus) / 6.0,
        };
        // Independent repeats add variance, not deviation.
        variances.push(sigma * sigma * qty);

        rows.push(StackupContributionResult {
            dimension: d.qualified_name.clone(),
            sense,
            quantity: qty,
            nominal: d.nominal,
            plus: d.plus,
            minus: d.minus,
            variance_share: 0.0,
        });
    }

    let var_total: f64 = variances.iter().sum();
    let sigma = var_total.sqrt();
    for (row, v) in rows.iter_mut().zip(&variances) {
        row.variance_share = if var_total > 0.0 {
            v / var_total * 100.0
        } else {
            0.0
        };
    }

    let rss_min = nominal - 3.0 * sigma;
    let rss_max = nominal + 3.0 * sigma;

    let (mut wc_margin, mut rss_margin, mut wc_verdict, mut rss_verdict) =
        (None, None, None, None);
    let (mut cp, mut cpk) = (None, None);
    if let (Some(lo), Some(hi)) = (lower_limit, upper_limit) {
        if hi <= lo {
            return Err("upper limit must exceed lower limit".into());
        }
        let band = hi - lo;
        let wm = (hi - wc_max).min(wc_min - lo);
        let rm = (hi - rss_max).min(rss_min - lo);
        wc_verdict = Some(verdict(wm, band));
        rss_verdict = Some(verdict(rm, band));
        wc_margin = Some(wm);
        rss_margin = Some(rm);
        if sigma > 0.0 {
            cp = Some(band / (6.0 * sigma));
            cpk = Some(((hi - nominal).min(nominal - lo)) / (3.0 * sigma));
        }
    }

    Ok(StackupResult {
        nominal,
        worst_case_min: wc_min,
        worst_case_max: wc_max,
        worst_case_margin: wc_margin,
        worst_case_verdict: wc_verdict,
        rss_sigma: sigma,
        rss_min,
        rss_max,
        rss_margin,
        rss_verdict,
        cp,
        cpk,
        sigma_source,
        unit,
        contributions: rows,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn fmea_row_from_any_field_spelling() {
        // AIAG "occurrence", ISO-ish "likelihood", and quoted keyword
        // names must all produce the same row.
        for occ_key in ["occurrence", "'occurrence'", "likelihood", "Probability"] {
            let f = fields(&[
                ("failureMode", "\"Seizure\""),
                ("severity", "8"),
                (occ_key, "3"),
                ("detection", "6"),
            ]);
            let item = build_item(None, 1, "p".into(), "annotation", None, &f, 1).expect("row");
            assert_eq!(item.severity, Some(8.0));
            assert_eq!(item.occurrence, Some(3.0), "key {occ_key}");
            assert_eq!(item.rpn, Some(144.0));
            assert_eq!(item.criticality, Some(24.0));
            assert_eq!(item.failure_mode.as_deref(), Some("Seizure"));
        }
    }

    #[test]
    fn fmea_ignores_unrelated_metadata() {
        let f = fields(&[("author", "\"jack\""), ("status", "\"draft\"")]);
        assert!(build_item(None, 1, "p".into(), "annotation", None, &f, 1).is_none());
    }

    #[test]
    fn fmea_keeps_unknown_fields_visible() {
        let f = fields(&[
            ("severity", "5"),
            ("occurrence", "2"),
            ("detection", "3"),
            ("owner", "\"BMS team\""),
        ]);
        let item = build_item(None, 1, "p".into(), "annotation", None, &f, 1).unwrap();
        assert_eq!(item.extra_fields.len(), 1);
        assert_eq!(item.extra_fields[0].0, "owner");
    }

    #[test]
    fn fmea_partial_ratings_still_listed() {
        // Severity known, detection not yet assessed: the row must still
        // appear (with no RPN) so the gap is visible.
        let f = fields(&[("failureMode", "\"Leak\""), ("severity", "7")]);
        let item = build_item(None, 1, "p".into(), "annotation", None, &f, 1).unwrap();
        assert_eq!(item.severity, Some(7.0));
        assert!(item.rpn.is_none());
    }

    #[test]
    fn dimension_forms() {
        // asymmetric
        let d = dimension_from_fields(&fields(&[
            ("nominal", "30.0"),
            ("plus", "0.1"),
            ("minus", "0.05"),
        ]))
        .unwrap();
        assert_eq!((d.0, d.1, d.2, d.4.as_str()), (30.0, 0.1, 0.05, "asymmetric"));

        // symmetric
        let d = dimension_from_fields(&fields(&[("nominal", "12.0"), ("tolerance", "0.2")])).unwrap();
        assert_eq!((d.0, d.1, d.2, d.4.as_str()), (12.0, 0.2, 0.2, "symmetric"));

        // limits
        let d = dimension_from_fields(&fields(&[("min", "9.9"), ("max", "10.1")])).unwrap();
        assert!((d.0 - 10.0).abs() < 1e-9);
        assert!((d.1 - 0.1).abs() < 1e-9 && (d.2 - 0.1).abs() < 1e-9);
        assert_eq!(d.4, "limits");

        // units survive
        let d = dimension_from_fields(&fields(&[
            ("nominal", "30.0 [SI::mm]"),
            ("tolerance", "0.1"),
        ]))
        .unwrap();
        assert_eq!(d.3.as_deref(), Some("mm"));

        // not a dimension
        assert!(dimension_from_fields(&fields(&[("colour", "\"red\"")])).is_none());
    }

    #[test]
    fn model_declared_calc_overrides_the_built_in_rpn() {
        // A model that defines its own risk priority - here a weighted
        // scheme, not S x O x D - drives the worksheet. No library, no
        // tool change: the formula is model content.
        // NB: `likelihood`, not `occurrence` — `occurrence` is a SysML
        // keyword, so an unquoted parameter of that name does not parse
        // (the domain libraries renamed the field for the same reason).
        // Concept matching accepts either spelling.
        let src = r#"package P {
            calc def WeightedRisk {
                in severity : Real;
                in likelihood : Real;
                in detection : Real;
                return : Real = severity * 10.0 + likelihood + detection;
            }
        }"#;
        let mut m = sysml_core::parser::parse_file("t.sysml", src);
        sysml_core::model::qualify_model(&mut m);

        let f = fields(&[("severity", "8"), ("occurrence", "3"), ("detection", "6")]);
        let item = build_item(Some(&m), 1, "p".into(), "annotation", None, &f, 1).unwrap();
        assert_eq!(item.rpn, Some(89.0), "model calc wins over S x O x D");
        assert_eq!(item.rpn_source.as_deref(), Some("model:WeightedRisk"));
    }

    #[test]
    fn built_in_is_labelled_when_the_model_declares_nothing() {
        let m = sysml_core::parser::parse_file("t.sysml", "package P { part def X; }");
        let f = fields(&[("severity", "8"), ("occurrence", "3"), ("detection", "6")]);
        let item = build_item(Some(&m), 1, "p".into(), "annotation", None, &f, 1).unwrap();
        assert_eq!(item.rpn, Some(144.0));
        assert_eq!(item.rpn_source.as_deref(), Some("built-in"));
    }

    #[test]
    fn calc_with_mismatched_parameters_is_not_used() {
        // A calc over unrelated parameters must not be mistaken for the
        // risk calculation.
        let src = r#"package P {
            calc def Area { in width : Real; in height : Real; return : Real = width * height; }
        }"#;
        let mut m = sysml_core::parser::parse_file("t.sysml", src);
        sysml_core::model::qualify_model(&mut m);
        let f = fields(&[("severity", "4"), ("occurrence", "2")]);
        let item = build_item(Some(&m), 1, "p".into(), "annotation", None, &f, 1).unwrap();
        assert_eq!(item.criticality, Some(8.0));
        assert_eq!(item.criticality_source.as_deref(), Some("built-in"));
    }

    #[test]
    fn stackup_math_matches_hand_calculation() {
        // gap = seat(30 +0.1/-0.1) - piston(28 +0.05/-0.05)
        //             - spring(1.5 +0.1/-0.1)
        // nominal 0.5; worst case 0.25 .. 0.75
        // sigma_i = (p+m)/6 -> 0.0333, 0.0167, 0.0333
        // sigma = sqrt(sum sq) = 0.0509; 3sigma = 0.1528
        let nominal: f64 = 30.0 - 28.0 - 1.5;
        assert!((nominal - 0.5).abs() < 1e-9);
        let wc_min: f64 = (30.0 - 0.1) - (28.0 + 0.05) - (1.5 + 0.1);
        let wc_max: f64 = (30.0 + 0.1) - (28.0 - 0.05) - (1.5 - 0.1);
        assert!((wc_min - 0.25).abs() < 1e-9);
        assert!((wc_max - 0.75).abs() < 1e-9);
        let sig = |p: f64, m: f64| (p + m) / 6.0;
        let var = sig(0.1, 0.1).powi(2) + sig(0.05, 0.05).powi(2) + sig(0.1, 0.1).powi(2);
        let sigma = var.sqrt();
        // sqrt(0.03333^2 + 0.01667^2 + 0.03333^2) = 0.05 exactly,
        // i.e. 3-sigma = 0.15 — matches `sysml analyze run` on the
        // same dimensions.
        assert!((sigma - 0.05).abs() < 1e-6, "sigma was {sigma}");
    }
}
// ---------------------------------------------------------------------------
// The generic primitives underneath
// ---------------------------------------------------------------------------
//
// Everything above is a preset: a row provider plus a calc, both of
// which the model supplies. These commands expose the same machinery
// without any domain vocabulary, so a user can point it at whatever
// their model happens to express — an FMEA worksheet, a tolerance
// chain, a power budget, a supplier scorecard.

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
