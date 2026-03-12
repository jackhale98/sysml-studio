/**
 * SysML v2 view evaluation — matches elements against expose/filter patterns.
 */
import type { SysmlElement, ViewData, DiagramLayout, DiagramNode, DiagramEdge, ElementKind } from "./element-types";

/**
 * Match a qualified name against an expose pattern.
 * Supports `::*` (single-level wildcard) and `::**` (recursive wildcard).
 *
 *   matchExpose("A::B::C", "A::**")  → true  (recursive)
 *   matchExpose("A::B",    "A::*")   → true  (single-level)
 *   matchExpose("A::B::C", "A::*")   → false (too deep)
 *   matchExpose("A",       "A")      → true  (exact)
 */
export function matchExpose(qualifiedName: string, pattern: string): boolean {
  // Handle recursive wildcard ::**
  if (pattern.endsWith("::**")) {
    const prefix = pattern.slice(0, -4); // remove "::**"
    return qualifiedName.startsWith(prefix + "::") || qualifiedName === prefix;
  }
  // Handle single-level wildcard ::*
  if (pattern.endsWith("::*")) {
    const prefix = pattern.slice(0, -3); // remove "::*"
    if (!qualifiedName.startsWith(prefix + "::")) return false;
    const remainder = qualifiedName.slice(prefix.length + 2);
    return !remainder.includes("::"); // exactly one more segment
  }
  // Exact match
  return qualifiedName === pattern;
}

/** Map SysML v2 filter kind names (lowercased) to element kind strings. */
const KIND_FILTER_MAP: Record<string, string[]> = {
  partusage: ["part_usage"], partdef: ["part_def"],
  part: ["part_def", "part_usage"],
  portusage: ["port_usage"], portdef: ["port_def"],
  port: ["port_def", "port_usage"],
  attributeusage: ["attribute_usage"], attributedef: ["attribute_def"],
  attribute: ["attribute_def", "attribute_usage"],
  requirementusage: ["requirement_usage"], requirementdef: ["requirement_def"],
  requirement: ["requirement_def", "requirement_usage"],
  actionusage: ["action_usage"], actiondef: ["action_def"],
  action: ["action_def", "action_usage"],
  stateusage: ["state_usage"], statedef: ["state_def"],
  state: ["state_def", "state_usage"],
  constraintusage: ["constraint_usage"], constraintdef: ["constraint_def"],
  constraint: ["constraint_def", "constraint_usage"],
  itemusage: ["item_usage"], itemdef: ["item_def"],
  item: ["item_def", "item_usage"],
  connectionusage: ["connection_usage"], connectiondef: ["connection_def"],
  connection: ["connection_def", "connect_statement"],
  interfaceusage: ["interface_usage"], interfacedef: ["interface_def"],
  interface: ["interface_def", "interface_usage"],
  allocationusage: ["allocation_usage"], allocationdef: ["allocation_def"],
  allocation: ["allocation_def", "allocation_usage"],
  usecaseusage: ["use_case_usage"], usecasedef: ["use_case_def"],
  usecase: ["use_case_def", "use_case_usage"],
  enumerationdef: ["enumeration_def"],
  enumeration: ["enumeration_def"],
  calcdef: ["calc_def"],
  calc: ["calc_def"],
  viewdef: ["view_def"], viewusage: ["view_usage"],
  view: ["view_def", "view_usage"],
  flowusage: ["flow_usage"],
  flow: ["flow_usage", "flow_def"],
};

/**
 * Evaluate a view against a set of elements, returning the filtered subset.
 * If the view has no expose patterns, all elements are candidates.
 * If the view has no kind filters, all kinds pass.
 */
export function evaluateView(view: ViewData, elements: SysmlElement[]): SysmlElement[] {
  let result = elements;

  // Apply expose patterns
  if (view.exposes.length > 0) {
    result = result.filter(el =>
      el.qualified_name != null &&
      view.exposes.some(pattern => matchExpose(el.qualified_name, pattern))
    );
  }

  // Apply kind filters
  if (view.kind_filters.length > 0) {
    const allowedKinds = new Set<string>();
    for (const kf of view.kind_filters) {
      const key = kf.toLowerCase().replace(/_/g, "");
      const mapped = KIND_FILTER_MAP[key] ?? [kf];
      for (const k of mapped) allowedKinds.add(k);
    }
    result = result.filter(el => {
      const kindStr = typeof el.kind === "string" ? el.kind : "";
      return allowedKinds.has(kindStr);
    });
  }

  return result;
}

/**
 * Merge a view usage's data with its parent view def's data.
 * Usage exposes override (if present); kind filters are combined.
 */
export function mergeViewData(usage: ViewData, def: ViewData | null): ViewData {
  if (!def) return usage;
  return {
    name: usage.name,
    exposes: usage.exposes.length > 0 ? usage.exposes : def.exposes,
    kind_filters: [...def.kind_filters, ...usage.kind_filters],
    render_as: usage.render_as ?? def.render_as,
  };
}

// ─── Interconnection Diagram Layout ───

const KIND_COLORS: Record<string, string> = {
  part_def: "#3b82f6", part_usage: "#3b82f6",
  port_def: "#8b5cf6", port_usage: "#8b5cf6",
  attribute_def: "#f59e0b", attribute_usage: "#f59e0b",
  requirement_def: "#ef4444", requirement_usage: "#ef4444",
  action_def: "#c084fc", action_usage: "#c084fc",
  state_def: "#c084fc", state_usage: "#c084fc",
  constraint_def: "#f97316", constraint_usage: "#f97316",
  item_def: "#6366f1", item_usage: "#6366f1",
  connection_def: "#f472b6", connect_statement: "#f472b6",
  interface_def: "#14b8a6", interface_usage: "#14b8a6",
  enumeration_def: "#10b981",
  calc_def: "#f97316",
  use_case_def: "#06b6d4", use_case_usage: "#06b6d4",
};

function kindStr(kind: ElementKind): string {
  return typeof kind === "string" ? kind : kind.other;
}

function textW(label: string): number {
  return label.length * 7.2 + 28;
}

/**
 * Build an interconnection diagram layout from view-filtered elements.
 * Renders elements as blocks in a grid, with edges for connections,
 * specializations, and satisfy/verify relationships found among them.
 */
export function buildInterconnectionLayout(
  elements: SysmlElement[],
  allElements: SysmlElement[],
): DiagramLayout {
  const GAP_X = 50;
  const GAP_Y = 40;
  const NODE_H = 60;
  const COMPARTMENT_LINE = 14;

  const idSet = new Set(elements.map(e => e.id));

  // Build nodes — group children under parents if both are in the set
  const childIds = new Set<number>();
  for (const el of elements) {
    if (el.parent_id !== null && idSet.has(el.parent_id)) {
      childIds.add(el.id);
    }
  }
  const roots = elements.filter(e => !childIds.has(e.id));

  // Build compartments for each root from its matched children
  const childMap = new Map<number, SysmlElement[]>();
  for (const el of elements) {
    if (el.parent_id !== null && idSet.has(el.parent_id)) {
      const list = childMap.get(el.parent_id) ?? [];
      list.push(el);
      childMap.set(el.parent_id, list);
    }
  }

  // Compute node dimensions
  const cols = Math.max(1, Math.ceil(Math.sqrt(roots.length)));
  const nodes: DiagramNode[] = [];
  const nodeById = new Map<number, DiagramNode>();

  roots.forEach((el, i) => {
    const k = kindStr(el.kind);
    const label = el.name ?? "<unnamed>";
    const children = childMap.get(el.id) ?? [];

    // Build compartments from children
    const attrs = children.filter(c => {
      const ck = kindStr(c.kind);
      return ck === "attribute_usage" || ck === "attribute_def";
    });
    const ports = children.filter(c => {
      const ck = kindStr(c.kind);
      return ck === "port_usage" || ck === "port_def";
    });
    const parts = children.filter(c => {
      const ck = kindStr(c.kind);
      return ck === "part_usage" || ck === "part_def";
    });
    const others = children.filter(c => !attrs.includes(c) && !ports.includes(c) && !parts.includes(c));

    const compartments: { heading: string; entries: string[] }[] = [];
    if (attrs.length > 0) compartments.push({
      heading: "attributes",
      entries: attrs.map(a => `${a.name ?? "?"}${a.type_ref ? " : " + a.type_ref : ""}`),
    });
    if (ports.length > 0) compartments.push({
      heading: "ports",
      entries: ports.map(p => `${p.name ?? "?"}${p.type_ref ? " : " + p.type_ref : ""}`),
    });
    if (parts.length > 0) compartments.push({
      heading: "parts",
      entries: parts.map(p => `${p.name ?? "?"}${p.type_ref ? " : " + p.type_ref : ""}`),
    });
    if (others.length > 0) compartments.push({
      heading: "members",
      entries: others.map(o => `${o.name ?? "?"}${o.type_ref ? " : " + o.type_ref : ""}`),
    });

    const compLines = compartments.reduce((sum, c) => sum + 1 + c.entries.length, 0);
    const w = Math.max(
      textW(label) + 20,
      ...compartments.flatMap(c => c.entries.map(e => textW(e) + 10)),
      120,
    );
    const h = NODE_H + compLines * COMPARTMENT_LINE;

    const col = i % cols;
    const row = Math.floor(i / cols);

    const node: DiagramNode = {
      element_id: el.id,
      label,
      kind: k.endsWith("_def") ? "block" : "part",
      x: col * (w + GAP_X) + 30,
      y: row * (h + GAP_Y) + 30,
      width: w,
      height: h,
      color: KIND_COLORS[k] ?? "#64748b",
      children: [],
      stereotype: k.replace(/_/g, " "),
      compartments: compartments.length > 0 ? compartments : undefined,
    };
    nodes.push(node);
    nodeById.set(el.id, node);
    // Also map children to parent node for edge resolution
    for (const child of children) {
      nodeById.set(child.id, node);
    }
  });

  // Fix grid layout — use actual computed widths per column
  const colWidths = new Array(cols).fill(0);
  nodes.forEach((n, i) => {
    const col = i % cols;
    colWidths[col] = Math.max(colWidths[col], n.width);
  });
  nodes.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    let x = 30;
    for (let c = 0; c < col; c++) x += colWidths[c] + GAP_X;
    n.x = x;
    // Recompute row heights
    const rowNodes = nodes.filter((_, j) => Math.floor(j / cols) === row);
    const maxH = Math.max(...rowNodes.map(rn => rn.height));
    let y = 30;
    for (let r = 0; r < row; r++) {
      const rNodes = nodes.filter((_, j) => Math.floor(j / cols) === r);
      y += Math.max(...rNodes.map(rn => rn.height), NODE_H) + GAP_Y;
    }
    n.y = y;
    // Center vertically in row
    n.y += (maxH - n.height) / 2;
  });

  // Build edges from relationships in allElements
  const edges: DiagramEdge[] = [];
  const edgeSet = new Set<string>(); // deduplicate: "from_id→to_id:type"
  const matchedNames = new Map<string, number>();
  for (const el of elements) {
    if (el.name) matchedNames.set(el.name, el.id);
  }

  for (const el of allElements) {
    const k = kindStr(el.kind);
    // Connection / connect_statement
    if (k === "connect_statement" || k === "connection_usage") {
      const fromNode = el.name ? nodeById.get(matchedNames.get(el.name) ?? -1) : undefined;
      const toNode = el.type_ref ? nodeById.get(matchedNames.get(el.type_ref) ?? -1) : undefined;
      if (fromNode && toNode && fromNode !== toNode) {
        const key = `${fromNode.element_id}→${toNode.element_id}:connection`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({
            from_id: fromNode.element_id,
            to_id: toNode.element_id,
            label: null,
            edge_type: "connection",
            points: connectN(fromNode, toNode),
          });
        }
      }
    }
    // Specialization (type_ref on defs)
    if (k.endsWith("_def") && el.type_ref) {
      const fromNode = nodeById.get(el.id);
      const toNode = el.type_ref ? nodeById.get(matchedNames.get(el.type_ref) ?? -1) : undefined;
      if (fromNode && toNode && fromNode !== toNode) {
        const key = `${fromNode.element_id}→${toNode.element_id}:specialization`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({
            from_id: fromNode.element_id,
            to_id: toNode.element_id,
            label: null,
            edge_type: "specialization",
            points: connectN(fromNode, toNode),
          });
        }
      }
    }
    // Composition (part_usage whose type_ref matches a matched element)
    if (k === "part_usage" && el.type_ref && el.parent_id !== null) {
      const parentNode = nodeById.get(el.parent_id);
      const typeNode = nodeById.get(matchedNames.get(el.type_ref) ?? -1);
      if (parentNode && typeNode && parentNode !== typeNode) {
        const key = `${parentNode.element_id}→${typeNode.element_id}:composition`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({
            from_id: parentNode.element_id,
            to_id: typeNode.element_id,
            label: el.name ?? null,
            edge_type: "composition",
            points: connectN(parentNode, typeNode),
          });
        }
      }
    }
    // Satisfy / verify
    if (k === "satisfy_statement" || k === "verify_statement") {
      const fromName = el.name ?? el.type_ref;
      const toName = k === "satisfy_statement" ? el.type_ref : el.type_ref;
      const fromNode = fromName ? nodeById.get(matchedNames.get(fromName) ?? -1) : undefined;
      const toNode = toName ? nodeById.get(matchedNames.get(toName) ?? -1) : undefined;
      if (fromNode && toNode && fromNode !== toNode) {
        const eType = k === "satisfy_statement" ? "satisfy" : "verify";
        const key = `${fromNode.element_id}→${toNode.element_id}:${eType}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({
            from_id: fromNode.element_id,
            to_id: toNode.element_id,
            label: eType,
            edge_type: eType,
            points: connectN(fromNode, toNode),
          });
        }
      }
    }
  }

  // Compute bounds
  let maxX = 0, maxY = 0;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.width + 30);
    maxY = Math.max(maxY, n.y + n.height + 30);
  }

  return {
    diagram_type: "interconnection",
    nodes,
    edges,
    bounds: [0, 0, maxX, maxY],
  };
}

function connectN(from: DiagramNode, to: DiagramNode): [number, number][] {
  const fromCx = from.x + from.width / 2;
  const fromCy = from.y + from.height / 2;
  const toCx = to.x + to.width / 2;
  const toCy = to.y + to.height / 2;
  if (Math.abs(fromCy - toCy) < from.height * 0.8) {
    // Same row — connect sides
    return from.x < to.x
      ? [[from.x + from.width, fromCy], [to.x, toCy]]
      : [[from.x, fromCy], [to.x + to.width, toCy]];
  }
  // Different rows — connect top/bottom
  return from.y < to.y
    ? [[fromCx, from.y + from.height], [toCx, to.y]]
    : [[fromCx, from.y], [toCx, to.y + to.height]];
}
