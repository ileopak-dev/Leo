import React, { useMemo, useState } from "react";
import { parseHl7 } from "../hl7/parse";
import { COMMON_DICT } from "../hl7/dict_common";
import { PROFILES, detectProfile } from "../hl7/profiles";

const SEGMENT_LABELS: Record<string, string> = {
  MSH: "Message Header",
  EVN: "Event Type",
  PID: "Patient Identification",
  PD1: "Additional Demographics",
  NK1: "Next of Kin",
  PV1: "Patient Visit",
  PV2: "Visit Additional Info",
  IN1: "Insurance",
  IN2: "Insurance Additional Info",
  ORC: "Common Order",
  OBR: "Observation Request",
  OBX: "Observation Result",
  NTE: "Notes and Comments",
  TXA: "Document Notification",
  RXA: "Administration",
  RXR: "Route",
  RXE: "Encoded Order",
  TQ1: "Timing/Quantity",
  PR1: "Procedures",
};

const REQUIRED_FIELDS_BY_VERSION: Record<string, Record<string, number[]>> = {
  default: {
    MSH: [1, 2, 7, 9, 10, 11, 12],
    PID: [3, 5],
    PV1: [2],
    NK1: [2, 3],
    ORC: [1],
    OBR: [4],
    OBX: [2, 3, 5, 11],
    RXA: [3, 5],
    RXR: [1],
  },
  // Version-specific maps can diverge when needed.
  "2.3": {
    MSH: [1, 2, 7, 9, 10, 11, 12],
    PID: [3, 5],
    PV1: [2],
    NK1: [2],
    ORC: [1],
    OBR: [4],
    OBX: [2, 3, 5, 11],
    RXA: [3, 5],
    RXR: [1],
  },
  "2.5.1": {
    MSH: [1, 2, 7, 9, 10, 11, 12],
    PID: [3, 5],
    PV1: [2],
    NK1: [2, 3],
    ORC: [1],
    OBR: [4],
    OBX: [2, 3, 5, 11],
    RXA: [3, 5],
    RXR: [1],
  },
};

function safeChip(v: string): string {
  if (!v) return "—";
  return v.length > 64 ? v.slice(0, 61) + "…" : v;
}

const styles: Record<string, any> = {
  shell: { display: "grid", gridTemplateColumns: "360px 1fr", height: "78vh", gap: 12 },
  panel: { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16 },
  panelPad: { padding: 12 },
  title: { fontWeight: 900, fontSize: 14, letterSpacing: 0.2 },
  small: { fontSize: 12, color: "var(--muted)" },

  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    outline: "none",
    fontSize: 13,
  },

  segBtn: (active: boolean) => ({
    width: "100%",
    textAlign: "left" as const,
    padding: "10px 12px",
    marginBottom: 8,
    borderRadius: 14,
    border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
    background: active ? "rgba(110,231,255,0.10)" : "rgba(255,255,255,0.02)",
    cursor: "pointer",
  }),
  segTopRow: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" },
  segName: { fontWeight: 950, fontSize: 14 },
  segLabel: { fontSize: 12, color: "var(--muted)" },

  headerCard: {
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 12,
    background: "rgba(255,255,255,0.02)",
  },
  headerRow: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" },
  headerLeftTitle: { fontSize: 18, fontWeight: 950 },
  headerLeftMeta: { fontSize: 12, color: "var(--muted)", marginTop: 4 },
  headerGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(220px, 1fr))",
    gap: 8,
    marginTop: 10,
  },
  headerItem: {
    border: "1px solid rgba(38,50,68,0.7)",
    borderRadius: 14,
    padding: 10,
    background: "rgba(255,255,255,0.02)",
    fontSize: 12,
    color: "var(--muted)",
    lineHeight: 1.45,
  },
  headerItemLabel: { color: "var(--text)", fontWeight: 900, marginBottom: 2 },

  warn: {
    marginTop: 10,
    padding: 10,
    borderRadius: 14,
    background: "var(--dangerBg)",
    border: "1px solid var(--dangerBorder)",
    fontSize: 12,
  },
  missingPanel: {
    marginTop: 10,
    padding: 10,
    borderRadius: 14,
    border: "1px solid #fca5a5",
    background: "#fef2f2",
  },
  missingTitle: {
    fontSize: 12,
    fontWeight: 900,
    color: "#991b1b",
    marginBottom: 6,
  },
  missingItem: {
    fontSize: 12,
    color: "#7f1d1d",
    marginBottom: 4,
    fontFamily: "var(--mono)",
  },

  tabsRow: { display: "flex", gap: 8, alignItems: "center" },
  tabBtn: (active: boolean) => ({
    padding: "8px 12px",
    borderRadius: 999,
    border: active ? "2px solid var(--accent2)" : "1px solid var(--border)",
    background: active ? "rgba(167,139,250,0.12)" : "rgba(255,255,255,0.02)",
    cursor: "pointer",
    fontWeight: 900 as const,
    fontSize: 13,
  }),

  pre: { whiteSpace: "pre-wrap" as const, fontFamily: "var(--mono)", fontSize: 13, lineHeight: 1.55 },
  rawParsedBox: {
    border: "1px solid #c8d2e0",
    borderRadius: 12,
    background: "#f8fafc",
    padding: 10,
  },
  rawParsedLine: {
    fontFamily: "var(--mono)",
    fontSize: 13,
    lineHeight: 1.8,
    wordBreak: "break-word" as const,
  },
  rawParsedSeg: {
    color: "#0b3b67",
    fontWeight: 900,
    background: "#dbeafe",
    border: "1px solid #93c5fd",
    borderRadius: 6,
    padding: "1px 6px",
  },
  rawParsedSep: {
    color: "#9a3412",
    fontWeight: 900,
    padding: "0 2px",
  },
  rawParsedVal: {
    color: "#111827",
    background: "#eef2f7",
    border: "1px solid #d6dde7",
    borderRadius: 6,
    padding: "1px 5px",
  },

  fieldRow: { padding: "10px 0", borderBottom: "1px solid rgba(38,50,68,0.7)" },
  fieldTop: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" },
  fieldKey: { fontWeight: 950, fontSize: 13 },
  reqBadge: {
    display: "inline-block",
    marginLeft: 8,
    fontSize: 10,
    fontWeight: 900,
    color: "#7c2d12",
    background: "#ffedd5",
    border: "1px solid #fdba74",
    borderRadius: 999,
    padding: "1px 6px",
    verticalAlign: "middle",
  },
  missingReq: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: 800,
    color: "#b91c1c",
    background: "#fee2e2",
    border: "1px solid #fca5a5",
    borderRadius: 8,
    display: "inline-block",
    padding: "2px 8px",
  },
  fieldRaw: {
    fontSize: 12,
    fontFamily: "var(--mono)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid #c8d2e0",
    background: "#f4f7fb",
    borderRadius: 8,
    padding: "2px 8px",
  },
  fieldRawLabel: { color: "#64748b", fontWeight: 800 },
  fieldRawValue: { color: "#0f172a", fontWeight: 900 },
  fieldDef: { marginTop: 6, fontSize: 12, color: "var(--muted)" },

  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { textAlign: "left" as const, borderBottom: "1px solid var(--border)", padding: "10px 8px", color: "var(--muted)" },
  td: { borderBottom: "1px solid rgba(38,50,68,0.7)", padding: "10px 8px", verticalAlign: "top" as const },
};

export default function Hl7Viewer({ raw }: { raw: string }) {
  const msg = useMemo(() => parseHl7(raw), [raw]);

  const profileId = useMemo(() => detectProfile(raw), [raw]);
  const profile = PROFILES[profileId] ?? PROFILES.GENERIC;

  const [activeIdx, setActiveIdx] = useState(0);
  const [tab, setTab] = useState<"Pretty" | "Grid" | "Raw">("Pretty");
  const [filter, setFilter] = useState("");

  const filteredSegments = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return msg.segments.map((s, i) => ({ s, i }));
    return msg.segments
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.name.toLowerCase().includes(q) || (SEGMENT_LABELS[s.name] ?? "").toLowerCase().includes(q));
  }, [msg.segments, filter]);

  const active = msg.segments[activeIdx];
  const rawLines = useMemo(() => (active?.raw ?? "").split(/\r?\n/).filter(Boolean), [active?.raw]);
  const hl7Version = useMemo(() => {
    const msh = msg.segments.find((s) => s.name === "MSH");
    return msh?.fields.find((f) => f.fieldIndex === 12)?.raw?.trim() || "";
  }, [msg.segments]);
  const requiredRuleVersion = useMemo(() => {
    const v = hl7Version;
    if (!v) return "default";
    if (REQUIRED_FIELDS_BY_VERSION[v]) return v;
    const majorMinorMatch = v.match(/^(\d+\.\d+)/);
    const majorMinor = majorMinorMatch ? majorMinorMatch[1] : "";
    if (majorMinor && REQUIRED_FIELDS_BY_VERSION[majorMinor]) return majorMinor;
    return "default";
  }, [hl7Version]);
  const requiredRules = useMemo(
    () => REQUIRED_FIELDS_BY_VERSION[requiredRuleVersion] ?? REQUIRED_FIELDS_BY_VERSION.default,
    [requiredRuleVersion]
  );
  const missingRequiredRows = useMemo(() => {
    const rows: Array<{ segment: string; fieldIndex: number; label: string; segmentOccurrence: number }> = [];
    const segmentSeen: Record<string, number> = {};
    for (const seg of msg.segments) {
      segmentSeen[seg.name] = (segmentSeen[seg.name] ?? 0) + 1;
      const required = requiredRules[seg.name] ?? [];
      if (!required.length) continue;
      for (const idx of required) {
        const f = seg.fields.find((x) => x.fieldIndex === idx);
        const rawValue = (f?.raw ?? "").trim();
        if (!rawValue) {
          rows.push({
            segment: seg.name,
            fieldIndex: idx,
            label: COMMON_DICT[seg.name]?.fields?.[idx]?.label ?? "Field",
            segmentOccurrence: segmentSeen[seg.name],
          });
        }
      }
    }
    return rows;
  }, [msg.segments, requiredRules]);

  function renderParsedRawLine(line: string, lineIndex: number) {
    const sep = msg.separators.field || "|";
    const parts = line.split(sep);
    if (parts.length === 0) return null;
    return (
      <div key={`raw-${lineIndex}`} style={styles.rawParsedLine}>
        <span style={styles.rawParsedSeg}>{parts[0] || "SEG"}</span>
        {parts.slice(1).map((p, i) => (
          <React.Fragment key={`part-${lineIndex}-${i}`}>
            <span style={styles.rawParsedSep}>{sep}</span>
            <span style={styles.rawParsedVal}>{p === "" ? "∅" : p}</span>
          </React.Fragment>
        ))}
      </div>
    );
  }

  function isRequiredField(segment: string, fieldIndex: number): boolean {
    return (requiredRules[segment] ?? []).includes(fieldIndex);
  }

  return (
    <div style={styles.shell}>
      {/* Left */}
      <div style={{ ...styles.panel, ...styles.panelPad, overflow: "auto" }}>
        <div style={styles.title}>Segments</div>
        <div style={{ height: 8 }} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter (e.g., PID, OBX, RXA)…"
          style={styles.input}
        />
        <div style={{ height: 10 }} />

        {filteredSegments.map(({ s, i }) => (
          <button key={`${s.name}-${i}`} onClick={() => setActiveIdx(i)} style={styles.segBtn(i === activeIdx)}>
            <div style={styles.segTopRow}>
              <div style={styles.segName}>{s.name}</div>
              <div style={styles.segLabel}>
                {COMMON_DICT[s.name]?.segmentLabel ?? SEGMENT_LABELS[s.name] ?? "Segment"}
              </div>
            </div>
            <div style={{ ...styles.small, fontFamily: "var(--mono)", marginTop: 4 }}>
              {s.raw.length > 76 ? s.raw.slice(0, 76) + "…" : s.raw}
            </div>
          </button>
        ))}

        {!filteredSegments.length ? (
          <div style={{ marginTop: 12, color: "var(--muted)", fontSize: 12 }}>No segments match that filter.</div>
        ) : null}
      </div>

      {/* Right */}
      <div style={{ ...styles.panel, ...styles.panelPad, overflow: "auto" }}>
        {/* Profile summary header */}
        <div style={styles.headerCard}>
          <div style={styles.headerRow}>
            <div>
              <div style={styles.headerLeftTitle}>
                <span style={{ color: "var(--accent)" }}>{profile.id}</span>
                <span style={{ color: "var(--muted)", fontWeight: 700 }}> · </span>
                <span style={{ color: "var(--text)", fontWeight: 900 }}>{profile.title}</span>
              </div>
              <div style={styles.headerLeftMeta}>
                {safeChip(profile.summary.find(s => s.label === "Message")?.value(raw) ?? "")}
              </div>
            </div>
          </div>

          <div style={styles.headerGrid}>
            {profile.summary.map((item) => (
              <div key={item.label} style={styles.headerItem}>
                <div style={styles.headerItemLabel}>{item.label}</div>
                <div>{safeChip(item.value(raw))}</div>
              </div>
            ))}
          </div>

          {msg.errors.length ? (
            <div style={styles.warn}>
              <b>Warnings:</b> {msg.errors.join(" ")}
            </div>
          ) : null}
          {missingRequiredRows.length ? (
            <div style={styles.missingPanel}>
              <div style={styles.missingTitle}>Missing Required Fields ({missingRequiredRows.length})</div>
              {missingRequiredRows.slice(0, 20).map((m, i) => (
                <div key={`${m.segment}-${m.segmentOccurrence}-${m.fieldIndex}-${i}`} style={styles.missingItem}>
                  {`${m.segment}[${m.segmentOccurrence}]-${m.fieldIndex} — ${m.label}`}
                </div>
              ))}
              {missingRequiredRows.length > 20 ? (
                <div style={{ ...styles.missingItem, fontFamily: "inherit" }}>
                  +{missingRequiredRows.length - 20} more…
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ height: 12 }} />

        {/* Segment header + tabs */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 950 }}>
              {active?.name ?? "—"}{" "}
              <span style={{ fontWeight: 700, color: "var(--muted)" }}>
                — {active ? (COMMON_DICT[active.name]?.segmentLabel ?? SEGMENT_LABELS[active.name] ?? "Segment") : ""}
              </span>
            </div>
            <div style={styles.small}>
              Separators: field <b style={{ color: "var(--text)" }}>{msg.separators.field}</b> component{" "}
              <b style={{ color: "var(--text)" }}>{msg.separators.component}</b> repetition{" "}
              <b style={{ color: "var(--text)" }}>{msg.separators.repetition}</b>
            </div>
            <div style={styles.small}>
              Required rules: <b style={{ color: "var(--text)" }}>HL7 {requiredRuleVersion}</b>
              {hl7Version ? <span> (message: {hl7Version})</span> : null}
            </div>
          </div>

          <div style={styles.tabsRow}>
            {(["Pretty", "Grid", "Raw"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={styles.tabBtn(tab === t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <hr style={{ margin: "12px 0" }} />

        {!active ? (
          <div style={{ color: "var(--muted)" }}>Paste an HL7 message to begin.</div>
        ) : tab === "Raw" ? (
          <div style={styles.rawParsedBox}>
            {rawLines.length === 0 ? <pre style={styles.pre}>{active.raw}</pre> : rawLines.map((line, i) => renderParsedRawLine(line, i))}
          </div>
        ) : tab === "Grid" ? (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Field</th>
                <th style={styles.th}>Label</th>
                <th style={styles.th}>Required</th>
                <th style={styles.th}>Raw</th>
                <th style={styles.th}>Reps</th>
              </tr>
            </thead>
            <tbody>
              {active.fields.map((f) => {
                const def = COMMON_DICT[active.name]?.fields?.[f.fieldIndex];
                const required = isRequiredField(active.name, f.fieldIndex);
                return (
                  <tr key={f.fieldIndex}>
                    <td style={{ ...styles.td, fontWeight: 950 }}>{active.name}-{f.fieldIndex}</td>
                    <td style={styles.td}>{def?.label ?? "—"}</td>
                    <td style={styles.td}>{required ? "Yes" : "No"}</td>
                    <td style={{ ...styles.td, fontFamily: "var(--mono)" }}>{f.raw === "" ? "∅" : f.raw}</td>
                    <td style={styles.td}>{f.reps.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div>
            {active.fields.map((f) => {
              const def = COMMON_DICT[active.name]?.fields?.[f.fieldIndex];
              const required = isRequiredField(active.name, f.fieldIndex);
              return (
                <div key={f.fieldIndex} style={styles.fieldRow}>
                  <div style={styles.fieldTop}>
                    <div style={styles.fieldKey}>
                      {active.name}-{f.fieldIndex}{" "}
                      <span style={{ fontWeight: 700, color: "var(--muted)" }}>
                        — {def?.label ?? "Field"}
                      </span>
                      {required ? <span style={styles.reqBadge}>Required</span> : null}
                    </div>
                    <div style={styles.fieldRaw}>
                      <span style={styles.fieldRawLabel}>raw:</span>
                      <span style={styles.fieldRawValue}>{f.raw === "" ? "∅" : f.raw}</span>
                    </div>
                  </div>

                  {def?.definition ? <div style={styles.fieldDef}>{def.definition}</div> : null}
                  {required && f.raw === "" ? <div style={styles.missingReq}>Missing required value</div> : null}

                  {f.reps.length > 1 ? (
                    <ul style={{ margin: "8px 0 0 18px" }}>
                      {f.reps.map((r, idx) => (
                        <li key={idx} style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--text)" }}>
                          {r === "" ? "∅" : r}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
