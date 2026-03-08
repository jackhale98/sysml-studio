import React, { useState } from "react";
import { useModelStore } from "../../stores/model-store";
import { useUIStore } from "../../stores/ui-store";
import type { SysmlModel, TraceabilityEntry, ValidationReport } from "../../lib/element-types";

type ExportTab = "analysis" | "table";

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildTraceabilityCsv(traceability: TraceabilityEntry[]): string {
  const rows = [["Requirement", "Satisfied By", "Verified By", "Allocated To"]];
  for (const entry of traceability) {
    rows.push([
      entry.requirement_name,
      entry.satisfied_by.map(l => l.element_name).join("; ") || "—",
      entry.verified_by.map(l => l.element_name).join("; ") || "—",
      entry.allocated_to.map(l => l.element_name).join("; ") || "—",
    ]);
  }
  return rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
}

function buildElementsCsv(model: SysmlModel): string {
  const rows = [["ID", "Kind", "Name", "Qualified Name", "Category", "Type Ref", "Parent ID", "Line"]];
  for (const el of model.elements) {
    const k = typeof el.kind === "string" ? el.kind : (el.kind as any).other ?? "";
    rows.push([
      String(el.id), k, el.name ?? "", el.qualified_name, el.category,
      el.type_ref ?? "", el.parent_id !== null ? String(el.parent_id) : "",
      String(el.span.start_line + 1),
    ]);
  }
  return rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
}

function buildValidationCsv(model: SysmlModel, validation: ValidationReport): string {
  const rows = [["Severity", "Element", "Category", "Message"]];
  for (const issue of validation.issues) {
    const el = model.elements.find(e => e.id === issue.element_id);
    rows.push([issue.severity, el?.name ?? `#${issue.element_id}`, issue.category, issue.message]);
  }
  return rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function MbseDashboard() {
  const completeness = useModelStore((s) => s.completeness);
  const traceability = useModelStore((s) => s.traceability);
  const validation = useModelStore((s) => s.validation);
  const model = useModelStore((s) => s.model);
  const selectElement = useUIStore((s) => s.selectElement);
  const navigateToEditor = useUIStore((s) => s.navigateToEditor);
  const [exportTab, setExportTab] = useState<ExportTab>("analysis");

  if (!model) {
    return (
      <div style={{
        padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13,
      }}>
        Load a model to view MBSE analysis
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
      {/* Tab Switcher */}
      <div style={{
        display: "flex", gap: 0, marginBottom: 14,
        borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)",
      }}>
        {(["analysis", "table"] as ExportTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setExportTab(tab)}
            style={{
              flex: 1, padding: "8px 0", border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
              textTransform: "uppercase", letterSpacing: "0.06em",
              background: exportTab === tab ? "var(--accent)" : "var(--bg-tertiary)",
              color: exportTab === tab ? "#fff" : "var(--text-muted)",
            }}
          >
            {tab === "analysis" ? "Analysis" : "Export Tables"}
          </button>
        ))}
      </div>

      {exportTab === "table" && (
        <ExportTablesView model={model} traceability={traceability} validation={validation} />
      )}

      {exportTab === "analysis" && <>
      {/* Completeness Score */}
      {completeness && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)", textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 8,
          }}>
            Model Completeness
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            background: "var(--bg-tertiary)", borderRadius: 8, padding: 12,
            border: "1px solid var(--border)",
          }}>
            <div style={{
              fontSize: 28, fontWeight: 700, fontFamily: "var(--font-mono)",
              color: completeness.score >= 0.8 ? "var(--success)" :
                     completeness.score >= 0.5 ? "var(--warning)" : "var(--error)",
            }}>
              {Math.round(completeness.score * 100)}%
            </div>
            <div style={{ flex: 1 }}>
              {completeness.summary.map((stat) => (
                <div key={stat.label} style={{
                  display: "flex", justifyContent: "space-between",
                  fontSize: 11, fontFamily: "var(--font-mono)", padding: "2px 0",
                }}>
                  <span style={{ color: "var(--text-muted)" }}>{stat.label}</span>
                  <span style={{
                    color: stat.complete === stat.total && stat.total > 0 ? "var(--success)" :
                           stat.total === 0 ? "var(--text-muted)" : "var(--warning)",
                  }}>
                    {stat.complete}/{stat.total}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Requirements Traceability */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: "var(--text-secondary)",
          fontFamily: "var(--font-mono)", textTransform: "uppercase",
          letterSpacing: "0.08em", marginBottom: 8,
        }}>
          Requirements Traceability
        </div>
        {traceability.length === 0 ? (
          <div style={{
            padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 12,
            background: "var(--bg-tertiary)", borderRadius: 8, border: "1px solid var(--border)",
          }}>
            No requirements found in model
          </div>
        ) : (
          traceability.map((entry) => (
            <div
              key={entry.requirement_id}
              style={{
                background: "var(--bg-tertiary)", borderRadius: 8, padding: 10,
                border: "1px solid var(--border)", marginBottom: 8,
              }}
            >
              <div
                onClick={() => selectElement(entry.requirement_id)}
                style={{
                  fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600,
                  color: "#fb7185", cursor: "pointer", marginBottom: 6,
                }}
              >
                {entry.requirement_name}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <TraceBadge
                  label="Satisfied"
                  count={entry.satisfied_by.length}
                  color={entry.satisfied_by.length > 0 ? "#4ade80" : "#ef4444"}
                />
                <TraceBadge
                  label="Verified"
                  count={entry.verified_by.length}
                  color={entry.verified_by.length > 0 ? "#60a5fa" : "#ef4444"}
                />
                <TraceBadge
                  label="Allocated"
                  count={entry.allocated_to.length}
                  color={entry.allocated_to.length > 0 ? "#c084fc" : "#64748b"}
                />
              </div>
              {entry.satisfied_by.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {entry.satisfied_by.map((link) => (
                    <span
                      key={link.element_id}
                      onClick={() => selectElement(link.element_id)}
                      style={{
                        fontSize: 10, fontFamily: "var(--font-mono)", color: "#4ade80",
                        cursor: "pointer", marginRight: 8,
                      }}
                    >
                      {link.element_name} ({link.element_kind})
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Unsatisfied Requirements Alert */}
      {completeness && completeness.unsatisfied_requirements.length > 0 && (
        <div style={{
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 8, padding: 10, marginBottom: 16,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: "#ef4444",
            fontFamily: "var(--font-mono)", marginBottom: 6,
          }}>
            UNSATISFIED REQUIREMENTS ({completeness.unsatisfied_requirements.length})
          </div>
          {completeness.unsatisfied_requirements.map((reqId) => {
            const el = model.elements.find((e) => e.id === reqId);
            return (
              <div
                key={reqId}
                onClick={() => selectElement(reqId)}
                style={{
                  fontSize: 11, fontFamily: "var(--font-mono)", color: "#fca5a5",
                  cursor: "pointer", padding: "2px 0",
                }}
              >
                {el?.name ?? `Element #${reqId}`}
              </div>
            );
          })}
        </div>
      )}

      {/* Model Summary Stats */}
      <div style={{
        fontSize: 12, fontWeight: 700, color: "var(--text-secondary)",
        fontFamily: "var(--font-mono)", textTransform: "uppercase",
        letterSpacing: "0.08em", marginBottom: 8,
      }}>
        Model Summary
      </div>
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
      }}>
        {[
          { label: "Definitions", value: model.stats.definitions, color: "#3b82f6" },
          { label: "Usages", value: model.stats.usages, color: "#10b981" },
          { label: "Relationships", value: model.stats.relationships, color: "#f472b6" },
          { label: "Parse Errors", value: model.stats.errors, color: model.stats.errors > 0 ? "#ef4444" : "#4ade80" },
        ].map((s) => (
          <div key={s.label} style={{
            background: "var(--bg-tertiary)", borderRadius: 8, padding: 10,
            border: "1px solid var(--border)", textAlign: "center",
          }}>
            <div style={{
              fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "var(--font-mono)",
            }}>
              {s.value}
            </div>
            <div style={{
              fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase",
              letterSpacing: "0.06em", fontWeight: 600, marginTop: 2,
            }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Validation Issues */}
      {validation && validation.issues.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)", textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 8,
          }}>
            Validation Issues
          </div>

          {/* Summary badges */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {validation.summary.errors > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)",
                padding: "3px 10px", borderRadius: 4,
                background: "rgba(239,68,68,0.15)", color: "#ef4444",
                border: "1px solid rgba(239,68,68,0.3)",
              }}>
                {validation.summary.errors} error{validation.summary.errors !== 1 ? "s" : ""}
              </span>
            )}
            {validation.summary.warnings > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)",
                padding: "3px 10px", borderRadius: 4,
                background: "rgba(245,158,11,0.15)", color: "#f59e0b",
                border: "1px solid rgba(245,158,11,0.3)",
              }}>
                {validation.summary.warnings} warning{validation.summary.warnings !== 1 ? "s" : ""}
              </span>
            )}
            {validation.summary.infos > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)",
                padding: "3px 10px", borderRadius: 4,
                background: "rgba(59,130,246,0.15)", color: "#60a5fa",
                border: "1px solid rgba(59,130,246,0.3)",
              }}>
                {validation.summary.infos} info{validation.summary.infos !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Errors */}
          {validation.issues.filter(i => i.severity === "error").length > 0 && (
            <div style={{
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8, padding: 10, marginBottom: 8,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "#ef4444",
                fontFamily: "var(--font-mono)", marginBottom: 6,
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                Errors
              </div>
              {validation.issues.filter(i => i.severity === "error").map((issue, idx) => {
                const el = model.elements.find(e => e.id === issue.element_id);
                return (
                  <div
                    key={`err-${idx}`}
                    onClick={() => {
                      if (el) navigateToEditor(el.span.start_line);
                    }}
                    style={{
                      fontSize: 11, fontFamily: "var(--font-mono)", color: "#fca5a5",
                      cursor: "pointer", padding: "3px 0",
                      borderBottom: "1px solid rgba(239,68,68,0.1)",
                    }}
                  >
                    <span style={{ color: "#ef4444", fontWeight: 600 }}>
                      {el?.name ?? `#${issue.element_id}`}
                    </span>
                    {" "}{issue.message}
                  </div>
                );
              })}
            </div>
          )}

          {/* Warnings */}
          {validation.issues.filter(i => i.severity === "warning").length > 0 && (
            <div style={{
              background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 8, padding: 10, marginBottom: 8,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "#f59e0b",
                fontFamily: "var(--font-mono)", marginBottom: 6,
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                Warnings
              </div>
              {validation.issues.filter(i => i.severity === "warning").map((issue, idx) => {
                const el = model.elements.find(e => e.id === issue.element_id);
                return (
                  <div
                    key={`warn-${idx}`}
                    onClick={() => {
                      if (el) navigateToEditor(el.span.start_line);
                    }}
                    style={{
                      fontSize: 11, fontFamily: "var(--font-mono)", color: "#fbbf24",
                      cursor: "pointer", padding: "3px 0",
                      borderBottom: "1px solid rgba(245,158,11,0.1)",
                    }}
                  >
                    <span style={{ color: "#f59e0b", fontWeight: 600 }}>
                      {el?.name ?? `#${issue.element_id}`}
                    </span>
                    {" "}{issue.message}
                  </div>
                );
              })}
            </div>
          )}

          {/* Info */}
          {validation.issues.filter(i => i.severity === "info").length > 0 && (
            <div style={{
              background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.3)",
              borderRadius: 8, padding: 10, marginBottom: 8,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "#60a5fa",
                fontFamily: "var(--font-mono)", marginBottom: 6,
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                Info
              </div>
              {validation.issues.filter(i => i.severity === "info").map((issue, idx) => {
                const el = model.elements.find(e => e.id === issue.element_id);
                return (
                  <div
                    key={`info-${idx}`}
                    onClick={() => {
                      if (el) navigateToEditor(el.span.start_line);
                    }}
                    style={{
                      fontSize: 11, fontFamily: "var(--font-mono)", color: "#93c5fd",
                      cursor: "pointer", padding: "3px 0",
                      borderBottom: "1px solid rgba(59,130,246,0.1)",
                    }}
                  >
                    <span style={{ color: "#60a5fa", fontWeight: 600 }}>
                      {el?.name ?? `#${issue.element_id}`}
                    </span>
                    {" "}{issue.message}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      </>}
    </div>
  );
}

function ExportTablesView({ model, traceability, validation }: {
  model: SysmlModel;
  traceability: TraceabilityEntry[];
  validation: ValidationReport | null;
}) {
  const cellStyle: React.CSSProperties = {
    padding: "6px 8px", fontSize: 11, fontFamily: "var(--font-mono)",
    borderBottom: "1px solid var(--border)", color: "var(--text-primary)",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160,
  };
  const headerStyle: React.CSSProperties = {
    ...cellStyle, fontWeight: 700, color: "var(--text-secondary)",
    background: "var(--bg-secondary)", position: "sticky" as const, top: 0,
    fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em",
  };

  return (
    <div>
      {/* Export Actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <ExportButton label="Elements CSV" onClick={() => downloadCsv("elements.csv", buildElementsCsv(model))} />
        {traceability.length > 0 && (
          <ExportButton label="Traceability CSV" onClick={() => downloadCsv("traceability.csv", buildTraceabilityCsv(traceability))} />
        )}
        {validation && validation.issues.length > 0 && (
          <ExportButton label="Validation CSV" onClick={() => downloadCsv("validation.csv", buildValidationCsv(model, validation))} />
        )}
      </div>

      {/* Traceability Table */}
      {traceability.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)", textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 8,
          }}>
            Traceability Matrix
          </div>
          <div style={{
            border: "1px solid var(--border)", borderRadius: 8, overflow: "auto",
            maxHeight: 300,
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={headerStyle}>Requirement</th>
                  <th style={headerStyle}>Satisfied By</th>
                  <th style={headerStyle}>Verified By</th>
                  <th style={headerStyle}>Allocated To</th>
                </tr>
              </thead>
              <tbody>
                {traceability.map(entry => (
                  <tr key={entry.requirement_id}>
                    <td style={{ ...cellStyle, color: "#fb7185", fontWeight: 600 }}>
                      {entry.requirement_name}
                    </td>
                    <td style={cellStyle}>
                      {entry.satisfied_by.length > 0
                        ? entry.satisfied_by.map(l => l.element_name).join(", ")
                        : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    <td style={cellStyle}>
                      {entry.verified_by.length > 0
                        ? entry.verified_by.map(l => l.element_name).join(", ")
                        : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    <td style={cellStyle}>
                      {entry.allocated_to.length > 0
                        ? entry.allocated_to.map(l => l.element_name).join(", ")
                        : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Elements Table */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: "var(--text-secondary)",
          fontFamily: "var(--font-mono)", textTransform: "uppercase",
          letterSpacing: "0.08em", marginBottom: 8,
        }}>
          All Elements ({model.elements.length})
        </div>
        <div style={{
          border: "1px solid var(--border)", borderRadius: 8, overflow: "auto",
          maxHeight: 400,
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={headerStyle}>Name</th>
                <th style={headerStyle}>Kind</th>
                <th style={headerStyle}>Category</th>
                <th style={headerStyle}>Type</th>
                <th style={headerStyle}>Line</th>
              </tr>
            </thead>
            <tbody>
              {model.elements.filter(e => e.name).map(el => {
                const k = typeof el.kind === "string" ? el.kind : (el.kind as any).other ?? "";
                return (
                  <tr key={el.id}>
                    <td style={{ ...cellStyle, fontWeight: 600 }}>{el.name}</td>
                    <td style={cellStyle}>{k.replace(/_/g, " ")}</td>
                    <td style={cellStyle}>{el.category}</td>
                    <td style={cellStyle}>
                      {el.type_ref ?? <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{el.span.start_line + 1}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Validation Table */}
      {validation && validation.issues.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)", textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 8,
          }}>
            Validation Issues ({validation.issues.length})
          </div>
          <div style={{
            border: "1px solid var(--border)", borderRadius: 8, overflow: "auto",
            maxHeight: 300,
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={headerStyle}>Severity</th>
                  <th style={headerStyle}>Element</th>
                  <th style={headerStyle}>Category</th>
                  <th style={headerStyle}>Message</th>
                </tr>
              </thead>
              <tbody>
                {validation.issues.map((issue, idx) => {
                  const el = model.elements.find(e => e.id === issue.element_id);
                  const sevColor = issue.severity === "error" ? "#ef4444" :
                                   issue.severity === "warning" ? "#f59e0b" : "#60a5fa";
                  return (
                    <tr key={idx}>
                      <td style={{ ...cellStyle, color: sevColor, fontWeight: 700 }}>
                        {issue.severity}
                      </td>
                      <td style={{ ...cellStyle, fontWeight: 600 }}>{el?.name ?? `#${issue.element_id}`}</td>
                      <td style={cellStyle}>{issue.category}</td>
                      <td style={{ ...cellStyle, maxWidth: 220 }}>{issue.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border)",
        background: "var(--bg-tertiary)", color: "var(--text-primary)",
        fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function TraceBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)",
      padding: "2px 8px", borderRadius: 4, border: `1px solid ${color}40`,
      background: `${color}15`, color,
    }}>
      {label}: {count}
    </span>
  );
}
