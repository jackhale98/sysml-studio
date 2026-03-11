import { create } from "zustand";
import type { SysmlModel, SysmlElement, CompletenessReport, TraceabilityEntry, ValidationReport } from "../lib/element-types";
import {
  parseSource, openFile, saveFile, resolveImports,
  getCompletenessReport, getTraceabilityMatrix, getValidation,
} from "../lib/tauri-bridge";

/** Per-file state tracked in the open files registry */
export interface OpenFile {
  /** Unique key — file path for disk files, generated id for untitled */
  id: string;
  /** Display name (filename without path) */
  name: string;
  /** Raw source text (what the user edits) */
  source: string;
  /** Cached prefix from imported sibling files */
  importedPrefix: string;
  /** Disk path (null for untitled or browser-loaded) */
  filePath: string | null;
  /** Has unsaved changes */
  dirty: boolean;
}

let nextUntitledId = 1;

interface ModelState {
  /** All open files keyed by id */
  openFiles: Record<string, OpenFile>;
  /** Currently active file id */
  activeFileId: string | null;
  /** Combined parsed model from ALL open files */
  model: SysmlModel | null;
  loading: boolean;
  error: string | null;
  completeness: CompletenessReport | null;
  traceability: TraceabilityEntry[];
  validation: ValidationReport | null;

  /** Mirrors of active file for backwards compat with existing selectors */
  source: string;
  filePath: string | null;
  dirty: boolean;

  loadSource: (source: string, filePath?: string) => Promise<void>;
  loadFile: (path: string) => Promise<void>;
  updateSource: (source: string) => Promise<void>;
  saveCurrentFile: () => Promise<void>;
  saveAs: (path: string) => Promise<void>;
  setActiveFile: (id: string) => void;
  closeFile: (id: string) => void;
  addImport: (packageName: string) => Promise<void>;
  getElement: (id: number) => SysmlElement | undefined;
  getImportablePackages: () => string[];
  refreshMbseData: () => Promise<void>;
  clearError: () => void;
}

/** Combine all open file sources for a unified parse */
function buildCombinedSource(files: Record<string, OpenFile>, activeId: string | null): string {
  const parts: string[] = [];
  for (const [id, file] of Object.entries(files)) {
    if (id === activeId) continue;
    if (file.source.trim()) {
      parts.push(`// --- From ${file.name} ---\n${file.source}`);
    }
  }
  if (activeId && files[activeId]) {
    const active = files[activeId];
    if (active.importedPrefix) {
      parts.push(active.importedPrefix);
    }
    parts.push(active.source);
  }
  return parts.join("\n\n");
}

async function reparseAll(
  files: Record<string, OpenFile>,
  activeId: string | null,
): Promise<SysmlModel> {
  const combined = buildCombinedSource(files, activeId);
  return parseSource(combined);
}

/** Extract mirror fields from active file */
function mirrorActive(files: Record<string, OpenFile>, activeId: string | null) {
  const f = activeId ? files[activeId] : null;
  return {
    source: f?.source ?? "",
    filePath: f?.filePath ?? null,
    dirty: f?.dirty ?? false,
  };
}

export const useModelStore = create<ModelState>((set, get) => ({
  openFiles: {},
  activeFileId: null,
  model: null,
  loading: false,
  error: null,
  completeness: null,
  traceability: [],
  validation: null,
  source: "",
  filePath: null,
  dirty: false,

  loadSource: async (source, filePath) => {
    const id = filePath ?? `untitled-${nextUntitledId++}.sysml`;
    const name = filePath?.split("/").pop()?.split("\\").pop() ?? id;
    const newFile: OpenFile = {
      id, name, source, importedPrefix: "", filePath: filePath ?? null, dirty: false,
    };
    const files = { ...get().openFiles, [id]: newFile };
    set({ openFiles: files, activeFileId: id, loading: true, error: null, ...mirrorActive(files, id) });
    try {
      const model = await reparseAll(files, id);
      set({ model, loading: false });
      get().refreshMbseData();
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadFile: async (path) => {
    // If already open, just switch to it
    const existing = Object.values(get().openFiles).find(f => f.filePath === path);
    if (existing) {
      const files = get().openFiles;
      set({ activeFileId: existing.id, ...mirrorActive(files, existing.id) });
      try {
        const model = await reparseAll(files, existing.id);
        set({ model, error: null });
        get().refreshMbseData();
      } catch (e) {
        set({ error: String(e) });
      }
      return;
    }

    set({ loading: true, error: null });
    try {
      const [_model, rawSource] = await openFile(path);
      const resolved = await resolveImports(rawSource, path);
      let importedPrefix = "";
      if (resolved !== rawSource) {
        importedPrefix = resolved.substring(0, resolved.length - rawSource.length);
      }

      const name = path.split("/").pop()?.split("\\").pop() ?? "file.sysml";
      const newFile: OpenFile = {
        id: path, name, source: rawSource, importedPrefix, filePath: path, dirty: false,
      };
      const files = { ...get().openFiles, [path]: newFile };
      set({ openFiles: files, activeFileId: path, ...mirrorActive(files, path) });

      const model = await reparseAll(files, path);
      set({ model, loading: false });
      get().refreshMbseData();
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updateSource: async (source) => {
    const { activeFileId, openFiles } = get();
    if (!activeFileId || !openFiles[activeFileId]) return;

    const updated = { ...openFiles[activeFileId], source, dirty: true };
    const files = { ...openFiles, [activeFileId]: updated };
    set({ openFiles: files, source, dirty: true });

    try {
      const model = await reparseAll(files, activeFileId);
      set({ model, error: null });
      get().refreshMbseData();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveCurrentFile: async () => {
    const { activeFileId, openFiles } = get();
    if (!activeFileId) return;
    const file = openFiles[activeFileId];
    if (!file?.filePath) return;
    try {
      await saveFile(file.filePath, file.source);
      const updated = { ...file, dirty: false };
      set({ openFiles: { ...openFiles, [activeFileId]: updated }, dirty: false });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveAs: async (path) => {
    const { activeFileId, openFiles } = get();
    if (!activeFileId) return;
    const file = openFiles[activeFileId];
    if (!file) return;
    try {
      await saveFile(path, file.source);
      const name = path.split("/").pop()?.split("\\").pop() ?? "file.sysml";
      const newFiles = { ...openFiles };
      delete newFiles[activeFileId];
      newFiles[path] = { ...file, id: path, name, filePath: path, dirty: false };
      set({ openFiles: newFiles, activeFileId: path, filePath: path, dirty: false });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setActiveFile: (id) => {
    const { openFiles } = get();
    if (!openFiles[id]) return;
    set({ activeFileId: id, ...mirrorActive(openFiles, id) });
    reparseAll(openFiles, id).then(model => {
      set({ model, error: null });
      get().refreshMbseData();
    }).catch(e => set({ error: String(e) }));
  },

  closeFile: (id) => {
    const { openFiles, activeFileId } = get();
    const file = openFiles[id];
    if (!file) return;
    if (file.dirty && !confirm(`"${file.name}" has unsaved changes. Close anyway?`)) return;

    const newFiles = { ...openFiles };
    delete newFiles[id];
    const remaining = Object.keys(newFiles);

    let newActiveId: string | null = null;
    if (remaining.length > 0) {
      newActiveId = activeFileId === id ? remaining[remaining.length - 1] : activeFileId;
    }

    if (remaining.length === 0) {
      set({
        openFiles: newFiles, activeFileId: null,
        model: null, completeness: null, traceability: [], validation: null,
        source: "", filePath: null, dirty: false,
      });
    } else {
      set({ openFiles: newFiles, activeFileId: newActiveId, ...mirrorActive(newFiles, newActiveId) });
      if (newActiveId) {
        reparseAll(newFiles, newActiveId).then(model => {
          set({ model, error: null });
          get().refreshMbseData();
        }).catch(e => set({ error: String(e) }));
      }
    }
  },

  addImport: async (packageName) => {
    const { activeFileId, openFiles } = get();
    if (!activeFileId) return;
    const file = openFiles[activeFileId];
    if (!file) return;

    const lines = file.source.split("\n");
    let insertIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("package ") || trimmed.startsWith("import ")) {
        insertIdx = i + 1;
      }
    }
    const importLine = `import ${packageName}::*;`;
    if (lines.some(l => l.trim() === importLine)) return;

    lines.splice(insertIdx, 0, importLine);
    const newSource = lines.join("\n");
    await get().updateSource(newSource);
  },

  getElement: (id) => get().model?.elements.find((e) => e.id === id),

  getImportablePackages: () => {
    const { openFiles, activeFileId } = get();
    const packages: string[] = [];
    for (const [id, file] of Object.entries(openFiles)) {
      if (id === activeFileId) continue;
      const pkgRegex = /^\s*package\s+(\w+)/gm;
      let match;
      while ((match = pkgRegex.exec(file.source)) !== null) {
        packages.push(match[1]);
      }
    }
    return packages;
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
      // MBSE data is optional
    }
  },

  clearError: () => set({ error: null }),
}));
