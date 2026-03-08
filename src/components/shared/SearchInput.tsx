import React from "react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = "Search elements…" }: SearchInputProps) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: "var(--bg-tertiary)", borderRadius: 8,
      padding: "8px 12px", border: "1px solid var(--border)",
    }}>
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="var(--text-muted)" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1, background: "transparent", border: "none", outline: "none",
          color: "var(--text-primary)", fontSize: 13, fontFamily: "var(--font-mono)",
        }}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          style={{
            background: "none", border: "none", color: "var(--text-muted)",
            padding: 0, minHeight: "auto", fontSize: 14, cursor: "pointer",
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
