import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useModelStore } from "../../stores/model-store";
import { computeBddLayout, computeStmLayout, computeReqLayout, computeUcdLayout, computeIbdLayout } from "../../lib/tauri-bridge";
import type { DiagramLayout, DiagramNode, ViewData, SysmlElement, ElementKind } from "../../lib/element-types";
import { evaluateView, mergeViewData, buildInterconnectionLayout } from "../../lib/view-evaluator";

export function DiagramView() {
  const diagramType = useUIStore((s) => s.diagramType);
  const setDiagramType = useUIStore((s) => s.setDiagramType);
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const selectedViewName = useUIStore((s) => s.selectedViewName);
  const diagramScope = useUIStore((s) => s.diagramScope);
  const setDiagramScope = useUIStore((s) => s.setDiagramScope);
  const highlightedNodeId = useUIStore((s) => s.highlightedNodeId);
  const setHighlightedNode = useUIStore((s) => s.setHighlightedNode);
  const openDialog = useUIStore((s) => s.openDialog);
  const navigateToEditor = useUIStore((s) => s.navigateToEditor);
  const model = useModelStore((s) => s.model);

  // User-defined views from the model (deduplicated by name)
  const customViews = useMemo(() => {
    if (!model) return [];
    const seen = new Set<string>();
    return (model.views ?? []).filter(v => {
      if (seen.has(v.name)) return false;
      seen.add(v.name);
      return true;
    });
  }, [model]);

  // Resolve the active custom view's matched elements
  const customViewResult = useMemo(() => {
    if (viewMode !== "custom" || !selectedViewName || !model) return null;
    const vd = customViews.find(v => v.name === selectedViewName);
    if (!vd) return null;
    // Check if this view specializes another (look up via element type_ref)
    const viewEl = model.elements.find(e =>
      (e.kind === "view_def" || e.kind === "view_usage") && e.name === selectedViewName
    );
    let resolved = vd;
    if (viewEl?.type_ref) {
      const parentView = customViews.find(v => v.name === viewEl.type_ref);
      if (parentView) resolved = mergeViewData(vd, parentView);
    }
    const matched = evaluateView(resolved, model.elements);
    return { view: resolved, elements: matched };
  }, [viewMode, selectedViewName, model, customViews]);

  const [layout, setLayout] = useState<DiagramLayout | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const lastPinchDist = useRef<number | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Fetch layout when model, diagram type, or scope changes
  useEffect(() => {
    if (!model) return;
    const scopeName = diagramScope?.elementName ?? undefined;
    const scopeKind = diagramScope?.elementKind ?? "";
    // Diagram node kinds ("block", "state", "part") don't match SysML kinds ("part_def", etc.)
    // Accept both forms for scope resolution
    const isScopedDef = scopeKind.endsWith("_def") || scopeKind === "block" || scopeKind === "requirement";
    const isScopedPart = scopeKind === "part_def" || scopeKind === "part_usage" || scopeKind === "block" || scopeKind === "part";
    const isScopedState = scopeKind === "state_def" || scopeKind === "state";
    const fetchLayout = async () => {
      try {
        switch (diagramType) {
          case "bdd":
            setLayout(await computeBddLayout(isScopedDef ? scopeName : undefined));
            break;
          case "stm": {
            let stmName = isScopedState ? scopeName : undefined;
            if (!stmName) {
              const stateDef = model.elements.find(
                (e) => typeof e.kind === "string" && e.kind === "state_def"
              );
              stmName = stateDef?.name ?? undefined;
            }
            if (stmName) setLayout(await computeStmLayout(stmName));
            else setLayout(null);
            break;
          }
          case "req":
            setLayout(await computeReqLayout());
            break;
          case "ucd":
            setLayout(await computeUcdLayout());
            break;
          case "ibd":
            setLayout(await computeIbdLayout(isScopedPart ? scopeName : undefined));
            break;
        }
      } catch {
        setLayout(null);
      }
    };
    fetchLayout();
  }, [model, diagramType, diagramScope]);

  // Auto-fit when layout changes
  useEffect(() => {
    if (!layout || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const [bMinX, bMinY, bMaxX, bMaxY] = layout.bounds;
    const diagramW = bMaxX - bMinX;
    const diagramH = bMaxY - bMinY;
    if (diagramW <= 0 || diagramH <= 0) { setZoom(0.85); setPan({ x: 0, y: 0 }); return; }
    const padding = 40;
    const fitZoom = Math.min(
      (rect.width - padding * 2) / diagramW,
      (rect.height - padding * 2) / diagramH,
      2.0
    );
    const fitPanX = (rect.width - diagramW * fitZoom) / 2 - bMinX * fitZoom;
    const fitPanY = (rect.height - diagramH * fitZoom) / 2 - bMinY * fitZoom;
    setZoom(fitZoom);
    setPan({ x: fitPanX, y: fitPanY });
  }, [layout]);

  // Hit-test a screen tap against diagram nodes (stored in ref for use in touch handler)
  const handleTapRef = useRef<(x: number, y: number) => void>(() => {});
  handleTapRef.current = (screenX: number, screenY: number) => {
    if (!layout || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const svgX = (screenX - rect.left - pan.x) / zoom;
    const svgY = (screenY - rect.top - pan.y) / zoom;

    for (let i = layout.nodes.length - 1; i >= 0; i--) {
      const n = layout.nodes[i];
      if (n.kind === "block_container" || n.kind === "system_boundary" || n.kind === "initial_state" || n.kind === "final_state") continue;
      if (svgX >= n.x && svgX <= n.x + n.width && svgY >= n.y && svgY <= n.y + n.height) {
        setHighlightedNode(n.label);
        return;
      }
    }
    setHighlightedNode(null);
  };
  const handleTap = (x: number, y: number) => handleTapRef.current(x, y);

  // Attach native touch listeners to the container div with { passive: false }
  // so we can preventDefault and stop Safari from hijacking gestures
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    function getTouchDist(t1: Touch, t2: Touch) {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e: TouchEvent) {
      // Don't intercept touches on buttons (zoom controls, action bar)
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length === 1) {
        const pos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        setDragging(true);
        lastPos.current = pos;
        touchStartPos.current = pos;
        didDrag.current = false;
      } else if (e.touches.length === 2) {
        setDragging(false);
        didDrag.current = true;
        lastPinchDist.current = getTouchDist(e.touches[0], e.touches[1]);
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        lastPos.current = { x: mx, y: my };
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length === 1 && lastPos.current) {
        const dx = e.touches[0].clientX - lastPos.current.x;
        const dy = e.touches[0].clientY - lastPos.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag.current = true;
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
        didDrag.current = true;
        const dist = getTouchDist(e.touches[0], e.touches[1]);
        const scale = dist / lastPinchDist.current;
        lastPinchDist.current = dist;
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        // Zoom toward viewport center
        const rect = el!.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const oldZ = zoomRef.current;
        const newZ = Math.min(Math.max(oldZ * scale, 0.2), 2.5);
        const ratio = newZ / oldZ;
        zoomRef.current = newZ;
        setZoom(newZ);
        const savedLastPos = lastPos.current;
        setPan((p) => {
          let nx = cx - (cx - p.x) * ratio;
          let ny = cy - (cy - p.y) * ratio;
          // Also apply finger pan (midpoint movement)
          if (savedLastPos) {
            nx += mx - savedLastPos.x;
            ny += my - savedLastPos.y;
          }
          return { x: nx, y: ny };
        });
        lastPos.current = { x: mx, y: my };
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length === 0) {
        // Tap detection: if finger didn't move, hit-test against nodes
        if (!didDrag.current && touchStartPos.current) {
          handleTap(touchStartPos.current.x, touchStartPos.current.y);
        }
        setDragging(false);
        lastPos.current = null;
        lastPinchDist.current = null;
        touchStartPos.current = null;
      } else if (e.touches.length === 1) {
        lastPinchDist.current = null;
        lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }

    // Safari-specific: block native pinch-zoom gesture events
    function onGesture(e: Event) {
      e.preventDefault();
      e.stopPropagation();
    }

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("gesturestart", onGesture, { passive: false } as any);
    el.addEventListener("gesturechange", onGesture, { passive: false } as any);
    el.addEventListener("gestureend", onGesture, { passive: false } as any);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("gesturestart", onGesture);
      el.removeEventListener("gesturechange", onGesture);
      el.removeEventListener("gestureend", onGesture);
    };
  }, []);

  // Mouse/pointer pan (desktop) — use ref to avoid stale closure
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return; // handled by native touch listeners
    draggingRef.current = true;
    setDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (draggingRef.current && lastPos.current) {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    draggingRef.current = false;
    setDragging(false);
    lastPos.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  // If highlightedNodeId doesn't match any node in current layout, treat as null
  // so we don't dim all nodes when navigating to a non-existent diagram node
  const effectiveHl = highlightedNodeId && layout?.nodes.some(n => n.label === highlightedNodeId)
    ? highlightedNodeId
    : null;

  return (
    <>
      {/* View selector dropdown */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
        background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)",
      }}>
        <select
          value={viewMode === "custom" ? `custom:${selectedViewName}` : viewMode}
          onChange={(e) => {
            const val = e.target.value;
            if (val.startsWith("custom:")) {
              setViewMode("custom", val.slice(7));
            } else {
              setDiagramType(val as any);
            }
          }}
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            fontFamily: "var(--font-mono)", cursor: "pointer",
            border: "1.5px solid var(--border)", background: "var(--bg-primary)",
            color: "var(--text-primary)", appearance: "auto", minHeight: 38,
          }}
        >
          <optgroup label="Diagrams">
            <option value="bdd">Block Definition Diagram</option>
            <option value="stm">State Machine Diagram</option>
            <option value="req">Requirements Diagram</option>
            <option value="ucd">Use Case Diagram</option>
            <option value="ibd">Internal Block Diagram</option>
          </optgroup>
          {customViews.length > 0 && (
            <optgroup label="Model Views">
              {customViews.map((v) => (
                <option key={v.name} value={`custom:${v.name}`}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Scope indicator */}
      {diagramScope && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 10px", background: "rgba(59,130,246,0.08)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)",
        }}>
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span>Scoped to <span style={{ color: "var(--accent-hover)", fontWeight: 600 }}>{diagramScope.elementName}</span></span>
          <button
            onClick={() => setDiagramScope(null)}
            style={{
              marginLeft: "auto", background: "none", border: "1px solid var(--border)",
              borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 600,
              fontFamily: "var(--font-mono)", color: "var(--text-muted)", cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Custom view content */}
      {viewMode === "custom" && customViewResult && (
        <CustomViewPanel
          view={customViewResult.view}
          elements={customViewResult.elements}
          allElements={model?.elements ?? []}
          onSelectElement={(id) => { useUIStore.getState().selectElement(id); }}
          onNavigateToEditor={(line) => { navigateToEditor(line); }}
        />
      )}

      {/* Diagram canvas (hidden when custom view is active) */}
      <div ref={canvasRef} style={{ flex: 1, position: "relative", overflow: "hidden", background: "var(--bg-primary)", touchAction: "none", display: viewMode === "custom" ? "none" : "block" }}>
        {/* Grid background */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.15,
          backgroundImage: "radial-gradient(circle, #334155 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }} />

        {/* Zoom controls */}
        <div style={{
          position: "absolute", top: 12, right: 12, display: "flex",
          flexDirection: "column", gap: 4, zIndex: 10,
        }}>
          {[
            { label: "+", action: () => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) { setZoom(z => Math.min(z + 0.15, 2.5)); return; }
              const cx = rect.width / 2; const cy = rect.height / 2;
              const oldZ = zoomRef.current;
              const newZ = Math.min(oldZ + 0.15, 2.5);
              const ratio = newZ / oldZ;
              setZoom(newZ);
              setPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }));
            }},
            { label: "−", action: () => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) { setZoom(z => Math.max(z - 0.15, 0.2)); return; }
              const cx = rect.width / 2; const cy = rect.height / 2;
              const oldZ = zoomRef.current;
              const newZ = Math.max(oldZ - 0.15, 0.2);
              const ratio = newZ / oldZ;
              setZoom(newZ);
              setPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }));
            }},
            { label: "FIT", action: () => {
              if (!layout || !canvasRef.current) { setZoom(0.85); setPan({ x: 0, y: 0 }); return; }
              const rect = canvasRef.current.getBoundingClientRect();
              const [bMinX, bMinY, bMaxX, bMaxY] = layout.bounds;
              const diagramW = bMaxX - bMinX;
              const diagramH = bMaxY - bMinY;
              if (diagramW <= 0 || diagramH <= 0) { setZoom(0.85); setPan({ x: 0, y: 0 }); return; }
              const padding = 40;
              const fitZoom = Math.min(
                (rect.width - padding * 2) / diagramW,
                (rect.height - padding * 2) / diagramH,
                2.0
              );
              const fitPanX = (rect.width - diagramW * fitZoom) / 2 - bMinX * fitZoom;
              const fitPanY = (rect.height - diagramH * fitZoom) / 2 - bMinY * fitZoom;
              setZoom(fitZoom);
              setPan({ x: fitPanX, y: fitPanY });
            } },
          ].map((btn) => (
            <button
              key={btn.label}
              onClick={btn.action}
              style={{
                width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--bg-tertiary)", color: "var(--text-secondary)",
                cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: btn.label === "FIT" ? 11 : 18,
                fontWeight: 700, fontFamily: "var(--font-mono)", minHeight: 34,
              }}
            >
              {btn.label}
            </button>
          ))}
          <button
            onClick={() => {
              if (!svgRef.current || !layout) return;
              const [bMinX, bMinY, bMaxX, bMaxY] = layout.bounds;
              const w = bMaxX - bMinX + 40;
              const h = bMaxY - bMinY + 40;
              const svgClone = svgRef.current.cloneNode(true) as SVGSVGElement;
              svgClone.setAttribute("width", String(w * 2));
              svgClone.setAttribute("height", String(h * 2));
              svgClone.setAttribute("viewBox", `${bMinX - 20} ${bMinY - 20} ${w} ${h}`);
              // Remove the transform group's transform
              const g = svgClone.querySelector("g");
              if (g) g.setAttribute("transform", "");
              const serializer = new XMLSerializer();
              const svgString = serializer.serializeToString(svgClone);
              const canvas = document.createElement("canvas");
              canvas.width = w * 2;
              canvas.height = h * 2;
              const ctx = canvas.getContext("2d");
              const img = new Image();
              img.onload = () => {
                ctx?.drawImage(img, 0, 0);
                canvas.toBlob((blob) => {
                  if (!blob) return;
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `sysml-${diagramType}-diagram.png`;
                  a.click();
                  URL.revokeObjectURL(url);
                });
              };
              img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgString)));
            }}
            style={{
              width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--bg-tertiary)", color: "var(--text-secondary)",
              cursor: "pointer", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 11,
              fontWeight: 700, fontFamily: "var(--font-mono)", minHeight: 34,
            }}
            title="Export PNG"
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        </div>

        {/* Diagram type label */}
        <div style={{
          position: "absolute", top: 12, left: 12, fontSize: 11, fontWeight: 700,
          letterSpacing: "0.1em", color: "var(--text-muted)", textTransform: "uppercase",
          fontFamily: "var(--font-mono)", zIndex: 10,
          background: "rgba(15,23,42,0.8)", padding: "4px 10px", borderRadius: 6,
          border: "1px solid var(--border)",
        }}>
          {{ bdd: "Block Definition", stm: "State Machine", req: "Requirements", ucd: "Use Case", ibd: "Internal Block" }[diagramType]}
        </div>

        {/* SVG */}
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={(e) => {
            e.preventDefault();
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const factor = e.deltaY > 0 ? 0.9 : 1.1;
            const oldZ = zoomRef.current;
            const newZ = Math.min(Math.max(oldZ * factor, 0.2), 2.5);
            const ratio = newZ / oldZ;
            setZoom(newZ);
            setPan((p) => ({
              x: cx - (cx - p.x) * ratio,
              y: cy - (cy - p.y) * ratio,
            }));
          }}
          onClick={(e) => {
            // Click on empty SVG area clears highlight (desktop)
            if (e.target === svgRef.current || (e.target as Element).tagName === "svg") {
              setHighlightedNode(null);
            }
          }}
          style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#475569" />
              </marker>
              <marker id="arrowhead-hl" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#60a5fa" />
              </marker>
              <marker id="diamond" markerWidth="12" markerHeight="8" refX="0" refY="4" orient="auto">
                <polygon points="0 4, 6 0, 12 4, 6 8" fill="#475569" stroke="#475569" strokeWidth="1" />
              </marker>
              <marker id="diamond-hl" markerWidth="12" markerHeight="8" refX="0" refY="4" orient="auto">
                <polygon points="0 4, 6 0, 12 4, 6 8" fill="#60a5fa" stroke="#60a5fa" strokeWidth="1" />
              </marker>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {layout?.edges.map((edge, i) => {
              if (edge.points.length < 2) return null;
              const isHl = effectiveHl !== null &&
                layout.nodes.some((n) =>
                  (n.element_id === edge.from_id || n.element_id === edge.to_id) &&
                  n.label === effectiveHl
                );
              const isComposition = edge.edge_type === "composition";
              const isDashed = edge.edge_type === "satisfy" || edge.edge_type === "verify"
                || edge.edge_type === "containment" || edge.edge_type === "include";

              // Build SVG path through all waypoints
              const d = edge.points.map((pt, j) =>
                `${j === 0 ? "M" : "L"} ${pt[0]} ${pt[1]}`
              ).join(" ");

              // Label position: between the two middle waypoints (horizontal segment)
              const midA = edge.points[Math.floor((edge.points.length - 1) / 2)];
              const midB = edge.points[Math.ceil((edge.points.length - 1) / 2)];
              const labelPt: [number, number] = [(midA[0] + midB[0]) / 2, (midA[1] + midB[1]) / 2];

              return (
                <g key={`edge-${i}`}>
                  <path
                    d={d}
                    stroke={isHl ? "#60a5fa" : "#475569"}
                    strokeWidth={isHl ? 2 : 1.5}
                    strokeDasharray={isDashed ? "6 3" : undefined}
                    fill="none"
                    markerEnd={isComposition ? undefined : (isHl ? "url(#arrowhead-hl)" : "url(#arrowhead)")}
                    markerStart={isComposition ? (isHl ? "url(#diamond-hl)" : "url(#diamond)") : undefined}
                    opacity={effectiveHl && !isHl ? 0.2 : 1}
                  />
                  {edge.label && edge.label !== "composition" && (
                    <text
                      x={labelPt[0]} y={labelPt[1] - 6}
                      fill={isHl ? "var(--accent)" : "var(--text-muted)"}
                      fontSize="9" fontFamily="var(--font-mono)" textAnchor="middle"
                      opacity={effectiveHl && !isHl ? 0.2 : 1}
                    >
                      {edge.edge_type === "satisfy" || edge.edge_type === "verify"
                        ? `\u00AB${edge.edge_type}\u00BB`
                        : edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {layout?.nodes.map((node) => {
              const isHl = effectiveHl === node.label;
              const { kind } = node;
              const comps = node.compartments ?? [];

              // Initial pseudo-state: filled circle
              if (kind === "initial_state") {
                const cx = node.x + node.width / 2;
                const cy = node.y + node.height / 2;
                return (
                  <g key={node.element_id} opacity={effectiveHl ? 0.25 : 1}>
                    <circle cx={cx} cy={cy} r={node.width / 2}
                      fill="#475569" stroke="#64748b" strokeWidth={1.5} />
                  </g>
                );
              }

              // Final pseudo-state: bull's eye
              if (kind === "final_state") {
                const cx = node.x + node.width / 2;
                const cy = node.y + node.height / 2;
                return (
                  <g key={node.element_id} opacity={effectiveHl ? 0.25 : 1}>
                    <circle cx={cx} cy={cy} r={node.width / 2}
                      fill="none" stroke="#475569" strokeWidth={2} />
                    <circle cx={cx} cy={cy} r={node.width / 2 - 4}
                      fill="#475569" />
                  </g>
                );
              }

              // Actor: stick figure
              if (kind === "actor") {
                const cx = node.x + node.width / 2;
                const topY = node.y + 10;
                return (
                  <g
                    key={node.element_id}
                    onClick={() => setHighlightedNode(node.label)}
                    style={{ cursor: "pointer" }}
                    opacity={effectiveHl && !isHl ? 0.25 : 1}
                    filter={isHl ? "url(#glow)" : undefined}
                  >
                    <circle cx={cx} cy={topY + 10} r={10}
                      fill="none" stroke={isHl ? "#60a5fa" : "#94a3b8"} strokeWidth={2} />
                    <line x1={cx} y1={topY + 20} x2={cx} y2={topY + 45}
                      stroke={isHl ? "#60a5fa" : "#94a3b8"} strokeWidth={2} />
                    <line x1={cx - 18} y1={topY + 30} x2={cx + 18} y2={topY + 30}
                      stroke={isHl ? "#60a5fa" : "#94a3b8"} strokeWidth={2} />
                    <line x1={cx} y1={topY + 45} x2={cx - 14} y2={topY + 62}
                      stroke={isHl ? "#60a5fa" : "#94a3b8"} strokeWidth={2} />
                    <line x1={cx} y1={topY + 45} x2={cx + 14} y2={topY + 62}
                      stroke={isHl ? "#60a5fa" : "#94a3b8"} strokeWidth={2} />
                    <text x={cx} y={node.y + node.height - 2}
                      fill={isHl ? "var(--text-primary)" : "var(--text-secondary)"} fontSize="11"
                      fontWeight={600} fontFamily="var(--font-mono)"
                      textAnchor="middle">{node.label}</text>
                  </g>
                );
              }

              // System boundary: dashed rectangle with label
              if (kind === "system_boundary") {
                return (
                  <g key={node.element_id} opacity={effectiveHl ? 0.35 : 1}>
                    <rect x={node.x} y={node.y} width={node.width} height={node.height}
                      rx={6} ry={6}
                      fill="none"
                      stroke={node.color + "88"}
                      strokeWidth={1.5} strokeDasharray="6 3" />
                    <text x={node.x + node.width / 2} y={node.y + 16}
                      fill={node.color} fontSize="10" fontWeight={700}
                      fontFamily="var(--font-mono)" textAnchor="middle"
                      letterSpacing="0.05em">
                      {node.stereotype ?? node.label}
                    </text>
                  </g>
                );
              }

              // Use case: ellipse
              if (kind === "usecase") {
                const cx = node.x + node.width / 2;
                const cy = node.y + node.height / 2;
                return (
                  <g
                    key={node.element_id}
                    onClick={() => setHighlightedNode(node.label)}
                    style={{ cursor: "pointer" }}
                    opacity={effectiveHl && !isHl ? 0.25 : 1}
                    filter={isHl ? "url(#glow)" : undefined}
                  >
                    <ellipse cx={cx} cy={cy} rx={node.width / 2} ry={node.height / 2}
                      fill={isHl ? node.color + "33" : "var(--bg-tertiary)"}
                      stroke={isHl ? node.color : node.color + "88"}
                      strokeWidth={isHl ? 2.5 : 1.5} />
                    <text x={cx} y={cy + 1}
                      fill={isHl ? "var(--text-primary)" : "var(--text-secondary)"} fontSize="11"
                      fontWeight={600} fontFamily="var(--font-mono)"
                      textAnchor="middle" dominantBaseline="middle">{node.label}</text>
                  </g>
                );
              }

              // Port: small square on boundary
              if (kind === "port") {
                return (
                  <g
                    key={node.element_id}
                    onClick={() => setHighlightedNode(node.label)}
                    style={{ cursor: "pointer" }}
                    opacity={effectiveHl && !isHl ? 0.25 : 1}
                  >
                    <rect x={node.x} y={node.y} width={node.width} height={node.height}
                      fill={isHl ? node.color + "55" : node.color + "33"}
                      stroke={isHl ? node.color : node.color + "88"}
                      strokeWidth={1.5} />
                    <text x={node.x + node.width / 2} y={node.y + node.height + 12}
                      fill="var(--text-muted)" fontSize="8" fontFamily="var(--font-mono)"
                      textAnchor="middle">{node.label}</text>
                  </g>
                );
              }

              // Block container (IBD outer block): dashed border
              if (kind === "block_container") {
                return (
                  <g key={node.element_id}
                    opacity={effectiveHl && !isHl ? 0.25 : 1}>
                    <rect x={node.x} y={node.y} width={node.width} height={node.height}
                      rx={8} ry={8}
                      fill="none"
                      stroke={isHl ? node.color : node.color + "55"}
                      strokeWidth={2} strokeDasharray="8 4" />
                    <rect x={node.x} y={node.y} width={node.width} height={22}
                      rx={8} ry={0} fill={node.color + "22"} />
                    <text x={node.x + 12} y={node.y + 15}
                      fill={node.color} fontSize="12" fontWeight={700}
                      fontFamily="var(--font-mono)">
                      {node.stereotype ? `${node.stereotype} ${node.label}` : node.label}
                    </text>
                  </g>
                );
              }

              // Requirement: rectangle with stereotype and doc text
              if (kind === "requirement") {
                const docText = node.description;
                return (
                  <g
                    key={node.element_id}
                    onClick={() => setHighlightedNode(node.label)}
                    style={{ cursor: "pointer" }}
                    opacity={effectiveHl && !isHl ? 0.25 : 1}
                    filter={isHl ? "url(#glow)" : undefined}
                  >
                    <rect x={node.x} y={node.y} width={node.width} height={node.height}
                      rx={4} ry={4}
                      fill={isHl ? node.color + "33" : "var(--bg-tertiary)"}
                      stroke={isHl ? node.color : node.color + "88"}
                      strokeWidth={isHl ? 2.5 : 1.5} />
                    <rect x={node.x} y={node.y} width={node.width} height={4}
                      rx={2} fill={node.color} opacity={0.8} />
                    <text x={node.x + node.width / 2} y={node.y + 14}
                      fill={node.color} fontSize="8" fontWeight={700}
                      fontFamily="var(--font-mono)" textAnchor="middle"
                      letterSpacing="0.08em">
                      {node.stereotype ?? "\u00ABrequirement\u00BB"}
                    </text>
                    <text x={node.x + node.width / 2} y={node.y + 30}
                      fill={isHl ? "var(--text-primary)" : "var(--text-secondary)"} fontSize="12"
                      fontWeight={600} fontFamily="var(--font-mono)"
                      textAnchor="middle">{node.label}</text>
                    {docText && (() => {
                      const maxChars = Math.max(Math.floor((node.width - 16) / 4.8), 10);
                      const truncated = docText.length > maxChars ? docText.slice(0, maxChars - 3) + "..." : docText;
                      return (
                        <text x={node.x + node.width / 2} y={node.y + 48}
                          fill="var(--text-muted)" fontSize="8" fontFamily="var(--font-mono)"
                          textAnchor="middle" fontStyle="italic">
                          {truncated}
                        </text>
                      );
                    })()}
                  </g>
                );
              }

              // State: rounded rectangle with entry/do/exit actions
              if (kind === "state") {
                const descLines = node.description?.split("\n") ?? [];
                const nameY = node.y + 20;
                return (
                  <g
                    key={node.element_id}
                    onClick={() => setHighlightedNode(node.label)}
                    style={{ cursor: "pointer" }}
                    opacity={effectiveHl && !isHl ? 0.25 : 1}
                    filter={isHl ? "url(#glow)" : undefined}
                  >
                    <rect
                      x={node.x} y={node.y} width={node.width} height={node.height}
                      rx={12} ry={12}
                      fill={isHl ? node.color + "33" : "var(--bg-tertiary)"}
                      stroke={isHl ? node.color : node.color + "88"}
                      strokeWidth={isHl ? 2.5 : 1.5}
                    />
                    <text
                      x={node.x + node.width / 2} y={nameY}
                      fill={isHl ? "var(--text-primary)" : "var(--text-secondary)"}
                      fontSize="12" fontWeight={700} fontFamily="var(--font-mono)"
                      textAnchor="middle"
                    >
                      {node.label}
                    </text>
                    {descLines.length > 0 && (
                      <line x1={node.x + 8} y1={nameY + 6} x2={node.x + node.width - 8} y2={nameY + 6}
                        stroke={node.color + "44"} strokeWidth={1} />
                    )}
                    {descLines.map((line, li) => (
                      <text key={li}
                        x={node.x + 10} y={nameY + 20 + li * 14}
                        fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-mono)">
                        {line}
                      </text>
                    ))}
                  </g>
                );
              }

              // Default: block/part rectangle (BDD) with compartments
              const hasComps = comps.length > 0;
              const stereo = node.stereotype;
              return (
                <g
                  key={node.element_id}
                  onClick={() => setHighlightedNode(node.label)}
                  style={{ cursor: "pointer" }}
                  opacity={effectiveHl && !isHl ? 0.25 : 1}
                  filter={isHl ? "url(#glow)" : undefined}
                >
                  <rect
                    x={node.x} y={node.y} width={node.width} height={node.height}
                    rx={6} ry={6}
                    fill={isHl ? node.color + "33" : "var(--bg-tertiary)"}
                    stroke={isHl ? node.color : node.color + "88"}
                    strokeWidth={isHl ? 2.5 : 1.5}
                  />
                  <rect
                    x={node.x} y={node.y} width={node.width} height={4}
                    rx={2} fill={node.color} opacity={0.8}
                  />
                  {stereo && (
                    <text
                      x={node.x + node.width / 2} y={node.y + 16}
                      fill={node.color} fontSize="8" fontWeight={700}
                      fontFamily="var(--font-mono)" textAnchor="middle"
                      letterSpacing="0.08em"
                    >
                      {stereo}
                    </text>
                  )}
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + (stereo ? 30 : 20)}
                    fill={isHl ? "var(--text-primary)" : "var(--text-secondary)"}
                    fontSize="11" fontWeight={600} fontFamily="var(--font-mono)"
                    textAnchor="middle"
                  >
                    {kind === "part" && node.description
                      ? `${node.label} : ${node.description}`
                      : node.label}
                  </text>
                  {hasComps && (() => {
                    let cy = node.y + 38;
                    return comps.map((comp, ci) => {
                      const startY = cy;
                      cy += 16 + comp.entries.length * 14;
                      return (
                        <g key={ci}>
                          <line x1={node.x} y1={startY - 2} x2={node.x + node.width} y2={startY - 2}
                            stroke={node.color + "44"} strokeWidth={0.5} />
                          <text x={node.x + 8} y={startY + 10}
                            fill={node.color} fontSize="8" fontWeight={700}
                            fontFamily="var(--font-mono)" letterSpacing="0.05em">
                            {comp.heading}
                          </text>
                          {comp.entries.map((entry, ei) => (
                            <text key={ei} x={node.x + 10} y={startY + 10 + 14 * (ei + 1)}
                              fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-mono)">
                              {entry}
                            </text>
                          ))}
                        </g>
                      );
                    });
                  })()}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Selected node action bar */}
      {effectiveHl && (() => {
        const hlNode = layout?.nodes.find((n: DiagramNode) => n.label === effectiveHl);
        const hlElement = hlNode ? model?.elements.find(e => e.id === hlNode.element_id) : null;
        const connCount = layout?.edges.filter(
          (e) => layout.nodes.some(
            (n) => (n.element_id === e.from_id || n.element_id === e.to_id) && n.label === effectiveHl
          )
        ).length ?? 0;

        // Resolve element: by ID, by name, or by type_ref (for virtual/placeholder nodes)
        const resolvedElement = hlElement
          ?? (hlNode ? model?.elements.find(e => e.name === hlNode.label) : null)
          ?? (hlNode ? model?.elements.find(e => e.type_ref === hlNode.label) : null);
        // For definitions, find the def element itself (resolved might be a usage)
        const resolvedKind = resolvedElement
          ? (typeof resolvedElement.kind === "string" ? resolvedElement.kind : "")
          : "";
        // Find the definition element to show its children
        const defElement = (() => {
          if (!model || !hlNode) return null;
          // Direct match by name as a definition
          const byName = model.elements.find(e => e.name === hlNode.label && typeof e.kind === "string" && e.kind.endsWith("_def"));
          if (byName) return byName;
          // If resolved is a definition, use it
          if (resolvedElement && resolvedKind.endsWith("_def")) return resolvedElement;
          return null;
        })();
        // Gather children of the definition (attributes, ports, parts, states, etc.)
        const childDetails = defElement && model
          ? model.elements.filter(e => e.parent_id === defElement.id).map(e => {
              const k = typeof e.kind === "string" ? e.kind : "";
              const kindShort = k.replace(/_usage$/, "").replace(/_def$/, " def").replace(/_statement$/, "");
              return { name: e.name ?? e.type_ref ?? "<unnamed>", kind: kindShort, typeRef: e.name ? e.type_ref : null };
            })
          : [];

        const actionBtnStyle = (border: string, bg: string, fg: string) => ({
          flex: 1, padding: 8, borderRadius: 8,
          border: `1.5px solid ${border}`, background: bg, color: fg,
          fontSize: 11, fontWeight: 600 as const, fontFamily: "var(--font-mono)",
          cursor: "pointer" as const, minHeight: 38,
        });

        return (
          <div style={{
            padding: "10px 12px", background: "var(--bg-tertiary)",
            borderTop: "1.5px solid var(--accent)",
            maxHeight: "40%", overflow: "auto",
          }}>
            {/* Name + connections count + clear */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 8,
            }}>
              <div>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600,
                  color: "var(--text-primary)",
                }}>
                  {effectiveHl}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                  {connCount} connection{connCount !== 1 ? "s" : ""}
                </span>
              </div>
              <button
                onClick={() => setHighlightedNode(null)}
                style={{
                  background: "var(--bg-elevated)", border: "none", borderRadius: 6,
                  color: "var(--text-secondary)", padding: "4px 10px", fontSize: 11,
                  cursor: "pointer", minHeight: 28,
                }}
              >
                Clear
              </button>
            </div>

            {/* Doc comment */}
            {resolvedElement?.doc && (
              <div style={{
                marginBottom: 8, padding: "6px 8px", background: "var(--bg-primary)",
                borderRadius: 6, border: "1px solid var(--border)",
                fontSize: 11, fontStyle: "italic", color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)", lineHeight: 1.4,
              }}>
                {resolvedElement.doc}
              </div>
            )}

            {/* Short name */}
            {resolvedElement?.short_name && (
              <div style={{
                marginBottom: 8, fontSize: 10, fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
              }}>
                Short name: &lt;{resolvedElement.short_name}&gt;
              </div>
            )}

            {/* Child details for definitions */}
            {childDetails.length > 0 && (
              <div style={{
                marginBottom: 8, padding: "6px 8px", background: "var(--bg-primary)",
                borderRadius: 6, border: "1px solid var(--border)",
              }}>
                {childDetails.map((child, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "3px 0", fontSize: 10, fontFamily: "var(--font-mono)",
                    borderBottom: i < childDetails.length - 1 ? "1px solid var(--border)" : undefined,
                  }}>
                    <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
                      {child.name}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 9 }}>
                      {child.typeRef ? `${child.kind} : ${child.typeRef}` : child.kind}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            {hlNode && (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setDiagramScope({
                    elementId: resolvedElement?.id ?? hlNode.element_id,
                    elementName: hlNode.label,
                    elementKind: resolvedKind || hlNode.kind,
                  })}
                  style={actionBtnStyle("#a78bfa", "rgba(167,139,250,0.1)", "#a78bfa")}
                >
                  Scope
                </button>
                {resolvedElement && (
                  <button
                    onClick={() => navigateToEditor(resolvedElement.span.start_line)}
                    style={actionBtnStyle("var(--accent)", "rgba(59,130,246,0.1)", "var(--accent-hover)")}
                  >
                    Source
                  </button>
                )}
                {resolvedElement && (
                  <button
                    onClick={() => openDialog("edit", resolvedElement.id)}
                    style={actionBtnStyle("#f59e0b", "rgba(245,158,11,0.1)", "#fbbf24")}
                  >
                    Edit
                  </button>
                )}
                {resolvedElement && (
                  <button
                    onClick={() => openDialog("delete", resolvedElement.id)}
                    style={actionBtnStyle("var(--error)", "rgba(239,68,68,0.1)", "#f87171")}
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={() => {
                    const kindMap: Record<string, { kind: string; cat: number }> = {
                      bdd: { kind: "part_def", cat: 0 },
                      stm: { kind: "state_usage", cat: 1 },
                      req: { kind: "requirement_usage", cat: 2 },
                      ucd: { kind: "use_case_def", cat: 1 },
                      ibd: { kind: "part_usage", cat: 0 },
                    };
                    const ctx = kindMap[diagramType] ?? { kind: "part_def", cat: 0 };
                    openDialog("create", undefined, {
                      suggestedKind: ctx.kind,
                      suggestedCategory: ctx.cat,
                      suggestedParentId: resolvedElement?.id ?? hlNode.element_id,
                    });
                  }}
                  style={actionBtnStyle("var(--success)", "rgba(22,163,74,0.1)", "var(--success)")}
                >
                  + Add
                </button>
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
}

// ─── Custom View Panel ───

function CustomViewPanel({ view, elements, allElements, onSelectElement, onNavigateToEditor }: {
  view: ViewData;
  elements: SysmlElement[];
  allElements: SysmlElement[];
  onSelectElement: (id: number) => void;
  onNavigateToEditor: (line?: number) => void;
}) {
  const renderMode: "tree" | "table" | "list" | "diagram" =
    view.render_as === "asTableDiagram" ? "table"
    : view.render_as === "asInterconnectionDiagram" ? "diagram"
    : view.render_as === "asListDiagram" ? "list"
    : "tree";

  // Build parent-child tree from matched elements
  const treeRoots = useMemo(() => {
    const idSet = new Set(elements.map(e => e.id));
    // Roots: elements whose parent is not in the matched set
    return elements.filter(e => e.parent_id === null || !idSet.has(e.parent_id));
  }, [elements]);

  const childMap = useMemo(() => {
    const map = new Map<number, SysmlElement[]>();
    for (const el of elements) {
      if (el.parent_id !== null) {
        const list = map.get(el.parent_id) ?? [];
        list.push(el);
        map.set(el.parent_id, list);
      }
    }
    return map;
  }, [elements]);

  const mono: React.CSSProperties = { fontSize: 11, fontFamily: "var(--font-mono)" };
  const kindStr = (kind: ElementKind): string => typeof kind === "string" ? kind : kind.other;
  const kindColor = (kind: string): string => {
    if (kind.includes("part")) return "#3b82f6";
    if (kind.includes("port")) return "#f59e0b";
    if (kind.includes("attribute")) return "#10b981";
    if (kind.includes("requirement")) return "#ef4444";
    if (kind.includes("action") || kind.includes("state")) return "#c084fc";
    if (kind.includes("constraint") || kind.includes("calc")) return "#f97316";
    return "var(--text-secondary)";
  };

  // Interconnection diagram layout
  const diagramLayout = useMemo(() => {
    if (renderMode !== "diagram") return null;
    return buildInterconnectionLayout(elements, allElements);
  }, [renderMode, elements, allElements]);

  const [dZoom, setDZoom] = useState(0.85);
  const [dPan, setDPan] = useState({ x: 0, y: 0 });
  const dZoomRef = useRef(dZoom);
  dZoomRef.current = dZoom;
  const [dDragging, setDDragging] = useState(false);
  const dLastPos = useRef<{ x: number; y: number } | null>(null);
  const dSvgRef = useRef<SVGSVGElement>(null);
  const dContainerRef = useRef<HTMLDivElement>(null);

  const dLastPinchDist = useRef<number | null>(null);
  const dTouchStartPos = useRef<{ x: number; y: number } | null>(null);
  const dDidDrag = useRef(false);

  // Auto-fit diagram on layout change
  useEffect(() => {
    if (!diagramLayout || !dContainerRef.current) return;
    const rect = dContainerRef.current.getBoundingClientRect();
    const [bMinX, bMinY, bMaxX, bMaxY] = diagramLayout.bounds;
    const dw = bMaxX - bMinX;
    const dh = bMaxY - bMinY;
    if (dw <= 0 || dh <= 0) { setDZoom(0.85); setDPan({ x: 0, y: 0 }); return; }
    const pad = 40;
    const fz = Math.min((rect.width - pad * 2) / dw, (rect.height - pad * 2) / dh, 2.0);
    setDZoom(fz);
    setDPan({ x: (rect.width - dw * fz) / 2 - bMinX * fz, y: (rect.height - dh * fz) / 2 - bMinY * fz });
  }, [diagramLayout]);

  // Native touch listeners for custom diagram pinch-to-zoom + pan
  useEffect(() => {
    const el = dContainerRef.current;
    if (!el) return;
    function dist(t1: Touch, t2: Touch) {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function onTouchStart(e: TouchEvent) {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length === 1) {
        const pos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        setDDragging(true);
        dLastPos.current = pos;
        dTouchStartPos.current = pos;
        dDidDrag.current = false;
      } else if (e.touches.length === 2) {
        setDDragging(false);
        dDidDrag.current = true;
        dLastPinchDist.current = dist(e.touches[0], e.touches[1]);
        dLastPos.current = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
      }
    }
    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length === 1 && dLastPos.current) {
        const dx = e.touches[0].clientX - dLastPos.current.x;
        const dy = e.touches[0].clientY - dLastPos.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dDidDrag.current = true;
        setDPan(p => ({ x: p.x + dx, y: p.y + dy }));
        dLastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2 && dLastPinchDist.current !== null) {
        dDidDrag.current = true;
        const d = dist(e.touches[0], e.touches[1]);
        const scale = d / dLastPinchDist.current;
        dLastPinchDist.current = d;
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = el!.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const oldZ = dZoomRef.current;
        const newZ = Math.min(Math.max(oldZ * scale, 0.2), 2.5);
        const ratio = newZ / oldZ;
        dZoomRef.current = newZ;
        setDZoom(newZ);
        const saved = dLastPos.current;
        setDPan(p => {
          let nx = cx - (cx - p.x) * ratio;
          let ny = cy - (cy - p.y) * ratio;
          if (saved) { nx += mx - saved.x; ny += my - saved.y; }
          return { x: nx, y: ny };
        });
        dLastPos.current = { x: mx, y: my };
      }
    }
    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length === 0) {
        setDDragging(false);
        dLastPos.current = null;
        dLastPinchDist.current = null;
        dTouchStartPos.current = null;
      } else if (e.touches.length === 1) {
        dLastPinchDist.current = null;
        dLastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }
    function onGesture(e: Event) { e.preventDefault(); e.stopPropagation(); }
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("gesturestart", onGesture, { passive: false } as any);
    el.addEventListener("gesturechange", onGesture, { passive: false } as any);
    el.addEventListener("gestureend", onGesture, { passive: false } as any);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("gesturestart", onGesture);
      el.removeEventListener("gesturechange", onGesture);
      el.removeEventListener("gestureend", onGesture);
    };
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-primary)" }}>
      {/* View header */}
      <div style={{
        padding: "10px 14px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-secondary)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ ...mono, fontWeight: 700, color: "#c084fc", fontSize: 13 }}>{view.name}</span>
          <span style={{
            fontSize: 8, fontWeight: 700, padding: "2px 5px", borderRadius: 3,
            background: "rgba(192,132,252,0.15)", color: "#c084fc",
            textTransform: "uppercase", letterSpacing: "0.04em",
          }}>
            CUSTOM VIEW
          </span>
          <span style={{ ...mono, color: "var(--text-muted)", marginLeft: "auto" }}>
            {elements.length} elements
          </span>
        </div>

        {/* View metadata */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {view.exposes.length > 0 && (
            <span style={{ ...mono, fontSize: 10, color: "var(--text-muted)" }}>
              expose: {view.exposes.map((e, i) => (
                <span key={i} style={{ color: "#38bdf8", fontWeight: 600 }}>{i > 0 ? ", " : ""}{e}</span>
              ))}
            </span>
          )}
          {view.kind_filters.length > 0 && (
            <span style={{ ...mono, fontSize: 10, color: "var(--text-muted)" }}>
              filter: {view.kind_filters.map((k, i) => (
                <span key={i} style={{ color: "#f59e0b", fontWeight: 600 }}>{i > 0 ? ", " : ""}{k}</span>
              ))}
            </span>
          )}
        </div>

        {/* Render mode indicator */}
        {view.render_as && (
          <span style={{ ...mono, fontSize: 10, color: "var(--text-muted)", marginTop: 4, display: "block" }}>
            render: <span style={{ color: "#10b981", fontWeight: 600 }}>{view.render_as}</span>
          </span>
        )}
      </div>

      {/* Empty state */}
      {elements.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", ...mono }}>
          No elements match this view's expose/filter criteria.
        </div>
      )}

      {/* Tree rendering */}
      {renderMode === "tree" && elements.length > 0 && (
        <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
          {treeRoots.map(root => (
            <ViewTreeNode
              key={root.id} element={root} depth={0} childMap={childMap}
              kindColor={kindColor} mono={mono}
              onSelect={onSelectElement} onNavigate={onNavigateToEditor}
            />
          ))}
        </div>
      )}

      {/* Table rendering */}
      {renderMode === "table" && elements.length > 0 && (
        <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", ...mono }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                {["Name", "Kind", "Type", "Qualified Name"].map(h => (
                  <th key={h} style={{
                    textAlign: "left", padding: "6px 8px", fontSize: 9,
                    color: "var(--text-muted)", textTransform: "uppercase",
                    letterSpacing: "0.05em", fontWeight: 700,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {elements.map(el => (
                <tr
                  key={el.id}
                  onClick={() => onSelectElement(el.id)}
                  style={{ cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                  onMouseOver={e => (e.currentTarget.style.background = "rgba(59,130,246,0.06)")}
                  onMouseOut={e => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "5px 8px", fontWeight: 600, color: kindColor(kindStr(el.kind)) }}>
                    {el.name ?? "<unnamed>"}
                  </td>
                  <td style={{ padding: "5px 8px", color: "var(--text-muted)", fontSize: 10 }}>
                    {kindStr(el.kind).replace(/_/g, " ")}
                  </td>
                  <td style={{ padding: "5px 8px", color: "var(--text-secondary)", fontSize: 10 }}>
                    {el.type_ref ?? "-"}
                  </td>
                  <td style={{ padding: "5px 8px", color: "var(--text-muted)", fontSize: 9, opacity: 0.7 }}>
                    {el.qualified_name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* List rendering */}
      {renderMode === "list" && elements.length > 0 && (
        <div style={{ flex: 1, overflow: "auto", padding: "4px 10px" }}>
          {elements.map(el => (
            <div
              key={el.id}
              onClick={() => onSelectElement(el.id)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 8px", borderRadius: 4, cursor: "pointer",
                borderBottom: "1px solid var(--border)",
              }}
              onMouseOver={e => (e.currentTarget.style.background = "rgba(59,130,246,0.06)")}
              onMouseOut={e => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{
                width: 6, height: 6, borderRadius: 3,
                background: kindColor(kindStr(el.kind)), flexShrink: 0,
              }} />
              <span style={{ ...mono, fontWeight: 600, color: kindColor(kindStr(el.kind)) }}>
                {el.name ?? "<unnamed>"}
              </span>
              <span style={{ ...mono, fontSize: 9, color: "var(--text-muted)" }}>
                {kindStr(el.kind).replace(/_/g, " ")}
              </span>
              {el.type_ref && (
                <span style={{ ...mono, fontSize: 9, color: "var(--text-secondary)", marginLeft: "auto" }}>
                  : {el.type_ref}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Interconnection diagram rendering — fall back to list if no nodes */}
      {renderMode === "diagram" && (!diagramLayout || diagramLayout.nodes.length === 0) && elements.length > 0 && (
        <div style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 10 }}>
            No diagram nodes generated. Showing element list:
          </div>
          {elements.map(el => (
            <div key={el.id} style={{
              padding: "6px 10px", marginBottom: 4, borderRadius: 6,
              background: "var(--bg-primary)", border: "1px solid var(--border)",
              fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-secondary)",
            }}>
              <span style={{ color: "var(--text-muted)", fontSize: 9, marginRight: 6 }}>
                {typeof el.kind === "string" ? el.kind.replace(/_/g, " ") : ""}
              </span>
              {el.name ?? "<unnamed>"}
              {el.type_ref && <span style={{ color: "var(--text-muted)" }}> : {el.type_ref}</span>}
            </div>
          ))}
        </div>
      )}
      {renderMode === "diagram" && diagramLayout && diagramLayout.nodes.length > 0 && (
        <div
          ref={dContainerRef}
          style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 400, touchAction: "none" }}
        >
          <div style={{
            position: "absolute", inset: 0, opacity: 0.15,
            backgroundImage: "radial-gradient(circle, #334155 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }} />
          <div style={{
            position: "absolute", top: 8, right: 8, display: "flex",
            flexDirection: "column", gap: 4, zIndex: 10,
          }}>
            {[
              { label: "+", action: () => setDZoom(z => Math.min(z + 0.15, 2.5)) },
              { label: "−", action: () => setDZoom(z => Math.max(z - 0.15, 0.2)) },
              { label: "FIT", action: () => {
                if (!diagramLayout || !dContainerRef.current) return;
                const rect = dContainerRef.current.getBoundingClientRect();
                const [bx0, by0, bx1, by1] = diagramLayout.bounds;
                const dw = bx1 - bx0; const dh = by1 - by0;
                if (dw <= 0 || dh <= 0) return;
                const pad = 40;
                const fz = Math.min((rect.width - pad * 2) / dw, (rect.height - pad * 2) / dh, 2.0);
                setDZoom(fz);
                setDPan({ x: (rect.width - dw * fz) / 2 - bx0 * fz, y: (rect.height - dh * fz) / 2 - by0 * fz });
              }},
            ].map(btn => (
              <button key={btn.label} onClick={btn.action} style={{
                width: 30, height: 30, borderRadius: 6, border: "1px solid var(--border)",
                background: "var(--bg-tertiary)", color: "var(--text-secondary)",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: btn.label === "FIT" ? 9 : 16, fontWeight: 700, fontFamily: "var(--font-mono)",
              }}>{btn.label}</button>
            ))}
          </div>
          <svg
            ref={dSvgRef}
            width="100%" height="100%"
            style={{ cursor: dDragging ? "grabbing" : "grab", touchAction: "none" }}
            onPointerDown={(e) => {
              if (e.pointerType === "touch") return;
              setDDragging(true);
              dLastPos.current = { x: e.clientX, y: e.clientY };
              (e.target as Element).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (e.pointerType === "touch") return;
              if (dLastPos.current) {
                setDPan(p => ({ x: p.x + e.clientX - dLastPos.current!.x, y: p.y + e.clientY - dLastPos.current!.y }));
                dLastPos.current = { x: e.clientX, y: e.clientY };
              }
            }}
            onPointerUp={(e) => {
              if (e.pointerType === "touch") return;
              setDDragging(false);
              dLastPos.current = null;
              (e.target as Element).releasePointerCapture?.(e.pointerId);
            }}
            onWheel={(e) => {
              e.preventDefault();
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const cx = rect.width / 2;
              const cy = rect.height / 2;
              const factor = e.deltaY > 0 ? 0.9 : 1.1;
              const oldZ = dZoomRef.current;
              const newZ = Math.min(Math.max(oldZ * factor, 0.2), 2.5);
              const ratio = newZ / oldZ;
              setDZoom(newZ);
              setDPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }));
            }}
          >
            <defs>
              <marker id="cv-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#475569" />
              </marker>
              <marker id="cv-diamond" markerWidth="12" markerHeight="8" refX="0" refY="4" orient="auto">
                <polygon points="0 4, 6 0, 12 4, 6 8" fill="#475569" stroke="#475569" strokeWidth="1" />
              </marker>
            </defs>
            <g transform={`translate(${dPan.x}, ${dPan.y}) scale(${dZoom})`}>
              {/* Edges */}
              {diagramLayout.edges.map((edge, i) => {
                if (edge.points.length < 2) return null;
                const d = edge.points.map((pt, j) => `${j === 0 ? "M" : "L"} ${pt[0]} ${pt[1]}`).join(" ");
                const midA = edge.points[Math.floor((edge.points.length - 1) / 2)];
                const midB = edge.points[Math.ceil((edge.points.length - 1) / 2)];
                const lx = (midA[0] + midB[0]) / 2;
                const ly = (midA[1] + midB[1]) / 2;
                const isComp = edge.edge_type === "composition";
                const isDashed = edge.edge_type === "satisfy" || edge.edge_type === "verify" || edge.edge_type === "specialization";
                return (
                  <g key={`cv-edge-${i}`}>
                    <path d={d} stroke="#475569" strokeWidth={1.5} fill="none"
                      strokeDasharray={isDashed ? "6 3" : undefined}
                      markerEnd={isComp ? undefined : "url(#cv-arrow)"}
                      markerStart={isComp ? "url(#cv-diamond)" : undefined}
                    />
                    {edge.label && (
                      <text x={lx} y={ly - 6} fill="var(--text-muted)" fontSize="9"
                        fontFamily="var(--font-mono)" textAnchor="middle">
                        {edge.edge_type === "satisfy" || edge.edge_type === "verify"
                          ? `\u00AB${edge.edge_type}\u00BB` : edge.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* Nodes */}
              {diagramLayout.nodes.map(node => {
                const comps = node.compartments ?? [];
                return (
                  <g key={`cv-node-${node.element_id}`}
                    onClick={() => onSelectElement(node.element_id)}
                    style={{ cursor: "pointer" }}
                  >
                    <rect x={node.x} y={node.y} width={node.width} height={node.height}
                      rx={6} ry={6} fill="var(--bg-tertiary)"
                      stroke={node.color + "88"} strokeWidth={1.5} />
                    <rect x={node.x} y={node.y} width={node.width} height={4}
                      rx={2} fill={node.color} opacity={0.8} />
                    {node.stereotype && (
                      <text x={node.x + node.width / 2} y={node.y + 16}
                        fill={node.color} fontSize="8" fontWeight={700}
                        fontFamily="var(--font-mono)" textAnchor="middle"
                        letterSpacing="0.08em">{node.stereotype}</text>
                    )}
                    <text x={node.x + node.width / 2} y={node.y + (node.stereotype ? 30 : 20)}
                      fill="var(--text-secondary)" fontSize="11" fontWeight={600}
                      fontFamily="var(--font-mono)" textAnchor="middle">{node.label}</text>
                    {comps.length > 0 && (() => {
                      let cy = node.y + 38;
                      return comps.map((comp, ci) => {
                        const startY = cy;
                        cy += 16 + comp.entries.length * 14;
                        return (
                          <g key={ci}>
                            <line x1={node.x} y1={startY - 2} x2={node.x + node.width} y2={startY - 2}
                              stroke={node.color + "44"} strokeWidth={0.5} />
                            <text x={node.x + 8} y={startY + 10}
                              fill={node.color} fontSize="8" fontWeight={700}
                              fontFamily="var(--font-mono)" letterSpacing="0.05em">{comp.heading}</text>
                            {comp.entries.map((entry, ei) => (
                              <text key={ei} x={node.x + 10} y={startY + 10 + 14 * (ei + 1)}
                                fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-mono)">{entry}</text>
                            ))}
                          </g>
                        );
                      });
                    })()}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}

function ViewTreeNode({ element, depth, childMap, kindColor, mono, onSelect, onNavigate }: {
  element: SysmlElement;
  depth: number;
  childMap: Map<number, SysmlElement[]>;
  kindColor: (kind: string) => string;
  mono: React.CSSProperties;
  onSelect: (id: number) => void;
  onNavigate: (line?: number) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 3);
  const children = childMap.get(element.id) ?? [];
  const hasChildren = children.length > 0;
  const k = typeof element.kind === "string" ? element.kind : element.kind.other;

  return (
    <div>
      <div
        onClick={() => hasChildren ? setExpanded(!expanded) : onSelect(element.id)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "3px 6px", marginLeft: depth * 16, borderRadius: 4,
          cursor: "pointer",
        }}
        onMouseOver={e => (e.currentTarget.style.background = "rgba(59,130,246,0.06)")}
        onMouseOut={e => (e.currentTarget.style.background = "transparent")}
      >
        {hasChildren ? (
          <span style={{ ...mono, color: "var(--text-muted)", width: 12, flexShrink: 0, userSelect: "none" }}>
            {expanded ? "▾" : "▸"}
          </span>
        ) : (
          <span style={{ width: 12, flexShrink: 0, display: "flex", justifyContent: "center" }}>
            <span style={{ width: 4, height: 4, borderRadius: 2, background: kindColor(k) }} />
          </span>
        )}
        <span style={{ ...mono, fontWeight: 600, color: kindColor(k) }}>
          {element.name ?? "<unnamed>"}
        </span>
        <span style={{ ...mono, fontSize: 9, color: "var(--text-muted)" }}>
          {k.replace(/_/g, " ")}
        </span>
        {element.type_ref && (
          <span style={{ ...mono, fontSize: 9, color: "var(--text-secondary)" }}>: {element.type_ref}</span>
        )}
      </div>
      {expanded && children.map(child => (
        <ViewTreeNode
          key={child.id} element={child} depth={depth + 1} childMap={childMap}
          kindColor={kindColor} mono={mono} onSelect={onSelect} onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
