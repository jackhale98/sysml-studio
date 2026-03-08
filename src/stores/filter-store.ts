import { create } from "zustand";
import type { Category } from "../lib/element-types";

interface FilterState {
  activeCategories: Category[];
  searchTerm: string;
  showDefinitions: boolean;
  showUsages: boolean;
  showRelationships: boolean;

  toggleCategory: (category: Category) => void;
  setAllCategories: (active: boolean) => void;
  setSearchTerm: (term: string) => void;
  setShowDefinitions: (show: boolean) => void;
  setShowUsages: (show: boolean) => void;
  setShowRelationships: (show: boolean) => void;
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

  resetFilters: () =>
    set({
      activeCategories: [...ALL_CATEGORIES],
      searchTerm: "",
      showDefinitions: true,
      showUsages: true,
      showRelationships: true,
    }),
}));
