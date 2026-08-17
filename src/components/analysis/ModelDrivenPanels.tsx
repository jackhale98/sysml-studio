/**
 * Generic model-driven computation.
 *
 * The app has no FMEA page and no tolerance page, for the same reason
 * the CLI has no `fmea` command: the analysis a model wants is written
 * IN the model, as view defs and calc defs, and the tool renders and
 * evaluates whatever it finds. This panel is the ad-hoc half of that —
 * run any calc the model declares over any set of rows. The saved half
 * is the Views tab.
 */
import React, { useState, useEffect, useCallback } from "react";
import { listCalcs, runCalcOverRows } from "../../lib/tauri-bridge";
import type { CalcInfo, ComputedRow } from "../../lib/tauri-bridge";
import { useModelStore } from "../../stores/model-store";
import { useUIStore } from "../../stores/ui-store";

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11 };
const card: React.CSSProperties = {
  background: "var(--bg-secondary)", border: "1px solid var(--border)",
  borderRadius: 8, padding: 10, marginBottom: 8,
};
const th: React.CSSProperties = {
  ...mono, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em",
  color: "var(--text-secondary)", textAlign: "left", padding: "4px 8px",
  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  ...mono, padding: "4px 8px", borderBottom: "1px solid var(--bg-tertiary)",
  whiteSpace: "nowrap",
};
const btn: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--bg-tertiary)", color: "var(--text-primary)",
  ...mono, cursor: "pointer",
};

function num(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(digits);
}

/** Every row links back to the source line it came from. */
function useNavigate() {
  const navigateToEditor = useUIStore((s) => s.navigateToEditor);
  const selectElement = useUIStore((s) => s.selectElement);
  return (elementId: number, line: number) => {
    if (elementId) selectElement(elementId);
    if (line > 0) navigateToEditor(line);
  };
}

// ─── Generic: run any model calc over any row set ───

export function CalcRunnerPanel() {
  const model = useModelStore((s) => s.model);
  const [calcs, setCalcs] = useState<CalcInfo[]>([]);
  const [calc, setCalc] = useState("");
  const [provider, setProvider] = useState("annotations");
  const [rows, setRows] = useState<ComputedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const go = useNavigate();

  useEffect(() => {
    listCalcs().then((c) => {
      setCalcs(c);
      if (c.length > 0 && !calc) setCalc(c[0].name);
    }).catch((e) => setError(String(e)));
    setRows([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const run = async () => {
    setError(null);
    try {
      setRows(await runCalcOverRows(calc, provider));
    } catch (e) {
      setError(String(e));
      setRows([]);
    }
  };

  const selected = calcs.find((c) => c.name === calc);

  return (
    <div>
      <div style={{ ...card, ...mono, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        Run any calc your model declares over any set of rows —
        parameters bind to row fields by name. The tool supplies no
        formulas of its own. To keep an analysis, write it into the model
        as a view def; it then appears under Views.
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <select value={calc} onChange={(e) => setCalc(e.target.value)}
          style={{ ...btn, flex: 1, minWidth: 120 }}>
          {calcs.length === 0 && <option value="">no calc defs in model</option>}
          {calcs.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <select value={provider} onChange={(e) => setProvider(e.target.value)} style={{ ...btn, flex: 1, minWidth: 120 }}>
          <option value="annotations">all annotations</option>
          {[...new Set(rowTypes(model))].map((t) => (
            <option key={t} value={`annotations:${t}`}>@{t}</option>
          ))}
        </select>
        <button style={{ ...btn, background: "var(--accent)", color: "#fff", border: "none" }} onClick={run} disabled={!calc}>
          Run
        </button>
      </div>

      {selected?.expression && (
        <div style={{ ...mono, fontSize: 10, color: "var(--text-secondary)", marginBottom: 8 }}>
          {selected.name}({selected.parameters.join(", ")}) = {selected.expression}
        </div>
      )}

      {error && (
        <div style={{ ...card, borderColor: "var(--error)", color: "var(--error)", ...mono }}>{error}</div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Element</th>
                <th style={{ ...th, textAlign: "right" }}>{selected?.name ?? "Value"}</th>
                <th style={th}>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} onClick={() => go(r.element_id, r.line)} style={{ cursor: r.line ? "pointer" : "default" }}>
                  <td style={td}>{r.element_name || "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{num(r.value)}</td>
                  <td style={{ ...td, color: "var(--text-secondary)" }}>{r.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Metadata type names present in the model, for the provider picker. */
function rowTypes(model: ReturnType<typeof useModelStore.getState>["model"]): string[] {
  if (!model) return [];
  return model.elements
    .filter((e) => e.kind === "metadata_usage" || e.kind === "metadata_def")
    .map((e) => e.name ?? "")
    .filter(Boolean);
}
