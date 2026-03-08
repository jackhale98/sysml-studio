import React, { useState, useMemo } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useModelStore } from "../../stores/model-store";
import {
  CREATE_OPTIONS,
  generateElementSource,
  insertElement,
  getInsertTargets,
} from "../../lib/source-editor";
import { TypeBadge } from "../shared/TypeBadge";
import { SearchSelect } from "../shared/SearchSelect";
import type { SearchSelectItem } from "../shared/SearchSelect";
import { SYSML_STDLIB_TYPES, TYPE_COLORS } from "../../lib/constants";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8,
  border: "1.5px solid var(--border)", background: "var(--bg-primary)",
  color: "var(--text-primary)", fontSize: 13, fontFamily: "var(--font-mono)",
  outline: "none", minHeight: 44, boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
  fontFamily: "var(--font-mono)", marginBottom: 4, display: "block",
  letterSpacing: "0.05em",
};

const smallBtnStyle: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--bg-tertiary)", color: "var(--text-secondary)",
  fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer",
  fontWeight: 600, minHeight: 30,
};

interface ChildEntry {
  type: "attribute" | "port" | "part" | "connection" | "custom";
  name: string;
  typeRef: string;
  raw?: string; // for custom lines
}

function kindBadgeColor(kind: string): string {
  return TYPE_COLORS[kind]?.fg ?? "var(--text-muted)";
}

export function CreateElementDialog() {
  const closeDialog = useUIStore((s) => s.closeDialog);
  const source = useModelStore((s) => s.source);
  const model = useModelStore((s) => s.model);
  const updateSource = useModelStore((s) => s.updateSource);

  const [selectedCategory, setSelectedCategory] = useState(0);
  const [selectedKind, setSelectedKind] = useState("");
  const [name, setName] = useState("");
  const [typeRef, setTypeRef] = useState("");
  const [doc, setDoc] = useState("");
  const [parentId, setParentId] = useState<string>("root");

  // Child entries (attributes, ports, parts, connections)
  const [children, setChildren] = useState<ChildEntry[]>([]);
  const [addingChild, setAddingChild] = useState<ChildEntry["type"] | null>(null);
  const [childName, setChildName] = useState("");
  const [childTypeRef, setChildTypeRef] = useState("");
  const [childCustom, setChildCustom] = useState("");

  const category = CREATE_OPTIONS[selectedCategory];
  const kindItem = category?.items.find((i) => i.kind === selectedKind);
  const needsType = kindItem && "needsType" in kindItem && kindItem.needsType;
  const isDef = selectedKind.endsWith("_def") || selectedKind === "package";

  const targets = useMemo(() => model ? getInsertTargets(model) : [], [model]);

  // Build SearchSelect items for "Insert Into"
  const parentItems: SearchSelectItem[] = useMemo(() => {
    const items: SearchSelectItem[] = [{
      id: "root", label: "Top level (root)", badge: "root", badgeColor: "var(--text-muted)",
    }];
    for (const t of targets) {
      const k = typeof t.kind === "string" ? t.kind : "other";
      items.push({
        id: String(t.id),
        label: t.name ?? "<unnamed>",
        sublabel: t.qualified_name ?? undefined,
        badge: k.replace(/_/g, " "),
        badgeColor: kindBadgeColor(k),
      });
    }
    return items;
  }, [targets]);

  // Build SearchSelect items for type reference
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

  const selectedParent = parentId !== "root"
    ? targets.find(t => t.id === Number(parentId)) ?? null
    : null;

  const canCreate = name.trim() && selectedKind;

  function addChild() {
    if (!addingChild) return;
    if (addingChild === "custom") {
      if (childCustom.trim()) {
        setChildren(prev => [...prev, { type: "custom", name: "", typeRef: "", raw: childCustom.trim() }]);
      }
    } else if (childName.trim()) {
      setChildren(prev => [...prev, {
        type: addingChild,
        name: childName.trim(),
        typeRef: childTypeRef.trim(),
      }]);
    }
    setChildName("");
    setChildTypeRef("");
    setChildCustom("");
    setAddingChild(null);
  }

  function removeChild(idx: number) {
    setChildren(prev => prev.filter((_, i) => i !== idx));
  }

  function childToSource(c: ChildEntry): string {
    if (c.raw) return c.raw;
    const keyword = c.type === "attribute" ? "attribute"
      : c.type === "port" ? "port"
      : c.type === "part" ? "part"
      : c.type === "connection" ? "connection"
      : "";
    if (c.typeRef) return `${keyword} ${c.name} : ${c.typeRef};`;
    return `${keyword} ${c.name};`;
  }

  function handleCreate() {
    if (!canCreate || !model) return;

    const childLines = children.map(childToSource);

    const src = generateElementSource({
      kind: selectedKind,
      name: name.trim(),
      typeRef: needsType && typeRef.trim() ? typeRef.trim() : undefined,
      doc: doc.trim() || undefined,
      children: childLines.length > 0 ? childLines : undefined,
    });

    const parent = selectedParent;
    const newSource = insertElement(source, src, parent, model);
    updateSource(newSource);
    closeDialog();
  }

  // Build preview
  const previewSrc = (selectedKind && name.trim()) ? generateElementSource({
    kind: selectedKind,
    name: name.trim(),
    typeRef: needsType && typeRef.trim() ? typeRef.trim() : undefined,
    doc: doc.trim() || undefined,
    children: children.length > 0 ? children.map(childToSource) : undefined,
  }) : "";

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,0.6)", display: "flex",
      flexDirection: "column", justifyContent: "flex-end",
    }} onClick={(e) => { if (e.target === e.currentTarget) closeDialog(); }}>
      <div style={{
        background: "var(--bg-secondary)", borderRadius: "16px 16px 0 0",
        maxHeight: "88%", overflow: "auto", padding: "20px 16px",
        borderTop: "2px solid var(--accent)",
        animation: "slideUp 0.2s ease-out",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 16,
        }}>
          <span style={{
            fontSize: 16, fontWeight: 700, color: "var(--text-primary)",
            fontFamily: "var(--font-mono)",
          }}>
            Create Element
          </span>
          <button onClick={closeDialog} style={{
            background: "var(--bg-elevated)", border: "none", borderRadius: 8,
            color: "var(--text-secondary)", padding: "6px 12px", fontSize: 12,
            cursor: "pointer", fontWeight: 600, minHeight: 32,
          }}>
            Cancel
          </button>
        </div>

        {/* Category chips */}
        <label style={labelStyle}>Category</label>
        <div style={{
          display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12,
        }}>
          {CREATE_OPTIONS.map((cat, i) => (
            <button
              key={cat.category}
              onClick={() => { setSelectedCategory(i); setSelectedKind(""); }}
              style={{
                padding: "5px 9px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                fontFamily: "var(--font-mono)", cursor: "pointer", border: "none",
                background: selectedCategory === i ? "var(--accent)" : "var(--bg-tertiary)",
                color: selectedCategory === i ? "#fff" : "var(--text-muted)",
                minHeight: 28,
              }}
            >
              {cat.category}
            </button>
          ))}
        </div>

        {/* Kind selector */}
        <label style={labelStyle}>Element Type</label>
        <div style={{
          display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12,
        }}>
          {category?.items.map((item) => (
            <button
              key={item.kind}
              onClick={() => setSelectedKind(item.kind)}
              style={{
                padding: "6px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                fontFamily: "var(--font-mono)", cursor: "pointer",
                border: selectedKind === item.kind ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
                background: selectedKind === item.kind ? "rgba(59,130,246,0.13)" : "var(--bg-primary)",
                color: selectedKind === item.kind ? "var(--accent-hover)" : "var(--text-secondary)",
                minHeight: 32,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Name */}
        <label style={labelStyle}>Name</label>
        <input
          style={inputStyle}
          placeholder="MyElement"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <div style={{ height: 10 }} />

        {/* Type Reference (for usages) */}
        {needsType && (
          <>
            <label style={labelStyle}>Type Reference</label>
            <SearchSelect
              items={typeItems}
              value={typeRef}
              onChange={setTypeRef}
              placeholder="Search types..."
              title="Select Type"
              allowCustom
            />
            <div style={{ height: 10 }} />
          </>
        )}

        {/* Doc */}
        <label style={labelStyle}>Documentation (optional)</label>
        <input
          style={inputStyle}
          placeholder="Description of this element"
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
        />
        <div style={{ height: 10 }} />

        {/* Insert Into — SearchSelect popup */}
        <label style={labelStyle}>Insert Into</label>
        <SearchSelect
          items={parentItems}
          value={parentId}
          onChange={setParentId}
          placeholder="Search elements..."
          title="Insert Into"
        />
        <div style={{ height: 12 }} />

        {/* Children: attributes, ports, parts, connections */}
        {isDef && (
          <>
            <label style={labelStyle}>Members (attributes, ports, parts, connections)</label>

            {/* Existing children list */}
            {children.length > 0 && (
              <div style={{
                border: "1px solid var(--border)", borderRadius: 8,
                marginBottom: 8, overflow: "hidden",
              }}>
                {children.map((c, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "6px 10px", borderBottom: i < children.length - 1 ? "1px solid var(--border)" : "none",
                    background: "var(--bg-primary)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)",
                        color: c.type === "attribute" ? "#f59e0b" : c.type === "port" ? "#8b5cf6"
                          : c.type === "part" ? "#3b82f6" : c.type === "connection" ? "#f472b6" : "var(--text-muted)",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                        background: "var(--bg-tertiary)", padding: "2px 5px", borderRadius: 3,
                      }}>
                        {c.type === "custom" ? "raw" : c.type.slice(0, 4)}
                      </span>
                      <span style={{
                        fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-primary)",
                      }}>
                        {c.raw ?? `${c.name}${c.typeRef ? ` : ${c.typeRef}` : ""}`}
                      </span>
                    </div>
                    <button
                      onClick={() => removeChild(i)}
                      style={{
                        background: "none", border: "none", color: "var(--error)",
                        fontSize: 14, cursor: "pointer", padding: "2px 6px", minHeight: 24,
                      }}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add child buttons */}
            {!addingChild && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {(["attribute", "port", "part", "connection", "custom"] as const).map(type => (
                  <button key={type} onClick={() => setAddingChild(type)} style={smallBtnStyle}>
                    + {type === "custom" ? "Custom" : type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            )}

            {/* Inline add form */}
            {addingChild && addingChild !== "custom" && (
              <div style={{
                padding: 10, background: "var(--bg-tertiary)", borderRadius: 8,
                marginBottom: 12, border: "1px solid var(--border)",
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "var(--accent)",
                  fontFamily: "var(--font-mono)", marginBottom: 8, textTransform: "uppercase",
                }}>
                  Add {addingChild}
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <input
                    style={{ ...inputStyle, flex: 1, minHeight: 38, fontSize: 12 }}
                    placeholder="name"
                    value={childName}
                    onChange={(e) => setChildName(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoFocus
                  />
                  <div style={{ flex: 1 }}>
                    <SearchSelect
                      items={typeItems}
                      value={childTypeRef}
                      onChange={setChildTypeRef}
                      placeholder="type (optional)"
                      title="Select Type"
                      allowCustom
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={addChild}
                    disabled={!childName.trim()}
                    style={{
                      ...smallBtnStyle,
                      background: childName.trim() ? "var(--accent)" : "var(--bg-elevated)",
                      color: childName.trim() ? "#fff" : "var(--text-muted)",
                      border: "none",
                    }}
                  >
                    Add
                  </button>
                  <button onClick={() => { setAddingChild(null); setChildName(""); setChildTypeRef(""); }} style={smallBtnStyle}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Custom SysML line */}
            {addingChild === "custom" && (
              <div style={{
                padding: 10, background: "var(--bg-tertiary)", borderRadius: 8,
                marginBottom: 12, border: "1px solid var(--border)",
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "var(--accent)",
                  fontFamily: "var(--font-mono)", marginBottom: 8,
                }}>
                  Custom SysML Line
                </div>
                <input
                  style={{ ...inputStyle, minHeight: 38, fontSize: 12, marginBottom: 8 }}
                  placeholder='e.g. connect engine.torqueOut to transmission.torqueIn;'
                  value={childCustom}
                  onChange={(e) => setChildCustom(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoFocus
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={addChild}
                    disabled={!childCustom.trim()}
                    style={{
                      ...smallBtnStyle,
                      background: childCustom.trim() ? "var(--accent)" : "var(--bg-elevated)",
                      color: childCustom.trim() ? "#fff" : "var(--text-muted)",
                      border: "none",
                    }}
                  >
                    Add
                  </button>
                  <button onClick={() => { setAddingChild(null); setChildCustom(""); }} style={smallBtnStyle}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Preview */}
        {previewSrc && (
          <>
            <label style={labelStyle}>Preview</label>
            <pre style={{
              background: "var(--bg-primary)", borderRadius: 8, padding: 10,
              fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent-hover)",
              border: "1px solid var(--border)", overflow: "auto",
              whiteSpace: "pre-wrap", marginBottom: 14, maxHeight: 120,
            }}>
              {previewSrc}
            </pre>
          </>
        )}

        {/* Create button */}
        <button
          onClick={handleCreate}
          disabled={!canCreate}
          style={{
            width: "100%", padding: 14, borderRadius: 10, border: "none",
            background: canCreate ? "var(--accent)" : "var(--bg-elevated)",
            color: canCreate ? "#fff" : "var(--text-muted)",
            fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)",
            cursor: canCreate ? "pointer" : "default",
            minHeight: 48, marginBottom: 8,
          }}
        >
          Create Element
        </button>
      </div>
    </div>
  );
}
