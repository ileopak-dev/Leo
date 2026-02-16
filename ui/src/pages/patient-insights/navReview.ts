import {
  clinicalDateOf,
  dateScore,
  isHighSeverityAllergy,
  observationAbnormalTag,
} from "./helpers";
import type { PatientInsightsDTO, Tab } from "./types";

type Options = {
  recentMonths?: number;
};

function emptyCounts(): Record<Tab, number> {
  return {
    snapshot: 0,
    timeline: 0,
    encounters: 0,
    problems: 0,
    procedures: 0,
    vitals: 0,
    labs: 0,
    meds: 0,
    immunizations: 0,
    allergies: 0,
    social: 0,
    mental: 0,
    phq9: 0,
    docs: 0,
  };
}

export function buildAbnormalNavCounts(dto: PatientInsightsDTO | null, options: Options = {}): Record<Tab, number> {
  const out = emptyCounts();
  if (!dto) return out;

  const cutoff = (() => {
    if (!options.recentMonths || options.recentMonths <= 0) return undefined;
    const d = new Date();
    d.setMonth(d.getMonth() - options.recentMonths);
    return d.getTime();
  })();
  const now = Date.now();

  const includeDate = (dateText?: string) => {
    if (cutoff == null) return true;
    const t = dateScore(dateText);
    return t > 0 && t >= cutoff && t <= now;
  };

  const seen = new Map<Tab, Set<string>>();
  const add = (tab: Tab, id: string) => {
    if (!seen.has(tab)) seen.set(tab, new Set<string>());
    seen.get(tab)!.add(id);
  };
  const evKey = (ev?: { resourceType?: string; id?: string }) => (ev?.resourceType && ev?.id ? `${ev.resourceType}/${ev.id}` : "");

  for (const l of dto.snapshot?.labs ?? []) {
    const at = clinicalDateOf(l.evidence, dto.resources);
    const abnormal = !!l.flag || !!observationAbnormalTag(l.evidence, dto.resources);
    if (abnormal && includeDate(at)) add("labs", evKey(l.evidence?.[0]) || `lab:${l.label}:${at ?? ""}`);
  }

  for (const v of dto.snapshot?.vitals ?? []) {
    const at = clinicalDateOf(v.evidence, dto.resources);
    const abnormal = !!observationAbnormalTag(v.evidence, dto.resources);
    if (abnormal && includeDate(at)) add("vitals", evKey(v.evidence?.[0]) || `vital:${v.label}:${at ?? ""}`);
  }

  for (const a of dto.snapshot?.allergies ?? []) {
    const at = clinicalDateOf(a.evidence, dto.resources);
    if (isHighSeverityAllergy(a) && includeDate(at)) add("allergies", evKey(a.evidence?.[0]) || `allergy:${a.text}:${at ?? ""}`);
  }

  for (const m of dto.snapshot?.mentalStatus ?? []) {
    const at = clinicalDateOf(m.evidence, dto.resources);
    if (!!observationAbnormalTag(m.evidence, dto.resources) && includeDate(at)) {
      add("mental", evKey(m.evidence?.[0]) || `mental:${m.label}:${at ?? ""}`);
    }
  }

  for (const s of dto.snapshot?.socialHistory ?? []) {
    const at = clinicalDateOf(s.evidence, dto.resources);
    if (!!observationAbnormalTag(s.evidence, dto.resources) && includeDate(at)) {
      add("social", evKey(s.evidence?.[0]) || `social:${s.label}:${at ?? ""}`);
    }
  }

  for (const e of dto.timeline ?? []) {
    if (!(e.severity === "critical" || e.severity === "high")) continue;
    if (!includeDate(e.at)) continue;

    const ev = e.evidence?.[0];
    const key = evKey(ev) || `${e.kind}:${e.label}:${e.at}`;

    if (e.kind === "problem") add("problems", key);
    else if (e.kind === "procedure") add("procedures", key);
    else if (e.kind === "med") add("meds", key);
    else if (e.kind === "encounter") add("encounters", key);
    else if (e.kind === "lab") add("labs", key);
    else if (e.kind === "vital") add("vitals", key);
  }

  for (const [tab, ids] of seen.entries()) out[tab] = ids.size;
  return out;
}
