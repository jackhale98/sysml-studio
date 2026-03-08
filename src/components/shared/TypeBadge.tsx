import React from "react";
import { getTypeColor, getKindLabel } from "../../lib/constants";

interface TypeBadgeProps {
  kind: string;
}

export function TypeBadge({ kind }: TypeBadgeProps) {
  const c = getTypeColor(kind);
  return (
    <span style={{
      display: "inline-block", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em",
      padding: "2px 8px", borderRadius: 4, background: c.bg, color: c.fg,
      border: `1px solid ${c.border}`, textTransform: "uppercase",
      fontFamily: "var(--font-mono)", whiteSpace: "nowrap",
    }}>
      {getKindLabel(kind)}
    </span>
  );
}
