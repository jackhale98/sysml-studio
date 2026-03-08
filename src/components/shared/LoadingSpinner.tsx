import React from "react";

export function LoadingSpinner() {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 40, color: "var(--text-muted)",
    }}>
      <div style={{
        width: 24, height: 24, border: "2px solid var(--border)",
        borderTop: "2px solid var(--accent)", borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
