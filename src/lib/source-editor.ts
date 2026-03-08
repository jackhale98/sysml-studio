/**
 * Source text manipulation utilities.
 * Works with parsed element spans to insert, edit, and delete SysML source.
 */
import type { SysmlElement, SysmlModel } from "./element-types";

/** Generate SysML source text for a new element */
export function generateElementSource(opts: {
  kind: string;
  name: string;
  typeRef?: string;
  doc?: string;
  children?: string[];
}): string {
  const { kind, name, typeRef, doc, children } = opts;
  const lines: string[] = [];

  // Map kind to SysML keyword syntax
  const keyword = kindToKeyword(kind);

  if (isDefinition(kind)) {
    lines.push(`${keyword} ${name} {`);
    if (doc) {
      lines.push(`  doc /* ${doc} */`);
    }
    if (children) {
      for (const child of children) {
        lines.push(`  ${child}`);
      }
    }
    lines.push(`}`);
  } else if (isUsage(kind)) {
    if (typeRef) {
      lines.push(`${keyword} ${name} : ${typeRef};`);
    } else {
      lines.push(`${keyword} ${name};`);
    }
  } else if (kind === "satisfy_statement") {
    lines.push(`satisfy ${name};`);
  } else if (kind === "verify_statement") {
    lines.push(`verify ${name};`);
  } else {
    // Generic fallback
    if (typeRef) {
      lines.push(`${keyword} ${name} : ${typeRef};`);
    } else {
      lines.push(`${keyword} ${name};`);
    }
  }

  return lines.join("\n");
}

/** Insert a new element into the source at the right location */
export function insertElement(
  source: string,
  newElementSource: string,
  parentElement: SysmlElement | null,
  model: SysmlModel,
): string {
  const lines = source.split("\n");

  if (parentElement) {
    // Find the closing brace of the parent element
    const insertLine = findClosingBrace(lines, parentElement.span.start_line);
    if (insertLine >= 0) {
      // Detect indentation of parent's children
      const indent = getChildIndent(lines, parentElement.span.start_line, insertLine);
      const indented = newElementSource.split("\n").map(l => indent + l).join("\n");
      lines.splice(insertLine, 0, "", indented);
      return lines.join("\n");
    }
  }

  // No parent or couldn't find brace — append before the last closing brace of the file,
  // or at the end
  const lastBrace = findLastTopLevelBrace(lines);
  if (lastBrace >= 0) {
    const indented = newElementSource.split("\n").map(l => "  " + l).join("\n");
    lines.splice(lastBrace, 0, "", indented);
  } else {
    lines.push("", newElementSource);
  }
  return lines.join("\n");
}

/** Edit an element's name and/or type reference in the source */
export function editElement(
  source: string,
  element: SysmlElement,
  changes: { name?: string; typeRef?: string; doc?: string },
): string {
  const lines = source.split("\n");
  const lineIdx = element.span.start_line;

  if (lineIdx >= lines.length) return source;

  let line = lines[lineIdx];

  // Replace name
  if (changes.name && element.name && changes.name !== element.name) {
    // Replace the first occurrence of the old name on this line
    line = line.replace(element.name, changes.name);
  }

  // Replace type reference
  if (changes.typeRef !== undefined && element.type_ref !== changes.typeRef) {
    if (element.type_ref && changes.typeRef) {
      // Replace existing type ref
      line = line.replace(`: ${element.type_ref}`, `: ${changes.typeRef}`);
      line = line.replace(`:${element.type_ref}`, `:${changes.typeRef}`);
    } else if (!element.type_ref && changes.typeRef) {
      // Add type ref before semicolon or brace
      line = line.replace(/(\s*)(;|{)/, ` : ${changes.typeRef}$1$2`);
    }
  }

  lines[lineIdx] = line;

  // Handle doc comment changes
  if (changes.doc !== undefined) {
    const docLineIdx = findDocLine(lines, lineIdx, element.span.end_line);
    if (docLineIdx >= 0 && changes.doc) {
      // Replace existing doc
      lines[docLineIdx] = lines[docLineIdx].replace(
        /doc\s+\/\*.*?\*\//,
        `doc /* ${changes.doc} */`
      );
    } else if (docLineIdx >= 0 && !changes.doc) {
      // Remove doc line
      lines.splice(docLineIdx, 1);
    } else if (changes.doc && isDefinition(typeof element.kind === "string" ? element.kind : "")) {
      // Add doc line after the opening brace
      const indent = getLineIndent(lines[lineIdx]) + "  ";
      lines.splice(lineIdx + 1, 0, `${indent}doc /* ${changes.doc} */`);
    }
  }

  return lines.join("\n");
}

/** Delete an element from the source */
export function deleteElement(
  source: string,
  element: SysmlElement,
): string {
  const lines = source.split("\n");
  const startLine = element.span.start_line;
  let endLine = element.span.end_line;

  // For definitions with braces, find the matching closing brace
  if (isDefinition(typeof element.kind === "string" ? element.kind : "")) {
    const closingBrace = findClosingBrace(lines, startLine);
    if (closingBrace >= 0) endLine = closingBrace;
  }

  // Clamp
  const safeStart = Math.max(0, startLine);
  const safeEnd = Math.min(lines.length - 1, endLine);

  // Remove lines and any trailing blank line
  const deleteCount = safeEnd - safeStart + 1;
  lines.splice(safeStart, deleteCount);

  // Clean up consecutive blank lines
  if (safeStart < lines.length && safeStart > 0 &&
    lines[safeStart - 1].trim() === "" && lines[safeStart]?.trim() === "") {
    lines.splice(safeStart, 1);
  }

  return lines.join("\n");
}

/** Get potential parent elements where a new element can be inserted */
export function getInsertTargets(model: SysmlModel): SysmlElement[] {
  return model.elements.filter(e => {
    const k = typeof e.kind === "string" ? e.kind : "";
    return k === "package" || isDefinition(k) || isUsage(k);
  });
}

// ─── Helpers ───

function kindToKeyword(kind: string): string {
  const map: Record<string, string> = {
    package: "package",
    part_def: "part def", part_usage: "part",
    attribute_def: "attribute def", attribute_usage: "attribute",
    port_def: "port def", port_usage: "port",
    connection_def: "connection def", connection_usage: "connection",
    interface_def: "interface def", interface_usage: "interface",
    item_def: "item def", item_usage: "item",
    action_def: "action def", action_usage: "action",
    state_def: "state def", state_usage: "state",
    constraint_def: "constraint def", constraint_usage: "constraint",
    requirement_def: "requirement def", requirement_usage: "requirement",
    use_case_def: "use case def", use_case_usage: "use case",
    allocation_def: "allocation def", allocation_usage: "allocation",
    view_def: "view def", view_usage: "view",
    viewpoint_def: "viewpoint def", viewpoint_usage: "viewpoint",
    enumeration_def: "enum def",
    flow_def: "flow def", flow_usage: "flow",
    analysis_case_def: "analysis case def", analysis_usage: "analysis",
    verification_case_def: "verification case def", verification_usage: "verification",
    occurrence_def: "occurrence def", occurrence_usage: "occurrence",
    calc_def: "calc def", calc_usage: "calc",
    metadata_def: "metadata def", metadata_usage: "metadata",
    concern_def: "concern def", concern_usage: "concern",
    rendering_def: "rendering def", rendering_usage: "rendering",
    satisfy_statement: "satisfy",
    verify_statement: "verify",
  };
  return map[kind] ?? kind.replace(/_/g, " ");
}

function isDefinition(kind: string): boolean {
  return kind.endsWith("_def") || kind === "package";
}

function isUsage(kind: string): boolean {
  return kind.endsWith("_usage");
}

function findClosingBrace(lines: string[], startLine: number): number {
  let depth = 0;
  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

function findLastTopLevelBrace(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "}") return i;
  }
  return -1;
}

function getChildIndent(lines: string[], startLine: number, endLine: number): string {
  // Look for the first non-empty child line inside the block
  for (let i = startLine + 1; i < endLine; i++) {
    const trimmed = lines[i].trim();
    if (trimmed && trimmed !== "{" && trimmed !== "}") {
      const match = lines[i].match(/^(\s*)/);
      return match ? match[1] : "  ";
    }
  }
  return getLineIndent(lines[startLine]) + "  ";
}

function getLineIndent(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
}

function findDocLine(lines: string[], startLine: number, endLine: number): number {
  for (let i = startLine + 1; i <= Math.min(endLine, lines.length - 1); i++) {
    if (lines[i].trim().startsWith("doc")) return i;
  }
  return -1;
}

/** Available element kinds grouped by category for the create dialog */
export const CREATE_OPTIONS = [
  {
    category: "Structure",
    items: [
      { kind: "part_def", label: "Part Definition" },
      { kind: "part_usage", label: "Part Usage", needsType: true },
      { kind: "item_def", label: "Item Definition" },
      { kind: "item_usage", label: "Item Usage", needsType: true },
      { kind: "package", label: "Package" },
    ],
  },
  {
    category: "Behavior",
    items: [
      { kind: "action_def", label: "Action Definition" },
      { kind: "action_usage", label: "Action Usage" },
      { kind: "state_def", label: "State Definition" },
      { kind: "state_usage", label: "State Usage" },
      { kind: "use_case_def", label: "Use Case Definition" },
    ],
  },
  {
    category: "Requirements",
    items: [
      { kind: "requirement_def", label: "Requirement Definition" },
      { kind: "requirement_usage", label: "Requirement Usage" },
      { kind: "concern_def", label: "Concern Definition" },
    ],
  },
  {
    category: "Interface",
    items: [
      { kind: "port_def", label: "Port Definition" },
      { kind: "port_usage", label: "Port Usage", needsType: true },
      { kind: "connection_def", label: "Connection Definition" },
      { kind: "interface_def", label: "Interface Definition" },
      { kind: "flow_def", label: "Flow Definition" },
    ],
  },
  {
    category: "Property",
    items: [
      { kind: "attribute_def", label: "Attribute Definition" },
      { kind: "attribute_usage", label: "Attribute Usage", needsType: true },
      { kind: "enumeration_def", label: "Enumeration" },
    ],
  },
  {
    category: "Constraint & Analysis",
    items: [
      { kind: "constraint_def", label: "Constraint Definition" },
      { kind: "constraint_usage", label: "Constraint Usage" },
      { kind: "analysis_case_def", label: "Analysis Case" },
      { kind: "verification_case_def", label: "Verification Case" },
    ],
  },
  {
    category: "Relationship",
    items: [
      { kind: "allocation_def", label: "Allocation Definition" },
      { kind: "satisfy_statement", label: "Satisfy" },
      { kind: "verify_statement", label: "Verify" },
    ],
  },
] as const;
