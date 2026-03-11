import React, { useRef, useCallback } from "react";
import type { SysmlElement, ElementId } from "../../lib/element-types";
import { TypeBadge } from "../shared/TypeBadge";

interface ElementRowProps {
  element: SysmlElement;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: (id: ElementId) => void;
  selected: boolean;
  onSelect: (el: SysmlElement) => void;
  onDelete?: (el: SysmlElement) => void;
  onEdit?: (el: SysmlElement) => void;
  onAdd?: (el: SysmlElement) => void;
}

const ACTION_W = 64;
const DEAD_ZONE = 22;
const SNAP_THRESHOLD = 48;
const INDENT_PX = 16;

// Shared tracker: only one row swiped open at a time
let activeResetFn: (() => void) | null = null;

export function ElementRow({ element, depth, hasChildren, expanded, onToggle, selected, onSelect, onDelete, onEdit, onAdd }: ElementRowProps) {
  const kindStr = typeof element.kind === "string" ? element.kind : "other";

  const rowRef = useRef<HTMLButtonElement>(null);
  const actionsLeftRef = useRef<HTMLDivElement>(null);
  const actionsRightRef = useRef<HTMLDivElement>(null);

  const startX = useRef(0);
  const startY = useRef(0);
  const currentX = useRef(0);
  const direction = useRef<"left" | "right" | null>(null);
  const isOpen = useRef(false);
  const openOffset = useRef(0);

  const maxRight = (onAdd ? ACTION_W : 0) + (onEdit ? ACTION_W : 0);
  const maxLeft = onDelete ? ACTION_W : 0;

  const setOffset = useCallback((x: number, animate: boolean) => {
    const el = rowRef.current;
    if (!el) return;
    if (animate) {
      el.style.transition = "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
    } else {
      el.style.transition = "none";
    }
    el.style.transform = `translateX(${x}px)`;
    currentX.current = x;

    // Smooth progressive reveal: opacity ramps with swipe distance
    if (actionsLeftRef.current) {
      if (x > 0 && maxRight > 0) {
        const progress = Math.min(x / maxRight, 1);
        const opacity = Math.min(progress * 1.5, 1);
        actionsLeftRef.current.style.opacity = String(opacity);
        actionsLeftRef.current.style.pointerEvents = progress > 0.5 ? "auto" : "none";
      } else {
        actionsLeftRef.current.style.opacity = "0";
        actionsLeftRef.current.style.pointerEvents = "none";
      }
    }
    if (actionsRightRef.current) {
      if (x < 0 && maxLeft > 0) {
        const progress = Math.min(Math.abs(x) / maxLeft, 1);
        const opacity = Math.min(progress * 1.5, 1);
        actionsRightRef.current.style.opacity = String(opacity);
        actionsRightRef.current.style.pointerEvents = progress > 0.5 ? "auto" : "none";
      } else {
        actionsRightRef.current.style.opacity = "0";
        actionsRightRef.current.style.pointerEvents = "none";
      }
    }
  }, [maxLeft, maxRight]);

  const snapTo = useCallback((target: number) => {
    setOffset(target, true);
    isOpen.current = target !== 0;
    openOffset.current = target;
    if (target !== 0) {
      activeResetFn = () => { setOffset(0, true); isOpen.current = false; openOffset.current = 0; };
    } else {
      activeResetFn = null;
    }
  }, [setOffset]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (activeResetFn && !isOpen.current) {
      activeResetFn();
      activeResetFn = null;
    }
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    direction.current = null;
    if (isOpen.current) {
      startX.current -= openOffset.current;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;

    if (!direction.current) {
      if (Math.abs(dy) > DEAD_ZONE) {
        direction.current = null;
        startX.current = 0;
        return;
      }
      if (Math.abs(dx) < DEAD_ZONE) return;
      direction.current = dx > 0 ? "right" : "left";
    }

    let clamped: number;
    if (direction.current === "left") {
      clamped = Math.max(dx, -maxLeft);
      if (dx < -maxLeft) clamped = -maxLeft + (dx + maxLeft) * 0.15;
    } else {
      clamped = Math.min(dx, maxRight);
      if (dx > maxRight) clamped = maxRight + (dx - maxRight) * 0.15;
    }

    setOffset(clamped, false);
  }, [maxLeft, maxRight, setOffset]);

  const handleTouchEnd = useCallback(() => {
    if (!direction.current) {
      startX.current = 0;
      return;
    }
    const x = currentX.current;
    if (direction.current === "left") {
      snapTo(x < -SNAP_THRESHOLD && maxLeft > 0 ? -maxLeft : 0);
    } else {
      snapTo(x > SNAP_THRESHOLD && maxRight > 0 ? maxRight : 0);
    }
    direction.current = null;
  }, [maxLeft, maxRight, snapTo]);

  const handleClick = useCallback(() => {
    if (isOpen.current) {
      snapTo(0);
    } else {
      onSelect(element);
    }
  }, [element, onSelect, snapTo]);

  const handleToggleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(element.id);
  }, [element.id, onToggle]);

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      {/* Right-side action (swipe left): Delete */}
      {onDelete && (
        <div
          ref={actionsRightRef}
          onClick={() => { snapTo(0); onDelete(element); }}
          style={{
            display: "flex",
            position: "absolute", right: 0, top: 0, bottom: 0,
            width: ACTION_W, background: "var(--error)",
            alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
            cursor: "pointer",
            opacity: 0, pointerEvents: "none",
            transition: "opacity 0.15s ease",
          }}
        >
          Delete
        </div>
      )}

      {/* Left-side actions (swipe right): Add + Edit */}
      <div
        ref={actionsLeftRef}
        style={{
          display: "flex",
          position: "absolute", left: 0, top: 0, bottom: 0,
          opacity: 0, pointerEvents: "none",
          transition: "opacity 0.15s ease",
        }}
      >
        {onAdd && (
          <div
            onClick={() => { snapTo(0); onAdd(element); }}
            style={{
              width: ACTION_W, background: "var(--accent)",
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
            onClick={() => { snapTo(0); onEdit(element); }}
            style={{
              width: ACTION_W, background: "var(--warning)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
              cursor: "pointer",
            }}
          >
            Edit
          </div>
        )}
      </div>

      <button
        ref={rowRef}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          padding: `8px 14px 8px ${14 + depth * INDENT_PX}px`,
          background: selected ? "var(--bg-elevated)" : "var(--bg-primary, #1e1e2e)",
          border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer",
          textAlign: "left",
          borderLeft: selected ? "3px solid var(--accent)" : "3px solid transparent",
          minHeight: 40,
          willChange: "transform",
          position: "relative", zIndex: 1,
        }}
      >
        {/* Expand/collapse toggle */}
        <span
          onClick={hasChildren ? handleToggleClick : undefined}
          style={{
            width: 18, height: 18, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-muted)", fontSize: 12,
            cursor: hasChildren ? "pointer" : "default",
            borderRadius: 4,
            transition: "transform 0.15s ease",
            transform: hasChildren && expanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          {hasChildren ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4.5 2L9 6L4.5 10V2Z" />
            </svg>
          ) : (
            <span style={{ width: 12 }} />
          )}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: "var(--text-primary)", fontFamily: "var(--font-mono)",
            fontSize: 13, fontWeight: 500,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {element.name ?? (element.type_ref ? `${element.type_ref}` : "<anonymous>")}
            {element.short_name && (
              <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 11 }}>
                {" "}&lt;{element.short_name}&gt;
              </span>
            )}
            {element.type_ref && (
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                {" : "}{element.type_ref}
              </span>
            )}
          </div>
        </div>
        <TypeBadge kind={kindStr} />
      </button>
    </div>
  );
}
