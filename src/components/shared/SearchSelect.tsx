import React, { useState, useRef, useEffect, useMemo } from "react";

export interface SearchSelectItem {
  id: string;
  label: string;
  sublabel?: string;
  badge?: string;
  badgeColor?: string;
  group?: string;
}

interface SearchSelectProps {
  items: SearchSelectItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
  allowCustom?: boolean;
  renderItem?: (item: SearchSelectItem) => React.ReactNode;
}

export function SearchSelect({
  items,
  value,
  onChange,
  placeholder = "Search...",
  title = "Select",
  allowCustom = false,
  renderItem,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const lower = search.toLowerCase();
    return items.filter(
      (t) =>
        t.label.toLowerCase().includes(lower) ||
        (t.sublabel?.toLowerCase().includes(lower)) ||
        (t.badge?.toLowerCase().includes(lower)) ||
        (t.group?.toLowerCase().includes(lower))
    );
  }, [search, items]);

  // Group items
  const grouped = useMemo(() => {
    const groups = new Map<string, SearchSelectItem[]>();
    for (const item of filtered) {
      const g = item.group ?? "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(item);
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    if (open) {
      setSearch("");
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  const selectedItem = items.find((i) => i.id === value);

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1.5px solid var(--border)",
          background: "var(--bg-primary)",
          color: value ? "var(--text-primary)" : "var(--text-muted)",
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          textAlign: "left",
          cursor: "pointer",
          minHeight: 44,
          boxSizing: "border-box" as const,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {selectedItem ? selectedItem.label : value || placeholder}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          {value && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              style={{
                fontSize: 14,
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "0 4px",
                lineHeight: 1,
              }}
            >
              x
            </span>
          )}
          {selectedItem?.badge && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: selectedItem.badgeColor ?? "var(--text-muted)",
                background:
                  (selectedItem.badgeColor ?? "var(--text-muted)") + "18",
                padding: "2px 6px",
                borderRadius: 4,
                textTransform: "uppercase",
              }}
            >
              {selectedItem.badge}
            </span>
          )}
          <svg
            width="12"
            height="12"
            fill="none"
            viewBox="0 0 24 24"
            stroke="var(--text-muted)"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </span>
      </button>

      {/* Popup overlay */}
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--bg-secondary)",
              borderRadius: "16px 16px 0 0",
              maxHeight: "70%",
              display: "flex",
              flexDirection: "column",
              borderTop: "2px solid var(--accent)",
              animation: "slideUp 0.2s ease-out",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "14px 16px 10px",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {title}
                </span>
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    background: "var(--bg-elevated)",
                    border: "none",
                    borderRadius: 8,
                    color: "var(--text-secondary)",
                    padding: "5px 10px",
                    fontSize: 11,
                    cursor: "pointer",
                    fontWeight: 600,
                    minHeight: 28,
                  }}
                >
                  Close
                </button>
              </div>

              {/* Search input */}
              <div style={{ position: "relative" }}>
                <svg
                  width="14"
                  height="14"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="var(--text-muted)"
                  strokeWidth="2"
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                  }}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  ref={searchRef}
                  style={{
                    width: "100%",
                    padding: "10px 12px 10px 32px",
                    borderRadius: 8,
                    border: "1.5px solid var(--border)",
                    background: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    fontFamily: "var(--font-mono)",
                    outline: "none",
                    minHeight: 40,
                    boxSizing: "border-box",
                  }}
                  placeholder={placeholder}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  marginTop: 6,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              </div>
            </div>

            {/* Items list */}
            <div
              style={{
                overflow: "auto",
                flex: 1,
                padding: "4px 0",
              }}
            >
              {allowCustom && search.trim() && !items.some((i) => i.label === search.trim()) && (
                <button
                  onClick={() => {
                    onChange(search.trim());
                    setOpen(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 16px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    borderBottom: "1px solid var(--border)",
                    minHeight: 40,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "var(--accent)",
                      background: "rgba(59,130,246,0.12)",
                      padding: "2px 6px",
                      borderRadius: 4,
                      fontFamily: "var(--font-mono)",
                      textTransform: "uppercase",
                    }}
                  >
                    custom
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-primary)",
                      fontWeight: 500,
                    }}
                  >
                    {search.trim()}
                  </span>
                </button>
              )}

              {Array.from(grouped.entries()).map(([group, groupItems]) => (
                <React.Fragment key={group}>
                  {group && (
                    <div
                      style={{
                        padding: "8px 16px 4px",
                        fontSize: 9,
                        fontWeight: 700,
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        position: "sticky",
                        top: 0,
                        background: "var(--bg-secondary)",
                      }}
                    >
                      {group}
                    </div>
                  )}
                  {groupItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        onChange(item.id);
                        setOpen(false);
                      }}
                      style={{
                        width: "100%",
                        padding: "9px 16px",
                        border: "none",
                        background:
                          item.id === value
                            ? "rgba(59,130,246,0.1)"
                            : "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        borderBottom: "1px solid var(--border)",
                        minHeight: 40,
                      }}
                    >
                      {renderItem ? (
                        renderItem(item)
                      ) : (
                        <>
                          {item.badge && (
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                letterSpacing: "0.05em",
                                color: item.badgeColor ?? "var(--text-muted)",
                                background:
                                  (item.badgeColor ?? "var(--text-muted)") +
                                  "18",
                                padding: "2px 6px",
                                borderRadius: 4,
                                textTransform: "uppercase",
                                fontFamily: "var(--font-mono)",
                                flexShrink: 0,
                              }}
                            >
                              {item.badge}
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: 12,
                              fontFamily: "var(--font-mono)",
                              color:
                                item.id === value
                                  ? "var(--accent)"
                                  : "var(--text-primary)",
                              fontWeight: item.id === value ? 600 : 500,
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.label}
                          </span>
                          {item.sublabel && (
                            <span
                              style={{
                                fontSize: 10,
                                color: "var(--text-muted)",
                                fontFamily: "var(--font-mono)",
                                flexShrink: 0,
                              }}
                            >
                              {item.sublabel}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  ))}
                </React.Fragment>
              ))}

              {filtered.length === 0 && (
                <div
                  style={{
                    padding: "20px 16px",
                    textAlign: "center",
                    color: "var(--text-muted)",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  No matches found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
