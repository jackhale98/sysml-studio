/**
 * Browser-side SysML parser fallback.
 * When running outside Tauri (e.g. in Safari via Vite dev server),
 * this regex-based parser provides element extraction so the UI is fully functional.
 */
import type {
  SysmlModel, SysmlElement, ElementId, SourceSpan,
  Category, ParseError, DiagramLayout, DiagramNode, DiagramEdge,
  CompletenessReport, TraceabilityEntry, TraceLink,
  ValidationIssue, ValidationReport,
} from "./element-types";

interface ParseContext {
  elements: SysmlElement[];
  errors: ParseError[];
  nextId: number;
  stack: { id: ElementId; name: string }[];
}

const DEF_PATTERNS: [RegExp, string, Category][] = [
  [/^package\s+(\w+)/, "package", "structure"],
  [/^part\s+def\s+(\w+)/, "part_def", "structure"],
  [/^attribute\s+def\s+(\w+)/, "attribute_def", "property"],
  [/^port\s+def\s+(\w+)/, "port_def", "interface"],
  [/^connection\s+def\s+(\w+)/, "connection_def", "relationship"],
  [/^interface\s+def\s+(\w+)/, "interface_def", "interface"],
  [/^item\s+def\s+(\w+)/, "item_def", "structure"],
  [/^action\s+def\s+(\w+)/, "action_def", "behavior"],
  [/^state\s+def\s+(\w+)/, "state_def", "behavior"],
  [/^constraint\s+def\s+(\w+)/, "constraint_def", "constraint"],
  [/^requirement\s+def\s+(\w+)/, "requirement_def", "requirement"],
  [/^concern\s+def\s+(\w+)/, "concern_def", "requirement"],
  [/^view\s+def\s+(\w+)/, "view_def", "view"],
  [/^viewpoint\s+def\s+(\w+)/, "viewpoint_def", "view"],
  [/^rendering\s+def\s+(\w+)/, "rendering_def", "view"],
  [/^allocation\s+def\s+(\w+)/, "allocation_def", "relationship"],
  [/^use\s+case\s+def\s+(\w+)/, "use_case_def", "behavior"],
  [/^analysis\s+(?:case\s+)?def\s+(\w+)/, "analysis_case_def", "analysis"],
  [/^verification\s+(?:case\s+)?def\s+(\w+)/, "verification_case_def", "analysis"],
  [/^enum\s+def\s+(\w+)/, "enumeration_def", "property"],
  [/^enumeration\s+def\s+(\w+)/, "enumeration_def", "property"],
  [/^flow\s+def\s+(\w+)/, "flow_def", "interface"],
  [/^occurrence\s+def\s+(\w+)/, "occurrence_def", "structure"],
  [/^calc\s+def\s+(\w+)/, "calc_def", "behavior"],
  [/^metadata\s+def\s+(\w+)/, "metadata_def", "auxiliary"],
  [/^individual\s+def\s+(\w+)/, "individual_def", "structure"],
  [/^signal\s+def\s+(\w+)/, "item_def", "structure"],
];

const USAGE_PATTERNS: [RegExp, string, Category][] = [
  [/^part\s+(\w+)\s*:\s*~?\s*([\w:]+)/, "part_usage", "structure"],
  [/^attribute\s+(\w+)\s*(?::>|:)\s*~?\s*([\w:]+)/, "attribute_usage", "property"],
  [/^port\s+(\w+)\s*:\s*~?\s*([\w:]+)/, "port_usage", "interface"],
  [/^connection\s+(\w+)/, "connection_usage", "relationship"],
  [/^action\s+(\w+)/, "action_usage", "behavior"],
  [/^state\s+(\w+)\s*[;{]/, "state_usage", "behavior"],
  [/^item\s+(\w+)\s*:\s*~?\s*([\w:]+)/, "item_usage", "structure"],
  [/^flow\s+(\w+)(?:\s+of\s+(\w+))?(?:\s+from\s+([\w.]+)\s+to\s+([\w.]+))?/, "flow_usage", "interface"],
  [/^ref\s+(\w+)\s*:\s*~?\s*([\w:]+)/, "ref_usage", "structure"],
  [/^enum\s+(\w+)\s*;/, "enum_member", "property"],
  [/^allocation\s+(\w+)/, "allocation_usage", "relationship"],
  [/^requirement\s+(\w+)/, "requirement_usage", "requirement"],
  [/^constraint\s+(\w+)/, "constraint_usage", "constraint"],
];

const OTHER_PATTERNS: [RegExp, string, Category][] = [
  [/^transition\s+(?:(\w+)\s+)?(?:first\s+(\w+)\s+then\s+(\w+))?/, "transition_statement", "behavior"],
  [/^satisfy\s+([\w:]+)(?:\s+by\s+([\w:]+))?/, "satisfy_statement", "requirement"],
  [/^verify\s+([\w:]+)(?:\s+by\s+([\w:]+))?/, "verify_statement", "analysis"],
  [/^(?:public\s+)?import\s+/, "import", "auxiliary"],
  [/^connect\s+([\w.:]+)\s+to\s+([\w.:]+)/, "connect_statement", "relationship"],
  [/^include\s+(?:use\s+case\s+)?(\w+)/, "include_statement", "behavior"],
];

function makeSpan(line: number, col: number, endCol: number): SourceSpan {
  return { start_line: line, start_col: col, end_line: line, end_col: endCol, start_byte: 0, end_byte: 0 };
}

export function browserParse(source: string): SysmlModel {
  const start = performance.now();
  const ctx: ParseContext = { elements: [], errors: [], nextId: 0, stack: [] };
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    // Handle doc comments
    if (trimmed.startsWith("doc")) {
      const docMatch = trimmed.match(/^doc\s+\/\*\s*(.*?)\s*\*\//);
      if (docMatch && ctx.stack.length > 0) {
        const parentId = ctx.stack[ctx.stack.length - 1].id;
        const parent = ctx.elements.find(e => e.id === parentId);
        if (parent) parent.doc = docMatch[1];
      }
      continue;
    }

    let matched = false;

    // Try definition patterns
    for (const [pat, kind, category] of DEF_PATTERNS) {
      const m = trimmed.match(pat);
      if (m) {
        const parentId = ctx.stack.length > 0 ? ctx.stack[ctx.stack.length - 1].id : null;
        const qname = ctx.stack.map(s => s.name).concat(m[1]).join("::");
        const specializations: string[] = [];
        const specMatch = trimmed.match(/:>\s*(\w+)/) || trimmed.match(/specializes\s+(\w+)/);
        if (specMatch) specializations.push(specMatch[1]);
        const el: SysmlElement = {
          id: ctx.nextId++, kind: kind as any, name: m[1], qualified_name: qname,
          category: category as Category, parent_id: parentId, children_ids: [],
          span: makeSpan(i, 0, lines[i].length), type_ref: null, specializations,
          modifiers: [], multiplicity: null, doc: null, short_name: null,
        };
        ctx.elements.push(el);
        if (parentId !== null) {
          const parent = ctx.elements.find(e => e.id === parentId);
          if (parent) parent.children_ids.push(el.id);
        }
        if (trimmed.includes("{")) {
          ctx.stack.push({ id: el.id, name: m[1] });
        }
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Try usage patterns
      for (const [pat, kind, category] of USAGE_PATTERNS) {
        const m = trimmed.match(pat);
        if (m) {
          const parentId = ctx.stack.length > 0 ? ctx.stack[ctx.stack.length - 1].id : null;
          const qname = ctx.stack.map(s => s.name).concat(m[1]).join("::");
          let typeRef = m[2] ?? null;
          let specializations: string[] = [];
          if (kind === "flow_usage") {
            typeRef = m[2] ?? null;
            if (m[3] && m[4]) {
              specializations = [m[3], m[4]];
            }
          }
          const el: SysmlElement = {
            id: ctx.nextId++, kind: kind as any, name: m[1], qualified_name: qname,
            category: category as Category, parent_id: parentId, children_ids: [],
            span: makeSpan(i, 0, lines[i].length), type_ref: typeRef, specializations,
            modifiers: [], multiplicity: null, doc: null, short_name: null,
          };
          ctx.elements.push(el);
          if (parentId !== null) {
            const parent = ctx.elements.find(e => e.id === parentId);
            if (parent) parent.children_ids.push(el.id);
          }
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      // Try other patterns
      for (const [pat, kind, category] of OTHER_PATTERNS) {
        const m = trimmed.match(pat);
        if (m) {
          const parentId = ctx.stack.length > 0 ? ctx.stack[ctx.stack.length - 1].id : null;
          let name = m[1] ?? null;
          let typeRef: string | null = null;
          let specializations: string[] = [];

          if (kind === "satisfy_statement" || kind === "verify_statement") {
            name = m[2] ?? null;
            typeRef = m[1] ?? null;
          } else if (kind === "connect_statement") {
            name = m[1];
            typeRef = m[2];
          } else if (kind === "transition_statement") {
            name = m[1] ?? null;
            typeRef = m[2] ?? null;
            specializations = m[3] ? [m[3]] : [];
          }

          const qname = ctx.stack.map(s => s.name).concat(name ?? "<unnamed>").join("::");
          const el: SysmlElement = {
            id: ctx.nextId++, kind: kind as any, name, qualified_name: qname,
            category: category as Category, parent_id: parentId, children_ids: [],
            span: makeSpan(i, 0, lines[i].length), type_ref: typeRef, specializations,
            modifiers: [], multiplicity: null, doc: null, short_name: null,
          };
          ctx.elements.push(el);
          if (parentId !== null) {
            const parent = ctx.elements.find(e => e.id === parentId);
            if (parent) parent.children_ids.push(el.id);
          }
          matched = true;
          break;
        }
      }
    }

    // Handle closing braces — pop from stack for each `}`
    const closeBraces = (trimmed.match(/}/g) || []).length;
    for (let b = 0; b < closeBraces; b++) {
      if (ctx.stack.length > 0) ctx.stack.pop();
    }
  }

  // Post-processing: resolve multi-line transitions
  for (const el of ctx.elements) {
    if (typeof el.kind === "string" && el.kind === "transition_statement" && el.type_ref === null) {
      const startLine = el.span.start_line;
      for (let j = startLine + 1; j < Math.min(startLine + 4, lines.length); j++) {
        const lookAhead = lines[j].trim();
        const firstMatch = lookAhead.match(/first\s+(\w+)/);
        const thenMatch = lookAhead.match(/then\s+(\w+)/);
        if (firstMatch) {
          el.type_ref = firstMatch[1];
        }
        if (thenMatch) {
          el.specializations = [thenMatch[1]];
        }
      }
    }
  }

  const parseTime = performance.now() - start;
  const defs = ctx.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return k.endsWith("_def") || k === "package";
  }).length;
  const usages = ctx.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return k.endsWith("_usage") || k.endsWith("_statement") || k === "enum_member";
  }).length;

  return {
    file_path: null,
    elements: ctx.elements,
    errors: ctx.errors,
    stats: {
      total_elements: ctx.elements.length,
      definitions: defs,
      usages: usages,
      relationships: ctx.elements.filter(e => e.category === "relationship").length,
      errors: ctx.errors.length,
      parse_time_ms: parseTime,
    },
  };
}

// Estimate text width: ~7.5px per character in our monospace font at size 11-13
function textWidth(label: string, fontSize = 11): number {
  return label.length * fontSize * 0.65 + 24; // padding
}

/** Browser-side BDD layout — proper hierarchical tree */
export function browserBddLayout(model: SysmlModel): DiagramLayout {
  const defs = model.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return k === "part_def" || k === "item_def";
  });

  const colors: Record<string, string> = {
    part_def: "#3b82f6", item_def: "#6366f1", attribute_def: "#f59e0b",
    port_def: "#8b5cf6", action_def: "#10b981", state_def: "#38bdf8",
    requirement_def: "#ef4444", connection_def: "#f472b6",
  };

  const H = 58, GAP_X = 40, GAP_Y = 120;

  type TreeNode = { def: SysmlElement; children: TreeNode[]; usageNames: Map<number, string>; w: number };

  const defById = new Map(defs.map(d => [d.id, d]));
  const defByName = new Map(defs.map(d => [d.name ?? "", d]));

  const childrenOf = new Map<number, { usageName: string; childDef: SysmlElement }[]>();
  const hasParent = new Set<number>();

  for (const el of model.elements) {
    const k = typeof el.kind === "string" ? el.kind : "";
    if (k === "part_usage" && el.type_ref && el.parent_id !== null) {
      let parentDefId = el.parent_id;
      let parentDef = defById.get(parentDefId);
      if (!parentDef) {
        const parentEl = model.elements.find(e => e.id === el.parent_id);
        if (parentEl && parentEl.parent_id !== null) {
          parentDef = defById.get(parentEl.parent_id);
          if (parentDef) parentDefId = parentDef.id;
        }
      }
      const childDef = defByName.get(el.type_ref);
      if (parentDef && childDef && parentDef.id !== childDef.id) {
        if (!childrenOf.has(parentDef.id)) childrenOf.set(parentDef.id, []);
        childrenOf.get(parentDef.id)!.push({ usageName: el.name ?? el.type_ref, childDef });
        hasParent.add(childDef.id);
      }
    }
  }

  const roots = defs.filter(d => !hasParent.has(d.id));

  const visited = new Set<number>();
  function buildTree(def: SysmlElement): TreeNode {
    visited.add(def.id);
    const kids = childrenOf.get(def.id) ?? [];
    const usageNames = new Map<number, string>();
    const childTrees: TreeNode[] = [];
    for (const { usageName, childDef } of kids) {
      if (!visited.has(childDef.id)) {
        usageNames.set(childDef.id, usageName);
        childTrees.push(buildTree(childDef));
      }
    }
    const w = Math.max(textWidth(def.name ?? "<unnamed>", 13), 130);
    return { def, children: childTrees, usageNames, w };
  }

  const forest = roots.map(r => buildTree(r));

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  // Subtree pixel width including gaps
  function subtreePixelWidth(tree: TreeNode): number {
    if (tree.children.length === 0) return tree.w;
    const childWidths = tree.children.map(c => subtreePixelWidth(c));
    const totalChildWidth = childWidths.reduce((a, b) => a + b, 0) + (tree.children.length - 1) * GAP_X;
    return Math.max(tree.w, totalChildWidth);
  }

  function positionTree(tree: TreeNode, x: number, y: number, availableWidth: number) {
    const nodeW = tree.w;
    const nodeX = x + (availableWidth - nodeW) / 2;
    const nodeY = y;
    const kind = typeof tree.def.kind === "string" ? tree.def.kind : "";

    nodes.push({
      element_id: tree.def.id,
      label: tree.def.name ?? "<unnamed>",
      kind: "block",
      x: nodeX, y: nodeY, width: nodeW, height: H,
      color: colors[kind] ?? "#94a3b8",
      children: [],
    });

    if (tree.children.length > 0) {
      const childPixelWidths = tree.children.map(c => subtreePixelWidth(c));
      const totalChildWidth = childPixelWidths.reduce((a, b) => a + b, 0) + (tree.children.length - 1) * GAP_X;
      let childX = x + (availableWidth - totalChildWidth) / 2;

      for (let ci = 0; ci < tree.children.length; ci++) {
        const child = tree.children[ci];
        const childAvailWidth = childPixelWidths[ci];

        positionTree(child, childX, y + H + GAP_Y, childAvailWidth);

        const childNodeW = child.w;
        const childNodeX = childX + (childAvailWidth - childNodeW) / 2;
        const usageName = tree.usageNames.get(child.def.id);

        // Edge: vertical from parent bottom center, route to child top center
        const parentCx = nodeX + nodeW / 2;
        const childCx = childNodeX + childNodeW / 2;
        const midY = nodeY + H + GAP_Y * 0.45;

        edges.push({
          from_id: tree.def.id, to_id: child.def.id,
          label: usageName ?? null, edge_type: "composition",
          points: [
            [parentCx, nodeY + H],
            [parentCx, midY],
            [childCx, midY],
            [childCx, y + H + GAP_Y],
          ],
        });

        childX += childAvailWidth + GAP_X;
      }
    }
  }

  let forestX = 20;
  for (const tree of forest) {
    const tw = subtreePixelWidth(tree);
    positionTree(tree, forestX, 30, tw);
    forestX += tw + GAP_X * 2;
  }

  for (const d of defs) {
    if (!visited.has(d.id)) {
      const kind = typeof d.kind === "string" ? d.kind : "";
      const w = Math.max(textWidth(d.name ?? "<unnamed>", 13), 130);
      nodes.push({
        element_id: d.id,
        label: d.name ?? "<unnamed>",
        kind: "block",
        x: forestX, y: 30, width: w, height: H,
        color: colors[kind] ?? "#94a3b8",
        children: [],
      });
      forestX += w + GAP_X;
    }
  }

  // Add specialization edges
  for (const d of defs) {
    if (d.specializations.length > 0) {
      const fromNode = nodes.find(n => n.element_id === d.id);
      for (const specName of d.specializations) {
        const targetDef = defs.find(t => t.name === specName);
        if (targetDef && fromNode) {
          const toNode = nodes.find(n => n.element_id === targetDef.id);
          if (toNode) {
            edges.push({
              from_id: d.id, to_id: targetDef.id,
              label: null, edge_type: "specialization",
              points: [
                [fromNode.x + fromNode.width / 2, fromNode.y],
                [fromNode.x + fromNode.width / 2, fromNode.y - 20],
                [toNode.x + toNode.width / 2, toNode.y + toNode.height + 20],
                [toNode.x + toNode.width / 2, toNode.y + toNode.height],
              ],
            });
          }
        }
      }
    }
  }

  const minX = nodes.length > 0 ? Math.min(...nodes.map(n => n.x)) : 0;
  const minY = nodes.length > 0 ? Math.min(...nodes.map(n => n.y)) : 0;
  const maxX = nodes.length > 0 ? Math.max(...nodes.map(n => n.x + n.width)) : 400;
  const maxY = nodes.length > 0 ? Math.max(...nodes.map(n => n.y + n.height)) : 300;

  return { diagram_type: "bdd", nodes, edges, bounds: [minX, minY, maxX, maxY] };
}

/** Browser-side STM layout */
export function browserStmLayout(model: SysmlModel, stateDefName: string): DiagramLayout {
  const stateDef = model.elements.find(e =>
    typeof e.kind === "string" && e.kind === "state_def" && e.name === stateDefName
  );
  if (!stateDef) return { diagram_type: "stm", nodes: [], edges: [], bounds: [0, 0, 400, 300] };

  const states = model.elements.filter(e =>
    typeof e.kind === "string" && e.kind === "state_usage" && e.parent_id === stateDef.id
  );
  const transitions = model.elements.filter(e =>
    typeof e.kind === "string" && e.kind === "transition_statement" && e.parent_id === stateDef.id
  );

  const stateColors = ["#64748b", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#8b5cf6"];
  const cols = Math.max(Math.ceil(Math.sqrt(states.length)), 1);
  const STATE_H = 48, STATE_GAP_X = 60, STATE_GAP_Y = 80;

  const nodes: DiagramNode[] = states.map((s, i) => {
    const w = Math.max(textWidth(s.name ?? "<unnamed>", 12), 100);
    return {
      element_id: s.id, label: s.name ?? "<unnamed>", kind: "state",
      x: (i % cols) * (w + STATE_GAP_X) + 40,
      y: Math.floor(i / cols) * (STATE_H + STATE_GAP_Y) + 40,
      width: w, height: STATE_H,
      color: stateColors[i % stateColors.length], children: [],
    };
  });

  const edges: DiagramEdge[] = [];
  for (const t of transitions) {
    let fromLabel: string | null = null;
    let toLabel: string | null = null;

    // Prefer parsed first/then data
    if (t.type_ref && t.specializations.length > 0) {
      fromLabel = t.type_ref;
      toLabel = t.specializations[0];
    } else if (t.name) {
      // Fallback to name convention
      const parts = t.name.split("_to_");
      if (parts.length === 2) {
        fromLabel = parts[0];
        toLabel = parts[1];
      }
    }

    if (!fromLabel || !toLabel) continue;
    const from = nodes.find(n => n.label === fromLabel);
    const to = nodes.find(n => n.label === toLabel);
    if (!from || !to) continue;

    // Route edges: exit from right/bottom of source, enter left/top of target
    const fromCx = from.x + from.width / 2;
    const fromCy = from.y + from.height / 2;
    const toCx = to.x + to.width / 2;
    const toCy = to.y + to.height / 2;
    const dx = toCx - fromCx;
    const dy = toCy - fromCy;

    let points: [number, number][];
    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal routing
      const exitX = dx > 0 ? from.x + from.width : from.x;
      const enterX = dx > 0 ? to.x : to.x + to.width;
      const midX = (exitX + enterX) / 2;
      points = [
        [exitX, fromCy],
        [midX, fromCy],
        [midX, toCy],
        [enterX, toCy],
      ];
    } else {
      // Vertical routing
      const exitY = dy > 0 ? from.y + from.height : from.y;
      const enterY = dy > 0 ? to.y : to.y + to.height;
      const midY = (exitY + enterY) / 2;
      points = [
        [fromCx, exitY],
        [fromCx, midY],
        [toCx, midY],
        [toCx, enterY],
      ];
    }

    edges.push({
      from_id: from.element_id, to_id: to.element_id,
      label: t.name, edge_type: "transition",
      points,
    });
  }

  return {
    diagram_type: "stm", nodes, edges,
    bounds: [0, 0, Math.max(...nodes.map(n => n.x + n.width), 400), Math.max(...nodes.map(n => n.y + n.height), 300)],
  };
}

/** Browser-side Requirements Diagram layout */
export function browserReqLayout(model: SysmlModel): DiagramLayout {
  const reqs = model.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return k === "requirement_def" || k === "requirement_usage";
  });

  const H = 65, GAP_X = 50, GAP_Y = 90;

  // Separate top-level vs nested requirements
  const topReqs = reqs.filter(r => {
    if (r.parent_id === null) return true;
    const parent = model.elements.find(e => e.id === r.parent_id);
    if (!parent) return true;
    const pk = typeof parent.kind === "string" ? parent.kind : "";
    return pk !== "requirement_def" && pk !== "requirement_usage";
  });
  const nestedReqs = reqs.filter(r => !topReqs.includes(r));

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  // Position top-level requirements in a column
  topReqs.forEach((r, i) => {
    const w = Math.max(textWidth(r.name ?? "<unnamed>", 12), 160);
    nodes.push({
      element_id: r.id,
      label: r.name ?? "<unnamed>",
      kind: "requirement",
      x: 40, y: 30 + i * (H + GAP_Y),
      width: w, height: H,
      color: "#ef4444",
      children: [],
    });
  });

  // Position nested requirements to the right of their parents
  for (const r of nestedReqs) {
    const parentNode = nodes.find(n => n.element_id === r.parent_id);
    if (parentNode) {
      const siblingCount = nodes.filter(n => {
        const el = model.elements.find(e => e.id === n.element_id);
        return el?.parent_id === r.parent_id && nestedReqs.includes(el!);
      }).length;

      const w = Math.max(textWidth(r.name ?? "<unnamed>", 12), 150);
      const nx = parentNode.x + parentNode.width + GAP_X;
      const ny = parentNode.y + siblingCount * (H + 20);
      nodes.push({
        element_id: r.id,
        label: r.name ?? "<unnamed>",
        kind: "requirement",
        x: nx, y: ny, width: w, height: H,
        color: "#f87171",
        children: [],
      });
      edges.push({
        from_id: r.parent_id!, to_id: r.id,
        label: "containment", edge_type: "containment",
        points: [
          [parentNode.x + parentNode.width, parentNode.y + H / 2],
          [parentNode.x + parentNode.width + GAP_X * 0.4, parentNode.y + H / 2],
          [nx - GAP_X * 0.4, ny + H / 2],
          [nx, ny + H / 2],
        ],
      });
    }
  }

  // Add satisfy/verify edges
  const satisfyVerify = model.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return k === "satisfy_statement" || k === "verify_statement";
  });

  for (const sv of satisfyVerify) {
    const k = typeof sv.kind === "string" ? sv.kind : "";
    const reqName = sv.type_ref; // the requirement being satisfied/verified
    const implName = sv.name; // the satisfying/verifying element
    if (!reqName) continue;

    const reqNode = nodes.find(n => n.label === reqName);
    if (!reqNode) continue;

    // Find or create a node for the implementing element
    let implNode = nodes.find(n => n.label === implName);
    if (!implNode && implName) {
      const implEl = model.elements.find(e => e.name === implName);
      if (implEl) {
        const w = Math.max(textWidth(implName, 12), 140);
        const maxY = nodes.length > 0 ? Math.max(...nodes.map(n => n.y + n.height)) : 0;
        const implX = reqNode.x + reqNode.width + GAP_X * 2;
        const implY = reqNode.y;
        nodes.push({
          element_id: implEl.id, label: implName,
          kind: "block", x: implX, y: implY, width: w, height: H,
          color: "#3b82f6", children: [],
        });
        implNode = nodes[nodes.length - 1];
      }
    }

    if (implNode) {
      const edgeType = k === "satisfy_statement" ? "satisfy" : "verify";
      edges.push({
        from_id: reqNode.element_id, to_id: implNode.element_id,
        label: edgeType, edge_type: edgeType,
        points: [
          [reqNode.x + reqNode.width, reqNode.y + H / 2],
          [reqNode.x + reqNode.width + GAP_X * 0.4, reqNode.y + H / 2],
          [implNode.x - GAP_X * 0.4, implNode.y + H / 2],
          [implNode.x, implNode.y + H / 2],
        ],
      });
    }
  }

  const allX = nodes.map(n => n.x + n.width);
  const allY = nodes.map(n => n.y + n.height);
  return {
    diagram_type: "req", nodes, edges,
    bounds: [0, 0, Math.max(400, ...allX), Math.max(300, ...allY)],
  };
}

/** Browser-side Use Case Diagram layout */
export function browserUcdLayout(model: SysmlModel): DiagramLayout {
  const useCases = model.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return k === "use_case_def" || k === "use_case_usage";
  });
  const actors = model.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return (k === "part_def" && e.name && /actor/i.test(e.name));
  });
  const actions = useCases.length === 0
    ? model.elements.filter(e => typeof e.kind === "string" && e.kind === "action_def")
    : [];

  const allUseCases = [...useCases, ...actions];

  const W_ACTOR = 90, H_ACTOR = 110;
  const H_UC = 55, GAP = 30;

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  // Place actors on the left
  const totalActorH = actors.length * H_ACTOR + (actors.length - 1) * GAP;
  const totalUcH = allUseCases.length * (H_UC + GAP);
  const actorStartY = Math.max(30, (totalUcH - totalActorH) / 2 + 30);
  actors.forEach((a, i) => {
    nodes.push({
      element_id: a.id,
      label: a.name ?? "<unnamed>",
      kind: "actor",
      x: 30, y: actorStartY + i * (H_ACTOR + GAP),
      width: W_ACTOR, height: H_ACTOR,
      color: "#64748b",
      children: [],
    });
  });

  // Place use cases in the center with dynamic width
  const ucX = actors.length > 0 ? 30 + W_ACTOR + 80 : 80;
  allUseCases.forEach((uc, i) => {
    const w = Math.max(textWidth(uc.name ?? "<unnamed>", 11), 160);
    nodes.push({
      element_id: uc.id,
      label: uc.name ?? "<unnamed>",
      kind: "usecase",
      x: ucX, y: 30 + i * (H_UC + GAP),
      width: w, height: H_UC,
      color: "#8b5cf6",
      children: [],
    });
  });

  // Connect actors to use cases
  for (const actor of actors) {
    for (const uc of allUseCases) {
      if (uc.parent_id === actor.parent_id || actors.length === 1) {
        const actorNode = nodes.find(n => n.element_id === actor.id);
        const ucNode = nodes.find(n => n.element_id === uc.id);
        if (actorNode && ucNode) {
          edges.push({
            from_id: actor.id, to_id: uc.id,
            label: null, edge_type: "association",
            points: [
              [actorNode.x + W_ACTOR, actorNode.y + H_ACTOR / 2],
              [ucNode.x, ucNode.y + H_UC / 2],
            ],
          });
        }
      }
    }
  }

  if (actors.length === 0) {
    for (let i = 0; i < allUseCases.length; i++) {
      for (let j = i + 1; j < allUseCases.length; j++) {
        if (allUseCases[j].parent_id === allUseCases[i].id) {
          const from = nodes.find(n => n.element_id === allUseCases[i].id);
          const to = nodes.find(n => n.element_id === allUseCases[j].id);
          if (from && to) {
            edges.push({
              from_id: allUseCases[i].id, to_id: allUseCases[j].id,
              label: "include", edge_type: "include",
              points: [
                [from.x + from.width / 2, from.y + H_UC],
                [to.x + to.width / 2, to.y],
              ],
            });
          }
        }
      }
    }
  }

  // Add include relationship edges
  const includes = model.elements.filter(e =>
    typeof e.kind === "string" && e.kind === "include_statement"
  );
  for (const inc of includes) {
    const parentUc = allUseCases.find(uc => uc.id === inc.parent_id);
    const targetUc = allUseCases.find(uc => uc.name === inc.name);
    if (parentUc && targetUc) {
      const fromNode = nodes.find(n => n.element_id === parentUc.id);
      const toNode = nodes.find(n => n.element_id === targetUc.id);
      if (fromNode && toNode) {
        edges.push({
          from_id: parentUc.id, to_id: targetUc.id,
          label: "include", edge_type: "include",
          points: [
            [fromNode.x + fromNode.width / 2, fromNode.y + H_UC],
            [toNode.x + toNode.width / 2, toNode.y],
          ],
        });
      }
    }
  }

  const allX = nodes.length > 0 ? nodes.map(n => n.x + n.width) : [400];
  const allY = nodes.length > 0 ? nodes.map(n => n.y + n.height) : [300];
  return {
    diagram_type: "ucd", nodes, edges,
    bounds: [0, 0, Math.max(400, ...allX), Math.max(300, ...allY)],
  };
}

/** Browser-side Internal Block Diagram layout */
export function browserIbdLayout(model: SysmlModel, blockName?: string): DiagramLayout {
  // Find the target block definition
  const blockDef = blockName
    ? model.elements.find(e => typeof e.kind === "string" && e.kind === "part_def" && e.name === blockName)
    : model.elements.find(e => typeof e.kind === "string" && e.kind === "part_def");

  if (!blockDef) return { diagram_type: "ibd", nodes: [], edges: [], bounds: [0, 0, 400, 300] };

  // Get direct children: parts and ports
  const parts = model.elements.filter(e =>
    typeof e.kind === "string" && e.kind === "part_usage" && e.parent_id === blockDef.id
  );
  const ports = model.elements.filter(e =>
    typeof e.kind === "string" && e.kind === "port_usage" && e.parent_id === blockDef.id
  );
  const connections = model.elements.filter(e =>
    typeof e.kind === "string" &&
    (e.kind === "connection_usage" || e.kind === "connect_statement") &&
    e.parent_id === blockDef.id
  );

  const MARGIN = 50, PART_H = 55, PORT_SIZE = 22, GAP = 50;

  // Compute part widths based on label lengths
  const partWidths = parts.map(p => {
    const label = `${p.name ?? "?"} : ${p.type_ref ?? "?"}`;
    return Math.max(textWidth(label, 11), 140);
  });
  const PART_W = partWidths.length > 0 ? Math.max(...partWidths) : 140;

  const cols = Math.max(Math.ceil(Math.sqrt(parts.length)), 2);

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  // Container block
  const containerW = cols * (PART_W + GAP) + GAP + MARGIN * 2;
  const containerH = Math.ceil(parts.length / cols) * (PART_H + GAP) + GAP + PORT_SIZE * 2 + MARGIN * 2;
  nodes.push({
    element_id: blockDef.id,
    label: blockDef.name ?? "<unnamed>",
    kind: "block_container",
    x: 20, y: 20, width: containerW, height: containerH,
    color: "#3b82f6",
    children: [],
  });

  // Place parts inside the container in a grid
  const partColors = ["#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#ec4899", "#06b6d4"];
  parts.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    nodes.push({
      element_id: p.id,
      label: `${p.name ?? "?"} : ${p.type_ref ?? "?"}`,
      kind: "part",
      x: 20 + MARGIN + col * (PART_W + GAP),
      y: 20 + MARGIN + PORT_SIZE + row * (PART_H + GAP),
      width: PART_W, height: PART_H,
      color: partColors[i % partColors.length],
      children: [],
    });
  });

  // Place ports on the container boundary
  const portSpacing = containerW / (ports.length + 1);
  ports.forEach((p, i) => {
    const isTop = i % 2 === 0;
    nodes.push({
      element_id: p.id,
      label: p.name ?? "?",
      kind: "port",
      x: 20 + portSpacing * (i + 1) - PORT_SIZE / 2,
      y: isTop ? 20 - PORT_SIZE / 2 : 20 + containerH - PORT_SIZE / 2,
      width: PORT_SIZE, height: PORT_SIZE,
      color: "#8b5cf6",
      children: [],
    });
  });

  // First try explicit connect statements
  const connectedPairs = new Set<string>();
  for (const conn of connections) {
    if (conn.name && conn.type_ref) {
      // Parse "partName.portName" endpoints
      const fromParts = conn.name.split(".");
      const toParts = conn.type_ref.split(".");
      if (fromParts.length >= 1 && toParts.length >= 1) {
        const fromPartName = fromParts[0];
        const toPartName = toParts[0];
        const fromNode = nodes.find(n => n.kind === "part" && n.label.startsWith(fromPartName));
        const toNode = nodes.find(n => n.kind === "part" && n.label.startsWith(toPartName));
        if (fromNode && toNode) {
          const pairKey = [fromNode.element_id, toNode.element_id].sort().join("-");
          connectedPairs.add(pairKey);
          const label = fromParts[1] && toParts[1] ? `${fromParts[1]} - ${toParts[1]}` : null;
          edges.push({
            from_id: fromNode.element_id, to_id: toNode.element_id,
            label, edge_type: "connection",
            points: [
              [fromNode.x + PART_W, fromNode.y + PART_H / 2],
              [fromNode.x + PART_W + GAP * 0.3, fromNode.y + PART_H / 2],
              [toNode.x - GAP * 0.3, toNode.y + PART_H / 2],
              [toNode.x, toNode.y + PART_H / 2],
            ],
          });
        }
      }
    }
  }

  // Connect parts to each other based on matching port types
  // Simple heuristic: if two parts have ports of the same type, connect them
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      // Check if they share port types via their definitions
      const partIPorts = model.elements.filter(e =>
        typeof e.kind === "string" && e.kind === "port_usage" && e.parent_id === parts[i].id
      );
      const partJPorts = model.elements.filter(e =>
        typeof e.kind === "string" && e.kind === "port_usage" && e.parent_id === parts[j].id
      );

      // Also check ports defined on the type_ref definitions
      const defI = model.elements.find(e => e.name === parts[i].type_ref && typeof e.kind === "string" && e.kind === "part_def");
      const defJ = model.elements.find(e => e.name === parts[j].type_ref && typeof e.kind === "string" && e.kind === "part_def");
      const defIPorts = defI ? model.elements.filter(e => typeof e.kind === "string" && e.kind === "port_usage" && e.parent_id === defI.id) : [];
      const defJPorts = defJ ? model.elements.filter(e => typeof e.kind === "string" && e.kind === "port_usage" && e.parent_id === defJ.id) : [];

      const allIPorts = [...partIPorts, ...defIPorts];
      const allJPorts = [...partJPorts, ...defJPorts];

      for (const pi of allIPorts) {
        for (const pj of allJPorts) {
          if (pi.type_ref && pi.type_ref === pj.type_ref) {
            const nodeI = nodes.find(n => n.element_id === parts[i].id);
            const nodeJ = nodes.find(n => n.element_id === parts[j].id);
            if (nodeI && nodeJ) {
              const pairKey = [parts[i].id, parts[j].id].sort().join("-");
              if (connectedPairs.has(pairKey)) continue;
              connectedPairs.add(pairKey);
              edges.push({
                from_id: parts[i].id, to_id: parts[j].id,
                label: pi.type_ref, edge_type: "connection",
                points: [
                  [nodeI.x + PART_W, nodeI.y + PART_H / 2],
                  [nodeI.x + PART_W + GAP * 0.3, nodeI.y + PART_H / 2],
                  [nodeJ.x - GAP * 0.3, nodeJ.y + PART_H / 2],
                  [nodeJ.x, nodeJ.y + PART_H / 2],
                ],
              });
            }
          }
        }
      }
    }
  }

  return {
    diagram_type: "ibd", nodes, edges,
    bounds: [0, 0, containerW + 60, containerH + 60],
  };
}

/** Browser-side completeness check */
export function browserCompleteness(model: SysmlModel): CompletenessReport {
  const reqs = model.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return k === "requirement_def" || k === "requirement_usage";
  });
  const ports = model.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return k === "port_def" || k === "port_usage";
  });
  const usages = model.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return k.endsWith("_usage") && !k.startsWith("port") && !k.startsWith("enum");
  });

  // Check satisfy/verify relationships
  const satisfiedReqs = new Set<string>();
  const verifiedReqs = new Set<string>();
  for (const el of model.elements) {
    const k = typeof el.kind === "string" ? el.kind : "";
    if (k === "satisfy_statement" && el.type_ref) satisfiedReqs.add(el.type_ref);
    if (k === "verify_statement" && el.type_ref) verifiedReqs.add(el.type_ref);
  }

  const unsatisfied = reqs.filter(r => !satisfiedReqs.has(r.name ?? "")).map(r => r.id);
  const unverified = reqs.filter(r => !verifiedReqs.has(r.name ?? "")).map(r => r.id);

  // Check connected ports (via connect statements)
  const connectedPortNames = new Set<string>();
  for (const el of model.elements) {
    const k = typeof el.kind === "string" ? el.kind : "";
    if (k === "connect_statement") {
      if (el.name) el.name.split(".").forEach(p => connectedPortNames.add(p));
      if (el.type_ref) el.type_ref.split(".").forEach(p => connectedPortNames.add(p));
    }
  }
  const unconnected = ports.filter(p => !connectedPortNames.has(p.name ?? "")).map(p => p.id);

  // Check untyped usages
  const untyped = usages.filter(u => !u.type_ref).map(u => u.id);

  const totalChecks = reqs.length * 2 + ports.length + usages.length;
  const passedChecks = (reqs.length - unsatisfied.length) + (reqs.length - unverified.length) + (ports.length - unconnected.length) + (usages.length - untyped.length);
  const score = totalChecks > 0 ? passedChecks / totalChecks : 1.0;

  return {
    unsatisfied_requirements: unsatisfied,
    unverified_requirements: unverified,
    unconnected_ports: unconnected,
    untyped_usages: untyped,
    score,
    summary: [
      { label: "Requirements Satisfied", total: reqs.length, complete: reqs.length - unsatisfied.length },
      { label: "Requirements Verified", total: reqs.length, complete: reqs.length - unverified.length },
      { label: "Ports Connected", total: ports.length, complete: ports.length - unconnected.length },
      { label: "Usages Typed", total: usages.length, complete: usages.length - untyped.length },
    ],
  };
}

/** Browser-side traceability */
export function browserTraceability(model: SysmlModel): TraceabilityEntry[] {
  const reqs = model.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return k === "requirement_def" || k === "requirement_usage";
  });

  return reqs.map(r => {
    const satisfied: TraceLink[] = [];
    const verified: TraceLink[] = [];

    for (const el of model.elements) {
      const k = typeof el.kind === "string" ? el.kind : "";
      if (k === "satisfy_statement" && el.type_ref === r.name && el.name) {
        const impl = model.elements.find(e => e.name === el.name);
        if (impl) {
          satisfied.push({
            element_id: impl.id,
            element_name: impl.name ?? "<unnamed>",
            element_kind: typeof impl.kind === "string" ? impl.kind : "other",
          });
        }
      }
      if (k === "verify_statement" && el.type_ref === r.name && el.name) {
        const impl = model.elements.find(e => e.name === el.name);
        if (impl) {
          verified.push({
            element_id: impl.id,
            element_name: impl.name ?? "<unnamed>",
            element_kind: typeof impl.kind === "string" ? impl.kind : "other",
          });
        }
      }
    }

    return {
      requirement_id: r.id,
      requirement_name: r.name ?? "<unnamed>",
      satisfied_by: satisfied,
      verified_by: verified,
      allocated_to: [],
    };
  });
}

/** Browser-side model validation */
export function browserValidation(model: SysmlModel): ValidationReport {
  const issues: ValidationIssue[] = [];
  const allNames = new Set(model.elements.filter(e => e.name).map(e => e.name!));
  const idSet = new Set(model.elements.map(e => e.id));

  for (const el of model.elements) {
    const k = typeof el.kind === "string" ? el.kind : "";

    // Missing type reference for usages
    if (k.endsWith("_usage") && !k.startsWith("enum") && !k.startsWith("state") && !el.type_ref) {
      issues.push({
        element_id: el.id, severity: "warning",
        message: `${el.name ?? "Element"} has no type reference`,
        category: "missing_type",
      });
    }

    // Unresolved type reference
    if (el.type_ref && !allNames.has(el.type_ref)) {
      // Check if it's a stdlib type
      const isStdlib = /^[A-Z]/.test(el.type_ref);
      if (!isStdlib) {
        issues.push({
          element_id: el.id, severity: "error",
          message: `Type "${el.type_ref}" not found in model`,
          category: "unresolved_ref",
        });
      }
    }

    // Empty definitions (no children)
    if ((k.endsWith("_def") || k === "package") && el.children_ids.length === 0) {
      issues.push({
        element_id: el.id, severity: "info",
        message: `${el.name ?? "Definition"} has no members`,
        category: "incomplete",
      });
    }

    // Orphaned elements (parent doesn't exist)
    if (el.parent_id !== null && !idSet.has(el.parent_id)) {
      issues.push({
        element_id: el.id, severity: "error",
        message: `Parent element (id ${el.parent_id}) not found`,
        category: "orphan",
      });
    }
  }

  // Circular dependency detection via type_ref chains
  const typeRefMap = new Map<string, string>();
  for (const el of model.elements) {
    if (el.name && el.type_ref) typeRefMap.set(el.name, el.type_ref);
  }
  for (const [startName] of typeRefMap) {
    const visited = new Set<string>();
    let current: string | undefined = startName;
    while (current && !visited.has(current)) {
      visited.add(current);
      current = typeRefMap.get(current);
    }
    if (current && visited.has(current) && current === startName) {
      const el = model.elements.find(e => e.name === startName);
      if (el) {
        issues.push({
          element_id: el.id, severity: "error",
          message: `Circular type reference detected: ${startName}`,
          category: "circular_dep",
        });
      }
    }
  }

  const errors = issues.filter(i => i.severity === "error").length;
  const warnings = issues.filter(i => i.severity === "warning").length;
  const infos = issues.filter(i => i.severity === "info").length;

  return { issues, summary: { errors, warnings, infos } };
}
