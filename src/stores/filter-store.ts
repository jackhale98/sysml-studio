import { create } from "zustand";
import type { Category } from "../lib/element-types";

interface FilterState {
  activeCategories: Category[];
  searchTerm: string;
  showDefinitions: boolean;
  showUsages: boolean;
  showRelationships: boolean;
  selectedKinds: string[];

  toggleCategory: (category: Category) => void;
  setAllCategories: (active: boolean) => void;
  setSearchTerm: (term: string) => void;
  setShowDefinitions: (show: boolean) => void;
  setShowUsages: (show: boolean) => void;
  setShowRelationships: (show: boolean) => void;
  toggleKind: (kind: string) => void;
  clearKindFilter: () => void;
  resetFilters: () => void;
}

const ALL_CATEGORIES: Category[] = [
  "structure", "behavior", "requirement", "interface",
  "property", "relationship", "constraint", "analysis", "view",
];

export const useFilterStore = create<FilterState>((set) => ({
  activeCategories: [...ALL_CATEGORIES],
  searchTerm: "",
  showDefinitions: true,
  showUsages: true,
  showRelationships: true,
  selectedKinds: [],

  toggleCategory: (category) =>
    set((state) => {
      const has = state.activeCategories.includes(category);
      return {
        activeCategories: has
          ? state.activeCategories.filter((c) => c !== category)
          : [...state.activeCategories, category],
      };
    }),

  setAllCategories: (active) =>
    set({ activeCategories: active ? [...ALL_CATEGORIES] : [] }),

  setSearchTerm: (term) => set({ searchTerm: term }),

  setShowDefinitions: (show) => set({ showDefinitions: show }),
  setShowUsages: (show) => set({ showUsages: show }),
  setShowRelationships: (show) => set({ showRelationships: show }),

  toggleKind: (kind) =>
    set((state) => {
      const has = state.selectedKinds.includes(kind);
      return {
        selectedKinds: has
          ? state.selectedKinds.filter((k) => k !== kind)
          : [...state.selectedKinds, kind],
      };
    }),

  clearKindFilter: () => set({ selectedKinds: [] }),

  resetFilters: () =>
    set({
      activeCategories: [...ALL_CATEGORIES],
      searchTerm: "",
      showDefinitions: true,
      showUsages: true,
      showRelationships: true,
      selectedKinds: [],
    }),
}));
