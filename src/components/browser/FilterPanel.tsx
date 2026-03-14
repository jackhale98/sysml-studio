import React, { useState, useRef, useEffect, useMemo } from "react";
import { CATEGORY_META, getKindLabel } from "../../lib/constants";
import { useFilterStore } from "../../stores/filter-store";
import { useModelStore } from "../../stores/model-store";
import { SearchInput } from "../shared/SearchInput";
import type { Category } from "../../lib/element-types";

export function FilterPanel() {
  const { activeCategories, searchTerm, selectedKinds, toggleCategory, setSearchTerm, setAllCategories, toggleKind, clearKindFilter } = useFilterStore();
  const model = useModelStore((s) => s.model);
  const [open, setOpen] = useState(false);
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

      {/* Kind sub-filter dropdown */}
      {availableKinds.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <select
            value=""
            onChange={(e) => { if (e.target.value) toggleKind(e.target.value); e.target.value = ""; }}
            style={{
              flex: 1, padding: "6px 10px", borderRadius: 6,
              border: `1.5px solid ${selectedKinds.length > 0 ? "var(--accent)" : "var(--border)"}`,
              background: "var(--bg-primary)", color: "var(--text-primary)",
              fontSize: 11, fontFamily: "var(--font-mono)", minHeight: 34,
            }}
          >
            <option value="">
              {selectedKinds.length > 0 ? `Kinds (${selectedKinds.length} selected)` : "Filter by kind..."}
            </option>
            {availableKinds.map(([kind, count]) => {
              const active = selectedKinds.includes(kind);
              return (
                <option key={kind} value={kind}>
                  {active ? "\u2713 " : ""}{getKindLabel(kind)} ({count})
                </option>
              );
            })}
          </select>
          {selectedKinds.length > 0 && (
            <button
              onClick={clearKindFilter}
              style={{
                background: "none", border: "1px solid var(--border)", borderRadius: 6,
                cursor: "pointer", fontSize: 10, fontFamily: "var(--font-mono)",
                color: "var(--accent)", padding: "6px 10px", minHeight: 34,
                whiteSpace: "nowrap",
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
