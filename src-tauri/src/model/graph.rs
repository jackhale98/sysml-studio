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

    /// MBSE: Impact analysis — find all elements transitively affected by changes to given element
    pub fn impact_analysis(&self, id: ElementId) -> Vec<ElementId> {
        let mut visited = HashSet::new();
        let mut queue = vec![id];
        visited.insert(id);

        while let Some(current) = queue.pop() {
            // Follow outgoing containment, composition, type references
            for rel in self.outgoing_from(current) {
                if !visited.contains(&rel.to_id) {
                    visited.insert(rel.to_id);
                    queue.push(rel.to_id);
                }
            }
            // Also follow incoming type references (things that USE this element)
            for rel in self.incoming_to(current) {
                if matches!(rel.rel_type,
                    RelationshipType::TypeReference |
                    RelationshipType::Composition |
                    RelationshipType::Specialization
                ) && !visited.contains(&rel.from_id) {
                    visited.insert(rel.from_id);
                    queue.push(rel.from_id);
                }
            }
        }

        visited.remove(&id);
        visited.into_iter().collect()
    }

    /// MBSE: Get traceability chain for requirements
    /// Returns (satisfied_by, verified_by) element IDs
    pub fn requirement_traceability(&self, req_id: ElementId) -> (Vec<ElementId>, Vec<ElementId>) {
        let mut satisfied_by = Vec::new();
        let mut verified_by = Vec::new();

        for rel in self.incoming_to(req_id) {
            match rel.rel_type {
                RelationshipType::Satisfy => satisfied_by.push(rel.from_id),
                RelationshipType::Verify => verified_by.push(rel.from_id),
                _ => {}
            }
        }

        (satisfied_by, verified_by)
    }

    /// MBSE: Get all allocations from an element (outgoing)
    pub fn allocations_from(&self, id: ElementId) -> Vec<ElementId> {
        self.outgoing_from(id)
            .iter()
            .filter(|r| r.rel_type == RelationshipType::Allocation)
            .map(|r| r.to_id)
            .collect()
    }

    /// MBSE: Get all allocations to an element (incoming)
    pub fn allocations_to(&self, id: ElementId) -> Vec<ElementId> {
        self.incoming_to(id)
            .iter()
            .filter(|r| r.rel_type == RelationshipType::Allocation)
            .map(|r| r.from_id)
            .collect()
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
    fn test_connected_elements() {
        let parent = make_element(0, ElementKind::PartDef, "Vehicle", None);
        let child = make_element(1, ElementKind::PartUsage, "engine", Some(0));

        let elements = vec![parent, child];
        let graph = ElementGraph::build_from_model(&elements);

        let connected = graph.connected_elements(0);
        assert!(connected.contains(&1));
    }
}
