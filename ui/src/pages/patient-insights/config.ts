import { Activity, AlertTriangle, FileText, FlaskConical, Hospital, Pill, ShieldAlert, Stethoscope } from "lucide-react";
import type { Tab, TimelineKind } from "./types";

export const nav: Array<{ key: Tab; label: string; icon: any }> = [
  { key: "snapshot", label: "Synopsis", icon: Activity },
  { key: "timeline", label: "Timeline", icon: FileText },
  { key: "encounters", label: "Encounters", icon: Hospital },
  { key: "problems", label: "Problems", icon: Stethoscope },
  { key: "procedures", label: "Procedures", icon: Activity },
  { key: "vitals", label: "Vitals", icon: Activity },
  { key: "labs", label: "Labs", icon: FlaskConical },
  { key: "meds", label: "Meds", icon: Pill },
  { key: "immunizations", label: "Immunizations", icon: ShieldAlert },
  { key: "allergies", label: "Allergies", icon: AlertTriangle },
  { key: "social", label: "Social History", icon: FileText },
  { key: "mental", label: "Mental Status", icon: Activity },
  { key: "phq9", label: "PHQ-9", icon: FileText },
];

export const timelineKindMeta: Array<{ kind: TimelineKind; label: string; icon: any }> = [
  { kind: "encounter", label: "Encounters", icon: Hospital },
  { kind: "lab", label: "Labs", icon: FlaskConical },
  { kind: "vital", label: "Vitals", icon: Activity },
  { kind: "problem", label: "Problems", icon: Stethoscope },
  { kind: "procedure", label: "Procedures", icon: Activity },
  { kind: "med", label: "Meds", icon: Pill },
  { kind: "document", label: "Docs", icon: FileText },
];
