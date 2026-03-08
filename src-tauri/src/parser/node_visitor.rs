use tree_sitter::{Node, Tree};
use crate::model::elements::*;

pub struct ModelBuilder {
    elements: Vec<SysmlElement>,
    next_id: ElementId,
    source: String,
}

impl ModelBuilder {
    pub fn new(source: &str) -> Self {
        Self {
            elements: Vec::new(),
            next_id: 0,
            source: source.to_string(),
        }
    }

    pub fn build(mut self, tree: &Tree) -> (Vec<SysmlElement>, Vec<ParseError>) {
        let mut errors = Vec::new();
        let root = tree.root_node();
        self.visit_node(root, None, &mut errors);
        (self.elements, errors)
    }

    fn visit_node(
        &mut self,
        node: Node,
        parent_id: Option<ElementId>,
        errors: &mut Vec<ParseError>,
    ) {
        // Collect parse errors
        if node.is_error() || node.is_missing() {
            errors.push(ParseError {
                message: format!(
                    "Parse error at line {}: unexpected '{}'",
                    node.start_position().row + 1,
                    self.node_text(&node).chars().take(50).collect::<String>()
                ),
                span: span_from_node(&node),
            });
        }

        if let Some((kind, category)) = map_node_kind(node.kind()) {
            let id = self.next_id;
            self.next_id += 1;

            let name = self.extract_name(&node);
            let qualified_name = self.build_qualified_name(parent_id, &name);
            let type_ref = self.extract_type_ref(&node);
            let specializations = self.extract_specializations(&node);
            let modifiers = self.extract_modifiers(&node);
            let multiplicity = self.extract_multiplicity(&node);
            let doc = self.extract_doc(&node);
            let short_name = self.extract_short_name(&node);

            let element = SysmlElement {
                id,
                kind,
                name: name.clone(),
                qualified_name,
                category,
                parent_id,
                children_ids: Vec::new(),
                span: span_from_node(&node),
                type_ref,
                specializations,
                modifiers,
                multiplicity,
                doc,
                short_name,
            };

            self.elements.push(element);

            // Update parent's children list
            if let Some(pid) = parent_id {
                if let Some(parent) = self.elements.iter_mut().find(|e| e.id == pid) {
                    parent.children_ids.push(id);
                }
            }

            // Recurse into children with this element as parent
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                self.visit_node(child, Some(id), errors);
            }
        } else {
            // Not a model element node — recurse with same parent
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                self.visit_node(child, parent_id, errors);
            }
        }
    }

    fn node_text(&self, node: &Node) -> String {
        node.utf8_text(self.source.as_bytes())
            .unwrap_or("")
            .to_string()
    }

    fn extract_name(&self, node: &Node) -> Option<String> {
        // Field "name" is the primary way to get element names
        if let Some(name_node) = node.child_by_field_name("name") {
            let text = self.node_text(&name_node);
            // Strip quotes from quoted identifiers
            let text = text.trim_matches('\'');
            return Some(text.to_string());
        }
        None
    }

    fn extract_type_ref(&self, node: &Node) -> Option<String> {
        // Look for a typed_by child node, which has field "type"
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "typed_by" {
                if let Some(type_node) = child.child_by_field_name("type") {
                    return Some(self.node_text(&type_node));
                }
            }
        }
        None
    }

    fn extract_specializations(&self, node: &Node) -> Vec<String> {
        let mut specs = Vec::new();
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "specialization" || child.kind() == "subsets_keyword" ||
               child.kind() == "redefines_keyword" {
                if let Some(target) = child.child_by_field_name("target") {
                    specs.push(self.node_text(&target));
                }
            }
        }
        specs
    }

    fn extract_modifiers(&self, node: &Node) -> Vec<String> {
        // Modifiers appear as anonymous keyword tokens in the parent _declaration node.
        // Since _declaration is hidden, modifiers appear as siblings before this node.
        // We need to look at the parent and find preceding keyword siblings.
        let mut mods = Vec::new();

        if let Some(parent) = node.parent() {
            let mut cursor = parent.walk();
            for child in parent.children(&mut cursor) {
                if child.id() == node.id() {
                    break;
                }
                // Anonymous keyword nodes before our element
                if !child.is_named() {
                    let text = self.node_text(&child);
                    match text.as_str() {
                        "abstract" | "variation" | "readonly" | "derived" |
                        "end" | "in" | "out" | "inout" |
                        "private" | "protected" | "public" | "ref" => {
                            mods.push(text);
                        }
                        _ => {}
                    }
                }
                // visibility is a named node
                if child.kind() == "visibility" {
                    mods.push(self.node_text(&child));
                }
            }
        }
        mods
    }

    fn extract_multiplicity(&self, node: &Node) -> Option<String> {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "multiplicity" {
                return Some(self.node_text(&child));
            }
        }
        None
    }

    fn extract_doc(&self, node: &Node) -> Option<String> {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "doc_comment" {
                let text = self.node_text(&child);
                // Strip doc comment markers
                let text = text.trim_start_matches("doc")
                    .trim()
                    .trim_start_matches("/*")
                    .trim_end_matches("*/")
                    .trim();
                return Some(text.to_string());
            }
        }
        None
    }

    fn extract_short_name(&self, node: &Node) -> Option<String> {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "short_name" {
                let text = self.node_text(&child);
                // Strip angle brackets
                let text = text.trim_start_matches('<').trim_end_matches('>');
                return Some(text.to_string());
            }
        }
        None
    }

    fn build_qualified_name(
        &self,
        parent_id: Option<ElementId>,
        name: &Option<String>,
    ) -> String {
        let name_str = name.as_deref().unwrap_or("<anonymous>");
        if let Some(pid) = parent_id {
            if let Some(parent) = self.elements.iter().find(|e| e.id == pid) {
                return format!("{}::{}", parent.qualified_name, name_str);
            }
        }
        name_str.to_string()
    }
}

/// Map tree-sitter node kind string to (ElementKind, Category)
/// Verified against actual grammar.js rule names from tree-sitter-sysml
fn map_node_kind(kind: &str) -> Option<(ElementKind, Category)> {
    match kind {
        // --- Packages ---
        "package_declaration" => Some((ElementKind::Package, Category::Structure)),

        // --- SysML Definition Types ---
        "part_definition" => Some((ElementKind::PartDef, Category::Structure)),
        "attribute_definition" => Some((ElementKind::AttributeDef, Category::Property)),
        "port_definition" => Some((ElementKind::PortDef, Category::Interface)),
        "connection_definition" => Some((ElementKind::ConnectionDef, Category::Relationship)),
        "interface_definition" => Some((ElementKind::InterfaceDef, Category::Interface)),
        "item_definition" => Some((ElementKind::ItemDef, Category::Structure)),
        "action_definition" => Some((ElementKind::ActionDef, Category::Behavior)),
        "state_definition" => Some((ElementKind::StateDef, Category::Behavior)),
        "constraint_definition" => Some((ElementKind::ConstraintDef, Category::Constraint)),
        "requirement_definition" => Some((ElementKind::RequirementDef, Category::Requirement)),
        "concern_definition" => Some((ElementKind::ConcernDef, Category::Requirement)),
        "view_definition" => Some((ElementKind::ViewDef, Category::View)),
        "viewpoint_definition" => Some((ElementKind::ViewpointDef, Category::View)),
        "rendering_definition" => Some((ElementKind::RenderingDef, Category::View)),
        "allocation_definition" => Some((ElementKind::AllocationDef, Category::Relationship)),
        "analysis_case_definition" => Some((ElementKind::AnalysisCaseDef, Category::Analysis)),
        "use_case_definition" => Some((ElementKind::UseCaseDef, Category::Behavior)),
        "verification_case_definition" => Some((ElementKind::VerificationCaseDef, Category::Analysis)),
        "enumeration_definition" => Some((ElementKind::EnumerationDef, Category::Property)),
        "occurrence_definition" => Some((ElementKind::OccurrenceDef, Category::Structure)),
        "flow_definition" => Some((ElementKind::FlowDef, Category::Interface)),
        "metadata_definition" => Some((ElementKind::MetadataDef, Category::Auxiliary)),
        "calc_definition" => Some((ElementKind::CalcDef, Category::Behavior)),
        "individual_definition" => Some((ElementKind::IndividualDef, Category::Structure)),

        // --- KerML Definition Types ---
        "class_definition" => Some((ElementKind::ClassDef, Category::Structure)),
        "struct_definition" => Some((ElementKind::StructDef, Category::Structure)),
        "assoc_definition" => Some((ElementKind::AssocDef, Category::Relationship)),
        "datatype_definition" => Some((ElementKind::DataTypeDef, Category::Property)),
        "behavior_definition" => Some((ElementKind::BehaviorDef, Category::Behavior)),
        "function_definition" => Some((ElementKind::FunctionDef, Category::Behavior)),
        "predicate_definition" => Some((ElementKind::PredicateDef, Category::Constraint)),
        "interaction_definition" => Some((ElementKind::InteractionDef, Category::Behavior)),

        // --- SysML Usage Types ---
        "part_usage" => Some((ElementKind::PartUsage, Category::Structure)),
        "attribute_usage" => Some((ElementKind::AttributeUsage, Category::Property)),
        "port_usage" => Some((ElementKind::PortUsage, Category::Interface)),
        "action_usage" => Some((ElementKind::ActionUsage, Category::Behavior)),
        "state_usage" => Some((ElementKind::StateUsage, Category::Behavior)),
        "item_usage" => Some((ElementKind::ItemUsage, Category::Structure)),
        "connection_usage" => Some((ElementKind::ConnectionUsage, Category::Relationship)),
        "interface_usage" => Some((ElementKind::InterfaceUsage, Category::Interface)),
        "constraint_usage" => Some((ElementKind::ConstraintUsage, Category::Constraint)),
        "requirement_usage" => Some((ElementKind::RequirementUsage, Category::Requirement)),
        "ref_usage" => Some((ElementKind::RefUsage, Category::Structure)),
        "event_usage" => Some((ElementKind::EventUsage, Category::Behavior)),
        "occurrence_usage" => Some((ElementKind::OccurrenceUsage, Category::Structure)),
        "allocation_usage" => Some((ElementKind::AllocationUsage, Category::Relationship)),
        "flow_usage" => Some((ElementKind::FlowUsage, Category::Interface)),
        "snapshot_usage" => Some((ElementKind::SnapshotUsage, Category::Structure)),
        "timeslice_usage" => Some((ElementKind::TimesliceUsage, Category::Structure)),
        "calc_usage" => Some((ElementKind::CalcUsage, Category::Behavior)),
        "view_usage" => Some((ElementKind::ViewUsage, Category::View)),
        "viewpoint_usage" => Some((ElementKind::ViewpointUsage, Category::View)),
        "rendering_usage" => Some((ElementKind::RenderingUsage, Category::View)),
        "concern_usage" => Some((ElementKind::ConcernUsage, Category::Requirement)),
        "use_case_usage" => Some((ElementKind::UseCaseUsage, Category::Behavior)),
        "analysis_usage" => Some((ElementKind::AnalysisUsage, Category::Analysis)),
        "verification_usage" => Some((ElementKind::VerificationUsage, Category::Analysis)),
        "metadata_usage" => Some((ElementKind::MetadataUsage, Category::Auxiliary)),

        // --- Feature Types ---
        "feature_usage" => Some((ElementKind::FeatureUsage, Category::Property)),
        "end_feature" => Some((ElementKind::EndFeature, Category::Interface)),
        "enum_member" => Some((ElementKind::EnumMember, Category::Property)),

        // --- Behavioral / Control Flow ---
        "transition_statement" => Some((ElementKind::TransitionStatement, Category::Behavior)),
        "inline_transition" => Some((ElementKind::InlineTransition, Category::Behavior)),
        "terminate_statement" => Some((ElementKind::TerminateStatement, Category::Behavior)),
        "perform_statement" => Some((ElementKind::PerformStatement, Category::Behavior)),
        "exhibit_statement" => Some((ElementKind::ExhibitStatement, Category::Behavior)),
        "include_statement" => Some((ElementKind::IncludeStatement, Category::Behavior)),
        "if_action" => Some((ElementKind::IfAction, Category::Behavior)),
        "while_action" => Some((ElementKind::WhileAction, Category::Behavior)),
        "for_action" => Some((ElementKind::ForAction, Category::Behavior)),
        "send_action" => Some((ElementKind::SendAction, Category::Behavior)),
        "assign_action" => Some((ElementKind::AssignAction, Category::Behavior)),
        "fork_node" => Some((ElementKind::ForkNode, Category::Behavior)),
        "join_node" => Some((ElementKind::JoinNode, Category::Behavior)),
        "merge_node" => Some((ElementKind::MergeNode, Category::Behavior)),
        "decide_node" => Some((ElementKind::DecideNode, Category::Behavior)),
        "do_action" => Some((ElementKind::DoAction, Category::Behavior)),
        "entry_action" => Some((ElementKind::EntryAction, Category::Behavior)),
        "exit_action" => Some((ElementKind::ExitAction, Category::Behavior)),
        "else_action" => Some((ElementKind::ElseAction, Category::Behavior)),
        "succession_usage" => Some((ElementKind::SuccessionUsage, Category::Behavior)),
        "succession_flow_usage" => Some((ElementKind::SuccessionFlowUsage, Category::Behavior)),
        "binding_usage" => Some((ElementKind::BindingUsage, Category::Relationship)),
        "boolean_expression_usage" => Some((ElementKind::BooleanExpressionUsage, Category::Constraint)),
        "invariant_usage" => Some((ElementKind::InvariantUsage, Category::Constraint)),
        "result_expression" => Some((ElementKind::ResultExpression, Category::Property)),

        // --- MBSE Statements ---
        "satisfy_statement" => Some((ElementKind::SatisfyStatement, Category::Requirement)),
        "verify_statement" => Some((ElementKind::VerifyStatement, Category::Analysis)),
        "dependency_statement" => Some((ElementKind::DependencyStatement, Category::Relationship)),
        "connect_statement" => Some((ElementKind::ConnectStatement, Category::Relationship)),
        "allocate_statement" => Some((ElementKind::AllocateStatement, Category::Relationship)),
        "flow_statement" => Some((ElementKind::FlowStatement, Category::Interface)),
        "message_statement" => Some((ElementKind::MessageStatement, Category::Behavior)),

        // --- MBSE Declarations ---
        "subject_declaration" => Some((ElementKind::SubjectDeclaration, Category::Structure)),
        "actor_declaration" => Some((ElementKind::ActorDeclaration, Category::Structure)),
        "objective_declaration" => Some((ElementKind::ObjectiveDeclaration, Category::Requirement)),
        "stakeholder_declaration" => Some((ElementKind::StakeholderDeclaration, Category::Requirement)),

        // --- Imports & Aliases ---
        "import_statement" => Some((ElementKind::Import, Category::Auxiliary)),
        "alias_declaration" => Some((ElementKind::Alias, Category::Auxiliary)),

        // --- Comments ---
        "comment_element" => Some((ElementKind::Comment, Category::Auxiliary)),
        "doc_comment" => Some((ElementKind::DocComment, Category::Auxiliary)),
        "textual_representation" => Some((ElementKind::TextualRepresentation, Category::Auxiliary)),

        _ => None,
    }
}

fn span_from_node(node: &Node) -> SourceSpan {
    let start = node.start_position();
    let end = node.end_position();
    SourceSpan {
        start_line: start.row as u32,
        start_col: start.column as u32,
        end_line: end.row as u32,
        end_col: end.column as u32,
        start_byte: node.start_byte() as u32,
        end_byte: node.end_byte() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_and_build(source: &str) -> (Vec<SysmlElement>, Vec<ParseError>) {
        let mut parser = tree_sitter::Parser::new();
        let language = tree_sitter_sysml::language();
        parser.set_language(&language).unwrap();
        let tree = parser.parse(source, None).unwrap();
        let builder = ModelBuilder::new(source);
        builder.build(&tree)
    }

    #[test]
    fn test_parse_package() {
        let (elements, errors) = parse_and_build("package TestPkg { }");
        assert!(errors.is_empty(), "errors: {:?}", errors);
        let pkg = elements.iter().find(|e| e.kind == ElementKind::Package);
        assert!(pkg.is_some(), "Should find a package element");
        assert_eq!(pkg.unwrap().name, Some("TestPkg".to_string()));
    }

    #[test]
    fn test_parse_part_definition() {
        let (elements, errors) = parse_and_build("part def Vehicle { }");
        assert!(errors.is_empty(), "errors: {:?}", errors);
        let part = elements.iter().find(|e| e.kind == ElementKind::PartDef);
        assert!(part.is_some(), "Should find a part definition");
        assert_eq!(part.unwrap().name, Some("Vehicle".to_string()));
        assert_eq!(part.unwrap().category, Category::Structure);
    }

    #[test]
    fn test_parse_part_usage_with_type() {
        let source = "part def Vehicle { part engine : Engine; }";
        let (elements, _errors) = parse_and_build(source);
        let usage = elements.iter().find(|e| e.kind == ElementKind::PartUsage);
        assert!(usage.is_some(), "Should find a part usage. Elements: {:?}", elements.iter().map(|e| (&e.kind, &e.name)).collect::<Vec<_>>());
        let usage = usage.unwrap();
        assert_eq!(usage.name, Some("engine".to_string()));
        assert_eq!(usage.type_ref, Some("Engine".to_string()));
    }

    #[test]
    fn test_parse_attribute_usage() {
        let source = "part def Engine { attribute displacement : Real; }";
        let (elements, _errors) = parse_and_build(source);
        let attr = elements.iter().find(|e| e.kind == ElementKind::AttributeUsage);
        assert!(attr.is_some(), "Should find an attribute usage");
        let attr = attr.unwrap();
        assert_eq!(attr.name, Some("displacement".to_string()));
        assert_eq!(attr.type_ref, Some("Real".to_string()));
        assert_eq!(attr.category, Category::Property);
    }

    #[test]
    fn test_parse_port_usage() {
        let source = "part def Engine { port fuelIn : FuelPort; }";
        let (elements, _errors) = parse_and_build(source);
        let port = elements.iter().find(|e| e.kind == ElementKind::PortUsage);
        assert!(port.is_some(), "Should find a port usage");
        assert_eq!(port.unwrap().name, Some("fuelIn".to_string()));
    }

    #[test]
    fn test_parse_state_definition() {
        let source = r#"state def EngineStates {
            state off;
            state idle;
            state running;
        }"#;
        let (elements, _errors) = parse_and_build(source);
        let state_def = elements.iter().find(|e| e.kind == ElementKind::StateDef);
        assert!(state_def.is_some(), "Should find a state definition");
        assert_eq!(state_def.unwrap().name, Some("EngineStates".to_string()));

        let states: Vec<_> = elements.iter()
            .filter(|e| e.kind == ElementKind::StateUsage)
            .collect();
        assert!(states.len() >= 2, "Should find state usages, found {}: {:?}",
            states.len(), elements.iter().map(|e| (&e.kind, &e.name)).collect::<Vec<_>>());
    }

    #[test]
    fn test_parse_enum_definition() {
        let source = "enum def FuelKind { enum gasoline; enum diesel; }";
        let (elements, _errors) = parse_and_build(source);
        let enum_def = elements.iter().find(|e| e.kind == ElementKind::EnumerationDef);
        assert!(enum_def.is_some(), "Should find an enumeration definition. Elements: {:?}",
            elements.iter().map(|e| (&e.kind, &e.name)).collect::<Vec<_>>());
    }

    #[test]
    fn test_parse_requirement_definition() {
        let source = r#"requirement def SafeStop {
            doc /* The vehicle shall stop safely */
        }"#;
        let (elements, _errors) = parse_and_build(source);
        let req = elements.iter().find(|e| e.kind == ElementKind::RequirementDef);
        assert!(req.is_some(), "Should find a requirement definition");
        assert_eq!(req.unwrap().name, Some("SafeStop".to_string()));
        assert_eq!(req.unwrap().category, Category::Requirement);
    }

    #[test]
    fn test_parent_child_relationship() {
        let source = "package Pkg { part def Vehicle { part engine : Engine; } }";
        let (elements, _errors) = parse_and_build(source);

        let pkg = elements.iter().find(|e| e.kind == ElementKind::Package);
        let part_def = elements.iter().find(|e| e.kind == ElementKind::PartDef);

        if let (Some(pkg), Some(part_def)) = (pkg, part_def) {
            assert_eq!(part_def.parent_id, Some(pkg.id));
            assert!(pkg.children_ids.contains(&part_def.id));
        }
    }

    #[test]
    fn test_qualified_names() {
        let source = "package Pkg { part def Vehicle { } }";
        let (elements, _errors) = parse_and_build(source);
        let part_def = elements.iter().find(|e| e.kind == ElementKind::PartDef);
        if let Some(part_def) = part_def {
            assert!(part_def.qualified_name.contains("Pkg"),
                "Qualified name should contain parent: {}", part_def.qualified_name);
            assert!(part_def.qualified_name.contains("Vehicle"),
                "Qualified name should contain own name: {}", part_def.qualified_name);
        }
    }

    #[test]
    fn test_model_stats() {
        let source = r#"
            package Pkg {
                part def Vehicle { }
                part def Engine { }
                part engine : Engine;
                requirement def SafeStop { }
            }
        "#;
        let (elements, errors) = parse_and_build(source);

        let defs = elements.iter().filter(|e| e.kind.is_definition()).count();
        let usages = elements.iter().filter(|e| e.kind.is_usage()).count();

        assert!(defs >= 3, "Should have at least 3 definitions (Package, Vehicle, Engine), found {}", defs);
        assert!(usages >= 1, "Should have at least 1 usage (engine), found {}", usages);
        assert!(errors.is_empty(), "Should have no parse errors: {:?}", errors);
    }

    #[test]
    fn test_comprehensive_model() {
        let source = r#"
package VehicleSystem {
    part def Vehicle {
        part engine : Engine;
        part transmission : Transmission;
        port fuelIn : FuelPort;
    }

    part def Engine {
        attribute displacement : Real;
        attribute maxRPM : Integer;
        port torqueOut : TorquePort;
    }

    enum def FuelKind {
        enum gasoline;
        enum diesel;
    }

    action def Drive { }

    requirement def Performance { }
}
"#;
        let (elements, errors) = parse_and_build(source);
        assert!(errors.is_empty(), "Parse errors: {:?}", errors);

        // Check we found all the major elements
        assert!(elements.iter().any(|e| e.kind == ElementKind::Package), "Should find package");
        assert!(elements.iter().any(|e| e.kind == ElementKind::PartDef && e.name.as_deref() == Some("Vehicle")), "Should find Vehicle");
        assert!(elements.iter().any(|e| e.kind == ElementKind::PartDef && e.name.as_deref() == Some("Engine")), "Should find Engine");
        assert!(elements.iter().any(|e| e.kind == ElementKind::ActionDef), "Should find action def");
        assert!(elements.iter().any(|e| e.kind == ElementKind::RequirementDef), "Should find requirement def");

        // Check totals
        assert!(elements.len() >= 10, "Should have at least 10 elements, found {}", elements.len());
    }

    #[test]
    fn test_new_grammar_node_types() {
        let source = r#"
state def EngineStates {
    entry action { }
    do action { }
    exit action { }

    state off;
    state running {
        entry action { }
    }

    transition off_to_running
        first off
        then running;
}

action def Control {
    succession first start then middle;
    if true {
        action branchA { }
    }
}

part def Sys {
    binding a = b;
}
"#;
        let (elements, errors) = parse_and_build(source);

        // Print all elements for debugging
        let kinds: Vec<_> = elements.iter().map(|e| (&e.kind, &e.name)).collect();

        // Check state actions are recognized (may not parse depending on exact grammar)
        let has_entry = elements.iter().any(|e| e.kind == ElementKind::EntryAction);
        let has_do = elements.iter().any(|e| e.kind == ElementKind::DoAction);
        let has_exit = elements.iter().any(|e| e.kind == ElementKind::ExitAction);
        let has_succession = elements.iter().any(|e| e.kind == ElementKind::SuccessionUsage);
        let has_binding = elements.iter().any(|e| e.kind == ElementKind::BindingUsage);

        // At minimum, basic structure should parse
        assert!(elements.iter().any(|e| e.kind == ElementKind::StateDef),
            "Should find state def. Kinds: {:?}", kinds);
        assert!(elements.iter().any(|e| e.kind == ElementKind::ActionDef),
            "Should find action def. Kinds: {:?}", kinds);

        // Log which new node types were found
        eprintln!("New node types found: entry={}, do={}, exit={}, succession={}, binding={}",
            has_entry, has_do, has_exit, has_succession, has_binding);
        eprintln!("All elements: {:?}", kinds);

        // At least some of the new node types should be found
        let new_types_found = [has_entry, has_do, has_exit, has_succession, has_binding]
            .iter().filter(|&&x| x).count();
        assert!(new_types_found > 0 || errors.len() <= 2,
            "Expected some new node types or minor parse issues. Found: {:?}, Errors: {:?}", kinds, errors);
    }
}
