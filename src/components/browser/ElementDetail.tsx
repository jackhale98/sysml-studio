import React from "react";
import { useModelStore } from "../../stores/model-store";
import { useUIStore } from "../../stores/ui-store";
import { TypeBadge } from "../shared/TypeBadge";
import { getKindLabel, getBestDiagramType } from "../../lib/constants";

export function ElementDetail() {
  const selectedId = useUIStore((s) => s.selectedElementId);
  const setShowDetail = useUIStore((s) => s.setShowDetail);
  const navigateToDiagram = useUIStore((s) => s.navigateToDiagram);
  const navigateToEditor = useUIStore((s) => s.navigateToEditor);
  const openDialog = useUIStore((s) => s.openDialog);
  const getElement = useModelStore((s) => s.getElement);
  const model = useModelStore((s) => s.model);

  if (selectedId === null) return null;
  const element = getElement(selectedId);
  if (!element) return null;

  const kindStr = typeof element.kind === "string" ? element.kind : "other";
  const isUsage = kindStr.endsWith("_usage") || kindStr.endsWith("_statement");
  const parentName = element.parent_id !== null
    ? model?.elements.find((e) => e.id === element.parent_id)?.name ?? "—"
    : "—";

  // For diagram navigation: resolve to the nearest element that would appear
  // as a diagram node. Definitions are shown directly; usages/attributes/ports
  // resolve up to their parent definition.
  const diagramLabel = (() => {
    const bestDiagram = getBestDiagramType(kindStr);
    // Definitions and named behavioral elements are shown directly
    if (kindStr.endsWith("_def") || kindStr === "package") return element.name;
    // For BDD: usages with type_ref point to their definition
    if (bestDiagram === "bdd" && element.type_ref) return element.type_ref;
    // Walk up parent chain to find nearest definition that shows on diagram
    if (element.parent_id !== null && model) {
      let current = model.elements.find(e => e.id === element.parent_id);
      while (current) {
        const ck = typeof current.kind === "string" ? current.kind : "";
        if (ck.endsWith("_def") && current.name) return current.name;
        current = current.parent_id !== null
          ? model.elements.find(e => e.id === current!.parent_id)
          : undefined;
      }
    }
    return element.name;
  })();

  const details = [
    { label: "Parent", value: parentName },
    { label: "Category", value: element.category },
    { label: "Kind", value: getKindLabel(kindStr) },
    ...(element.type_ref ? [{ label: "Type", value: element.type_ref }] : []),
    ...(element.multiplicity ? [{ label: "Multiplicity", value: element.multiplicity }] : []),
    ...(element.modifiers.length > 0 ? [{ label: "Modifiers", value: element.modifiers.join(", ") }] : []),
    ...(element.specializations.length > 0 ? [{ label: "Specializes", value: element.specializations.join(", ") }] : []),
    ...(element.short_name ? [{ label: "Short Name", value: element.short_name }] : []),
    { label: "Line", value: String(element.span.start_line + 1) },
  ];

  return (
    <div style={{
      position: "absolute", bottom: 64, left: 0, right: 0,
      background: "var(--bg-tertiary)", borderTop: "2px solid var(--accent)",
      borderRadius: "16px 16px 0 0", padding: 16,
      boxShadow: "0 -8px 30px rgba(0,0,0,0.5)",
      zIndex: 20, maxHeight: "45%", overflow: "auto",
      animation: "slideUp 0.25s ease-out",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
        <div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 700, color: "var(--text-primary)",
          }}>
            {element.name ?? "<anonymous>"}
          </div>
          <div style={{ marginTop: 6 }}><TypeBadge kind={kindStr} /></div>
        </div>
        <button
          onClick={() => setShowDetail(false)}
          style={{
            background: "var(--bg-elevated)", border: "none", borderRadius: 8,
            color: "var(--text-secondary)", padding: "6px 12px", fontSize: 12,
            cursor: "pointer", fontWeight: 600, minHeight: 32,
          }}
        >
          ✕
        </button>
      </div>

      {element.doc && (
        <div style={{
          padding: "8px 10px", background: "var(--bg-primary)", borderRadius: 6,
          fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic",
          marginBottom: 10, borderLeft: "3px solid var(--accent)",
        }}>
          {element.doc}
        </div>
      )}

      <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
        {details.map((row) => (
          <div key={row.label} style={{
            display: "flex", justifyContent: "space-between", padding: "6px 0",
            borderBottom: "1px solid var(--border)",
          }}>
            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{row.label}</span>
            <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{row.value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
        <button
          onClick={() => navigateToEditor(element.span.start_line)}
          style={{
            flex: 1, padding: 10, borderRadius: 8, border: "1.5px solid var(--accent)",
            background: "rgba(59,130,246,0.13)", color: "var(--accent-hover)", fontSize: 12,
            fontWeight: 600, fontFamily: "var(--font-mono)", cursor: "pointer", minHeight: 44,
          }}
        >
          Source
        </button>
        <button
          onClick={() => {
            if (!diagramLabel) return;
            const bestDiagram = getBestDiagramType(kindStr);
            // Scope diagram to this element for types that support it
            const scopable = ["part_def", "part_usage", "state_def", "action_def"];
            const scope = element.name && scopable.includes(kindStr)
              ? { elementId: element.id, elementName: element.name, elementKind: kindStr }
              : null;
            navigateToDiagram(diagramLabel, bestDiagram, scope);
          }}
          style={{
            flex: 1, padding: 10, borderRadius: 8, border: "1.5px solid #38bdf8",
            background: "rgba(56,189,248,0.1)", color: "#38bdf8", fontSize: 12,
            fontWeight: 600, fontFamily: "var(--font-mono)", cursor: "pointer", minHeight: 44,
          }}
        >
          Diagram
        </button>
        <button
          onClick={() => openDialog("edit", selectedId!)}
          style={{
            flex: 1, padding: 10, borderRadius: 8, border: "1.5px solid #f59e0b",
            background: "rgba(245,158,11,0.1)", color: "#fbbf24", fontSize: 12,
            fontWeight: 600, fontFamily: "var(--font-mono)", cursor: "pointer", minHeight: 44,
          }}
        >
          Edit
        </button>
        <button
          onClick={() => openDialog("delete", selectedId!)}
          style={{
            flex: 1, padding: 10, borderRadius: 8, border: "1.5px solid var(--error)",
            background: "rgba(239,68,68,0.1)", color: "#f87171", fontSize: 12,
            fontWeight: 600, fontFamily: "var(--font-mono)", cursor: "pointer", minHeight: 44,
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
