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
  specializes?: string;
  multiplicity?: string;
  shortName?: string;
  flowItemType?: string;
  flowSource?: string;
  flowTarget?: string;
  calcParams?: { name: string; type: string; direction: "in" | "out" | "inout" }[];
  calcReturnExpr?: string;
  calcReturnType?: string;
  constraintExpr?: string;
  connEndTypes?: string[];
  valueExpr?: string;
  portDirection?: "in" | "out" | "inout";
  reqShallText?: string;
  subRequirements?: string[];
  actors?: string[];
  includeUseCases?: string[];
  actionSteps?: string[];
  initialStates?: string[];
  allocSource?: string;
  allocTarget?: string;
  verifyRequirements?: string[];
  exposePatterns?: string[];
  kindFilters?: string[];
  renderAs?: string;
  viewpointConcerns?: string[];
  // Phase 1: Enhanced forms
  isConjugated?: boolean;
  transitionGuard?: string;
  transitionEffect?: string;
  stateEntryAction?: string;
  stateDoAction?: string;
  stateExitAction?: string;
  redefines?: string;
  subsetsFeature?: string;
  isAssert?: boolean;
  // Phase 2: New relationships
  bindTarget?: string;
  depClient?: string;
  depSupplier?: string;
  // Phase 3: New elements
  ifCondition?: string;
  ifBody?: string;
  elseBody?: string;
  whileCondition?: string;
  whileBody?: string;
  forItem?: string;
  forType?: string;
  forCollection?: string;
  forBody?: string;
  sendVia?: string;
  relationBy?: string;
}): string {
  const { kind, name, typeRef, doc, children, specializes, multiplicity,
          shortName, flowItemType, flowSource, flowTarget,
          calcParams, calcReturnExpr, calcReturnType, constraintExpr, connEndTypes,
          valueExpr, portDirection, reqShallText, subRequirements, actors,
          includeUseCases, actionSteps, initialStates, allocSource, allocTarget,
          verifyRequirements, exposePatterns, kindFilters, renderAs,
          viewpointConcerns, isConjugated, transitionGuard, transitionEffect,
          stateEntryAction, stateDoAction, stateExitAction,
          redefines, subsetsFeature, isAssert,
          bindTarget, depClient, depSupplier,
          ifCondition, ifBody, elseBody,
          whileCondition, whileBody,
          forItem, forType, forCollection, forBody,
          sendVia, relationBy } = opts;
  // Conformant SysML: short names with hyphens/spaces (e.g. RV-01) and
  // names that are not plain identifiers must use the quoted-name form.
  const quoteIfNeeded = (n: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n}'`);
  const alias = shortName ? ` <${quoteIfNeeded(shortName)}>` : "";
  const lines: string[] = [];

  // Map kind to SysML keyword syntax
  const keyword = kindToKeyword(kind);

  if (kind === "calc_def") {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    if (doc) lines.push(`  doc /* ${doc} */`);
    if (calcParams) {
      for (const p of calcParams) {
        lines.push(`  ${p.direction} ${p.name} : ${p.type || "Real"};`);
      }
    }
    if (calcReturnExpr) {
      lines.push(`  return result : ${calcReturnType || "Real"} = ${calcReturnExpr};`);
    }
    if (children) for (const child of children) lines.push(`  ${child}`);
    lines.push(`}`);
  } else if (kind === "constraint_def") {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    if (doc) lines.push(`  doc /* ${doc} */`);
    if (calcParams) {
      for (const p of calcParams) {
        lines.push(`  ${p.direction} ${p.name} : ${p.type || "Real"};`);
      }
    }
    if (constraintExpr) lines.push(`  ${constraintExpr};`);
    if (children) for (const child of children) lines.push(`  ${child}`);
    lines.push(`}`);
  } else if (kind === "connection_def" || kind === "interface_def") {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    if (doc) lines.push(`  doc /* ${doc} */`);
    if (connEndTypes && connEndTypes.length >= 2) {
      lines.push(`  end source : ${connEndTypes[0]};`);
      lines.push(`  end target : ${connEndTypes[1]};`);
    }
    if (children) for (const child of children) lines.push(`  ${child}`);
    lines.push(`}`);
  } else if (kind === "requirement_def") {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    const shallDoc = reqShallText || doc;
    if (shallDoc) lines.push(`  doc /* ${shallDoc} */`);
    if (subRequirements) {
      for (const r of subRequirements) lines.push(`  requirement ${r};`);
    }
    if (children) for (const child of children) lines.push(`  ${child}`);
    lines.push(`}`);
  } else if (kind === "use_case_def") {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    if (doc) lines.push(`  doc /* ${doc} */`);
    if (actors) {
      for (const a of actors) lines.push(`  actor ${a.includes(":") ? a : `${a.toLowerCase()} : ${a}`};`);
    }
    if (includeUseCases) {
      for (const uc of includeUseCases) lines.push(`  include use case ${uc};`);
    }
    if (children) for (const child of children) lines.push(`  ${child}`);
    lines.push(`}`);
  } else if (kind === "action_def") {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    if (doc) lines.push(`  doc /* ${doc} */`);
    if (calcParams) {
      for (const p of calcParams) {
        lines.push(`  ${p.direction} ${p.name} : ${p.type || "Real"};`);
      }
    }
    if (actionSteps) {
      for (const step of actionSteps) lines.push(`  action ${step};`);
    }
    if (children) for (const child of children) lines.push(`  ${child}`);
    lines.push(`}`);
  } else if (kind === "state_def") {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    if (doc) lines.push(`  doc /* ${doc} */`);
    if (stateEntryAction) lines.push(`  entry action { ${stateEntryAction} }`);
    if (stateDoAction) lines.push(`  do action { ${stateDoAction} }`);
    if (stateExitAction) lines.push(`  exit action { ${stateExitAction} }`);
    if (initialStates) {
      for (const s of initialStates) lines.push(`  state ${s};`);
    }
    if (children) for (const child of children) lines.push(`  ${child}`);
    lines.push(`}`);
  } else if (kind === "allocation_def") {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    if (doc) lines.push(`  doc /* ${doc} */`);
    if (allocSource) lines.push(`  end source : ${allocSource};`);
    if (allocTarget) lines.push(`  end target : ${allocTarget};`);
    if (children) for (const child of children) lines.push(`  ${child}`);
    lines.push(`}`);
  } else if (kind === "verification_case_def") {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    if (doc) lines.push(`  doc /* ${doc} */`);
    if (verifyRequirements) {
      for (const r of verifyRequirements) lines.push(`  verify ${r};`);
    }
    if (children) for (const child of children) lines.push(`  ${child}`);
    lines.push(`}`);
  } else if (kind === "view_def") {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    if (doc) lines.push(`  doc /* ${doc} */`);
    if (exposePatterns) {
      for (const p of exposePatterns) lines.push(`  expose ${p};`);
    }
    if (kindFilters) {
      for (const f of kindFilters) lines.push(`  filter @SysML::${f};`);
    }
    if (renderAs) lines.push(`  render ${renderAs};`);
    if (children) for (const child of children) lines.push(`  ${child}`);
    lines.push(`}`);
  } else if (kind === "viewpoint_def") {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    if (doc) lines.push(`  doc /* ${doc} */`);
    if (viewpointConcerns) {
      for (const c of viewpointConcerns) lines.push(`  frame concern ${c};`);
    }
    if (children) for (const child of children) lines.push(`  ${child}`);
    lines.push(`}`);
  } else if (isDefinition(kind)) {
    const spec = specializes ? ` :> ${specializes}` : "";
    lines.push(`${keyword} ${name}${alias}${spec} {`);
    if (doc) {
      lines.push(`  doc /* ${doc} */`);
    }
    if (children) {
      for (const child of children) {
        lines.push(`  ${child}`);
      }
    }
    lines.push(`}`);
  } else if (kind === "flow_usage") {
    // flow <name> of <itemType> from <source> to <target>;
    const parts = [`flow ${name}${alias}`];
    if (flowItemType) parts.push(`of ${flowItemType}`);
    if (flowSource && flowTarget) {
      parts.push(`from ${flowSource} to ${flowTarget}`);
    }
    lines.push(parts.join(" ") + ";");
  } else if (kind === "binding_usage") {
    if (bindTarget) {
      lines.push(`binding ${name} = ${bindTarget};`);
    } else {
      lines.push(`binding ${name};`);
    }
  } else if (isUsage(kind)) {
    const mult = multiplicity ? `[${multiplicity}]` : "";
    const dir = portDirection && kind === "port_usage" ? `${portDirection} ` : "";
    const conj = isConjugated && kind === "port_usage" ? "~" : "";
    const val = valueExpr && kind === "attribute_usage" ? ` = ${valueExpr}` : "";
    const subset = subsetsFeature ? ` :> ${subsetsFeature}` : "";
    const redef = redefines ? ` :>> ${redefines}` : "";
    const assertPfx = isAssert && kind === "constraint_usage" ? "assert " : "";
    if (typeRef) {
      lines.push(`${assertPfx}${dir}${conj}${keyword} ${name}${alias} : ${typeRef}${mult}${subset}${redef}${val};`);
    } else if (mult || val || subsetsFeature || redefines) {
      lines.push(`${assertPfx}${dir}${conj}${keyword} ${name}${alias}${subset}${redef}${mult ? " " + mult : ""}${val};`);
    } else {
      lines.push(`${assertPfx}${dir}${conj}${keyword} ${name}${alias};`);
    }
  } else if (kind === "connect_statement") {
    // name = source endpoint, typeRef = target endpoint
    if (typeRef) {
      lines.push(`connect ${name} to ${typeRef};`);
    } else {
      lines.push(`connect ${name};`);
    }
  } else if (kind === "transition_statement") {
    // name = source state, typeRef = target state
    if (typeRef) {
      const guard = transitionGuard ? ` if ${transitionGuard}` : "";
      const effect = transitionEffect ? ` do ${transitionEffect}` : "";
      lines.push(`transition first ${name}${guard}${effect} then ${typeRef};`);
    } else {
      lines.push(`transition ${name};`);
    }
  } else if (kind === "satisfy_statement") {
    // `satisfy R by element;` binds the requirement's subject. The bare
    // form is only meaningful nested inside the satisfying usage.
    lines.push(relationBy ? `satisfy ${name} by ${relationBy};` : `satisfy ${name};`);
  } else if (kind === "verify_statement") {
    lines.push(relationBy ? `verify ${name} by ${relationBy};` : `verify ${name};`);
  } else if (kind === "dependency_statement") {
    const parts = ["dependency"];
    if (name) parts.push(name);
    if (depClient && depSupplier) {
      parts.push(`from ${depClient} to ${depSupplier}`);
    }
    lines.push(parts.join(" ") + ";");
  } else if (kind === "send_action") {
    const parts = [`send ${name}`];
    if (sendVia) parts.push(`via ${sendVia}`);
    lines.push(parts.join(" ") + ";");
  } else if (kind === "if_action") {
    const cond = ifCondition || name;
    lines.push(`if ${cond} {`);
    if (ifBody) lines.push(`  ${ifBody}`);
    if (elseBody) {
      lines.push(`} else {`);
      lines.push(`  ${elseBody}`);
    }
    lines.push(`}`);
  } else if (kind === "while_action") {
    const cond = whileCondition || name;
    lines.push(`while ${cond} {`);
    if (whileBody) lines.push(`  ${whileBody}`);
    lines.push(`}`);
  } else if (kind === "for_action") {
    const item = forItem || name;
    const typ = forType ? ` : ${forType}` : "";
    const coll = forCollection ? ` in ${forCollection}` : "";
    lines.push(`for ${item}${typ}${coll} {`);
    if (forBody) lines.push(`  ${forBody}`);
    lines.push(`}`);
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


/** Edit an element's name and/or type reference in the source */


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
    analysis_case_def: "analysis def", analysis_usage: "analysis",
    verification_case_def: "verification def", verification_usage: "verification",
    occurrence_def: "occurrence def", occurrence_usage: "occurrence",
    calc_def: "calc def", calc_usage: "calc",
    metadata_def: "metadata def", metadata_usage: "metadata",
    concern_def: "concern def", concern_usage: "concern",
    rendering_def: "rendering def", rendering_usage: "rendering",
    transition_statement: "transition",
    satisfy_statement: "satisfy",
    verify_statement: "verify",
    binding_usage: "binding",
    dependency_statement: "dependency",
    perform_statement: "perform action",
    exhibit_statement: "exhibit state",
    send_action: "send",
    if_action: "if",
    while_action: "while",
    for_action: "for",
  };
  return map[kind] ?? kind.replace(/_/g, " ");
}

function isDefinition(kind: string): boolean {
  return kind.endsWith("_def") || kind === "package";
}

function isUsage(kind: string): boolean {
  return kind.endsWith("_usage");
}


function findLastTopLevelBrace(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "}") return i;
  }
  return -1;
}


function getLineIndent(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
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
      { kind: "occurrence_def", label: "Occurrence Definition" },
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
      { kind: "transition_statement", label: "Transition" },
      { kind: "use_case_def", label: "Use Case Definition" },
      { kind: "if_action", label: "If Action" },
      { kind: "while_action", label: "While Loop" },
      { kind: "for_action", label: "For Loop" },
      { kind: "send_action", label: "Send Action" },
      { kind: "perform_statement", label: "Perform Action", needsType: true },
      { kind: "exhibit_statement", label: "Exhibit State", needsType: true },
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
      { kind: "flow_usage", label: "Flow Usage" },
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
      { kind: "calc_def", label: "Calculation" },
      { kind: "constraint_def", label: "Constraint Definition" },
      { kind: "constraint_usage", label: "Constraint Usage" },
      { kind: "analysis_case_def", label: "Analysis Case" },
      { kind: "verification_case_def", label: "Verification Case" },
      { kind: "metadata_def", label: "Metadata Definition" },
    ],
  },
  {
    category: "Relationship",
    items: [
      { kind: "allocation_def", label: "Allocation Definition" },
      { kind: "connect_statement", label: "Connect (port-to-port)" },
      { kind: "binding_usage", label: "Binding (=)" },
      { kind: "dependency_statement", label: "Dependency" },
      { kind: "satisfy_statement", label: "Satisfy" },
      { kind: "verify_statement", label: "Verify" },
    ],
  },
  {
    category: "View",
    items: [
      { kind: "view_def", label: "View Definition" },
      { kind: "viewpoint_def", label: "Viewpoint Definition" },
    ],
  },
] as const;
