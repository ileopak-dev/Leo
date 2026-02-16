import React, { useMemo, useState } from "react";
import { parseHl7 } from "../hl7/parse";
import { COMMON_DICT } from "../hl7/dict_common";
import { ADT_DICT } from "../hl7/dict_adt";
import {
  getAuthoritativeFieldDef,
  getAuthoritativeRequiredFieldIndexes,
  getAuthoritativeSegmentLabel,
  resolveAuthoritativeVersion,
} from "../hl7/dict_authoritative";
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
  SPM: "Specimen",
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

type FriendlyResult = {
  display: string | null;
  error: string | null;
};

type FieldRow = {
  fieldIndex: number;
  raw: string;
  reps: string[];
  label: string;
  definition: string;
  required: boolean;
  friendly: FriendlyResult;
  repFriendly: FriendlyResult[];
};

function parseYmdParts(v: string): { y: number; m: number; d: number } | null {
  if (!/^\d{8}$/.test(v)) return null;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(4, 6));
  const d = Number(v.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function isValidYmd(y: number, m: number, d: number): boolean {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function friendlyDate(value: string): FriendlyResult {
  const v = value.trim();
  if (!v) return { display: null, error: null };

  const dateOnlyFmt = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });

  const isoLike = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+\-]\d{2}:?\d{2})?)?$/;
  const hl7DateOnly = /^\d{8}$/;
  const hl7DateTime = /^\d{8}(?:\d{2}(?:\d{2}(?:\d{2}(?:\.\d{1,6})?)?)?)?(?:[+\-]\d{4})?$/;

  if (isoLike.test(v)) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return { display: null, error: `Invalid date/time: ${v}` };
    return {
      display: v.includes("T") || /\s\d{2}:\d{2}/.test(v) ? dateTimeFmt.format(d) : dateOnlyFmt.format(d),
      error: null,
    };
  }

  if (hl7DateOnly.test(v)) {
    const ymd = parseYmdParts(v);
    if (!ymd || !isValidYmd(ymd.y, ymd.m, ymd.d)) return { display: null, error: `Invalid date/time: ${v}` };
    const dt = new Date(ymd.y, ymd.m - 1, ymd.d);
    return { display: dateOnlyFmt.format(dt), error: null };
  }

  if (hl7DateTime.test(v)) {
    const ymd = parseYmdParts(v.slice(0, 8));
    if (!ymd || !isValidYmd(ymd.y, ymd.m, ymd.d)) return { display: null, error: `Invalid date/time: ${v}` };
    const hh = Number(v.slice(8, 10) || "0");
    const mm = Number(v.slice(10, 12) || "0");
    const ss = Number(v.slice(12, 14) || "0");
    if (hh > 23 || mm > 59 || ss > 59) return { display: null, error: `Invalid date/time: ${v}` };
    const dt = new Date(ymd.y, ymd.m - 1, ymd.d, hh, mm, ss);
    if (Number.isNaN(dt.getTime())) return { display: null, error: `Invalid date/time: ${v}` };
    return { display: dateTimeFmt.format(dt), error: null };
  }

  return { display: null, error: null };
}

function friendlyValue(value: string): FriendlyResult {
  const v = value.trim();
  if (!v) return { display: null, error: null };

  const parts = v.split("^");
  if (parts.length > 1) {
    let convertedAny = false;
    const converted = parts.map((p) => {
      const res = friendlyDate(p);
      if (res.display !== null) {
        convertedAny = true;
        return res.display;
      }
      return p;
    });
    const failed = parts.map((p) => friendlyDate(p).error).find(Boolean) ?? null;
    if (failed) return { display: null, error: failed };
    if (convertedAny) return { display: converted.join("^"), error: null };
    return { display: null, error: null };
  }

  return friendlyDate(v);
}

function isDateLikeDatatype(datatype?: string): boolean {
  const dt = (datatype ?? "").trim().toUpperCase();
  return dt === "TS" || dt === "DT" || dt === "DTM" || dt === "TM";
}

function hasFieldData(rawValue: string, reps: string[]): boolean {
  if (rawValue.trim() !== "") return true;
  return reps.some((r) => r.trim() !== "");
}

function getSegmentLabel(segment: string, authoritativeVersion: string): string {
  return (
    getAuthoritativeSegmentLabel(authoritativeVersion, segment) ??
    ADT_DICT[segment]?.segmentLabel ??
    COMMON_DICT[segment]?.segmentLabel ??
    SEGMENT_LABELS[segment] ??
    "Segment"
  );
}

function getFieldDef(segment: string, fieldIndex: number, authoritativeVersion: string) {
  return (
    getAuthoritativeFieldDef(authoritativeVersion, segment, fieldIndex) ??
    ADT_DICT[segment]?.fields?.[fieldIndex] ??
    COMMON_DICT[segment]?.fields?.[fieldIndex]
  );
}

function getFieldLabel(segment: string, fieldIndex: number, authoritativeVersion: string): string {
  return getFieldDef(segment, fieldIndex, authoritativeVersion)?.label ?? `${segment}-${fieldIndex}`;
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
    border: "1px solid #dbe4f0",
    outline: "none",
    fontSize: 13,
    background: "#ffffff",
    color: "var(--text)",
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
  segPreview: {
    ...{ fontSize: 12, color: "var(--muted)" },
    fontFamily: "var(--mono)",
    marginTop: 4,
    overflowWrap: "anywhere" as const,
    wordBreak: "break-word" as const,
    whiteSpace: "normal" as const,
  },

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
  headerItemValue: {
    overflowWrap: "anywhere" as const,
    wordBreak: "break-word" as const,
    whiteSpace: "normal" as const,
  },

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
  viewOptionsRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12, color: "var(--muted)" },
  optionCheckbox: { width: 14, height: 14, accentColor: "var(--accent)" },
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
  fieldValueStack: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-end",
    gap: 6,
  },
  fieldRawLabel: { color: "#64748b", fontWeight: 800 },
  fieldRawValue: { color: "#0f172a", fontWeight: 900 },
  fieldFriendly: {
    marginTop: 6,
    fontSize: 14,
    color: "var(--muted)",
    fontFamily: "var(--mono)",
  },
  fieldFriendlyError: {
    marginTop: 6,
    fontSize: 13,
    color: "#b91c1c",
    fontWeight: 700,
    fontFamily: "var(--mono)",
  },
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
  const [showPopulatedOnly, setShowPopulatedOnly] = useState(false);

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
  const authoritativeVersion = useMemo(() => resolveAuthoritativeVersion(hl7Version), [hl7Version]);
  const resolvedRequiredRules = useMemo(() => {
    const merged: Record<string, number[]> = { ...requiredRules };
    const segmentNames = Array.from(new Set(msg.segments.map((s) => s.name)));
    for (const segName of segmentNames) {
      const authoritative = getAuthoritativeRequiredFieldIndexes(authoritativeVersion, segName);
      if (authoritative.length > 0) {
        merged[segName] = authoritative;
      }
    }
    return merged;
  }, [authoritativeVersion, msg.segments, requiredRules]);
  const missingRequiredRows = useMemo(() => {
    const rows: Array<{ segment: string; fieldIndex: number; label: string; segmentOccurrence: number }> = [];
    const segmentSeen: Record<string, number> = {};
    for (const seg of msg.segments) {
      segmentSeen[seg.name] = (segmentSeen[seg.name] ?? 0) + 1;
      const required = resolvedRequiredRules[seg.name] ?? [];
      if (!required.length) continue;
      for (const idx of required) {
        const f = seg.fields.find((x) => x.fieldIndex === idx);
        const rawValue = (f?.raw ?? "").trim();
        if (!rawValue) {
          rows.push({
            segment: seg.name,
            fieldIndex: idx,
            label: getFieldLabel(seg.name, idx, authoritativeVersion),
            segmentOccurrence: segmentSeen[seg.name],
          });
        }
      }
    }
    return rows;
  }, [authoritativeVersion, msg.segments, resolvedRequiredRules]);

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

  const activeFieldRows = useMemo<FieldRow[]>(() => {
    if (!active) return [];

    return active.fields
      .map((f): FieldRow | null => {
        const def = getFieldDef(active.name, f.fieldIndex, authoritativeVersion);
        const required = (resolvedRequiredRules[active.name] ?? []).includes(f.fieldIndex);
        if (showPopulatedOnly && !required && !hasFieldData(f.raw, f.reps)) return null;

        const label = getFieldLabel(active.name, f.fieldIndex, authoritativeVersion);
        const definition = def?.definition ?? "";
        const supportsFriendly = isDateLikeDatatype(def?.datatype);
        const friendly = supportsFriendly ? friendlyValue(f.raw) : { display: null, error: null };
        const repFriendly = supportsFriendly ? f.reps.map((r) => friendlyValue(r)) : f.reps.map(() => ({ display: null, error: null }));

        return {
          fieldIndex: f.fieldIndex,
          raw: f.raw,
          reps: f.reps,
          label,
          definition,
          required,
          friendly,
          repFriendly,
        };
      })
      .filter((row): row is FieldRow => row !== null);
  }, [active, authoritativeVersion, resolvedRequiredRules, showPopulatedOnly]);

  return (
    <div style={styles.shell}>
      {/* Left */}
      <div
        style={{
          ...styles.panel,
          ...styles.panelPad,
          overflowY: "auto",
          overflowX: "hidden",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          background: "#ffffff",
          boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
        }}
      >
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
                {getSegmentLabel(s.name, authoritativeVersion)}
              </div>
            </div>
            <div style={styles.segPreview}>
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
                <div style={styles.headerItemValue}>{safeChip(friendlyValue(item.value(raw)).display ?? item.value(raw))}</div>
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
                — {active ? getSegmentLabel(active.name, authoritativeVersion) : ""}
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
            <label style={styles.viewOptionsRow}>
              <input
                type="checkbox"
                checked={showPopulatedOnly}
                onChange={(e) => setShowPopulatedOnly(e.target.checked)}
                style={styles.optionCheckbox}
              />
              Show populated fields only (keep required)
            </label>
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
              {activeFieldRows.map((row) => {
                return (
                  <tr key={row.fieldIndex}>
                    <td style={{ ...styles.td, fontWeight: 950 }}>{active.name}-{row.fieldIndex}</td>
                    <td style={styles.td}>{row.label}</td>
                    <td style={styles.td}>{row.required ? "Yes" : "No"}</td>
                    <td style={{ ...styles.td, fontFamily: "var(--mono)" }}>
                      <div>{row.raw === "" ? "∅" : row.raw}</div>
                      {row.raw !== "" && row.friendly.display ? (
                        <div style={styles.fieldFriendly}>{row.friendly.display}</div>
                      ) : null}
                      {row.raw !== "" && row.friendly.error ? (
                        <div style={styles.fieldFriendlyError}>{row.friendly.error}</div>
                      ) : null}
                    </td>
                    <td style={styles.td}>{row.reps.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div>
            {activeFieldRows.map((row) => {
              return (
                <div key={row.fieldIndex} style={styles.fieldRow}>
                  <div style={styles.fieldTop}>
                    <div style={styles.fieldKey}>
                      {active.name}-{row.fieldIndex}{" "}
                      <span style={{ fontWeight: 700, color: "var(--muted)" }}>
                        — {row.label}
                      </span>
                      {row.required ? <span style={styles.reqBadge}>Required</span> : null}
                    </div>
                    <div style={styles.fieldValueStack}>
                      <div style={styles.fieldRaw}>
                        <span style={styles.fieldRawLabel}>raw:</span>
                        <span style={styles.fieldRawValue}>{row.raw === "" ? "∅" : row.raw}</span>
                      </div>
                      {row.raw !== "" && row.friendly.display ? (
                        <div style={styles.fieldFriendly}>{row.friendly.display}</div>
                      ) : null}
                      {row.raw !== "" && row.friendly.error ? (
                        <div style={styles.fieldFriendlyError}>{row.friendly.error}</div>
                      ) : null}
                    </div>
                  </div>

                  {row.definition ? <div style={styles.fieldDef}>{row.definition}</div> : null}
                  {row.required && row.raw === "" ? <div style={styles.missingReq}>Missing required value</div> : null}

                  {row.reps.length > 1 ? (
                    <ul style={{ margin: "8px 0 0 18px" }}>
                      {row.reps.map((r, idx) => {
                        const repFriendly = row.repFriendly[idx] ?? { display: null, error: null };
                        return (
                          <li key={idx} style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--text)" }}>
                            {r === "" ? "∅" : r}
                            {r !== "" && repFriendly.display ? <div style={styles.fieldFriendly}>{repFriendly.display}</div> : null}
                            {r !== "" && repFriendly.error ? (
                              <div style={styles.fieldFriendlyError}>{repFriendly.error}</div>
                            ) : null}
                          </li>
                        );
                      })}
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
