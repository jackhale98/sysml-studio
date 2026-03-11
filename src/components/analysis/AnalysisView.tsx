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

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: 14 }}>
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

/** Collect every unique numeric attribute name across the BOM tree */
function collectAttrKeys(roots: BomNode[]): string[] {
  const keys = new Set<string>();
  function walk(n: BomNode) {
    for (const a of n.attributes) if (a.value !== null) keys.add(a.name);
    n.children.forEach(walk);
  }
  roots.forEach(walk);
  return [...keys].sort();
}

function fmtNum(v: number): string {
  return v % 1 === 0 ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** Read a node's own attribute value (not rolled up) */
function ownAttrValue(node: BomNode, key: string): number | null {
  const attr = node.attributes.find((a) => a.name === key);
  return attr?.value ?? null;
}

function BomPanel() {
  const model = useModelStore((s) => s.model);
  const [bom, setBom] = useState<BomNode[]>([]);
  const [scopeName, setScopeName] = useState<string>("");
  const [rollupKey, setRollupKey] = useState<string>("");
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

  // All numeric attribute names found in the tree
  const attrKeys = React.useMemo(() => collectAttrKeys(bom), [bom]);

  // Auto-select first key when keys change and current selection is invalid
  useEffect(() => {
    if (attrKeys.length > 0 && !attrKeys.includes(rollupKey)) {
      setRollupKey(attrKeys[0]);
    }
  }, [attrKeys, rollupKey]);

  // Collect available scope targets
  const scopeTargets = model?.elements
    .filter((e) => e.kind === "part_def" || (e.kind === "part_usage" && e.children_ids.length > 0))
    .map((e) => e.name)
    .filter((n): n is string => !!n) ?? [];

  const total = rollupKey ? bom.reduce((sum, n) => sum + (n.rollups[rollupKey] ?? 0), 0) : 0;

  return (
    <div>
      {/* Controls row */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
        <select
          value={scopeName}
          onChange={(e) => setScopeName(e.target.value)}
          style={selectStyle}
        >
          <option value="">All top-level parts</option>
          {scopeTargets.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select
          value={rollupKey}
          onChange={(e) => setRollupKey(e.target.value)}
          style={{ ...selectStyle, flex: "none", minWidth: 100 }}
        >
          {attrKeys.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button onClick={refresh} style={{
          padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)",
          background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 600,
          fontFamily: "var(--font-mono)", cursor: "pointer", flexShrink: 0,
        }}>
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {bom.length === 0 && !loading && (
        <div style={{ ...card, textAlign: "center", color: "var(--text-muted)", ...monoSmall }}>
          No parts found. Add part definitions with attributes to see BOM rollups.
        </div>
      )}

      {/* Total banner */}
      {bom.length > 0 && rollupKey && total > 0 && (
        <div style={{
          ...card, display: "flex", justifyContent: "space-between", alignItems: "baseline",
          marginBottom: 10, padding: "8px 12px",
        }}>
          <span style={{ ...monoSmall, color: "var(--text-muted)", textTransform: "uppercase", fontSize: 10, letterSpacing: "0.06em" }}>
            Total {rollupKey}
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-mono)", color: "#f59e0b" }}>
            {fmtNum(total)}
          </span>
        </div>
      )}

      {/* Column header */}
      {bom.length > 0 && rollupKey && (
        <div style={{
          display: "flex", alignItems: "center", padding: "4px 8px", marginBottom: 2,
          ...monoSmall, fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          <span style={{ flex: 1 }}>Part</span>
          <span style={{ width: 54, textAlign: "right", flexShrink: 0 }}>Qty</span>
          <span style={{ width: 70, textAlign: "right", flexShrink: 0 }}>Unit</span>
          <span style={{ width: 70, textAlign: "right", flexShrink: 0 }}>Total</span>
        </div>
      )}

      {/* BOM tree */}
      <div style={{ overflow: "hidden" }}>
        {bom.map((node) => (
          <BomTreeNode key={node.element_id} node={node} depth={0} isLast={true} rollupKey={rollupKey} />
        ))}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--bg-tertiary)", color: "var(--text-primary)",
  fontSize: 12, fontFamily: "var(--font-mono)",
};

function BomTreeNode({ node, depth, isLast, rollupKey }: { node: BomNode; depth: number; isLast: boolean; rollupKey: string }) {
  const [expanded, setExpanded] = useState(depth < 3);
  const hasChildren = node.children.length > 0;

  const treeColor = "var(--border)";
  const connectorW = 16;

  const rollupVal = rollupKey ? (node.rollups[rollupKey] ?? 0) : 0;
  const ownVal = rollupKey ? ownAttrValue(node, rollupKey) : null;
  // Per-unit value: own attribute for leaves, rolled-up / multiplicity for assemblies
  const unitVal = hasChildren
    ? (node.multiplicity > 0 ? rollupVal / node.multiplicity : rollupVal)
    : ownVal;
  const totalVal = hasChildren ? rollupVal : (ownVal !== null ? ownVal * node.multiplicity : null);

  return (
    <div style={{ position: "relative" }}>
      {/* Vertical tree line from parent */}
      {depth > 0 && (
        <div style={{
          position: "absolute", left: (depth - 1) * connectorW + 18, top: 0,
          width: 1, height: isLast ? 14 : "100%", background: treeColor,
          pointerEvents: "none",
        }} />
      )}
      {/* Horizontal connector to this node */}
      {depth > 0 && (
        <div style={{
          position: "absolute", left: (depth - 1) * connectorW + 18, top: 14,
          width: connectorW - 4, height: 1, background: treeColor,
          pointerEvents: "none",
        }} />
      )}

      <div
        onClick={() => hasChildren && setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", gap: 4, minWidth: 0,
          marginLeft: depth * connectorW + 4, padding: "3px 8px", borderRadius: 4,
          cursor: hasChildren ? "pointer" : "default",
          background: depth === 0 ? "var(--bg-tertiary)" : "transparent",
          border: depth === 0 ? "1px solid var(--border)" : "none",
          marginBottom: depth === 0 ? 2 : 0, marginTop: depth === 0 && !isLast ? 6 : 0,
          minHeight: 26,
        }}
      >
        {/* Expand/collapse or leaf dot */}
        {hasChildren ? (
          <span style={{ ...monoSmall, color: "var(--text-muted)", width: 10, flexShrink: 0, userSelect: "none" }}>
            {expanded ? "▾" : "▸"}
          </span>
        ) : (
          <span style={{ width: 10, flexShrink: 0, display: "flex", justifyContent: "center" }}>
            <span style={{ width: 4, height: 4, borderRadius: 2, background: "var(--text-muted)", display: "block" }} />
          </span>
        )}

        {/* Name and type */}
        <span style={{ ...monoSmall, fontWeight: 600, color: depth === 0 ? "#3b82f6" : "#93c5fd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
          {node.name}
          {node.type_ref && (
            <span style={{ fontWeight: 400, color: "var(--text-muted)" }}> : {node.type_ref}</span>
          )}
        </span>

        {/* Qty | Unit | Total columns */}
        {rollupKey && (
          <>
            <span style={{ ...monoSmall, width: 54, textAlign: "right", flexShrink: 0, color: node.multiplicity !== 1 ? "#f59e0b" : "var(--text-muted)", fontWeight: node.multiplicity !== 1 ? 700 : 400, fontSize: 10 }}>
              {node.multiplicity !== 1 ? `x${node.multiplicity}` : ""}
            </span>
            <span style={{ ...monoSmall, width: 70, textAlign: "right", flexShrink: 0, color: "var(--text-muted)", fontSize: 10 }}>
              {unitVal !== null && unitVal !== 0 ? fmtNum(unitVal) : "-"}
            </span>
            <span style={{ ...monoSmall, width: 70, textAlign: "right", flexShrink: 0, fontWeight: 600, fontSize: 11, color: hasChildren ? "#f59e0b" : "#4ade80" }}>
              {totalVal !== null && totalVal !== 0 ? fmtNum(totalVal) : "-"}
            </span>
          </>
        )}
      </div>

      {expanded && node.children.map((child, i) => (
        <BomTreeNode key={child.element_id} node={child} depth={depth + 1} isLast={i === node.children.length - 1} rollupKey={rollupKey} />
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
  const model = useModelStore((s) => s.model);
  const [machines, setMachines] = useState<StateMachineModel[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [eventQueue, setEventQueue] = useState<string[]>([]);
  const [result, setResult] = useState<SimulationState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listStateMachines().then((m) => {
      setMachines(m);
      if (m.length > 0) setSelected(prev => prev || m[0].name);
    }).catch(() => setMachines([]));
  }, [model]);

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
      const entries = Object.entries(step as Record<string, unknown>);
      if (entries.length === 0) continue;
      const [kind, data] = entries[0];
      const d = data as Record<string, unknown>;

      if (kind === "Fork") {
        const name = (d?.name as string) ?? "fork";
        const branches = (d?.branches as unknown[]) ?? [];
        result.push({ kind: "Fork", label: `${prefix}fork ${name} → ${branches.length} branches` });
        for (let bi = 0; bi < branches.length; bi++) {
          result.push({ kind: "Fork", label: `${prefix}  ── branch ${bi + 1}:` });
          result.push(...describeSteps([branches[bi]], prefix + "    "));
        }
      } else if (kind === "Join") {
        result.push({ kind: "Join", label: `${prefix}join ${(d?.name as string) ?? ""}` });
      } else if (kind === "Sequence") {
        const seqSteps = (d?.steps as unknown[]) ?? [];
        result.push(...describeSteps(seqSteps, prefix));
      } else if (kind === "Accept") {
        result.push({ kind: "Accept", label: `${prefix}accept ${(d?.signal as string) ?? ""}` });
      } else if (kind === "Send") {
        const to = (d?.to as string) ? ` → ${d.to}` : "";
        result.push({ kind: "Send", label: `${prefix}send ${(d?.payload as string) ?? ""}${to}` });
      } else if (kind === "Decide") {
        result.push({ kind: "Decide", label: `${prefix}decide ${(d?.name as string) ?? ""}` });
      } else {
        // Action or other step types
        const name = (d?.name as string) ?? kind;
        result.push({ kind, label: `${prefix}${name}` });
        // Recurse into sub-steps if present
        if (d && "steps" in d) {
          const sub = d.steps as unknown[];
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
  const model = useModelStore((s) => s.model);
  const [actions, setActions] = useState<ActionModel[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [maxSteps, setMaxSteps] = useState<number>(1000);
  const [result, setResult] = useState<ActionExecState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listActions().then((a) => {
      setActions(a);
      if (a.length > 0) setSelected(prev => prev || a[0].name);
    }).catch(() => setActions([]));
  }, [model]);

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
    Start: "#10b981", End: "#10b981",
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
              </div>

              {/* Environment bindings */}
              {Object.keys(result.env.bindings).length > 0 && (
                <div style={{ ...card, marginBottom: 8, borderLeft: "3px solid #38bdf8" }}>
                  <div style={{ ...monoSmall, fontWeight: 600, color: "#38bdf8", marginBottom: 4 }}>
                    Simulation Results
                  </div>
                  {Object.entries(result.env.bindings).map(([k, v]) => (
                    <div key={k} style={{ ...monoSmall, padding: "2px 0", color: "var(--text-secondary)" }}>
                      <span style={{ color: "var(--text-muted)" }}>{k.replace(/_/g, " ")}:</span>{" "}
                      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              {result.trace.length > 0 && (
                <div style={{ ...card, borderLeft: "3px solid #10b981" }}>
                  <div style={{ ...monoSmall, fontWeight: 700, color: "#10b981", marginBottom: 6 }}>
                    Execution Timeline ({result.trace.length} events)
                  </div>
                  <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    {result.trace.map((t: ActionExecStep, i: number) => {
                      const isLifecycle = t.kind === "Start" || t.kind === "End";
                      const isSubStep = t.description.includes("  "); // indented sub-step
                      return (
                        <div key={i} style={{
                          ...monoSmall,
                          padding: isLifecycle ? "4px 6px" : "3px 6px",
                          marginBottom: 1,
                          borderRadius: isLifecycle ? 4 : 0,
                          background: isLifecycle ? "rgba(16, 185, 129, 0.08)" : "transparent",
                          borderBottom: !isLifecycle && i < result.trace.length - 1 ? "1px solid var(--border)" : "none",
                          color: "var(--text-primary)",
                          paddingLeft: isSubStep ? 24 : 6,
                        }}>
                          <span style={{
                            display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                            background: stepKindColors[t.kind] ?? "#c084fc",
                            marginRight: 6, verticalAlign: "middle",
                          }} />
                          <span style={{
                            color: stepKindColors[t.kind] ?? "#c084fc",
                            fontWeight: isLifecycle ? 700 : 600,
                            minWidth: 48, display: "inline-block",
                          }}>{t.kind}</span>{" "}
                          <span style={{ color: isLifecycle ? "var(--text-primary)" : "var(--text-secondary)" }}>
                            {t.description}
                          </span>
                        </div>
                      );
                    })}
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
  const model = useModelStore((s) => s.model);
  const [constraints, setConstraints] = useState<ConstraintModel[]>([]);
  const [calcs, setCalcs] = useState<CalcModel[]>([]);
  const [mode, setMode] = useState<"model" | "whatif">("model");

  useEffect(() => {
    Promise.all([listConstraints(), listCalculations()]).then(([c, k]) => {
      setConstraints(c);
      setCalcs(k);
    }).catch(() => { setConstraints([]); setCalcs([]); });
  }, [model]);

  // Collect all numeric attribute values from model for auto-binding
  // Keyed by lowercase attribute name → array of { value, context }
  const modelAttrs = React.useMemo(() => {
    if (!model) return new Map<string, { value: number; context: string }[]>();
    const attrs = new Map<string, { value: number; context: string }[]>();
    for (const el of model.elements) {
      if (el.kind === "attribute_usage" && el.name && el.value_expr) {
        const v = parseFloat(el.value_expr);
        if (isNaN(v)) continue;
        const parent = el.parent_id != null
          ? model.elements.find(p => p.id === el.parent_id)
          : null;
        const context = parent?.name ?? "";
        const key = el.name.toLowerCase();
        if (!attrs.has(key)) attrs.set(key, []);
        attrs.get(key)!.push({ value: v, context });
      }
    }
    return attrs;
  }, [model]);

  return (
    <div>
      {constraints.length === 0 && calcs.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "var(--text-muted)", ...monoSmall }}>
          No constraints or calculations found. Define <code>constraint def</code> or <code>calc def</code> elements.
        </div>
      ) : (
        <>
          {/* Mode toggle */}
          <div style={{
            display: "flex", gap: 0, marginBottom: 12,
            borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)",
          }}>
            {(["model", "whatif"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1, padding: "6px 0", border: "none", cursor: "pointer",
                  fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)",
                  textTransform: "uppercase", letterSpacing: "0.05em",
                  background: mode === m ? "var(--accent)" : "var(--bg-tertiary)",
                  color: mode === m ? "#fff" : "var(--text-muted)",
                }}
              >
                {m === "model" ? "Model Analysis" : "What-If"}
              </button>
            ))}
          </div>

          {mode === "model" ? (
            <ModelAnalysisView calcs={calcs} constraints={constraints} modelAttrs={modelAttrs} />
          ) : (
            <>
              {calcs.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={sectionTitle}>Calculations ({calcs.length})</div>
                  {calcs.map((c) => <WhatIfCalcCard key={c.name} calc={c} />)}
                </div>
              )}
              {constraints.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={sectionTitle}>Constraints ({constraints.length})</div>
                  {constraints.map((c) => <WhatIfConstraintCard key={c.name} constraint={c} />)}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Model Analysis: auto-bind from model attributes ───

type AttrMap = Map<string, { value: number; context: string }[]>;

/**
 * Resolve a param name to a model attribute value.
 * Matching priority:
 *  1. Exact name (case-insensitive)
 *  2. Param name ends with attribute name (e.g., "vehicleMass" → "mass")
 *  3. Attribute name ends with param name (e.g., "totalCost" matches param "cost")
 * When multiple attributes match, uses the first (arbitrary — user can refine via What-If).
 */
function resolveParam(paramName: string, attrs: AttrMap): { value: number; matchedAttr: string; context: string } | null {
  const pLower = paramName.toLowerCase();
  // 1. Exact match
  const exact = attrs.get(pLower);
  if (exact && exact.length > 0) return { value: exact[0].value, matchedAttr: pLower, context: exact[0].context };
  // 2. Param ends with attr name (e.g., "vehicleMass" → "mass")
  for (const [attrName, entries] of attrs) {
    if (pLower.endsWith(attrName) && pLower.length > attrName.length) {
      return { value: entries[0].value, matchedAttr: attrName, context: entries[0].context };
    }
  }
  // 3. Attr name ends with param name (e.g., attr "totalCost" matches param "cost")
  for (const [attrName, entries] of attrs) {
    if (attrName.endsWith(pLower) && attrName.length > pLower.length) {
      return { value: entries[0].value, matchedAttr: attrName, context: entries[0].context };
    }
  }
  return null;
}

function ModelAnalysisView({ calcs, constraints, modelAttrs }: {
  calcs: CalcModel[]; constraints: ConstraintModel[]; modelAttrs: AttrMap;
}) {
  const [results, setResults] = useState<Map<string, EvalResult>>(new Map());
  const [ran, setRan] = useState(false);

  const runAll = useCallback(async () => {
    const newResults = new Map<string, EvalResult>();

    for (const c of calcs) {
      const paramBindings: Record<string, number> = {};
      const inputParams = c.params.filter(p => p.direction !== "Out");
      const unbound: string[] = [];
      for (const p of inputParams) {
        const match = resolveParam(p.name, modelAttrs);
        if (match) paramBindings[p.name] = match.value;
        else unbound.push(p.name);
      }
      if (unbound.length > 0) {
        newResults.set(c.name, { name: c.name, success: false, value: "", error: `Unbound: ${unbound.join(", ")}` });
        continue;
      }
      try {
        newResults.set(c.name, await evaluateCalculation(c.name, paramBindings));
      } catch {
        newResults.set(c.name, { name: c.name, success: false, value: "", error: "Evaluation failed" });
      }
    }
    for (const c of constraints) {
      const paramBindings: Record<string, number> = {};
      const inputParams = c.params.filter(p => p.direction !== "Out");
      const unbound: string[] = [];
      for (const p of inputParams) {
        const match = resolveParam(p.name, modelAttrs);
        if (match) paramBindings[p.name] = match.value;
        else unbound.push(p.name);
      }
      if (unbound.length > 0) {
        newResults.set(c.name, { name: c.name, success: false, value: "", error: `Unbound: ${unbound.join(", ")}` });
        continue;
      }
      try {
        newResults.set(c.name, await evaluateConstraint(c.name, paramBindings));
      } catch {
        newResults.set(c.name, { name: c.name, success: false, value: "", error: "Evaluation failed" });
      }
    }
    setResults(newResults);
    setRan(true);
  }, [calcs, constraints, modelAttrs]);

  useEffect(() => { setRan(false); }, [calcs, constraints, modelAttrs]);

  const allItems = [...calcs.map(c => ({ type: "calc" as const, name: c.name, params: c.params, returnType: (c as CalcModel).return_type })),
                     ...constraints.map(c => ({ type: "constraint" as const, name: c.name, params: c.params, returnType: null }))];

  return (
    <div>
      <div style={{ ...monoSmall, fontSize: 10, color: "var(--text-muted)", marginBottom: 8, lineHeight: "16px" }}>
        Auto-binds parameters to matching model attributes by name.
      </div>

      <button onClick={runAll} style={{
        padding: "6px 16px", borderRadius: 6, border: "none", width: "100%",
        background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 600,
        fontFamily: "var(--font-mono)", cursor: "pointer", marginBottom: 12,
      }}>
        Run All Against Model
      </button>

      {allItems.map((item) => {
        const result = results.get(item.name);
        const inputParams = item.params.filter(p => p.direction !== "Out");
        const resolved = inputParams.map(p => ({ param: p, match: resolveParam(p.name, modelAttrs) }));
        const boundParams = resolved.filter(r => r.match !== null);
        const unboundParams = resolved.filter(r => r.match === null);
        const isCalc = item.type === "calc";
        const accentColor = isCalc ? "#38bdf8" : "#fb923c";

        return (
          <div key={item.name} style={{
            ...card,
            borderColor: result
              ? (result.success ? "rgba(74,222,128,0.3)" : "rgba(239,68,68,0.3)")
              : undefined,
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
              <span style={{ ...monoSmall, fontWeight: 600, color: accentColor }}>
                {item.name}
              </span>
              {item.returnType && (
                <span style={{ ...monoSmall, color: "var(--text-muted)", fontSize: 10 }}>: {item.returnType}</span>
              )}
              <span style={{
                ...monoSmall, fontSize: 9, padding: "1px 5px", borderRadius: 3, marginLeft: "auto",
                background: isCalc ? "rgba(56,189,248,0.1)" : "rgba(251,146,60,0.1)",
                color: accentColor,
              }}>
                {item.type}
              </span>
            </div>

            {/* Bound parameters */}
            {boundParams.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                {boundParams.map(({ param: p, match: m }) => (
                  <span key={p.name} style={{ ...monoSmall, fontSize: 10, color: "var(--text-muted)" }}>
                    {p.name}
                    {m!.matchedAttr !== p.name.toLowerCase() && (
                      <span style={{ color: "var(--text-muted)", fontSize: 9 }}> ({m!.context ? `${m!.context}.` : ""}{m!.matchedAttr})</span>
                    )}
                    =<span style={{ color: "#4ade80" }}>{m!.value}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Unbound parameters */}
            {unboundParams.length > 0 && (
              <div style={{ ...monoSmall, fontSize: 10, color: "#f59e0b", marginBottom: 4 }}>
                Unbound: {unboundParams.map(r => r.param.name).join(", ")}
              </div>
            )}

            {/* Result */}
            {ran && result && (
              <div style={{ ...monoSmall, fontWeight: 600, color: result.success ? "#4ade80" : "#ef4444" }}>
                = {result.success ? result.value : result.error}
              </div>
            )}
            {ran && !result && (
              <div style={{ ...monoSmall, color: "var(--text-muted)", fontSize: 10 }}>Not evaluated</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── What-If: manual input cards ───

function WhatIfConstraintCard({ constraint }: { constraint: ConstraintModel }) {
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [result, setResult] = useState<EvalResult | null>(null);

  const evalConstraint = async () => {
    const numBindings: Record<string, number> = {};
    for (const [k, v] of Object.entries(bindings)) {
      const parsed = parseFloat(v);
      if (!isNaN(parsed)) numBindings[k] = parsed;
    }
    setResult(await evaluateConstraint(constraint.name, numBindings));
  };

  return (
    <div style={{ ...card, borderColor: result ? (result.success ? "rgba(74,222,128,0.3)" : "rgba(239,68,68,0.3)") : undefined }}>
      <div style={{ ...monoSmall, fontWeight: 600, color: "#fb923c", marginBottom: 6 }}>
        {constraint.name}
      </div>
      {constraint.params.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {constraint.params.map((p) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <label style={{ ...monoSmall, color: "var(--text-muted)" }}>{p.name}:</label>
              <input
                type="number" step="any"
                value={bindings[p.name] ?? ""}
                onChange={(e) => { setBindings({ ...bindings, [p.name]: e.target.value }); setResult(null); }}
                style={paramInput}
              />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={evalConstraint} style={{
          padding: "4px 12px", borderRadius: 6, border: "none",
          background: "#fb923c", color: "#fff", fontSize: 10, fontWeight: 600,
          fontFamily: "var(--font-mono)", cursor: "pointer",
        }}>
          Evaluate
        </button>
        {result && (
          <span style={{ ...monoSmall, fontWeight: 600, color: result.success ? "#4ade80" : "#ef4444" }}>
            = {result.success ? result.value : result.error}
          </span>
        )}
      </div>
    </div>
  );
}

function WhatIfCalcCard({ calc }: { calc: CalcModel }) {
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [result, setResult] = useState<EvalResult | null>(null);

  const evalCalc = async () => {
    const numBindings: Record<string, number> = {};
    for (const [k, v] of Object.entries(bindings)) {
      const parsed = parseFloat(v);
      if (!isNaN(parsed)) numBindings[k] = parsed;
    }
    setResult(await evaluateCalculation(calc.name, numBindings));
  };

  return (
    <div style={{ ...card, borderColor: result ? (result.success ? "rgba(74,222,128,0.3)" : "rgba(239,68,68,0.3)") : undefined }}>
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
                type="number" step="any"
                value={bindings[p.name] ?? ""}
                onChange={(e) => { setBindings({ ...bindings, [p.name]: e.target.value }); setResult(null); }}
                style={paramInput}
              />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={evalCalc} style={{
          padding: "4px 12px", borderRadius: 6, border: "none",
          background: "#38bdf8", color: "#fff", fontSize: 10, fontWeight: 600,
          fontFamily: "var(--font-mono)", cursor: "pointer",
        }}>
          Calculate
        </button>
        {result && (
          <span style={{ ...monoSmall, fontWeight: 600, color: result.success ? "#4ade80" : "#ef4444" }}>
            = {result.success ? result.value : result.error}
          </span>
        )}
      </div>
    </div>
  );
}

const paramInput: React.CSSProperties = {
  width: 70, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)",
  background: "var(--bg-primary)", color: "var(--text-primary)",
  fontSize: 11, fontFamily: "var(--font-mono)",
};

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
