/**
 * Model-driven analysis panels.
 *
 * These are presentation only. Every number comes from the model: rows
 * are discovered by shape, and derived values come from calc defs the
 * model declares (falling back to a labelled built-in). Nothing here
 * requires a particular library — a model that writes its own risk
 * calculation gets its own risk calculation.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  listFmeaItems, fmeaRiskMatrix, listToleranceDimensions, computeStackup,
  listCalcs, runCalcOverRows,
} from "../../lib/tauri-bridge";
import type {
  FmeaItem, RiskMatrixCell, ToleranceDimension, StackupResult, CalcInfo, ComputedRow,
} from "../../lib/tauri-bridge";
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

// ─── Risk (FMEA-shaped rows) ───

export function RiskPanel() {
  const model = useModelStore((s) => s.model);
  const [items, setItems] = useState<FmeaItem[]>([]);
  const [matrix, setMatrix] = useState<RiskMatrixCell[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const go = useNavigate();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [i, m] = await Promise.all([listFmeaItems(), fmeaRiskMatrix()]);
      setItems(i);
      setMatrix(m);
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh, model]);

  const sevs = [...new Set(matrix.map((c) => c.severity))].sort((a, b) => b - a);
  const occs = [...new Set(matrix.map((c) => c.occurrence))].sort((a, b) => a - b);
  const cellAt = (s: number, o: number) => matrix.find((c) => c.severity === s && c.occurrence === o);
  const maxProduct = Math.max(1, ...matrix.map((c) => c.severity * c.occurrence));
  const source = items.find((i) => i.rpn_source)?.rpn_source ?? null;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <button onClick={refresh} style={btn} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </button>
        {source && (
          <span style={{ ...mono, fontSize: 10, color: "var(--text-secondary)" }}>
            priority from {source}
          </span>
        )}
      </div>

      {error && (
        <div style={{ ...card, borderColor: "var(--error)", color: "var(--error)", ...mono }}>{error}</div>
      )}

      {!error && items.length === 0 && !loading && (
        <div style={{ ...card, ...mono, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          No risk rows found. Any element carrying severity, likelihood (or
          occurrence), and detection — as a metadata annotation or as
          attributes — appears here, whatever the metadata type is called.
          Declare a calc over those parameters to define your own priority
          number; otherwise severity × likelihood × detection is used.
        </div>
      )}

      {items.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Element</th>
                <th style={th}>Failure mode</th>
                <th style={th}>Cause</th>
                <th style={th}>Effect</th>
                <th style={{ ...th, textAlign: "right" }}>S</th>
                <th style={{ ...th, textAlign: "right" }}>L</th>
                <th style={{ ...th, textAlign: "right" }}>D</th>
                <th style={{ ...th, textAlign: "right" }}>Priority</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr
                  key={i}
                  onClick={() => go(it.element_id, it.line)}
                  style={{ cursor: it.line ? "pointer" : "default" }}
                  title={it.annotation_type ? `from @${it.annotation_type}` : "from attributes"}
                >
                  <td style={td}>{it.element_name || "—"}</td>
                  <td style={td}>{it.failure_mode ?? "—"}</td>
                  <td style={td}>{it.cause ?? "—"}</td>
                  <td style={td}>{it.effect ?? "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{num(it.severity, 0)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{num(it.occurrence, 0)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{num(it.detection, 0)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{num(it.rpn, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {matrix.length > 0 && (
        <div style={card}>
          <div style={{ ...mono, fontSize: 10, color: "var(--text-secondary)", marginBottom: 6 }}>
            SEVERITY × LIKELIHOOD ({items.length} rows)
          </div>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th} />
                {occs.map((o) => <th key={o} style={{ ...th, textAlign: "center" }}>{o}</th>)}
              </tr>
            </thead>
            <tbody>
              {sevs.map((s) => (
                <tr key={s}>
                  <td style={{ ...td, fontWeight: 700 }}>{s}</td>
                  {occs.map((o) => {
                    const cell = cellAt(s, o);
                    const intensity = (s * o) / maxProduct;
                    return (
                      <td
                        key={o}
                        style={{
                          ...td, textAlign: "center", minWidth: 34,
                          background: cell
                            ? `rgba(239, 68, 68, ${0.15 + intensity * 0.55})`
                            : "transparent",
                        }}
                        title={cell ? `${cell.count} item(s) at S=${s}, L=${o}` : ""}
                      >
                        {cell?.count ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tolerance (dimension-shaped attributes) ───

interface StackEntry { dimension: string; sense: number; quantity: number }

export function TolerancePanel() {
  const model = useModelStore((s) => s.model);
  const [dims, setDims] = useState<ToleranceDimension[]>([]);
  const [stack, setStack] = useState<StackEntry[]>([]);
  const [lower, setLower] = useState("");
  const [upper, setUpper] = useState("");
  const [result, setResult] = useState<StackupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = useNavigate();

  useEffect(() => {
    listToleranceDimensions().then(setDims).catch((e) => setError(String(e)));
    setStack([]);
    setResult(null);
  }, [model]);

  const add = (d: ToleranceDimension, sense: number) => {
    setStack((s) => [...s, { dimension: d.qualified_name, sense, quantity: 1 }]);
    setResult(null);
  };
  const remove = (i: number) => {
    setStack((s) => s.filter((_, j) => j !== i));
    setResult(null);
  };

  const compute = async () => {
    setError(null);
    try {
      const lo = lower.trim() === "" ? undefined : Number(lower);
      const hi = upper.trim() === "" ? undefined : Number(upper);
      setResult(await computeStackup(stack, lo, hi));
    } catch (e) {
      setError(String(e));
      setResult(null);
    }
  };

  const verdictColor = (v: string | null) =>
    v === "PASS" ? "var(--success)" : v === "FAIL" ? "var(--error)" : "var(--warning)";

  return (
    <div>
      {error && (
        <div style={{ ...card, borderColor: "var(--error)", color: "var(--error)", ...mono }}>{error}</div>
      )}

      {dims.length === 0 && (
        <div style={{ ...card, ...mono, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          No toleranced dimensions found. Any attribute whose values give a
          nominal plus bounds is picked up — <code>nominal/plus/minus</code>,
          <code> nominal/tolerance</code>, or <code>min/max</code> limits — in
          any model, with or without a tolerancing library.
        </div>
      )}

      {dims.length > 0 && (
        <div style={card}>
          <div style={{ ...mono, fontSize: 10, color: "var(--text-secondary)", marginBottom: 6 }}>
            DIMENSIONS IN MODEL ({dims.length}) — tap + or − to add to the chain
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            {dims.map((d) => (
              <div key={d.qualified_name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                <span
                  style={{ ...mono, flex: 1, cursor: "pointer" }}
                  onClick={() => go(d.element_id, d.line)}
                  title={`${d.form} · ${d.owner}`}
                >
                  {d.qualified_name}{" "}
                  <span style={{ color: "var(--text-secondary)" }}>
                    {num(d.nominal)} +{num(d.plus)}/−{num(d.minus)}{d.unit ? ` ${d.unit}` : ""}
                  </span>
                </span>
                <button style={{ ...btn, padding: "2px 8px" }} onClick={() => add(d, 1)}>+</button>
                <button style={{ ...btn, padding: "2px 8px" }} onClick={() => add(d, -1)}>−</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {stack.length > 0 && (
        <div style={card}>
          <div style={{ ...mono, fontSize: 10, color: "var(--text-secondary)", marginBottom: 6 }}>
            CHAIN
          </div>
          {stack.map((e, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
              <span style={{ ...mono, width: 16 }}>{e.sense > 0 ? "+" : "−"}</span>
              <span style={{ ...mono, flex: 1 }}>{e.dimension}</span>
              <input
                type="number"
                min={1}
                value={e.quantity}
                onChange={(ev) => {
                  const q = Number(ev.target.value) || 1;
                  setStack((s) => s.map((x, j) => (j === i ? { ...x, quantity: q } : x)));
                  setResult(null);
                }}
                style={{ ...mono, width: 44, padding: "2px 4px", background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4 }}
                title="quantity"
              />
              <button style={{ ...btn, padding: "2px 8px" }} onClick={() => remove(i)}>×</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input placeholder="lower limit" value={lower} onChange={(e) => setLower(e.target.value)}
              style={{ ...mono, width: 90, padding: "4px 6px", background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4 }} />
            <input placeholder="upper limit" value={upper} onChange={(e) => setUpper(e.target.value)}
              style={{ ...mono, width: 90, padding: "4px 6px", background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4 }} />
            <button style={{ ...btn, background: "var(--accent)", color: "#fff", border: "none" }} onClick={compute}>
              Compute
            </button>
          </div>
        </div>
      )}

      {result && (
        <div style={card}>
          <div style={{ ...mono, marginBottom: 6 }}>
            Nominal <b>{num(result.nominal)}</b>{result.unit ? ` ${result.unit}` : ""}
          </div>
          <div style={{ ...mono, marginBottom: 4 }}>
            Worst case: {num(result.worst_case_min)} … {num(result.worst_case_max)}
            {result.worst_case_verdict && (
              <span style={{ color: verdictColor(result.worst_case_verdict), fontWeight: 700 }}>
                {"  "}{result.worst_case_verdict}
              </span>
            )}
            {result.worst_case_margin !== null && (
              <span style={{ color: "var(--text-secondary)" }}>{"  "}margin {num(result.worst_case_margin)}</span>
            )}
          </div>
          <div style={{ ...mono, marginBottom: 6 }}>
            Statistical (±3σ): {num(result.rss_min)} … {num(result.rss_max)}
            {result.rss_verdict && (
              <span style={{ color: verdictColor(result.rss_verdict), fontWeight: 700 }}>
                {"  "}{result.rss_verdict}
              </span>
            )}
            {result.cp !== null && (
              <span style={{ color: "var(--text-secondary)" }}>
                {"  "}Cp {num(result.cp, 2)} · Cpk {num(result.cpk, 2)}
              </span>
            )}
          </div>
          <div style={{ ...mono, fontSize: 10, color: "var(--text-secondary)", marginBottom: 6 }}>
            σ from {result.sigma_source}
          </div>
          {result.warnings.map((w, i) => (
            <div key={i} style={{ ...mono, color: "var(--warning)" }}>⚠ {w}</div>
          ))}
          <div style={{ ...mono, fontSize: 10, color: "var(--text-secondary)", margin: "6px 0 2px" }}>
            VARIANCE SHARE — where tolerance budget actually goes
          </div>
          {result.contributions.map((c) => (
            <div key={c.dimension} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...mono, flex: 1 }}>
                {c.sense > 0 ? "+" : "−"} {c.dimension}{c.quantity > 1 ? ` ×${c.quantity}` : ""}
              </span>
              <div style={{ width: 90, height: 6, background: "var(--bg-tertiary)", borderRadius: 3 }}>
                <div style={{ width: `${c.variance_share}%`, height: "100%", background: "var(--accent)", borderRadius: 3 }} />
              </div>
              <span style={{ ...mono, width: 44, textAlign: "right", color: "var(--text-secondary)" }}>
                {c.variance_share.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
        Run any calc your model declares over any set of rows. Parameters
        bind to row fields by name. This is what the risk and tolerance
        panels use underneath — the tool supplies no formulas of its own.
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
