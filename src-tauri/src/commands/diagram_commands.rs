use serde::{Serialize, Deserialize};
use tauri::State;
use crate::commands::parse_commands::AppState;
use crate::model::elements::*;
use crate::model::graph::RelationshipType;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagramNode {
    pub element_id: ElementId,
    pub label: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub color: String,
    pub children: Vec<DiagramNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagramEdge {
    pub from_id: ElementId,
    pub to_id: ElementId,
    pub label: Option<String>,
    pub edge_type: String,
    pub points: Vec<(f64, f64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagramLayout {
    pub diagram_type: String,
    pub nodes: Vec<DiagramNode>,
    pub edges: Vec<DiagramEdge>,
    pub bounds: (f64, f64, f64, f64),
}

const NODE_WIDTH: f64 = 160.0;
const NODE_HEIGHT: f64 = 50.0;
const H_SPACING: f64 = 40.0;
const V_SPACING: f64 = 80.0;

/// Compute Block Definition Diagram layout
#[tauri::command]
pub fn compute_bdd_layout(
    root_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<DiagramLayout, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;
    let graph_lock = state.current_graph.lock().map_err(|e| e.to_string())?;
    let graph = graph_lock.as_ref().ok_or("No graph built")?;

    // Collect definition elements as nodes
    let definitions: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| e.kind.is_definition() && !matches!(e.kind,
            ElementKind::Package | ElementKind::EnumerationDef |
            ElementKind::ActionDef | ElementKind::StateDef |
            ElementKind::ConstraintDef | ElementKind::RequirementDef
        ))
        .filter(|e| {
            if let Some(ref root) = root_name {
                e.name.as_deref() == Some(root.as_str()) ||
                e.qualified_name.contains(root.as_str())
            } else {
                true
            }
        })
        .collect();

    let def_by_name: std::collections::HashMap<&str, ElementId> = definitions.iter()
        .filter_map(|d| d.name.as_deref().map(|n| (n, d.id)))
        .collect();

    // Build composition map: parent_def_id -> [(usage_name, child_def_name)]
    // Also create virtual nodes for unresolved type refs
    let mut composition_map: Vec<(ElementId, String, ElementId, String)> = Vec::new(); // (parent_id, usage_name, child_id, child_label)
    let mut virtual_nodes: Vec<(ElementId, String)> = Vec::new();
    let mut next_virtual_id: ElementId = u32::MAX;

    for el in &model.elements {
        if el.kind != ElementKind::PartUsage { continue; }
        let Some(parent_id) = el.parent_id else { continue; };

        // Find the parent definition
        let parent_def_id = if definitions.iter().any(|d| d.id == parent_id) {
            parent_id
        } else {
            // Walk up to find a definition parent
            model.elements.iter()
                .find(|p| p.id == parent_id)
                .and_then(|p| p.parent_id)
                .filter(|&pid| definitions.iter().any(|d| d.id == pid))
                .unwrap_or(parent_id)
        };

        if !definitions.iter().any(|d| d.id == parent_def_id) { continue; }

        let usage_name = el.name.clone().unwrap_or_default();

        if let Some(ref type_ref) = el.type_ref {
            if let Some(&child_id) = def_by_name.get(type_ref.as_str()) {
                if child_id != parent_def_id {
                    composition_map.push((parent_def_id, usage_name, child_id, type_ref.clone()));
                }
            } else {
                // Unresolved type ref — create virtual node
                let vid = next_virtual_id;
                next_virtual_id = next_virtual_id.wrapping_sub(1);
                virtual_nodes.push((vid, type_ref.clone()));
                composition_map.push((parent_def_id, usage_name, vid, type_ref.clone()));
            }
        } else if !usage_name.is_empty() {
            // No type ref — show the usage itself as a node
            let vid = next_virtual_id;
            next_virtual_id = next_virtual_id.wrapping_sub(1);
            virtual_nodes.push((vid, usage_name.clone()));
            composition_map.push((parent_def_id, usage_name, vid, String::new()));
        }
    }

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    // Determine which defs are children
    let child_ids: std::collections::HashSet<ElementId> =
        composition_map.iter().map(|c| c.2).collect();

    // Root definitions: not referenced as a child
    let root_defs: Vec<&&SysmlElement> = definitions.iter()
        .filter(|e| {
            !child_ids.contains(&e.id) && e.parent_id.map(|pid| {
                model.elements.iter().find(|p| p.id == pid)
                    .map(|p| matches!(p.kind, ElementKind::Package) || p.parent_id.is_none())
                    .unwrap_or(true)
            }).unwrap_or(true)
        })
        .collect();

    // Layout root definitions on top row
    for (i, def) in root_defs.iter().enumerate() {
        let x = i as f64 * (NODE_WIDTH + H_SPACING) + 20.0;
        let y = 30.0;
        nodes.push(DiagramNode {
            element_id: def.id,
            label: def.name.clone().unwrap_or_else(|| "<unnamed>".into()),
            kind: "block".into(),
            x, y, width: NODE_WIDTH, height: NODE_HEIGHT,
            color: kind_to_color(&def.kind),
            children: vec![],
        });
    }

    // Iteratively place children below their parents
    let mut placed_ids: std::collections::HashSet<ElementId> =
        nodes.iter().map(|n| n.element_id).collect();

    let mut layer = 1;
    let mut new_nodes_in_layer = true;

    while new_nodes_in_layer {
        new_nodes_in_layer = false;
        let mut col = 0;

        for (parent_id, _usage_name, child_id, child_label) in &composition_map {
            if placed_ids.contains(parent_id) && !placed_ids.contains(child_id) {
                let x = col as f64 * (NODE_WIDTH + H_SPACING) + 20.0;
                let y = layer as f64 * (NODE_HEIGHT + V_SPACING) + 30.0;

                let (label, color) = if let Some(def) = definitions.iter().find(|d| d.id == *child_id) {
                    (def.name.clone().unwrap_or_else(|| "<unnamed>".into()), kind_to_color(&def.kind))
                } else {
                    // Virtual node
                    (child_label.clone(), "#94a3b8".into())
                };

                nodes.push(DiagramNode {
                    element_id: *child_id,
                    label,
                    kind: "block".into(),
                    x, y, width: NODE_WIDTH, height: NODE_HEIGHT,
                    color,
                    children: vec![],
                });
                placed_ids.insert(*child_id);
                col += 1;
                new_nodes_in_layer = true;
            }
        }
        layer += 1;
        if layer > 10 { break; }
    }

    // Create composition edges
    for (parent_id, usage_name, child_id, _) in &composition_map {
        if placed_ids.contains(parent_id) && placed_ids.contains(child_id) {
            let from_node = nodes.iter().find(|n| n.element_id == *parent_id);
            let to_node = nodes.iter().find(|n| n.element_id == *child_id);

            if let (Some(from), Some(to)) = (from_node, to_node) {
                let from_center = (from.x + from.width / 2.0, from.y + from.height);
                let to_center = (to.x + to.width / 2.0, to.y);

                edges.push(DiagramEdge {
                    from_id: *parent_id,
                    to_id: *child_id,
                    label: if usage_name.is_empty() { None } else { Some(usage_name.clone()) },
                    edge_type: "composition".into(),
                    points: vec![from_center, to_center],
                });
            }
        }
    }

    // Create edges for specializations
    let specializations = graph.relationships_of_type(&RelationshipType::Specialization);
    for spec in specializations {
        if placed_ids.contains(&spec.from_id) && placed_ids.contains(&spec.to_id) {
            let from_node = nodes.iter().find(|n| n.element_id == spec.from_id);
            let to_node = nodes.iter().find(|n| n.element_id == spec.to_id);

            if let (Some(from), Some(to)) = (from_node, to_node) {
                let from_center = (from.x + from.width / 2.0, from.y);
                let to_center = (to.x + to.width / 2.0, to.y + to.height);

                edges.push(DiagramEdge {
                    from_id: spec.from_id,
                    to_id: spec.to_id,
                    label: None,
                    edge_type: "specialization".into(),
                    points: vec![from_center, to_center],
                });
            }
        }
    }

    // Compute bounds
    let min_x = nodes.iter().map(|n| n.x).fold(f64::MAX, f64::min);
    let min_y = nodes.iter().map(|n| n.y).fold(f64::MAX, f64::min);
    let max_x = nodes.iter().map(|n| n.x + n.width).fold(f64::MIN, f64::max);
    let max_y = nodes.iter().map(|n| n.y + n.height).fold(f64::MIN, f64::max);

    Ok(DiagramLayout {
        diagram_type: "bdd".into(),
        nodes,
        edges,
        bounds: (min_x, min_y, max_x, max_y),
    })
}

/// Compute State Machine Diagram layout
#[tauri::command]
pub fn compute_stm_layout(
    state_def_name: String,
    state: State<'_, AppState>,
) -> Result<DiagramLayout, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    // Find the state definition
    let state_def = model.elements.iter()
        .find(|e| e.kind == ElementKind::StateDef && e.name.as_deref() == Some(&state_def_name))
        .ok_or_else(|| format!("State definition '{}' not found", state_def_name))?;

    // Collect child states
    let states: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| e.kind == ElementKind::StateUsage && e.parent_id == Some(state_def.id))
        .collect();

    // Collect transitions
    let transitions: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| e.kind == ElementKind::TransitionStatement && e.parent_id == Some(state_def.id))
        .collect();

    // Layout states in a circular/grid pattern
    let state_count = states.len();
    let cols = ((state_count as f64).sqrt().ceil()) as usize;

    let mut nodes = Vec::new();
    let state_colors = ["#64748b", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#8b5cf6"];

    for (i, s) in states.iter().enumerate() {
        let col = i % cols.max(1);
        let row = i / cols.max(1);
        let x = col as f64 * (140.0 + H_SPACING) + 40.0;
        let y = row as f64 * (50.0 + V_SPACING) + 40.0;

        nodes.push(DiagramNode {
            element_id: s.id,
            label: s.name.clone().unwrap_or_else(|| "<unnamed>".into()),
            kind: "state".into(),
            x,
            y,
            width: 120.0,
            height: 44.0,
            color: state_colors[i % state_colors.len()].into(),
            children: vec![],
        });
    }

    // Create edges from transitions
    // Transitions typically reference source and target states
    let mut edges = Vec::new();
    for trans in &transitions {
        // Try to match transition source/target from name or context
        // For now, create edges based on the transition's children in the model
        if let Some(ref name) = trans.name {
            // Convention: transition names often encode from_to pattern
            let parts: Vec<&str> = name.split("_to_").collect();
            if parts.len() == 2 {
                let from_state = nodes.iter().find(|n| n.label == parts[0]);
                let to_state = nodes.iter().find(|n| n.label == parts[1]);

                if let (Some(from), Some(to)) = (from_state, to_state) {
                    let from_center = (from.x + from.width / 2.0, from.y + from.height / 2.0);
                    let to_center = (to.x + to.width / 2.0, to.y + to.height / 2.0);

                    edges.push(DiagramEdge {
                        from_id: from.element_id,
                        to_id: to.element_id,
                        label: Some(name.clone()),
                        edge_type: "transition".into(),
                        points: vec![from_center, to_center],
                    });
                }
            }
        }
    }

    let min_x = nodes.iter().map(|n| n.x).fold(f64::MAX, f64::min).min(0.0);
    let min_y = nodes.iter().map(|n| n.y).fold(f64::MAX, f64::min).min(0.0);
    let max_x = nodes.iter().map(|n| n.x + n.width).fold(f64::MIN, f64::max).max(0.0);
    let max_y = nodes.iter().map(|n| n.y + n.height).fold(f64::MIN, f64::max).max(0.0);

    Ok(DiagramLayout {
        diagram_type: "stm".into(),
        nodes,
        edges,
        bounds: (min_x, min_y, max_x, max_y),
    })
}

fn kind_to_color(kind: &ElementKind) -> String {
    match kind {
        ElementKind::PartDef | ElementKind::PartUsage => "#3b82f6".into(),
        ElementKind::AttributeDef | ElementKind::AttributeUsage => "#f59e0b".into(),
        ElementKind::PortDef | ElementKind::PortUsage => "#8b5cf6".into(),
        ElementKind::ActionDef | ElementKind::ActionUsage => "#10b981".into(),
        ElementKind::StateDef | ElementKind::StateUsage => "#38bdf8".into(),
        ElementKind::RequirementDef | ElementKind::RequirementUsage => "#ef4444".into(),
        ElementKind::ConnectionDef | ElementKind::ConnectionUsage => "#f472b6".into(),
        ElementKind::InterfaceDef | ElementKind::InterfaceUsage => "#a78bfa".into(),
        ElementKind::ItemDef | ElementKind::ItemUsage => "#6366f1".into(),
        ElementKind::ConstraintDef | ElementKind::ConstraintUsage => "#fb923c".into(),
        ElementKind::EnumerationDef => "#facc15".into(),
        _ => "#94a3b8".into(),
    }
}
