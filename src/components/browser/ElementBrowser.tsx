import React, { useMemo } from "react";
import { useModelStore } from "../../stores/model-store";
import { useFilterStore } from "../../stores/filter-store";
import { useUIStore } from "../../stores/ui-store";
import { FilterPanel } from "./FilterPanel";
import { ElementRow } from "./ElementRow";
import { filterElements } from "../../lib/filter-engine";

export function ElementBrowser() {
  const model = useModelStore((s) => s.model);
  const selectedId = useUIStore((s) => s.selectedElementId);
  const selectElement = useUIStore((s) => s.selectElement);
  const { activeCategories, searchTerm, showDefinitions, showUsages, showRelationships, selectedKinds } = useFilterStore();

  const filteredElements = useMemo(() => {
    if (!model) return [];
    return filterElements(model.elements, {
      categories: activeCategories,
      searchTerm,
      showDefinitions,
      showUsages,
      showRelationships,
      selectedKinds,
    });
  }, [model, activeCategories, searchTerm, showDefinitions, showUsages, showRelationships, selectedKinds]);

  const getParentName = (parentId: number | null): string | undefined => {
    if (parentId === null || !model) return undefined;
    return model.elements.find((e) => e.id === parentId)?.name ?? undefined;
  };

  return (
    <>
      <FilterPanel />
      <div style={{ flex: 1, overflow: "auto" }}>
        {filteredElements.length === 0 ? (
          <div style={{
            padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13,
          }}>
            {model ? "No elements match filters" : "Load a .sysml file to begin"}
          </div>
        ) : (
          filteredElements.map((el) => (
            <ElementRow
              key={el.id}
              element={el}
              parentName={getParentName(el.parent_id)}
              selected={selectedId === el.id}
              onSelect={(e) => selectElement(e.id)}
            />
          ))
        )}
      </div>
      <div style={{
        padding: "6px 14px", borderTop: "1px solid var(--border)", fontSize: 11,
        color: "var(--text-muted)", fontFamily: "var(--font-mono)", textAlign: "center",
      }}>
        {filteredElements.length} of {model?.elements.length ?? 0} elements
        {model && ` · ${model.stats.parse_time_ms.toFixed(1)}ms`}
      </div>
    </>
  );
}
