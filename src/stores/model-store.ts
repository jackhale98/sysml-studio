import { create } from "zustand";
import type { SysmlModel, SysmlElement, CompletenessReport, TraceabilityEntry, ValidationReport } from "../lib/element-types";
import {
  parseSource, openFile, saveFile, resolveImports,
  getCompletenessReport, getTraceabilityMatrix, getValidation,
} from "../lib/tauri-bridge";

interface ModelState {
  model: SysmlModel | null;
  source: string;
  /** Cached content from imported files — prepended to source for parsing, NOT saved */
  importedPrefix: string;
  filePath: string | null;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  completeness: CompletenessReport | null;
  traceability: TraceabilityEntry[];
  validation: ValidationReport | null;

  loadSource: (source: string, filePath?: string) => Promise<void>;
  loadFile: (path: string) => Promise<void>;
  updateSource: (source: string) => Promise<void>;
  saveCurrentFile: () => Promise<void>;
  saveAs: (path: string) => Promise<void>;
  getElement: (id: number) => SysmlElement | undefined;
  refreshMbseData: () => Promise<void>;
  clearError: () => void;
}

export const useModelStore = create<ModelState>((set, get) => ({
  model: null,
  source: "",
  importedPrefix: "",
  filePath: null,
  dirty: false,
  loading: false,
  error: null,
  completeness: null,
  traceability: [],
  validation: null,

  loadSource: async (source, filePath) => {
    set({ loading: true, error: null, source, importedPrefix: "", filePath: filePath ?? null, dirty: false });
    try {
      const model = await parseSource(source);
      set({ model, loading: false });
      get().refreshMbseData();
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadFile: async (path) => {
    set({ loading: true, error: null });
    try {
      const [model, rawSource] = await openFile(path);
      // Resolve imports from sibling .sysml files
      const resolved = await resolveImports(rawSource, path);
      let importedPrefix = "";
      let finalModel = model;

      if (resolved !== rawSource) {
        // Extract the prefix (imported content) so we can re-use it on edits
        importedPrefix = resolved.substring(0, resolved.length - rawSource.length);
        finalModel = await parseSource(resolved);
      }

      set({ model: finalModel, source: rawSource, importedPrefix, filePath: path, dirty: false, loading: false });
      get().refreshMbseData();
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updateSource: async (source) => {
    set({ source, dirty: true });
    try {
      // Prepend cached imports so imported elements stay in the model
      const { importedPrefix } = get();
      const fullSource = importedPrefix ? importedPrefix + source : source;
      const model = await parseSource(fullSource);
      set({ model, error: null });
      get().refreshMbseData();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveCurrentFile: async () => {
    const { filePath, source } = get();
    if (!filePath) return;
    try {
      await saveFile(filePath, source);
      set({ dirty: false });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveAs: async (path) => {
    const { source } = get();
    try {
      await saveFile(path, source);
      set({ filePath: path, dirty: false });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  getElement: (id) => {
    return get().model?.elements.find((e) => e.id === id);
  },

  refreshMbseData: async () => {
    try {
      const [completeness, traceability, validation] = await Promise.all([
        getCompletenessReport(),
        getTraceabilityMatrix(),
        getValidation(),
      ]);
      set({ completeness, traceability, validation });
    } catch {
      // MBSE data is optional, don't fail the main flow
    }
  },

  clearError: () => set({ error: null }),
}));
