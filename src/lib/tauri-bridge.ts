import type {
  SysmlModel, SysmlElement, ElementId,
  CompletenessReport, TraceabilityEntry,
  DiagramLayout
} from "./element-types";
import {
  browserParse, browserBddLayout, browserStmLayout,
  browserReqLayout, browserUcdLayout, browserIbdLayout,
  browserCompleteness, browserTraceability,
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
  if (isTauri) return tauriInvoke<[SysmlModel, string]>("open_file", { path });
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
 */
export async function resolveImports(source: string, filePath: string): Promise<string> {
  if (!isTauri) return source; // Can't resolve file imports in browser mode

  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  const dir = filePath.substring(0, filePath.lastIndexOf("/") + 1) || filePath.substring(0, filePath.lastIndexOf("\\") + 1);
  if (!dir) return source;

  // Find import statements like: import MyPackage::*; or import SomeFile::*;
  const importRegex = /^\s*import\s+(\w+)::\*/gm;
  const importedNames = new Set<string>();
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    importedNames.add(match[1]);
  }

  if (importedNames.size === 0) return source;

  // Try to load .sysml files from same directory matching import names
  const importedSources: string[] = [];
  for (const name of importedNames) {
    for (const ext of [".sysml", ".sysml2"]) {
      try {
        const importPath = dir + name + ext;
        const importSource = await readTextFile(importPath);
        importedSources.push(`// --- Imported from ${name}${ext} ---\n${importSource}`);
        break; // found it
      } catch {
        // File doesn't exist, skip
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

export async function getConnectedElements(elementId: ElementId): Promise<ElementId[]> {
  if (isTauri) return tauriInvoke<ElementId[]>("get_connected_elements", { elementId });
  return [];
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
  if (cachedModel) return browserReqLayout(cachedModel);
  return { diagram_type: "req", nodes: [], edges: [], bounds: [0, 0, 400, 300] };
}

export async function computeUcdLayout(): Promise<DiagramLayout> {
  if (cachedModel) return browserUcdLayout(cachedModel);
  return { diagram_type: "ucd", nodes: [], edges: [], bounds: [0, 0, 400, 300] };
}

export async function computeIbdLayout(blockName?: string): Promise<DiagramLayout> {
  if (cachedModel) return browserIbdLayout(cachedModel, blockName);
  return { diagram_type: "ibd", nodes: [], edges: [], bounds: [0, 0, 400, 300] };
}
