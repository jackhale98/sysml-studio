import type {
  SysmlModel, SysmlElement, ElementId,
  CompletenessReport, TraceabilityEntry,
  DiagramLayout, ValidationReport, HighlightToken,
  BomNode, BomResponse, ConstraintModel, CalcModel, EvalResult,
  StateMachineModel, SimulationState,
  ActionModel, ActionExecState,
  RollupResponse, RollupTarget,
  AnalysisCaseInfo, AnalysisEvalResult, TradeStudyResult,
  ScenarioInput, WhatIfResponse, SweepInput, SweepResponse,
} from "./element-types";

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function parseSource(source: string, path?: string): Promise<SysmlModel> {
  return tauriInvoke<SysmlModel>("parse_source", { source, path: path ?? null });
}

export async function openFile(path: string): Promise<[SysmlModel, string]> {
  return tauriInvoke<[SysmlModel, string]>("open_file", { path });
}

export async function saveFile(path: string, source: string): Promise<void> {
  return tauriInvoke<void>("save_file", { path, source });
}

/** Open a file picker dialog. Returns the selected path, or null if cancelled. */
export async function pickFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    title: "Open SysML File",
    filters: [{ name: "SysML", extensions: ["sysml", "sysml2"] }],
    multiple: false,
  });
  return typeof result === "string" ? result : null;
}

/** Open a save file dialog. Returns the selected path, or null if cancelled. */
export async function pickSaveFile(defaultName?: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const result = await save({
    title: "Save SysML File",
    defaultPath: defaultName,
    filters: [{ name: "SysML", extensions: ["sysml"] }],
  });
  return result;
}

/**
 * Resolve imports: scan source for `import` statements, load referenced files
 * from the same directory, and return combined source.
 */
/** Read a file picked via browser <input type="file"> (used on iOS) */
export function readBrowserFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export async function filterElements(
  categories: string[],
  searchTerm?: string,
  parentName?: string,
  kinds?: string[],
): Promise<SysmlElement[]> {
  return tauriInvoke<SysmlElement[]>("filter_elements", {
    categories, searchTerm: searchTerm ?? null,
    parentName: parentName ?? null, kinds: kinds ?? [],
  });
}

// MBSE Commands
export async function getImpactAnalysis(elementId: ElementId): Promise<SysmlElement[]> {
  return tauriInvoke<SysmlElement[]>("impact_analysis", { elementId });
}

export async function getCompletenessReport(): Promise<CompletenessReport> {
  return tauriInvoke<CompletenessReport>("check_completeness");
}

export async function getTraceabilityMatrix(): Promise<TraceabilityEntry[]> {
  return tauriInvoke<TraceabilityEntry[]>("get_traceability_matrix");
}

export async function getValidation(): Promise<ValidationReport> {
  return tauriInvoke<ValidationReport>("get_validation");
}

/** Reparse source — delegates to full parse (sysml-core backend is fast enough) */
export async function reparseSource(
  source: string,
  _startByte: number,
  _oldEndByte: number,
  _newEndByte: number,
  _startLine: number,
  _startCol: number,
  _oldEndLine: number,
  _oldEndCol: number,
  _newEndLine: number,
  _newEndCol: number,
): Promise<SysmlModel> {
  return parseSource(source);
}

export async function getConnectedElements(elementId: ElementId): Promise<ElementId[]> {
  return tauriInvoke<ElementId[]>("get_connected_elements", { elementId });
}

// Syntax Highlighting
export async function getHighlightRanges(): Promise<HighlightToken[]> {
  return tauriInvoke<HighlightToken[]>("get_highlight_ranges");
}

// Analysis Commands
export async function computeBom(rootName?: string): Promise<BomResponse> {
  return tauriInvoke<BomResponse>("compute_bom", { rootName: rootName ?? null });
}

export async function listConstraints(): Promise<ConstraintModel[]> {
  return tauriInvoke<ConstraintModel[]>("list_constraints");
}

export async function listCalculations(): Promise<CalcModel[]> {
  return tauriInvoke<CalcModel[]>("list_calculations");
}

export async function evaluateConstraint(constraintName: string, bindings: Record<string, number>): Promise<EvalResult> {
  return tauriInvoke<EvalResult>("evaluate_constraint", { constraintName, bindings });
}

export async function evaluateCalculation(calcName: string, bindings: Record<string, number>): Promise<EvalResult> {
  return tauriInvoke<EvalResult>("evaluate_calculation", { calcName, bindings });
}

export async function listStateMachines(): Promise<StateMachineModel[]> {
  return tauriInvoke<StateMachineModel[]>("list_state_machines");
}

export async function simulateStateMachine(machineName: string, events: string[], maxSteps?: number): Promise<SimulationState> {
  return tauriInvoke<SimulationState>("simulate_state_machine", { machineName, events, maxSteps: maxSteps ?? null });
}

export async function listActions(): Promise<ActionModel[]> {
  return tauriInvoke<ActionModel[]>("list_actions");
}

export async function executeAction(actionName: string, maxSteps?: number): Promise<ActionExecState> {
  return tauriInvoke<ActionExecState>("execute_action", { actionName, maxSteps: maxSteps ?? null });
}

// Diagram Commands
export async function computeBddLayout(rootName?: string): Promise<DiagramLayout> {
  return tauriInvoke<DiagramLayout>("compute_bdd_layout", { rootName: rootName ?? null });
}

export async function computeStmLayout(stateDefName: string): Promise<DiagramLayout> {
  return tauriInvoke<DiagramLayout>("compute_stm_layout", { stateDefName });
}

export async function computeReqLayout(): Promise<DiagramLayout> {
  return tauriInvoke<DiagramLayout>("compute_req_layout");
}

export async function computeUcdLayout(): Promise<DiagramLayout> {
  return tauriInvoke<DiagramLayout>("compute_ucd_layout");
}

export async function computeIbdLayout(blockName?: string): Promise<DiagramLayout> {
  return tauriInvoke<DiagramLayout>("compute_ibd_layout", { blockName: blockName ?? null });
}

export async function computeActLayout(actionDefName: string): Promise<DiagramLayout> {
  return tauriInvoke<DiagramLayout>("compute_act_layout", { actionDefName });
}

// Rollup Commands
export async function computeRollup(rootDef: string, attribute: string, method?: string): Promise<RollupResponse> {
  return tauriInvoke<RollupResponse>("compute_rollup", { rootDef, attribute, method: method ?? null });
}

export async function listRollupTargets(): Promise<RollupTarget[]> {
  return tauriInvoke<RollupTarget[]>("list_rollup_targets");
}

// Analysis Case Commands
export async function listAnalysisCases(): Promise<AnalysisCaseInfo[]> {
  return tauriInvoke<AnalysisCaseInfo[]>("list_analysis_cases");
}

export async function evaluateAnalysisCase(caseName: string, bindings: Record<string, number>): Promise<AnalysisEvalResult> {
  return tauriInvoke<AnalysisEvalResult>("evaluate_analysis_case", { caseName, bindings });
}

export async function evaluateTradeStudy(caseName: string): Promise<TradeStudyResult> {
  return tauriInvoke<TradeStudyResult>("evaluate_trade_study", { caseName });
}

// What-If & Sensitivity Commands
export async function evaluateWhatIf(
  rootDef: string, attribute: string, scenarios: ScenarioInput[], method?: string,
): Promise<WhatIfResponse> {
  return tauriInvoke<WhatIfResponse>("evaluate_what_if", { rootDef, attribute, method: method ?? null, scenarios });
}

export async function evaluateSweep(
  rootDef: string, attribute: string, sweep: SweepInput, method?: string,
): Promise<SweepResponse> {
  return tauriInvoke<SweepResponse>("evaluate_sweep", { rootDef, attribute, method: method ?? null, sweep });
}

// Unit Conversion
export async function convertUnits(value: number, from: string, to: string): Promise<number> {
  return tauriInvoke<number>("convert_units", { value, from, to });
}

export interface EditOutcome {
  new_source: string;
  diff: string;
  parse_errors: string[];
}

export async function editElementSource(
  source: string,
  startByte: number,
  old: { name?: string | null; typeRef?: string | null; valueExpr?: string | null },
  changes: { name?: string; type_ref?: string; value_expr?: string; doc?: string },
): Promise<EditOutcome> {
  return tauriInvoke<EditOutcome>("edit_element_source", {
    source,
    startByte,
    oldName: old.name ?? null,
    oldTypeRef: old.typeRef ?? null,
    oldValueExpr: old.valueExpr ?? null,
    changes: {
      name: changes.name ?? null,
      type_ref: changes.type_ref ?? null,
      value_expr: changes.value_expr ?? null,
      doc: changes.doc ?? null,
    },
  });
}

export async function deleteElementSource(source: string, startByte: number): Promise<EditOutcome> {
  return tauriInvoke<EditOutcome>("delete_element_source", { source, startByte });
}

export async function insertElementSource(
  source: string,
  parentName: string | null,
  elementText: string,
): Promise<EditOutcome> {
  return tauriInvoke<EditOutcome>("insert_element_source", {
    source,
    parentName,
    elementText,
  });
}

export interface RenderedTable {
  view: string;
  columns: string[];
  rows: string[][];
  warnings?: string[];
}

export interface ViewInfo {
  name: string;
  file: string;
  renderable_table: boolean;
  render_as: string | null;
}

export async function renderModelView(viewName: string): Promise<RenderedTable> {
  return tauriInvoke<RenderedTable>("render_model_view", { viewName });
}

export async function listModelViews(): Promise<ViewInfo[]> {
  return tauriInvoke<ViewInfo[]>("list_model_views");
}

// ─── Model-driven analysis (generic primitives + presets) ───

export interface CalcInfo {
  name: string;
  parameters: string[];
  expression: string | null;
  doc: string | null;
}

export interface ComputedRow {
  element_id: number;
  element_name: string;
  fields: [string, string][];
  value: number | null;
  error: string | null;
  line: number;
}

export async function listCalcs(): Promise<CalcInfo[]> {
  return tauriInvoke<CalcInfo[]>("list_calcs");
}

export async function runCalcOverRows(calcName: string, provider: string): Promise<ComputedRow[]> {
  return tauriInvoke<ComputedRow[]>("run_calc_over_rows", { calcName, provider });
}
