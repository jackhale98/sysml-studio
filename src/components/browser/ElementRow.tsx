import React from "react";
import type { SysmlElement } from "../../lib/element-types";
import { TypeBadge } from "../shared/TypeBadge";

interface ElementRowProps {
  element: SysmlElement;
  parentName?: string;
  selected: boolean;
  onSelect: (el: SysmlElement) => void;
}

export function ElementRow({ element, parentName, selected, onSelect }: ElementRowProps) {
  const kindStr = typeof element.kind === "string" ? element.kind : "other";

  return (
    <button
      onClick={() => onSelect(element)}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "10px 14px", background: selected ? "var(--bg-elevated)" : "transparent",
        border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer",
        textAlign: "left", transition: "background 0.15s",
        borderLeft: selected ? "3px solid var(--accent)" : "3px solid transparent",
        minHeight: 44,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: "var(--text-primary)", fontFamily: "var(--font-mono)",
          fontSize: 13, fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {element.name ?? "<anonymous>"}
          {element.type_ref && (
            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
              {" : "}{element.type_ref}
            </span>
          )}
        </div>
        {parentName && (
          <div style={{
            color: "var(--text-muted)", fontSize: 11, marginTop: 2,
            fontFamily: "var(--font-mono)",
          }}>
            ← {parentName}
          </div>
        )}
      </div>
      <TypeBadge kind={kindStr} />
    </button>
  );
}
