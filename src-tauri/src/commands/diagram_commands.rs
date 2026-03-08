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
    let all_defs: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| e.kind.is_definition() && !matches!(e.kind,
            ElementKind::Package | ElementKind::EnumerationDef |
            ElementKind::ActionDef | ElementKind::StateDef |
            ElementKind::ConstraintDef | ElementKind::RequirementDef
        ))
        .collect();

    // When scoped to a root, include the root + all types it references via part usages
    let definitions: Vec<&SysmlElement> = if let Some(ref root) = root_name {
        let root_el = all_defs.iter().find(|e| e.name.as_deref() == Some(root.as_str()));
        if let Some(root_el) = root_el {
            // Collect type_refs from child usages of the root
            let mut related_names: std::collections::HashSet<&str> = std::collections::HashSet::new();
            related_names.insert(root.as_str());
            for el in &model.elements {
                if el.parent_id == Some(root_el.id) {
                    if let Some(ref tref) = el.type_ref {
                        related_names.insert(tref.as_str());
                    }
                }
            }
            all_defs.iter()
                .filter(|e| e.name.as_deref().map(|n| related_names.contains(n)).unwrap_or(false))
                .copied()
                .collect()
        } else {
            all_defs
        }
    } else {
        all_defs
    };

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

    // Compute bounds (safe defaults for empty diagrams)
    let bounds = if nodes.is_empty() {
        (0.0, 0.0, 400.0, 300.0)
    } else {
        let min_x = nodes.iter().map(|n| n.x).fold(f64::MAX, f64::min);
        let min_y = nodes.iter().map(|n| n.y).fold(f64::MAX, f64::min);
        let max_x = nodes.iter().map(|n| n.x + n.width).fold(f64::MIN, f64::max);
        let max_y = nodes.iter().map(|n| n.y + n.height).fold(f64::MIN, f64::max);
        (min_x, min_y, max_x, max_y)
    };

    Ok(DiagramLayout {
        diagram_type: "bdd".into(),
        nodes,
        edges,
        bounds,
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

    // Create edges from transitions using parsed source/target data
    let mut edges = Vec::new();
    for trans in &transitions {
        let source_name = trans.specializations.first().map(|s| s.as_str());
        let target_name = trans.type_ref.as_deref();

        // Fall back to name splitting if parsed data is missing
        let (source_name, target_name) = match (source_name, target_name) {
            (Some(s), Some(t)) => (Some(s), Some(t)),
            _ => {
                // Legacy fallback: try splitting name on "_to_"
                if let Some(ref name) = trans.name {
                    let parts: Vec<&str> = name.split("_to_").collect();
                    if parts.len() == 2 {
                        (Some(parts[0]), Some(parts[1]))
                    } else {
                        (None, None)
                    }
                } else {
                    (None, None)
                }
            }
        };

        if let (Some(src), Some(tgt)) = (source_name, target_name) {
            let from_state = nodes.iter().find(|n| n.label == src);
            let to_state = nodes.iter().find(|n| n.label == tgt);

            if let (Some(from), Some(to)) = (from_state, to_state) {
                let from_center = (from.x + from.width / 2.0, from.y + from.height / 2.0);
                let to_center = (to.x + to.width / 2.0, to.y + to.height / 2.0);

                let label = trans.name.clone()
                    .unwrap_or_else(|| format!("{} → {}", src, tgt));

                edges.push(DiagramEdge {
                    from_id: from.element_id,
                    to_id: to.element_id,
                    label: Some(label),
                    edge_type: "transition".into(),
                    points: vec![from_center, to_center],
                });
            }
        }
    }

    let bounds = if nodes.is_empty() {
        (0.0, 0.0, 400.0, 300.0)
    } else {
        let min_x = nodes.iter().map(|n| n.x).fold(f64::MAX, f64::min).min(0.0);
        let min_y = nodes.iter().map(|n| n.y).fold(f64::MAX, f64::min).min(0.0);
        let max_x = nodes.iter().map(|n| n.x + n.width).fold(f64::MIN, f64::max).max(0.0);
        let max_y = nodes.iter().map(|n| n.y + n.height).fold(f64::MIN, f64::max).max(0.0);
        (min_x, min_y, max_x, max_y)
    };

    Ok(DiagramLayout {
        diagram_type: "stm".into(),
        nodes,
        edges,
        bounds,
    })
}

/// Compute Requirements Diagram layout
#[tauri::command]
pub fn compute_req_layout(
    state: State<'_, AppState>,
) -> Result<DiagramLayout, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;
    let graph_lock = state.current_graph.lock().map_err(|e| e.to_string())?;
    let graph = graph_lock.as_ref().ok_or("No graph built")?;

    let reqs: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| matches!(e.kind, ElementKind::RequirementDef | ElementKind::RequirementUsage))
        .collect();

    let req_h = 65.0;
    let gap_x = 50.0;
    let gap_y = 90.0;

    // Separate top-level vs nested requirements
    let top_reqs: Vec<&&SysmlElement> = reqs.iter()
        .filter(|r| {
            r.parent_id.map(|pid| {
                model.elements.iter().find(|e| e.id == pid)
                    .map(|p| !matches!(p.kind, ElementKind::RequirementDef | ElementKind::RequirementUsage))
                    .unwrap_or(true)
            }).unwrap_or(true)
        })
        .collect();

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    // Place top-level requirements in a column
    for (i, r) in top_reqs.iter().enumerate() {
        let label = r.name.clone().unwrap_or_else(|| "<unnamed>".into());
        let w = (label.len() as f64 * 8.0).max(160.0);
        nodes.push(DiagramNode {
            element_id: r.id,
            label,
            kind: "requirement".into(),
            x: 40.0,
            y: 30.0 + i as f64 * (req_h + gap_y),
            width: w, height: req_h,
            color: "#ef4444".into(),
            children: vec![],
        });
    }

    // Place nested requirements to the right
    for r in &reqs {
        if top_reqs.iter().any(|t| t.id == r.id) { continue; }
        if let Some(parent_node) = r.parent_id.and_then(|pid| nodes.iter().find(|n| n.element_id == pid)) {
            let px = parent_node.x + parent_node.width + gap_x;
            let py = parent_node.y;
            let sibling_count = nodes.iter().filter(|n| {
                let el = model.elements.iter().find(|e| e.id == n.element_id);
                el.map(|e| e.parent_id == r.parent_id && !top_reqs.iter().any(|t| t.id == e.id))
                    .unwrap_or(false)
            }).count();
            let label = r.name.clone().unwrap_or_else(|| "<unnamed>".into());
            let w = (label.len() as f64 * 8.0).max(150.0);
            let ny = py + sibling_count as f64 * (req_h + 20.0);

            edges.push(DiagramEdge {
                from_id: r.parent_id.unwrap(),
                to_id: r.id,
                label: Some("containment".into()),
                edge_type: "containment".into(),
                points: vec![
                    (px - gap_x, py + req_h / 2.0),
                    (px, ny + req_h / 2.0),
                ],
            });

            nodes.push(DiagramNode {
                element_id: r.id,
                label,
                kind: "requirement".into(),
                x: px, y: ny, width: w, height: req_h,
                color: "#f87171".into(),
                children: vec![],
            });
        }
    }

    // Add satisfy/verify edges from the graph
    // Collect new nodes first to avoid borrow conflicts
    let satisfies = graph.relationships_of_type(&RelationshipType::Satisfy);
    let verifies = graph.relationships_of_type(&RelationshipType::Verify);

    let mut new_nodes: Vec<DiagramNode> = Vec::new();
    let mut new_edges: Vec<DiagramEdge> = Vec::new();

    for rel in satisfies.iter().chain(verifies.iter()) {
        let req_node = nodes.iter().find(|n| n.element_id == rel.to_id);
        if req_node.is_none() { continue; }
        let req_pos = (req_node.unwrap().element_id, req_node.unwrap().x, req_node.unwrap().y, req_node.unwrap().width);

        let impl_el = model.elements.iter().find(|e| e.id == rel.from_id);
        if impl_el.is_none() { continue; }
        let impl_el = impl_el.unwrap();
        let label = impl_el.name.clone().unwrap_or_else(|| "<unnamed>".into());

        let impl_pos = if let Some(existing) = nodes.iter().chain(new_nodes.iter()).find(|n| n.element_id == rel.from_id) {
            (existing.element_id, existing.x, existing.y, existing.width)
        } else {
            let w = (label.len() as f64 * 8.0).max(140.0);
            let nx = req_pos.1 + req_pos.3 + gap_x * 2.0;
            let ny = req_pos.2;
            new_nodes.push(DiagramNode {
                element_id: impl_el.id,
                label: label.clone(),
                kind: "block".into(),
                x: nx, y: ny, width: w, height: req_h,
                color: kind_to_color(&impl_el.kind),
                children: vec![],
            });
            (impl_el.id, nx, ny, w)
        };

        let edge_type = if rel.rel_type == RelationshipType::Satisfy { "satisfy" } else { "verify" };
        new_edges.push(DiagramEdge {
            from_id: req_pos.0,
            to_id: impl_pos.0,
            label: Some(edge_type.into()),
            edge_type: edge_type.into(),
            points: vec![
                (req_pos.1 + req_pos.3, req_pos.2 + req_h / 2.0),
                (impl_pos.1, impl_pos.2 + req_h / 2.0),
            ],
        });
    }

    nodes.extend(new_nodes);
    edges.extend(new_edges);

    let bounds = if nodes.is_empty() {
        (0.0, 0.0, 400.0, 300.0)
    } else {
        (0.0, 0.0,
         nodes.iter().map(|n| n.x + n.width).fold(0.0_f64, f64::max).max(400.0),
         nodes.iter().map(|n| n.y + n.height).fold(0.0_f64, f64::max).max(300.0))
    };

    Ok(DiagramLayout { diagram_type: "req".into(), nodes, edges, bounds })
}

/// Compute Use Case Diagram layout
#[tauri::command]
pub fn compute_ucd_layout(
    state: State<'_, AppState>,
) -> Result<DiagramLayout, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    let use_cases: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| matches!(e.kind, ElementKind::UseCaseDef | ElementKind::UseCaseUsage))
        .collect();

    // If no use cases, fall back to action defs
    let actions: Vec<&SysmlElement> = if use_cases.is_empty() {
        model.elements.iter()
            .filter(|e| e.kind == ElementKind::ActionDef)
            .collect()
    } else {
        vec![]
    };
    let all_use_cases: Vec<&&SysmlElement> = use_cases.iter().chain(actions.iter()).collect();

    // Collect unique actor types from actor_declarations inside use cases
    // Each actor_declaration has type_ref pointing to the actor type (e.g., "Driver")
    let actor_decls: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| e.kind == ElementKind::ActorDeclaration)
        .collect();

    // Deduplicate actors by type_ref (or name if no type_ref)
    let mut actor_type_names: Vec<String> = Vec::new();
    let mut actor_type_ids: Vec<ElementId> = Vec::new();
    for ad in &actor_decls {
        let actor_label = ad.type_ref.as_deref()
            .or(ad.name.as_deref())
            .unwrap_or("<unnamed>");
        if !actor_type_names.contains(&actor_label.to_string()) {
            actor_type_names.push(actor_label.to_string());
            // Try to find the actual type element for the ID; fall back to the declaration ID
            let type_el = model.elements.iter()
                .find(|e| e.name.as_deref() == Some(actor_label));
            actor_type_ids.push(type_el.map(|e| e.id).unwrap_or(ad.id));
        }
    }

    // Also pick up part defs with "actor" in the name that aren't already covered
    for el in model.elements.iter() {
        if el.kind == ElementKind::PartDef {
            if let Some(ref name) = el.name {
                if name.to_lowercase().contains("actor") && !actor_type_ids.contains(&el.id) {
                    actor_type_names.push(name.clone());
                    actor_type_ids.push(el.id);
                }
            }
        }
    }

    let w_actor = 90.0;
    let h_actor = 110.0;
    let h_uc = 55.0;
    let gap = 30.0;

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    // Place actors on the left
    for (i, (label, &id)) in actor_type_names.iter().zip(actor_type_ids.iter()).enumerate() {
        nodes.push(DiagramNode {
            element_id: id,
            label: label.clone(),
            kind: "actor".into(),
            x: 30.0,
            y: 30.0 + i as f64 * (h_actor + gap),
            width: w_actor, height: h_actor,
            color: "#94a3b8".into(),
            children: vec![],
        });
    }

    // Place use cases on the right
    let uc_start_x = if actor_type_names.is_empty() { 60.0 } else { 30.0 + w_actor + gap * 2.0 };
    for (i, uc) in all_use_cases.iter().enumerate() {
        let label = uc.name.clone().unwrap_or_else(|| "<unnamed>".into());
        let w = (label.len() as f64 * 8.0).max(130.0);
        nodes.push(DiagramNode {
            element_id: uc.id,
            label,
            kind: "usecase".into(),
            x: uc_start_x,
            y: 30.0 + i as f64 * (h_uc + gap),
            width: w, height: h_uc,
            color: "#10b981".into(),
            children: vec![],
        });
    }

    // Connect actors to their use cases based on actor_declarations
    for ad in &actor_decls {
        let actor_label = ad.type_ref.as_deref()
            .or(ad.name.as_deref())
            .unwrap_or("");
        let actor_node = nodes.iter().find(|n| n.kind == "actor" && n.label == actor_label);
        // The actor_declaration's parent is the use case it belongs to
        let uc_node = ad.parent_id.and_then(|pid| nodes.iter().find(|n| n.element_id == pid));

        if let (Some(from), Some(to)) = (actor_node, uc_node) {
            edges.push(DiagramEdge {
                from_id: from.element_id,
                to_id: to.element_id,
                label: None,
                edge_type: "association".into(),
                points: vec![
                    (from.x + from.width, from.y + from.height / 2.0),
                    (to.x, to.y + to.height / 2.0),
                ],
            });
        }
    }

    // Include relationships
    let includes = model.elements.iter()
        .filter(|e| e.kind == ElementKind::IncludeStatement);
    for inc in includes {
        if let (Some(pid), Some(ref tref)) = (inc.parent_id, &inc.type_ref) {
            let target = nodes.iter().find(|n| {
                model.elements.iter().find(|e| e.id == n.element_id)
                    .and_then(|e| e.name.as_deref())
                    .map(|name| name == tref.as_str())
                    .unwrap_or(false)
            });
            let from_node = nodes.iter().find(|n| n.element_id == pid);
            if let (Some(from), Some(to)) = (from_node, target) {
                edges.push(DiagramEdge {
                    from_id: from.element_id,
                    to_id: to.element_id,
                    label: Some("include".into()),
                    edge_type: "include".into(),
                    points: vec![
                        (from.x + from.width / 2.0, from.y + from.height),
                        (to.x + to.width / 2.0, to.y),
                    ],
                });
            }
        }
    }

    let bounds = if nodes.is_empty() {
        (0.0, 0.0, 400.0, 300.0)
    } else {
        (0.0, 0.0,
         nodes.iter().map(|n| n.x + n.width).fold(0.0_f64, f64::max).max(400.0),
         nodes.iter().map(|n| n.y + n.height).fold(0.0_f64, f64::max).max(300.0))
    };

    Ok(DiagramLayout { diagram_type: "ucd".into(), nodes, edges, bounds })
}

/// Compute Internal Block Diagram layout
#[tauri::command]
pub fn compute_ibd_layout(
    block_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<DiagramLayout, String> {
    let model_lock = state.current_model.lock().map_err(|e| e.to_string())?;
    let model = model_lock.as_ref().ok_or("No model loaded")?;

    // Find the block to display internals for
    let block = if let Some(ref name) = block_name {
        model.elements.iter().find(|e| e.kind == ElementKind::PartDef && e.name.as_deref() == Some(name.as_str()))
    } else {
        model.elements.iter().find(|e| e.kind == ElementKind::PartDef)
    };

    let block = match block {
        Some(b) => b,
        None => return Ok(DiagramLayout {
            diagram_type: "ibd".into(), nodes: vec![], edges: vec![],
            bounds: (0.0, 0.0, 400.0, 300.0),
        }),
    };

    // Get child parts and ports
    let children: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| e.parent_id == Some(block.id) && matches!(e.kind,
            ElementKind::PartUsage | ElementKind::AttributeUsage | ElementKind::ItemUsage))
        .collect();

    let ports: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| e.parent_id == Some(block.id) && e.kind == ElementKind::PortUsage)
        .collect();

    let part_w = 140.0;
    let part_h = 50.0;
    let port_size = 16.0;
    let margin = 40.0;

    let cols = ((children.len() as f64).sqrt().ceil()) as usize;
    let rows = if cols > 0 { children.len().div_ceil(cols) } else { 1 };
    let container_w = cols.max(1) as f64 * (part_w + margin) + margin;
    let container_h = rows as f64 * (part_h + margin) + margin + 30.0;

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    // Container block
    nodes.push(DiagramNode {
        element_id: block.id,
        label: block.name.clone().unwrap_or_else(|| "<unnamed>".into()),
        kind: "block_container".into(),
        x: 20.0, y: 20.0,
        width: container_w, height: container_h,
        color: "#3b82f6".into(),
        children: vec![],
    });

    // Child parts
    for (i, child) in children.iter().enumerate() {
        let col = i % cols.max(1);
        let row = i / cols.max(1);
        let x = 20.0 + margin + col as f64 * (part_w + margin);
        let y = 20.0 + 30.0 + margin + row as f64 * (part_h + margin);

        nodes.push(DiagramNode {
            element_id: child.id,
            label: child.name.clone().unwrap_or_else(|| "<unnamed>".into()),
            kind: "part".into(),
            x, y, width: part_w, height: part_h,
            color: kind_to_color(&child.kind),
            children: vec![],
        });
    }

    // Ports on the container boundary
    for (i, port) in ports.iter().enumerate() {
        let x = 20.0 + (i as f64 + 1.0) * container_w / (ports.len() as f64 + 1.0) - port_size / 2.0;
        let y = 20.0 + container_h - port_size / 2.0;

        nodes.push(DiagramNode {
            element_id: port.id,
            label: port.name.clone().unwrap_or_else(|| "<unnamed>".into()),
            kind: "port".into(),
            x, y, width: port_size, height: port_size,
            color: "#8b5cf6".into(),
            children: vec![],
        });
    }

    // Connection edges between parts
    let connections: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| matches!(e.kind, ElementKind::ConnectionUsage | ElementKind::InterfaceUsage))
        .filter(|e| e.parent_id == Some(block.id) || {
            e.parent_id.map(|pid| model.elements.iter().any(|p| p.id == pid && p.parent_id == Some(block.id)))
                .unwrap_or(false)
        })
        .collect();

    for conn in &connections {
        if let Some(ref type_ref) = conn.type_ref {
            // Try to find source (parent) and target (type_ref) among placed nodes
            if let (Some(from_id), Some(to_node)) = (
                conn.parent_id,
                nodes.iter().find(|n| n.label == *type_ref)
            ) {
                if let Some(from_node) = nodes.iter().find(|n| n.element_id == from_id) {
                    edges.push(DiagramEdge {
                        from_id: from_node.element_id,
                        to_id: to_node.element_id,
                        label: conn.name.clone(),
                        edge_type: "connection".into(),
                        points: vec![
                            (from_node.x + from_node.width / 2.0, from_node.y + from_node.height),
                            (to_node.x + to_node.width / 2.0, to_node.y),
                        ],
                    });
                }
            }
        }
    }

    let bounds = (0.0, 0.0,
        (20.0 + container_w + 20.0).max(400.0),
        (20.0 + container_h + 20.0).max(300.0));

    Ok(DiagramLayout { diagram_type: "ibd".into(), nodes, edges, bounds })
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
        ElementKind::ConstraintDef | ElementKind::ConstraintUsage |
            ElementKind::BooleanExpressionUsage | ElementKind::InvariantUsage => "#fb923c".into(),
        ElementKind::EnumerationDef => "#facc15".into(),
        ElementKind::BindingUsage | ElementKind::SuccessionUsage |
            ElementKind::SuccessionFlowUsage => "#f472b6".into(),
        _ => "#94a3b8".into(),
    }
}
