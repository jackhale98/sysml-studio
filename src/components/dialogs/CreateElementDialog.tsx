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

type ChildType = "attribute" | "port" | "part" | "connection" | "enum_value" | "custom";

interface ChildEntry {
  type: ChildType;
  name: string;
  typeRef: string;
  raw?: string;
}

function kindBadgeColor(kind: string): string {
  return TYPE_COLORS[kind]?.fg ?? "var(--text-muted)";
}

const CHILD_COLORS: Record<string, string> = {
  attribute: "#f59e0b",
  port: "#8b5cf6",
  part: "#3b82f6",
  connection: "#f472b6",
  enum_value: "#10b981",
  custom: "var(--text-muted)",
};

export function CreateElementDialog() {
  const closeDialog = useUIStore((s) => s.closeDialog);
  const createContext = useUIStore((s) => s.createContext);
  const source = useModelStore((s) => s.source);
  const model = useModelStore((s) => s.model);
  const updateSource = useModelStore((s) => s.updateSource);

  const [selectedCategory, setSelectedCategory] = useState(createContext?.suggestedCategory ?? 0);
  const [selectedKind, setSelectedKind] = useState(createContext?.suggestedKind ?? "");
  const [name, setName] = useState("");
  const [typeRef, setTypeRef] = useState("");
  const [doc, setDoc] = useState("");
  const [parentId, setParentId] = useState<string>(
    createContext?.suggestedParentId != null ? String(createContext.suggestedParentId) : "root"
  );

  // Specialized fields
  const [specializes, setSpecializes] = useState("");
  const [multiplicity, setMultiplicity] = useState("");
  const [connSource, setConnSource] = useState("");
  const [connTarget, setConnTarget] = useState("");
  const [flowItemType, setFlowItemType] = useState("");
  const [flowSource, setFlowSource] = useState("");
  const [flowTarget, setFlowTarget] = useState("");
  const [shortName, setShortName] = useState("");

  // Child entries
  const [children, setChildren] = useState<ChildEntry[]>([]);
  const [addingChild, setAddingChild] = useState<ChildType | null>(null);
  const [childName, setChildName] = useState("");
  const [childTypeRef, setChildTypeRef] = useState("");
  const [childCustom, setChildCustom] = useState("");

  const category = CREATE_OPTIONS[selectedCategory];
  const kindItem = category?.items.find((i) => i.kind === selectedKind);
  const needsType = kindItem && "needsType" in kindItem && kindItem.needsType;
  const isDef = selectedKind.endsWith("_def") || selectedKind === "package";
  const isEnum = selectedKind === "enumeration_def";
  const isConnectStatement = selectedKind === "connect_statement";
  const isSatisfyOrVerify = selectedKind === "satisfy_statement" || selectedKind === "verify_statement";
  const isTransition = selectedKind === "transition_statement";
  const isFlowUsage = selectedKind === "flow_usage";
  const isUsageKind = selectedKind.endsWith("_usage") && !isFlowUsage;

  const targets = useMemo(() => model ? getInsertTargets(model) : [], [model]);

  // Reset specialized fields when kind changes
  const [lastKind, setLastKind] = useState(selectedKind);
  if (selectedKind !== lastKind) {
    setLastKind(selectedKind);
    setSpecializes("");
    setMultiplicity("");
    setConnSource("");
    setConnTarget("");
    setFlowItemType("");
    setFlowSource("");
    setFlowTarget("");
    setShortName("");
    setName("");
    setTypeRef("");
  }

  // ─── Item lists ───

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

  // Type reference items (definitions only per SysML v2 spec)
  const typeItems: SearchSelectItem[] = useMemo(() => {
    const modelDefs = model
      ? model.elements
          .filter(e => {
            const k = typeof e.kind === "string" ? e.kind : "";
            return k.endsWith("_def") && e.name;
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

  // Specialization items: definitions of the same "family" as the selected kind
  const specializationItems: SearchSelectItem[] = useMemo(() => {
    if (!model || !isDef) return [];
    // Match same base kind (e.g., part_def elements for part_def)
    return model.elements
      .filter(e => {
        const k = typeof e.kind === "string" ? e.kind : "";
        return k === selectedKind && e.name;
      })
      .map(e => ({
        id: e.name!,
        label: e.name!,
        badge: (typeof e.kind === "string" ? e.kind : "").replace(/_/g, " "),
        badgeColor: kindBadgeColor(typeof e.kind === "string" ? e.kind : ""),
        group: "Model",
      }));
  }, [model, selectedKind, isDef]);

  // Requirement items for satisfy/verify
  const requirementItems: SearchSelectItem[] = useMemo(() => {
    if (!model) return [];
    return model.elements
      .filter(e => {
        const k = typeof e.kind === "string" ? e.kind : "";
        return (k === "requirement_def" || k === "requirement_usage") && e.name;
      })
      .map(e => {
        const k = typeof e.kind === "string" ? e.kind : "other";
        return {
          id: e.name!,
          label: e.name!,
          sublabel: e.doc ?? undefined,
          badge: k.replace(/_/g, " "),
          badgeColor: kindBadgeColor(k),
        };
      });
  }, [model]);

  // State items for transitions
  const stateItems: SearchSelectItem[] = useMemo(() => {
    if (!model) return [];
    const contextParentId = selectedParentId();
    return model.elements
      .filter(e => {
        const k = typeof e.kind === "string" ? e.kind : "";
        return (k === "state_usage" || k === "state_def") && e.name
          && (contextParentId === null || e.parent_id === contextParentId);
      })
      .map(e => ({
        id: e.name!,
        label: e.name!,
        badge: (typeof e.kind === "string" ? e.kind : "").replace(/_/g, " "),
        badgeColor: kindBadgeColor(typeof e.kind === "string" ? e.kind : ""),
      }));
  }, [model, parentId]);

  // Endpoint items for connections and flows
  const endpointItems: SearchSelectItem[] = useMemo(() => {
    if (!model) return [];
    const items: SearchSelectItem[] = [];
    const contextParentId = selectedParentId();

    const siblingParts = model.elements.filter(e => {
      if (e.parent_id !== contextParentId) return false;
      const k = typeof e.kind === "string" ? e.kind : "";
      return k === "part_usage" || k === "item_usage" || k === "port_usage";
    });

    for (const part of siblingParts) {
      if (!part.name) continue;
      items.push({
        id: part.name,
        label: part.name,
        badge: typeof part.kind === "string" ? part.kind.replace(/_/g, " ") : "part",
        badgeColor: kindBadgeColor(typeof part.kind === "string" ? part.kind : "part_usage"),
        group: "Parts",
      });

      const typeDef = part.type_ref
        ? model.elements.find(e => e.name === part.type_ref && typeof e.kind === "string" && e.kind.endsWith("_def"))
        : null;

      const portSources = typeDef ? [typeDef, part] : [part];
      for (const src of portSources) {
        const ports = model.elements.filter(e =>
          e.parent_id === src.id &&
          typeof e.kind === "string" &&
          (e.kind === "port_usage" || e.kind === "port_def") &&
          e.name
        );
        for (const port of ports) {
          const endpoint = `${part.name}.${port.name}`;
          if (!items.some(i => i.id === endpoint)) {
            items.push({
              id: endpoint,
              label: endpoint,
              sublabel: port.type_ref ? `: ${port.type_ref}` : undefined,
              badge: "port",
              badgeColor: kindBadgeColor("port_usage"),
              group: `${part.name} ports`,
            });
          }
        }
      }
    }

    return items;
  }, [model, parentId]);

  function selectedParentId(): number | null {
    if (parentId === "root") return null;
    return Number(parentId);
  }

  const selectedParent = parentId !== "root"
    ? targets.find(t => t.id === Number(parentId)) ?? null
    : null;

  // ─── Validation ───

  const canCreate = (() => {
    if (!selectedKind) return false;
    if (isConnectStatement) return !!(connSource.trim() && connTarget.trim());
    if (isTransition) return !!(name.trim() && typeRef.trim());
    if (isFlowUsage) return !!name.trim();
    return !!name.trim();
  })();

  // ─── Child management ───

  const childButtonTypes: ChildType[] = useMemo(() => {
    if (isEnum) return ["enum_value", "custom"];
    return ["attribute", "port", "part", "connection", "custom"];
  }, [isEnum]);

  function addChild() {
    if (!addingChild) return;
    if (addingChild === "custom") {
      if (childCustom.trim()) {
        setChildren(prev => [...prev, { type: "custom", name: "", typeRef: "", raw: childCustom.trim() }]);
      }
    } else if (addingChild === "connection") {
      if (connSource.trim() && connTarget.trim()) {
        setChildren(prev => [...prev, {
          type: "connection",
          name: connSource.trim(),
          typeRef: connTarget.trim(),
          raw: `connect ${connSource.trim()} to ${connTarget.trim()};`,
        }]);
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
    setConnSource("");
    setConnTarget("");
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
      : c.type === "enum_value" ? "enum"
      : "";
    if (c.typeRef) return `${keyword} ${c.name} : ${c.typeRef};`;
    return `${keyword} ${c.name};`;
  }

  function childLabel(type: ChildType): string {
    if (type === "enum_value") return "Enum Value";
    if (type === "custom") return "Custom";
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  // ─── Create & Preview ───

  function buildOpts() {
    const sn = shortName.trim() || undefined;
    if (isConnectStatement) {
      return {
        kind: selectedKind,
        name: connSource.trim(),
        typeRef: connTarget.trim(),
      };
    }
    if (isTransition) {
      return {
        kind: selectedKind,
        name: name.trim(),
        typeRef: typeRef.trim() || undefined,
      };
    }
    if (isFlowUsage) {
      return {
        kind: selectedKind,
        name: name.trim(),
        shortName: sn,
        flowItemType: flowItemType.trim() || undefined,
        flowSource: flowSource.trim() || undefined,
        flowTarget: flowTarget.trim() || undefined,
      };
    }
    return {
      kind: selectedKind,
      name: name.trim(),
      shortName: sn,
      typeRef: (needsType || isSatisfyOrVerify) && typeRef.trim() ? typeRef.trim() : undefined,
      specializes: isDef && specializes.trim() ? specializes.trim() : undefined,
      multiplicity: isUsageKind && multiplicity.trim() ? multiplicity.trim() : undefined,
    };
  }

  function handleCreate() {
    if (!canCreate || !model) return;

    const childLines = children.map(childToSource);
    const opts = buildOpts();

    const src = generateElementSource({
      ...opts,
      doc: doc.trim() || undefined,
      children: childLines.length > 0 ? childLines : undefined,
    });

    const newSource = insertElement(source, src, selectedParent, model);
    updateSource(newSource);
    closeDialog();
  }

  const previewOpts = canCreate ? buildOpts() : null;
  const previewSrc = previewOpts ? generateElementSource({
    ...previewOpts,
    doc: doc.trim() || undefined,
    children: children.length > 0 ? children.map(childToSource) : undefined,
  }) : "";

  // ─── Render ───

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

        {/* ─── Form fields (varies by kind) ─── */}

        {/* 1. Connect statement: source/target endpoint pickers */}
        {isConnectStatement && (
          <>
            <label style={labelStyle}>Source Endpoint (from)</label>
            <SearchSelect
              items={endpointItems}
              value={connSource}
              onChange={setConnSource}
              placeholder="Select source (e.g. engine.torqueOut)..."
              title="Source Endpoint"
              allowCustom
            />
            <div style={{ height: 10 }} />
            <label style={labelStyle}>Target Endpoint (to)</label>
            <SearchSelect
              items={endpointItems}
              value={connTarget}
              onChange={setConnTarget}
              placeholder="Select target (e.g. transmission.torqueIn)..."
              title="Target Endpoint"
              allowCustom
            />
            <div style={{ height: 10 }} />
          </>
        )}

        {/* 2. Satisfy/Verify: requirement picker */}
        {isSatisfyOrVerify && (
          <>
            <label style={labelStyle}>
              Requirement to {selectedKind === "satisfy_statement" ? "satisfy" : "verify"}
            </label>
            <SearchSelect
              items={requirementItems}
              value={name}
              onChange={setName}
              placeholder="Select a requirement..."
              title="Select Requirement"
              allowCustom
            />
            <div style={{ height: 10 }} />
          </>
        )}

        {/* 3. Transition: source and target state pickers */}
        {isTransition && (
          <>
            <label style={labelStyle}>Source State (first)</label>
            <SearchSelect
              items={stateItems}
              value={name}
              onChange={setName}
              placeholder="Select source state..."
              title="Source State"
              allowCustom
            />
            <div style={{ height: 10 }} />
            <label style={labelStyle}>Target State (then)</label>
            <SearchSelect
              items={stateItems}
              value={typeRef}
              onChange={setTypeRef}
              placeholder="Select target state..."
              title="Target State"
              allowCustom
            />
            <div style={{ height: 10 }} />
          </>
        )}

        {/* 4. Flow usage: name + short name + item type + source/target endpoints */}
        {isFlowUsage && (
          <>
            <label style={labelStyle}>Flow Name</label>
            <input
              style={inputStyle}
              placeholder="myFlow"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
            />
            <div style={{ height: 10 }} />
            <label style={labelStyle}>Short Name (optional)</label>
            <input
              style={inputStyle}
              placeholder="e.g. FL-001"
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
            />
            <div style={{ height: 10 }} />
            <label style={labelStyle}>Item Type (of)</label>
            <SearchSelect
              items={typeItems}
              value={flowItemType}
              onChange={setFlowItemType}
              placeholder="Select item type (e.g. Signal)..."
              title="Item Type"
              allowCustom
            />
            <div style={{ height: 10 }} />
            <label style={labelStyle}>Source Endpoint (from)</label>
            <SearchSelect
              items={endpointItems}
              value={flowSource}
              onChange={setFlowSource}
              placeholder="Select source endpoint..."
              title="Source Endpoint"
              allowCustom
            />
            <div style={{ height: 10 }} />
            <label style={labelStyle}>Target Endpoint (to)</label>
            <SearchSelect
              items={endpointItems}
              value={flowTarget}
              onChange={setFlowTarget}
              placeholder="Select target endpoint..."
              title="Target Endpoint"
              allowCustom
            />
            <div style={{ height: 10 }} />
          </>
        )}

        {/* 5. Default: name + optional short name + type + specialization + multiplicity */}
        {!isConnectStatement && !isSatisfyOrVerify && !isTransition && !isFlowUsage && (
          <>
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

            {/* Short Name / Alias */}
            <label style={labelStyle}>Short Name (optional, e.g. part number)</label>
            <input
              style={inputStyle}
              placeholder="e.g. V001, PN-1234"
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
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

            {/* Specialization (for definitions, not package or enum) */}
            {isDef && selectedKind !== "package" && selectedKind !== "enumeration_def" && (
              <>
                <label style={labelStyle}>Specializes (optional)</label>
                <SearchSelect
                  items={specializationItems}
                  value={specializes}
                  onChange={setSpecializes}
                  placeholder="Select supertype..."
                  title="Specializes"
                  allowCustom
                />
                <div style={{ height: 10 }} />
              </>
            )}

            {/* Multiplicity (for usages) */}
            {isUsageKind && (
              <>
                <label style={labelStyle}>Multiplicity (optional)</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. 4, 0..*, 1..5"
                  value={multiplicity}
                  onChange={(e) => setMultiplicity(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <div style={{ height: 10 }} />
              </>
            )}
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

        {/* Insert Into */}
        <label style={labelStyle}>Insert Into</label>
        <SearchSelect
          items={parentItems}
          value={parentId}
          onChange={setParentId}
          placeholder="Search elements..."
          title="Insert Into"
        />
        <div style={{ height: 12 }} />

        {/* ─── Children (for definitions) ─── */}
        {isDef && (
          <>
            <label style={labelStyle}>
              {isEnum ? "Enum Values" : "Members (attributes, ports, parts, connections)"}
            </label>

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
                        color: CHILD_COLORS[c.type] ?? "var(--text-muted)",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                        background: "var(--bg-tertiary)", padding: "2px 5px", borderRadius: 3,
                      }}>
                        {c.type === "custom" ? "raw" : c.type === "enum_value" ? "enum" : c.type.slice(0, 4)}
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
                {childButtonTypes.map(type => (
                  <button key={type} onClick={() => setAddingChild(type)} style={smallBtnStyle}>
                    + {childLabel(type)}
                  </button>
                ))}
              </div>
            )}

            {/* Inline add form — attributes, ports, parts, enum values */}
            {addingChild && addingChild !== "custom" && addingChild !== "connection" && (
              <div style={{
                padding: 10, background: "var(--bg-tertiary)", borderRadius: 8,
                marginBottom: 12, border: "1px solid var(--border)",
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: CHILD_COLORS[addingChild] ?? "var(--accent)",
                  fontFamily: "var(--font-mono)", marginBottom: 8, textTransform: "uppercase",
                }}>
                  Add {childLabel(addingChild)}
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
                  {addingChild !== "enum_value" && (
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
                  )}
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

            {/* Connection add form — source/target endpoint pickers */}
            {addingChild === "connection" && (
              <div style={{
                padding: 10, background: "var(--bg-tertiary)", borderRadius: 8,
                marginBottom: 12, border: "1px solid var(--border)",
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "#f472b6",
                  fontFamily: "var(--font-mono)", marginBottom: 8, textTransform: "uppercase",
                }}>
                  Add Connection
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ ...labelStyle, marginBottom: 4 }}>Source (from)</label>
                  <SearchSelect
                    items={endpointItems}
                    value={connSource}
                    onChange={setConnSource}
                    placeholder="Select source endpoint..."
                    title="Source Endpoint"
                    allowCustom
                  />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ ...labelStyle, marginBottom: 4 }}>Target (to)</label>
                  <SearchSelect
                    items={endpointItems}
                    value={connTarget}
                    onChange={setConnTarget}
                    placeholder="Select target endpoint..."
                    title="Target Endpoint"
                    allowCustom
                  />
                </div>
                {connSource && connTarget && (
                  <div style={{
                    fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)",
                    padding: "4px 8px", background: "var(--bg-primary)", borderRadius: 6,
                    marginBottom: 8,
                  }}>
                    connect {connSource} to {connTarget};
                  </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={addChild}
                    disabled={!connSource.trim() || !connTarget.trim()}
                    style={{
                      ...smallBtnStyle,
                      background: connSource.trim() && connTarget.trim() ? "var(--accent)" : "var(--bg-elevated)",
                      color: connSource.trim() && connTarget.trim() ? "#fff" : "var(--text-muted)",
                      border: "none",
                    }}
                  >
                    Add
                  </button>
                  <button onClick={() => { setAddingChild(null); setConnSource(""); setConnTarget(""); }} style={smallBtnStyle}>
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
