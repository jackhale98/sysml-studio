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
    /// Stereotype text e.g. "«block»", "«requirement»"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stereotype: Option<String>,
    /// Compartment lines: parts, attributes, ports, etc.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub compartments: Vec<Compartment>,
    /// Extra text for requirement doc, state entry/do/exit, etc.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Compartment {
    pub heading: String,
    pub entries: Vec<String>,
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

const NODE_HEIGHT: f64 = 58.0;
const H_SPACING: f64 = 40.0;
const V_SPACING: f64 = 120.0;

fn estimate_text_width(text: &str, font_size: f64) -> f64 {
    (text.len() as f64 * font_size * 0.6).max(130.0)
}

/// Shorthand to create a DiagramNode with empty optional fields
#[allow(clippy::too_many_arguments)]
fn make_node(
    element_id: ElementId, label: String, kind: &str,
    x: f64, y: f64, width: f64, height: f64, color: &str,
) -> DiagramNode {
    DiagramNode {
        element_id, label, kind: kind.into(),
        x, y, width, height, color: color.into(),
        children: vec![], stereotype: None,
        compartments: vec![], description: None,
    }
}

/// BDD child entry: (usage_name, child_id, child_label, multiplicity)
type BddChildEntry = (String, ElementId, String, Option<String>);

/// Tree node for recursive BDD layout
struct BddTreeNode {
    id: ElementId,
    label: String,
    color: String,
    width: f64,
    height: f64,
    children: Vec<BddTreeNode>,
    usage_names: std::collections::HashMap<ElementId, String>,
    usage_mults: std::collections::HashMap<ElementId, Option<String>>,
    compartments: Vec<Compartment>,
}

fn subtree_pixel_width(tree: &BddTreeNode) -> f64 {
    if tree.children.is_empty() {
        return tree.width;
    }
    let child_widths: f64 = tree.children.iter().map(subtree_pixel_width).sum();
    let gaps = (tree.children.len() as f64 - 1.0).max(0.0) * H_SPACING;
    tree.width.max(child_widths + gaps)
}


fn position_tree(
    tree: &BddTreeNode,
    x: f64,
    y: f64,
    available_width: f64,
    nodes: &mut Vec<DiagramNode>,
    edges: &mut Vec<DiagramEdge>,
) {
    let node_x = x + (available_width - tree.width) / 2.0;
    let node_y = y;
    let h = tree.height;

    let mut node = make_node(tree.id, tree.label.clone(), "block", node_x, node_y, tree.width, h, &tree.color);
    node.stereotype = Some("\u{ab}block\u{bb}".into());
    node.compartments = tree.compartments.clone();
    nodes.push(node);

    if !tree.children.is_empty() {
        let child_pixel_widths: Vec<f64> = tree.children.iter().map(subtree_pixel_width).collect();
        let total_child_width: f64 = child_pixel_widths.iter().sum::<f64>()
            + (tree.children.len() as f64 - 1.0).max(0.0) * H_SPACING;
        let mut child_x = x + (available_width - total_child_width) / 2.0;

        for (ci, child) in tree.children.iter().enumerate() {
            let child_avail = child_pixel_widths[ci];
            position_tree(child, child_x, y + h + V_SPACING, child_avail, nodes, edges);

            let parent_cx = node_x + tree.width / 2.0;
            let child_node_w = child.width;
            let child_node_x = child_x + (child_avail - child_node_w) / 2.0;
            let child_cx = child_node_x + child_node_w / 2.0;
            let mid_y = node_y + h + V_SPACING * 0.45;

            let usage_name = tree.usage_names.get(&child.id).cloned();
            let mult = tree.usage_mults.get(&child.id).and_then(|m| m.clone());
            let label = match (usage_name, mult) {
                (Some(name), Some(m)) if !name.is_empty() => Some(format!("{} [{}]", name, m)),
                (Some(name), None) if !name.is_empty() => Some(name),
                (None, Some(m)) | (Some(_), Some(m)) => Some(format!("[{}]", m)),
                _ => None,
            };
            edges.push(DiagramEdge {
                from_id: tree.id,
                to_id: child.id,
                label,
                edge_type: "composition".into(),
                points: vec![
                    (parent_cx, node_y + h),
                    (parent_cx, mid_y),
                    (child_cx, mid_y),
                    (child_cx, y + h + V_SPACING),
                ],
            });

            child_x += child_avail + H_SPACING;
        }
    }
}

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

    // Collect definition elements (and top-level part usages that act as containers)
    let all_defs: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| {
            if e.kind.is_definition() && !matches!(e.kind,
                ElementKind::Package | ElementKind::EnumerationDef |
                ElementKind::ActionDef | ElementKind::StateDef |
                ElementKind::ConstraintDef | ElementKind::RequirementDef
            ) {
                return true;
            }
            // Include part usages that have child part usages (usage-centric files)
            if e.kind == ElementKind::PartUsage && e.type_ref.is_none() {
                return model.elements.iter().any(|c|
                    c.parent_id == Some(e.id) && c.kind == ElementKind::PartUsage
                );
            }
            false
        })
        .collect();

    // When scoped, include root + referenced types
    let definitions: Vec<&SysmlElement> = if let Some(ref root) = root_name {
        let root_el = all_defs.iter().find(|e| e.name.as_deref() == Some(root.as_str()));
        if let Some(root_el) = root_el {
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

    let mut def_by_name: std::collections::HashMap<String, (ElementId, String)> = definitions.iter()
        .filter_map(|d| d.name.as_ref().map(|n| (n.clone(), (d.id, kind_to_color(&d.kind)))))
        .collect();

    // Build parent→children map from part usages
    let mut children_of: std::collections::HashMap<ElementId, Vec<BddChildEntry>> =
        std::collections::HashMap::new(); // parent_id -> [(usage_name, child_id, child_label, multiplicity)]
    let mut has_parent: std::collections::HashSet<ElementId> = std::collections::HashSet::new();
    let mut next_virtual_id: ElementId = u32::MAX;

    for el in &model.elements {
        if el.kind != ElementKind::PartUsage { continue; }
        let Some(parent_id) = el.parent_id else { continue; };

        // Find the nearest ancestor definition (climb up the parent chain)
        let mut parent_def_id = parent_id;
        let mut climb_id = Some(parent_id);
        while let Some(cid) = climb_id {
            if definitions.iter().any(|d| d.id == cid) {
                parent_def_id = cid;
                break;
            }
            climb_id = model.elements.iter()
                .find(|p| p.id == cid)
                .and_then(|p| p.parent_id);
        }
        if !definitions.iter().any(|d| d.id == parent_def_id) { continue; }

        let usage_name = el.name.clone().unwrap_or_default();

        if let Some(ref type_ref) = el.type_ref {
            let mult = el.multiplicity.clone();
            let child_entry = if let Some(&(child_id, _)) = def_by_name.get(type_ref.as_str()) {
                if child_id == parent_def_id { continue; }
                (usage_name, child_id, type_ref.clone(), mult)
            } else {
                // Virtual node for unresolved type
                let vid = next_virtual_id;
                next_virtual_id = next_virtual_id.wrapping_sub(1);
                def_by_name.insert(type_ref.clone(), (vid, "#94a3b8".into()));
                (usage_name, vid, type_ref.clone(), mult)
            };
            has_parent.insert(child_entry.1);
            children_of.entry(parent_def_id).or_default().push(child_entry);
        } else if !usage_name.is_empty() {
            let vid = next_virtual_id;
            next_virtual_id = next_virtual_id.wrapping_sub(1);
            has_parent.insert(vid);
            children_of.entry(parent_def_id).or_default().push((usage_name.clone(), vid, usage_name, None));
        }
    }

    // Find root definitions (not referenced as children)
    let roots: Vec<&SysmlElement> = definitions.iter()
        .filter(|e| !has_parent.contains(&e.id))
        .copied()
        .collect();

    // Build tree recursively
    let mut visited: std::collections::HashSet<ElementId> = std::collections::HashSet::new();

    fn build_tree(
        id: ElementId,
        label: String,
        color: String,
        children_of: &std::collections::HashMap<ElementId, Vec<BddChildEntry>>,
        def_by_name: &std::collections::HashMap<String, (ElementId, String)>,
        visited: &mut std::collections::HashSet<ElementId>,
        elements: &[SysmlElement],
    ) -> BddTreeNode {
        visited.insert(id);
        let kids = children_of.get(&id).cloned().unwrap_or_default();
        let mut usage_names = std::collections::HashMap::new();
        let mut usage_mults = std::collections::HashMap::new();
        let mut child_trees = Vec::new();
        for (usage_name, child_id, child_label, mult) in kids {
            if visited.contains(&child_id) { continue; }
            let child_color = def_by_name.get(&child_label)
                .map(|(_, c)| c.clone())
                .unwrap_or_else(|| "#94a3b8".into());
            usage_names.insert(child_id, usage_name);
            usage_mults.insert(child_id, mult);
            child_trees.push(build_tree(child_id, child_label, child_color, children_of, def_by_name, visited, elements));
        }

        // Build compartments from child elements
        let mut compartments = Vec::new();
        let attrs: Vec<String> = elements.iter()
            .filter(|e| e.parent_id == Some(id) && e.kind == ElementKind::AttributeUsage)
            .map(|e| {
                let n = e.name.as_deref().unwrap_or("<unnamed>");
                match &e.type_ref {
                    Some(t) => format!("{} : {}", n, t),
                    None => n.to_string(),
                }
            })
            .collect();
        if !attrs.is_empty() {
            compartments.push(Compartment { heading: "attributes".into(), entries: attrs });
        }
        let ports: Vec<String> = elements.iter()
            .filter(|e| e.parent_id == Some(id) && e.kind == ElementKind::PortUsage)
            .map(|e| {
                let n = e.name.as_deref().unwrap_or("<unnamed>");
                let dir = e.modifiers.iter().find(|m| *m == "in" || *m == "out" || *m == "inout");
                match (&e.type_ref, dir) {
                    (Some(t), Some(d)) => format!("{} {} : {}", d, n, t),
                    (Some(t), None) => format!("{} : {}", n, t),
                    (None, Some(d)) => format!("{} {}", d, n),
                    (None, None) => n.to_string(),
                }
            })
            .collect();
        if !ports.is_empty() {
            compartments.push(Compartment { heading: "ports".into(), entries: ports });
        }

        // Compute width: max of label, compartment entries
        let label_w = estimate_text_width(&label, 13.0);
        let comp_max_w: f64 = compartments.iter()
            .flat_map(|c| c.entries.iter())
            .map(|e| estimate_text_width(e, 10.0))
            .fold(0.0_f64, f64::max);
        let width = label_w.max(comp_max_w + 20.0); // 20px padding

        // Compute height: base header + compartments
        let base_h = 34.0; // stereotype + name
        let comp_h: f64 = compartments.iter()
            .map(|c| 16.0 + c.entries.len() as f64 * 14.0) // heading + entries
            .sum();
        let height = (base_h + comp_h).max(NODE_HEIGHT);

        BddTreeNode { id, label, color, width, height, children: child_trees, usage_names, usage_mults, compartments }
    }

    let forest: Vec<BddTreeNode> = roots.iter().map(|r| {
        let label = r.name.clone().unwrap_or_else(|| "<unnamed>".into());
        let color = kind_to_color(&r.kind);
        build_tree(r.id, label, color, &children_of, &def_by_name, &mut visited, &model.elements)
    }).collect();

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    // Position each tree in the forest
    let mut forest_x = 20.0;
    for tree in &forest {
        let tw = subtree_pixel_width(tree);
        position_tree(tree, forest_x, 30.0, tw, &mut nodes, &mut edges);
        forest_x += tw + H_SPACING * 2.0;
    }

    // Place any unvisited definitions
    for d in &definitions {
        if !visited.contains(&d.id) {
            let label = d.name.clone().unwrap_or_else(|| "<unnamed>".into());
            let w = estimate_text_width(&label, 13.0);
            let mut node = make_node(d.id, label, "block", forest_x, 30.0, w, NODE_HEIGHT, &kind_to_color(&d.kind));
            node.stereotype = Some("\u{ab}block\u{bb}".into());
            nodes.push(node);
            forest_x += w + H_SPACING;
        }
    }

    // Specialization edges
    let placed_ids: std::collections::HashSet<ElementId> = nodes.iter().map(|n| n.element_id).collect();
    let specializations = graph.relationships_of_type(&RelationshipType::Specialization);
    for spec in specializations {
        if placed_ids.contains(&spec.from_id) && placed_ids.contains(&spec.to_id) {
            let from_node = nodes.iter().find(|n| n.element_id == spec.from_id);
            let to_node = nodes.iter().find(|n| n.element_id == spec.to_id);
            if let (Some(from), Some(to)) = (from_node, to_node) {
                edges.push(DiagramEdge {
                    from_id: spec.from_id, to_id: spec.to_id,
                    label: None, edge_type: "specialization".into(),
                    points: vec![
                        (from.x + from.width / 2.0, from.y),
                        (from.x + from.width / 2.0, from.y - 20.0),
                        (to.x + to.width / 2.0, to.y + to.height + 20.0),
                        (to.x + to.width / 2.0, to.y + to.height),
                    ],
                });
            }
        }
    }

    let bounds = if nodes.is_empty() {
        (0.0, 0.0, 400.0, 300.0)
    } else {
        let min_x = nodes.iter().map(|n| n.x).fold(f64::MAX, f64::min);
        let min_y = nodes.iter().map(|n| n.y).fold(f64::MAX, f64::min);
        let max_x = nodes.iter().map(|n| n.x + n.width).fold(f64::MIN, f64::max);
        let max_y = nodes.iter().map(|n| n.y + n.height).fold(f64::MIN, f64::max);
        (min_x, min_y, max_x, max_y)
    };

    Ok(DiagramLayout { diagram_type: "bdd".into(), nodes, edges, bounds })
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

    // Collect entry/do/exit actions for each state
    let mut state_actions: std::collections::HashMap<ElementId, Vec<String>> = std::collections::HashMap::new();
    for el in &model.elements {
        if !matches!(el.kind, ElementKind::ActionUsage) { continue; }
        if let Some(pid) = el.parent_id {
            if !states.iter().any(|s| s.id == pid) { continue; }
            let action_label = el.name.as_deref().unwrap_or("<action>");
            // Detect entry/do/exit from modifiers or name patterns
            let prefix = if el.modifiers.iter().any(|m| m == "entry") || action_label.starts_with("entry") {
                "entry / "
            } else if el.modifiers.iter().any(|m| m == "exit") || action_label.starts_with("exit") {
                "exit / "
            } else {
                "do / "
            };
            state_actions.entry(pid).or_default().push(format!("{}{}", prefix, action_label));
        }
    }

    // Layout states in a grid pattern, offset for initial pseudo-state
    let state_count = states.len();
    let cols = ((state_count as f64).sqrt().ceil()) as usize;

    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let state_colors = ["#64748b", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#8b5cf6"];
    let state_start_y = 80.0; // leave room for initial pseudo-state

    // Initial pseudo-state (filled circle)
    let initial_id = u32::MAX;
    let initial_x = 40.0 + (cols.max(1) as f64 * (140.0 + H_SPACING)) / 2.0 - 10.0;
    nodes.push(make_node(initial_id, String::new(), "initial_state", initial_x, 20.0, 20.0, 20.0, "#475569"));

    for (i, s) in states.iter().enumerate() {
        let col = i % cols.max(1);
        let row = i / cols.max(1);
        let x = col as f64 * (140.0 + H_SPACING) + 40.0;
        let y = row as f64 * (50.0 + V_SPACING) + state_start_y;

        let label = s.name.clone().unwrap_or_else(|| "<unnamed>".into());
        let actions = state_actions.get(&s.id);
        let desc = actions.map(|a| a.join("\n"));
        let h = if actions.map_or(0, |a| a.len()) > 0 {
            44.0 + actions.unwrap().len() as f64 * 14.0
        } else {
            44.0
        };

        let mut node = make_node(s.id, label, "state", x, y, 140.0, h, state_colors[i % state_colors.len()]);
        node.description = desc;
        nodes.push(node);
    }

    // Final pseudo-state (bull's eye)
    let final_id = u32::MAX - 1;
    let last_row = if state_count > 0 { (state_count - 1) / cols.max(1) } else { 0 };
    let final_y = last_row as f64 * (50.0 + V_SPACING) + state_start_y + 50.0 + V_SPACING;
    nodes.push(make_node(final_id, String::new(), "final_state", initial_x, final_y, 24.0, 24.0, "#475569"));

    // Connect initial pseudo-state to first state
    if let Some(first_state) = states.first() {
        let first_node = nodes.iter().find(|n| n.element_id == first_state.id);
        if let Some(to) = first_node {
            edges.push(DiagramEdge {
                from_id: initial_id,
                to_id: to.element_id,
                label: None,
                edge_type: "transition".into(),
                points: vec![
                    (initial_x + 10.0, 40.0),
                    (to.x + to.width / 2.0, to.y),
                ],
            });
        }
    }

    // Create edges from transitions using parsed source/target data
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
        let mut node = make_node(r.id, label, "requirement", 40.0, 30.0 + i as f64 * (req_h + gap_y), w, req_h, "#ef4444");
        node.stereotype = Some("\u{ab}requirement\u{bb}".into());
        node.description = r.doc.clone();
        nodes.push(node);
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

            let mut node = make_node(r.id, label, "requirement", px, ny, w, req_h, "#f87171");
            node.stereotype = Some("\u{ab}requirement\u{bb}".into());
            node.description = r.doc.clone();
            nodes.push(node);
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
            let mut node = make_node(impl_el.id, label.clone(), "block", nx, ny, w, req_h, &kind_to_color(&impl_el.kind));
            node.stereotype = Some("\u{ab}block\u{bb}".into());
            new_nodes.push(node);
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

    // Collect use case defs first, then usages that don't duplicate a def by name
    let uc_defs: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| e.kind == ElementKind::UseCaseDef)
        .collect();
    let def_names: std::collections::HashSet<&str> = uc_defs.iter()
        .filter_map(|e| e.name.as_deref())
        .collect();
    let uc_usages: Vec<&SysmlElement> = model.elements.iter()
        .filter(|e| e.kind == ElementKind::UseCaseUsage && !def_names.contains(e.name.as_deref().unwrap_or("")))
        .collect();
    let use_cases: Vec<&SysmlElement> = uc_defs.into_iter().chain(uc_usages).collect();

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
        nodes.push(make_node(id, label.clone(), "actor", 30.0, 30.0 + i as f64 * (h_actor + gap), w_actor, h_actor, "#94a3b8"));
    }

    // Place use cases on the right, inside a system boundary box
    let uc_start_x = if actor_type_names.is_empty() { 60.0 } else { 30.0 + w_actor + gap * 2.0 };
    let uc_padding = 20.0;
    let mut max_uc_w: f64 = 130.0;

    for (i, uc) in all_use_cases.iter().enumerate() {
        let label = uc.name.clone().unwrap_or_else(|| "<unnamed>".into());
        let w = (label.len() as f64 * 8.0).max(130.0);
        if w > max_uc_w { max_uc_w = w; }
        nodes.push(make_node(uc.id, label, "usecase",
            uc_start_x + uc_padding,
            30.0 + uc_padding + 20.0 + i as f64 * (h_uc + gap),
            w, h_uc, "#10b981"));
    }

    // System boundary box around use cases
    if !all_use_cases.is_empty() {
        let boundary_w = max_uc_w + uc_padding * 2.0 + 20.0;
        let boundary_h = all_use_cases.len() as f64 * (h_uc + gap) + uc_padding * 2.0 + 20.0;
        let boundary_id = u32::MAX - 2;
        let mut boundary = make_node(boundary_id, "System".into(), "system_boundary",
            uc_start_x, 30.0, boundary_w, boundary_h, "#334155");
        boundary.stereotype = Some("\u{ab}system\u{bb}".into());
        // Insert at beginning so it renders behind use cases
        nodes.insert(actor_type_names.len(), boundary);
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
    // Try: part_def by name → part_usage by name → part_usage with type_ref → part_def
    // Also supports part_usage as container when no part_def exists (usage-centric files)
    let has_children = |id: ElementId| -> bool {
        model.elements.iter().any(|c|
            c.parent_id == Some(id) && matches!(c.kind,
                ElementKind::PartUsage | ElementKind::PortUsage |
                ElementKind::AttributeUsage | ElementKind::ItemUsage))
    };

    let block = if let Some(ref name) = block_name {
        model.elements.iter()
            .find(|e| e.kind == ElementKind::PartDef && e.name.as_deref() == Some(name.as_str()))
            .or_else(|| {
                // Try part_usage directly (it may have children)
                model.elements.iter().find(|e|
                    e.kind == ElementKind::PartUsage && e.name.as_deref() == Some(name.as_str()) && has_children(e.id)
                )
            })
            .or_else(|| {
                // Resolve part_usage name → type_ref → part_def
                let usage = model.elements.iter().find(|e|
                    e.kind == ElementKind::PartUsage && e.name.as_deref() == Some(name.as_str())
                )?;
                let type_ref = usage.type_ref.as_deref()?;
                model.elements.iter().find(|e|
                    e.kind == ElementKind::PartDef && e.name.as_deref() == Some(type_ref)
                )
            })
    } else {
        // Default: pick the part_def or part_usage with the most children
        model.elements.iter()
            .filter(|e| matches!(e.kind, ElementKind::PartDef | ElementKind::PartUsage) && has_children(e.id))
            .max_by_key(|e| model.elements.iter().filter(|c| c.parent_id == Some(e.id)).count())
            .or_else(|| model.elements.iter().find(|e| e.kind == ElementKind::PartDef))
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
    let mut container = make_node(block.id, block.name.clone().unwrap_or_else(|| "<unnamed>".into()),
        "block_container", 20.0, 20.0, container_w, container_h, "#3b82f6");
    container.stereotype = Some("\u{ab}block\u{bb}".into());
    nodes.push(container);

    // Child parts
    for (i, child) in children.iter().enumerate() {
        let col = i % cols.max(1);
        let row = i / cols.max(1);
        let x = 20.0 + margin + col as f64 * (part_w + margin);
        let y = 20.0 + 30.0 + margin + row as f64 * (part_h + margin);

        let label = child.name.clone().unwrap_or_else(|| "<unnamed>".into());
        let mut node = make_node(child.id, label, "part", x, y, part_w, part_h, &kind_to_color(&child.kind));
        // Show type in description (label must stay as name for connection edge matching)
        node.description = child.type_ref.clone();
        nodes.push(node);
    }

    // Ports on the container boundary
    for (i, port) in ports.iter().enumerate() {
        let x = 20.0 + (i as f64 + 1.0) * container_w / (ports.len() as f64 + 1.0) - port_size / 2.0;
        let y = 20.0 + container_h - port_size / 2.0;

        nodes.push(make_node(port.id, port.name.clone().unwrap_or_else(|| "<unnamed>".into()),
            "port", x, y, port_size, port_size, "#8b5cf6"));
    }

    // Build lookup sets for matching connection endpoints
    let part_labels: std::collections::HashSet<&str> = children.iter()
        .filter_map(|c| c.name.as_deref())
        .collect();
    let port_labels: std::collections::HashSet<&str> = ports.iter()
        .filter_map(|p| p.name.as_deref())
        .collect();

    // Connection edges from ConnectStatement elements (sysml-core parsed source/target)
    for conn in model.elements.iter().filter(|e| e.kind == ElementKind::ConnectStatement && e.specializations.len() >= 2) {
        let src_name = conn.specializations[0].split('.').next().unwrap_or(&conn.specializations[0]);
        let tgt_name = conn.specializations[1].split('.').next().unwrap_or(&conn.specializations[1]);

        let src_in_block = part_labels.contains(src_name) || port_labels.contains(src_name);
        let tgt_in_block = part_labels.contains(tgt_name) || port_labels.contains(tgt_name);
        if !src_in_block || !tgt_in_block { continue; }

        let from_node = nodes.iter().find(|n| n.label == src_name && n.kind != "block_container");
        let to_node = nodes.iter().find(|n| n.label == tgt_name && n.kind != "block_container");

        if let (Some(from), Some(to)) = (from_node, to_node) {
            if from.element_id == to.element_id { continue; }
            let label = conn.name.clone().or_else(|| {
                let src_port = conn.specializations[0].split('.').nth(1).unwrap_or("");
                let tgt_port = conn.specializations[1].split('.').nth(1).unwrap_or("");
                if !src_port.is_empty() || !tgt_port.is_empty() {
                    Some(format!("{} → {}",
                        if src_port.is_empty() { src_name } else { src_port },
                        if tgt_port.is_empty() { tgt_name } else { tgt_port }
                    ))
                } else {
                    None
                }
            });
            edges.push(DiagramEdge {
                from_id: from.element_id, to_id: to.element_id,
                label, edge_type: "connection".into(),
                points: connect_nodes(from, to),
            });
        }
    }

    // ConnectionUsage/InterfaceUsage with parsed source/target in specializations
    for conn in model.elements.iter()
        .filter(|e| matches!(e.kind, ElementKind::ConnectionUsage | ElementKind::InterfaceUsage))
        .filter(|e| e.specializations.len() >= 2)
        .filter(|e| e.parent_id == Some(block.id) || {
            e.parent_id.map(|pid| model.elements.iter().any(|p| p.id == pid && p.parent_id == Some(block.id)))
                .unwrap_or(false)
        })
    {
        let src_name = conn.specializations[0].split('.').next().unwrap_or(&conn.specializations[0]);
        let tgt_name = conn.specializations[1].split('.').next().unwrap_or(&conn.specializations[1]);

        let from_node = nodes.iter().find(|n| n.label == src_name && n.kind != "block_container");
        let to_node = nodes.iter().find(|n| n.label == tgt_name && n.kind != "block_container");

        if let (Some(from), Some(to)) = (from_node, to_node) {
            if from.element_id == to.element_id { continue; }
            if edges.iter().any(|e| e.from_id == from.element_id && e.to_id == to.element_id) { continue; }
            edges.push(DiagramEdge {
                from_id: from.element_id, to_id: to.element_id,
                label: conn.name.clone(), edge_type: "connection".into(),
                points: connect_nodes(from, to),
            });
        }
    }

    // Fallback: ConnectionUsage/InterfaceUsage without specializations (old logic)
    for conn in model.elements.iter()
        .filter(|e| matches!(e.kind, ElementKind::ConnectionUsage | ElementKind::InterfaceUsage))
        .filter(|e| e.specializations.len() < 2)
        .filter(|e| e.parent_id == Some(block.id) || {
            e.parent_id.map(|pid| model.elements.iter().any(|p| p.id == pid && p.parent_id == Some(block.id)))
                .unwrap_or(false)
        })
    {
        if let Some(ref type_ref) = conn.type_ref {
            if let (Some(from_id), Some(to_node)) = (
                conn.parent_id,
                nodes.iter().find(|n| n.label == *type_ref && n.kind != "block_container")
            ) {
                if let Some(from_node) = nodes.iter().find(|n| n.element_id == from_id) {
                    if edges.iter().any(|e| e.from_id == from_node.element_id && e.to_id == to_node.element_id) { continue; }
                    edges.push(DiagramEdge {
                        from_id: from_node.element_id, to_id: to_node.element_id,
                        label: conn.name.clone(), edge_type: "connection".into(),
                        points: connect_nodes(from_node, to_node),
                    });
                }
            }
        }
    }

    // Flow edges from FlowStatement elements
    for flow in model.elements.iter().filter(|e| e.kind == ElementKind::FlowStatement && e.specializations.len() >= 2) {
        let src_name = flow.specializations[0].split('.').next().unwrap_or(&flow.specializations[0]);
        let tgt_name = flow.specializations[1].split('.').next().unwrap_or(&flow.specializations[1]);

        let src_in_block = part_labels.contains(src_name) || port_labels.contains(src_name);
        let tgt_in_block = part_labels.contains(tgt_name) || port_labels.contains(tgt_name);
        if !src_in_block || !tgt_in_block { continue; }

        let from_node = nodes.iter().find(|n| n.label == src_name && n.kind != "block_container");
        let to_node = nodes.iter().find(|n| n.label == tgt_name && n.kind != "block_container");

        if let (Some(from), Some(to)) = (from_node, to_node) {
            if from.element_id == to.element_id { continue; }
            let label = flow.name.clone()
                .or_else(|| flow.type_ref.as_ref().map(|t| format!("«{}»", t)));
            edges.push(DiagramEdge {
                from_id: from.element_id, to_id: to.element_id,
                label, edge_type: "flow".into(),
                points: connect_nodes(from, to),
            });
        }
    }

    // Port direction indicators
    for port_node in nodes.iter_mut().filter(|n| n.kind == "port") {
        if let Some(port_el) = model.elements.iter().find(|e| e.id == port_node.element_id) {
            if port_el.modifiers.iter().any(|m| m == "in") {
                port_node.label = format!("→ {}", port_node.label);
            } else if port_el.modifiers.iter().any(|m| m == "out") {
                port_node.label = format!("{} →", port_node.label);
            } else if port_el.modifiers.iter().any(|m| m == "inout") {
                port_node.label = format!("↔ {}", port_node.label);
            }
        }
    }

    let bounds = (0.0, 0.0,
        (20.0 + container_w + 20.0).max(400.0),
        (20.0 + container_h + 20.0).max(300.0));

    Ok(DiagramLayout { diagram_type: "ibd".into(), nodes, edges, bounds })
}

/// Smart edge routing between two nodes based on relative position
fn connect_nodes(from: &DiagramNode, to: &DiagramNode) -> Vec<(f64, f64)> {
    let from_cy = from.y + from.height / 2.0;
    let to_cy = to.y + to.height / 2.0;

    // Same row: connect horizontally
    if (from_cy - to_cy).abs() < from.height {
        if from.x < to.x {
            vec![(from.x + from.width, from_cy), (to.x, to_cy)]
        } else {
            vec![(from.x, from_cy), (to.x + to.width, to_cy)]
        }
    } else if from.y < to.y {
        // From is above to
        vec![
            (from.x + from.width / 2.0, from.y + from.height),
            (to.x + to.width / 2.0, to.y),
        ]
    } else {
        // From is below to
        vec![
            (from.x + from.width / 2.0, from.y),
            (to.x + to.width / 2.0, to.y + to.height),
        ]
    }
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
