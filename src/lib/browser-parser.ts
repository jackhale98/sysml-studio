/**
 * Browser-side SysML parser fallback.
 * When running outside Tauri (e.g. in Safari via Vite dev server),
 * this regex-based parser provides element extraction so the UI is fully functional.
 */
import type {
  SysmlModel, SysmlElement, ElementId, SourceSpan,
  Category, ParseError, DiagramLayout, DiagramNode, DiagramEdge,
  Compartment, CompletenessReport, TraceabilityEntry, TraceLink,
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
  [/^part\s+(\w+)(?:\[[^\]]*\])?\s*:\s*~?\s*([\w:]+)/, "part_usage", "structure"],
  [/^attribute\s+(\w+)(?:\[[^\]]*\])?\s*(?::>|:)\s*~?\s*([\w:]+)/, "attribute_usage", "property"],
  [/^port\s+(\w+)(?:\[[^\]]*\])?\s*:\s*~?\s*([\w:]+)/, "port_usage", "interface"],
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
  [/^use\s+case\s+(\w+)\s*[;{]/, "use_case_usage", "behavior"],
];

const OTHER_PATTERNS: [RegExp, string, Category][] = [
  [/^transition\s+(?:(\w+)(?:\s|;|$))?\s*(?:first\s+(\w+)\s*(?:accept\s+(\w+))?\s*then\s+(\w+))?/, "transition_statement", "behavior"],
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

    // Extract short name <alias> if present, and strip it for pattern matching
    let shortName: string | null = null;
    let matchLine = trimmed;
    const snMatch = trimmed.match(/(\w)\s+<([\w\-]+)>/);
    if (snMatch) {
      shortName = snMatch[2];
      matchLine = trimmed.replace(/\s*<[\w\-]+>/, "");
    }

    let matched = false;

    // Try definition patterns
    for (const [pat, kind, category] of DEF_PATTERNS) {
      const m = matchLine.match(pat);
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
          modifiers: [], multiplicity: null, doc: null, short_name: shortName, value_expr: null,
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
        const m = matchLine.match(pat);
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
          // Extract value expression: `= <value>` at end of line
          const valMatch = matchLine.match(/=\s*([^;{]+?)\s*[;{]?\s*$/);
          const valueExpr = valMatch ? valMatch[1].trim() : null;
          // Extract multiplicity: `[N]` or `[0..N]`
          const multMatch = matchLine.match(/\[([^\]]+)\]/);
          const multiplicity = multMatch ? multMatch[1].trim() : null;

          const el: SysmlElement = {
            id: ctx.nextId++, kind: kind as any, name: m[1], qualified_name: qname,
            category: category as Category, parent_id: parentId, children_ids: [],
            span: makeSpan(i, 0, lines[i].length), type_ref: typeRef, specializations,
            modifiers: [], multiplicity, doc: null, short_name: shortName, value_expr: valueExpr,
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
        const m = matchLine.match(pat);
        if (m) {
          const parentId = ctx.stack.length > 0 ? ctx.stack[ctx.stack.length - 1].id : null;
          let name = m[1] ?? null;
          let typeRef: string | null = null;
          let specializations: string[] = [];
          let triggerExpr: string | null = null;

          if (kind === "satisfy_statement" || kind === "verify_statement") {
            // m[1] = requirement name, m[2] = optional "by" target
            typeRef = m[1] ?? null;
            name = m[2] ?? null; // name is only the "by" target, null if none
          } else if (kind === "connect_statement") {
            name = m[1];
            typeRef = m[2];
          } else if (kind === "transition_statement") {
            name = m[1] ?? null;
            // Convention: specializations[0] = source ("first"), type_ref = target ("then")
            // Groups: m[1]=name, m[2]=source, m[3]=trigger (accept), m[4]=target
            specializations = m[2] ? [m[2]] : [];
            typeRef = m[4] ?? null;
            // Store trigger signal in value_expr for browser-side state machine extraction
            triggerExpr = m[3] ?? null;
          }

          const qname = ctx.stack.map(s => s.name).concat(name ?? "<unnamed>").join("::");
          const el: SysmlElement = {
            id: ctx.nextId++, kind: kind as any, name, qualified_name: qname,
            category: category as Category, parent_id: parentId, children_ids: [],
            span: makeSpan(i, 0, lines[i].length), type_ref: typeRef, specializations,
            modifiers: [], multiplicity: null, doc: null, short_name: shortName, value_expr: triggerExpr,
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
        const acceptMatch = lookAhead.match(/accept\s+(\w+)/);
        if (firstMatch) {
          el.specializations = [firstMatch[1]];  // source state
        }
        if (acceptMatch && !el.value_expr) {
          el.value_expr = acceptMatch[1];  // trigger signal
        }
        if (thenMatch) {
          el.type_ref = thenMatch[1];  // target state
        }
        // Stop once we've found the first/then data
        if (el.specializations.length > 0 && el.type_ref !== null) break;
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

/** Smart edge routing between two nodes based on relative position */
function connectNodes(from: DiagramNode, to: DiagramNode): [number, number][] {
  const fromCy = from.y + from.height / 2;
  const toCy = to.y + to.height / 2;
  if (Math.abs(fromCy - toCy) < from.height) {
    // Same row: connect horizontally
    return from.x < to.x
      ? [[from.x + from.width, fromCy], [to.x, toCy]]
      : [[from.x, fromCy], [to.x + to.width, toCy]];
  } else if (from.y < to.y) {
    return [[from.x + from.width / 2, from.y + from.height], [to.x + to.width / 2, to.y]];
  } else {
    return [[from.x + from.width / 2, from.y], [to.x + to.width / 2, to.y + to.height]];
  }
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

  const BASE_H = 34, GAP_X = 40, GAP_Y = 120;

  // SysML v2 stereotype labels
  const stereoLabel = (kind: string): string => {
    const map: Record<string, string> = {
      part_def: "\u00ABpart def\u00BB", item_def: "\u00ABitem def\u00BB",
      attribute_def: "\u00ABattribute def\u00BB", port_def: "\u00ABport def\u00BB",
    };
    return map[kind] ?? "\u00ABblock\u00BB";
  };

  type TreeNode = { def: SysmlElement; children: TreeNode[]; usageNames: Map<number, string>; usageMults: Map<number, string | null>; w: number; h: number; compartments: Compartment[] };

  const defById = new Map(defs.map(d => [d.id, d]));
  const defByName = new Map(defs.map(d => [d.name ?? "", d]));

  const childrenOf = new Map<number, { usageName: string; childDef: SysmlElement; mult: string | null }[]>();
  const hasParent = new Set<number>();

  // Track placeholder defs created for unresolved type refs
  let nextPlaceholderId = -1;

  for (const el of model.elements) {
    const k = typeof el.kind === "string" ? el.kind : "";
    if (k === "part_usage" && el.parent_id !== null) {
      let parentDefId = el.parent_id;
      let parentDef = defById.get(parentDefId);
      if (!parentDef) {
        const parentEl = model.elements.find(e => e.id === el.parent_id);
        if (parentEl && parentEl.parent_id !== null) {
          parentDef = defById.get(parentEl.parent_id);
          if (parentDef) parentDefId = parentDef.id;
        }
      }

      if (!parentDef) continue;

      if (el.type_ref) {
        // Has a type ref — find or create the target definition
        let childDef = defByName.get(el.type_ref);
        if (!childDef) {
          // Create a placeholder node for the unresolved type
          const placeholderDef: SysmlElement = {
            id: nextPlaceholderId--, kind: "part_def" as any,
            name: el.type_ref, qualified_name: el.type_ref,
            category: "structure", parent_id: null, children_ids: [],
            span: { start_line: 0, start_col: 0, end_line: 0, end_col: 0, start_byte: 0, end_byte: 0 },
            type_ref: null, specializations: [], modifiers: [],
            multiplicity: null, doc: null, short_name: null, value_expr: null,
          };
          defs.push(placeholderDef);
          defById.set(placeholderDef.id, placeholderDef);
          defByName.set(el.type_ref, placeholderDef);
          childDef = placeholderDef;
        }
        if (parentDef.id !== childDef.id) {
          if (!childrenOf.has(parentDef.id)) childrenOf.set(parentDef.id, []);
          childrenOf.get(parentDef.id)!.push({ usageName: el.name ?? el.type_ref, childDef, mult: el.multiplicity });
          hasParent.add(childDef.id);
        }
      } else {
        // No type ref — show the usage itself as a node under the parent
        const usageNode: SysmlElement = {
          id: el.id, kind: el.kind, name: el.name,
          qualified_name: el.qualified_name, category: el.category,
          parent_id: el.parent_id, children_ids: el.children_ids,
          span: el.span, type_ref: el.type_ref, specializations: el.specializations,
          modifiers: el.modifiers, multiplicity: el.multiplicity,
          doc: el.doc, short_name: el.short_name, value_expr: el.value_expr,
        };
        defs.push(usageNode);
        defById.set(usageNode.id, usageNode);
        if (!childrenOf.has(parentDef.id)) childrenOf.set(parentDef.id, []);
        childrenOf.get(parentDef.id)!.push({ usageName: el.name ?? "<unnamed>", childDef: usageNode, mult: el.multiplicity });
        hasParent.add(usageNode.id);
      }
    }
  }

  const roots = defs.filter(d => !hasParent.has(d.id));

  const visited = new Set<number>();
  function buildTree(def: SysmlElement): TreeNode {
    visited.add(def.id);
    const kids = childrenOf.get(def.id) ?? [];
    const usageNames = new Map<number, string>();
    const usageMults = new Map<number, string | null>();
    const childTrees: TreeNode[] = [];
    for (const { usageName, childDef, mult } of kids) {
      if (!visited.has(childDef.id)) {
        usageNames.set(childDef.id, usageName);
        usageMults.set(childDef.id, mult);
        childTrees.push(buildTree(childDef));
      }
    }

    // Build compartments from child attribute and port usages
    const compartments: Compartment[] = [];
    const attrs = model.elements.filter(
      e => e.parent_id === def.id && typeof e.kind === "string" && e.kind === "attribute_usage"
    ).map(e => {
      const n = e.name ?? "<unnamed>";
      const val = e.value_expr ? ` = ${e.value_expr}` : "";
      return e.type_ref ? `${n} : ${e.type_ref}${val}` : `${n}${val}`;
    });
    if (attrs.length > 0) compartments.push({ heading: "attributes", entries: attrs });

    const ports = model.elements.filter(
      e => e.parent_id === def.id && typeof e.kind === "string" && e.kind === "port_usage"
    ).map(e => {
      const n = e.name ?? "<unnamed>";
      const dir = e.modifiers.find(m => m === "in" || m === "out" || m === "inout");
      if (e.type_ref && dir) return `${dir} ${n} : ${e.type_ref}`;
      if (e.type_ref) return `${n} : ${e.type_ref}`;
      if (dir) return `${dir} ${n}`;
      return n;
    });
    if (ports.length > 0) compartments.push({ heading: "ports", entries: ports });

    // Compute width: max of label, compartment entries
    const labelW = textWidth(def.name ?? "<unnamed>", 13);
    const compMaxW = compartments.reduce((max, c) =>
      Math.max(max, ...c.entries.map(e => textWidth(e, 10))), 0);
    const w = Math.max(labelW, compMaxW + 20, 130);

    // Compute height: base header + compartments
    const compH = compartments.reduce((sum, c) => sum + 16 + c.entries.length * 14, 0);
    const h = Math.max(BASE_H + compH, 50);

    return { def, children: childTrees, usageNames, usageMults, w, h, compartments };
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
    const nodeH = tree.h;
    const nodeX = x + (availableWidth - nodeW) / 2;
    const nodeY = y;
    const kind = typeof tree.def.kind === "string" ? tree.def.kind : "";

    nodes.push({
      element_id: tree.def.id,
      label: tree.def.name ?? "<unnamed>",
      kind: "block",
      x: nodeX, y: nodeY, width: nodeW, height: nodeH,
      color: colors[kind] ?? "#94a3b8",
      children: [],
      stereotype: stereoLabel(kind),
      compartments: tree.compartments.length > 0 ? tree.compartments : undefined,
    });

    if (tree.children.length > 0) {
      const childPixelWidths = tree.children.map(c => subtreePixelWidth(c));
      const totalChildWidth = childPixelWidths.reduce((a, b) => a + b, 0) + (tree.children.length - 1) * GAP_X;
      let childX = x + (availableWidth - totalChildWidth) / 2;

      for (let ci = 0; ci < tree.children.length; ci++) {
        const child = tree.children[ci];
        const childAvailWidth = childPixelWidths[ci];

        positionTree(child, childX, y + nodeH + GAP_Y, childAvailWidth);

        const childNodeW = child.w;
        const childNodeX = childX + (childAvailWidth - childNodeW) / 2;
        const usageName = tree.usageNames.get(child.def.id);
        const mult = tree.usageMults.get(child.def.id);
        const edgeLabel = usageName && mult ? `${usageName} [${mult}]`
          : usageName ?? (mult ? `[${mult}]` : null);

        // Edge: vertical from parent bottom center, route to child top center
        const parentCx = nodeX + nodeW / 2;
        const childCx = childNodeX + childNodeW / 2;
        const midY = nodeY + nodeH + GAP_Y * 0.45;

        edges.push({
          from_id: tree.def.id, to_id: child.def.id,
          label: edgeLabel, edge_type: "composition",
          points: [
            [parentCx, nodeY + nodeH],
            [parentCx, midY],
            [childCx, midY],
            [childCx, y + nodeH + GAP_Y],
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
        x: forestX, y: 30, width: w, height: 50,
        color: colors[kind] ?? "#94a3b8",
        children: [],
        stereotype: stereoLabel(kind),
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

    // Prefer parsed first/then data: specializations[0] = source, type_ref = target
    if (t.type_ref && t.specializations.length > 0) {
      fromLabel = t.specializations[0];
      toLabel = t.type_ref;
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

  // Determine the rightmost x of all existing nodes for impl block placement
  const implColumnX = nodes.length > 0
    ? Math.max(...nodes.map(n => n.x + n.width)) + GAP_X * 2
    : 300;
  let nextImplY = 30;

  for (const sv of satisfyVerify) {
    const k = typeof sv.kind === "string" ? sv.kind : "";
    const reqName = sv.type_ref; // the requirement being satisfied/verified
    if (!reqName) continue;

    // The implementing element is the parent of the satisfy/verify statement
    // e.g. "part def VehicleDesign { satisfy MaxSpeed; }" → VehicleDesign satisfies MaxSpeed
    const implEl = sv.name
      ? model.elements.find(e => e.name === sv.name)
      : (sv.parent_id !== null ? model.elements.find(e => e.id === sv.parent_id) : null);
    const implName = implEl?.name;
    if (!implName) continue;

    const reqNode = nodes.find(n => n.label === reqName);
    if (!reqNode) continue;

    // Find or create a node for the implementing element
    let implNode = nodes.find(n => n.label === implName);
    if (!implNode) {
      const w = Math.max(textWidth(implName, 12), 140);
      nodes.push({
        element_id: implEl!.id, label: implName,
        kind: "block", x: implColumnX, y: nextImplY, width: w, height: H,
        color: "#3b82f6", children: [],
      });
      implNode = nodes[nodes.length - 1];
      nextImplY += H + 30;
    }

    // Skip duplicate edge (same impl → same req)
    const edgeType = k === "satisfy_statement" ? "satisfy" : "verify";
    const alreadyHasEdge = edges.some(e =>
      e.from_id === implNode!.element_id && e.to_id === reqNode.element_id && e.edge_type === edgeType
    );
    if (alreadyHasEdge) continue;

    // Route edge: impl left side → req right side, with waypoints
    const midX = (reqNode.x + reqNode.width + implNode.x) / 2;
    edges.push({
      from_id: implNode.element_id, to_id: reqNode.element_id,
      label: edgeType, edge_type: edgeType,
      points: [
        [implNode.x, implNode.y + H / 2],
        [midX, implNode.y + H / 2],
        [midX, reqNode.y + H / 2],
        [reqNode.x + reqNode.width, reqNode.y + H / 2],
      ],
    });
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
  // Collect defs first, then usages that don't duplicate a def by name
  const ucDefs = model.elements.filter(e => typeof e.kind === "string" && e.kind === "use_case_def");
  const defNames = new Set(ucDefs.map(e => e.name).filter(Boolean));
  const ucUsages = model.elements.filter(e =>
    typeof e.kind === "string" && e.kind === "use_case_usage" && !defNames.has(e.name)
  );
  const useCases = [...ucDefs, ...ucUsages];
  const actions = useCases.length === 0
    ? model.elements.filter(e => typeof e.kind === "string" && e.kind === "action_def")
    : [];

  const allUseCases = [...useCases, ...actions];

  // Collect unique actor types from actor_declarations inside use cases
  const actorDecls = model.elements.filter(e =>
    typeof e.kind === "string" && e.kind === "actor_declaration"
  );
  const actorTypeMap = new Map<string, { label: string; id: ElementId }>();
  for (const ad of actorDecls) {
    const label = ad.type_ref ?? ad.name ?? "<unnamed>";
    if (!actorTypeMap.has(label)) {
      const typeEl = model.elements.find(e => e.name === label);
      actorTypeMap.set(label, { label, id: typeEl?.id ?? ad.id });
    }
  }
  // Also pick up part defs with "actor" in name
  for (const el of model.elements) {
    const k = typeof el.kind === "string" ? el.kind : "";
    if (k === "part_def" && el.name && /actor/i.test(el.name)) {
      if (!actorTypeMap.has(el.name)) {
        actorTypeMap.set(el.name, { label: el.name, id: el.id });
      }
    }
  }
  const actorTypes = Array.from(actorTypeMap.values());

  const W_ACTOR = 90, H_ACTOR = 110;
  const H_UC = 55, GAP = 30;

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  // Place actors on the left
  const totalActorH = actorTypes.length * H_ACTOR + (actorTypes.length - 1) * GAP;
  const totalUcH = allUseCases.length * (H_UC + GAP);
  const actorStartY = Math.max(30, (totalUcH - totalActorH) / 2 + 30);
  actorTypes.forEach((a, i) => {
    nodes.push({
      element_id: a.id,
      label: a.label,
      kind: "actor",
      x: 30, y: actorStartY + i * (H_ACTOR + GAP),
      width: W_ACTOR, height: H_ACTOR,
      color: "#64748b",
      children: [],
    });
  });

  // Place use cases in the center with dynamic width
  const ucX = actorTypes.length > 0 ? 30 + W_ACTOR + 80 : 80;
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

  // Connect actors to their use cases via actor_declarations
  for (const ad of actorDecls) {
    const actorLabel = ad.type_ref ?? ad.name ?? "";
    const actorNode = nodes.find(n => n.kind === "actor" && n.label === actorLabel);
    const ucNode = ad.parent_id != null ? nodes.find(n => n.element_id === ad.parent_id) : null;
    if (actorNode && ucNode) {
      edges.push({
        from_id: actorNode.element_id, to_id: ucNode.element_id,
        label: null, edge_type: "association",
        points: [
          [actorNode.x + W_ACTOR, actorNode.y + H_ACTOR / 2],
          [ucNode.x, ucNode.y + H_UC / 2],
        ],
      });
    }
  }

  // Add include relationship edges
  const includes = model.elements.filter(e =>
    typeof e.kind === "string" && e.kind === "include_statement"
  );
  for (const inc of includes) {
    const parentUc = allUseCases.find(uc => uc.id === inc.parent_id);
    const targetUc = allUseCases.find(uc => uc.name === inc.type_ref);
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
  // Find the target block definition; if blockName matches a part_usage, resolve via type_ref
  let blockDef = blockName
    ? model.elements.find(e => typeof e.kind === "string" && e.kind === "part_def" && e.name === blockName)
    : undefined;

  if (!blockDef && blockName) {
    const usage = model.elements.find(e => typeof e.kind === "string" && e.kind === "part_usage" && e.name === blockName);
    if (usage?.type_ref) {
      blockDef = model.elements.find(e => typeof e.kind === "string" && e.kind === "part_def" && e.name === usage.type_ref);
    }
  }

  if (!blockDef) {
    // Default: first part_def that has child parts/ports
    blockDef = model.elements.find(e =>
      typeof e.kind === "string" && e.kind === "part_def" &&
      model.elements.some(c => typeof c.kind === "string" && c.parent_id === e.id &&
        (c.kind === "part_usage" || c.kind === "port_usage" || c.kind === "attribute_usage"))
    ) ?? model.elements.find(e => typeof e.kind === "string" && e.kind === "part_def");
  }

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
    (e.kind === "connection_usage" || e.kind === "connect_statement" || e.kind === "interface_usage") &&
    (e.parent_id === blockDef.id || model.elements.some(p => p.id === e.parent_id && p.parent_id === blockDef.id))
  );
  const flows = model.elements.filter(e =>
    typeof e.kind === "string" && e.kind === "flow_statement" &&
    e.specializations && e.specializations.length >= 2
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

  // Helper to find a node by part/port name
  const partNames = new Set(parts.map(p => p.name).filter(Boolean));
  const portNames = new Set(ports.map(p => p.name).filter(Boolean));
  const findNode = (name: string) =>
    nodes.find(n => n.kind !== "block_container" && (n.label === name || n.label.startsWith(name + " :")));

  const connectedPairs = new Set<string>();

  // Connect statements and connection usages with parsed source/target in specializations
  for (const conn of connections) {
    if (conn.specializations && conn.specializations.length >= 2) {
      const srcName = conn.specializations[0].split(".")[0];
      const tgtName = conn.specializations[1].split(".")[0];
      if (!partNames.has(srcName) && !portNames.has(srcName)) continue;
      if (!partNames.has(tgtName) && !portNames.has(tgtName)) continue;

      const fromNode = findNode(srcName);
      const toNode = findNode(tgtName);
      if (fromNode && toNode && fromNode.element_id !== toNode.element_id) {
        const pairKey = [fromNode.element_id, toNode.element_id].sort().join("-");
        if (connectedPairs.has(pairKey)) continue;
        connectedPairs.add(pairKey);
        const srcPort = conn.specializations[0].split(".")[1] ?? "";
        const tgtPort = conn.specializations[1].split(".")[1] ?? "";
        const label = conn.name ?? (srcPort || tgtPort
          ? `${srcPort || srcName} → ${tgtPort || tgtName}` : null);
        edges.push({
          from_id: fromNode.element_id, to_id: toNode.element_id,
          label, edge_type: "connection",
          points: connectNodes(fromNode, toNode),
        });
      }
    } else if (conn.type_ref) {
      // Fallback: parent → type_ref
      const fromNode = conn.parent_id != null ? nodes.find(n => n.element_id === conn.parent_id) : undefined;
      const toNode = findNode(conn.type_ref);
      if (fromNode && toNode && fromNode.element_id !== toNode.element_id) {
        const pairKey = [fromNode.element_id, toNode.element_id].sort().join("-");
        if (connectedPairs.has(pairKey)) continue;
        connectedPairs.add(pairKey);
        edges.push({
          from_id: fromNode.element_id, to_id: toNode.element_id,
          label: conn.name ?? null, edge_type: "connection",
          points: connectNodes(fromNode, toNode),
        });
      }
    }
  }

  // Flow edges
  for (const flow of flows) {
    const srcName = flow.specializations![0].split(".")[0];
    const tgtName = flow.specializations![1].split(".")[0];
    if (!partNames.has(srcName) && !portNames.has(srcName)) continue;
    if (!partNames.has(tgtName) && !portNames.has(tgtName)) continue;

    const fromNode = findNode(srcName);
    const toNode = findNode(tgtName);
    if (fromNode && toNode && fromNode.element_id !== toNode.element_id) {
      const label = flow.name ?? (flow.type_ref ? `«${flow.type_ref}»` : null);
      edges.push({
        from_id: fromNode.element_id, to_id: toNode.element_id,
        label, edge_type: "flow",
        points: connectNodes(fromNode, toNode),
      });
    }
  }

  // Port direction indicators
  for (const portNode of nodes.filter(n => n.kind === "port")) {
    const portEl = model.elements.find(e => e.id === portNode.element_id);
    if (portEl?.modifiers?.includes("in")) {
      portNode.label = `→ ${portNode.label}`;
    } else if (portEl?.modifiers?.includes("out")) {
      portNode.label = `${portNode.label} →`;
    } else if (portEl?.modifiers?.includes("inout")) {
      portNode.label = `↔ ${portNode.label}`;
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
      if (k === "satisfy_statement" && el.type_ref === r.name) {
        // "by" clause names the implementing element; otherwise use parent
        const impl = el.name
          ? model.elements.find(e => e.name === el.name)
          : (el.parent_id !== null ? model.elements.find(e => e.id === el.parent_id) : null);
        if (impl) {
          satisfied.push({
            element_id: impl.id,
            element_name: impl.name ?? "<unnamed>",
            element_kind: typeof impl.kind === "string" ? impl.kind : "other",
          });
        }
      }
      if (k === "verify_statement" && el.type_ref === r.name) {
        const impl = el.name
          ? model.elements.find(e => e.name === el.name)
          : (el.parent_id !== null ? model.elements.find(e => e.id === el.parent_id) : null);
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
