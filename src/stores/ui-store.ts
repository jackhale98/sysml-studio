import { create } from "zustand";
import type { ElementId } from "../lib/element-types";

export type TabId = "browser" | "diagram" | "editor" | "mbse";
export type DiagramType = "bdd" | "stm" | "req" | "ucd" | "ibd";
export type ThemeMode = "dark" | "light";

export type DialogType = "create" | "edit" | "delete" | null;

interface UIState {
  activeTab: TabId;
  selectedElementId: ElementId | null;
  showDetailSheet: boolean;
  diagramType: DiagramType;
  highlightedNodeId: string | null;
  activeDialog: DialogType;
  editTargetId: ElementId | null;
  scrollToLine: number | null;
  theme: ThemeMode;

  setTab: (tab: TabId) => void;
  selectElement: (id: ElementId | null) => void;
  setShowDetail: (show: boolean) => void;
  setDiagramType: (type: DiagramType) => void;
  setHighlightedNode: (id: string | null) => void;
  navigateToDiagram: (elementName: string, targetDiagramType?: DiagramType) => void;
  navigateToEditor: (line?: number) => void;
  openDialog: (type: DialogType, elementId?: ElementId) => void;
  closeDialog: () => void;
  clearScrollToLine: () => void;
  toggleTheme: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeTab: "browser",
  selectedElementId: null,
  showDetailSheet: false,
  diagramType: "bdd",
  highlightedNodeId: null,
  activeDialog: null,
  editTargetId: null,
  scrollToLine: null,
  theme: (localStorage.getItem("sysml-theme") as ThemeMode) ?? "dark",

  setTab: (tab) => set({ activeTab: tab, showDetailSheet: false }),

  selectElement: (id) => set({
    selectedElementId: id,
    showDetailSheet: id !== null
  }),

  setShowDetail: (show) => set({ showDetailSheet: show }),

  setDiagramType: (type) => set({
    diagramType: type,
    highlightedNodeId: null
  }),

  setHighlightedNode: (id) => set((state) => ({
    highlightedNodeId: state.highlightedNodeId === id ? null : id
  })),

  navigateToDiagram: (elementName, targetDiagramType) => set((state) => ({
    activeTab: "diagram",
    highlightedNodeId: elementName,
    diagramType: targetDiagramType ?? state.diagramType,
    showDetailSheet: false,
  })),

  navigateToEditor: (line) => set({
    activeTab: "editor",
    showDetailSheet: false,
    scrollToLine: line ?? null,
  }),

  clearScrollToLine: () => set({ scrollToLine: null }),

  openDialog: (type, elementId) => set({
    activeDialog: type,
    editTargetId: elementId ?? null,
    showDetailSheet: false,
  }),

  closeDialog: () => set({
    activeDialog: null,
    editTargetId: null,
  }),

  toggleTheme: () => set((state) => {
    const next = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("sysml-theme", next);
    document.documentElement.setAttribute("data-theme", next);
    return { theme: next };
  }),

}));
