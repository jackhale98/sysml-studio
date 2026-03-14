import React, { useState, useMemo } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useModelStore } from "../../stores/model-store";
import { editElement } from "../../lib/source-editor";
import { getKindLabel, SYSML_STDLIB_TYPES, TYPE_COLORS } from "../../lib/constants";
import { TypeBadge } from "../shared/TypeBadge";
import { SearchSelect } from "../shared/SearchSelect";
import type { SearchSelectItem } from "../shared/SearchSelect";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8,
  border: "1.5px solid var(--border)", background: "var(--bg-primary)",
  color: "var(--text-primary)", fontSize: 13, fontFamily: "var(--font-mono)",
  outline: "none", minHeight: 44,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
  fontFamily: "var(--font-mono)", marginBottom: 4, display: "block",
  letterSpacing: "0.05em",
};

function kindBadgeColor(kind: string): string {
  return TYPE_COLORS[kind]?.fg ?? "var(--text-muted)";
}

export function EditElementDialog() {
  const closeDialog = useUIStore((s) => s.closeDialog);
  const editTargetId = useUIStore((s) => s.editTargetId);
  const source = useModelStore((s) => s.source);
  const model = useModelStore((s) => s.model);
  const updateSource = useModelStore((s) => s.updateSource);

  const element = model?.elements.find((e) => e.id === editTargetId);

  const [name, setName] = useState(element?.name ?? "");
  const [typeRef, setTypeRef] = useState(element?.type_ref ?? "");
  const [doc, setDoc] = useState(element?.doc ?? "");
  const [shortName, setShortName] = useState(element?.short_name ?? "");
  const [valueExpr, setValueExpr] = useState(element?.value_expr ?? "");

  const typeItems: SearchSelectItem[] = useMemo(() => {
    const modelDefs = model
      ? model.elements
          .filter(e => {
            const k = typeof e.kind === "string" ? e.kind : "";
            return (k.endsWith("_def") || k.endsWith("_usage")) && e.name;
          })
          .map(e => {
            const k = typeof e.kind === "string" ? e.kind : "other";
            return {
              id: e.name!,
              label: e.name!,
              badge: k.replace(/_/g, " "),
              badgeColor: kindBadgeColor(k),
              group: "Model",
            } satisfies SearchSelectItem;
          })
      : [];
    const modelNames = new Set(modelDefs.map(d => d.id));
    const stdlibItems: SearchSelectItem[] = SYSML_STDLIB_TYPES
      .filter(t => !modelNames.has(t))
      .map(t => ({
        id: t, label: t,
        badge: "stdlib", badgeColor: "#94a3b8",
        group: "Standard Library",
      }));
    return [...modelDefs, ...stdlibItems];
  }, [model]);

  if (!element) return null;

  const kindStr = typeof element.kind === "string" ? element.kind : "other";
  const isAttribute = typeof element.kind === "string" && element.kind === "attribute_usage";
  const hasChanged = name !== (element.name ?? "") ||
    typeRef !== (element.type_ref ?? "") ||
    doc !== (element.doc ?? "") ||
    shortName !== (element.short_name ?? "") ||
    valueExpr !== (element.value_expr ?? "");

  function handleSave() {
    if (!element) return;

    const changes: { name?: string; typeRef?: string; doc?: string; shortName?: string; valueExpr?: string } = {};
    if (name.trim() && name !== element.name) changes.name = name.trim();
    if (typeRef !== (element.type_ref ?? "")) changes.typeRef = typeRef.trim() || undefined;
    if (doc !== (element.doc ?? "")) changes.doc = doc.trim() || undefined;
    if (shortName !== (element.short_name ?? "")) changes.shortName = shortName.trim();
    if (valueExpr !== (element.value_expr ?? "")) changes.valueExpr = valueExpr.trim() || undefined;

    if (Object.keys(changes).length === 0) {
      closeDialog();
      return;
    }

    const newSource = editElement(source, element, changes);
    updateSource(newSource);
    closeDialog();
  }

  // Show source context around this element
  const sourceLines = source.split("\n");
  const contextStart = Math.max(0, element.span.start_line);
  const contextEnd = Math.min(sourceLines.length, element.span.end_line + 1);
  const contextSnippet = sourceLines.slice(contextStart, contextEnd).join("\n");

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,0.6)", display: "flex",
      flexDirection: "column", justifyContent: "flex-end",
    }} onClick={(e) => { if (e.target === e.currentTarget) closeDialog(); }}>
      <div style={{
        background: "var(--bg-secondary)", borderRadius: "16px 16px 0 0",
        maxHeight: "80%", overflow: "auto", padding: "20px 16px",
        borderTop: "2px solid #f59e0b",
        animation: "slideUp 0.2s ease-out",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 6,
        }}>
          <span style={{
            fontSize: 16, fontWeight: 700, color: "var(--text-primary)",
            fontFamily: "var(--font-mono)",
          }}>
            Edit Element
          </span>
          <button onClick={closeDialog} style={{
            background: "var(--bg-elevated)", border: "none", borderRadius: 8,
            color: "var(--text-secondary)", padding: "6px 12px", fontSize: 12,
            cursor: "pointer", fontWeight: 600, minHeight: 32,
          }}>
            Cancel
          </button>
        </div>

        {/* Kind badge */}
        <div style={{ marginBottom: 14 }}>
          <TypeBadge kind={kindStr} />
          <span style={{
            fontSize: 11, color: "var(--text-muted)", marginLeft: 8,
            fontFamily: "var(--font-mono)",
          }}>
            {getKindLabel(kindStr)} — Line {element.span.start_line + 1}
          </span>
        </div>

        {/* Source context */}
        <label style={labelStyle}>Current Source</label>
        <pre style={{
          background: "var(--bg-primary)", borderRadius: 8, padding: 10,
          fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)",
          border: "1px solid var(--border)", overflow: "auto",
          whiteSpace: "pre-wrap", marginBottom: 14, maxHeight: 100,
        }}>
          {contextSnippet}
        </pre>

        {/* Name */}
        <label style={labelStyle}>Name</label>
        <input
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <div style={{ height: 12 }} />

        {/* Short Name */}
        <label style={labelStyle}>Short Name (e.g. part number)</label>
        <input
          style={inputStyle}
          placeholder="e.g. V001, PN-1234"
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <div style={{ height: 12 }} />

        {/* Type Reference */}
        <label style={labelStyle}>Type Reference</label>
        <SearchSelect
          items={typeItems}
          value={typeRef}
          onChange={setTypeRef}
          placeholder="Search types..."
          title="Select Type"
          allowCustom
        />
        <div style={{ height: 12 }} />

        {/* Value Expression (attributes only) */}
        {isAttribute && (
          <>
            <label style={labelStyle}>Value</label>
            <input
              style={inputStyle}
              placeholder="e.g. 180, 9.81"
              value={valueExpr}
              onChange={(e) => setValueExpr(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
            />
            <div style={{ height: 12 }} />
          </>
        )}

        {/* Doc */}
        <label style={labelStyle}>Documentation</label>
        <input
          style={inputStyle}
          placeholder="(none)"
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
        />
        <div style={{ height: 16 }} />

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!hasChanged}
          style={{
            width: "100%", padding: 14, borderRadius: 10, border: "none",
            background: hasChanged ? "#f59e0b" : "var(--bg-elevated)",
            color: hasChanged ? "#000" : "var(--text-muted)",
            fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)",
            cursor: hasChanged ? "pointer" : "default",
            minHeight: 48, marginBottom: 8,
          }}
        >
          Save Changes
        </button>
      </div>
    </div>
  );
}
