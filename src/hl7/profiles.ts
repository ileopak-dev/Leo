import { parseHl7 } from "./parse";

export type SummaryItem = {
  label: string;
  value: (raw: string) => string;
};

export type GroupRule = {
  title: string;
  segments: string[];
};

export type Hl7Profile = {
  id: string;          // ADT, ORU, VXU, MDM, RDE, PR1, GENERIC
  title: string;       // Human title
  groups: GroupRule[]; // Optional navigator grouping
  summary: SummaryItem[];
};

function getSegment(raw: string, name: string) {
  const msg = parseHl7(raw);
  return msg.segments.find(s => s.name === name);
}

function getField(raw: string, segName: string, idx: number): string {
  const seg = getSegment(raw, segName);
  if (!seg) return "";
  return seg.fields.find(f => f.fieldIndex === idx)?.raw ?? "";
}

function msh9(raw: string) {
  return getField(raw, "MSH", 9);
}

function msgType(raw: string) {
  const v = msh9(raw);
  return (v || "").split("^")[0] || "GENERIC";
}

function countSeg(raw: string, name: string): number {
  const msg = parseHl7(raw);
  return msg.segments.filter(s => s.name === name).length;
}

export function detectProfile(raw: string): string {
  return msgType(raw);
}

export const PROFILES: Record<string, Hl7Profile> = {
  ADT: {
    id: "ADT",
    title: "Admission/Discharge/Transfer",
    groups: [
      { title: "Message", segments: ["MSH", "EVN"] },
      { title: "Patient", segments: ["PID", "PD1", "NK1"] },
      { title: "Visit", segments: ["PV1", "PV2"] },
      { title: "Coverage", segments: ["GT1", "IN1", "IN2", "IN3"] },
      { title: "Clinical", segments: ["AL1", "DG1", "PR1"] },
      { title: "Other", segments: ["NTE"] },
    ],
    summary: [
      { label: "Message", value: (raw) => getField(raw, "MSH", 9) },
      { label: "Control ID", value: (raw) => getField(raw, "MSH", 10) },
      { label: "Message Time", value: (raw) => getField(raw, "MSH", 7) },
      { label: "Patient", value: (raw) => getField(raw, "PID", 5) },
      { label: "MRN", value: (raw) => getField(raw, "PID", 3) },
      { label: "DOB/Sex", value: (raw) => `${getField(raw, "PID", 7)} / ${getField(raw, "PID", 8)}`.trim() },
      { label: "Class/Loc", value: (raw) => `${getField(raw, "PV1", 2)} · ${getField(raw, "PV1", 3)}`.trim() },
    ],
  },

  VXU: {
    id: "VXU",
    title: "Immunization Update",
    groups: [
      { title: "Message", segments: ["MSH", "EVN"] },
      { title: "Patient", segments: ["PID", "PD1", "NK1"] },
      { title: "Visit", segments: ["PV1", "PV2"] },
      { title: "Immunization", segments: ["ORC", "RXA", "RXR", "OBX", "NTE"] },
      { title: "Other", segments: ["Z*"] },
    ],
    summary: [
      { label: "Message", value: (raw) => getField(raw, "MSH", 9) },
      { label: "Control ID", value: (raw) => getField(raw, "MSH", 10) },
      { label: "Patient", value: (raw) => getField(raw, "PID", 5) },
      { label: "MRN", value: (raw) => getField(raw, "PID", 3) },
      { label: "Dose Time", value: (raw) => getField(raw, "RXA", 3) },
      { label: "Vaccine", value: (raw) => getField(raw, "RXA", 5) },
      { label: "Dose", value: (raw) => `${getField(raw, "RXA", 6)} ${getField(raw, "RXA", 7)}`.trim() },
    ],
  },

  ORU: {
    id: "ORU",
    title: "Observation Result",
    groups: [
      { title: "Message", segments: ["MSH"] },
      { title: "Patient", segments: ["PID", "PV1"] },
      { title: "Orders/Results", segments: ["ORC", "OBR", "OBX", "NTE"] },
      { title: "Other", segments: ["Z*"] },
    ],
    summary: [
      { label: "Message", value: (raw) => getField(raw, "MSH", 9) },
      { label: "Control ID", value: (raw) => getField(raw, "MSH", 10) },
      { label: "Patient", value: (raw) => getField(raw, "PID", 5) },
      { label: "MRN", value: (raw) => getField(raw, "PID", 3) },
      { label: "OBR Count", value: (raw) => String(countSeg(raw, "OBR")) },
      { label: "OBX Count", value: (raw) => String(countSeg(raw, "OBX")) },
      { label: "Service", value: (raw) => getField(raw, "OBR", 4) },
    ],
  },

  MDM: {
    id: "MDM",
    title: "Medical Document Management",
    groups: [
      { title: "Message", segments: ["MSH"] },
      { title: "Patient", segments: ["PID", "PV1"] },
      { title: "Document", segments: ["TXA", "OBX", "NTE"] },
      { title: "Other", segments: ["Z*"] },
    ],
    summary: [
      { label: "Message", value: (raw) => getField(raw, "MSH", 9) },
      { label: "Control ID", value: (raw) => getField(raw, "MSH", 10) },
      { label: "Patient", value: (raw) => getField(raw, "PID", 5) },
      { label: "Doc Type", value: (raw) => getField(raw, "TXA", 2) },
      { label: "Activity Time", value: (raw) => getField(raw, "TXA", 12) },
      { label: "OBX Count", value: (raw) => String(countSeg(raw, "OBX")) },
    ],
  },

  RDE: {
    id: "RDE",
    title: "Pharmacy/Treatment Encoded Order",
    groups: [
      { title: "Message", segments: ["MSH"] },
      { title: "Patient", segments: ["PID", "PV1"] },
      { title: "Order", segments: ["ORC", "RXE", "RXR", "TQ1", "NTE"] },
      { title: "Other", segments: ["Z*"] },
    ],
    summary: [
      { label: "Message", value: (raw) => getField(raw, "MSH", 9) },
      { label: "Control ID", value: (raw) => getField(raw, "MSH", 10) },
      { label: "Patient", value: (raw) => getField(raw, "PID", 5) },
      { label: "Placer/Filler", value: (raw) => `${getField(raw, "ORC", 2)} / ${getField(raw, "ORC", 3)}`.trim() },
      { label: "Drug", value: (raw) => getField(raw, "RXE", 2) },
      { label: "Dose", value: (raw) => `${getField(raw, "RXE", 3)} ${getField(raw, "RXE", 5)}`.trim() },
    ],
  },

  PR1: {
    id: "PR1",
    title: "Procedures",
    groups: [
      { title: "Message", segments: ["MSH"] },
      { title: "Patient", segments: ["PID", "PV1"] },
      { title: "Procedures", segments: ["PR1"] },
      { title: "Other", segments: ["DG1", "AL1", "NTE", "Z*"] },
    ],
    summary: [
      { label: "Message", value: (raw) => getField(raw, "MSH", 9) },
      { label: "Control ID", value: (raw) => getField(raw, "MSH", 10) },
      { label: "Patient", value: (raw) => getField(raw, "PID", 5) },
      { label: "Procedure", value: (raw) => getField(raw, "PR1", 3) },
      { label: "Proc Time", value: (raw) => getField(raw, "PR1", 5) },
      { label: "Surgeon", value: (raw) => getField(raw, "PR1", 11) },
    ],
  },

  GENERIC: {
    id: "GENERIC",
    title: "HL7 v2 Message",
    groups: [{ title: "All Segments", segments: [] }],
    summary: [
      { label: "Message", value: (raw) => getField(raw, "MSH", 9) },
      { label: "Control ID", value: (raw) => getField(raw, "MSH", 10) },
      { label: "Version", value: (raw) => getField(raw, "MSH", 12) },
    ],
  },
};
