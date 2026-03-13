import type {
  SysmlModel, SysmlElement, ElementId,
  CompletenessReport, TraceabilityEntry,
  DiagramLayout, ValidationReport, HighlightToken,
  BomNode, ConstraintModel, CalcModel, EvalResult, Parameter,
  StateMachineModel, SimulationState, CoreTransition, SimStep,
  ActionModel, ActionExecState, ActionExecStep,
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

// Cache the latest model and source for browser-side queries
let cachedModel: SysmlModel | null = null;
let cachedSource: string = "";

export async function parseSource(source: string): Promise<SysmlModel> {
  if (isTauri) {
    const model = await tauriInvoke<SysmlModel>("parse_source", { source });
    cachedModel = model;
    cachedSource = source;
    return model;
  }
  const model = browserParse(source);
  cachedModel = model;
  cachedSource = source;
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
  return browserListConstraints();
}

export async function listCalculations(): Promise<CalcModel[]> {
  if (isTauri) return tauriInvoke<CalcModel[]>("list_calculations");
  return browserListCalcs();
}

export async function evaluateConstraint(constraintName: string, bindings: Record<string, number>): Promise<EvalResult> {
  if (isTauri) return tauriInvoke<EvalResult>("evaluate_constraint", { constraintName, bindings });
  return browserEvalExpr(constraintName, bindings, "constraint_def");
}

export async function evaluateCalculation(calcName: string, bindings: Record<string, number>): Promise<EvalResult> {
  if (isTauri) return tauriInvoke<EvalResult>("evaluate_calculation", { calcName, bindings });
  return browserEvalExpr(calcName, bindings, "calc_def");
}

export async function listStateMachines(): Promise<StateMachineModel[]> {
  if (isTauri) return tauriInvoke<StateMachineModel[]>("list_state_machines");
  return browserListStateMachines(cachedModel);
}

export async function simulateStateMachine(machineName: string, events: string[], maxSteps?: number): Promise<SimulationState> {
  if (isTauri) return tauriInvoke<SimulationState>("simulate_state_machine", { machineName, events, maxSteps: maxSteps ?? null });
  return browserSimulateStateMachine(cachedModel, machineName, events, maxSteps);
}

export async function listActions(): Promise<ActionModel[]> {
  if (isTauri) return tauriInvoke<ActionModel[]>("list_actions");
  return browserListActions(cachedModel);
}

export async function executeAction(actionName: string, maxSteps?: number): Promise<ActionExecState> {
  if (isTauri) return tauriInvoke<ActionExecState>("execute_action", { actionName, maxSteps: maxSteps ?? null });
  return browserExecuteAction(cachedModel, actionName, maxSteps);
}

// ─── Browser-side state machine extraction ───

function browserListStateMachines(model: SysmlModel | null): StateMachineModel[] {
  if (!model) return [];
  const els = model.elements;
  const stateDefs = els.filter(e => e.kind === "state_def");
  return stateDefs.map(sd => {
    const states = els.filter(e => e.kind === "state_usage" && e.parent_id === sd.id);
    const transitions = els.filter(e => e.kind === "transition_statement" && e.parent_id === sd.id);

    const coreTransitions: CoreTransition[] = transitions.map(t => {
      const source = t.specializations?.[0] ?? "";
      const target = t.type_ref ?? "";
      // Trigger signal stored in value_expr by browser-parser (from "accept <signal>" clause)
      const trigger: CoreTransition["trigger"] = t.value_expr ? { Signal: t.value_expr } : null;
      return {
        name: t.name ?? null, source, target, trigger,
        guard: null, effect: null,
        span: { start_row: t.span.start_line, start_col: t.span.start_col, end_row: t.span.end_line, end_col: t.span.end_col, start_byte: t.span.start_byte, end_byte: t.span.end_byte },
      };
    });

    return {
      name: sd.name ?? "<unnamed>",
      states: states.map(s => ({
        name: s.name ?? "<unnamed>",
        entry_action: null, do_action: null, exit_action: null,
        span: { start_row: s.span.start_line, start_col: s.span.start_col, end_row: s.span.end_line, end_col: s.span.end_col, start_byte: s.span.start_byte, end_byte: s.span.end_byte },
      })),
      transitions: coreTransitions,
      entry_state: states.length > 0 ? (states[0].name ?? null) : null,
      span: { start_row: sd.span.start_line, start_col: sd.span.start_col, end_row: sd.span.end_line, end_col: sd.span.end_col, start_byte: sd.span.start_byte, end_byte: sd.span.end_byte },
    };
  });
}

function browserSimulateStateMachine(
  model: SysmlModel | null, machineName: string, events: string[], maxSteps?: number,
): SimulationState {
  const machines = browserListStateMachines(model);
  const machine = machines.find(m => m.name === machineName);
  if (!machine) return { machine_name: machineName, current_state: "", step: 0, env: { bindings: {} }, trace: [], status: "Completed" };

  let current = machine.entry_state ?? (machine.states[0]?.name ?? "");
  const trace: SimStep[] = [];
  const limit = maxSteps ?? 100;

  for (let i = 0; i < events.length && trace.length < limit; i++) {
    const evt = events[i];
    // Find a matching transition: source matches current state, trigger signal matches event
    const trans = machine.transitions.find(t =>
      t.source === current && (
        (t.trigger && typeof t.trigger === "object" && "Signal" in t.trigger && t.trigger.Signal === evt) ||
        t.trigger === null // auto-transition
      )
    );
    if (trans) {
      trace.push({
        step: trace.length, from_state: current, transition_name: trans.name ?? null, trigger: evt,
        guard_result: true, effect: null, to_state: trans.target,
        exit_action: null, entry_action: null,
      });
      current = trans.target;
    } else {
      trace.push({
        step: trace.length, from_state: current, transition_name: null, trigger: evt,
        guard_result: false, effect: null, to_state: current,
        exit_action: null, entry_action: null,
      });
    }
  }

  return {
    machine_name: machineName, current_state: current,
    step: trace.length, env: { bindings: {} }, trace,
    status: trace.length >= limit ? "MaxSteps" : "Completed",
  };
}

// ─── Browser-side action extraction ───

// Build action steps from parsed elements, including control flow graph
export function browserListActions(model: SysmlModel | null): ActionModel[] {
  if (!model) return [];
  const els = model.elements;
  const actionDefs = els.filter(e => e.kind === "action_def");
  return actionDefs.map(ad => {
    const children = els.filter(e => e.parent_id === ad.id);
    const actions = children.filter(e => e.kind === "action_usage");
    const forks = children.filter(e => e.kind === "fork_node");
    const joins = children.filter(e => e.kind === "join_node");
    const successions = children.filter(e => e.kind === "succession_usage");
    const branches = children.filter(e => e.kind === "succession_branch");
    const accepts = children.filter(e => e.kind === "accept_action");
    const sends = children.filter(e => e.kind === "send_action");

    // Build steps: interleave actions with control flow nodes
    const steps: unknown[] = [];

    // If we have successions (first...then), build a proper flow graph
    if (successions.length > 0 || forks.length > 0) {
      // Collect all node names for ordering
      const forkNames = new Set(forks.map(f => f.name));
      const joinNames = new Set(joins.map(j => j.name));
      const actionNames = new Map(actions.map(a => [a.name, a]));

      // Build adjacency: source → targets
      const adj = new Map<string, string[]>();
      for (const s of successions) {
        const src = s.specializations[0];
        const tgt = s.type_ref;
        if (src && tgt) {
          const list = adj.get(src) ?? [];
          list.push(tgt);
          adj.set(src, list);
        }
      }

      // Fork branches: `then actionName;` lines following a fork
      // Associate each branch with its nearest preceding fork by source order
      const sortedForks = [...forks].sort((a, b) => a.span.start_line - b.span.start_line);
      const sortedBranches = [...branches].sort((a, b) => a.span.start_line - b.span.start_line);
      for (const b of sortedBranches) {
        // Find the last fork that appears before this branch
        let ownerFork: typeof sortedForks[0] | null = null;
        for (const f of sortedForks) {
          if (f.span.start_line < b.span.start_line) ownerFork = f;
          else break;
        }
        if (ownerFork) {
          const list = adj.get(ownerFork.name ?? "") ?? [];
          list.push(b.name ?? "");
          adj.set(ownerFork.name ?? "", list);
        }
      }

      // Build ordered execution from "start" node
      const visited = new Set<string>();
      function buildSteps(node: string): unknown[] {
        if (visited.has(node) || node === "done") return [];
        visited.add(node);
        const result: unknown[] = [];
        const targets = adj.get(node) ?? [];

        if (forkNames.has(node)) {
          // Fork: execute all targets in parallel
          const branchSteps = targets.map(t => {
            const chain: unknown[] = [];
            let cur = t;
            while (cur && !joinNames.has(cur) && !visited.has(cur) && cur !== "done") {
              visited.add(cur);
              if (actionNames.has(cur)) {
                chain.push({ Action: { name: cur, steps: [] } });
              } else if (forkNames.has(cur)) {
                chain.push(...buildSteps(cur));
              }
              const next = adj.get(cur);
              cur = next?.[0] ?? "";
            }
            return chain.length === 1 ? chain[0] : { Sequence: { steps: chain } };
          });
          result.push({ Fork: { name: node, branches: branchSteps } });
          // Find the join that follows by tracing any branch to a join
          let joinFound = false;
          for (const t of targets) {
            if (joinFound) break;
            let cur = t;
            while (cur && !joinNames.has(cur)) {
              const next = adj.get(cur);
              cur = next?.[0] ?? "";
            }
            if (joinNames.has(cur) && !visited.has(cur)) {
              visited.add(cur);
              const afterJoin = adj.get(cur) ?? [];
              result.push({ Join: { name: cur } });
              for (const aj of afterJoin) {
                result.push(...buildSteps(aj));
              }
              joinFound = true;
            }
          }
        } else if (actionNames.has(node)) {
          result.push({ Action: { name: node, steps: [] } });
          for (const t of targets) {
            result.push(...buildSteps(t));
          }
        } else if (joinNames.has(node)) {
          result.push({ Join: { name: node } });
          for (const t of targets) {
            result.push(...buildSteps(t));
          }
        }
        return result;
      }

      // Find starting point from "first start then X" succession
      const startSucc = successions.find(s => s.specializations[0] === "start");
      if (startSucc?.type_ref) {
        steps.push(...buildSteps(startSucc.type_ref));
      } else {
        // Fallback: just list actions
        for (const a of actions) steps.push({ Action: { name: a.name ?? "<unnamed>", steps: [] } });
      }

      // Include any accept/send as steps
      for (const ac of accepts) {
        if (!visited.has(ac.name ?? "")) {
          steps.push({ Accept: { signal: ac.name } });
        }
      }
      for (const sn of sends) {
        if (!visited.has(sn.name ?? "")) {
          steps.push({ Send: { payload: sn.name, to: sn.type_ref } });
        }
      }
    } else {
      // Simple sequential action — no explicit successions
      for (const a of actions) steps.push({ Action: { name: a.name ?? "<unnamed>", steps: [] } });
      for (const ac of accepts) steps.push({ Accept: { signal: ac.name } });
      for (const sn of sends) steps.push({ Send: { payload: sn.name, to: sn.type_ref } });
    }

    return {
      name: ad.name ?? "<unnamed>",
      steps,
      span: { start_row: ad.span.start_line, start_col: ad.span.start_col, end_row: ad.span.end_line, end_col: ad.span.end_col, start_byte: ad.span.start_byte, end_byte: ad.span.end_byte },
    };
  });
}

// Simulate action execution with fork/join parallelism and critical path tracking
export function browserExecuteAction(
  model: SysmlModel | null, actionName: string, maxSteps?: number,
): ActionExecState {
  const actions = browserListActions(model);
  const action = actions.find(a => a.name === actionName);
  if (!action) return { action_name: actionName, step: 0, env: { bindings: {} }, trace: [], status: "Completed" };

  const trace: ActionExecStep[] = [];
  const limit = maxSteps ?? 1000;
  let elapsed = 0;
  let sequentialTime = 0; // total time if everything were sequential
  let parallelBranches = 0;

  trace.push({ step: 0, kind: "Start", description: `Begin ${actionName}` });

  function execStep(step: unknown, depth: number): number {
    if (trace.length >= limit) return 0;
    const indent = "  ".repeat(depth);
    const entries = Object.entries(step as Record<string, unknown>);
    if (entries.length === 0) return 0;
    const [kind, data] = entries[0];
    const d = data as Record<string, unknown>;

    if (kind === "Fork") {
      const forkName = (d.name as string) ?? "fork";
      const branches = (d.branches as unknown[]) ?? [];
      parallelBranches += branches.length;
      trace.push({ step: trace.length, kind: "Fork", description: `${indent}[t=${elapsed}] Fork "${forkName}" → ${branches.length} parallel branches` });

      // Execute branches "in parallel" — track max time across branches
      const forkStart = elapsed;
      let maxBranchTime = 0;
      let totalBranchTime = 0;
      for (let bi = 0; bi < branches.length; bi++) {
        const branchStart = forkStart;
        elapsed = forkStart; // reset to fork point for each branch
        const branchTime = execStep(branches[bi], depth + 1);
        const branchDuration = elapsed - branchStart;
        totalBranchTime += branchDuration;
        maxBranchTime = Math.max(maxBranchTime, branchDuration);
        trace.push({ step: trace.length, kind: "Fork", description: `${indent}  Branch ${bi + 1}: ${branchDuration} time units` });
      }
      // Parallel: elapsed advances by max branch time (critical path)
      elapsed = forkStart + maxBranchTime;
      sequentialTime += totalBranchTime;
      return maxBranchTime;
    }

    if (kind === "Join") {
      const joinName = (d.name as string) ?? "join";
      trace.push({ step: trace.length, kind: "Join", description: `${indent}[t=${elapsed}] Join "${joinName}" — all branches synchronized` });
      return 0;
    }

    if (kind === "Sequence") {
      const steps = (d.steps as unknown[]) ?? [];
      let total = 0;
      for (const s of steps) {
        total += execStep(s, depth);
      }
      return total;
    }

    if (kind === "Action") {
      const name = (d.name as string) ?? "action";
      elapsed += 1;
      trace.push({ step: trace.length, kind: "Action", description: `${indent}[t=${elapsed}] Execute: ${name}` });
      return 1;
    }

    if (kind === "Accept") {
      const signal = (d.signal as string) ?? "event";
      elapsed += 1;
      trace.push({ step: trace.length, kind: "Accept", description: `${indent}[t=${elapsed}] Wait for: ${signal}` });
      return 1;
    }

    if (kind === "Send") {
      const payload = (d.payload as string) ?? "signal";
      const to = (d.to as string) ?? "";
      elapsed += 1;
      trace.push({ step: trace.length, kind: "Send", description: `${indent}[t=${elapsed}] Send: ${payload}${to ? " → " + to : ""}` });
      return 1;
    }

    if (kind === "Decide") {
      const decideName = (d.name as string) ?? "decide";
      trace.push({ step: trace.length, kind: "Decide", description: `${indent}[t=${elapsed}] Decision: ${decideName}` });
      return 0;
    }

    // Unknown step kind — treat as action
    elapsed += 1;
    trace.push({ step: trace.length, kind, description: `${indent}[t=${elapsed}] ${kind}` });
    return 1;
  }

  // Execute all top-level steps
  for (const step of action.steps) {
    execStep(step, 0);
    if (trace.length >= limit) break;
  }

  elapsed += 1;
  trace.push({ step: trace.length, kind: "End", description: `[t=${elapsed}] ${actionName} completed` });

  // Calculate analysis results
  const actionCount = trace.filter(t => t.kind === "Action").length;
  const parallelSavings = sequentialTime > 0 ? sequentialTime - (elapsed - 2) : 0; // subtract start/end
  const bindings: Record<string, unknown> = {
    total_actions: actionCount,
    critical_path_time: elapsed - 1, // subtract final increment
    parallel_branches: parallelBranches,
  };
  if (parallelSavings > 0) {
    bindings.sequential_time = sequentialTime + (actionCount - sequentialTime); // total if all sequential
    bindings.parallel_savings = parallelSavings;
  }

  return {
    action_name: actionName, step: trace.length,
    env: { bindings }, trace,
    status: trace.length >= limit ? "MaxSteps" : "Completed",
  };
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
    // Compute per-unit rollup (own attrs + children), then scale by multiplicity
    const rollups: Record<string, number> = {};
    for (const a of attrs) if (a.value !== null) rollups[a.name] = (rollups[a.name] ?? 0) + a.value;
    for (const c of children) for (const [k, v] of Object.entries(c.rollups)) rollups[k] = (rollups[k] ?? 0) + v;
    for (const k of Object.keys(rollups)) rollups[k] *= mult;
    const kind = typeof el.kind === "string" ? el.kind : "other";
    return { element_id: el.id, name: el.name ?? "<unnamed>", kind, type_ref: el.type_ref, multiplicity: mult, attributes: attrs, children, rollups };
  }

  return roots.map(r => buildNode(r, 1));
}

// ─── Browser-side calc/constraint extraction ───

/** Extract the source block for a given def element by matching braces from its span */
function extractDefBlock(name: string, kind: string, source: string): string | null {
  // Find `calc def Name {` or `constraint def Name {`
  const keyword = kind === "calc_def" ? "calc" : "constraint";
  const re = new RegExp(`${keyword}\\s+def\\s+${name}\\s*\\{`);
  const m = source.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return source.substring(start, i - 1);
}

interface ParsedDef {
  params: Parameter[];
  returnExpr: string | null;
  returnName: string | null;
  returnType: string | null;
  expr: string | null; // for constraints: the expression body
}

/** Parse params, return expr from a calc/constraint def body */
function parseDefBody(body: string, kind: string): ParsedDef {
  const params: Parameter[] = [];
  let returnExpr: string | null = null;
  let returnName: string | null = null;
  let returnType: string | null = null;
  let expr: string | null = null;

  for (const line of body.split("\n")) {
    const t = line.trim();
    // param: `in x : Real;` or `out y : Real;` or `inout z : Real;`
    const paramMatch = t.match(/^(in|out|inout)\s+(\w+)\s*(?::\s*(\w+))?\s*;/);
    if (paramMatch) {
      const dir = paramMatch[1] === "inout" ? "InOut" : paramMatch[1] === "out" ? "Out" : "In";
      params.push({ name: paramMatch[2], type_ref: paramMatch[3] ?? null, direction: dir as Parameter["direction"] });
      continue;
    }
    // return: `return result : Real = expr;`
    const retMatch = t.match(/^return\s+(\w+)\s*(?::\s*(\w+))?\s*=\s*([^;]+)/);
    if (retMatch) {
      returnName = retMatch[1];
      returnType = retMatch[2] ?? null;
      returnExpr = retMatch[3].trim();
      continue;
    }
    // constraint expression: `constraint expr;` or bare expression
    if (kind === "constraint_def" && !t.startsWith("in ") && !t.startsWith("out ") && !t.startsWith("//") && !t.startsWith("doc") && t.length > 1) {
      const stripped = t.replace(/;$/, "").trim();
      if (stripped) expr = stripped;
    }
  }

  return { params, returnExpr, returnName, returnType, expr };
}

function browserListCalcs(): CalcModel[] {
  if (!cachedModel || !cachedSource) return [];
  const els = cachedModel.elements;
  const calcDefs = els.filter(e => e.kind === "calc_def");
  return calcDefs.map(cd => {
    const name = cd.name ?? "<unnamed>";
    const block = extractDefBlock(name, "calc_def", cachedSource);
    const parsed = block ? parseDefBody(block, "calc_def") : { params: [], returnExpr: null, returnName: null, returnType: null, expr: null };
    return {
      name,
      params: parsed.params,
      return_name: parsed.returnName,
      return_type: parsed.returnType,
      return_expr: parsed.returnExpr,
      local_bindings: [],
      span: { start_row: cd.span.start_line, start_col: cd.span.start_col, end_row: cd.span.end_line, end_col: cd.span.end_col, start_byte: cd.span.start_byte, end_byte: cd.span.end_byte },
    };
  });
}

function browserListConstraints(): ConstraintModel[] {
  if (!cachedModel || !cachedSource) return [];
  const els = cachedModel.elements;
  const cDefs = els.filter(e => e.kind === "constraint_def");
  return cDefs.map(cd => {
    const name = cd.name ?? "<unnamed>";
    const block = extractDefBlock(name, "constraint_def", cachedSource);
    const parsed = block ? parseDefBody(block, "constraint_def") : { params: [], returnExpr: null, returnName: null, returnType: null, expr: null };
    return {
      name,
      params: parsed.params,
      expression: parsed.expr,
      span: { start_row: cd.span.start_line, start_col: cd.span.start_col, end_row: cd.span.end_line, end_col: cd.span.end_col, start_byte: cd.span.start_byte, end_byte: cd.span.end_byte },
    };
  });
}

/** Simple arithmetic expression evaluator: handles +, -, *, /, parentheses, variables */
function evalArith(expr: string, vars: Record<string, number>): number {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i])) { i++; continue; }
    if ("+-*/()".includes(expr[i])) { tokens.push(expr[i]); i++; continue; }
    // number or identifier
    let tok = "";
    while (i < expr.length && /[\w.]/.test(expr[i])) { tok += expr[i]; i++; }
    if (tok) tokens.push(tok);
  }

  let pos = 0;
  function peek(): string | undefined { return tokens[pos]; }
  function consume(): string { return tokens[pos++]; }

  function parseExpr(): number {
    let left = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number {
    let left = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parseFactor();
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function parseFactor(): number {
    if (peek() === "(") {
      consume(); // (
      const val = parseExpr();
      if (peek() === ")") consume();
      return val;
    }
    if (peek() === "-") {
      consume();
      return -parseFactor();
    }
    const tok = consume();
    if (tok === undefined) return 0;
    const num = parseFloat(tok);
    if (!isNaN(num)) return num;
    // Variable lookup
    if (tok in vars) return vars[tok];
    throw new Error(`Unknown variable: ${tok}`);
  }

  return parseExpr();
}

function browserEvalExpr(name: string, bindings: Record<string, number>, kind: string): EvalResult {
  if (!cachedSource) return { name, success: false, value: "", error: "No source loaded" };
  const block = extractDefBlock(name, kind, cachedSource);
  if (!block) return { name, success: false, value: "", error: `${name} not found` };
  const parsed = parseDefBody(block, kind);
  const expr = kind === "calc_def" ? parsed.returnExpr : parsed.expr;
  if (!expr) return { name, success: false, value: "", error: "No expression found" };
  try {
    const result = evalArith(expr, bindings);
    return { name, success: true, value: String(result), error: null };
  } catch (e: unknown) {
    return { name, success: false, value: "", error: e instanceof Error ? e.message : "Evaluation failed" };
  }
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
