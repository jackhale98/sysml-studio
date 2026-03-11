import React, { useRef, useState } from "react";
import { useModelStore } from "../../stores/model-store";
import { useUIStore } from "../../stores/ui-store";
import { pickFile, readBrowserFile } from "../../lib/tauri-bridge";
import { SAMPLE_SOURCE } from "../../App";

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function Header() {
  const model = useModelStore((s) => s.model);
  const loading = useModelStore((s) => s.loading);
  const error = useModelStore((s) => s.error);
  const openFiles = useModelStore((s) => s.openFiles);
  const activeFileId = useModelStore((s) => s.activeFileId);
  const setActiveFile = useModelStore((s) => s.setActiveFile);
  const closeFile = useModelStore((s) => s.closeFile);
  const loadFile = useModelStore((s) => s.loadFile);
  const loadSource = useModelStore((s) => s.loadSource);
  const saveCurrentFile = useModelStore((s) => s.saveCurrentFile);
  const saveAs = useModelStore((s) => s.saveAs);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeFile = activeFileId ? openFiles[activeFileId] : null;
  const fileName = activeFile?.name ?? "No file";
  const dirty = activeFile?.dirty ?? false;
  const filePath = activeFile?.filePath ?? null;
  const fileCount = Object.keys(openFiles).length;

  function handleNew() {
    loadSource("package NewModel {\n  \n}\n");
    setDrawerOpen(false);
  }

  async function handleOpen() {
    if (isTauri && !isMobile) {
      const path = await pickFile();
      if (path) await loadFile(path);
    } else {
      fileInputRef.current?.click();
    }
    setDrawerOpen(false);
  }

  async function handleBrowserFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const source = await readBrowserFile(file);
    await loadSource(source, file.name);
    e.target.value = "";
    setDrawerOpen(false);
  }

  async function handleSave() {
    if (filePath && isTauri && !isMobile) {
      await saveCurrentFile();
    } else if (isTauri && !isMobile) {
      const { pickSaveFile } = await import("../../lib/tauri-bridge");
      const path = await pickSaveFile("model.sysml");
      if (path) await saveAs(path);
    } else {
      const source = activeFile?.source ?? "";
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
    background: "none", border: "none",
    color: "var(--text-secondary)", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 30, height: 30, padding: 0, borderRadius: 6,
  };

  const drawerBtnStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 14px", width: "100%",
    background: "none", border: "none",
    color: "var(--text-primary)", cursor: "pointer",
    fontSize: 13, fontFamily: "inherit", textAlign: "left",
    borderRadius: 8,
  };

  return (
    <>
      {/* ─── Compact single-row header ─── */}
      <div style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 6px)",
        paddingLeft: 12, paddingRight: 12, paddingBottom: 6,
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        {/* Hidden file input for browser mode */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".sysml,.sysml2,.txt"
          style={{ display: "none" }}
          onChange={handleBrowserFileChange}
          multiple
        />

        {/* Hamburger / file menu button */}
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          style={{
            ...iconBtnStyle,
            color: drawerOpen ? "var(--accent)" : "var(--text-secondary)",
          }}
          title="Files"
        >
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        {/* Active file name + dirty indicator */}
        <div style={{
          flex: 1, minWidth: 0,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{
            fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)",
            color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {fileName}
          </span>
          {dirty && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: "var(--warning)",
              flexShrink: 0,
            }}>
              MODIFIED
            </span>
          )}
          {fileCount > 1 && (
            <span style={{
              fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
              flexShrink: 0,
            }}>
              +{fileCount - 1}
            </span>
          )}
        </div>

        {/* Inline compact stats */}
        {model && (
          <div style={{
            display: "flex", gap: 8, alignItems: "center",
            fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)",
            flexShrink: 0,
          }}>
            <span style={{ color: "var(--accent)" }}>{model.stats.total_elements}</span>
            {model.stats.errors > 0 && (
              <span style={{ color: "var(--error)" }}>{model.stats.errors}err</span>
            )}
          </div>
        )}

        {/* Save (only when dirty) */}
        {activeFile && dirty && (
          <button onClick={handleSave} style={{ ...iconBtnStyle, color: "var(--warning)" }} title="Save">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
          </button>
        )}

        {/* Status dot */}
        <div style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: error ? "var(--error)" : loading ? "var(--warning)" : model ? "var(--success)" : "var(--text-muted)",
        }} title={error ? "Error" : loading ? "Loading" : model ? "OK" : "No model"} />
      </div>

      {/* ─── Slide-out file drawer ─── */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setDrawerOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 50,
              background: "rgba(0,0,0,0.4)",
            }}
          />
          {/* Drawer panel */}
          <div style={{
            position: "fixed",
            top: 0, left: 0, bottom: 0,
            width: 280, maxWidth: "80vw",
            zIndex: 51,
            background: "var(--bg-secondary)",
            borderRight: "1px solid var(--border)",
            display: "flex", flexDirection: "column",
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
            boxShadow: "4px 0 24px rgba(0,0,0,0.3)",
          }}>
            {/* Drawer header */}
            <div style={{
              padding: "0 14px 12px",
              borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{
                fontSize: 14, fontWeight: 700, color: "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}>
                Files
              </span>
              <button
                onClick={toggleTheme}
                style={iconBtnStyle}
                title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              >
                {theme === "dark" ? (
                  <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
            </div>

            {/* Actions */}
            <div style={{ padding: "8px 8px 4px", display: "flex", flexDirection: "column", gap: 2 }}>
              <button onClick={handleNew} style={drawerBtnStyle}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New File
              </button>
              <button onClick={handleOpen} style={drawerBtnStyle}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                </svg>
                Open File
              </button>
              <button onClick={() => { loadSource(SAMPLE_SOURCE, "VehicleSystem.sysml"); setDrawerOpen(false); }} style={drawerBtnStyle}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
                Load Example
              </button>
              {activeFile && (
                <button onClick={() => { handleSave(); setDrawerOpen(false); }} style={drawerBtnStyle}>
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  <span>Save</span>
                  {dirty && <span style={{ fontSize: 10, color: "var(--warning)", marginLeft: "auto" }}>modified</span>}
                </button>
              )}
            </div>

            {/* Open files list */}
            {fileCount > 0 && (
              <>
                <div style={{
                  padding: "12px 14px 6px",
                  fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
                  textTransform: "uppercase", letterSpacing: "0.08em",
                }}>
                  Open Files ({fileCount})
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
                  {Object.values(openFiles).map((file) => (
                    <div
                      key={file.id}
                      onClick={() => { setActiveFile(file.id); setDrawerOpen(false); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                        background: file.id === activeFileId ? "rgba(59,130,246,0.1)" : "transparent",
                        borderLeft: file.id === activeFileId ? "3px solid var(--accent)" : "3px solid transparent",
                        marginBottom: 2,
                      }}
                    >
                      {/* File icon */}
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke={file.id === activeFileId ? "var(--accent)" : "var(--text-muted)"} strokeWidth="1.5" style={{ flexShrink: 0 }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600,
                          fontFamily: "var(--font-mono)",
                          color: file.id === activeFileId ? "var(--text-primary)" : "var(--text-secondary)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {file.name}
                          {file.dirty && <span style={{ color: "var(--warning)", marginLeft: 4 }}>*</span>}
                        </div>
                        {file.filePath && (
                          <div style={{
                            fontSize: 10, color: "var(--text-muted)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {file.filePath}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); closeFile(file.id); }}
                        style={{
                          ...iconBtnStyle, width: 22, height: 22,
                          color: "var(--text-muted)", opacity: 0.5,
                        }}
                        title={`Close ${file.name}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Stats footer */}
            {model && (
              <div style={{
                padding: "10px 14px",
                borderTop: "1px solid var(--border)",
                display: "flex", gap: 12,
                fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
              }}>
                <span style={{ color: "var(--accent)" }}>{model.stats.total_elements} el</span>
                <span style={{ color: "var(--success)" }}>{model.stats.definitions} def</span>
                <span style={{ color: "var(--warning)" }}>{model.stats.usages} use</span>
                <span style={{ color: model.stats.errors > 0 ? "var(--error)" : "var(--success)" }}>
                  {model.stats.errors} err
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
