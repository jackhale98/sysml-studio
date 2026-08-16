use serde::{Serialize, Deserialize};
use super::elements::*;

/// Result of a model completeness check — critical for MBSE
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletenessReport {
    /// Requirements without satisfy relationships
    pub unsatisfied_requirements: Vec<ElementId>,
    /// Requirements without verify relationships
    pub unverified_requirements: Vec<ElementId>,
    /// Ports that are not connected
    pub unconnected_ports: Vec<ElementId>,
    /// Elements with no type reference
    pub untyped_usages: Vec<ElementId>,
    /// Overall completeness score (0.0 - 1.0)
    pub score: f64,
    /// Where the score came from: "model:QualityScore" when the model
    /// declares the scoring calc, "built-in" otherwise.
    #[serde(default)]
    pub score_source: String,
    /// Summary statistics
    pub summary: Vec<CompleteStat>,
    /// Model-declared CI gates (QualityGate / TraceGate), evaluated
    /// exactly as `sysml coverage --check` / `sysml trace --check` do.
    #[serde(default)]
    pub gates: Vec<GateStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateStatus {
    pub name: String,
    pub passed: bool,
    pub failed_expressions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteStat {
    pub label: String,
    pub total: u32,
    pub complete: u32,
}

/// Traceability matrix entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceabilityEntry {
    pub requirement_id: ElementId,
    pub requirement_name: String,
    pub satisfied_by: Vec<TraceLink>,
    pub verified_by: Vec<TraceLink>,
    pub allocated_to: Vec<TraceLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceLink {
    pub element_id: ElementId,
    pub element_name: String,
    pub element_kind: String,
}

/// Filter criteria for querying elements
#[derive(Debug, Clone, Deserialize)]
pub struct FilterCriteria {
    pub categories: Vec<String>,
    pub search_term: Option<String>,
    pub parent_name: Option<String>,
    pub kinds: Vec<String>,
    pub has_type_ref: Option<bool>,
    pub has_doc: Option<bool>,
}

/// Apply filters to element list
pub fn filter_elements(elements: &[SysmlElement], criteria: &FilterCriteria) -> Vec<SysmlElement> {
    elements.iter()
        .filter(|el| {
            // Category filter
            if !criteria.categories.is_empty() {
                let cat_str = serde_json::to_string(&el.category)
                    .unwrap_or_default()
                    .trim_matches('"').to_string();
                if !criteria.categories.contains(&cat_str) {
                    return false;
                }
            }

            // Search term filter
            if let Some(ref term) = criteria.search_term {
                if term.is_empty() {
                    // skip
                } else {
                    let lower = term.to_lowercase();
                    let matches_name = el.name.as_ref()
                        .map(|n| n.to_lowercase().contains(&lower))
                        .unwrap_or(false);
                    let matches_qname = el.qualified_name.to_lowercase().contains(&lower);
                    let matches_type = el.type_ref.as_ref()
                        .map(|t| t.to_lowercase().contains(&lower))
                        .unwrap_or(false);
                    let matches_doc = el.doc.as_ref()
                        .map(|d| d.to_lowercase().contains(&lower))
                        .unwrap_or(false);
                    if !matches_name && !matches_qname && !matches_type && !matches_doc {
                        return false;
                    }
                }
            }

            // Parent filter
            if let Some(ref pname) = criteria.parent_name {
                if let Some(pid) = el.parent_id {
                    let parent_matches = elements.iter()
                        .find(|p| p.id == pid)
                        .and_then(|p| p.name.as_ref())
                        .map(|n| n == pname)
                        .unwrap_or(false);
                    if !parent_matches { return false; }
                } else {
                    return false;
                }
            }

            // Kind filter
            if !criteria.kinds.is_empty() {
                let kind_str = serde_json::to_string(&el.kind)
                    .unwrap_or_default()
                    .trim_matches('"').to_string();
                if !criteria.kinds.contains(&kind_str) {
                    return false;
                }
            }

            // Has type ref filter
            if let Some(has_type) = criteria.has_type_ref {
                if has_type != el.type_ref.is_some() {
                    return false;
                }
            }

            // Has doc filter
            if let Some(has_doc) = criteria.has_doc {
                if has_doc != el.doc.is_some() {
                    return false;
                }
            }

            true
        })
        .cloned()
        .collect()
}

/// MBSE: Generate completeness report
/// Validation issue from core checks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub element_id: ElementId,
    pub severity: String,
    pub message: String,
    pub category: String,
    /// 1-based source line of the finding (0 = unknown).
    #[serde(default)]
    pub line: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

/// Validation report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationReport {
    pub issues: Vec<ValidationIssue>,
    pub summary: ValidationSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationSummary {
    pub errors: u32,
    pub warnings: u32,
    pub infos: u32,
}

/// Locate the element whose span contains the given 1-based line —
/// used to anchor core-check diagnostics to tree elements so the
/// validation panel can navigate. Picks the narrowest containing span.
pub fn element_at_line(elements: &[SysmlElement], line: u32) -> Option<ElementId> {
    elements
        .iter()
        .filter(|e| e.span.start_line <= line && line <= e.span.end_line)
        .min_by_key(|e| e.span.end_line - e.span.start_line)
        .map(|e| e.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_el(id: ElementId, kind: ElementKind, name: &str, category: Category) -> SysmlElement {
        SysmlElement {
            id,
            kind,
            name: Some(name.to_string()),
            qualified_name: name.to_string(),
            category,
            parent_id: None,
            children_ids: vec![],
            span: SourceSpan { start_line: 0, start_col: 0, end_line: 0, end_col: 0, start_byte: 0, end_byte: 0 },
            type_ref: None,
            specializations: vec![],
            modifiers: vec![],
            multiplicity: None,
            doc: None,
            short_name: None,
            value_expr: None,
        }
    }

    #[test]
    fn test_filter_by_category() {
        let elements = vec![
            make_el(0, ElementKind::PartDef, "Vehicle", Category::Structure),
            make_el(1, ElementKind::ActionDef, "Drive", Category::Behavior),
            make_el(2, ElementKind::RequirementDef, "SafeStop", Category::Requirement),
        ];

        let criteria = FilterCriteria {
            categories: vec!["structure".into()],
            search_term: None,
            parent_name: None,
            kinds: vec![],
            has_type_ref: None,
            has_doc: None,
        };

        let filtered = filter_elements(&elements, &criteria);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].name, Some("Vehicle".into()));
    }

    #[test]
    fn test_filter_by_search_term() {
        let elements = vec![
            make_el(0, ElementKind::PartDef, "Vehicle", Category::Structure),
            make_el(1, ElementKind::PartDef, "Engine", Category::Structure),
        ];

        let criteria = FilterCriteria {
            categories: vec![],
            search_term: Some("eng".into()),
            parent_name: None,
            kinds: vec![],
            has_type_ref: None,
            has_doc: None,
        };

        let filtered = filter_elements(&elements, &criteria);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].name, Some("Engine".into()));
    }

}
