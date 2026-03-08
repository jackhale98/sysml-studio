import React from "react";
import { useModelStore } from "../../stores/model-store";
import { useUIStore } from "../../stores/ui-store";

export function MbseDashboard() {
  const completeness = useModelStore((s) => s.completeness);
  const traceability = useModelStore((s) => s.traceability);
  const model = useModelStore((s) => s.model);
  const selectElement = useUIStore((s) => s.selectElement);

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
    </div>
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
