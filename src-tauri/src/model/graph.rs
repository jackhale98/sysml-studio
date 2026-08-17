use std::collections::{HashMap, HashSet};
use serde::{Serialize, Deserialize};
use super::elements::*;

/// Types of relationships in the model graph
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RelationshipType {
    /// Parent-child containment
    Containment,
    /// Type reference (typed by)
    TypeReference,
    /// Specialization (:>)
    Specialization,
    /// Redefinition (:>>)
    Redefinition,
    /// Composition (part usage inside definition)
    Composition,
    /// Connection between ports/parts
    Connection,
    /// Flow between elements
    Flow,
    /// Allocation (logical → physical)
    Allocation,
    /// Satisfy (design satisfies requirement)
    Satisfy,
    /// Verify (verification verifies requirement)
    Verify,
    /// Dependency
    Dependency,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relationship {
    pub from_id: ElementId,
    pub to_id: ElementId,
    pub rel_type: RelationshipType,
    pub label: Option<String>,
}

/// Graph for element relationships — central to MBSE traceability
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ElementGraph {
    pub relationships: Vec<Relationship>,
    /// Index: element_id → outgoing relationship indices
    outgoing: HashMap<ElementId, Vec<usize>>,
    /// Index: element_id → incoming relationship indices
    incoming: HashMap<ElementId, Vec<usize>>,
}

impl ElementGraph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn build_from_model(elements: &[SysmlElement]) -> Self {
        let mut graph = Self::new();

        for el in elements {
            // Containment relationships
            if let Some(parent_id) = el.parent_id {
                graph.add_relationship(Relationship {
                    from_id: parent_id,
                    to_id: el.id,
                    rel_type: RelationshipType::Containment,
                    label: None,
                });
            }

            // Type references create TypeReference edges
            if let Some(ref type_name) = el.type_ref {
                // Find the definition this references
                if let Some(target) = elements.iter().find(|e| {
                    e.name.as_deref() == Some(type_name.as_str()) && e.kind.is_definition()
                }) {
                    let rel_type = if el.kind == ElementKind::PartUsage {
                        RelationshipType::Composition
                    } else {
                        RelationshipType::TypeReference
                    };
                    graph.add_relationship(Relationship {
                        from_id: el.id,
                        to_id: target.id,
                        rel_type,
                        label: el.name.clone(),
                    });
                }
            }

            // Specialization relationships
            for spec_target in &el.specializations {
                if let Some(target) = elements.iter().find(|e| {
                    e.name.as_deref() == Some(spec_target.as_str())
                }) {
                    graph.add_relationship(Relationship {
                        from_id: el.id,
                        to_id: target.id,
                        rel_type: RelationshipType::Specialization,
                        label: None,
                    });
                }
            }

            // Satisfy statements link to requirements
            if el.kind == ElementKind::SatisfyStatement {
                if let (Some(parent_id), Some(ref type_ref)) = (el.parent_id, &el.type_ref) {
                    if let Some(req) = elements.iter().find(|e| {
                        e.name.as_deref() == Some(type_ref.as_str())
                    }) {
                        graph.add_relationship(Relationship {
                            from_id: parent_id,
                            to_id: req.id,
                            rel_type: RelationshipType::Satisfy,
                            label: None,
                        });
                    }
                }
            }

            // Verify statements link verification to requirements
            if el.kind == ElementKind::VerifyStatement {
                if let (Some(parent_id), Some(ref type_ref)) = (el.parent_id, &el.type_ref) {
                    if let Some(req) = elements.iter().find(|e| {
                        e.name.as_deref() == Some(type_ref.as_str())
                    }) {
                        graph.add_relationship(Relationship {
                            from_id: parent_id,
                            to_id: req.id,
                            rel_type: RelationshipType::Verify,
                            label: None,
                        });
                    }
                }
            }

            // Connection relationships from connect statements and connection usages
            if (el.kind == ElementKind::ConnectStatement || el.kind == ElementKind::ConnectionUsage)
                && el.specializations.len() == 2
            {
                let source_name = &el.specializations[0];
                let target_name = &el.specializations[1];
                if let (Some(src), Some(tgt)) = (
                    elements.iter().find(|e| e.name.as_deref() == Some(source_name.as_str())),
                    elements.iter().find(|e| e.name.as_deref() == Some(target_name.as_str())),
                ) {
                    graph.add_relationship(Relationship {
                        from_id: src.id,
                        to_id: tgt.id,
                        rel_type: RelationshipType::Connection,
                        label: el.name.clone(),
                    });
                }
            }

            // Flow relationships from flow statements and flow usages
            if (el.kind == ElementKind::FlowStatement || el.kind == ElementKind::FlowUsage)
                && el.specializations.len() == 2
            {
                let source_name = &el.specializations[0];
                let target_name = &el.specializations[1];
                if let (Some(src), Some(tgt)) = (
                    elements.iter().find(|e| e.name.as_deref() == Some(source_name.as_str())),
                    elements.iter().find(|e| e.name.as_deref() == Some(target_name.as_str())),
                ) {
                    graph.add_relationship(Relationship {
                        from_id: src.id,
                        to_id: tgt.id,
                        rel_type: RelationshipType::Flow,
                        label: el.name.clone(),
                    });
                }
            }

            // Dependency relationships
            if el.kind == ElementKind::DependencyStatement
                && el.specializations.len() == 2
            {
                let source_name = &el.specializations[0];
                let target_name = &el.specializations[1];
                if let (Some(src), Some(tgt)) = (
                    elements.iter().find(|e| e.name.as_deref() == Some(source_name.as_str())),
                    elements.iter().find(|e| e.name.as_deref() == Some(target_name.as_str())),
                ) {
                    graph.add_relationship(Relationship {
                        from_id: src.id,
                        to_id: tgt.id,
                        rel_type: RelationshipType::Dependency,
                        label: el.name.clone(),
                    });
                }
            }

            // Allocation relationships
            if el.kind == ElementKind::AllocationUsage || el.kind == ElementKind::AllocateStatement {
                if let (Some(parent_id), Some(ref type_ref)) = (el.parent_id, &el.type_ref) {
                    if let Some(target) = elements.iter().find(|e| {
                        e.name.as_deref() == Some(type_ref.as_str())
                    }) {
                        graph.add_relationship(Relationship {
                            from_id: parent_id,
                            to_id: target.id,
                            rel_type: RelationshipType::Allocation,
                            label: el.name.clone(),
                        });
                    }
                }
            }
        }

        graph
    }

    fn add_relationship(&mut self, rel: Relationship) {
        let idx = self.relationships.len();
        self.outgoing.entry(rel.from_id).or_default().push(idx);
        self.incoming.entry(rel.to_id).or_default().push(idx);
        self.relationships.push(rel);
    }

    /// Get all relationships from an element
    pub fn outgoing_from(&self, id: ElementId) -> Vec<&Relationship> {
        self.outgoing.get(&id)
            .map(|indices| indices.iter().map(|&i| &self.relationships[i]).collect())
            .unwrap_or_default()
    }

    /// Get all relationships to an element
    pub fn incoming_to(&self, id: ElementId) -> Vec<&Relationship> {
        self.incoming.get(&id)
            .map(|indices| indices.iter().map(|&i| &self.relationships[i]).collect())
            .unwrap_or_default()
    }

    /// Get all directly connected element IDs (both directions)
    pub fn connected_elements(&self, id: ElementId) -> HashSet<ElementId> {
        let mut result = HashSet::new();
        for rel in self.outgoing_from(id) {
            result.insert(rel.to_id);
        }
        for rel in self.incoming_to(id) {
            result.insert(rel.from_id);
        }
        result
    }

    /// MBSE: impact analysis — what would be affected by a change to
    /// this element.
    ///
    /// This follows DEPENDENCY edges, not containment. Following
    /// containment outward made "impact of a package" the entire model,
    /// which answers nothing: the question is "what breaks if I change
    /// this", i.e. what refers to it (usages typed by it, subtypes,
    /// connections, satisfy/verify/allocation), transitively — plus,
    /// for a requirement, what claims to satisfy or verify it.
    pub fn impact_analysis(&self, id: ElementId) -> Vec<ElementId> {
        fn is_dependency(rel: &RelationshipType) -> bool {
            matches!(
                rel,
                RelationshipType::TypeReference
                    | RelationshipType::Specialization
                    | RelationshipType::Composition
                    | RelationshipType::Connection
                    | RelationshipType::Flow
                    | RelationshipType::Satisfy
                    | RelationshipType::Verify
                    | RelationshipType::Allocation
            )
        }

        let mut visited = HashSet::new();
        let mut queue = vec![id];
        visited.insert(id);

        while let Some(current) = queue.pop() {
            // Dependents: everything that refers to `current`.
            for rel in self.incoming_to(current) {
                if is_dependency(&rel.rel_type) && !visited.contains(&rel.from_id) {
                    visited.insert(rel.from_id);
                    queue.push(rel.from_id);
                }
            }
            // Outgoing trace edges: a requirement's satisfiers and
            // verifiers are affected when the requirement changes.
            for rel in self.outgoing_from(current) {
                if matches!(
                    rel.rel_type,
                    RelationshipType::Satisfy
                        | RelationshipType::Verify
                        | RelationshipType::Allocation
                ) && !visited.contains(&rel.to_id)
                {
                    visited.insert(rel.to_id);
                    queue.push(rel.to_id);
                }
            }
        }

        visited.remove(&id);
        let mut out: Vec<ElementId> = visited.into_iter().collect();
        out.sort_unstable();
        out
    }


    /// Get relationships of a specific type
    pub fn relationships_of_type(&self, rel_type: &RelationshipType) -> Vec<&Relationship> {
        self.relationships.iter()
            .filter(|r| &r.rel_type == rel_type)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_element(id: ElementId, kind: ElementKind, name: &str, parent_id: Option<ElementId>) -> SysmlElement {
        SysmlElement {
            id,
            kind,
            name: Some(name.to_string()),
            qualified_name: name.to_string(),
            category: Category::Structure,
            parent_id,
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
    fn test_containment_relationships() {
        let mut parent = make_element(0, ElementKind::PartDef, "Vehicle", None);
        parent.children_ids = vec![1];
        let mut child = make_element(1, ElementKind::PartUsage, "engine", Some(0));
        child.type_ref = Some("Engine".to_string());
        let target = make_element(2, ElementKind::PartDef, "Engine", None);

        let elements = vec![parent, child, target];
        let graph = ElementGraph::build_from_model(&elements);

        // Should have containment + composition relationships
        assert!(graph.relationships.len() >= 2);

        let containment: Vec<_> = graph.relationships_of_type(&RelationshipType::Containment);
        assert_eq!(containment.len(), 1);
        assert_eq!(containment[0].from_id, 0);
        assert_eq!(containment[0].to_id, 1);
    }

    #[test]
    fn test_impact_analysis() {
        let parent = make_element(0, ElementKind::PartDef, "Vehicle", None);
        let mut child = make_element(1, ElementKind::PartUsage, "engine", Some(0));
        child.type_ref = Some("Engine".to_string());
        let engine = make_element(2, ElementKind::PartDef, "Engine", None);

        let elements = vec![parent, child, engine];
        let graph = ElementGraph::build_from_model(&elements);

        // Impact of changing Engine def should include the part usage that references it
        let impact = graph.impact_analysis(2);
        assert!(impact.contains(&1), "engine usage should be impacted");
    }

    #[test]
    fn test_connection_edges_from_connect_statement() {
        // connect source.p1 to target.p2
        let source_part = make_element(0, ElementKind::PartDef, "Source", None);
        let target_part = make_element(1, ElementKind::PartDef, "Target", None);
        let mut connect = make_element(2, ElementKind::ConnectStatement, "conn1", None);
        connect.specializations = vec!["Source".to_string(), "Target".to_string()];

        let elements = vec![source_part, target_part, connect];
        let graph = ElementGraph::build_from_model(&elements);

        let conn_rels: Vec<_> = graph.relationships_of_type(&RelationshipType::Connection);
        assert_eq!(conn_rels.len(), 1, "Should have 1 connection relationship");
        assert_eq!(conn_rels[0].from_id, 0);
        assert_eq!(conn_rels[0].to_id, 1);
    }

    #[test]
    fn test_flow_edges_from_flow_statement() {
        let source_port = make_element(0, ElementKind::PortUsage, "outPort", None);
        let target_port = make_element(1, ElementKind::PortUsage, "inPort", None);
        let mut flow = make_element(2, ElementKind::FlowStatement, "flow1", None);
        flow.specializations = vec!["outPort".to_string(), "inPort".to_string()];

        let elements = vec![source_port, target_port, flow];
        let graph = ElementGraph::build_from_model(&elements);

        let flow_rels: Vec<_> = graph.relationships_of_type(&RelationshipType::Flow);
        assert_eq!(flow_rels.len(), 1, "Should have 1 flow relationship");
        assert_eq!(flow_rels[0].from_id, 0);
        assert_eq!(flow_rels[0].to_id, 1);
    }

    #[test]
    fn test_dependency_edges() {
        let source = make_element(0, ElementKind::PartDef, "Client", None);
        let target = make_element(1, ElementKind::PartDef, "Server", None);
        let mut dep = make_element(2, ElementKind::DependencyStatement, "dep1", None);
        dep.specializations = vec!["Client".to_string(), "Server".to_string()];

        let elements = vec![source, target, dep];
        let graph = ElementGraph::build_from_model(&elements);

        let dep_rels: Vec<_> = graph.relationships_of_type(&RelationshipType::Dependency);
        assert_eq!(dep_rels.len(), 1, "Should have 1 dependency relationship");
    }

    #[test]
    fn test_connected_elements() {
        let parent = make_element(0, ElementKind::PartDef, "Vehicle", None);
        let child = make_element(1, ElementKind::PartUsage, "engine", Some(0));

        let elements = vec![parent, child];
        let graph = ElementGraph::build_from_model(&elements);

        let connected = graph.connected_elements(0);
        assert!(connected.contains(&1));
    }
}
