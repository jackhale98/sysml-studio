import React, { useRef, useCallback, useEffect, useMemo, useState } from "react";
import { EditorView as CMEditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { useModelStore } from "../../stores/model-store";
import { useUIStore } from "../../stores/ui-store";
import {
  sysmlBrowserHighlighting,
} from "./sysml-language";
import { ImportDialog } from "./ImportDialog";

// ─── CodeMirror Theme ───

const darkTheme = CMEditorView.theme({
  "&": {
    backgroundColor: "var(--bg-primary)",
    color: "#94a3b8",
    height: "100%",
    fontSize: "13px",
    fontFamily: "var(--font-mono)",
  },
  ".cm-content": { caretColor: "#60a5fa", padding: "12px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#60a5fa", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(59,130,246,0.25)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-secondary)",
    color: "#334155",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLineGutter": { backgroundColor: "rgba(59,130,246,0.08)", color: "#64748b" },
  ".cm-activeLine": { backgroundColor: "rgba(59,130,246,0.06)" },
  ".cm-foldGutter .cm-gutterElement": { color: "#475569", padding: "0 4px" },
  ".cm-matchingBracket": { backgroundColor: "rgba(59,130,246,0.2)", outline: "1px solid rgba(59,130,246,0.4)" },
  ".cm-selectionMatch": { backgroundColor: "rgba(59,130,246,0.12)" },
  ".cm-searchMatch": { backgroundColor: "rgba(251,191,36,0.2)", outline: "1px solid rgba(251,191,36,0.4)" },
  // Lint gutter icons
  ".cm-lint-marker-error": { content: '"●"', color: "#ef4444" },
  ".cm-lint-marker-warning": { content: '"●"', color: "#fbbf24" },
  // Highlighted scroll target line
  ".cm-highlight-line": { backgroundColor: "rgba(59,130,246,0.15)", transition: "background 0.3s" },
}, { dark: true });

const lightTheme = CMEditorView.theme({
  "&": {
    backgroundColor: "var(--bg-primary)",
    color: "#334155",
    height: "100%",
    fontSize: "13px",
    fontFamily: "var(--font-mono)",
  },
  ".cm-content": { caretColor: "#2563eb", padding: "12px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#2563eb", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(37,99,235,0.15)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-secondary)",
    color: "#94a3b8",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLineGutter": { backgroundColor: "rgba(37,99,235,0.06)", color: "#64748b" },
  ".cm-activeLine": { backgroundColor: "rgba(37,99,235,0.04)" },
  ".cm-foldGutter .cm-gutterElement": { color: "#94a3b8", padding: "0 4px" },
  ".cm-matchingBracket": { backgroundColor: "rgba(37,99,235,0.15)", outline: "1px solid rgba(37,99,235,0.3)" },
  ".cm-selectionMatch": { backgroundColor: "rgba(37,99,235,0.08)" },
  ".cm-searchMatch": { backgroundColor: "rgba(245,158,11,0.15)", outline: "1px solid rgba(245,158,11,0.3)" },
  ".cm-highlight-line": { backgroundColor: "rgba(37,99,235,0.1)", transition: "background 0.3s" },
}, { dark: false });

// ─── Snippet Toolbar Items ───

const SNIPPETS = [
  { label: "part def", text: "part def NewPart {\n  \n}" },
  { label: "part", text: "part newPart : PartType;" },
  { label: "attribute", text: "attribute name : String;" },
  { label: "port", text: "port portName : PortType;" },
  { label: "action", text: "action def NewAction {\n  \n}" },
  { label: "state", text: "state def NewState {\n  \n}" },
  { label: "requirement", text: 'requirement def NewReq {\n  doc /* Description */\n}' },
  { label: "enum", text: "enum def Status {\n  enum active;\n  enum inactive;\n}" },
] as const;

// ─── Editor Component ───

export function EditorView() {
  const source = useModelStore((s) => s.source);
  const updateSource = useModelStore((s) => s.updateSource);
  const model = useModelStore((s) => s.model);
  const openFiles = useModelStore((s) => s.openFiles);
  const scrollToLine = useUIStore((s) => s.scrollToLine);
  const clearScrollToLine = useUIStore((s) => s.clearScrollToLine);
  const theme = useUIStore((s) => s.theme);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const hasOtherFiles = Object.keys(openFiles).length > 1;

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<CMEditorView | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const themeCompartment = useRef(new Compartment());
  // Track if source is being updated from outside (store → editor sync)
  const externalUpdateRef = useRef(false);

  // Use StreamLanguage highlighting for both Tauri and browser modes
  const highlightExtension = useMemo(() => sysmlBrowserHighlighting(), []);

  // Initialize CodeMirror
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = CMEditorView.updateListener.of((update: import("@codemirror/view").ViewUpdate) => {
      if (update.docChanged && !externalUpdateRef.current) {
        const newSource = update.state.doc.toString();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          updateSource(newSource);
        }, 400);
      }
    });

    const isDark = theme === "dark";
    const state = EditorState.create({
      doc: source,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        foldGutter(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        lintGutter(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...closeBracketsKeymap,
          ...foldKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        highlightExtension,
        themeCompartment.current.of(isDark ? darkTheme : lightTheme),
        updateListener,
        CMEditorView.lineWrapping,
        EditorState.tabSize.of(2),
      ],
    });

    const view = new CMEditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync theme changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const isDark = theme === "dark";
    view.dispatch({
      effects: themeCompartment.current.reconfigure(isDark ? darkTheme : lightTheme),
    });
  }, [theme]);

  // Sync source from store → editor (when source changes externally, e.g. file open)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== source) {
      externalUpdateRef.current = true;
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: source },
      });
      externalUpdateRef.current = false;
    }
  }, [source]);

  // Sync parse errors as CodeMirror diagnostics
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !model) return;

    const diagnostics: Diagnostic[] = [];
    for (const err of model.errors) {
      const from = err.span.start_byte;
      const to = Math.max(err.span.end_byte, from + 1);
      const docLen = view.state.doc.length;
      if (from >= docLen) continue;
      diagnostics.push({
        from: Math.min(from, docLen),
        to: Math.min(to, docLen),
        severity: "error",
        message: err.message,
      });
    }

    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [model]);

  // Scroll to line when navigated from browser/diagram
  useEffect(() => {
    const view = viewRef.current;
    if (view && scrollToLine !== null) {
      const line = Math.min(scrollToLine + 1, view.state.doc.lines);
      const lineInfo = view.state.doc.line(line);

      view.dispatch({
        selection: { anchor: lineInfo.from },
        scrollIntoView: true,
      });

      view.focus();

      clearScrollToLine();
    }
  }, [scrollToLine, clearScrollToLine]);

  // Insert snippet at cursor
  const insertSnippet = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view) return;
    const cursor = view.state.selection.main.head;
    // Determine indentation from current line
    const line = view.state.doc.lineAt(cursor);
    const indent = line.text.match(/^\s*/)?.[0] ?? "";
    const indented = text.split("\n").map((l, i) => i === 0 ? l : indent + l).join("\n");

    view.dispatch({
      changes: { from: cursor, insert: indented },
      selection: { anchor: cursor + indented.length },
    });
    view.focus();
  }, []);

  const lines = viewRef.current?.state.doc.lines ?? source.split("\n").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Snippet toolbar */}
      <div style={{
        display: "flex", gap: 4, padding: "8px 14px",
        background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)",
        overflowX: "auto", flexShrink: 0,
      }}>
        {SNIPPETS.map((snippet) => (
          <button
            key={snippet.label}
            onClick={() => insertSnippet(snippet.text)}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
              fontFamily: "var(--font-mono)", border: "1px solid var(--border)",
              background: "var(--bg-tertiary)", color: "var(--text-secondary)",
              cursor: "pointer", whiteSpace: "nowrap", minHeight: 30,
            }}
          >
            {snippet.label}
          </button>
        ))}
        <button
          onClick={() => setShowImportDialog(true)}
          style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            fontFamily: "var(--font-mono)", border: "1px solid var(--accent)",
            background: hasOtherFiles ? "rgba(59,130,246,0.1)" : "var(--bg-tertiary)",
            color: "var(--accent)",
            cursor: "pointer", whiteSpace: "nowrap", minHeight: 30,
          }}
        >
          + import
        </button>
      </div>

      {/* CodeMirror container */}
      <div ref={containerRef} style={{ flex: 1, overflow: "hidden" }} />

      {/* Status bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", padding: "4px 14px",
        background: "var(--bg-secondary)", borderTop: "1px solid var(--border)",
        fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
        flexShrink: 0,
      }}>
        <span>{lines} lines</span>
        <span>{model?.stats.errors ?? 0} errors</span>
        <span>{model?.stats.parse_time_ms !== undefined ? `${model.stats.parse_time_ms.toFixed(1)}ms` : ""}</span>
        <span>SysML v2</span>
      </div>

      {showImportDialog && <ImportDialog onClose={() => setShowImportDialog(false)} />}
    </div>
  );
}
