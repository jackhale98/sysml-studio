import React from "react";
import { useUIStore } from "../../stores/ui-store";
import { useModelStore } from "../../stores/model-store";
import { deleteElement } from "../../lib/source-editor";
import { getKindLabel } from "../../lib/constants";
import { TypeBadge } from "../shared/TypeBadge";

export function DeleteConfirmDialog() {
  const closeDialog = useUIStore((s) => s.closeDialog);
  const editTargetId = useUIStore((s) => s.editTargetId);
  const selectElement = useUIStore((s) => s.selectElement);
  const source = useModelStore((s) => s.source);
  const model = useModelStore((s) => s.model);
  const updateSource = useModelStore((s) => s.updateSource);

  const element = model?.elements.find((e) => e.id === editTargetId);
  if (!element) return null;

  const kindStr = typeof element.kind === "string" ? element.kind : "other";
  const childCount = element.children_ids.length;

  // Count all descendants recursively
  function countDescendants(id: number): number {
    const el = model?.elements.find((e) => e.id === id);
    if (!el) return 0;
    return el.children_ids.reduce((sum, cid) => sum + 1 + countDescendants(cid), 0);
  }
  const totalDescendants = countDescendants(element.id);

  // Show source that will be removed
  const sourceLines = source.split("\n");
  const contextStart = Math.max(0, element.span.start_line);
  const contextEnd = Math.min(sourceLines.length, element.span.end_line + 1);
  const contextSnippet = sourceLines.slice(contextStart, contextEnd).join("\n");

  function handleDelete() {
    if (!element) return;
    const newSource = deleteElement(source, element);
    selectElement(null);
    updateSource(newSource);
    closeDialog();
  }

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,0.6)", display: "flex",
      flexDirection: "column", justifyContent: "flex-end",
    }} onClick={(e) => { if (e.target === e.currentTarget) closeDialog(); }}>
      <div style={{
        background: "var(--bg-secondary)", borderRadius: "16px 16px 0 0",
        maxHeight: "70%", overflow: "auto", padding: "20px 16px",
        borderTop: "2px solid var(--error)",
        animation: "slideUp 0.2s ease-out",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 12,
        }}>
          <span style={{
            fontSize: 16, fontWeight: 700, color: "var(--error)",
            fontFamily: "var(--font-mono)",
          }}>
            Delete Element
          </span>
          <button onClick={closeDialog} style={{
            background: "var(--bg-elevated)", border: "none", borderRadius: 8,
            color: "var(--text-secondary)", padding: "6px 12px", fontSize: 12,
            cursor: "pointer", fontWeight: 600, minHeight: 32,
          }}>
            Cancel
          </button>
        </div>

        {/* Element info */}
        <div style={{
          padding: "12px 14px", background: "var(--bg-tertiary)", borderRadius: 8,
          marginBottom: 14, border: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <TypeBadge kind={kindStr} />
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700,
              color: "var(--text-primary)",
            }}>
              {element.name ?? "<anonymous>"}
            </span>
          </div>
          <div style={{
            fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
          }}>
            {getKindLabel(kindStr)} — Line {element.span.start_line + 1}
          </div>
        </div>

        {/* Warning for elements with children */}
        {totalDescendants > 0 && (
          <div style={{
            padding: "10px 12px", background: "rgba(239,68,68,0.1)",
            borderRadius: 8, marginBottom: 14,
            border: "1px solid rgba(239,68,68,0.3)",
            fontSize: 12, color: "#fca5a5", fontFamily: "var(--font-mono)",
          }}>
            This element has {totalDescendants} nested element{totalDescendants > 1 ? "s" : ""} ({childCount} direct child{childCount !== 1 ? "ren" : ""}).
            All will be removed.
          </div>
        )}

        {/* Source preview */}
        <pre style={{
          background: "var(--bg-primary)", borderRadius: 8, padding: 10,
          fontSize: 11, fontFamily: "var(--font-mono)", color: "#fca5a5",
          border: "1px solid rgba(239,68,68,0.2)", overflow: "auto",
          whiteSpace: "pre-wrap", marginBottom: 16, maxHeight: 120,
          textDecoration: "line-through", opacity: 0.7,
        }}>
          {contextSnippet}
        </pre>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={closeDialog}
            style={{
              flex: 1, padding: 14, borderRadius: 10,
              border: "1.5px solid var(--border)",
              background: "var(--bg-tertiary)", color: "var(--text-secondary)",
              fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono)",
              cursor: "pointer", minHeight: 48,
            }}
          >
            Keep
          </button>
          <button
            onClick={handleDelete}
            style={{
              flex: 1, padding: 14, borderRadius: 10, border: "none",
              background: "var(--error)", color: "#fff",
              fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)",
              cursor: "pointer", minHeight: 48,
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
