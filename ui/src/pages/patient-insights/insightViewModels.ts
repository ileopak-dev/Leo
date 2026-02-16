import {
  allergyDetailsOf,
  clinicalDateOf,
  fmtAt,
  isChronicMedication,
  isChronicProblem,
  isHighSeverityAllergy,
  metaSourceOf,
  observationAbnormalTag,
  observationExpectedRange,
  sourceLine,
  statusLine,
} from "./helpers";
import type { EvidenceRef, PatientInsightsDTO } from "./types";

export type InsightEvidenceRow = {
  key: string;
  label: string;
  status: string;
  rightMeta?: string;
  evidence?: EvidenceRef;
};

type Banner = NonNullable<PatientInsightsDTO["banners"]>[number];

export function insightBannerKey(banner: Banner): string {
  return `${banner.title}__${banner.detail ?? ""}__${banner.occurredAt ?? ""}`;
}

export function buildSelectedBannerEvidenceRows(
  selectedBanner: Banner | null,
  dto: PatientInsightsDTO | null
): InsightEvidenceRow[] {
  if (!selectedBanner || !dto?.resources) return [];

  if (/^chronic burden:/i.test(selectedBanner.title)) {
    const chronicProblems = (dto.snapshot?.problems ?? [])
      .filter((p) => isChronicProblem(p, dto.resources))
      .map((p, i) => {
        const ev = p.evidence?.[0];
        const key = ev ? `${ev.resourceType}/${ev.id}` : `Problem-${i}`;
        const onsetRaw = p.onset ?? clinicalDateOf(p.evidence, dto.resources);
        const onset = onsetRaw ? fmtAt(onsetRaw) : "n/a";
        const source = metaSourceOf(p.evidence, dto.resources) ?? "n/a";
        const status = p.status ?? "n/a";
        return {
          key,
          label: p.text,
          status: `Status: ${status}`,
          rightMeta: `Onset: ${onset}\nSource: ${source}`,
          evidence: ev,
        };
      });

    const chronicMeds = (dto.snapshot?.meds ?? [])
      .filter((m) => isChronicMedication(m, dto.resources))
      .map((m, i) => {
        const ev = m.evidence?.[0];
        const key = ev ? `${ev.resourceType}/${ev.id}` : `Medication-${i}`;
        const at = clinicalDateOf(m.evidence, dto.resources);
        return {
          key,
          label: `Medication: ${m.text}`,
          status: statusLine(m.evidence, dto.resources, m.status),
          rightMeta: sourceLine(m.evidence, dto.resources, at ?? undefined),
          evidence: ev,
        };
      });

    return [...chronicProblems, ...chronicMeds];
  }

  if (/severe allerg/i.test(selectedBanner.title)) {
    return (dto.snapshot?.allergies ?? [])
      .filter((a) => isHighSeverityAllergy(a))
      .map((a, i) => {
        const ev = a.evidence?.[0];
        const key = ev ? `${ev.resourceType}/${ev.id}` : `Allergy-${i}`;
        const details = allergyDetailsOf(a.evidence, dto.resources);
        const detailLine = `Manifestation: ${details.manifestation || "n/a"} • Note: ${details.note || "n/a"} • Severity: ${details.severity || "n/a"}`;
        const at = clinicalDateOf(a.evidence, dto.resources);
        const source = metaSourceOf(a.evidence, dto.resources) ?? "n/a";
        return {
          key,
          label: a.text,
          status: `${detailLine} • ${statusLine(a.evidence, dto.resources, a.criticality)}`,
          rightMeta: `Onset: ${at ? fmtAt(at) : "n/a"}\nSource: ${source}`,
          evidence: ev,
        };
      });
  }

  return selectedBanner.evidence.map((ev) => {
    const key = `${ev.resourceType}/${ev.id}`;
    const r: any = dto.resources?.[key];
    let label = key;
    if (r) {
      if (r.resourceType === "Condition") label = r?.code?.text ?? r?.code?.coding?.[0]?.display ?? key;
      else if (r.resourceType === "MedicationStatement" || r.resourceType === "MedicationRequest") label = r?.medicationCodeableConcept?.text ?? r?.medicationCodeableConcept?.coding?.[0]?.display ?? key;
      else if (r.resourceType === "Observation") label = r?.code?.text ?? r?.code?.coding?.[0]?.display ?? key;
      else if (r.resourceType === "AllergyIntolerance") label = r?.code?.text ?? r?.code?.coding?.[0]?.display ?? key;
      else if (r.resourceType === "Encounter") label = r?.type?.[0]?.text ?? r?.type?.[0]?.coding?.[0]?.display ?? key;
    }
    const at = clinicalDateOf([ev], dto.resources);
    const abnormalTag = r?.resourceType === "Observation" ? observationAbnormalTag([ev], dto.resources) : undefined;
    const expectedRange = r?.resourceType === "Observation" ? observationExpectedRange([ev], dto.resources) : undefined;
    const baseStatus = statusLine([ev], dto.resources);
    const statusText = abnormalTag
      ? `Abnormal: ${abnormalTag}${expectedRange ? ` • Expected: ${expectedRange}` : ""} • ${baseStatus}`
      : baseStatus;
    return {
      key,
      label,
      status: statusText,
      rightMeta: sourceLine([ev], dto.resources, at ?? undefined),
      evidence: ev,
    };
  });
}

export function buildBannerExpandedMap(dto: PatientInsightsDTO | null): Map<string, { detail: string; occurredAt: string }> {
  const byKey = new Map<string, { detail: string; occurredAt: string }>();
  if (!dto) return byKey;

  const expand = (b: Banner) => {
    if (/^chronic burden:/i.test(b.title)) {
      const items = [
        ...(dto.snapshot?.problems ?? []).filter((p) => isChronicProblem(p, dto.resources)).map((p) => p.text),
        ...(dto.snapshot?.meds ?? []).filter((m) => isChronicMedication(m, dto.resources)).map((m) => m.text),
      ];
      const dates = [
        ...(dto.snapshot?.problems ?? [])
          .filter((p) => isChronicProblem(p, dto.resources))
          .map((p) => p.onset ?? clinicalDateOf(p.evidence, dto.resources))
          .filter(Boolean) as string[],
        ...(dto.snapshot?.meds ?? [])
          .filter((m) => isChronicMedication(m, dto.resources))
          .map((m) => clinicalDateOf(m.evidence, dto.resources))
          .filter(Boolean) as string[],
      ];
      return {
        detail: items.length ? Array.from(new Set(items)).join(" • ") : (b.detail ?? ""),
        occurredAt: dates.length ? Array.from(new Set(dates)).map((d) => fmtAt(d)).join(" • ") : (b.occurredAt ?? ""),
      };
    }

    if (/severe allerg/i.test(b.title)) {
      const items = (dto.snapshot?.allergies ?? []).filter((a) => isHighSeverityAllergy(a)).map((a) => a.text);
      const dates = (dto.snapshot?.allergies ?? [])
        .filter((a) => isHighSeverityAllergy(a))
        .map((a) => clinicalDateOf(a.evidence, dto.resources))
        .filter(Boolean) as string[];
      return {
        detail: items.length ? Array.from(new Set(items)).join(" • ") : (b.detail ?? ""),
        occurredAt: dates.length ? Array.from(new Set(dates)).map((d) => fmtAt(d)).join(" • ") : (b.occurredAt ?? ""),
      };
    }

    return { detail: b.detail ?? "", occurredAt: b.occurredAt ?? "" };
  };

  for (const b of dto.banners ?? []) {
    byKey.set(insightBannerKey(b), expand(b));
  }
  return byKey;
}
