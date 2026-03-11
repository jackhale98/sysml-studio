use serde::{Serialize, Deserialize};
use super::elements::*;
use super::graph::{ElementGraph, RelationshipType};

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
    /// Summary statistics
    pub summary: Vec<CompleteStat>,
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
pub fn check_completeness(elements: &[SysmlElement], graph: &ElementGraph) -> CompletenessReport {
    let requirements: Vec<_> = elements.iter()
        .filter(|e| matches!(e.kind, ElementKind::RequirementDef | ElementKind::RequirementUsage))
        .collect();

    let ports: Vec<_> = elements.iter()
        .filter(|e| matches!(e.kind, ElementKind::PortDef | ElementKind::PortUsage))
        .collect();

    let usages: Vec<_> = elements.iter()
        .filter(|e| e.kind.is_usage())
        .collect();

    let mut unsatisfied = Vec::new();
    let mut unverified = Vec::new();

    for req in &requirements {
        let (satisfied, verified) = graph.requirement_traceability(req.id);
        if satisfied.is_empty() {
            unsatisfied.push(req.id);
        }
        if verified.is_empty() {
            unverified.push(req.id);
        }
    }

    let unconnected_ports: Vec<_> = ports.iter()
        .filter(|p| {
            let connections = graph.outgoing_from(p.id).iter()
                .chain(graph.incoming_to(p.id).iter())
                .any(|r| matches!(r.rel_type, RelationshipType::Connection | RelationshipType::Flow));
            !connections
        })
        .map(|p| p.id)
        .collect();

    let untyped: Vec<_> = usages.iter()
        .filter(|u| u.type_ref.is_none() && !matches!(u.kind,
            ElementKind::FeatureUsage | ElementKind::EnumMember |
            ElementKind::TransitionStatement | ElementKind::StateUsage
        ))
        .map(|u| u.id)
        .collect();

    // Compute score
    let mut total_checks = 0u32;
    let mut passed_checks = 0u32;

    let req_total = requirements.len() as u32;
    let satisfied_count = req_total - unsatisfied.len() as u32;
    let verified_count = req_total - unverified.len() as u32;
    let connected_count = ports.len() as u32 - unconnected_ports.len() as u32;
    let typed_count = usages.len() as u32 - untyped.len() as u32;

    total_checks += req_total * 2 + ports.len() as u32 + usages.len() as u32;
    passed_checks += satisfied_count + verified_count + connected_count + typed_count;

    let score = if total_checks > 0 {
        passed_checks as f64 / total_checks as f64
    } else {
        1.0
    };

    let summary = vec![
        CompleteStat { label: "Requirements Satisfied".into(), total: req_total, complete: satisfied_count },
        CompleteStat { label: "Requirements Verified".into(), total: req_total, complete: verified_count },
        CompleteStat { label: "Ports Connected".into(), total: ports.len() as u32, complete: connected_count },
        CompleteStat { label: "Usages Typed".into(), total: usages.len() as u32, complete: typed_count },
    ];

    CompletenessReport {
        unsatisfied_requirements: unsatisfied,
        unverified_requirements: unverified,
        unconnected_ports,
        untyped_usages: untyped,
        score,
        summary,
    }
}

/// Validation issue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub element_id: ElementId,
    pub severity: String,
    pub message: String,
    pub category: String,
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

/// Run validation checks on the model
pub fn validate_model(elements: &[SysmlElement], graph: &ElementGraph) -> ValidationReport {
    let mut issues = Vec::new();

    for el in elements {
        // Check usages missing type references
        if el.kind.is_usage() && el.type_ref.is_none() && !matches!(el.kind,
            ElementKind::FeatureUsage | ElementKind::EnumMember |
            ElementKind::TransitionStatement | ElementKind::StateUsage |
            ElementKind::EventUsage | ElementKind::PerformStatement |
            ElementKind::ExhibitStatement | ElementKind::IncludeStatement
        ) {
            issues.push(ValidationIssue {
                element_id: el.id,
                severity: "warning".into(),
                message: format!("Usage '{}' has no type reference", el.name.as_deref().unwrap_or("<unnamed>")),
                category: "missing_type".into(),
            });
        }

        // Check definitions with no children (empty definitions)
        if el.kind.is_definition() && el.children_ids.is_empty() && !matches!(el.kind, ElementKind::EnumerationDef) {
            issues.push(ValidationIssue {
                element_id: el.id,
                severity: "info".into(),
                message: format!("Definition '{}' has no contents", el.name.as_deref().unwrap_or("<unnamed>")),
                category: "incomplete".into(),
            });
        }

        // Check unresolved type references
        if let Some(ref type_ref) = el.type_ref {
            let simple_name = type_ref.split("::").last().unwrap_or(type_ref);
            let resolved = elements.iter().any(|e| e.name.as_deref() == Some(simple_name));
            if !resolved {
                // Only warn for non-stdlib types
                let stdlib = ["Real", "Integer", "Boolean", "String", "Natural",
                    "Positive", "ScalarValues", "Time", "DateTime"];
                if !stdlib.iter().any(|s| type_ref.contains(s)) {
                    issues.push(ValidationIssue {
                        element_id: el.id,
                        severity: "warning".into(),
                        message: format!("Type '{}' not found in model", type_ref),
                        category: "unresolved_ref".into(),
                    });
                }
            }
        }

        // Check orphaned elements (not packages, imports, or top-level)
        if el.parent_id.is_none() && !matches!(el.kind, ElementKind::Package | ElementKind::Import | ElementKind::Comment | ElementKind::DocComment) {
            let has_outgoing = !graph.outgoing_from(el.id).is_empty();
            let has_incoming = !graph.incoming_to(el.id).is_empty();
            if !has_outgoing && !has_incoming && el.children_ids.is_empty() {
                issues.push(ValidationIssue {
                    element_id: el.id,
                    severity: "info".into(),
                    message: format!("Element '{}' is disconnected from the model", el.name.as_deref().unwrap_or("<unnamed>")),
                    category: "orphan".into(),
                });
            }
        }
    }

    let errors = issues.iter().filter(|i| i.severity == "error").count() as u32;
    let warnings = issues.iter().filter(|i| i.severity == "warning").count() as u32;
    let infos = issues.iter().filter(|i| i.severity == "info").count() as u32;

    ValidationReport {
        issues,
        summary: ValidationSummary { errors, warnings, infos },
    }
}

/// MBSE: Generate traceability matrix
pub fn build_traceability_matrix(elements: &[SysmlElement], graph: &ElementGraph) -> Vec<TraceabilityEntry> {
    elements.iter()
        .filter(|e| matches!(e.kind, ElementKind::RequirementDef | ElementKind::RequirementUsage))
        .map(|req| {
            let (satisfied_ids, verified_ids) = graph.requirement_traceability(req.id);
            // Check both directions: allocations FROM req and allocations TO req
            let mut allocated_ids = graph.allocations_from(req.id);
            allocated_ids.extend(graph.allocations_to(req.id));

            let to_link = |id: ElementId| -> TraceLink {
                elements.iter()
                    .find(|e| e.id == id)
                    .map(|e| TraceLink {
                        element_id: e.id,
                        element_name: e.name.clone().unwrap_or_else(|| "<unnamed>".into()),
                        element_kind: e.kind.display_label().to_string(),
                    })
                    .unwrap_or(TraceLink {
                        element_id: id,
                        element_name: "<unknown>".into(),
                        element_kind: "unknown".into(),
                    })
            };

            TraceabilityEntry {
                requirement_id: req.id,
                requirement_name: req.name.clone().unwrap_or_else(|| "<unnamed>".into()),
                satisfied_by: satisfied_ids.into_iter().map(&to_link).collect(),
                verified_by: verified_ids.into_iter().map(&to_link).collect(),
                allocated_to: allocated_ids.into_iter().map(to_link).collect(),
            }
        })
        .collect()
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

    #[test]
    fn test_completeness_all_requirements_unsatisfied() {
        let elements = vec![
            make_el(0, ElementKind::RequirementDef, "SafeStop", Category::Requirement),
            make_el(1, ElementKind::RequirementDef, "MaxSpeed", Category::Requirement),
        ];
        let graph = ElementGraph::build_from_model(&elements);
        let report = check_completeness(&elements, &graph);

        assert_eq!(report.unsatisfied_requirements.len(), 2);
        assert_eq!(report.unverified_requirements.len(), 2);
        assert!(report.score < 1.0);
    }
}
