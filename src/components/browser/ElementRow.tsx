import React from "react";
import type { SysmlElement } from "../../lib/element-types";
import { TypeBadge } from "../shared/TypeBadge";

interface ElementRowProps {
  element: SysmlElement;
  parentName?: string;
  selected: boolean;
  onSelect: (el: SysmlElement) => void;
  onDelete?: (el: SysmlElement) => void;
  onEdit?: (el: SysmlElement) => void;
  onAdd?: (el: SysmlElement) => void;
}

const ACTION_WIDTH = 64;
const SWIPE_THRESHOLD = 40;

export function ElementRow({ element, parentName, selected, onSelect, onDelete, onEdit, onAdd }: ElementRowProps) {
  const kindStr = typeof element.kind === "string" ? element.kind : "other";
  const [translateX, setTranslateX] = React.useState(0);
  const touchStart = React.useRef<{ x: number; y: number } | null>(null);
  const locked = React.useRef<"left" | "right" | null>(null);

  const maxRight = (onEdit ? ACTION_WIDTH : 0) + (onAdd ? ACTION_WIDTH : 0);
  const maxLeft = onDelete ? -ACTION_WIDTH : 0;

  function resetSwipe() {
    setTranslateX(0);
    locked.current = null;
  }

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      {/* Right-side actions (revealed on swipe left): Delete */}
      {onDelete && translateX < -10 && (
        <div
          onClick={() => { onDelete(element); resetSwipe(); }}
          style={{
            position: "absolute", right: 0, top: 0, bottom: 0,
            width: ACTION_WIDTH, background: "var(--error)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
            cursor: "pointer",
          }}
        >
          Delete
        </div>
      )}

      {/* Left-side actions (revealed on swipe right): Add + Edit */}
      {translateX > 10 && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          display: "flex",
        }}>
          {onAdd && (
            <div
              onClick={() => { onAdd(element); resetSwipe(); }}
              style={{
                width: ACTION_WIDTH, background: "var(--accent)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
                cursor: "pointer",
              }}
            >
              Add
            </div>
          )}
          {onEdit && (
            <div
              onClick={() => { onEdit(element); resetSwipe(); }}
              style={{
                width: ACTION_WIDTH, background: "var(--warning)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
                cursor: "pointer",
              }}
            >
              Edit
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => { if (translateX !== 0) { resetSwipe(); } else { onSelect(element); } }}
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
          locked.current = null;
        }}
        onTouchMove={(e) => {
          if (!touchStart.current) return;
          const dx = e.touches[0].clientX - touchStart.current.x;
          const dy = e.touches[0].clientY - touchStart.current.y;
          // Lock direction on first significant movement
          if (!locked.current) {
            if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 5) {
              touchStart.current = null; // vertical scroll, bail out
              return;
            }
            if (Math.abs(dx) > 5) {
              locked.current = dx > 0 ? "right" : "left";
            }
            return;
          }
          // Clamp to action widths
          if (locked.current === "left") {
            setTranslateX(Math.max(dx, maxLeft));
          } else {
            setTranslateX(Math.min(dx, maxRight));
          }
        }}
        onTouchEnd={() => {
          if (!locked.current) {
            touchStart.current = null;
            return;
          }
          // Snap open or closed
          if (locked.current === "left") {
            setTranslateX(translateX < -SWIPE_THRESHOLD ? maxLeft : 0);
          } else {
            setTranslateX(translateX > SWIPE_THRESHOLD ? maxRight : 0);
          }
          touchStart.current = null;
          locked.current = null;
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
