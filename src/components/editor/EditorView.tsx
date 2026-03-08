import React, { useRef, useCallback, useEffect, useState } from "react";
import { useModelStore } from "../../stores/model-store";
import { useUIStore } from "../../stores/ui-store";
import { SYSML_KEYWORDS } from "../../lib/constants";

export function EditorView() {
  const source = useModelStore((s) => s.source);
  const updateSource = useModelStore((s) => s.updateSource);
  const model = useModelStore((s) => s.model);
  const scrollToLine = useUIStore((s) => s.scrollToLine);
  const clearScrollToLine = useUIStore((s) => s.clearScrollToLine);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);

  const handleChange = useCallback((newSource: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateSource(newSource);
    }, 300);
  }, [updateSource]);

  // Scroll to target line when navigated from diagram/browser
  useEffect(() => {
    if (scrollToLine !== null && editorContainerRef.current) {
      const lineHeight = 22;
      const targetScroll = Math.max(0, scrollToLine * lineHeight - 100);
      editorContainerRef.current.scrollTop = targetScroll;
      setHighlightedLine(scrollToLine);
      clearScrollToLine();
      // Clear highlight after 2 seconds
      const timer = setTimeout(() => setHighlightedLine(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [scrollToLine, clearScrollToLine]);

  const lines = source.split("\n");

  const highlightLine = (line: string): React.ReactNode[] => {
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    const spans: React.ReactNode[] = [];

    spans.push(<span key="indent" style={{ color: "transparent" }}>{" ".repeat(indent)}</span>);

    if (trimmed.startsWith("//") || trimmed.startsWith("doc")) {
      spans.push(<span key="c" style={{ color: "#4a6741" }}>{trimmed}</span>);
      return spans;
    }

    if (trimmed.startsWith("/*")) {
      spans.push(<span key="c" style={{ color: "#4a6741" }}>{trimmed}</span>);
      return spans;
    }

    const tokens = trimmed.split(/(\s+|[{};:\[\]=<>,.|&+\-*/~@#()!?])/);
    tokens.forEach((tok, j) => {
      if (!tok) return;
      if (SYSML_KEYWORDS.includes(tok)) {
        spans.push(<span key={j} style={{ color: "#c084fc" }}>{tok}</span>);
      } else if (/^\d+(\.\d+)?$/.test(tok)) {
        spans.push(<span key={j} style={{ color: "#fbbf24" }}>{tok}</span>);
      } else if (/^[{};:\[\]=<>,.|&+\-*/~@#()!?]$/.test(tok)) {
        spans.push(<span key={j} style={{ color: "#475569" }}>{tok}</span>);
      } else if (/^[A-Z]/.test(tok)) {
        spans.push(<span key={j} style={{ color: "#38bdf8" }}>{tok}</span>);
      } else if (/^\s+$/.test(tok)) {
        spans.push(<span key={j}>{tok}</span>);
      } else {
        spans.push(<span key={j} style={{ color: "#94a3b8" }}>{tok}</span>);
      }
    });

    return spans;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Editor toolbar */}
      <div style={{
        display: "flex", gap: 4, padding: "8px 14px",
        background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)",
        overflowX: "auto",
      }}>
        {["part def", "attribute", "port", "action", "state", "requirement", "{ }", ": "].map((snippet) => (
          <button
            key={snippet}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
              fontFamily: "var(--font-mono)", border: "1px solid var(--border)",
              background: "var(--bg-tertiary)", color: "var(--text-secondary)",
              cursor: "pointer", whiteSpace: "nowrap", minHeight: 30,
            }}
          >
            {snippet}
          </button>
        ))}
      </div>

      {/* Editor content */}
      <div ref={editorContainerRef} style={{ flex: 1, overflow: "auto", background: "var(--bg-primary)", padding: "12px 0" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: "22px" }}>
          {lines.map((line, i) => {
            const hasError = model?.errors.some(
              (e) => e.span.start_line <= i && e.span.end_line >= i
            );
            return (
              <div
                key={i}
                style={{
                  display: "flex", minHeight: 22,
                  background: highlightedLine === i
                    ? "rgba(59,130,246,0.15)"
                    : hasError ? "rgba(239,68,68,0.08)" : "transparent",
                  transition: "background 0.3s",
                }}
              >
                <span style={{
                  display: "inline-block", width: 44, textAlign: "right", paddingRight: 12,
                  color: hasError ? "#ef4444" : "#334155", fontSize: 11,
                  userSelect: "none", flexShrink: 0,
                }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1, whiteSpace: "pre" }}>
                  {highlightLine(line)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", padding: "4px 14px",
        background: "var(--bg-secondary)", borderTop: "1px solid var(--border)",
        fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
      }}>
        <span>{lines.length} lines</span>
        <span>{model?.stats.errors ?? 0} errors</span>
        <span>SysML v2</span>
      </div>
    </div>
  );
}
