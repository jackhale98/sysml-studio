import React, { useState } from "react";
import { useModelStore } from "../../stores/model-store";

interface Props {
  onClose: () => void;
}

export function ImportDialog({ onClose }: Props) {
  const addImport = useModelStore((s) => s.addImport);
  const importablePackages = useModelStore((s) => s.getImportablePackages)();
  const [customPkg, setCustomPkg] = useState("");

  async function handleAdd(pkg: string) {
    await addImport(pkg);
    onClose();
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.5)", display: "flex",
        alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-secondary)", borderRadius: 12,
          border: "1px solid var(--border)", padding: 20,
          width: "100%", maxWidth: 360,
        }}
      >
        <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "var(--text-primary)" }}>
          Add Import
        </h3>

        {importablePackages.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>
              From open files:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
              {importablePackages.map((pkg) => (
                <button
                  key={pkg}
                  onClick={() => handleAdd(pkg)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                    cursor: "pointer", fontSize: 13,
                    fontFamily: "var(--font-mono)",
                    textAlign: "left",
                  }}
                >
                  <span style={{ color: "var(--accent)" }}>import</span>
                  <span>{pkg}::*;</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>
          Custom package:
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={customPkg}
            onChange={(e) => setCustomPkg(e.target.value)}
            placeholder="PackageName"
            autoFocus={importablePackages.length === 0}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-primary)",
              color: "var(--text-primary)",
              fontSize: 13, fontFamily: "var(--font-mono)",
              outline: "none",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customPkg.trim()) handleAdd(customPkg.trim());
              if (e.key === "Escape") onClose();
            }}
          />
          <button
            onClick={() => customPkg.trim() && handleAdd(customPkg.trim())}
            disabled={!customPkg.trim()}
            style={{
              padding: "8px 16px", borderRadius: 8,
              border: "none", background: "var(--accent)",
              color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: customPkg.trim() ? "pointer" : "default",
              opacity: customPkg.trim() ? 1 : 0.5,
            }}
          >
            Add
          </button>
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 16, width: "100%", padding: "8px 0",
            borderRadius: 8, border: "1px solid var(--border)",
            background: "transparent", color: "var(--text-secondary)",
            cursor: "pointer", fontSize: 13,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
