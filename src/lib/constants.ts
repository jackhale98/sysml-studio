import type { Category, ElementKind } from "./element-types";

export const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  structure: { label: "Structure", color: "#3b82f6" },
  behavior: { label: "Behavior", color: "#38bdf8" },
  requirement: { label: "Requirements", color: "#fb7185" },
  interface: { label: "Interfaces", color: "#a78bfa" },
  property: { label: "Attributes", color: "#fbbf24" },
  relationship: { label: "Relationships", color: "#f472b6" },
  constraint: { label: "Constraints", color: "#fb923c" },
  analysis: { label: "Analysis", color: "#2dd4bf" },
  view: { label: "Views", color: "#34d399" },
  auxiliary: { label: "Auxiliary", color: "#94a3b8" },
};

export type TypeColorSet = { bg: string; fg: string; border: string };

export const TYPE_COLORS: Record<string, TypeColorSet> = {
  package: { bg: "#1e293b", fg: "#94a3b8", border: "#334155" },
  part_def: { bg: "#1e3a5f", fg: "#60a5fa", border: "#2563eb" },
  part_usage: { bg: "#1a2e1a", fg: "#4ade80", border: "#16a34a" },
  attribute_def: { bg: "#2d1f0e", fg: "#fbbf24", border: "#d97706" },
  attribute_usage: { bg: "#2d1f0e", fg: "#fbbf24", border: "#d97706" },
  port_def: { bg: "#2e1065", fg: "#a78bfa", border: "#7c3aed" },
  port_usage: { bg: "#2e1065", fg: "#a78bfa", border: "#7c3aed" },
  connection_def: { bg: "#1e1e2e", fg: "#f472b6", border: "#db2777" },
  connection_usage: { bg: "#1e1e2e", fg: "#f472b6", border: "#db2777" },
  interface_def: { bg: "#2e1065", fg: "#c4b5fd", border: "#7c3aed" },
  interface_usage: { bg: "#2e1065", fg: "#c4b5fd", border: "#7c3aed" },
  item_def: { bg: "#1e1b4b", fg: "#818cf8", border: "#4f46e5" },
  item_usage: { bg: "#1e1b4b", fg: "#818cf8", border: "#4f46e5" },
  action_def: { bg: "#042f2e", fg: "#2dd4bf", border: "#0d9488" },
  action_usage: { bg: "#042f2e", fg: "#2dd4bf", border: "#0d9488" },
  state_def: { bg: "#0c2d48", fg: "#38bdf8", border: "#0284c7" },
  state_usage: { bg: "#0c2d48", fg: "#38bdf8", border: "#0284c7" },
  transition_statement: { bg: "#2a1a2e", fg: "#e879f9", border: "#a21caf" },
  constraint_def: { bg: "#431407", fg: "#fb923c", border: "#c2410c" },
  constraint_usage: { bg: "#431407", fg: "#fb923c", border: "#c2410c" },
  requirement_def: { bg: "#2e1a1a", fg: "#fb7185", border: "#e11d48" },
  requirement_usage: { bg: "#2e1a1a", fg: "#fb7185", border: "#e11d48" },
  concern_def: { bg: "#2e1a1a", fg: "#fda4af", border: "#f43f5e" },
  concern_usage: { bg: "#2e1a1a", fg: "#fda4af", border: "#f43f5e" },
  view_def: { bg: "#052e16", fg: "#34d399", border: "#059669" },
  view_usage: { bg: "#052e16", fg: "#34d399", border: "#059669" },
  enumeration_def: { bg: "#2e2e1a", fg: "#facc15", border: "#ca8a04" },
  enum_member: { bg: "#2e2e1a", fg: "#fde047", border: "#eab308" },
  flow_def: { bg: "#1a2e2e", fg: "#2dd4bf", border: "#0d9488" },
  flow_usage: { bg: "#1a2e2e", fg: "#2dd4bf", border: "#0d9488" },
  allocation_def: { bg: "#1e1e2e", fg: "#c084fc", border: "#9333ea" },
  allocation_usage: { bg: "#1e1e2e", fg: "#c084fc", border: "#9333ea" },
  // MBSE-specific
  satisfy_statement: { bg: "#052e16", fg: "#4ade80", border: "#16a34a" },
  verify_statement: { bg: "#172554", fg: "#60a5fa", border: "#2563eb" },
  actor_declaration: { bg: "#1e293b", fg: "#e2e8f0", border: "#475569" },
  stakeholder_declaration: { bg: "#1e293b", fg: "#e2e8f0", border: "#475569" },
  use_case_def: { bg: "#042f2e", fg: "#5eead4", border: "#14b8a6" },
  use_case_usage: { bg: "#042f2e", fg: "#5eead4", border: "#14b8a6" },
  verification_case_def: { bg: "#172554", fg: "#93c5fd", border: "#3b82f6" },
  analysis_case_def: { bg: "#1a2e2e", fg: "#67e8f9", border: "#06b6d4" },
};

export function getTypeColor(kind: string): TypeColorSet {
  return TYPE_COLORS[kind] ?? { bg: "#1e293b", fg: "#94a3b8", border: "#334155" };
}

export function getKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    package: "Package",
    part_def: "Part Def",
    part_usage: "Part",
    attribute_def: "Attr Def",
    attribute_usage: "Attribute",
    port_def: "Port Def",
    port_usage: "Port",
    connection_def: "Conn Def",
    connection_usage: "Connection",
    interface_def: "Iface Def",
    interface_usage: "Interface",
    item_def: "Item Def",
    item_usage: "Item",
    action_def: "Action Def",
    action_usage: "Action",
    state_def: "State Def",
    state_usage: "State",
    transition_statement: "Transition",
    constraint_def: "Constr Def",
    constraint_usage: "Constraint",
    requirement_def: "Req Def",
    requirement_usage: "Requirement",
    concern_def: "Concern Def",
    concern_usage: "Concern",
    view_def: "View Def",
    view_usage: "View",
    viewpoint_def: "VP Def",
    viewpoint_usage: "Viewpoint",
    rendering_def: "Render Def",
    rendering_usage: "Rendering",
    allocation_def: "Alloc Def",
    allocation_usage: "Allocation",
    analysis_case_def: "Analysis Def",
    analysis_usage: "Analysis",
    use_case_def: "UC Def",
    use_case_usage: "Use Case",
    verification_case_def: "V&V Def",
    verification_usage: "Verification",
    enumeration_def: "Enum Def",
    enum_member: "Enum Value",
    flow_def: "Flow Def",
    flow_usage: "Flow",
    occurrence_def: "Occur Def",
    occurrence_usage: "Occurrence",
    feature_usage: "Feature",
    end_feature: "End Feature",
    ref_usage: "Ref",
    event_usage: "Event",
    satisfy_statement: "Satisfy",
    verify_statement: "Verify",
    actor_declaration: "Actor",
    stakeholder_declaration: "Stakeholder",
    subject_declaration: "Subject",
    objective_declaration: "Objective",
    import: "Import",
    alias: "Alias",
    comment: "Comment",
    doc_comment: "Doc",
  };
  return labels[kind] ?? kind.replace(/_/g, " ");
}

/** SysML v2 Standard Library types for autocomplete suggestions */
export const SYSML_STDLIB_TYPES = [
  // ScalarValues
  "Boolean", "String", "Integer", "Natural", "Positive", "Real",
  "Complex", "Number", "UnlimitedNatural",
  // SI Units & Quantities
  "Time", "Length", "Mass", "Temperature", "ElectricCurrent",
  "AmountOfSubstance", "LuminousIntensity", "Angle", "SolidAngle",
  "Frequency", "Force", "Pressure", "Energy", "Power", "Voltage",
  "ElectricCharge", "Resistance", "Capacitance", "Inductance",
  "Velocity", "Acceleration", "AngularVelocity", "Torque", "Area", "Volume",
  "MassFlowRate", "VolumeFlowRate", "Density",
  // ISQ Base
  "DurationValue", "LengthValue", "MassValue", "TemperatureValue",
  "ElectricCurrentValue", "SpeedValue", "AccelerationValue",
  "ForceValue", "PressureValue", "EnergyValue", "PowerValue",
  "VoltageValue", "FrequencyValue", "TorqueValue",
  // Structural
  "Anything", "Nothing", "Object", "Item", "Part", "Port",
  "Connection", "Interface", "Allocation", "Flow",
  // Behavioral
  "Action", "State", "Transition", "Event", "Occurrence",
  "Performance", "Transfer",
  // Requirements
  "Requirement", "Concern",
  // Analysis
  "AnalysisCase", "VerificationCase", "UseCase",
  "Calculation", "Constraint",
  // Collections
  "Sequence", "Set", "Bag", "OrderedSet", "List", "Array",
  // Metadata
  "Metaclass", "Metaobject",
];

/** Map element kind to the best diagram type for viewing */
export function getBestDiagramType(kind: string): "bdd" | "stm" | "req" | "ucd" | "ibd" {
  switch (kind) {
    case "state_def":
    case "state_usage":
    case "transition_statement":
      return "stm";
    case "requirement_def":
    case "requirement_usage":
    case "concern_def":
    case "concern_usage":
    case "satisfy_statement":
    case "verify_statement":
      return "req";
    case "use_case_def":
    case "use_case_usage":
    case "actor_declaration":
    case "stakeholder_declaration":
      return "ucd";
    default:
      return "bdd";
  }
}

/** SysML v2 keywords for editor highlighting */
export const SYSML_KEYWORDS = [
  "package", "part", "def", "attribute", "port", "connection", "interface",
  "item", "action", "state", "transition", "constraint", "requirement",
  "concern", "view", "viewpoint", "rendering", "allocation", "analysis",
  "case", "use", "verification", "enum", "enumeration", "occurrence",
  "flow", "import", "alias", "abstract", "readonly", "derived",
  "in", "out", "inout", "first", "then", "do", "entry", "exit",
  "if", "else", "accept", "send", "assign", "assert", "satisfy",
  "after", "at", "when", "decide", "merge", "fork", "join",
  "private", "protected", "public", "ref", "connect", "to",
  "allocate", "expose", "exhibit", "include", "perform",
  "require", "assume", "verify", "subject", "actor", "objective",
  "stakeholder", "calc", "function", "predicate", "metadata",
  "about", "doc", "comment", "variation", "variant", "individual",
  "snapshot", "timeslice", "event", "bind", "succession", "message",
  "dependency", "filter", "render", "return",
];
