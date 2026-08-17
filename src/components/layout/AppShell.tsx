import React, { useRef } from "react";
import { Header } from "./Header";
import { TabBar } from "./TabBar";
import { ElementBrowser } from "../browser/ElementBrowser";
import { DiagramView } from "../diagram/DiagramView";
import { EditorView } from "../editor/EditorView";
import { MbseDashboard } from "../mbse/MbseDashboard";
import { AnalysisView } from "../analysis/AnalysisView";
import { ElementDetail } from "../browser/ElementDetail";
import { CreateElementDialog } from "../dialogs/CreateElementDialog";
import { EditElementDialog } from "../dialogs/EditElementDialog";
import { DeleteConfirmDialog } from "../dialogs/DeleteConfirmDialog";
import { useUIStore } from "../../stores/ui-store";
import { useModelStore } from "../../stores/model-store";
import { pickFile, readBrowserFile } from "../../lib/tauri-bridge";
import { SAMPLE_SOURCE } from "../../App";

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function WelcomeScreen() {
  const loadSource = useModelStore((s) => s.loadSource);
  const loadFile = useModelStore((s) => s.loadFile);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleOpen() {
    if (!isMobile) {
      const path = await pickFile();
      if (path) await loadFile(path);
    } else {
      fileInputRef.current?.click();
    }
  }

  async function handleMobileFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const source = await readBrowserFile(file);
    await loadSource(source, file.name);
    e.target.value = "";
  }

  const btnStyle: React.CSSProperties = {
    padding: "12px 28px", borderRadius: 10, border: "none",
    fontSize: 14, fontWeight: 600, cursor: "pointer",
    fontFamily: "var(--font-mono)",
  };

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 20, padding: 32,
    }}>
      <input ref={fileInputRef} type="file" accept=".sysml,.sysml2,.txt"
        style={{ display: "none" }} onChange={handleMobileFile} />

      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1" opacity="0.3">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="18" x2="12" y2="12" />
        <line x1="9" y1="15" x2="15" y2="15" />
      </svg>

      <div style={{ textAlign: "center" }}>
        <h2 style={{ margin: "0 0 6px", color: "var(--text-primary)", fontWeight: 600, fontSize: 20 }}>
          No Model Loaded
        </h2>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13, maxWidth: 260, lineHeight: 1.5 }}>
          Open a SysML file or create a new model to get started
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <button onClick={handleOpen} style={{
          ...btnStyle, background: "var(--accent)", color: "#fff",
        }}>
          Open File
        </button>
        <button onClick={() => loadSource("package NewModel {\n  \n}\n")} style={{
          ...btnStyle, background: "var(--bg-tertiary)", color: "var(--text-primary)",
          border: "1px solid var(--border)",
        }}>
          New Model
        </button>
      </div>
      <button onClick={() => loadSource(SAMPLE_SOURCE, "VehicleSystem.sysml")} style={{
        ...btnStyle, padding: "8px 20px", fontSize: 12,
        background: "none", color: "var(--text-muted)",
        border: "1px solid var(--border)",
      }}>
        Load Example (Vehicle System)
      </button>
    </div>
  );
}

export function AppShell() {
  const activeTab = useUIStore((s) => s.activeTab);
  const showDetailSheet = useUIStore((s) => s.showDetailSheet);
  const activeDialog = useUIStore((s) => s.activeDialog);
  const openDialog = useUIStore((s) => s.openDialog);
  const highlightedNodeId = useUIStore((s) => s.highlightedNodeId);
  const model = useModelStore((s) => s.model);
  const hasFiles = Object.keys(useModelStore((s) => s.openFiles)).length > 0;
  const error = useModelStore((s) => s.error);
  const clearError = useModelStore((s) => s.clearError);
  const undo = useModelStore((s) => s.undo);
  const redo = useModelStore((s) => s.redo);
  const saveCurrentFile = useModelStore((s) => s.saveCurrentFile);

  // App-level shortcuts. Structural edits (dialogs) are undoable
  // through the store; CodeMirror keeps its own history for typing.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const inEditor = (e.target as HTMLElement | null)?.closest?.(".cm-editor");
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void saveCurrentFile();
      } else if (key === "z" && !inEditor) {
        e.preventDefault();
        if (e.shiftKey) void redo();
        else void undo();
      } else if (key === "y" && !inEditor) {
        e.preventDefault();
        void redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, saveCurrentFile]);

  return (
    <div style={{
      width: "100%", height: "100dvh",
      display: "flex", flexDirection: "column", background: "var(--bg-primary)",
      position: "relative", overflow: "hidden",
    }}>
      <Header />

      {/* Failures were previously only an 8px dot with a tooltip — which
          does not exist on touch. A failed open, save, or parse must be
          readable. */}
      {error && (
        <div
          role="alert"
          style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            margin: "8px 12px 0", padding: "8px 10px", borderRadius: 8,
            border: "1px solid var(--error)", background: "rgba(239,68,68,0.12)",
            color: "var(--error)", fontFamily: "var(--font-mono)", fontSize: 11,
            lineHeight: 1.5, flexShrink: 0,
          }}
        >
          <span style={{ flex: 1, wordBreak: "break-word" }}>{error}</span>
          <button
            onClick={clearError}
            aria-label="Dismiss error"
            style={{
              background: "none", border: "none", color: "var(--error)",
              fontSize: 16, lineHeight: 1, cursor: "pointer", padding: "0 4px",
              minHeight: "auto",
            }}
          >
            ×
          </button>
        </div>
      )}

      {!hasFiles ? (
        <WelcomeScreen />
      ) : (
        <>
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {activeTab === "browser" && <ElementBrowser />}
            {activeTab === "diagram" && <DiagramView />}
            {/* Always mounted: unmounting destroyed CodeMirror's undo
                history, scroll position, and folds on every tab switch. */}
            <div style={{
              display: activeTab === "editor" ? "flex" : "none",
              flexDirection: "column", flex: 1, minHeight: 0,
            }}>
              <EditorView />
            </div>
            {activeTab === "mbse" && <MbseDashboard />}
            {activeTab === "analysis" && <AnalysisView />}
          </div>

          {showDetailSheet && <ElementDetail />}

          {/* Floating create button — hidden when diagram element is selected (action bar has its own + Add) */}
          {!activeDialog && !showDetailSheet && !(activeTab === "diagram" && highlightedNodeId) && (
            <button
              onClick={() => {
                if (activeTab === "diagram") {
                  const diagramType = useUIStore.getState().diagramType;
                  const kindMap: Record<string, { kind: string; cat: number }> = {
                    bdd: { kind: "part_def", cat: 0 },
                    stm: { kind: "state_usage", cat: 1 },
                    req: { kind: "requirement_def", cat: 2 },
                    ucd: { kind: "use_case_def", cat: 1 },
                    ibd: { kind: "part_usage", cat: 0 },
                  };
                  const ctx = kindMap[diagramType] ?? { kind: "part_def", cat: 0 };
                  openDialog("create", undefined, { suggestedKind: ctx.kind, suggestedCategory: ctx.cat });
                } else {
                  openDialog("create");
                }
              }}
              style={{
                position: "absolute", bottom: "calc(env(safe-area-inset-bottom, 8px) + 68px)", right: 16, width: 48, height: 48,
                borderRadius: "50%", border: "none", background: "var(--accent)",
                color: "#fff", fontSize: 24, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 4px 16px rgba(59,130,246,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center",
                zIndex: 15,
              }}
            >
              +
            </button>
          )}

          {/* Dialogs */}
          {activeDialog === "create" && <CreateElementDialog />}
          {activeDialog === "edit" && <EditElementDialog />}
          {activeDialog === "delete" && <DeleteConfirmDialog />}

          <TabBar />
        </>
      )}
    </div>
  );
}
