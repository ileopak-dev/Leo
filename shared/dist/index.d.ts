export type EvidenceRef = {
    resourceType: string;
    id: string;
    path?: string;
};
export type PatientInsightsDTO = {
    version: "insights-v1";
    patient: {
        id: string;
        name: string;
        dob?: string;
        sex?: string;
        identifiers?: {
            system?: string;
            value?: string;
        }[];
    };
    banners: Array<{
        severity: "critical" | "high" | "medium" | "info";
        title: string;
        detail?: string;
        occurredAt?: string;
        evidence: EvidenceRef[];
    }>;
    snapshot: {
        problems: Array<{
            text: string;
            status?: string;
            onset?: string;
            evidence: EvidenceRef[];
        }>;
        meds: Array<{
            text: string;
            status?: string;
            changed?: "started" | "stopped" | "changed";
            evidence: EvidenceRef[];
        }>;
        allergies: Array<{
            text: string;
            criticality?: string;
            evidence: EvidenceRef[];
        }>;
        vitals: Array<{
            code: string;
            label: string;
            latest: string;
            prev?: string;
            trend?: "up" | "down" | "flat";
            evidence: EvidenceRef[];
        }>;
        labs: Array<{
            label: string;
            latest: string;
            flag?: "H" | "L" | "A" | "critical";
            evidence: EvidenceRef[];
        }>;
        utilization: {
            ed12m?: number;
            ip12m?: number;
            evidence: EvidenceRef[];
        };
    };
    timeline: Array<{
        at: string;
        kind: "encounter" | "lab" | "vital" | "med" | "problem" | "document";
        label: string;
        summary?: string;
        severity?: "critical" | "high" | "medium" | "info";
        evidence: EvidenceRef[];
    }>;
    resources?: Record<string, any>;
};
//# sourceMappingURL=index.d.ts.map