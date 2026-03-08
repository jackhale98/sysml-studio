import React from "react";
import type { SysmlElement } from "../../lib/element-types";
import { TypeBadge } from "../shared/TypeBadge";

interface ElementRowProps {
  element: SysmlElement;
  parentName?: string;
  selected: boolean;
  onSelect: (el: SysmlElement) => void;
  onDelete?: (el: SysmlElement) => void;
}

export function ElementRow({ element, parentName, selected, onSelect, onDelete }: ElementRowProps) {
  const kindStr = typeof element.kind === "string" ? element.kind : "other";
  const [translateX, setTranslateX] = React.useState(0);
  const touchStart = React.useRef<{ x: number; y: number } | null>(null);
  const DELETE_THRESHOLD = -70;

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      {/* Delete button behind */}
      {onDelete && translateX < -10 && (
        <div
          onClick={() => onDelete(element)}
          style={{
            position: "absolute", right: 0, top: 0, bottom: 0,
            width: 70, background: "var(--error)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
            cursor: "pointer",
          }}
        >
          Delete
        </div>
      )}
      <button
        onClick={() => onSelect(element)}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          padding: "10px 14px", background: selected ? "var(--bg-elevated)" : "transparent",
          border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer",
          textAlign: "left", transition: translateX === 0 ? "transform 0.2s" : "none",
          borderLeft: selected ? "3px solid var(--accent)" : "3px solid transparent",
          minHeight: 44,
          transform: `translateX(${translateX}px)`,
        }}
        onTouchStart={(e) => {
          touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchMove={(e) => {
          if (!touchStart.current) return;
          const dx = e.touches[0].clientX - touchStart.current.x;
          const dy = e.touches[0].clientY - touchStart.current.y;
          if (Math.abs(dy) > Math.abs(dx)) return;
          if (dx < 0) setTranslateX(Math.max(dx, DELETE_THRESHOLD));
        }}
        onTouchEnd={() => {
          touchStart.current = null;
          setTranslateX(translateX < DELETE_THRESHOLD / 2 ? DELETE_THRESHOLD : 0);
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
    </div>
  );
}
