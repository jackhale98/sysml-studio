import type {
  SysmlModel, SysmlElement, ElementId,
  CompletenessReport, TraceabilityEntry,
  DiagramLayout, ValidationReport, HighlightToken,
  BomNode, ConstraintModel, CalcModel, EvalResult,
  StateMachineModel, SimulationState,
  ActionModel, ActionExecState,
} from "./element-types";

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function parseSource(source: string): Promise<SysmlModel> {
  return tauriInvoke<SysmlModel>("parse_source", { source });
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
export async function resolveImports(source: string, filePath: string): Promise<string> {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  const dir = filePath.substring(0, filePath.lastIndexOf("/") + 1) || filePath.substring(0, filePath.lastIndexOf("\\") + 1);
  if (!dir) return source;

  const currentFileName = filePath.split("/").pop()?.split("\\").pop() ?? "";
  const resolvedFiles = new Set<string>([currentFileName]);
  const importedSources: string[] = [];

  const pendingSources = [source];
  while (pendingSources.length > 0) {
    const currentSource = pendingSources.pop()!;
    const importRegex = /^\s*import\s+(\w+)/gm;
    let match;
    while ((match = importRegex.exec(currentSource)) !== null) {
      const name = match[1];
      for (const ext of [".sysml", ".sysml2"]) {
        const fname = name + ext;
        if (resolvedFiles.has(fname)) break;
        try {
          const importPath = dir + fname;
          const importSource = await readTextFile(importPath);
          resolvedFiles.add(fname);
          importedSources.push(`// --- Imported from ${fname} ---\n${importSource}`);
          pendingSources.push(importSource);
          break;
        } catch {
          // File doesn't exist with this extension, try next
        }
      }
    }
  }

  if (importedSources.length === 0) return source;
  return importedSources.join("\n\n") + "\n\n" + source;
}

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
export async function computeBom(rootName?: string): Promise<BomNode[]> {
  return tauriInvoke<BomNode[]>("compute_bom", { rootName: rootName ?? null });
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
