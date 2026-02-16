import type { PatientInsightsDTO, Tab } from "./types";

export type LoadedPatientBundle = {
  entryKey: string;
  bundleId: string;
  patientId?: string;
  name: string;
  dob?: string;
  sex?: string;
  loadedAt: string;
  dto: PatientInsightsDTO;
};

export type AgeTier = "u21" | "u60" | "o60" | "unknown";
export type SexTone = "male" | "female" | "other";

export function patientIdentityKey(dto: PatientInsightsDTO): string {
  const id = String(dto?.patient?.id ?? "").trim();
  if (id) return `id:${id}`;
  const name = String(dto?.patient?.name ?? "").trim().toLowerCase();
  const dob = String(dto?.patient?.dob ?? "").trim();
  const sex = String(dto?.patient?.sex ?? "").trim().toLowerCase();
  return `n:${name}|d:${dob}|s:${sex}`;
}

export function ageFromDob(dob?: string): number | undefined {
  const raw = String(dob ?? "").trim();
  if (!raw || raw === "n/a") return undefined;
  const birth = new Date(raw);
  if (Number.isNaN(birth.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  const dayDiff = now.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age >= 0 ? age : undefined;
}

export function ageTierFromAge(age?: number): AgeTier {
  if (age == null) return "unknown";
  if (age < 21) return "u21";
  if (age < 60) return "u60";
  return "o60";
}

export function sexToneFromSex(sex?: string): SexTone {
  const s = String(sex ?? "").toLowerCase();
  if (s === "male") return "male";
  if (s === "female") return "female";
  return "other";
}

export function buildPersonChart(dto: PatientInsightsDTO | null, personResource: any) {
  if (!dto) return null;
  const p: any = personResource;
  const nameObj = Array.isArray(p?.name) ? p.name[0] : undefined;
  const fullName = nameObj
    ? `${Array.isArray(nameObj.given) ? nameObj.given.join(" ") : ""} ${nameObj.family ?? ""}`.trim()
    : (dto.patient?.name ?? "n/a");
  const addressObj = Array.isArray(p?.address) ? p.address[0] : undefined;
  const addressLine = addressObj
    ? `${Array.isArray(addressObj.line) ? addressObj.line.join(", ") : ""}${addressObj.city ? `, ${addressObj.city}` : ""}${addressObj.state ? `, ${addressObj.state}` : ""}${addressObj.postalCode ? ` ${addressObj.postalCode}` : ""}`.trim().replace(/^,\s*/, "")
    : "n/a";
  const telecomObj = Array.isArray(p?.telecom) ? p.telecom[0] : undefined;
  const telecom = telecomObj?.value ? `${telecomObj.system ?? "contact"}: ${telecomObj.value}` : "n/a";
  const identifierObj = Array.isArray(p?.identifier) ? p.identifier[0] : undefined;
  const identifier = identifierObj?.value ?? "n/a";
  const links = Array.isArray(p?.link) ? p.link.length : 0;
  return {
    id: p?.id ?? dto.patient?.id ?? "n/a",
    name: fullName || "n/a",
    dob: p?.birthDate ?? dto.patient?.dob ?? "n/a",
    gender: p?.gender ?? dto.patient?.sex ?? "n/a",
    address: addressLine || "n/a",
    contact: telecom,
    identifier,
    links,
    hasPerson: !!p,
  };
}

export function buildOrgChart(dto: PatientInsightsDTO | null) {
  if (!dto?.resources) return { items: [] as Array<{ id: string; label: string; name: string; count: number; code: string; display: string }>, max: 1 };
  const all = Object.values(dto.resources) as any[];
  const orgs = all.filter((r) => r?.resourceType === "Organization");
  const items = orgs.map((o: any) => {
    const id = String(o?.id ?? "unknown");
    const name = String(o?.name ?? "n/a");
    const label = name !== "n/a" ? name : id;
    const type = Array.isArray(o?.type) ? o.type[0] : undefined;
    const coding = Array.isArray(type?.coding) ? type.coding[0] : undefined;
    const code = String(coding?.code ?? "n/a");
    const display = String(coding?.display ?? "n/a");
    const count = all.filter((r: any) => {
      const src = String(r?.meta?.source ?? "").trim();
      return !!src && (src === id || src === label);
    }).length;
    return { id, label, name, count: Math.max(1, count), code, display };
  });
  const max = Math.max(1, ...items.map((i) => i.count));
  return { items, max };
}

export function buildNextOfKinChart(dto: PatientInsightsDTO | null) {
  if (!dto?.resources) {
    return { items: [] as Array<{ id: string; label: string; relation: string; phone: string; count: number }>, max: 1 };
  }
  const all = Object.values(dto.resources) as any[];
  const related = all.filter((r) => r?.resourceType === "RelatedPerson");
  const items = related.map((rp: any) => {
    const id = String(rp?.id ?? "unknown");
    const nameObj = Array.isArray(rp?.name) ? rp.name[0] : undefined;
    const label = nameObj
      ? `${Array.isArray(nameObj.given) ? nameObj.given.join(" ") : ""} ${nameObj.family ?? ""}`.trim() || id
      : id;
    const relCoding = Array.isArray(rp?.relationship) ? rp.relationship.flatMap((x: any) => (Array.isArray(x?.coding) ? x.coding : [])) : [];
    const relation = String(relCoding?.[0]?.display ?? relCoding?.[0]?.code ?? "n/a");
    const telecom0 = Array.isArray(rp?.telecom) ? rp.telecom[0] : undefined;
    const phone = telecom0?.value ? String(telecom0.value) : "n/a";
    const count = all.filter((r: any) => {
      const src = String(r?.meta?.source ?? "").trim();
      return !!src && (src === id || src === label);
    }).length;
    return { id, label, relation, phone, count: Math.max(1, count) };
  });
  const max = Math.max(1, ...items.map((i) => i.count));
  return { items, max };
}

export function buildLocationChart(dto: PatientInsightsDTO | null) {
  if (!dto?.resources) return { items: [] as Array<{ id: string; label: string; name: string; count: number; code: string; display: string }>, max: 1 };
  const all = Object.values(dto.resources) as any[];
  const locations = all.filter((r) => r?.resourceType === "Location");
  const items = locations.map((l: any) => {
    const id = String(l?.id ?? "unknown");
    const name = String(l?.name ?? "n/a");
    const label = name !== "n/a" ? name : id;
    const type = Array.isArray(l?.type) ? l.type[0] : undefined;
    const coding = Array.isArray(type?.coding) ? type.coding[0] : undefined;
    const code = String(coding?.code ?? "n/a");
    const display = String(coding?.display ?? "n/a");
    const count = all.filter((r: any) => {
      const src = String(r?.meta?.source ?? "").trim();
      return !!src && (src === id || src === label);
    }).length;
    return { id, label, name, count: Math.max(1, count), code, display };
  });
  const max = Math.max(1, ...items.map((i) => i.count));
  return { items, max };
}

export function buildNavCounts(dto: PatientInsightsDTO | null): Record<Tab, number> {
  const snapshot = dto?.snapshot;
  const timeline = dto?.timeline ?? [];
  return {
    snapshot: 0,
    timeline: timeline.length,
    encounters: timeline.filter((e) => e.kind === "encounter").length,
    problems: snapshot?.problems?.length ?? 0,
    procedures: snapshot?.procedures?.length ?? 0,
    vitals: snapshot?.vitals?.length ?? 0,
    labs: snapshot?.labs?.length ?? 0,
    meds: snapshot?.meds?.length ?? 0,
    immunizations: snapshot?.immunizations?.length ?? 0,
    allergies: snapshot?.allergies?.length ?? 0,
    social: snapshot?.socialHistory?.length ?? 0,
    mental: snapshot?.mentalStatus?.length ?? 0,
    docs: timeline.filter((e) => e.kind === "document").length,
  };
}

export function buildPhq9Rows(dto: PatientInsightsDTO | null) {
  if (!dto?.resources) return [] as Array<{ row: any; score?: number; severity: string; abnormal: boolean }>;
  const rows = (dto.snapshot?.mentalStatus ?? []).filter((m) => {
    const label = String(m?.label ?? "").toLowerCase();
    if (label.includes("phq-9") || label.includes("phq 9")) return true;
    const ev = m?.evidence?.[0];
    const key = ev ? `${ev.resourceType}/${ev.id}` : "";
    const obs: any = key ? dto.resources?.[key] : null;
    return String(obs?.code?.coding?.[0]?.code ?? "") === "44261-6";
  });
  return rows.map((row) => {
    const ev = row?.evidence?.[0];
    const key = ev ? `${ev.resourceType}/${ev.id}` : "";
    const obs: any = key ? dto.resources?.[key] : null;
    const scoreRaw = obs?.valueQuantity?.value;
    const score = typeof scoreRaw === "number" ? scoreRaw : Number(scoreRaw);
    let severity = "Unknown";
    if (Number.isFinite(score)) {
      if (score >= 20) severity = "Severe";
      else if (score >= 15) severity = "Moderately severe";
      else if (score >= 10) severity = "Moderate";
      else if (score >= 5) severity = "Mild";
      else severity = "Minimal";
    } else {
      severity =
        String(obs?.interpretation?.[0]?.text ?? obs?.interpretation?.[0]?.coding?.[0]?.display ?? "Unknown");
    }
    return { row, score: Number.isFinite(score) ? score : undefined, severity, abnormal: Number.isFinite(score) ? score >= 10 : /moderate|severe/i.test(severity) };
  });
}
