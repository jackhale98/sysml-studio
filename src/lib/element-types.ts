export type ElementId = number;

export type Category =
  | "structure" | "behavior" | "requirement" | "interface"
  | "property" | "relationship" | "constraint" | "analysis"
  | "view" | "auxiliary";

export type ElementKind =
  | "package" | "part_def" | "part_usage"
  | "attribute_def" | "attribute_usage"
  | "port_def" | "port_usage"
  | "connection_def" | "connection_usage"
  | "interface_def" | "interface_usage"
  | "item_def" | "item_usage"
  | "action_def" | "action_usage"
  | "state_def" | "state_usage"
  | "transition_statement"
  | "constraint_def" | "constraint_usage"
  | "requirement_def" | "requirement_usage"
  | "concern_def" | "concern_usage"
  | "view_def" | "view_usage"
  | "viewpoint_def" | "viewpoint_usage"
  | "rendering_def" | "rendering_usage"
  | "allocation_def" | "allocation_usage"
  | "analysis_case_def" | "analysis_usage"
  | "use_case_def" | "use_case_usage"
  | "verification_case_def" | "verification_usage"
  | "enumeration_def"
  | "flow_def" | "flow_usage"
  | "occurrence_def" | "occurrence_usage"
  | "metadata_def" | "metadata_usage"
  | "calc_def" | "calc_usage"
  | "individual_def"
  | "class_def" | "struct_def" | "assoc_def" | "data_type_def"
  | "behavior_def" | "function_def" | "predicate_def" | "interaction_def"
  | "feature_usage" | "end_feature" | "enum_member"
  | "ref_usage" | "event_usage" | "snapshot_usage" | "timeslice_usage"
  | "perform_statement" | "exhibit_statement" | "include_statement"
  | "satisfy_statement" | "verify_statement"
  | "fork_node" | "join_node" | "merge_node" | "decide_node"
  | "if_action" | "while_action" | "for_action" | "send_action" | "assign_action"
  | "terminate_statement" | "succession_usage" | "succession_flow_usage"
  | "binding_usage" | "boolean_expression_usage" | "invariant_usage" | "result_expression"
  | "do_action" | "entry_action" | "exit_action" | "else_action" | "inline_transition"
  | "textual_representation"
  | "specialization" | "redefinition" | "typed_by" | "binding"
  | "import" | "alias"
  | "comment" | "doc_comment"
  | "dependency_statement" | "connect_statement" | "allocate_statement"
  | "flow_statement" | "message_statement"
  | "subject_declaration" | "actor_declaration"
  | "objective_declaration" | "stakeholder_declaration"
  | { other: string };

export interface SourceSpan {
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  start_byte: number;
  end_byte: number;
}

export interface SysmlElement {
  id: ElementId;
  kind: ElementKind;
  name: string | null;
  qualified_name: string;
  category: Category;
  parent_id: ElementId | null;
  children_ids: ElementId[];
  span: SourceSpan;
  type_ref: string | null;
  specializations: string[];
  modifiers: string[];
  multiplicity: string | null;
  doc: string | null;
  short_name: string | null;
  value_expr: string | null;
}

export interface ParseError {
  message: string;
  span: SourceSpan;
}

export interface ModelStats {
  total_elements: number;
  definitions: number;
  usages: number;
  relationships: number;
  errors: number;
  parse_time_ms: number;
}

export interface SysmlModel {
  file_path: string | null;
  elements: SysmlElement[];
  errors: ParseError[];
  stats: ModelStats;
}

// MBSE Types
export interface CompletenessReport {
  unsatisfied_requirements: ElementId[];
  unverified_requirements: ElementId[];
  unconnected_ports: ElementId[];
  untyped_usages: ElementId[];
  score: number;
  summary: CompleteStat[];
}

export interface CompleteStat {
  label: string;
  total: number;
  complete: number;
}

export interface TraceabilityEntry {
  requirement_id: ElementId;
  requirement_name: string;
  satisfied_by: TraceLink[];
  verified_by: TraceLink[];
  allocated_to: TraceLink[];
}

export interface TraceLink {
  element_id: ElementId;
  element_name: string;
  element_kind: string;
}

// Diagram Types
export interface Compartment {
  heading: string;
  entries: string[];
}

export interface DiagramNode {
  element_id: ElementId;
  label: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  children: DiagramNode[];
  stereotype?: string;
  compartments?: Compartment[];
  description?: string;
}

export interface DiagramEdge {
  from_id: ElementId;
  to_id: ElementId;
  label: string | null;
  edge_type: string;
  points: [number, number][];
}

export interface DiagramLayout {
  diagram_type: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  bounds: [number, number, number, number];
}

export interface ValidationIssue {
  element_id: ElementId;
  severity: "error" | "warning" | "info";
  message: string;
  category: "incomplete" | "missing_type" | "unresolved_ref" | "circular_dep" | "orphan";
}

export interface ValidationReport {
  issues: ValidationIssue[];
  summary: { errors: number; warnings: number; infos: number };
}

// ─── Analysis Types ───

// Studio-specific BOM rollup
export interface BomNode {
  element_id: ElementId;
  name: string;
  kind: string;
  type_ref: string | null;
  multiplicity: number;
  attributes: BomAttribute[];
  children: BomNode[];
  rollups: Record<string, number>;
}

export interface BomAttribute {
  name: string;
  value: number | null;
  unit: string | null;
  type_ref: string | null;
}

// Thin wrapper for eval results
export interface EvalResult {
  name: string;
  success: boolean;
  value: string;
  error: string | null;
}

// ─── sysml-core types (serialized directly from Rust) ───

// sysml_core::sim::constraint_eval::ConstraintModel
export interface ConstraintModel {
  name: string;
  params: Parameter[];
  expression: unknown | null; // Expr AST
  span: CoreSpan;
}

// sysml_core::sim::constraint_eval::CalcModel
export interface CalcModel {
  name: string;
  params: Parameter[];
  return_name: string | null;
  return_type: string | null;
  return_expr: unknown | null; // Expr AST
  local_bindings: [string, unknown][]; // [(name, Expr)]
  span: CoreSpan;
}

// sysml_core::sim::constraint_eval::Parameter
export interface Parameter {
  name: string;
  type_ref: string | null;
  direction: "In" | "Out" | "InOut";
}

// sysml_core::model::Span
export interface CoreSpan {
  start_row: number;
  start_col: number;
  end_row: number;
  end_col: number;
  start_byte: number;
  end_byte: number;
}

// sysml_core::sim::state_machine::StateMachineModel
export interface StateMachineModel {
  name: string;
  states: StateNode[];
  transitions: CoreTransition[];
  entry_state: string | null;
  span: CoreSpan;
}

export interface StateNode {
  name: string;
  entry_action: unknown | null;
  do_action: unknown | null;
  exit_action: unknown | null;
  span: CoreSpan;
}

export interface CoreTransition {
  name: string | null;
  source: string;
  target: string;
  trigger: { Signal: string } | "Completion" | null;
  guard: unknown | null;
  effect: unknown | null;
  span: CoreSpan;
}

// sysml_core::sim::state_sim::SimulationState
export interface SimulationState {
  machine_name: string;
  current_state: string;
  step: number;
  env: { bindings: Record<string, unknown> };
  trace: SimStep[];
  status: "Running" | "Completed" | "Deadlocked" | "MaxSteps";
}

export interface SimStep {
  step: number;
  from_state: string;
  transition_name: string | null;
  trigger: string | null;
  guard_result: boolean | null;
  effect: string | null;
  to_state: string;
  exit_action: string | null;
  entry_action: string | null;
}

// sysml_core::sim::action_flow::ActionModel
export interface ActionModel {
  name: string;
  steps: unknown[]; // ActionStep enum — complex recursive type
  span: CoreSpan;
}

// sysml_core::sim::action_exec::ActionExecState
export interface ActionExecState {
  action_name: string;
  step: number;
  env: { bindings: Record<string, unknown> };
  trace: ActionExecStep[];
  status: "Running" | "Completed" | "Error" | "MaxSteps";
}

export interface ActionExecStep {
  step: number;
  kind: string;
  description: string;
}

// Syntax highlighting token from tree-sitter
export interface HighlightToken {
  start: number;
  end: number;
  kind: string; // "keyword" | "type" | "comment" | "string" | "number" | "punctuation" | "definition" | "operator" | "literal"
}
