import React, { useMemo, useState, useCallback } from "react";
import { useModelStore } from "../../stores/model-store";
import { useFilterStore } from "../../stores/filter-store";
import { useUIStore } from "../../stores/ui-store";
import { FilterPanel } from "./FilterPanel";
import { ElementRow } from "./ElementRow";
import { filterElements } from "../../lib/filter-engine";
import type { SysmlElement, ElementId } from "../../lib/element-types";

interface TreeNode {
  element: SysmlElement;
  children: TreeNode[];
  depth: number;
}

function buildTree(
  elements: SysmlElement[],
  filteredSet: Set<ElementId>,
  allById: Map<ElementId, SysmlElement>,
): TreeNode[] {
  // Find root elements (no parent, or parent not in the element list)
  const roots: TreeNode[] = [];
  const nodeMap = new Map<ElementId, TreeNode>();

  // Create nodes for all filtered elements
  for (const el of elements) {
    if (!filteredSet.has(el.id)) continue;
    nodeMap.set(el.id, { element: el, children: [], depth: 0 });
  }

  // Build parent-child relationships
  for (const [id, node] of nodeMap) {
    const parentId = node.element.parent_id;
    if (parentId !== null && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Set depths recursively
  function setDepth(nodes: TreeNode[], depth: number) {
    for (const n of nodes) {
      n.depth = depth;
      setDepth(n.children, depth + 1);
    }
  }
  setDepth(roots, 0);

  return roots;
}

function flattenVisible(
  nodes: TreeNode[],
  collapsed: Set<ElementId>,
  result: { element: SysmlElement; depth: number; hasChildren: boolean; expanded: boolean }[] = [],
) {
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    const expanded = hasChildren && !collapsed.has(node.element.id);
    result.push({ element: node.element, depth: node.depth, hasChildren, expanded });
    if (expanded) {
      flattenVisible(node.children, collapsed, result);
    }
  }
  return result;
}

export function ElementBrowser() {
  const model = useModelStore((s) => s.model);
  const selectedId = useUIStore((s) => s.selectedElementId);
  const selectElement = useUIStore((s) => s.selectElement);
  const openDialog = useUIStore((s) => s.openDialog);
  const { activeCategories, searchTerm, showDefinitions, showUsages, showRelationships, selectedKinds } = useFilterStore();

  const [collapsed, setCollapsed] = useState<Set<ElementId>>(new Set());

  const toggleExpand = useCallback((id: ElementId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  const allById = useMemo(() => {
    if (!model) return new Map<ElementId, SysmlElement>();
    const m = new Map<ElementId, SysmlElement>();
    for (const el of model.elements) m.set(el.id, el);
    return m;
  }, [model]);

  const tree = useMemo(() => {
    if (!model) return [];
    const filteredSet = new Set(filteredElements.map((e) => e.id));
    return buildTree(model.elements, filteredSet, allById);
  }, [model, filteredElements, allById]);

  const visibleRows = useMemo(
    () => flattenVisible(tree, collapsed),
    [tree, collapsed],
  );

  return (
    <>
      <FilterPanel />
      <div style={{ flex: 1, overflow: "auto" }}>
        {visibleRows.length === 0 ? (
          <div style={{
            padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13,
          }}>
            {model ? "No elements match filters" : "Load a .sysml file to begin"}
          </div>
        ) : (
          visibleRows.map((row) => (
            <ElementRow
              key={row.element.id}
              element={row.element}
              depth={row.depth}
              hasChildren={row.hasChildren}
              expanded={row.expanded}
              onToggle={toggleExpand}
              selected={selectedId === row.element.id}
              onSelect={(e) => selectElement(e.id)}
              onAdd={(e) => openDialog("create", undefined, { suggestedParentId: e.id, suggestedKind: typeof e.kind === "string" ? e.kind : undefined })}
              onEdit={(e) => openDialog("edit", e.id)}
              onDelete={(e) => openDialog("delete", e.id)}
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
