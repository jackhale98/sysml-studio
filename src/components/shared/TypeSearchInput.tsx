import React, { useState, useRef, useEffect, useMemo } from "react";

interface TypeSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  allTypes: { name: string; source: "model" | "stdlib" }[];
  placeholder?: string;
  inputStyle?: React.CSSProperties;
}

export function TypeSearchInput({
  value,
  onChange,
  allTypes,
  placeholder = "Type (optional)",
  inputStyle: customInputStyle,
}: TypeSearchInputProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!value.trim()) return allTypes.slice(0, 30);
    const lower = value.toLowerCase();
    return allTypes
      .filter((t) => t.name.toLowerCase().includes(lower))
      .slice(0, 30);
  }, [value, allTypes]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const baseInputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", borderRadius: 8,
    border: "1.5px solid var(--border)", background: "var(--bg-primary)",
    color: "var(--text-primary)", fontSize: 13, fontFamily: "var(--font-mono)",
    outline: "none", minHeight: 44, boxSizing: "border-box" as const,
    ...customInputStyle,
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        style={baseInputStyle}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoCapitalize="none"
        autoCorrect="off"
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 60,
          background: "var(--bg-elevated)", border: "1.5px solid var(--border)",
          borderTop: "none", borderRadius: "0 0 8px 8px",
          maxHeight: 180, overflow: "auto",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {filtered.map((t) => (
            <button
              key={t.name + t.source}
              onClick={() => { onChange(t.name); setOpen(false); }}
              style={{
                width: "100%", display: "flex", alignItems: "center",
                justifyContent: "space-between", gap: 8,
                padding: "8px 12px", border: "none", background: "transparent",
                cursor: "pointer", fontSize: 12, fontFamily: "var(--font-mono)",
                color: "var(--text-primary)", minHeight: 34,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ fontWeight: 500 }}>{t.name}</span>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
                color: t.source === "model" ? "#60a5fa" : "#94a3b8",
                background: t.source === "model" ? "rgba(96,165,250,0.12)" : "rgba(148,163,184,0.12)",
                padding: "2px 6px", borderRadius: 4, textTransform: "uppercase",
              }}>
                {t.source === "model" ? "model" : "stdlib"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
