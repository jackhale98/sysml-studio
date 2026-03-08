import React, { useState, useRef, useCallback, useEffect } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useModelStore } from "../../stores/model-store";
import { computeBddLayout, computeStmLayout, computeReqLayout, computeUcdLayout, computeIbdLayout } from "../../lib/tauri-bridge";
import type { DiagramLayout, DiagramNode } from "../../lib/element-types";

export function DiagramView() {
  const diagramType = useUIStore((s) => s.diagramType);
  const setDiagramType = useUIStore((s) => s.setDiagramType);
  const highlightedNodeId = useUIStore((s) => s.highlightedNodeId);
  const setHighlightedNode = useUIStore((s) => s.setHighlightedNode);
  const openDialog = useUIStore((s) => s.openDialog);
  const navigateToEditor = useUIStore((s) => s.navigateToEditor);
  const model = useModelStore((s) => s.model);

  const [layout, setLayout] = useState<DiagramLayout | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const lastPinchDist = useRef<number | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Fetch layout when model or diagram type changes
  useEffect(() => {
    if (!model) return;
    const fetchLayout = async () => {
      try {
        switch (diagramType) {
          case "bdd":
            setLayout(await computeBddLayout());
            break;
          case "stm": {
            const stateDef = model.elements.find(
              (e) => typeof e.kind === "string" && e.kind === "state_def"
            );
            if (stateDef?.name) setLayout(await computeStmLayout(stateDef.name));
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
            setLayout(await computeIbdLayout());
            break;
        }
      } catch {
        setLayout(null);
      }
    };
    fetchLayout();
  }, [model, diagramType]);

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
      if (n.kind === "block_container") continue;
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
        setZoom((z) => Math.min(Math.max(z * scale, 0.2), 2.5));
        lastPinchDist.current = dist;
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (lastPos.current) {
          const dx = mx - lastPos.current.x;
          const dy = my - lastPos.current.y;
          setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        }
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

  // Mouse/pointer pan (desktop)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return; // handled by native touch listeners
    setDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (dragging && lastPos.current) {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  }, [dragging]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    setDragging(false);
    lastPos.current = null;
  }, []);

  // If highlightedNodeId doesn't match any node in current layout, treat as null
  // so we don't dim all nodes when navigating to a non-existent diagram node
  const effectiveHl = highlightedNodeId && layout?.nodes.some(n => n.label === highlightedNodeId)
    ? highlightedNodeId
    : null;

  return (
    <>
      {/* Diagram type toggle */}
      <div style={{
        display: "flex", gap: 5, padding: "8px 10px",
        background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)",
        overflowX: "auto", WebkitOverflowScrolling: "touch",
      }}>
        {([
          ["bdd", "BDD"],
          ["stm", "STM"],
          ["req", "REQ"],
          ["ucd", "UCD"],
          ["ibd", "IBD"],
        ] as const).map(([type, label]) => (
          <button
            key={type}
            onClick={() => setDiagramType(type)}
            style={{
              padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600,
              fontFamily: "var(--font-mono)", cursor: "pointer", whiteSpace: "nowrap",
              border: diagramType === type ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
              background: diagramType === type ? "rgba(59,130,246,0.13)" : "var(--bg-tertiary)",
              color: diagramType === type ? "var(--accent-hover)" : "var(--text-muted)",
              transition: "all 0.15s", minHeight: 36, flexShrink: 0,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div ref={canvasRef} style={{ flex: 1, position: "relative", overflow: "hidden", background: "var(--bg-primary)", touchAction: "none" }}>
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
            { label: "+", action: () => setZoom((z) => Math.min(z + 0.15, 2.5)) },
            { label: "−", action: () => setZoom((z) => Math.max(z - 0.15, 0.2)) },
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
                    {/* Head */}
                    <circle cx={cx} cy={topY + 10} r={10}
                      fill="none" stroke={isHl ? "#60a5fa" : "#94a3b8"} strokeWidth={2} />
                    {/* Body */}
                    <line x1={cx} y1={topY + 20} x2={cx} y2={topY + 45}
                      stroke={isHl ? "#60a5fa" : "#94a3b8"} strokeWidth={2} />
                    {/* Arms */}
                    <line x1={cx - 18} y1={topY + 30} x2={cx + 18} y2={topY + 30}
                      stroke={isHl ? "#60a5fa" : "#94a3b8"} strokeWidth={2} />
                    {/* Legs */}
                    <line x1={cx} y1={topY + 45} x2={cx - 14} y2={topY + 62}
                      stroke={isHl ? "#60a5fa" : "#94a3b8"} strokeWidth={2} />
                    <line x1={cx} y1={topY + 45} x2={cx + 14} y2={topY + 62}
                      stroke={isHl ? "#60a5fa" : "#94a3b8"} strokeWidth={2} />
                    {/* Name */}
                    <text x={cx} y={node.y + node.height - 2}
                      fill={isHl ? "var(--text-primary)" : "var(--text-secondary)"} fontSize="11"
                      fontWeight={600} fontFamily="var(--font-mono)"
                      textAnchor="middle">{node.label}</text>
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
                      fontFamily="var(--font-mono)">{node.label}</text>
                  </g>
                );
              }

              // Requirement: rectangle with req stereotype and doc
              if (kind === "requirement") {
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
                    <text x={node.x + node.width / 2} y={node.y + 16}
                      fill={node.color} fontSize="8" fontWeight={700}
                      fontFamily="var(--font-mono)" textAnchor="middle"
                      letterSpacing="0.08em">
                      {"\u00AB"}requirement{"\u00BB"}
                    </text>
                    <text x={node.x + node.width / 2} y={node.y + node.height / 2 + 6}
                      fill={isHl ? "var(--text-primary)" : "var(--text-secondary)"} fontSize="12"
                      fontWeight={600} fontFamily="var(--font-mono)"
                      textAnchor="middle">{node.label}</text>
                  </g>
                );
              }

              // Default: block/part rectangle (BDD, STM, IBD parts)
              const isState = kind === "state";
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
                    rx={isState ? node.height / 2 : 6}
                    ry={isState ? node.height / 2 : 6}
                    fill={isHl ? node.color + "33" : "var(--bg-tertiary)"}
                    stroke={isHl ? node.color : node.color + "88"}
                    strokeWidth={isHl ? 2.5 : 1.5}
                  />
                  {!isState && (
                    <rect
                      x={node.x} y={node.y} width={node.width} height={4}
                      rx={2} fill={node.color} opacity={0.8}
                    />
                  )}
                  {!isState && kind !== "part" && (
                    <text
                      x={node.x + node.width / 2} y={node.y + 18}
                      fill={node.color} fontSize="8" fontWeight={700}
                      fontFamily="var(--font-mono)" textAnchor="middle"
                      letterSpacing="0.08em"
                    >
                      {"\u00AB"}block{"\u00BB"}
                    </text>
                  )}
                  <text
                    x={node.x + node.width / 2}
                    y={isState ? node.y + node.height / 2 : node.y + node.height / 2 + 8}
                    fill={isHl ? "var(--text-primary)" : "var(--text-secondary)"}
                    fontSize={isState ? 12 : 11}
                    fontWeight={600} fontFamily="var(--font-mono)"
                    textAnchor="middle" dominantBaseline="middle"
                  >
                    {node.label}
                  </text>
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

        return (
          <div style={{
            padding: "10px 12px", background: "var(--bg-tertiary)",
            borderTop: "1.5px solid var(--accent)",
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

            {/* Action buttons */}
            {hlElement && (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => navigateToEditor(hlElement.span.start_line)}
                  style={{
                    flex: 1, padding: 8, borderRadius: 8,
                    border: "1.5px solid var(--accent)",
                    background: "rgba(59,130,246,0.1)", color: "var(--accent-hover)",
                    fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)",
                    cursor: "pointer", minHeight: 38,
                  }}
                >
                  Source
                </button>
                <button
                  onClick={() => openDialog("edit", hlElement.id)}
                  style={{
                    flex: 1, padding: 8, borderRadius: 8,
                    border: "1.5px solid #f59e0b",
                    background: "rgba(245,158,11,0.1)", color: "#fbbf24",
                    fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)",
                    cursor: "pointer", minHeight: 38,
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => openDialog("delete", hlElement.id)}
                  style={{
                    flex: 1, padding: 8, borderRadius: 8,
                    border: "1.5px solid var(--error)",
                    background: "rgba(239,68,68,0.1)", color: "#f87171",
                    fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)",
                    cursor: "pointer", minHeight: 38,
                  }}
                >
                  Delete
                </button>
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
                      suggestedParentId: hlElement.id,
                    });
                  }}
                  style={{
                    flex: 1, padding: 8, borderRadius: 8,
                    border: "1.5px solid var(--success)",
                    background: "rgba(22,163,74,0.1)", color: "var(--success)",
                    fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)",
                    cursor: "pointer", minHeight: 38,
                  }}
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
