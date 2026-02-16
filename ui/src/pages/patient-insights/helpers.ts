import type { EvidenceRef, PatientInsightsDTO } from "./types";

type VitalLoincRange = {
  low: number;
  high: number;
  unit?: string;
};

const VITAL_LOINC_FALLBACK_RANGES: Record<string, VitalLoincRange> = {
  // Systolic blood pressure
  "8480-6": { low: 90, high: 120, unit: "mm[Hg]" },
  // Diastolic blood pressure
  "8462-4": { low: 60, high: 80, unit: "mm[Hg]" },
  // Heart rate
  "8867-4": { low: 60, high: 100, unit: "/min" },
  // Respiratory rate
  "9279-1": { low: 12, high: 20, unit: "/min" },
  // Body temperature
  "8310-5": { low: 36.1, high: 37.2, unit: "Cel" },
  // Oxygen saturation by pulse oximetry
  "59408-5": { low: 95, high: 100, unit: "%" },
  // Oxygen saturation in blood
  "2708-6": { low: 95, high: 100, unit: "%" },
  // Body mass index
  "39156-5": { low: 18.5, high: 24.9, unit: "kg/m2" },
};

function loincCodesOf(codeableConcept: any): string[] {
  const codings = Array.isArray(codeableConcept?.coding) ? codeableConcept.coding : [];
  const out: string[] = [];
  for (const c of codings) {
    const system = String(c?.system ?? "").toLowerCase();
    const code = String(c?.code ?? "").trim();
    if (!code) continue;
    if (!system || system.includes("loinc")) out.push(code);
  }
  return out;
}

function isVitalObservation(observation: any): boolean {
  const categories = Array.isArray(observation?.category) ? observation.category : [];
  for (const cat of categories) {
    const codings = Array.isArray(cat?.coding) ? cat.coding : [];
    if (codings.some((c: any) => String(c?.code ?? "").toLowerCase() === "vital-signs")) return true;
  }
  return false;
}

function hasMappedVitalLoinc(observation: any): boolean {
  const rootCodes = loincCodesOf(observation?.code);
  if (rootCodes.some((c) => !!VITAL_LOINC_FALLBACK_RANGES[c])) return true;
  const components = Array.isArray(observation?.component) ? observation.component : [];
  for (const comp of components) {
    const compCodes = loincCodesOf(comp?.code);
    if (compCodes.some((c) => !!VITAL_LOINC_FALLBACK_RANGES[c])) return true;
  }
  return false;
}

function normalizeUnit(unit?: string): string {
  return String(unit ?? "").trim().toLowerCase();
}

function toUnitForRange(value: number, fromUnit: string, targetUnit?: string): number | null {
  if (!Number.isFinite(value)) return null;
  if (!targetUnit) return value;
  const from = normalizeUnit(fromUnit);
  const target = normalizeUnit(targetUnit);
  if (!target) return value;
  if (from === target) return value;

  // Temperature conversion for LOINC 8310-5 fallback.
  if (target === "cel") {
    if (from === "[degf]" || from === "degf" || from === "f" || from === "fahrenheit") {
      return ((value - 32) * 5) / 9;
    }
  }
  if (target === "[degf]" || target === "degf") {
    if (from === "cel" || from === "c" || from === "celsius") {
      return (value * 9) / 5 + 32;
    }
  }
  return null;
}

function rangeTag(value: number, low?: number, high?: number): "Low" | "High" | undefined {
  if (Number.isFinite(value) && Number.isFinite(low) && value < (low as number)) return "Low";
  if (Number.isFinite(value) && Number.isFinite(high) && value > (high as number)) return "High";
  return undefined;
}

function formatRange(low?: number, high?: number, unit?: string): string | undefined {
  const hasLow = Number.isFinite(low);
  const hasHigh = Number.isFinite(high);
  const u = String(unit ?? "").trim();
  if (!hasLow && !hasHigh) return undefined;
  if (hasLow && hasHigh) return `${low}-${high}${u ? ` ${u}` : ""}`;
  if (hasLow) return `>= ${low}${u ? ` ${u}` : ""}`;
  return `<= ${high}${u ? ` ${u}` : ""}`;
}

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

export function fmtUsDob(value?: string): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "n/a") return raw || "n/a";
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US");
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
  if (code.includes("AMB") || code.includes("OUT") || code === "OP") return "amb";
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

export function clinicalDateOf(
  evidence: EvidenceRef[] | undefined,
  resources?: Record<string, any>,
  fallbackDate?: string
): string | undefined {
  const fallback = typeof fallbackDate === "string" && fallbackDate.trim() ? fallbackDate.trim() : undefined;
  if (!evidence || !resources) return fallback;

  for (const ev of evidence) {
    const key = `${ev.resourceType}/${ev.id}`;
    const r = resources[key];
    if (!r) continue;

    const candidates = [
      r?.effectiveDateTime,
      r?.effectivePeriod?.start,
      r?.issued,
      r?.period?.start,
      r?.occurrenceDateTime,
      r?.occurrencePeriod?.start,
      r?.performedDateTime,
      r?.performedPeriod?.start,
      r?.recordedDate,
      r?.authoredOn,
      r?.date,
      r?.onsetDateTime,
      r?.onsetPeriod?.start,
      r?.abatementDateTime,
      r?.meta?.lastUpdated,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
  }

  return fallback;
}

export function withSource(text: string | undefined, source: string | undefined): string {
  return [text, source ? `Source: ${source}` : ""].filter(Boolean).join(" • ");
}

export function sourceLine(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>, fallbackDate?: string): string {
  const source = metaSourceOf(evidence, resources);
  const date = clinicalDateOf(evidence, resources, fallbackDate);
  const dateText = `Date: ${date ? fmtAt(date) : "n/a"}`;
  return source ? `${dateText}\nSource: ${source}` : dateText;
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
    const byObservationRange = rangeTag(value, low, high);
    if (byObservationRange) return byObservationRange;

    // Fallback to canonical LOINC ranges for vital signs when reference ranges are missing.
    const useLoincFallback = isVitalObservation(r) || hasMappedVitalLoinc(r);
    if (!useLoincFallback) continue;

    const hits: Array<"Low" | "High"> = [];

    const rootCodes = loincCodesOf(r?.code);
    const rootValue = Number(r?.valueQuantity?.value);
    const rootUnit = String(r?.valueQuantity?.code ?? r?.valueQuantity?.unit ?? "");
    if (Number.isFinite(rootValue)) {
      for (const code of rootCodes) {
        const rr = VITAL_LOINC_FALLBACK_RANGES[code];
        if (!rr) continue;
        const converted = toUnitForRange(rootValue, rootUnit, rr.unit);
        if (converted == null) continue;
        const tag = rangeTag(converted, rr.low, rr.high);
        if (tag) hits.push(tag);
      }
    }

    const components = Array.isArray(r?.component) ? r.component : [];
    for (const comp of components) {
      const compCodes = loincCodesOf(comp?.code);
      const compValue = Number(comp?.valueQuantity?.value);
      const compUnit = String(comp?.valueQuantity?.code ?? comp?.valueQuantity?.unit ?? "");
      if (!Number.isFinite(compValue)) continue;
      for (const code of compCodes) {
        const rr = VITAL_LOINC_FALLBACK_RANGES[code];
        if (!rr) continue;
        const converted = toUnitForRange(compValue, compUnit, rr.unit);
        if (converted == null) continue;
        const tag = rangeTag(converted, rr.low, rr.high);
        if (tag) hits.push(tag);
      }
    }

    if (hits.includes("High") && hits.includes("Low")) return "Abnormal";
    if (hits.includes("High")) return "High";
    if (hits.includes("Low")) return "Low";
  }
  return undefined;
}

export function observationExpectedRange(evidence: EvidenceRef[] | undefined, resources?: Record<string, any>): string | undefined {
  if (!evidence || !resources) return undefined;
  for (const ev of evidence) {
    const key = `${ev.resourceType}/${ev.id}`;
    const r = resources[key];
    if (!r || r.resourceType !== "Observation") continue;

    const rrLow = Number(r?.referenceRange?.[0]?.low?.value);
    const rrHigh = Number(r?.referenceRange?.[0]?.high?.value);
    const rrUnit = String(r?.referenceRange?.[0]?.low?.unit ?? r?.referenceRange?.[0]?.high?.unit ?? r?.valueQuantity?.unit ?? r?.valueQuantity?.code ?? "");
    const byReferenceRange = formatRange(rrLow, rrHigh, rrUnit);
    if (byReferenceRange) return byReferenceRange;

    const useLoincFallback = isVitalObservation(r) || hasMappedVitalLoinc(r);
    if (!useLoincFallback) continue;

    const parts: string[] = [];
    const seen = new Set<string>();

    const rootCodes = loincCodesOf(r?.code);
    for (const code of rootCodes) {
      const fr = VITAL_LOINC_FALLBACK_RANGES[code];
      if (!fr) continue;
      const rangeText = formatRange(fr.low, fr.high, fr.unit);
      if (!rangeText) continue;
      const item = rangeText;
      if (!seen.has(item)) {
        seen.add(item);
        parts.push(item);
      }
    }

    const components = Array.isArray(r?.component) ? r.component : [];
    for (const comp of components) {
      const compCodes = loincCodesOf(comp?.code);
      for (const code of compCodes) {
        const fr = VITAL_LOINC_FALLBACK_RANGES[code];
        if (!fr) continue;
        const label = String(comp?.code?.text ?? comp?.code?.coding?.[0]?.display ?? code).trim();
        const rangeText = formatRange(fr.low, fr.high, fr.unit);
        if (!rangeText) continue;
        const item = `${label}: ${rangeText}`;
        if (!seen.has(item)) {
          seen.add(item);
          parts.push(item);
        }
      }
    }

    if (parts.length > 0) return parts.join(" • ");
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
