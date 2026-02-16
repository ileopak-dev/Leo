type EvidenceRef = { resourceType: string; id: string; path?: string };

export type PatientInsightsDTO = {
  version: "insights-v1";
  patient: { id: string; name: string; dob?: string; sex?: string; identifiers?: { system?: string; value?: string }[] };
  banners: Array<{ severity: "critical" | "high" | "medium" | "info"; title: string; detail?: string; occurredAt?: string; evidence: EvidenceRef[] }>;
  snapshot: {
    problems: Array<{ text: string; status?: string; onset?: string; evidence: EvidenceRef[] }>;
    procedures: Array<{ text: string; status?: string; at?: string; evidence: EvidenceRef[] }>;
    meds: Array<{ text: string; dosage?: string; patientInstruction?: string; status?: string; changed?: "started" | "stopped" | "changed"; evidence: EvidenceRef[] }>;
    immunizations: Array<{ vaccine: string; status?: string; at?: string; evidence: EvidenceRef[] }>;
    allergies: Array<{ text: string; criticality?: string; evidence: EvidenceRef[] }>;
    socialHistory: Array<{ label: string; latest: string; at?: string; evidence: EvidenceRef[] }>;
    mentalStatus: Array<{ label: string; latest: string; at?: string; evidence: EvidenceRef[] }>;
    vitals: Array<{ code: string; label: string; latest: string; prev?: string; trend?: "up" | "down" | "flat"; evidence: EvidenceRef[] }>;
    labs: Array<{ label: string; latest: string; flag?: "H" | "L" | "A" | "critical"; evidence: EvidenceRef[] }>;
    utilization: { ed12m?: number; ip12m?: number; evidence: EvidenceRef[] };
  };
  timeline: Array<{ at: string; kind: "encounter" | "lab" | "vital" | "med" | "problem" | "procedure" | "document"; label: string; summary?: string; severity?: "critical" | "high" | "medium" | "info"; evidence: EvidenceRef[] }>;
  resources?: Record<string, any>;
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : value != null ? [value] : [];
}

function extractResources(input: any): any[] {
  const out: any[] = [];
  const seen = new Set<any>();

  function walk(node: any) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (typeof node.resourceType === "string" && typeof node.id === "string") {
      out.push(node);
      return;
    }

    if (node.resource && typeof node.resource === "object") {
      walk(node.resource);
      return;
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === "object") walk(value);
    }
  }

  walk(input);
  return out;
}

function dateValue(resource: any): string | undefined {
  return (
    resource?.effectiveDateTime ??
    resource?.effectivePeriod?.end ??
    resource?.effectivePeriod?.start ??
    resource?.issued ??
    resource?.meta?.lastUpdated
  );
}

function dateScore(value?: string): number {
  if (!value) return 0;
  const n = Date.parse(value);
  return Number.isNaN(n) ? 0 : n;
}

function codeLabel(code: any, fallback: string): string {
  if (!code) return fallback;
  if (typeof code?.text === "string" && code.text.trim()) return code.text.trim();
  for (const c of asArray(code?.coding)) {
    if (typeof c?.display === "string" && c.display.trim()) return c.display.trim();
  }
  for (const c of asArray(code?.coding)) {
    if (typeof c?.code === "string" && c.code.trim()) return c.code.trim();
  }
  return fallback;
}

function conditionText(condition: any): string {
  if (typeof condition?.code?.text === "string" && condition.code.text.trim()) return condition.code.text.trim();
  for (const c of asArray(condition?.code?.coding)) {
    if (typeof c?.display === "string" && c.display.trim()) return c.display.trim();
  }
  return "Problem";
}

function conditionStatus(condition: any): string | undefined {
  const clinical = String(condition?.clinicalStatus?.coding?.[0]?.code ?? "").trim();
  if (clinical) return clinical;
  const verification = String(condition?.verificationStatus?.coding?.[0]?.code ?? "").trim();
  if (verification) return verification;
  return undefined;
}

function medicationChange(status: string | undefined): "started" | "stopped" | "changed" | undefined {
  const s = String(status ?? "").toLowerCase();
  if (!s) return undefined;
  if (s === "stopped" || s === "completed" || s === "entered-in-error") return "stopped";
  if (s === "active" || s === "in-progress" || s === "intended") return "started";
  return undefined;
}

function medicationDosageText(resource: any): string | undefined {
  const doseArr = asArray(resource?.dosage);
  const instrArr = asArray(resource?.dosageInstruction);
  const d = (doseArr.length > 0 ? doseArr : instrArr)[0];
  if (!d) return undefined;

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

  return undefined;
}

function medicationPatientInstruction(resource: any): string | undefined {
  const doseArr = asArray(resource?.dosage);
  const instrArr = asArray(resource?.dosageInstruction);
  const d = (doseArr.length > 0 ? doseArr : instrArr)[0];
  const pi = d?.patientInstruction;
  if (typeof pi === "string" && pi.trim()) return pi.trim();
  return undefined;
}

function observationValue(obs: any): string {
  if (obs?.valueQuantity?.value != null) {
    const unit = obs?.valueQuantity?.unit ?? obs?.valueQuantity?.code ?? "";
    return `${obs.valueQuantity.value}${unit ? ` ${unit}` : ""}`;
  }
  if (typeof obs?.valueString === "string" && obs.valueString.trim()) return obs.valueString.trim();
  if (typeof obs?.valueBoolean === "boolean") return obs.valueBoolean ? "Positive" : "Negative";
  if (obs?.valueCodeableConcept) return codeLabel(obs.valueCodeableConcept, "Result available");
  if (typeof obs?.valueInteger === "number") return String(obs.valueInteger);
  if (typeof obs?.valueDateTime === "string" && obs.valueDateTime) return obs.valueDateTime;
  return "Result available";
}

function hasConcreteObservationValue(obs: any): boolean {
  return (
    obs?.valueQuantity?.value != null ||
    (typeof obs?.valueString === "string" && obs.valueString.trim().length > 0) ||
    typeof obs?.valueBoolean === "boolean" ||
    obs?.valueCodeableConcept != null ||
    typeof obs?.valueInteger === "number" ||
    (typeof obs?.valueDateTime === "string" && obs.valueDateTime.length > 0)
  );
}

function observationFlag(obs: any): "H" | "L" | "A" | "critical" | undefined {
  const code = String(obs?.interpretation?.[0]?.coding?.[0]?.code ?? "").toUpperCase();
  if (!code) return undefined;
  if (code === "H" || code === "HH" || code === "HX") return "H";
  if (code === "L" || code === "LL" || code === "LX") return "L";
  if (code === "A" || code === "ABN") return "A";
  if (code === "CRIT" || code === "AA") return "critical";
  return undefined;
}

function refId(reference: string | undefined, expectedType?: string): string | undefined {
  if (!reference || typeof reference !== "string") return undefined;
  const match = reference.match(/^([^/]+)\/(.+)$/);
  if (!match) return undefined;
  if (expectedType && match[1] !== expectedType) return undefined;
  return match[2];
}

function isLabObservation(obs: any): boolean {
  const categories = asArray(obs?.category);
  for (const cat of categories) {
    for (const coding of asArray(cat?.coding)) {
      if (String(coding?.code ?? "").toLowerCase() === "laboratory") return true;
    }
    if (String(cat?.text ?? "").toLowerCase().includes("lab")) return true;
  }
  return false;
}

function isSocialObservation(obs: any): boolean {
  const categories = asArray(obs?.category);
  for (const cat of categories) {
    for (const coding of asArray(cat?.coding)) {
      if (String(coding?.code ?? "").toLowerCase() === "social-history") return true;
    }
    if (String(cat?.text ?? "").toLowerCase().includes("social")) return true;
  }
  const codeText = String(obs?.code?.text ?? "").toLowerCase();
  if (codeText.includes("smok") || codeText.includes("tobacco") || codeText.includes("alcohol")) return true;
  for (const coding of asArray(obs?.code?.coding)) {
    const display = String(coding?.display ?? "").toLowerCase();
    if (display.includes("smok") || display.includes("tobacco") || display.includes("alcohol")) return true;
  }
  return false;
}

function isMentalObservation(obs: any): boolean {
  if (isPhq9Observation(obs)) return true;
  const categories = asArray(obs?.category);
  for (const cat of categories) {
    if (String(cat?.text ?? "").toLowerCase().includes("mental")) return true;
    for (const coding of asArray(cat?.coding)) {
      const code = String(coding?.code ?? "").toLowerCase();
      if (code === "survey") return true;
    }
  }
  const codeText = String(obs?.code?.text ?? "").toLowerCase();
  if (codeText.includes("mental") || codeText.includes("depression") || codeText.includes("anxiety")) return true;
  for (const coding of asArray(obs?.code?.coding)) {
    const display = String(coding?.display ?? "").toLowerCase();
    if (display.includes("mental") || display.includes("depression") || display.includes("anxiety")) return true;
  }
  return false;
}

function isPhq9Observation(obs: any): boolean {
  const codeText = String(obs?.code?.text ?? "").toLowerCase();
  if (codeText.includes("phq-9") || codeText.includes("phq 9")) return true;
  for (const coding of asArray(obs?.code?.coding)) {
    const code = String(coding?.code ?? "").trim();
    const display = String(coding?.display ?? "").toLowerCase();
    if (code === "44261-6") return true; // LOINC PHQ-9 total score
    if (display.includes("phq-9") || display.includes("phq 9")) return true;
  }
  return false;
}

const VITAL_LOINC_CODES = new Set([
  "85354-9", // Blood pressure panel
  "8480-6", // Systolic blood pressure
  "8462-4", // Diastolic blood pressure
  "8867-4", // Heart rate
  "8310-5", // Body temperature
  "9279-1", // Respiratory rate
  "59408-5", // Oxygen saturation
  "2708-6", // Oxygen saturation in arterial blood
  "29463-7", // Body weight
  "3141-9", // Body weight Measured
  "8302-2", // Body height
  "8306-3", // Body height --lying
  "39156-5" // BMI
]);

function isVitalObservation(obs: any): boolean {
  const categories = asArray(obs?.category);
  for (const cat of categories) {
    for (const coding of asArray(cat?.coding)) {
      const code = String(coding?.code ?? "").toLowerCase();
      if (code === "vital-signs" || code === "vitals") return true;
    }
    if (String(cat?.text ?? "").toLowerCase().includes("vital")) return true;
  }

  const code = obs?.code;
  for (const coding of asArray(code?.coding)) {
    const c = String(coding?.code ?? "");
    const d = String(coding?.display ?? "").toLowerCase();
    if (VITAL_LOINC_CODES.has(c)) return true;
    if (
      d.includes("blood pressure") ||
      d.includes("bp systolic") ||
      d.includes("bp diastolic") ||
      d.includes("heart rate") ||
      d.includes("body temperature") ||
      d.includes("respiratory rate") ||
      d.includes("oxygen saturation") ||
      d === "weight" ||
      d === "height" ||
      d.includes("body mass index") ||
      d.includes("bmi")
    ) {
      return true;
    }
  }

  const text = String(code?.text ?? "").toLowerCase();
  if (
    text.includes("blood pressure") ||
    text.includes("heart rate") ||
    text.includes("temperature") ||
    text.includes("respiratory rate") ||
    text.includes("oxygen saturation") ||
    text === "weight" ||
    text === "height" ||
    text.includes("body mass index") ||
    text.includes("bmi")
  ) {
    return true;
  }

  return false;
}

function numericFromValue(value: string | undefined): number | undefined {
  if (!value || typeof value !== "string") return undefined;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : undefined;
}

const CHRONIC_PROBLEM_TERMS = [
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

const CHRONIC_MED_TERMS = [
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

function containsAnyTerm(text: string | undefined, terms: string[]): boolean {
  const t = String(text ?? "").toLowerCase();
  if (!t) return false;
  return terms.some((term) => t.includes(term));
}

function isChronicProblemResource(condition: any): boolean {
  if (!condition || condition.resourceType !== "Condition") return false;
  if (containsAnyTerm(condition?.code?.text, CHRONIC_PROBLEM_TERMS)) return true;
  for (const coding of asArray(condition?.code?.coding)) {
    if (containsAnyTerm(coding?.display, CHRONIC_PROBLEM_TERMS)) return true;
  }
  return false;
}

function isChronicMedicationResource(resource: any, medRef: any): boolean {
  if (!resource) return false;
  if (containsAnyTerm(resource?.medicationCodeableConcept?.text, CHRONIC_MED_TERMS)) return true;
  for (const coding of asArray(resource?.medicationCodeableConcept?.coding)) {
    if (containsAnyTerm(coding?.display, CHRONIC_MED_TERMS)) return true;
  }
  if (containsAnyTerm(medRef?.code?.text, CHRONIC_MED_TERMS)) return true;
  for (const coding of asArray(medRef?.code?.coding)) {
    if (containsAnyTerm(coding?.display, CHRONIC_MED_TERMS)) return true;
  }
  return false;
}

function observationStatus(obs: any): string | undefined {
  const s = String(obs?.status ?? "").trim();
  return s ? s : undefined;
}

function observationAbnormalLabel(obs: any): "High" | "Low" | "Abnormal" | "Critical" | undefined {
  const interp = String(obs?.interpretation?.[0]?.coding?.[0]?.code ?? "").toUpperCase();
  if (interp === "H" || interp === "HH" || interp === "HX") return "High";
  if (interp === "L" || interp === "LL" || interp === "LX") return "Low";
  if (interp === "A" || interp === "ABN") return "Abnormal";
  if (interp === "CRIT" || interp === "AA") return "Critical";

  const value = Number(obs?.valueQuantity?.value);
  const low = Number(obs?.referenceRange?.[0]?.low?.value);
  const high = Number(obs?.referenceRange?.[0]?.high?.value);
  if (Number.isFinite(value) && Number.isFinite(low) && value < low) return "Low";
  if (Number.isFinite(value) && Number.isFinite(high) && value > high) return "High";
  return undefined;
}

function encounterClassCode(encounter: any): string {
  return String(encounter?.class?.code ?? encounter?.class?.display ?? "").trim().toUpperCase();
}

function daysAgo(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

export function buildInsights(bundle: any, opts: { includeResources?: boolean } = {}): PatientInsightsDTO {
  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
  const resources: Record<string, any> = {};

  // Supports both standard Bundle.entry resources and nested section payloads
  // like [{ diagnosticReports: [...] }, { observations: [...] }].
  const extracted = extractResources(entries.length > 0 ? entries : bundle);

  for (const r of extracted) {
    if (r?.resourceType && r?.id) resources[`${r.resourceType}/${r.id}`] = r;
  }

  const patientRes = Object.values(resources).find((r: any) => r.resourceType === "Patient");
  const patientName =
    patientRes?.name?.[0]
      ? `${patientRes.name[0].given?.join(" ") ?? ""} ${patientRes.name[0].family ?? ""}`.trim()
      : "Unknown Patient";

  const patient = {
    id: patientRes?.id ?? "unknown",
    name: patientName,
    dob: patientRes?.birthDate,
    sex: patientRes?.gender,
    identifiers: Array.isArray(patientRes?.identifier)
      ? patientRes.identifier.map((i: any) => ({ system: i.system, value: i.value }))
      : []
  };

  const problems = Object.values(resources)
    .flatMap((resource: any) => {
      if (resource?.resourceType !== "Condition" || !resource?.id) return [];
      return [
        {
          text: conditionText(resource),
          status: conditionStatus(resource),
          onset: resource?.onsetDateTime ?? resource?.recordedDate ?? resource?.abatementDateTime,
          at: resource?.onsetDateTime ?? resource?.recordedDate ?? resource?.meta?.lastUpdated,
          evidence: [{ resourceType: "Condition", id: resource.id }]
        }
      ];
    })
    .sort((a, b) => dateScore(b.at) - dateScore(a.at))
    .map(({ text, status, onset, evidence }) => ({ text, status, onset, evidence }));

  const procedures = Object.values(resources)
    .flatMap((resource: any) => {
      if (resource?.resourceType !== "Procedure" || !resource?.id) return [];
      const at =
        resource?.performedDateTime ??
        resource?.performedPeriod?.end ??
        resource?.performedPeriod?.start ??
        resource?.meta?.lastUpdated;
      return [
        {
          text: codeLabel(resource?.code, "Procedure"),
          status: typeof resource?.status === "string" ? resource.status : undefined,
          at,
          evidence: [{ resourceType: "Procedure", id: resource.id }]
        }
      ];
    })
    .sort((a, b) => dateScore(b.at) - dateScore(a.at))
    .map(({ text, status, at, evidence }) => ({ text, status, at, evidence }));

  const meds = Object.values(resources)
    .flatMap((resource: any) => {
      if (!resource?.resourceType || !resource?.id) return [];
      if (resource.resourceType !== "MedicationStatement" && resource.resourceType !== "MedicationRequest") return [];

      const medRefId = refId(resource?.medicationReference?.reference, "Medication");
      const medRef = medRefId ? resources[`Medication/${medRefId}`] : undefined;
      const text =
        codeLabel(resource?.medicationCodeableConcept, "") ||
        codeLabel(medRef?.code, "") ||
        resource?.medicationReference?.display ||
        "Medication";

      const status = typeof resource?.status === "string" ? resource.status : undefined;
      const dosage = medicationDosageText(resource);
      const patientInstruction = medicationPatientInstruction(resource);
      const at =
        resource?.effectiveDateTime ??
        resource?.effectivePeriod?.start ??
        resource?.effectivePeriod?.end ??
        resource?.dateAsserted ??
        resource?.authoredOn ??
        resource?.meta?.lastUpdated;

      return [
        {
          text,
          dosage,
          patientInstruction,
          status,
          changed: medicationChange(status),
          at,
          evidence: [{ resourceType: resource.resourceType, id: resource.id }]
        }
      ];
    })
    .sort((a, b) => dateScore(b.at) - dateScore(a.at))
    .reduce((acc: Array<{ text: string; dosage?: string; patientInstruction?: string; status?: string; changed?: "started" | "stopped" | "changed"; evidence: EvidenceRef[] }>, med) => {
      if (acc.some((m) => m.text === med.text && m.dosage === med.dosage && m.patientInstruction === med.patientInstruction)) return acc;
      acc.push({ text: med.text, dosage: med.dosage, patientInstruction: med.patientInstruction, status: med.status, changed: med.changed, evidence: med.evidence });
      return acc;
    }, []);

  const allergies = Object.values(resources)
    .flatMap((resource: any) => {
      if (resource?.resourceType !== "AllergyIntolerance" || !resource?.id) return [];
      return [
        {
          text: codeLabel(resource?.code, "Allergy"),
          criticality:
            typeof resource?.criticality === "string"
              ? resource.criticality
              : typeof resource?.reaction?.[0]?.severity === "string"
                ? resource.reaction[0].severity
                : undefined,
          at: resource?.onsetDateTime ?? resource?.recordedDate ?? resource?.meta?.lastUpdated,
          evidence: [{ resourceType: "AllergyIntolerance", id: resource.id }]
        }
      ];
    })
    .sort((a, b) => dateScore(b.at) - dateScore(a.at))
    .map(({ text, criticality, evidence }) => ({ text, criticality, evidence }));

  const socialHistory = Object.values(resources)
    .flatMap((resource: any) => {
      if (resource?.resourceType !== "Observation" || !resource?.id || !isSocialObservation(resource)) return [];
      return [
        {
          label: codeLabel(resource?.code, "Social history"),
          latest: observationValue(resource),
          at: dateValue(resource),
          evidence: [{ resourceType: "Observation", id: resource.id }]
        }
      ];
    })
    .sort((a, b) => dateScore(b.at) - dateScore(a.at))
    .map(({ label, latest, at, evidence }) => ({ label, latest, at, evidence }));

  const mentalStatus = Object.values(resources)
    .flatMap((resource: any) => {
      if (resource?.resourceType !== "Observation" || !resource?.id || !isMentalObservation(resource)) return [];
      return [
        {
          label: codeLabel(resource?.code, "Mental status"),
          latest: observationValue(resource),
          at: dateValue(resource),
          evidence: [{ resourceType: "Observation", id: resource.id }]
        }
      ];
    })
    .sort((a, b) => dateScore(b.at) - dateScore(a.at))
    .map(({ label, latest, at, evidence }) => ({ label, latest, at, evidence }));

  const immunizations = Object.values(resources)
    .flatMap((resource: any) => {
      if (resource?.resourceType !== "Immunization" || !resource?.id) return [];
      const at =
        resource?.occurrenceDateTime ??
        resource?.recorded ??
        resource?.meta?.lastUpdated;
      return [
        {
          vaccine: codeLabel(resource?.vaccineCode, "Immunization"),
          status: typeof resource?.status === "string" ? resource.status : undefined,
          at,
          evidence: [{ resourceType: "Immunization", id: resource.id }]
        }
      ];
    })
    .sort((a, b) => dateScore(b.at) - dateScore(a.at))
    .map(({ vaccine, status, at, evidence }) => ({ vaccine, status, at, evidence }));

  const vitals = Object.values(resources)
    .flatMap((resource: any) => {
      if (resource?.resourceType !== "Observation" || !resource?.id || !isVitalObservation(resource)) return [];
      return [
        {
          code: String(resource?.code?.coding?.[0]?.code ?? resource?.id),
          label: codeLabel(resource.code, "Vital"),
          value: observationValue(resource),
          at: dateValue(resource),
          evidence: [{ resourceType: "Observation", id: resource.id }]
        }
      ];
    })
    .sort((a, b) => dateScore(b.at) - dateScore(a.at))
    .reduce((acc: Array<{ code: string; label: string; latest: string; prev?: string; trend?: "up" | "down" | "flat"; evidence: EvidenceRef[] }>, current) => {
      const existingIndex = acc.findIndex((v) => v.code === current.code || v.label === current.label);
      if (existingIndex === -1) {
        acc.push({ code: current.code, label: current.label, latest: current.value, evidence: current.evidence });
        return acc;
      }

      const existing = acc[existingIndex];
      if (existing.prev == null) {
        const prev = current.value;
        const latestN = numericFromValue(existing.latest);
        const prevN = numericFromValue(prev);
        let trend: "up" | "down" | "flat" | undefined;
        if (latestN != null && prevN != null) {
          if (latestN > prevN) trend = "up";
          else if (latestN < prevN) trend = "down";
          else trend = "flat";
        }
        acc[existingIndex] = { ...existing, prev, trend };
      }
      return acc;
    }, []);

  const labs = Object.values(resources)
    .flatMap((resource: any) => {
      if (!resource?.resourceType || !resource?.id) return [];

      if (resource.resourceType === "Observation" && isLabObservation(resource)) {
        return [
          {
            label: codeLabel(resource.code, "Lab result"),
            latest: observationValue(resource),
            flag: observationFlag(resource),
            at: dateValue(resource),
            evidence: [{ resourceType: "Observation", id: resource.id }]
          }
        ];
      }

      if (resource.resourceType === "DiagnosticReport") {
        const resultRows = asArray(resource?.result)
          .flatMap((resultRef: any) => {
            const observationId = refId(resultRef?.reference, "Observation");
            if (!observationId) return [];
            const observation = resources[`Observation/${observationId}`];
            if (!observation) return [];
            const concrete = hasConcreteObservationValue(observation);
            const flag = observationFlag(observation);
            if (!concrete && !flag) return [];
            return [
              {
                label: codeLabel(observation.code, codeLabel(resource.code, "Diagnostic report")),
                latest: observationValue(observation),
                flag,
                at: dateValue(observation) ?? dateValue(resource),
                evidence: [
                  { resourceType: "DiagnosticReport", id: resource.id },
                  { resourceType: "Observation", id: observation.id }
                ]
              }
            ];
          });

        if (resultRows.length > 0) return resultRows;
        return [];
      }

      return [];
    })
    .sort((a, b) => dateScore(b.at) - dateScore(a.at))
    .map(({ label, latest, flag, evidence }) => ({ label, latest, flag, evidence }));

  const timeline = Object.values(resources)
    .flatMap((resource: any) => {
      if (!resource?.resourceType || !resource?.id) return [];

      if (resource.resourceType === "Encounter") {
        return [
          {
            at: resource?.period?.start ?? resource?.period?.end ?? resource?.meta?.lastUpdated ?? "Unknown date",
            kind: "encounter" as const,
            label: resource?.type?.[0] ? codeLabel(resource.type[0], "Encounter") : "Encounter",
            summary: resource?.status ? `Status: ${resource.status}` : undefined,
            evidence: [{ resourceType: "Encounter", id: resource.id }]
          }
        ];
      }

      if (resource.resourceType === "DiagnosticReport") {
        const resultFlags = asArray(resource?.result)
          .flatMap((resultRef: any) => {
            const observationId = refId(resultRef?.reference, "Observation");
            if (!observationId) return [];
            const observation = resources[`Observation/${observationId}`];
            if (!observation) return [];
            const flag = observationFlag(observation);
            if (!flag) return [];
            return [flag];
          });

        const severity = resultFlags.includes("critical")
          ? ("critical" as const)
          : resultFlags.length > 0
            ? ("high" as const)
            : undefined;

        return [
          {
            at: dateValue(resource) ?? "Unknown date",
            kind: "lab" as const,
            label: codeLabel(resource.code, "Diagnostic report"),
            summary: severity ? `Abnormal result (${resultFlags[0]})` : resource?.status ? `Status: ${resource.status}` : undefined,
            severity,
            evidence: [{ resourceType: "DiagnosticReport", id: resource.id }]
          }
        ];
      }

      if (resource.resourceType === "Condition") {
        return [
          {
            at: resource?.onsetDateTime ?? resource?.recordedDate ?? resource?.meta?.lastUpdated ?? "Unknown date",
            kind: "problem" as const,
            label: conditionText(resource),
            summary: conditionStatus(resource),
            evidence: [{ resourceType: "Condition", id: resource.id }]
          }
        ];
      }

      if (resource.resourceType === "MedicationStatement") {
        return [
          {
            at: resource?.effectiveDateTime ?? resource?.dateAsserted ?? resource?.meta?.lastUpdated ?? "Unknown date",
            kind: "med" as const,
            label: codeLabel(resource?.medicationCodeableConcept, "Medication"),
            summary: resource?.status,
            evidence: [{ resourceType: "MedicationStatement", id: resource.id }]
          }
        ];
      }

      if (resource.resourceType === "Procedure") {
        return [
          {
            at:
              resource?.performedDateTime ??
              resource?.performedPeriod?.end ??
              resource?.performedPeriod?.start ??
              resource?.meta?.lastUpdated ??
              "Unknown date",
            kind: "procedure" as const,
            label: codeLabel(resource?.code, "Procedure"),
            summary: resource?.status,
            evidence: [{ resourceType: "Procedure", id: resource.id }]
          }
        ];
      }

      if (resource.resourceType === "Observation" && isVitalObservation(resource)) {
        return [
          {
            at: dateValue(resource) ?? "Unknown date",
            kind: "vital" as const,
            label: codeLabel(resource.code, "Vital"),
            summary: observationValue(resource),
            evidence: [{ resourceType: "Observation", id: resource.id }]
          }
        ];
      }

      if (resource.resourceType === "DocumentReference") {
        return [
          {
            at: resource?.date ?? resource?.meta?.lastUpdated ?? "Unknown date",
            kind: "document" as const,
            label: codeLabel(resource?.type, "Document"),
            summary: resource?.status,
            evidence: [{ resourceType: "DocumentReference", id: resource.id }]
          }
        ];
      }

      return [];
    })
    .sort((a, b) => dateScore(b.at) - dateScore(a.at));

  const encounters = Object.values(resources).filter((r: any) => r?.resourceType === "Encounter" && r?.id);
  const encountersLast12m = encounters.filter((e: any) => {
    const at = dateScore(e?.period?.start ?? e?.period?.end ?? e?.meta?.lastUpdated);
    return at > 0 && at >= daysAgo(365);
  });
  const ed12m = encountersLast12m.filter((e: any) => encounterClassCode(e).includes("EMER")).length;
  const ip12m = encountersLast12m.filter((e: any) => {
    const c = encounterClassCode(e);
    return c.includes("IMP") || c.includes("INPAT");
  }).length;
  const utilizationEvidence: EvidenceRef[] = encountersLast12m.slice(0, 10).map((e: any) => ({ resourceType: "Encounter", id: e.id }));

  const abnormalLabs = Object.values(resources)
    .filter((r: any) => r?.resourceType === "Observation" && r?.id && isLabObservation(r))
    .map((obs: any) => ({
      id: obs.id,
      label: codeLabel(obs?.code, "Lab result"),
      at: dateValue(obs),
      abnormal: observationAbnormalLabel(obs),
      value: observationValue(obs),
      status: observationStatus(obs)
    }))
    .filter((row) => !!row.abnormal)
    .sort((a, b) => dateScore(b.at) - dateScore(a.at));

  const abnormalVitals = Object.values(resources)
    .filter((r: any) => r?.resourceType === "Observation" && r?.id && isVitalObservation(r))
    .map((obs: any) => ({
      id: obs.id,
      label: codeLabel(obs?.code, "Vital"),
      at: dateValue(obs),
      abnormal: observationAbnormalLabel(obs),
      value: observationValue(obs),
      status: observationStatus(obs)
    }))
    .filter((row) => !!row.abnormal)
    .sort((a, b) => dateScore(b.at) - dateScore(a.at));

  const nonFinalObservations = Object.values(resources)
    .filter((r: any) => r?.resourceType === "Observation" && r?.id && (isLabObservation(r) || isVitalObservation(r)))
    .filter((obs: any) => {
      const s = String(observationStatus(obs) ?? "").toLowerCase();
      return !!s && s !== "final";
    });

  const severeAllergies = Object.values(resources)
    .filter((r: any) => r?.resourceType === "AllergyIntolerance" && r?.id)
    .filter((a: any) => {
      const c = String(a?.criticality ?? a?.reaction?.[0]?.severity ?? "").toLowerCase();
      return c.includes("high") || c.includes("severe");
    })
    .map((a: any) => ({
      id: a.id,
      text: codeLabel(a?.code, "Allergy"),
      at: a?.onsetDateTime ?? a?.recordedDate ?? a?.meta?.lastUpdated
    }))
    .sort((a, b) => dateScore(b.at) - dateScore(a.at));

  const chronicProblems = Object.values(resources)
    .filter((r: any) => r?.resourceType === "Condition" && r?.id && isChronicProblemResource(r))
    .map((c: any) => ({
      id: c.id,
      text: conditionText(c),
      at: c?.onsetDateTime ?? c?.recordedDate ?? c?.meta?.lastUpdated
    }))
    .sort((a, b) => dateScore(b.at) - dateScore(a.at));

  const chronicMeds = Object.values(resources)
    .filter((r: any) => (r?.resourceType === "MedicationStatement" || r?.resourceType === "MedicationRequest") && r?.id)
    .filter((m: any) => {
      const medRefId = refId(m?.medicationReference?.reference, "Medication");
      const medRef = medRefId ? resources[`Medication/${medRefId}`] : undefined;
      return isChronicMedicationResource(m, medRef);
    })
    .map((m: any) => ({
      id: m.id,
      resourceType: m.resourceType,
      text: codeLabel(m?.medicationCodeableConcept, "Medication"),
      at: m?.effectiveDateTime ?? m?.effectivePeriod?.start ?? m?.authoredOn ?? m?.dateAsserted ?? m?.meta?.lastUpdated
    }))
    .sort((a, b) => dateScore(b.at) - dateScore(a.at));

  const recentAcuteEncounters = encounters
    .map((e: any) => ({
      id: e.id,
      at: e?.period?.start ?? e?.period?.end ?? e?.meta?.lastUpdated,
      classCode: encounterClassCode(e),
      label: e?.type?.[0] ? codeLabel(e.type[0], "Encounter") : "Encounter",
      status: String(e?.status ?? "").trim()
    }))
    .filter((e) => dateScore(e.at) >= daysAgo(30))
    .filter((e) => e.classCode.includes("EMER") || e.classCode.includes("IMP") || e.classCode.includes("INPAT"))
    .sort((a, b) => dateScore(b.at) - dateScore(a.at));

  const banners: PatientInsightsDTO["banners"] = [];
  if (abnormalLabs.length > 0) {
    const top = abnormalLabs[0];
    const critical = abnormalLabs.some((r) => r.abnormal === "Critical");
    banners.push({
      severity: critical ? "critical" : "high",
      title: `${abnormalLabs.length} abnormal lab result${abnormalLabs.length > 1 ? "s" : ""}`,
      detail: `${top.label}: ${top.value} (${top.abnormal})`,
      occurredAt: top.at,
      evidence: [{ resourceType: "Observation", id: top.id }]
    });
  }
  if (abnormalVitals.length > 0) {
    const top = abnormalVitals[0];
    banners.push({
      severity: "high",
      title: `${abnormalVitals.length} abnormal vital${abnormalVitals.length > 1 ? "s" : ""}`,
      detail: `${top.label}: ${top.value} (${top.abnormal})`,
      occurredAt: top.at,
      evidence: [{ resourceType: "Observation", id: top.id }]
    });
  }
  if (severeAllergies.length > 0) {
    const top = severeAllergies[0];
    banners.push({
      severity: "critical",
      title: `${severeAllergies.length} severe allerg${severeAllergies.length > 1 ? "ies" : "y"}`,
      detail: top.text,
      occurredAt: top.at,
      evidence: [{ resourceType: "AllergyIntolerance", id: top.id }]
    });
  }
  if (recentAcuteEncounters.length > 0) {
    const top = recentAcuteEncounters[0];
    const edCount = recentAcuteEncounters.filter((e) => e.classCode.includes("EMER")).length;
    const ipCount = recentAcuteEncounters.filter((e) => e.classCode.includes("IMP") || e.classCode.includes("INPAT")).length;
    banners.push({
      severity: "medium",
      title: `Recent acute utilization: ED ${edCount}, IP ${ipCount}`,
      detail: `${top.label}${top.status ? ` • ${top.status}` : ""}`,
      occurredAt: top.at,
      evidence: [{ resourceType: "Encounter", id: top.id }]
    });
  }
  if (nonFinalObservations.length > 0) {
    const top = nonFinalObservations[0];
    banners.push({
      severity: "info",
      title: `${nonFinalObservations.length} observation${nonFinalObservations.length > 1 ? "s are" : " is"} not final`,
      detail: `${codeLabel(top?.code, "Observation")} • status ${observationStatus(top) ?? "unknown"}`,
      occurredAt: dateValue(top),
      evidence: [{ resourceType: "Observation", id: top.id }]
    });
  }
  if (chronicProblems.length > 0 || chronicMeds.length > 0) {
    const topProblem = chronicProblems[0];
    const topMed = chronicMeds[0];
    const evidence: EvidenceRef[] = [
      ...chronicProblems.slice(0, 6).map((p) => ({ resourceType: "Condition" as const, id: p.id })),
      ...chronicMeds.slice(0, 6).map((m) => ({ resourceType: m.resourceType, id: m.id }))
    ].slice(0, 10);
    banners.push({
      severity: "info",
      title: `Chronic burden: ${chronicProblems.length} problems, ${chronicMeds.length} meds`,
      detail: topProblem?.text ?? topMed?.text ?? "Chronic disease indicators present",
      occurredAt: topProblem?.at ?? topMed?.at,
      evidence
    });
  }

  return {
    version: "insights-v1",
    patient,
    banners: banners.slice(0, 8),
    snapshot: { problems, procedures, meds, immunizations, allergies, socialHistory, mentalStatus, vitals, labs, utilization: { ed12m, ip12m, evidence: utilizationEvidence } },
    timeline,
    resources: opts.includeResources ? resources : undefined
  };
}
