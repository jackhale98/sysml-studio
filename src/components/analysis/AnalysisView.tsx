import React, { useState, useEffect, useCallback } from "react";
import { useModelStore } from "../../stores/model-store";
import type {
  BomNode, ConstraintModel, CalcModel, EvalResult,
  StateMachineModel, SimulationState, SimStep,
  ActionModel, ActionExecState, ActionExecStep,
} from "../../lib/element-types";
import {
  computeBom, listConstraints, listCalculations,
  evaluateConstraint, evaluateCalculation,
  listStateMachines, simulateStateMachine,
  listActions, executeAction,
} from "../../lib/tauri-bridge";

type AnalysisPanel = "bom" | "stm" | "action" | "calcs";

const PANEL_LABELS: { id: AnalysisPanel; label: string }[] = [
  { id: "bom", label: "BOM / Rollups" },
  { id: "stm", label: "State Machine" },
  { id: "action", label: "Action Flow" },
  { id: "calcs", label: "Calcs & Constraints" },
];

export function AnalysisView() {
  const model = useModelStore((s) => s.model);
  const [panel, setPanel] = useState<AnalysisPanel>("bom");

  if (!model) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
        Load a model to run analysis
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Panel selector */}
      <div style={{
        display: "flex", gap: 0, margin: "10px 14px 0",
        borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        {PANEL_LABELS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPanel(p.id)}
            style={{
              flex: 1, padding: "7px 0", border: "none", cursor: "pointer",
              fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)",
              textTransform: "uppercase", letterSpacing: "0.05em",
              background: panel === p.id ? "var(--accent)" : "var(--bg-tertiary)",
              color: panel === p.id ? "#fff" : "var(--text-muted)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
        {panel === "bom" && <BomPanel />}
        {panel === "stm" && <StateMachinePanel />}
        {panel === "action" && <ActionFlowPanel />}
        {panel === "calcs" && <CalcsPanel />}
      </div>
    </div>
  );
}

// ─── Shared Styles ───

const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "var(--text-secondary)",
  fontFamily: "var(--font-mono)", textTransform: "uppercase",
  letterSpacing: "0.08em", marginBottom: 8,
};

const card: React.CSSProperties = {
  background: "var(--bg-tertiary)", borderRadius: 8, padding: 10,
  border: "1px solid var(--border)", marginBottom: 8,
};

const monoSmall: React.CSSProperties = {
  fontSize: 11, fontFamily: "var(--font-mono)",
};

// ─── BOM / Rollup Panel ───

function BomPanel() {
  const model = useModelStore((s) => s.model);
  const [bom, setBom] = useState<BomNode[]>([]);
  const [scopeName, setScopeName] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await computeBom(scopeName || undefined);
      setBom(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, [scopeName]);

  useEffect(() => { refresh(); }, [refresh]);

  // Collect available scope targets
  const scopeTargets = model?.elements
    .filter((e) => e.kind === "part_def" || (e.kind === "part_usage" && e.children_ids.length > 0))
    .map((e) => e.name)
    .filter((n): n is string => !!n) ?? [];

  return (
    <div>
      {/* Scope selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <select
          value={scopeName}
          onChange={(e) => setScopeName(e.target.value)}
          style={{
            flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)",
            background: "var(--bg-tertiary)", color: "var(--text-primary)",
            fontSize: 12, fontFamily: "var(--font-mono)",
          }}
        >
          <option value="">All top-level parts</option>
          {scopeTargets.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onClick={refresh} style={{
          padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border)",
          background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 600,
          fontFamily: "var(--font-mono)", cursor: "pointer",
        }}>
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {bom.length === 0 && !loading && (
        <div style={{ ...card, textAlign: "center", color: "var(--text-muted)", ...monoSmall }}>
          No parts found. Add part definitions with attributes to see BOM rollups.
        </div>
      )}

      {bom.map((node) => <BomTreeNode key={node.element_id} node={node} depth={0} />)}

      {/* Rollup summary */}
      {bom.length > 0 && bom.some((n) => Object.keys(n.rollups).length > 0) && (
        <div style={{ marginTop: 12 }}>
          <div style={sectionTitle}>Rollup Totals</div>
          {bom.map((node) => (
            <div key={node.element_id} style={card}>
              <div style={{ ...monoSmall, fontWeight: 600, color: "#3b82f6", marginBottom: 4 }}>
                {node.name}
              </div>
              {Object.entries(node.rollups).length === 0 ? (
                <span style={{ ...monoSmall, color: "var(--text-muted)" }}>No numeric attributes</span>
              ) : (
                Object.entries(node.rollups).map(([key, val]) => (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", ...monoSmall }}>
                    <span style={{ color: "var(--text-muted)" }}>{key}</span>
                    <span style={{ fontWeight: 600, color: "#f59e0b" }}>{val.toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BomTreeNode({ node, depth }: { node: BomNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const indent = depth * 16;

  return (
    <div>
      <div
        onClick={() => hasChildren && setExpanded(!expanded)}
        style={{
          ...card, display: "flex", alignItems: "center", gap: 8,
          paddingLeft: 10 + indent, cursor: hasChildren ? "pointer" : "default",
          marginBottom: 4,
        }}
      >
        {hasChildren && (
          <span style={{ ...monoSmall, color: "var(--text-muted)", width: 12 }}>
            {expanded ? "▾" : "▸"}
          </span>
        )}
        <span style={{ ...monoSmall, fontWeight: 600, color: "#3b82f6" }}>
          {node.name}
        </span>
        {node.type_ref && (
          <span style={{ ...monoSmall, color: "var(--text-muted)" }}>: {node.type_ref}</span>
        )}
        {node.multiplicity !== 1 && (
          <span style={{ ...monoSmall, color: "#f59e0b", fontWeight: 600 }}>
            [{node.multiplicity}]
          </span>
        )}
        <span style={{ ...monoSmall, color: "var(--text-muted)", marginLeft: "auto", fontSize: 9 }}>
          {node.kind}
        </span>
      </div>

      {expanded && node.attributes.length > 0 && (
        <div style={{ paddingLeft: indent + 28, marginBottom: 4 }}>
          {node.attributes.map((attr) => (
            <div key={attr.name} style={{ ...monoSmall, color: "var(--text-muted)", padding: "1px 0" }}>
              <span style={{ color: "#f59e0b" }}>{attr.name}</span>
              {attr.type_ref && <span> : {attr.type_ref}</span>}
              {attr.value !== null && <span style={{ color: "#4ade80", fontWeight: 600 }}> = {attr.value}</span>}
            </div>
          ))}
        </div>
      )}

      {expanded && node.children.map((child) => (
        <BomTreeNode key={child.element_id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ─── State Machine Simulation Panel ───

/** Extract unique signal trigger names from a machine's transitions */
function getAvailableEvents(machine: StateMachineModel): string[] {
  const events = new Set<string>();
  for (const t of machine.transitions) {
    if (t.trigger && typeof t.trigger === "object" && "Signal" in t.trigger) {
      events.add(t.trigger.Signal);
    }
  }
  return [...events].sort();
}

function StateMachinePanel() {
  const [machines, setMachines] = useState<StateMachineModel[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [eventQueue, setEventQueue] = useState<string[]>([]);
  const [result, setResult] = useState<SimulationState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listStateMachines().then((m) => {
      setMachines(m);
      if (m.length > 0 && !selected) setSelected(m[0].name);
    });
  }, []);

  const machine = machines.find((m) => m.name === selected);
  const availableEvents = machine ? getAvailableEvents(machine) : [];

  const addEvent = (evt: string) => setEventQueue([...eventQueue, evt]);
  const removeEvent = (idx: number) => setEventQueue(eventQueue.filter((_, i) => i !== idx));
  const clearEvents = () => setEventQueue([]);

  const runSim = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const res = await simulateStateMachine(selected, eventQueue);
      setResult(res);
    } catch { /* ignore */ }
    setLoading(false);
  };

  return (
    <div>
      {machines.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "var(--text-muted)", ...monoSmall }}>
          No state machines found. Define a <code>state def</code> with states and transitions.
        </div>
      ) : (
        <>
          {/* Machine selector */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <select
              value={selected}
              onChange={(e) => { setSelected(e.target.value); setResult(null); setEventQueue([]); }}
              style={{
                flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)",
                background: "var(--bg-tertiary)", color: "var(--text-primary)",
                fontSize: 12, fontFamily: "var(--font-mono)",
              }}
            >
              {machines.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({m.states.length} states, {m.transitions.length} transitions)
                </option>
              ))}
            </select>
          </div>

          {/* Machine structure overview */}
          {machine && (
            <div style={{ ...card, marginBottom: 12 }}>
              <div style={{ ...monoSmall, fontWeight: 600, color: "#38bdf8", marginBottom: 6 }}>
                {machine.name}
                {machine.entry_state && (
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> (entry: {machine.entry_state})</span>
                )}
              </div>

              {/* States */}
              <div style={{ ...monoSmall, color: "var(--text-muted)", marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>States:</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {machine.states.map((s) => (
                  <span key={s.name} style={{
                    ...monoSmall, padding: "2px 8px", borderRadius: 4,
                    background: s.name === machine.entry_state ? "rgba(56,189,248,0.15)" : "var(--bg-primary)",
                    border: `1px solid ${s.name === machine.entry_state ? "rgba(56,189,248,0.4)" : "var(--border)"}`,
                    color: s.name === machine.entry_state ? "#38bdf8" : "var(--text-secondary)",
                  }}>
                    {s.name}
                  </span>
                ))}
              </div>

              {/* Transitions table */}
              <div style={{ ...monoSmall, color: "var(--text-muted)", marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>Transitions:</span>
              </div>
              <div style={{ maxHeight: 120, overflowY: "auto" }}>
                {machine.transitions.map((t, i) => {
                  const triggerLabel = t.trigger
                    ? typeof t.trigger === "object" && "Signal" in t.trigger
                      ? t.trigger.Signal
                      : "completion"
                    : "auto";
                  return (
                    <div key={i} style={{
                      ...monoSmall, padding: "2px 0",
                      display: "flex", gap: 6, alignItems: "center",
                    }}>
                      <span style={{ color: "#ef4444" }}>{t.source}</span>
                      <span style={{ color: "var(--text-muted)" }}>&rarr;</span>
                      <span style={{ color: "#4ade80" }}>{t.target}</span>
                      <span style={{ color: "#c084fc", marginLeft: "auto" }}>[{triggerLabel}]</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Event queue builder */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ ...monoSmall, color: "var(--text-muted)", fontWeight: 600, marginBottom: 6 }}>
              Event Sequence:
            </div>

            {/* Available events as clickable chips */}
            {availableEvents.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {availableEvents.map((evt) => (
                  <button
                    key={evt}
                    onClick={() => addEvent(evt)}
                    style={{
                      ...monoSmall, padding: "4px 10px", borderRadius: 6,
                      border: "1px solid rgba(192,132,252,0.3)",
                      background: "rgba(192,132,252,0.1)",
                      color: "#c084fc", cursor: "pointer", fontWeight: 600,
                    }}
                  >
                    + {evt}
                  </button>
                ))}
              </div>
            )}

            {/* Current event queue */}
            {eventQueue.length > 0 ? (
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center",
                padding: 8, borderRadius: 6,
                border: "1px solid var(--border)", background: "var(--bg-primary)",
                marginBottom: 8,
              }}>
                {eventQueue.map((evt, i) => (
                  <span key={i} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    ...monoSmall, padding: "3px 8px", borderRadius: 4,
                    background: "rgba(192,132,252,0.15)",
                    color: "#c084fc", fontWeight: 600,
                  }}>
                    {i > 0 && <span style={{ color: "var(--text-muted)", fontSize: 9, marginRight: 2 }}>&rarr;</span>}
                    {evt}
                    <button
                      onClick={() => removeEvent(i)}
                      style={{
                        background: "none", border: "none", color: "var(--text-muted)",
                        cursor: "pointer", padding: 0, fontSize: 11, lineHeight: 1,
                      }}
                    >
                      x
                    </button>
                  </span>
                ))}
                <button onClick={clearEvents} style={{
                  ...monoSmall, background: "none", border: "none",
                  color: "var(--text-muted)", cursor: "pointer", fontSize: 10,
                }}>
                  clear
                </button>
              </div>
            ) : (
              <div style={{
                ...monoSmall, color: "var(--text-muted)", padding: "8px",
                borderRadius: 6, border: "1px dashed var(--border)", textAlign: "center",
                marginBottom: 8,
              }}>
                {availableEvents.length > 0
                  ? "Tap events above to build a sequence, or run with no events for auto-completion transitions"
                  : "No signal triggers found — this machine uses completion transitions only"}
              </div>
            )}

            <button onClick={runSim} disabled={!selected} style={{
              width: "100%", padding: "8px 14px", borderRadius: 6, border: "none",
              background: selected ? "#10b981" : "var(--bg-tertiary)",
              color: selected ? "#fff" : "var(--text-muted)",
              fontSize: 12, fontWeight: 600,
              fontFamily: "var(--font-mono)", cursor: selected ? "pointer" : "default",
            }}>
              {loading ? "Simulating..." : `Run Simulation${eventQueue.length > 0 ? ` (${eventQueue.length} events)` : ""}`}
            </button>
          </div>

          {/* Simulation result */}
          {result && (
            <div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                <StatusBadge label={`State: ${result.current_state}`} color="#38bdf8" />
                <StatusBadge label={`Steps: ${result.step}`} color="#f59e0b" />
                <StatusBadge label={result.status} color={
                  result.status === "Completed" ? "#4ade80"
                  : result.status === "Deadlocked" ? "#ef4444"
                  : "#f59e0b"
                } />
              </div>

              {result.trace.length > 0 && (
                <div style={card}>
                  <div style={{ ...monoSmall, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6 }}>
                    Execution Trace
                  </div>
                  {result.trace.map((t: SimStep, i: number) => (
                    <div key={i} style={{
                      ...monoSmall, padding: "3px 0",
                      borderBottom: i < result.trace.length - 1 ? "1px solid var(--border)" : "none",
                      color: "var(--text-primary)",
                    }}>
                      <span style={{ color: "var(--text-muted)" }}>#{t.step}</span>{" "}
                      <span style={{ color: "#ef4444" }}>{t.from_state}</span>
                      {" \u2192 "}
                      <span style={{ color: "#4ade80" }}>{t.to_state}</span>
                      {t.trigger && <span style={{ color: "#c084fc" }}> [{t.trigger}]</span>}
                      {t.guard_result !== null && (
                        <span style={{ color: t.guard_result ? "#4ade80" : "#ef4444", marginLeft: 4 }}>
                          guard:{t.guard_result ? "T" : "F"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Action Flow Panel ───

/** Recursively extract step labels from action steps for preview */
function describeSteps(steps: unknown[], prefix = ""): { label: string; kind: string }[] {
  const result: { label: string; kind: string }[] = [];
  for (const step of steps) {
    if (step && typeof step === "object") {
      // sysml-core ActionStep is a tagged enum — extract the variant
      const entries = Object.entries(step as Record<string, unknown>);
      if (entries.length > 0) {
        const [kind, data] = entries[0];
        if (data && typeof data === "object" && "name" in (data as Record<string, unknown>)) {
          result.push({ kind, label: `${prefix}${(data as { name: string }).name}` });
        } else {
          result.push({ kind, label: `${prefix}${kind}` });
        }
        // Recurse into sub-steps if present
        if (data && typeof data === "object" && "steps" in (data as Record<string, unknown>)) {
          const sub = (data as { steps: unknown[] }).steps;
          if (Array.isArray(sub)) {
            result.push(...describeSteps(sub, prefix + "  "));
          }
        }
      }
    }
  }
  return result;
}

function ActionFlowPanel() {
  const [actions, setActions] = useState<ActionModel[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [maxSteps, setMaxSteps] = useState<number>(1000);
  const [result, setResult] = useState<ActionExecState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listActions().then((a) => {
      setActions(a);
      if (a.length > 0 && !selected) setSelected(a[0].name);
    });
  }, []);

  const action = actions.find((a) => a.name === selected);
  const stepPreview = action ? describeSteps(action.steps) : [];

  const runAction = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const res = await executeAction(selected, maxSteps);
      setResult(res);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const stepKindColors: Record<string, string> = {
    Action: "#c084fc", Send: "#38bdf8", Accept: "#4ade80",
    Assign: "#f59e0b", If: "#fb923c", While: "#fb923c",
    For: "#fb923c", Merge: "#64748b", Fork: "#64748b",
    Join: "#64748b", Decide: "#fb923c", Succession: "var(--text-muted)",
  };

  return (
    <div>
      {actions.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "var(--text-muted)", ...monoSmall }}>
          No actions found. Define an <code>action def</code> with steps to simulate.
        </div>
      ) : (
        <>
          {/* Action selector */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <select
              value={selected}
              onChange={(e) => { setSelected(e.target.value); setResult(null); }}
              style={{
                flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)",
                background: "var(--bg-tertiary)", color: "var(--text-primary)",
                fontSize: 12, fontFamily: "var(--font-mono)",
              }}
            >
              {actions.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name} ({a.steps.length} steps)
                </option>
              ))}
            </select>
          </div>

          {/* Action structure preview */}
          {action && stepPreview.length > 0 && (
            <div style={{ ...card, marginBottom: 12 }}>
              <div style={{ ...monoSmall, fontWeight: 600, color: "#c084fc", marginBottom: 6 }}>
                {action.name} — Flow Structure
              </div>
              <div style={{ maxHeight: 150, overflowY: "auto" }}>
                {stepPreview.map((s, i) => (
                  <div key={i} style={{
                    ...monoSmall, padding: "2px 0",
                    color: "var(--text-secondary)",
                    whiteSpace: "pre",
                  }}>
                    <span style={{ color: stepKindColors[s.kind] ?? "var(--text-muted)", fontWeight: 600 }}>
                      {s.kind}
                    </span>{" "}
                    <span>{s.label.trim()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Max steps + execute */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <label style={{ ...monoSmall, color: "var(--text-muted)", flexShrink: 0 }}>Max steps:</label>
            <input
              type="number"
              value={maxSteps}
              onChange={(e) => setMaxSteps(parseInt(e.target.value) || 1000)}
              style={{
                width: 70, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)",
                background: "var(--bg-tertiary)", color: "var(--text-primary)",
                fontSize: 12, fontFamily: "var(--font-mono)",
              }}
            />
            <button onClick={runAction} disabled={!selected} style={{
              flex: 1, padding: "8px 14px", borderRadius: 6, border: "none",
              background: selected ? "#10b981" : "var(--bg-tertiary)",
              color: selected ? "#fff" : "var(--text-muted)",
              fontSize: 12, fontWeight: 600,
              fontFamily: "var(--font-mono)", cursor: selected ? "pointer" : "default",
            }}>
              {loading ? "Executing..." : "Execute"}
            </button>
          </div>

          {/* Execution result */}
          {result && (
            <div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                <StatusBadge label={`Steps: ${result.step}`} color="#f59e0b" />
                <StatusBadge label={result.status} color={
                  result.status === "Completed" ? "#4ade80"
                  : result.status === "Error" ? "#ef4444"
                  : "#f59e0b"
                } />
                {Object.keys(result.env.bindings).length > 0 && (
                  <StatusBadge
                    label={`Env: ${Object.entries(result.env.bindings).map(([k, v]) => `${k}=${v}`).join(", ")}`}
                    color="#38bdf8"
                  />
                )}
              </div>

              {result.trace.length > 0 && (
                <div style={card}>
                  <div style={{ ...monoSmall, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6 }}>
                    Execution Trace ({result.trace.length} steps)
                  </div>
                  <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    {result.trace.map((t: ActionExecStep, i: number) => (
                      <div key={i} style={{
                        ...monoSmall, padding: "3px 0",
                        borderBottom: i < result.trace.length - 1 ? "1px solid var(--border)" : "none",
                        color: "var(--text-primary)",
                      }}>
                        <span style={{ color: "var(--text-muted)" }}>#{t.step}</span>{" "}
                        <span style={{ color: stepKindColors[t.kind] ?? "#c084fc", fontWeight: 600 }}>{t.kind}</span>{" "}
                        {t.description}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Calcs & Constraints Panel ───

function CalcsPanel() {
  const [constraints, setConstraints] = useState<ConstraintModel[]>([]);
  const [calcs, setCalcs] = useState<CalcModel[]>([]);
  const [results, setResults] = useState<EvalResult[]>([]);

  useEffect(() => {
    Promise.all([listConstraints(), listCalculations()]).then(([c, k]) => {
      setConstraints(c);
      setCalcs(k);
    });
  }, []);

  return (
    <div>
      {constraints.length === 0 && calcs.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "var(--text-muted)", ...monoSmall }}>
          No constraints or calculations found. Define <code>constraint def</code> or <code>calc def</code> elements.
        </div>
      ) : (
        <>
          {/* Constraints */}
          {constraints.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionTitle}>Constraints ({constraints.length})</div>
              {constraints.map((c) => (
                <ConstraintCard key={c.name} constraint={c} onResult={(r) => setResults((prev) => [...prev.filter((p) => p.name !== r.name), r])} />
              ))}
            </div>
          )}

          {/* Calculations */}
          {calcs.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionTitle}>Calculations ({calcs.length})</div>
              {calcs.map((c) => (
                <CalcCard key={c.name} calc={c} onResult={(r) => setResults((prev) => [...prev.filter((p) => p.name !== r.name), r])} />
              ))}
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionTitle}>Evaluation Results</div>
              {results.map((r) => (
                <div key={r.name} style={{
                  ...card, borderColor: r.success ? "rgba(74,222,128,0.3)" : "rgba(239,68,68,0.3)",
                }}>
                  <div style={{ ...monoSmall, fontWeight: 600, color: r.success ? "#4ade80" : "#ef4444" }}>
                    {r.name}: {r.success ? r.value : r.error}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConstraintCard({ constraint, onResult }: { constraint: ConstraintModel; onResult: (r: EvalResult) => void }) {
  const [bindings, setBindings] = useState<Record<string, string>>({});

  const evalConstraint = async () => {
    const numBindings: Record<string, number> = {};
    for (const [k, v] of Object.entries(bindings)) {
      const parsed = parseFloat(v);
      if (!isNaN(parsed)) numBindings[k] = parsed;
    }
    const result = await evaluateConstraint(constraint.name, numBindings);
    onResult(result);
  };

  return (
    <div style={card}>
      <div style={{ ...monoSmall, fontWeight: 600, color: "#fb923c", marginBottom: 6 }}>
        {constraint.name}
      </div>
      {constraint.params.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {constraint.params.map((p) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <label style={{ ...monoSmall, color: "var(--text-muted)" }}>{p.name}:</label>
              <input
                type="number"
                step="any"
                value={bindings[p.name] ?? ""}
                onChange={(e) => setBindings({ ...bindings, [p.name]: e.target.value })}
                style={{
                  width: 70, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)",
                  background: "var(--bg-primary)", color: "var(--text-primary)",
                  fontSize: 11, fontFamily: "var(--font-mono)",
                }}
              />
            </div>
          ))}
        </div>
      )}
      <button onClick={evalConstraint} style={{
        padding: "4px 12px", borderRadius: 6, border: "none",
        background: "#fb923c", color: "#fff", fontSize: 10, fontWeight: 600,
        fontFamily: "var(--font-mono)", cursor: "pointer",
      }}>
        Evaluate
      </button>
    </div>
  );
}

function CalcCard({ calc, onResult }: { calc: CalcModel; onResult: (r: EvalResult) => void }) {
  const [bindings, setBindings] = useState<Record<string, string>>({});

  const evalCalc = async () => {
    const numBindings: Record<string, number> = {};
    for (const [k, v] of Object.entries(bindings)) {
      const parsed = parseFloat(v);
      if (!isNaN(parsed)) numBindings[k] = parsed;
    }
    const result = await evaluateCalculation(calc.name, numBindings);
    onResult(result);
  };

  return (
    <div style={card}>
      <div style={{ ...monoSmall, fontWeight: 600, color: "#38bdf8", marginBottom: 4 }}>
        {calc.name}
        {calc.return_type && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> : {calc.return_type}</span>}
      </div>
      {calc.params.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {calc.params.map((p) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <label style={{ ...monoSmall, color: "var(--text-muted)" }}>{p.name}:</label>
              <input
                type="number"
                step="any"
                value={bindings[p.name] ?? ""}
                onChange={(e) => setBindings({ ...bindings, [p.name]: e.target.value })}
                style={{
                  width: 70, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)",
                  background: "var(--bg-primary)", color: "var(--text-primary)",
                  fontSize: 11, fontFamily: "var(--font-mono)",
                }}
              />
            </div>
          ))}
        </div>
      )}
      <button onClick={evalCalc} style={{
        padding: "4px 12px", borderRadius: 6, border: "none",
        background: "#38bdf8", color: "#fff", fontSize: 10, fontWeight: 600,
        fontFamily: "var(--font-mono)", cursor: "pointer",
      }}>
        Calculate
      </button>
    </div>
  );
}

// ─── Shared Components ───

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)",
      padding: "3px 10px", borderRadius: 4,
      background: `${color}15`, color, border: `1px solid ${color}40`,
    }}>
      {label}
    </span>
  );
}
