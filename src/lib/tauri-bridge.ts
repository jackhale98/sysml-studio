import type {
  SysmlModel, SysmlElement, ElementId,
  CompletenessReport, TraceabilityEntry,
  DiagramLayout, ValidationReport, HighlightToken,
  BomNode, ConstraintModel, CalcModel, EvalResult,
  StateMachineModel, SimulationState,
  ActionModel, ActionExecState,
} from "./element-types";
import {
  browserParse, browserBddLayout, browserStmLayout,
  browserReqLayout, browserUcdLayout, browserIbdLayout,
  browserCompleteness, browserTraceability, browserValidation,
} from "./browser-parser";

// Detect if we're running inside Tauri or in a plain browser
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// Cache the latest model for browser-side diagram/MBSE queries
let cachedModel: SysmlModel | null = null;

export async function parseSource(source: string): Promise<SysmlModel> {
  if (isTauri) {
    const model = await tauriInvoke<SysmlModel>("parse_source", { source });
    cachedModel = model;
    return model;
  }
  const model = browserParse(source);
  cachedModel = model;
  return model;
}

export async function openFile(path: string): Promise<[SysmlModel, string]> {
  if (isTauri) {
    const result = await tauriInvoke<[SysmlModel, string]>("open_file", { path });
    cachedModel = result[0];
    return result;
  }
  throw new Error("File open not available in browser mode");
}

export async function saveFile(path: string, source: string): Promise<void> {
  if (isTauri) return tauriInvoke<void>("save_file", { path, source });
  // Browser fallback: download as file
  const blob = new Blob([source], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").pop() ?? "model.sysml";
  a.click();
  URL.revokeObjectURL(url);
}

/** Open a file picker dialog. Returns the selected path, or null if cancelled. */
export async function pickFile(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({
      title: "Open SysML File",
      filters: [{ name: "SysML", extensions: ["sysml", "sysml2"] }],
      multiple: false,
    });
    return typeof result === "string" ? result : null;
  }
  // Browser fallback: use <input type="file">
  return null; // handled separately in the UI
}

/** Open a save file dialog. Returns the selected path, or null if cancelled. */
export async function pickSaveFile(defaultName?: string): Promise<string | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const result = await save({
      title: "Save SysML File",
      defaultPath: defaultName,
      filters: [{ name: "SysML", extensions: ["sysml"] }],
    });
    return result;
  }
  return null;
}

/**
 * Resolve imports: scan source for `import` statements, load referenced files
 * from the same directory, and return combined source.
 *
 * Handles patterns like:
 *   import Foo::*;       (wildcard)
 *   import Foo::Bar;     (specific)
 *   import Foo;           (bare package)
 *   import Foo::**;       (recursive)
 *
 * Recursively resolves imports in imported files too.
 */
export async function resolveImports(source: string, filePath: string): Promise<string> {
  if (!isTauri) return source; // Can't resolve file imports in browser mode

  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  const dir = filePath.substring(0, filePath.lastIndexOf("/") + 1) || filePath.substring(0, filePath.lastIndexOf("\\") + 1);
  if (!dir) return source;

  const currentFileName = filePath.split("/").pop()?.split("\\").pop() ?? "";
  const resolvedFiles = new Set<string>([currentFileName]);
  const importedSources: string[] = [];

  // Process sources in a queue to handle recursive imports
  const pendingSources = [source];
  while (pendingSources.length > 0) {
    const currentSource = pendingSources.pop()!;
    // Match any import statement and extract the first path component
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
          pendingSources.push(importSource); // Check for nested imports
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

/** Read a file picked via browser <input type="file"> */
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
  if (isTauri) {
    return tauriInvoke<SysmlElement[]>("filter_elements", {
      categories, searchTerm: searchTerm ?? null,
      parentName: parentName ?? null, kinds: kinds ?? [],
    });
  }
  return cachedModel?.elements ?? [];
}

// MBSE Commands
export async function getImpactAnalysis(elementId: ElementId): Promise<SysmlElement[]> {
  if (isTauri) return tauriInvoke<SysmlElement[]>("impact_analysis", { elementId });
  return [];
}

export async function getCompletenessReport(): Promise<CompletenessReport> {
  if (isTauri) return tauriInvoke<CompletenessReport>("check_completeness");
  if (cachedModel) return browserCompleteness(cachedModel);
  return { unsatisfied_requirements: [], unverified_requirements: [], unconnected_ports: [], untyped_usages: [], score: 1.0, summary: [] };
}

export async function getTraceabilityMatrix(): Promise<TraceabilityEntry[]> {
  if (isTauri) return tauriInvoke<TraceabilityEntry[]>("get_traceability_matrix");
  if (cachedModel) return browserTraceability(cachedModel);
  return [];
}

export async function getValidation(): Promise<ValidationReport> {
  if (isTauri) return tauriInvoke<ValidationReport>("get_validation");
  if (cachedModel) return browserValidation(cachedModel);
  return { issues: [], summary: { errors: 0, warnings: 0, infos: 0 } };
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
  if (isTauri) return tauriInvoke<ElementId[]>("get_connected_elements", { elementId });
  return [];
}

// Syntax Highlighting
export async function getHighlightRanges(): Promise<HighlightToken[]> {
  if (isTauri) return tauriInvoke<HighlightToken[]>("get_highlight_ranges");
  // Browser fallback: use regex-based tokenizer
  return browserHighlight(cachedModel);
}

/** Simple regex tokenizer for browser mode (fallback when no Rust backend) */
function browserHighlight(model: SysmlModel | null): HighlightToken[] {
  if (!model) return [];
  // For browser mode we don't have the raw source bytes accessible from the model,
  // so return empty — the CodeMirror StreamLanguage handles browser-mode highlighting
  return [];
}

// ─── Analysis Commands ───

export async function computeBom(rootName?: string): Promise<BomNode[]> {
  if (isTauri) return tauriInvoke<BomNode[]>("compute_bom", { rootName: rootName ?? null });
  // Browser fallback: build simple BOM from cached model
  if (cachedModel) return browserBom(cachedModel, rootName);
  return [];
}

export async function listConstraints(): Promise<ConstraintModel[]> {
  if (isTauri) return tauriInvoke<ConstraintModel[]>("list_constraints");
  return [];
}

export async function listCalculations(): Promise<CalcModel[]> {
  if (isTauri) return tauriInvoke<CalcModel[]>("list_calculations");
  return [];
}

export async function evaluateConstraint(constraintName: string, bindings: Record<string, number>): Promise<EvalResult> {
  if (isTauri) return tauriInvoke<EvalResult>("evaluate_constraint", { constraintName, bindings });
  return { name: constraintName, success: false, value: "", error: "Not available in browser mode" };
}

export async function evaluateCalculation(calcName: string, bindings: Record<string, number>): Promise<EvalResult> {
  if (isTauri) return tauriInvoke<EvalResult>("evaluate_calculation", { calcName, bindings });
  return { name: calcName, success: false, value: "", error: "Not available in browser mode" };
}

export async function listStateMachines(): Promise<StateMachineModel[]> {
  if (isTauri) return tauriInvoke<StateMachineModel[]>("list_state_machines");
  return [];
}

export async function simulateStateMachine(machineName: string, events: string[], maxSteps?: number): Promise<SimulationState> {
  if (isTauri) return tauriInvoke<SimulationState>("simulate_state_machine", { machineName, events, maxSteps: maxSteps ?? null });
  return { machine_name: machineName, current_state: "", step: 0, env: { bindings: {} }, trace: [], status: "Completed" };
}

export async function listActions(): Promise<ActionModel[]> {
  if (isTauri) return tauriInvoke<ActionModel[]>("list_actions");
  return [];
}

export async function executeAction(actionName: string, maxSteps?: number): Promise<ActionExecState> {
  if (isTauri) return tauriInvoke<ActionExecState>("execute_action", { actionName, maxSteps: maxSteps ?? null });
  return { action_name: actionName, step: 0, env: { bindings: {} }, trace: [], status: "Completed" };
}

/** Simple browser-side BOM builder from model elements */
function browserBom(model: SysmlModel, rootName?: string): BomNode[] {
  const els = model.elements;
  const roots = rootName
    ? els.filter(e => e.name === rootName && (e.kind === "part_def" || e.kind === "part_usage"))
    : els.filter(e => (e.kind === "part_def" || e.kind === "part_usage") &&
        (e.parent_id === null || els.find(p => p.id === e.parent_id)?.kind === "package"));

  const visited = new Set<ElementId>();
  function buildNode(el: SysmlElement, mult: number): BomNode {
    visited.add(el.id);
    const attrs = els.filter(c => c.parent_id === el.id && c.kind === "attribute_usage")
      .map(a => ({ name: a.name ?? "", value: a.value_expr ? parseFloat(a.value_expr) || null : null, unit: null, type_ref: a.type_ref }));
    const children: BomNode[] = [];
    for (const child of els.filter(c => c.parent_id === el.id && c.kind === "part_usage")) {
      if (visited.has(child.id)) continue;
      const cm = child.multiplicity ? parseFloat(child.multiplicity) || 1 : 1;
      const resolved = child.type_ref ? els.find(e => e.name === child.type_ref && e.kind === "part_def") : undefined;
      children.push(buildNode(resolved && !visited.has(resolved.id) ? resolved : child, cm));
    }
    const rollups: Record<string, number> = {};
    for (const a of attrs) if (a.value !== null) rollups[a.name] = (rollups[a.name] ?? 0) + a.value * mult;
    for (const c of children) for (const [k, v] of Object.entries(c.rollups)) rollups[k] = (rollups[k] ?? 0) + v;
    const kind = typeof el.kind === "string" ? el.kind : "other";
    return { element_id: el.id, name: el.name ?? "<unnamed>", kind, type_ref: el.type_ref, multiplicity: mult, attributes: attrs, children, rollups };
  }

  return roots.map(r => buildNode(r, 1));
}

// Diagram Commands
export async function computeBddLayout(rootName?: string): Promise<DiagramLayout> {
  if (isTauri) return tauriInvoke<DiagramLayout>("compute_bdd_layout", { rootName: rootName ?? null });
  if (cachedModel) return browserBddLayout(cachedModel);
  return { diagram_type: "bdd", nodes: [], edges: [], bounds: [0, 0, 400, 300] };
}

export async function computeStmLayout(stateDefName: string): Promise<DiagramLayout> {
  if (isTauri) return tauriInvoke<DiagramLayout>("compute_stm_layout", { stateDefName });
  if (cachedModel) return browserStmLayout(cachedModel, stateDefName);
  return { diagram_type: "stm", nodes: [], edges: [], bounds: [0, 0, 400, 300] };
}

export async function computeReqLayout(): Promise<DiagramLayout> {
  if (isTauri) return tauriInvoke<DiagramLayout>("compute_req_layout");
  if (cachedModel) return browserReqLayout(cachedModel);
  return { diagram_type: "req", nodes: [], edges: [], bounds: [0, 0, 400, 300] };
}

export async function computeUcdLayout(): Promise<DiagramLayout> {
  if (isTauri) return tauriInvoke<DiagramLayout>("compute_ucd_layout");
  if (cachedModel) return browserUcdLayout(cachedModel);
  return { diagram_type: "ucd", nodes: [], edges: [], bounds: [0, 0, 400, 300] };
}

export async function computeIbdLayout(blockName?: string): Promise<DiagramLayout> {
  if (isTauri) return tauriInvoke<DiagramLayout>("compute_ibd_layout", { blockName: blockName ?? null });
  if (cachedModel) return browserIbdLayout(cachedModel, blockName);
  return { diagram_type: "ibd", nodes: [], edges: [], bounds: [0, 0, 400, 300] };
}
