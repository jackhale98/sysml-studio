import React from "react";
import { useUIStore, type TabId } from "../../stores/ui-store";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  {
    id: "browser",
    label: "Browse",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: "diagram",
    label: "Diagram",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM9 16a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
        <path strokeLinecap="round" d="M7 10v3a1 1 0 001 1h1m8-4v3a1 1 0 01-1 1h-1" />
      </svg>
    ),
  },
  {
    id: "editor",
    label: "Editor",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    id: "mbse",
    label: "MBSE",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
];

export function TabBar() {
  const activeTab = useUIStore((s) => s.activeTab);
  const setTab = useUIStore((s) => s.setTab);

  return (
    <div style={{
      display: "flex", borderTop: "1px solid var(--border)",
      background: "var(--bg-secondary)",
      paddingBottom: "env(safe-area-inset-bottom, 8px)",
      position: "relative", zIndex: 30,
    }}>
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            gap: 3, padding: "10px 0 6px", border: "none", background: "transparent",
            cursor: "pointer", color: activeTab === t.id ? "var(--accent-hover)" : "var(--text-muted)",
            transition: "color 0.15s", minHeight: 44,
          }}
        >
          <div style={{
            transition: "transform 0.15s",
            transform: activeTab === t.id ? "scale(1.15)" : "scale(1)",
          }}>
            {t.icon}
          </div>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: "0.03em",
            fontFamily: "var(--font-mono)",
          }}>
            {t.label}
          </span>
          {activeTab === t.id && (
            <div style={{
              position: "absolute", top: 0, width: 32, height: 2,
              background: "var(--accent)", borderRadius: "0 0 2px 2px",
            }} />
          )}
        </button>
      ))}
    </div>
  );
}
