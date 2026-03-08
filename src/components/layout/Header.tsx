import React, { useRef } from "react";
import { useModelStore } from "../../stores/model-store";
import { useUIStore } from "../../stores/ui-store";
import { pickFile, pickSaveFile, readBrowserFile } from "../../lib/tauri-bridge";

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function Header() {
  const model = useModelStore((s) => s.model);
  const loading = useModelStore((s) => s.loading);
  const error = useModelStore((s) => s.error);
  const filePath = useModelStore((s) => s.filePath);
  const dirty = useModelStore((s) => s.dirty);
  const loadFile = useModelStore((s) => s.loadFile);
  const loadSource = useModelStore((s) => s.loadSource);
  const saveCurrentFile = useModelStore((s) => s.saveCurrentFile);
  const saveAs = useModelStore((s) => s.saveAs);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fileName = filePath?.split("/").pop() ?? (model ? "untitled.sysml" : "No file");

  async function handleOpen() {
    if (isTauri && !isMobile) {
      const path = await pickFile();
      if (path) await loadFile(path);
    } else {
      fileInputRef.current?.click();
    }
  }

  async function handleBrowserFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const source = await readBrowserFile(file);
    await loadSource(source, file.name);
    e.target.value = "";
  }

  async function handleSave() {
    if (filePath && isTauri && !isMobile) {
      await saveCurrentFile();
    } else if (isTauri && !isMobile) {
      const path = await pickSaveFile("model.sysml");
      if (path) await saveAs(path);
    } else {
      // Browser: trigger download
      const { source } = useModelStore.getState();
      const blob = new Blob([source], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  const iconBtnStyle: React.CSSProperties = {
    background: "var(--bg-tertiary)", border: "1px solid var(--border)",
    borderRadius: 8, color: "var(--text-secondary)", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 34, height: 34, minHeight: 34, padding: 0,
  };

  return (
    <div style={{
      padding: "8px 12px 10px",
      borderBottom: "1px solid var(--border)",
      background: "linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)",
    }}>
      {/* Hidden file input for browser mode */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".sysml,.sysml2,.txt"
        style={{ display: "none" }}
        onChange={handleBrowserFileChange}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{
            margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em",
            background: theme === "dark"
              ? "linear-gradient(135deg, #e2e8f0 0%, #60a5fa 100%)"
              : "linear-gradient(135deg, #0f172a 0%, #2563eb 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            SysML Studio
          </h1>
          <div style={{
            fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
            marginTop: 1, display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160,
            }}>
              {fileName}
            </span>
            {dirty && (
              <span style={{ color: "var(--warning)", fontSize: 9, fontWeight: 700 }}>
                MODIFIED
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Open file */}
          <button onClick={handleOpen} style={iconBtnStyle} title="Open file">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
          </button>

          {/* Save file */}
          {model && (
            <button onClick={handleSave} style={{
              ...iconBtnStyle,
              borderColor: dirty ? "var(--warning)" : "var(--border)",
              color: dirty ? "var(--warning)" : "var(--text-secondary)",
            }} title="Save file">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
            </button>
          )}

          {/* Theme toggle */}
          <button onClick={toggleTheme} style={iconBtnStyle} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? (
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>

          {/* Status indicator */}
          <div style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "var(--bg-tertiary)", borderRadius: 8, padding: "4px 10px",
            border: "1px solid var(--border)",
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: error ? "var(--error)" : loading ? "var(--warning)" : "var(--success)",
            }} />
            <span style={{
              fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)",
              color: error ? "var(--error)" : loading ? "var(--warning)" : "var(--success)",
            }}>
              {error ? "ERR" : loading ? "..." : model ? "OK" : "—"}
            </span>
          </div>
        </div>
      </div>

      {model && (
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          {[
            { label: "Elements", value: model.stats.total_elements, color: "var(--accent)" },
            { label: "Defs", value: model.stats.definitions, color: "var(--success)" },
            { label: "Usages", value: model.stats.usages, color: "var(--warning)" },
            { label: "Errors", value: model.stats.errors, color: model.stats.errors > 0 ? "var(--error)" : "var(--success)" },
          ].map((s) => (
            <div key={s.label} style={{ flex: 1, textAlign: "center" }}>
              <div style={{
                fontSize: 18, fontWeight: 700, color: s.color, fontFamily: "var(--font-mono)",
              }}>
                {s.value}
              </div>
              <div style={{
                fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase",
                letterSpacing: "0.08em", fontWeight: 600,
              }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
