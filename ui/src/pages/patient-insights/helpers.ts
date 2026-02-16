import type { EvidenceRef, PatientInsightsDTO } from "./types";

export function keyOf(ev?: EvidenceRef) {
  if (!ev) return null;
  return `${ev.resourceType}/${ev.id}`;
}

export function parseNumericValue(latest: string): number | null {
  if (typeof latest !== "string") return null;
  const match = latest.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

export function dateScore(value?: string): number {
  if (!value) return 0;
  const n = Date.parse(value);
  return Number.isNaN(n) ? 0 : n;
}

export function fmtAt(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

export function monthKey(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function fmtMonthKey(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return value;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function isAbnormalEvent(event: PatientInsightsDTO["timeline"][number]): boolean {
  if (event.severity === "critical" || event.severity === "high") return true;
  return /abnormal|critical|high/i.test(event.summary ?? "");
}

export function encounterClassCode(encounter: any): string {
  return String(encounter?.class?.code ?? encounter?.class?.display ?? "UNK").toUpperCase();
}

export function encounterToneClass(encounter: any): string {
  const code = encounterClassCode(encounter);
  if (code.includes("EMER")) return "emer";
  if (code.includes("IMP") || code.includes("INPAT")) return "inp";
  if (code.includes("OBS")) return "obs";
  if (code.includes("AMB") || code.includes("OUT")) return "amb";
  return "other";
}

export function encounterDetailsOf(encounter: any, resources?: Record<string, any>): {
  classLabel: string;
  location: string;
  practitioner: string;
  source: string;
} {
  const classLabel = String(encounter?.class?.display ?? encounter?.class?.code ?? "n/a");

  const loc0 = Array.isArray(encounter?.location) ? encounter.location[0] : undefined;
  const locRef = String(loc0?.location?.reference ?? "");
  const locDisplay = String(loc0?.location?.display ?? "");
  let location = "n/a";
  if (locDisplay) {
    location = locDisplay;
  } else if (locRef && resources?.[locRef]?.name) {
    location = String(resources[locRef].name);
  } else if (locRef) {
    location = locRef;
  }

  const p0 = Array.isArray(encounter?.participant) ? encounter.participant[0] : undefined;
  const pRef = String(p0?.individual?.reference ?? "");
  const pDisplay = String(p0?.individual?.display ?? "");
  let practitioner = "n/a";
  if (pDisplay) {
    practitioner = pDisplay;
  } else if (pRef && resources?.[pRef]?.name?.[0]) {
    const n = resources[pRef].name[0];
    practitioner = `${Array.isArray(n?.given) ? n.given.join(" ") : ""} ${n?.family ?? ""}`.trim() || pRef;
  } else if (pRef) {
    practitioner = pRef;
  }

  const source = String(encounter?.meta?.source ?? "").trim() || "n/a";
  return { classLabel, location, practitioner, source };
}

export function clinicalItemValue(event: PatientInsightsDTO["timeline"][number], resources?: Record<string, any>): string | undefined {
  const ev = event?.evidence?.[0];
  const key = ev ? `${ev.resourceType}/${ev.id}` : "";
  const r = key ? resources?.[key] : null;
  if (!r) return event.summary;

  if (r.resourceType === "Observation") {
    if (r?.valueQuantity?.value != null) {
      const unit = r?.valueQuantity?.unit ?? r?.valueQuantity?.code ?? "";
      return `${r.valueQuantity.value}${unit ? ` ${unit}` : ""}`;
    }
    if (typeof r?.valueString === "string" && r.valueString.trim()) return r.valueString.trim();
    if (typeof r?.valueInteger === "number") return String(r.valueInteger);
    if (typeof r?.valueBoolean === "boolean") return r.valueBoolean ? "Positive" : "Negative";
  }
  return event.summary;
}

export function isChronicProblem(problem: { text: string; evidence?: EvidenceRef[] }, resources?: Record<string, any>): boolean {
  const chronicTerms = [
    "chronic",
    "diabetes",
    "hypertension",
    "heart failure",
    "copd",
    "asthma",
    "chronic kidney",
    "ckd",
    "end-stage renal",
    "esrd",
    "atrial fibrillation",
    "coronary artery disease",
    "cad"
  ];

  const text = String(problem?.text ?? "").toLowerCase();
  if (chronicTerms.some((term) => text.includes(term))) return true;

  const ev = problem?.evidence?.[0];
  const key = ev ? `${ev.resourceType}/${ev.id}` : "";
  const condition = key ? resources?.[key] : null;
  if (!condition || condition.resourceType !== "Condition") return false;

  const codeText = String(condition?.code?.text ?? "").toLowerCase();
  if (chronicTerms.some((term) => codeText.includes(term))) return true;

  const codings = Array.isArray(condition?.code?.coding) ? condition.code.coding : [];
  for (const coding of codings) {
    const display = String(coding?.display ?? "").toLowerCase();
    if (chronicTerms.some((term) => display.includes(term))) return true;
  }

  return false;
}

export function isHighSeverityAllergy(allergy: { criticality?: string }): boolean {
  const c = String(allergy?.criticality ?? "").toLowerCase();
  return c.includes("high") || c.includes("severe");
}

export function allergyDetailsOf(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>): { manifestation?: string; note?: string; severity?: string } {
  if (!evidence || !resources) return {};
  for (const ev of evidence) {
    const key = `${ev.resourceType}/${ev.id}`;
    const r = resources[key];
    if (!r || r.resourceType !== "AllergyIntolerance") continue;
    const reaction = Array.isArray(r?.reaction) ? r.reaction[0] : undefined;
    const manifestation =
      reaction?.manifestation?.[0]?.text ??
      reaction?.manifestation?.[0]?.coding?.[0]?.display ??
      reaction?.manifestation?.[0]?.coding?.[0]?.code;
    const note = reaction?.note?.[0]?.text ?? r?.note?.[0]?.text;
    const severity = reaction?.severity ?? r?.criticality;
    return {
      manifestation: typeof manifestation === "string" && manifestation.trim() ? manifestation.trim() : undefined,
      note: typeof note === "string" && note.trim() ? note.trim() : undefined,
      severity: typeof severity === "string" && severity.trim() ? severity.trim() : undefined,
    };
  }
  return {};
}

export function isChronicMedication(med: { text: string; evidence?: EvidenceRef[] }, resources?: Record<string, any>): boolean {
  const chronicMedTerms = [
    "insulin",
    "metformin",
    "glipizide",
    "atorvastatin",
    "rosuvastatin",
    "simvastatin",
    "lisinopril",
    "losartan",
    "amlodipine",
    "metoprolol",
    "carvedilol",
    "furosemide",
    "spironolactone",
    "warfarin",
    "apixaban",
    "rivaroxaban",
    "levothyroxine",
    "tiotropium",
    "albuterol",
    "fluticasone",
    "sertraline",
    "escitalopram"
  ];

  const text = String(med?.text ?? "").toLowerCase();
  if (chronicMedTerms.some((term) => text.includes(term))) return true;

  const ev = med?.evidence?.[0];
  const key = ev ? `${ev.resourceType}/${ev.id}` : "";
  const r = key ? resources?.[key] : null;
  if (!r) return false;

  const candidates = [
    r?.medicationCodeableConcept?.text,
    r?.medicationCodeableConcept?.coding?.[0]?.display,
    r?.code?.text,
    r?.code?.coding?.[0]?.display
  ]
    .filter(Boolean)
    .map((v: string) => String(v).toLowerCase());

  return candidates.some((c) => chronicMedTerms.some((term) => c.includes(term)));
}

export function metaSourceOf(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>): string | undefined {
  if (!evidence || !resources) return undefined;
  for (const ev of evidence) {
    const key = `${ev.resourceType}/${ev.id}`;
    const source = resources?.[key]?.meta?.source;
    if (typeof source === "string" && source.trim()) return source.trim();
  }
  return undefined;
}

export function withSource(text: string | undefined, source: string | undefined): string {
  return [text, source ? `Source: ${source}` : ""].filter(Boolean).join(" • ");
}

export function sourceLine(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>): string {
  const source = metaSourceOf(evidence, resources);
  return source ? `Source: ${source}` : "";
}

export function quantityValueOf(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>): string | undefined {
  if (!evidence || !resources) return undefined;
  for (const ev of evidence) {
    const key = `${ev.resourceType}/${ev.id}`;
    const r = resources[key];
    if (!r) continue;
    if (r?.valueQuantity?.value != null) {
      const unit = r?.valueQuantity?.unit ?? r?.valueQuantity?.code ?? "";
      return `${r.valueQuantity.value}${unit ? ` ${unit}` : ""}`;
    }
  }
  return undefined;
}

export function medicationDosageOf(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>, fallback?: string): string | undefined {
  if (fallback && String(fallback).trim()) return String(fallback).trim();
  if (!evidence || !resources) return undefined;
  for (const ev of evidence) {
    const key = `${ev.resourceType}/${ev.id}`;
    const r = resources[key];
    if (!r) continue;
    const d = (Array.isArray(r?.dosage) ? r.dosage[0] : null) || (Array.isArray(r?.dosageInstruction) ? r.dosageInstruction[0] : null);
    if (!d) continue;
    if (typeof d?.text === "string" && d.text.trim()) return d.text.trim();
    const doseQ = d?.doseAndRate?.[0]?.doseQuantity;
    if (doseQ?.value != null) {
      const unit = doseQ?.unit ?? doseQ?.code ?? "";
      return `${doseQ.value}${unit ? ` ${unit}` : ""}`;
    }
    const rateQ = d?.doseAndRate?.[0]?.rateQuantity;
    if (rateQ?.value != null) {
      const unit = rateQ?.unit ?? rateQ?.code ?? "";
      return `${rateQ.value}${unit ? ` ${unit}` : ""}`;
    }
  }
  return undefined;
}

export function medicationPatientInstructionOf(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>, fallback?: string): string | undefined {
  if (fallback && String(fallback).trim()) return String(fallback).trim();
  if (!evidence || !resources) return undefined;
  for (const ev of evidence) {
    const key = `${ev.resourceType}/${ev.id}`;
    const r = resources[key];
    if (!r) continue;
    const d = (Array.isArray(r?.dosage) ? r.dosage[0] : null) || (Array.isArray(r?.dosageInstruction) ? r.dosageInstruction[0] : null);
    const pi = d?.patientInstruction;
    if (typeof pi === "string" && pi.trim()) return pi.trim();
  }
  return undefined;
}

export function observationValueStringOf(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>, fallback?: string): string | undefined {
  if (!evidence || !resources) return fallback;
  for (const ev of evidence) {
    const key = `${ev.resourceType}/${ev.id}`;
    const r = resources[key];
    if (!r || r.resourceType !== "Observation") continue;
    if (typeof r?.valueString === "string" && r.valueString.trim()) return r.valueString.trim();
  }
  return fallback;
}

export function statusOf(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>): string | undefined {
  if (!evidence || !resources) return undefined;
  for (const ev of evidence) {
    const key = `${ev.resourceType}/${ev.id}`;
    const r = resources[key];
    if (!r) continue;
    if (typeof r?.status === "string" && r.status.trim()) return r.status.trim();
    const clinical = r?.clinicalStatus?.coding?.[0]?.code;
    if (typeof clinical === "string" && clinical.trim()) return clinical.trim();
    const verification = r?.verificationStatus?.coding?.[0]?.code;
    if (typeof verification === "string" && verification.trim()) return verification.trim();
  }
  return undefined;
}

export function statusLine(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>, fallbackStatus?: string): string {
  const status = statusOf(evidence, resources) ?? fallbackStatus ?? "n/a";
  const value = quantityValueOf(evidence, resources);
  return value ? `Status: ${status} • Value: ${value}` : `Status: ${status}`;
}

export function isNonFinalStatus(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>): boolean {
  const raw = statusOf(evidence, resources);
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return false;
  return s !== "final";
}

export function observationAbnormalTag(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>): string | undefined {
  if (!evidence || !resources) return undefined;
  for (const ev of evidence) {
    const key = `${ev.resourceType}/${ev.id}`;
    const r = resources[key];
    if (!r || r.resourceType !== "Observation") continue;

    const interp = String(r?.interpretation?.[0]?.coding?.[0]?.code ?? "").toUpperCase();
    if (interp === "H" || interp === "HH" || interp === "HX") return "High";
    if (interp === "L" || interp === "LL" || interp === "LX") return "Low";
    if (interp === "A" || interp === "ABN") return "Abnormal";
    if (interp === "CRIT" || interp === "AA") return "Critical";

    const value = Number(r?.valueQuantity?.value);
    const low = Number(r?.referenceRange?.[0]?.low?.value);
    const high = Number(r?.referenceRange?.[0]?.high?.value);
    if (Number.isFinite(value) && Number.isFinite(low) && value < low) return "Low";
    if (Number.isFinite(value) && Number.isFinite(high) && value > high) return "High";
  }
  return undefined;
}

export function abnormalValueOf(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>, fallback?: string): string {
  if (!evidence || !resources) return fallback ?? "n/a";
  for (const ev of evidence) {
    const key = `${ev.resourceType}/${ev.id}`;
    const r = resources[key];
    if (!r) continue;

    if (r.resourceType === "Observation") {
      let value = "";
      if (r?.valueQuantity?.value != null) {
        const unit = r?.valueQuantity?.unit ?? r?.valueQuantity?.code ?? "";
        value = `${r.valueQuantity.value}${unit ? ` ${unit}` : ""}`;
      } else if (typeof r?.valueString === "string" && r.valueString.trim()) {
        value = r.valueString.trim();
      } else if (r?.valueCodeableConcept?.text) {
        value = String(r.valueCodeableConcept.text);
      } else if (r?.valueCodeableConcept?.coding?.[0]?.display) {
        value = String(r.valueCodeableConcept.coding[0].display);
      } else if (typeof r?.valueInteger === "number") {
        value = String(r.valueInteger);
      } else if (typeof r?.valueBoolean === "boolean") {
        value = r.valueBoolean ? "Positive" : "Negative";
      }

      const interp = String(r?.interpretation?.[0]?.coding?.[0]?.code ?? "").toUpperCase();
      if (value && interp) return `${value} (${interp})`;
      if (value) return value;
    }

    if (r.resourceType === "AllergyIntolerance") {
      const criticality = String(r?.criticality ?? r?.reaction?.[0]?.severity ?? "").trim();
      if (criticality) return criticality;
    }
  }
  return fallback ?? "n/a";
}

export async function postJSON(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}
