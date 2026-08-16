//! Adapter layer: converts sysml_core::model::Model into Studio's flat SysmlElement array.
//!
//! sysml-core uses separate vectors (definitions, usages, connections, etc.) with
//! parent tracking via name strings. Studio's frontend expects a flat Vec<SysmlElement>
//! with numeric IDs and parent_id/children_ids for tree rendering.

use sysml_core::model::{self as core, DefKind, Model};
use crate::model::elements::*;

/// Convert a sysml-core Model into Studio's SysmlModel.
pub fn convert_model(core_model: &Model, parse_time_ms: f64) -> SysmlModel {
    let mut elements: Vec<SysmlElement> = Vec::new();
    let mut next_id: ElementId = 0;

    // Phase 1: Create elements from definitions and usages, tracking core identity.
    // We need a name→id map so we can resolve parent_def strings to numeric IDs.
    let mut def_name_to_id: std::collections::HashMap<String, ElementId> = std::collections::HashMap::new();

    // --- Definitions ---
    for def in &core_model.definitions {
        let id = next_id;
        next_id += 1;
        def_name_to_id.insert(def.name.clone(), id);

        let kind = def_kind_to_element_kind(&def.kind);
        elements.push(SysmlElement {
            id,
            kind: kind.clone(),
            name: Some(def.name.clone()),
            qualified_name: def.qualified_name.as_ref()
                .map(|q| q.to_string())
                .unwrap_or_else(|| def.name.clone()),
            category: element_kind_to_category(&kind),
            parent_id: None, // resolved in phase 2
            children_ids: vec![],
            span: convert_span(&def.span),
            type_ref: def.super_type.clone(),
            specializations: def.super_type.iter().cloned().collect(),
            modifiers: {
                let mut m = Vec::new();
                if def.is_abstract { m.push("abstract".to_string()); }
                if let Some(ref v) = def.visibility { m.push(v.label().to_string()); }
                m
            },
            multiplicity: None,
            doc: def.doc.clone(),
            short_name: def.short_name.clone(),
            value_expr: None,
        });

        // Enum members as child elements
        for member in &def.enum_members {
            let member_id = next_id;
            next_id += 1;
            elements.push(SysmlElement {
                id: member_id,
                kind: ElementKind::EnumMember,
                name: Some(member.name.clone()),
                qualified_name: format!("{}::{}", def.name, member.name),
                category: Category::Property,
                parent_id: Some(id),
                children_ids: vec![],
                span: convert_span(&def.span), // enum members share parent span
                type_ref: None,
                specializations: vec![],
                modifiers: vec![],
                multiplicity: None,
                doc: member.doc.clone(),
                short_name: None,
                value_expr: None,
            });
        }
    }

    // --- Usages ---
    for usage in &core_model.usages {
        let id = next_id;
        next_id += 1;
        // Also register usage names so child lookups work
        if !usage.name.is_empty() {
            def_name_to_id.entry(usage.name.clone()).or_insert(id);
        }

        let kind = usage_kind_to_element_kind(&usage.kind);
        // For transitions, value_expr holds the source state from "first" clause
        let specializations = if kind == ElementKind::TransitionStatement {
            usage.value_expr.iter().cloned().collect()
        } else {
            vec![]
        };
        elements.push(SysmlElement {
            id,
            kind: kind.clone(),
            name: if usage.name.is_empty() { None } else { Some(usage.name.clone()) },
            qualified_name: usage.qualified_name.as_ref()
                .map(|q| q.to_string())
                .unwrap_or_else(|| usage.name.clone()),
            category: element_kind_to_category(&kind),
            parent_id: None, // resolved in phase 2
            children_ids: vec![],
            span: convert_span(&usage.span),
            type_ref: usage.type_ref.clone(),
            specializations,
            modifiers: {
                let mut m = Vec::new();
                if let Some(ref d) = usage.direction { m.push(d.label().to_string()); }
                if usage.is_conjugated { m.push("conjugated".to_string()); }
                if usage.redefinition.is_some() { m.push("redefines".to_string()); }
                m
            },
            multiplicity: usage.multiplicity.as_ref().map(|m| m.to_string()),
            doc: None,
            short_name: usage.short_name.clone(),
            value_expr: if kind == ElementKind::TransitionStatement { None } else { usage.value_expr.clone() },
        });
    }

    // --- Relationships (connections, flows, satisfy, verify, allocations) ---
    for conn in &core_model.connections {
        let id = next_id;
        next_id += 1;
        elements.push(SysmlElement {
            id,
            kind: ElementKind::ConnectStatement,
            name: conn.name.clone(),
            qualified_name: conn.name.clone().unwrap_or_else(|| format!("connect_{}", id)),
            category: Category::Relationship,
            parent_id: None,
            children_ids: vec![],
            span: convert_span(&conn.span),
            type_ref: Some(conn.target.clone()),
            specializations: vec![conn.source.clone(), conn.target.clone()],
            modifiers: vec![],
            multiplicity: None,
            doc: None,
            short_name: None,
            value_expr: None,
        });
    }

    for flow in &core_model.flows {
        let id = next_id;
        next_id += 1;
        elements.push(SysmlElement {
            id,
            kind: ElementKind::FlowStatement,
            name: flow.name.clone(),
            qualified_name: flow.name.clone().unwrap_or_else(|| format!("flow_{}", id)),
            category: Category::Relationship,
            parent_id: None,
            children_ids: vec![],
            span: convert_span(&flow.span),
            type_ref: flow.item_type.clone(),
            specializations: vec![flow.source.clone(), flow.target.clone()],
            modifiers: vec![],
            multiplicity: None,
            doc: None,
            short_name: None,
            value_expr: None,
        });
    }

    for sat in &core_model.satisfactions {
        let id = next_id;
        next_id += 1;
        elements.push(SysmlElement {
            id,
            kind: ElementKind::SatisfyStatement,
            name: sat.by.clone(),
            qualified_name: format!("satisfy_{}", sat.requirement),
            category: Category::Relationship,
            parent_id: None, // resolved in phase 2
            children_ids: vec![],
            span: convert_span(&sat.span),
            type_ref: Some(sat.requirement.clone()),
            specializations: vec![],
            modifiers: vec![],
            multiplicity: None,
            doc: None,
            short_name: None,
            value_expr: None,
        });
    }

    for ver in &core_model.verifications {
        let id = next_id;
        next_id += 1;
        elements.push(SysmlElement {
            id,
            kind: ElementKind::VerifyStatement,
            name: Some(ver.by.clone()),
            qualified_name: format!("verify_{}", ver.requirement),
            category: Category::Relationship,
            parent_id: None, // resolved in phase 2
            children_ids: vec![],
            span: convert_span(&ver.span),
            type_ref: Some(ver.requirement.clone()),
            specializations: vec![],
            modifiers: vec![],
            multiplicity: None,
            doc: None,
            short_name: None,
            value_expr: None,
        });
    }

    for alloc in &core_model.allocations {
        let id = next_id;
        next_id += 1;
        elements.push(SysmlElement {
            id,
            kind: ElementKind::AllocateStatement,
            name: None,
            qualified_name: format!("allocate_{}_{}", alloc.source, alloc.target),
            category: Category::Relationship,
            parent_id: None,
            children_ids: vec![],
            span: convert_span(&alloc.span),
            type_ref: Some(alloc.target.clone()),
            specializations: vec![alloc.source.clone(), alloc.target.clone()],
            modifiers: vec![],
            multiplicity: None,
            doc: None,
            short_name: None,
            value_expr: None,
        });
    }

    // --- Imports ---
    for imp in &core_model.imports {
        let id = next_id;
        next_id += 1;
        elements.push(SysmlElement {
            id,
            kind: ElementKind::Import,
            name: Some(imp.path.clone()),
            qualified_name: imp.path.clone(),
            category: Category::Auxiliary,
            parent_id: None,
            children_ids: vec![],
            span: convert_span(&imp.span),
            type_ref: None,
            specializations: vec![],
            modifiers: {
                let mut m = Vec::new();
                if imp.is_wildcard { m.push("wildcard".to_string()); }
                if imp.is_recursive { m.push("recursive".to_string()); }
                m
            },
            multiplicity: None,
            doc: None,
            short_name: None,
            value_expr: None,
        });
    }

    // --- Comments ---
    for comment in &core_model.comments {
        let id = next_id;
        next_id += 1;
        elements.push(SysmlElement {
            id,
            kind: ElementKind::DocComment,
            name: None,
            qualified_name: format!("comment_{}", id),
            category: Category::Auxiliary,
            parent_id: None,
            children_ids: vec![],
            span: convert_span(&comment.span),
            type_ref: None,
            specializations: vec![],
            modifiers: vec![],
            multiplicity: None,
            doc: Some(comment.text.clone()),
            short_name: None,
            value_expr: None,
        });
    }

    // Phase 2: Resolve parent_id from parent_def name strings.
    // sysml-core tracks parents by name (parent_def field), we need to convert to numeric IDs.
    // Build a span-based containment map as a fallback: parent is the nearest definition
    // whose span contains this element's span.
    resolve_parents(&mut elements, core_model, &def_name_to_id);

    // Phase 3: Build children_ids from parent_id relationships.
    build_children(&mut elements);

    // Errors
    let errors: Vec<ParseError> = core_model.syntax_errors.iter()
        .map(|e| ParseError {
            message: e.message.clone(),
            span: convert_span(&e.span),
        })
        .collect();

    let stats = ModelStats {
        total_elements: elements.len() as u32,
        definitions: elements.iter().filter(|e| e.kind.is_definition()).count() as u32,
        usages: elements.iter().filter(|e| e.kind.is_usage()).count() as u32,
        relationships: elements.iter().filter(|e| e.kind.is_relationship()).count() as u32,
        errors: errors.len() as u32,
        parse_time_ms,
    };

    // --- Views ---
    let views: Vec<ViewData> = core_model.views.iter().map(|v| ViewData {
        name: v.name.clone(),
        exposes: v.exposes.clone(),
        kind_filters: v.kind_filters.clone(),
        render_as: v.render_as.clone(),
    }).collect();

    SysmlModel {
        file_path: Some(core_model.file.clone()),
        elements,
        errors,
        stats,
        views,
    }
}

/// Resolve parent_id for all elements using sysml-core's parent_def names.
fn resolve_parents(
    elements: &mut [SysmlElement],
    core_model: &Model,
    name_to_id: &std::collections::HashMap<String, ElementId>,
) {
    // Build parent_def lookups from core model
    let mut idx = 0usize;

    // Definitions
    for def in &core_model.definitions {
        if let Some(ref parent_name) = def.parent_def {
            if let Some(&parent_id) = name_to_id.get(parent_name) {
                if idx < elements.len() {
                    elements[idx].parent_id = Some(parent_id);
                }
            }
        }
        idx += 1;
        // Skip enum member slots
        idx += def.enum_members.len();
    }

    // Usages
    for usage in &core_model.usages {
        if let Some(ref parent_name) = usage.parent_def {
            if let Some(&parent_id) = name_to_id.get(parent_name) {
                if idx < elements.len() {
                    elements[idx].parent_id = Some(parent_id);
                }
            }
        }
        idx += 1;
    }

    // Relationships: satisfy/verify parent resolution
    // Skip connections and flows (they don't have parent_def in core)
    // connections + flows + satisfactions offset
    let conn_count = core_model.connections.len();
    let flow_count = core_model.flows.len();
    idx += conn_count + flow_count;

    for sat in &core_model.satisfactions {
        if let Some(ref by_name) = sat.by {
            if let Some(&parent_id) = name_to_id.get(by_name) {
                if idx < elements.len() {
                    elements[idx].parent_id = Some(parent_id);
                }
            }
        }
        idx += 1;
    }

    for ver in &core_model.verifications {
        if let Some(&parent_id) = name_to_id.get(&ver.by) {
            if idx < elements.len() {
                elements[idx].parent_id = Some(parent_id);
            }
        }
        idx += 1;
    }

    // For remaining elements without parent_id, use span containment
    // (find the narrowest definition whose span contains this element)
    let def_spans: Vec<(ElementId, u32, u32)> = elements.iter()
        .filter(|e| e.kind.is_definition())
        .map(|e| (e.id, e.span.start_byte, e.span.end_byte))
        .collect();

    for el in elements.iter_mut() {
        if el.parent_id.is_some() || el.kind.is_definition() && el.kind == ElementKind::Package {
            continue;
        }
        if el.parent_id.is_none() {
            // Find narrowest containing definition
            let mut best: Option<(ElementId, u32)> = None;
            for &(def_id, start, end) in &def_spans {
                if def_id == el.id { continue; }
                if start <= el.span.start_byte && el.span.end_byte <= end {
                    let span_size = end - start;
                    if best.is_none() || span_size < best.unwrap().1 {
                        best = Some((def_id, span_size));
                    }
                }
            }
            if let Some((parent_id, _)) = best {
                el.parent_id = Some(parent_id);
            }
        }
    }
}

/// Build children_ids from parent_id relationships.
fn build_children(elements: &mut [SysmlElement]) {
    // Clear any existing children
    for el in elements.iter_mut() {
        el.children_ids.clear();
    }

    // Collect parent→child mappings
    let mappings: Vec<(ElementId, ElementId)> = elements.iter()
        .filter_map(|el| el.parent_id.map(|pid| (pid, el.id)))
        .collect();

    for (parent_id, child_id) in mappings {
        if let Some(parent) = elements.iter_mut().find(|e| e.id == parent_id) {
            parent.children_ids.push(child_id);
        }
    }
}

fn convert_span(span: &core::Span) -> SourceSpan {
    SourceSpan {
        start_line: span.start_row as u32,
        start_col: span.start_col as u32,
        end_line: span.end_row as u32,
        end_col: span.end_col as u32,
        start_byte: span.start_byte as u32,
        end_byte: span.end_byte as u32,
    }
}

fn def_kind_to_element_kind(kind: &DefKind) -> ElementKind {
    match kind {
        DefKind::Part => ElementKind::PartDef,
        DefKind::Port => ElementKind::PortDef,
        DefKind::Connection => ElementKind::ConnectionDef,
        DefKind::Interface => ElementKind::InterfaceDef,
        DefKind::Flow => ElementKind::FlowDef,
        DefKind::Action => ElementKind::ActionDef,
        DefKind::State => ElementKind::StateDef,
        DefKind::Constraint => ElementKind::ConstraintDef,
        DefKind::Calc => ElementKind::CalcDef,
        DefKind::Requirement => ElementKind::RequirementDef,
        DefKind::UseCase => ElementKind::UseCaseDef,
        DefKind::Verification => ElementKind::VerificationCaseDef,
        DefKind::Analysis => ElementKind::AnalysisCaseDef,
        DefKind::Concern => ElementKind::ConcernDef,
        DefKind::View => ElementKind::ViewDef,
        DefKind::Viewpoint => ElementKind::ViewpointDef,
        DefKind::Rendering => ElementKind::RenderingDef,
        DefKind::Enum => ElementKind::EnumerationDef,
        DefKind::Attribute => ElementKind::AttributeDef,
        DefKind::Item => ElementKind::ItemDef,
        DefKind::Allocation => ElementKind::AllocationDef,
        DefKind::Occurrence => ElementKind::OccurrenceDef,
        DefKind::Package => ElementKind::Package,
        DefKind::Class => ElementKind::ClassDef,
        DefKind::Struct => ElementKind::StructDef,
        DefKind::Assoc => ElementKind::AssocDef,
        DefKind::Behavior => ElementKind::BehaviorDef,
        DefKind::Datatype => ElementKind::DataTypeDef,
        DefKind::Feature => ElementKind::FeatureUsage,
        DefKind::Function => ElementKind::FunctionDef,
        DefKind::Interaction => ElementKind::InteractionDef,
        DefKind::Connector => ElementKind::ConnectionDef,
        DefKind::Predicate => ElementKind::PredicateDef,
        DefKind::Namespace => ElementKind::Package,
        DefKind::Type => ElementKind::Other("type_def".into()),
        DefKind::Classifier => ElementKind::Other("classifier_def".into()),
        DefKind::Metaclass => ElementKind::MetadataDef,
        DefKind::Expr => ElementKind::CalcDef,
        DefKind::Step => ElementKind::ActionUsage,
        DefKind::Metadata => ElementKind::MetadataDef,
        DefKind::Annotation => ElementKind::Comment,
    }
}

fn usage_kind_to_element_kind(kind: &str) -> ElementKind {
    match kind {
        "part" => ElementKind::PartUsage,
        "attribute" | "attr" => ElementKind::AttributeUsage,
        "port" => ElementKind::PortUsage,
        "connection" => ElementKind::ConnectionUsage,
        "interface" => ElementKind::InterfaceUsage,
        "item" => ElementKind::ItemUsage,
        "action" => ElementKind::ActionUsage,
        "state" => ElementKind::StateUsage,
        "constraint" => ElementKind::ConstraintUsage,
        "requirement" | "require" => ElementKind::RequirementUsage,
        "concern" => ElementKind::ConcernUsage,
        "view" => ElementKind::ViewUsage,
        "viewpoint" => ElementKind::ViewpointUsage,
        "rendering" => ElementKind::RenderingUsage,
        "allocation" | "allocate" => ElementKind::AllocationUsage,
        "analysis" => ElementKind::AnalysisUsage,
        "use case" | "usecase" => ElementKind::UseCaseUsage,
        "verification" | "verify" => ElementKind::VerificationUsage,
        "occurrence" => ElementKind::OccurrenceUsage,
        "flow" => ElementKind::FlowUsage,
        "metadata" => ElementKind::MetadataUsage,
        "calc" => ElementKind::CalcUsage,
        "ref" => ElementKind::RefUsage,
        "event" => ElementKind::EventUsage,
        "enum" => ElementKind::EnumMember,
        "transition" => ElementKind::TransitionStatement,
        "succession" => ElementKind::SuccessionUsage,
        "fork_node" => ElementKind::ForkNode,
        "join_node" => ElementKind::JoinNode,
        "merge_node" => ElementKind::MergeNode,
        "decide_node" => ElementKind::DecideNode,
        "then_succession" => ElementKind::SuccessionBranch,
        "binding" => ElementKind::BindingUsage,
        "snapshot" => ElementKind::SnapshotUsage,
        "timeslice" => ElementKind::TimesliceUsage,
        "feature" => ElementKind::FeatureUsage,
        "end" => ElementKind::EndFeature,
        "actor" => ElementKind::ActorDeclaration,
        "subject" => ElementKind::SubjectDeclaration,
        "objective" => ElementKind::ObjectiveDeclaration,
        "stakeholder" => ElementKind::StakeholderDeclaration,
        "message" => ElementKind::MessageUsage,
        "case" => ElementKind::UseCaseUsage,
        "step" => ElementKind::StepUsage,
        "expr" => ElementKind::ExprUsage,
        "classifier" => ElementKind::ClassifierUsage,
        "metaclass" => ElementKind::MetaclassUsage,
        "succession flow" => ElementKind::SuccessionFlowUsage,
        "frame" => ElementKind::FrameUsage,
        "return" => ElementKind::ReturnUsage,
        // KerML usage kinds
        "assoc" => ElementKind::AssocUsage,
        "behavior" => ElementKind::BehaviorUsage,
        "class" => ElementKind::ClassUsage,
        "connector" => ElementKind::ConnectorUsage,
        "datatype" => ElementKind::DataTypeUsage,
        "function" => ElementKind::FunctionDef, // function usages map to FunctionDef
        "interaction" => ElementKind::InteractionDef,
        "predicate" => ElementKind::PredicateDef,
        "struct" => ElementKind::StructUsage,
        "type" => ElementKind::TypeUsage,
        other => ElementKind::Other(other.to_string()),
    }
}

fn element_kind_to_category(kind: &ElementKind) -> Category {
    match kind {
        ElementKind::Package | ElementKind::PartDef | ElementKind::PartUsage |
        ElementKind::ItemDef | ElementKind::ItemUsage | ElementKind::IndividualDef |
        ElementKind::OccurrenceDef | ElementKind::OccurrenceUsage |
        ElementKind::ClassDef | ElementKind::StructDef | ElementKind::AssocDef |
        ElementKind::DataTypeDef | ElementKind::EnumerationDef |
        ElementKind::EnumMember | ElementKind::ClassUsage | ElementKind::StructUsage |
        ElementKind::AssocUsage | ElementKind::DataTypeUsage |
        ElementKind::TypeUsage => Category::Structure,

        ElementKind::ActionDef | ElementKind::ActionUsage |
        ElementKind::StateDef | ElementKind::StateUsage |
        ElementKind::TransitionStatement | ElementKind::InlineTransition |
        ElementKind::UseCaseDef | ElementKind::UseCaseUsage |
        ElementKind::BehaviorDef | ElementKind::FunctionDef |
        ElementKind::InteractionDef | ElementKind::PredicateDef |
        ElementKind::BehaviorUsage | ElementKind::StepUsage |
        ElementKind::CaseUsage |
        ElementKind::ForkNode | ElementKind::JoinNode | ElementKind::MergeNode |
        ElementKind::DecideNode | ElementKind::IfAction | ElementKind::WhileAction |
        ElementKind::ForAction | ElementKind::SendAction | ElementKind::AssignAction |
        ElementKind::DoAction | ElementKind::EntryAction | ElementKind::ExitAction |
        ElementKind::ElseAction | ElementKind::PerformStatement |
        ElementKind::ExhibitStatement | ElementKind::IncludeStatement |
        ElementKind::TerminateStatement | ElementKind::SuccessionUsage |
        ElementKind::SuccessionFlowUsage | ElementKind::SuccessionBranch => Category::Behavior,

        ElementKind::RequirementDef | ElementKind::RequirementUsage |
        ElementKind::ConcernDef | ElementKind::ConcernUsage |
        ElementKind::SatisfyStatement | ElementKind::VerifyStatement => Category::Requirement,

        ElementKind::PortDef | ElementKind::PortUsage |
        ElementKind::ConnectionDef | ElementKind::ConnectionUsage |
        ElementKind::InterfaceDef | ElementKind::InterfaceUsage |
        ElementKind::FlowDef | ElementKind::FlowUsage |
        ElementKind::ConnectorUsage | ElementKind::MessageUsage => Category::Interface,

        ElementKind::AttributeDef | ElementKind::AttributeUsage |
        ElementKind::FeatureUsage | ElementKind::EndFeature |
        ElementKind::RefUsage | ElementKind::EventUsage |
        ElementKind::SnapshotUsage | ElementKind::TimesliceUsage |
        ElementKind::BindingUsage | ElementKind::BooleanExpressionUsage |
        ElementKind::InvariantUsage | ElementKind::ResultExpression |
        ElementKind::CalcDef | ElementKind::CalcUsage |
        ElementKind::MetadataDef | ElementKind::MetadataUsage |
        ElementKind::ExprUsage | ElementKind::ReturnUsage => Category::Property,

        ElementKind::ConnectStatement | ElementKind::AllocateStatement |
        ElementKind::FlowStatement | ElementKind::DependencyStatement |
        ElementKind::MessageStatement |
        ElementKind::Specialization | ElementKind::Redefinition |
        ElementKind::TypedBy | ElementKind::Binding => Category::Relationship,

        ElementKind::ConstraintDef | ElementKind::ConstraintUsage => Category::Constraint,

        ElementKind::AnalysisCaseDef | ElementKind::AnalysisUsage |
        ElementKind::VerificationCaseDef | ElementKind::VerificationUsage |
        ElementKind::AllocationDef | ElementKind::AllocationUsage => Category::Analysis,

        ElementKind::ViewDef | ElementKind::ViewUsage |
        ElementKind::ViewpointDef | ElementKind::ViewpointUsage |
        ElementKind::RenderingDef | ElementKind::RenderingUsage => Category::View,

        ElementKind::Import | ElementKind::Alias |
        ElementKind::Comment | ElementKind::DocComment |
        ElementKind::TextualRepresentation |
        ElementKind::SubjectDeclaration | ElementKind::ActorDeclaration |
        ElementKind::ObjectiveDeclaration | ElementKind::StakeholderDeclaration |
        ElementKind::FrameUsage | ElementKind::ClassifierUsage |
        ElementKind::MetaclassUsage |
        ElementKind::Other(_) => Category::Auxiliary,
    }
}

/// Run sysml-core lint checks and convert to Studio's ValidationReport.
/// Includes W017 value-constraint evaluation, which is a project-level
/// pass (`check_value_constraints`) and deliberately NOT part of
/// `all_checks()`.
pub fn run_core_checks(
    core_model: &Model,
    siblings: &[Model],
) -> Vec<crate::model::query::ValidationIssue> {
    use sysml_core::checks::all_checks;

    let checks = all_checks();
    let mut diags: Vec<sysml_core::diagnostic::Diagnostic> = Vec::new();
    for check in &checks {
        diags.extend(check.run(core_model));
    }
    // W017 is project-wide: siblings/libraries provide the assert
    // constraints, the active file provides the values.
    let mut all_models: Vec<Model> = Vec::with_capacity(siblings.len() + 1);
    all_models.push(core_model.clone());
    all_models.extend_from_slice(siblings);
    diags.extend(sysml_core::checks::value_constraints::check_value_constraints(
        &all_models,
        &[core_model.file.clone()],
    ));

    diags
        .into_iter()
        .map(|diag| {
            let severity = match diag.severity {
                sysml_core::diagnostic::Severity::Error => "error",
                sysml_core::diagnostic::Severity::Warning => "warning",
                sysml_core::diagnostic::Severity::Note => "info",
            };
            crate::model::query::ValidationIssue {
                element_id: 0,
                severity: severity.to_string(),
                message: format!("[{}] {}", diag.code, diag.message),
                category: diag.code.to_string(),
                line: diag.span.start_row as u32,
                suggestion: diag.suggestion.clone(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_usage_kind_mapping_covers_all_sysml_kinds() {
        // Standard SysML usage kinds
        let sysml_kinds = vec![
            ("part", ElementKind::PartUsage),
            ("attribute", ElementKind::AttributeUsage),
            ("attr", ElementKind::AttributeUsage),
            ("port", ElementKind::PortUsage),
            ("connection", ElementKind::ConnectionUsage),
            ("interface", ElementKind::InterfaceUsage),
            ("item", ElementKind::ItemUsage),
            ("action", ElementKind::ActionUsage),
            ("state", ElementKind::StateUsage),
            ("constraint", ElementKind::ConstraintUsage),
            ("requirement", ElementKind::RequirementUsage),
            ("concern", ElementKind::ConcernUsage),
            ("view", ElementKind::ViewUsage),
            ("viewpoint", ElementKind::ViewpointUsage),
            ("rendering", ElementKind::RenderingUsage),
            ("allocation", ElementKind::AllocationUsage),
            ("analysis", ElementKind::AnalysisUsage),
            ("use case", ElementKind::UseCaseUsage),
            ("verification", ElementKind::VerificationUsage),
            ("occurrence", ElementKind::OccurrenceUsage),
            ("flow", ElementKind::FlowUsage),
            ("metadata", ElementKind::MetadataUsage),
            ("calc", ElementKind::CalcUsage),
            ("ref", ElementKind::RefUsage),
            ("event", ElementKind::EventUsage),
            ("enum", ElementKind::EnumMember),
            ("transition", ElementKind::TransitionStatement),
            ("succession", ElementKind::SuccessionUsage),
            ("fork_node", ElementKind::ForkNode),
            ("join_node", ElementKind::JoinNode),
            ("merge_node", ElementKind::MergeNode),
            ("decide_node", ElementKind::DecideNode),
            ("then_succession", ElementKind::SuccessionBranch),
            ("binding", ElementKind::BindingUsage),
            ("snapshot", ElementKind::SnapshotUsage),
            ("timeslice", ElementKind::TimesliceUsage),
            ("feature", ElementKind::FeatureUsage),
            ("end", ElementKind::EndFeature),
        ];

        for (kind_str, expected) in sysml_kinds {
            let result = usage_kind_to_element_kind(kind_str);
            assert_eq!(result, expected, "usage kind '{}' should map to {:?}", kind_str, expected);
        }
    }

    #[test]
    fn test_usage_kind_mapping_covers_new_kinds() {
        let new_kinds = vec![
            ("message", ElementKind::MessageUsage),
            ("case", ElementKind::UseCaseUsage),
            ("step", ElementKind::StepUsage),
            ("expr", ElementKind::ExprUsage),
            ("classifier", ElementKind::ClassifierUsage),
            ("metaclass", ElementKind::MetaclassUsage),
            ("succession flow", ElementKind::SuccessionFlowUsage),
            ("frame", ElementKind::FrameUsage),
            ("return", ElementKind::ReturnUsage),
            ("subject", ElementKind::SubjectDeclaration),
            ("objective", ElementKind::ObjectiveDeclaration),
            ("actor", ElementKind::ActorDeclaration),
            ("stakeholder", ElementKind::StakeholderDeclaration),
        ];

        for (kind_str, expected) in new_kinds {
            let result = usage_kind_to_element_kind(kind_str);
            assert_eq!(result, expected, "new usage kind '{}' should map to {:?}", kind_str, expected);
        }
    }

    #[test]
    fn test_usage_kind_mapping_covers_kerml_kinds() {
        let kerml_kinds = vec![
            ("assoc", ElementKind::AssocUsage),
            ("behavior", ElementKind::BehaviorUsage),
            ("class", ElementKind::ClassUsage),
            ("connector", ElementKind::ConnectorUsage),
            ("datatype", ElementKind::DataTypeUsage),
            ("struct", ElementKind::StructUsage),
            ("type", ElementKind::TypeUsage),
        ];

        for (kind_str, expected) in kerml_kinds {
            let result = usage_kind_to_element_kind(kind_str);
            assert_eq!(result, expected, "KerML usage kind '{}' should map to {:?}", kind_str, expected);
        }
    }

    #[test]
    fn test_unknown_kind_maps_to_other() {
        let result = usage_kind_to_element_kind("some_unknown_thing");
        assert!(matches!(result, ElementKind::Other(_)));
    }

    #[test]
    fn test_def_kind_mapping_covers_all_variants() {
        use sysml_core::model::DefKind;

        let all_def_kinds = vec![
            (DefKind::Part, ElementKind::PartDef),
            (DefKind::Port, ElementKind::PortDef),
            (DefKind::Connection, ElementKind::ConnectionDef),
            (DefKind::Interface, ElementKind::InterfaceDef),
            (DefKind::Flow, ElementKind::FlowDef),
            (DefKind::Action, ElementKind::ActionDef),
            (DefKind::State, ElementKind::StateDef),
            (DefKind::Constraint, ElementKind::ConstraintDef),
            (DefKind::Calc, ElementKind::CalcDef),
            (DefKind::Requirement, ElementKind::RequirementDef),
            (DefKind::UseCase, ElementKind::UseCaseDef),
            (DefKind::Verification, ElementKind::VerificationCaseDef),
            (DefKind::Analysis, ElementKind::AnalysisCaseDef),
            (DefKind::Concern, ElementKind::ConcernDef),
            (DefKind::View, ElementKind::ViewDef),
            (DefKind::Viewpoint, ElementKind::ViewpointDef),
            (DefKind::Rendering, ElementKind::RenderingDef),
            (DefKind::Enum, ElementKind::EnumerationDef),
            (DefKind::Attribute, ElementKind::AttributeDef),
            (DefKind::Item, ElementKind::ItemDef),
            (DefKind::Allocation, ElementKind::AllocationDef),
            (DefKind::Occurrence, ElementKind::OccurrenceDef),
            (DefKind::Package, ElementKind::Package),
            // KerML
            (DefKind::Class, ElementKind::ClassDef),
            (DefKind::Struct, ElementKind::StructDef),
            (DefKind::Assoc, ElementKind::AssocDef),
            (DefKind::Behavior, ElementKind::BehaviorDef),
            (DefKind::Datatype, ElementKind::DataTypeDef),
            (DefKind::Feature, ElementKind::FeatureUsage),
            (DefKind::Function, ElementKind::FunctionDef),
            (DefKind::Interaction, ElementKind::InteractionDef),
            (DefKind::Connector, ElementKind::ConnectionDef),
            (DefKind::Predicate, ElementKind::PredicateDef),
            (DefKind::Namespace, ElementKind::Package),
            (DefKind::Metaclass, ElementKind::MetadataDef),
            (DefKind::Metadata, ElementKind::MetadataDef),
            (DefKind::Expr, ElementKind::CalcDef),
            (DefKind::Step, ElementKind::ActionUsage),
            (DefKind::Annotation, ElementKind::Comment),
        ];

        for (def_kind, expected) in all_def_kinds {
            let result = def_kind_to_element_kind(&def_kind);
            assert_eq!(result, expected, "DefKind::{:?} should map to {:?}", def_kind, expected);
        }
    }

    #[test]
    fn test_all_element_kinds_have_category() {
        // Ensure no panic from element_kind_to_category for all known kinds
        let all_kinds = vec![
            ElementKind::Package, ElementKind::PartDef, ElementKind::PartUsage,
            ElementKind::AttributeDef, ElementKind::AttributeUsage,
            ElementKind::PortDef, ElementKind::PortUsage,
            ElementKind::ConnectionDef, ElementKind::ConnectionUsage,
            ElementKind::InterfaceDef, ElementKind::InterfaceUsage,
            ElementKind::ActionDef, ElementKind::ActionUsage,
            ElementKind::StateDef, ElementKind::StateUsage,
            ElementKind::ConstraintDef, ElementKind::ConstraintUsage,
            ElementKind::RequirementDef, ElementKind::RequirementUsage,
            ElementKind::FlowDef, ElementKind::FlowUsage,
            // New kinds
            ElementKind::MessageUsage, ElementKind::CaseUsage,
            ElementKind::StepUsage, ElementKind::ExprUsage,
            ElementKind::ClassifierUsage, ElementKind::MetaclassUsage,
            ElementKind::ReturnUsage, ElementKind::FrameUsage,
            ElementKind::ClassUsage, ElementKind::StructUsage,
            ElementKind::AssocUsage, ElementKind::DataTypeUsage,
            ElementKind::BehaviorUsage, ElementKind::ConnectorUsage,
            ElementKind::TypeUsage,
        ];

        for kind in all_kinds {
            let _ = element_kind_to_category(&kind); // should not panic
        }
    }

    #[test]
    fn test_new_kinds_correct_categories() {
        assert_eq!(element_kind_to_category(&ElementKind::MessageUsage), Category::Interface);
        assert_eq!(element_kind_to_category(&ElementKind::ConnectorUsage), Category::Interface);
        assert_eq!(element_kind_to_category(&ElementKind::StepUsage), Category::Behavior);
        assert_eq!(element_kind_to_category(&ElementKind::BehaviorUsage), Category::Behavior);
        assert_eq!(element_kind_to_category(&ElementKind::CaseUsage), Category::Behavior);
        assert_eq!(element_kind_to_category(&ElementKind::ExprUsage), Category::Property);
        assert_eq!(element_kind_to_category(&ElementKind::ReturnUsage), Category::Property);
        assert_eq!(element_kind_to_category(&ElementKind::ClassUsage), Category::Structure);
        assert_eq!(element_kind_to_category(&ElementKind::StructUsage), Category::Structure);
        assert_eq!(element_kind_to_category(&ElementKind::TypeUsage), Category::Structure);
        assert_eq!(element_kind_to_category(&ElementKind::FrameUsage), Category::Auxiliary);
    }
}
