import React, { useState, useRef, useEffect, useMemo } from "react";
import { CATEGORY_META, getKindLabel, getTypeColor } from "../../lib/constants";
import { useFilterStore } from "../../stores/filter-store";
import { useModelStore } from "../../stores/model-store";
import { SearchInput } from "../shared/SearchInput";
import type { Category } from "../../lib/element-types";

export function FilterPanel() {
  const { activeCategories, searchTerm, selectedKinds, toggleCategory, setSearchTerm, setAllCategories, toggleKind, clearKindFilter } = useFilterStore();
  const model = useModelStore((s) => s.model);
  const [open, setOpen] = useState(false);
  const [showKinds, setShowKinds] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Compute available kinds from current model, grouped by count
  const availableKinds = useMemo(() => {
    if (!model) return [];
    const counts = new Map<string, number>();
    for (const el of model.elements) {
      const k = typeof el.kind === "string" ? el.kind : "";
      if (!k || k === "comment" || k === "doc_comment" || k === "import") continue;
      if (!activeCategories.includes(el.category)) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1]);
  }, [model, activeCategories]);

  const allEntries = Object.entries(CATEGORY_META) as [Category, { label: string; color: string }][];
  const totalCount = allEntries.length;
  const activeCount = activeCategories.length;

  // Close dropdown when tapping outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div style={{
      padding: "10px 14px", background: "var(--bg-secondary)",
      borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 5,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <div style={{ flex: 1 }}>
          <SearchInput value={searchTerm} onChange={setSearchTerm} />
        </div>

        {/* Filter dropdown trigger */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setOpen(!open)}
            style={{
              height: "100%", padding: "0 12px", borderRadius: 8, fontSize: 11,
              fontWeight: 600, fontFamily: "var(--font-mono)", cursor: "pointer",
              border: `1.5px solid ${activeCount < totalCount ? "var(--accent)" : "var(--border)"}`,
              background: activeCount < totalCount ? "rgba(59,130,246,0.1)" : "var(--bg-tertiary)",
              color: activeCount < totalCount ? "var(--accent-hover)" : "var(--text-secondary)",
              display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
              minHeight: 38,
            }}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            {activeCount < totalCount ? `${activeCount}/${totalCount}` : "All"}
          </button>

          {/* Dropdown menu */}
          {open && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", right: 0,
              background: "var(--bg-elevated)", border: "1.5px solid var(--border)",
              borderRadius: 10, padding: "6px 0", minWidth: 180, zIndex: 50,
              boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
            }}>
              {/* Select All / None */}
              <div style={{
                display: "flex", gap: 8, padding: "6px 12px 8px",
                borderBottom: "1px solid var(--border)",
              }}>
                <button
                  onClick={() => setAllCategories(true)}
                  style={{
                    flex: 1, padding: "4px 0", borderRadius: 6, border: "1px solid var(--border)",
                    background: "var(--bg-tertiary)", color: "var(--text-secondary)",
                    fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)",
                    cursor: "pointer", minHeight: 26,
                  }}
                >
                  All
                </button>
                <button
                  onClick={() => setAllCategories(false)}
                  style={{
                    flex: 1, padding: "4px 0", borderRadius: 6, border: "1px solid var(--border)",
                    background: "var(--bg-tertiary)", color: "var(--text-secondary)",
                    fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)",
                    cursor: "pointer", minHeight: 26,
                  }}
                >
                  None
                </button>
              </div>

              {/* Category checkboxes */}
              {allEntries.map(([key, meta]) => {
                const active = activeCategories.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleCategory(key)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", border: "none", background: "transparent",
                      cursor: "pointer", fontSize: 12, fontFamily: "var(--font-mono)",
                      color: active ? "var(--text-primary)" : "var(--text-muted)",
                      fontWeight: active ? 600 : 400, minHeight: 36,
                    }}
                  >
                    {/* Checkbox */}
                    <span style={{
                      width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                      border: `1.5px solid ${active ? meta.color : "var(--border)"}`,
                      background: active ? meta.color + "33" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, color: meta.color, lineHeight: 1,
                    }}>
                      {active ? "\u2713" : ""}
                    </span>
                    {/* Color dot + label */}
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: meta.color, opacity: active ? 1 : 0.4,
                    }} />
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Kind sub-filter chips */}
      {availableKinds.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: showKinds ? 6 : 0,
          }}>
            <button
              onClick={() => setShowKinds(!showKinds)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)",
                color: selectedKinds.length > 0 ? "var(--accent-hover)" : "var(--text-muted)",
                padding: "2px 0", display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5"
                style={{ transform: showKinds ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Kinds{selectedKinds.length > 0 ? ` (${selectedKinds.length})` : ""}
            </button>
            {selectedKinds.length > 0 && (
              <button
                onClick={clearKindFilter}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 10, fontFamily: "var(--font-mono)",
                  color: "var(--accent)", padding: "2px 4px",
                }}
              >
                Clear
              </button>
            )}
          </div>
          {showKinds && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 4,
            }}>
              {availableKinds.map(([kind, count]) => {
                const active = selectedKinds.includes(kind);
                const colors = getTypeColor(kind);
                return (
                  <button
                    key={kind}
                    onClick={() => toggleKind(kind)}
                    style={{
                      padding: "3px 8px", borderRadius: 6, fontSize: 10,
                      fontFamily: "var(--font-mono)", fontWeight: active ? 600 : 400,
                      cursor: "pointer", whiteSpace: "nowrap",
                      border: `1px solid ${active ? colors.border : "var(--border)"}`,
                      background: active ? colors.bg : "transparent",
                      color: active ? colors.fg : "var(--text-secondary)",
                      opacity: active ? 1 : 0.8,
                      transition: "all 0.1s",
                    }}
                  >
                    {getKindLabel(kind)} <span style={{ opacity: 0.6 }}>{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
