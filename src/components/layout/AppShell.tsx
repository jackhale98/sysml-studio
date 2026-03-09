import React from "react";
import { Header } from "./Header";
import { TabBar } from "./TabBar";
import { ElementBrowser } from "../browser/ElementBrowser";
import { DiagramView } from "../diagram/DiagramView";
import { EditorView } from "../editor/EditorView";
import { MbseDashboard } from "../mbse/MbseDashboard";
import { ElementDetail } from "../browser/ElementDetail";
import { CreateElementDialog } from "../dialogs/CreateElementDialog";
import { EditElementDialog } from "../dialogs/EditElementDialog";
import { DeleteConfirmDialog } from "../dialogs/DeleteConfirmDialog";
import { useUIStore } from "../../stores/ui-store";

export function AppShell() {
  const activeTab = useUIStore((s) => s.activeTab);
  const showDetailSheet = useUIStore((s) => s.showDetailSheet);
  const activeDialog = useUIStore((s) => s.activeDialog);
  const openDialog = useUIStore((s) => s.openDialog);
  const highlightedNodeId = useUIStore((s) => s.highlightedNodeId);

  return (
    <div style={{
      width: "100%", height: "100dvh",
      display: "flex", flexDirection: "column", background: "var(--bg-primary)",
      position: "relative", overflow: "hidden",
    }}>
      <Header />

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {activeTab === "browser" && <ElementBrowser />}
        {activeTab === "diagram" && <DiagramView />}
        {activeTab === "editor" && <EditorView />}
        {activeTab === "mbse" && <MbseDashboard />}
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
    </div>
  );
}
