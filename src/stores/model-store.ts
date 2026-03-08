import { create } from "zustand";
import type { SysmlModel, SysmlElement, CompletenessReport, TraceabilityEntry } from "../lib/element-types";
import {
  parseSource, openFile, saveFile, resolveImports,
  getCompletenessReport, getTraceabilityMatrix,
} from "../lib/tauri-bridge";

interface ModelState {
  model: SysmlModel | null;
  source: string;
  filePath: string | null;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  completeness: CompletenessReport | null;
  traceability: TraceabilityEntry[];

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
  filePath: null,
  dirty: false,
  loading: false,
  error: null,
  completeness: null,
  traceability: [],

  loadSource: async (source, filePath) => {
    set({ loading: true, error: null, source, filePath: filePath ?? null, dirty: false });
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
      // Resolve imports from the same directory
      const source = await resolveImports(rawSource, path);
      if (source !== rawSource) {
        // Re-parse with combined source
        const combinedModel = await parseSource(source);
        set({ model: combinedModel, source, filePath: path, dirty: false, loading: false });
      } else {
        set({ model, source: rawSource, filePath: path, dirty: false, loading: false });
      }
      get().refreshMbseData();
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updateSource: async (source) => {
    set({ source, dirty: true });
    try {
      const model = await parseSource(source);
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
      const [completeness, traceability] = await Promise.all([
        getCompletenessReport(),
        getTraceabilityMatrix(),
      ]);
      set({ completeness, traceability });
    } catch {
      // MBSE data is optional, don't fail the main flow
    }
  },

  clearError: () => set({ error: null }),
}));
