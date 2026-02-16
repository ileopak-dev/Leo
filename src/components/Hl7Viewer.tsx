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

function safeChip(v: string): string {
  if (!v) return "—";
  return v.length > 64 ? v.slice(0, 61) + "…" : v;
}

const styles: Record<string, React.CSSProperties> = {
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

  fieldRow: { padding: "10px 0", borderBottom: "1px solid rgba(38,50,68,0.7)" },
  fieldTop: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" },
  fieldKey: { fontWeight: 950, fontSize: 13 },
  fieldRaw: { fontSize: 12, color: "var(--muted)", fontFamily: "var(--mono)" },
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
          <pre style={styles.pre}>{active.raw}</pre>
        ) : tab === "Grid" ? (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Field</th>
                <th style={styles.th}>Label</th>
                <th style={styles.th}>Raw</th>
                <th style={styles.th}>Reps</th>
              </tr>
            </thead>
            <tbody>
              {active.fields.map((f) => {
                const def = COMMON_DICT[active.name]?.fields?.[f.fieldIndex];
                return (
                  <tr key={f.fieldIndex}>
                    <td style={{ ...styles.td, fontWeight: 950 }}>{active.name}-{f.fieldIndex}</td>
                    <td style={styles.td}>{def?.label ?? "—"}</td>
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
              return (
                <div key={f.fieldIndex} style={styles.fieldRow}>
                  <div style={styles.fieldTop}>
                    <div style={styles.fieldKey}>
                      {active.name}-{f.fieldIndex}{" "}
                      <span style={{ fontWeight: 700, color: "var(--muted)" }}>
                        — {def?.label ?? "Field"}
                      </span>
                    </div>
                    <div style={styles.fieldRaw}>raw: {f.raw === "" ? "∅" : f.raw}</div>
                  </div>

                  {def?.definition ? <div style={styles.fieldDef}>{def.definition}</div> : null}

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
