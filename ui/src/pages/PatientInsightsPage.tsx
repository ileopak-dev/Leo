import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, Hospital, ShieldAlert, Upload } from "lucide-react";
import { nav, timelineKindMeta } from "./patient-insights/config";
import {
  abnormalValueOf,
  allergyDetailsOf,
  clinicalDateOf,
  clinicalItemValue,
  dateScore,
  encounterDetailsOf,
  encounterToneClass,
  fmtAt,
  fmtUsDob,
  fmtMonthKey,
  isAbnormalEvent,
  isChronicMedication,
  isChronicProblem,
  isHighSeverityAllergy,
  isNonFinalStatus,
  keyOf,
  medicationDosageOf,
  medicationPatientInstructionOf,
  monthKey,
  metaSourceOf,
  observationAbnormalTag,
  observationExpectedRange,
  observationValueStringOf,
  parseNumericValue,
  postJSON,
  sourceLine,
  statusOf,
  statusLine,
} from "./patient-insights/helpers";
import type { EvidenceRef, PatientInsightsDTO, Tab, TimelineKind } from "./patient-insights/types";
import {
  ageFromDob,
  ageTierFromAge,
  buildLocationChart,
  buildNavCounts,
  buildNextOfKinChart,
  buildOrgChart,
  buildPersonChart,
  buildPhq9Rows,
  patientIdentityKey,
  sexToneFromSex,
  type LoadedPatientBundle,
} from "./patient-insights/viewModels";
import {
  buildBannerExpandedMap,
  buildSelectedBannerEvidenceRows,
  insightBannerKey,
} from "./patient-insights/insightViewModels";
import { buildAbnormalNavCounts } from "./patient-insights/navReview";
import { PatientHeader } from "./patient-insights/components/PatientHeader";
import { Phq9DetailPanel } from "./patient-insights/components/Phq9DetailPanel";

export function PatientInsightsPage() {
  const [tab, setTab] = useState<Tab>("snapshot");
  const [dto, setDto] = useState<PatientInsightsDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedPhq9Ref, setSelectedPhq9Ref] = useState<string>("");
  const [selectedPhq9TabRef, setSelectedPhq9TabRef] = useState<string>("");
  const [inspectorDock, setInspectorDock] = useState<"right" | "bottom" | "hidden">(() => {
    if (typeof window === "undefined") return "right";
    const saved = window.localStorage.getItem("pi_inspector_dock");
    return saved === "right" || saved === "bottom" || saved === "hidden" ? saved : "right";
  });
  const [selectedBanner, setSelectedBanner] = useState<PatientInsightsDTO["banners"][number] | null>(null);
  const [selectedEncounterKey, setSelectedEncounterKey] = useState<string>("");
  const [showRawEncounterJson, setShowRawEncounterJson] = useState(false);
  const [loadedBundles, setLoadedBundles] = useState<LoadedPatientBundle[]>([]);
  const [activeBundleEntryKey, setActiveBundleEntryKey] = useState<string>("");

  const [uploading, setUploading] = useState(false);

  const selectedResource = useMemo(() => {
    if (!dto?.resources || !selected) return null;
    return dto.resources[selected] ?? null;
  }, [dto, selected]);
  const personResource = useMemo(() => {
    if (!dto?.resources) return null;
    return Object.values(dto.resources).find((r: any) => r?.resourceType === "Person") ?? null;
  }, [dto]);
  const personResourceKey = useMemo(() => {
    const id = (personResource as any)?.id;
    return id ? `Person/${id}` : null;
  }, [personResource]);
  const personChart = useMemo(() => buildPersonChart(dto, personResource), [dto, personResource]);
  const orgChart = useMemo(() => buildOrgChart(dto), [dto]);
  const nextOfKinChart = useMemo(() => buildNextOfKinChart(dto), [dto]);
  const locationChart = useMemo(() => buildLocationChart(dto), [dto]);

  const timelineEvents = useMemo(() => {
    return [...(dto?.timeline ?? [])].sort((a, b) => dateScore(a.at) - dateScore(b.at));
  }, [dto]);
  const encounterEvents = useMemo(() => timelineEvents.filter((e) => e.kind === "encounter"), [timelineEvents]);
  const navCounts = useMemo<Record<Tab, number>>(() => buildNavCounts(dto), [dto]);
  const organizationVisitedCount = orgChart.items.length;
  const locationVisitedCount = locationChart.items.length;
  const nextOfKinCount = nextOfKinChart.items.length;
  const timelineColumns = useMemo(() => {
    const groups = new Map<string, typeof encounterEvents>();
    for (const event of encounterEvents) {
      const key = monthKey(event.at);
      const current = groups.get(key) ?? [];
      current.push(event);
      groups.set(key, current);
    }
    return Array.from(groups.entries())
      .sort((a, b) => dateScore(a[0]) - dateScore(b[0]))
      .map(([key, events]) => ({
        key,
        events,
        encounters: events,
      }));
  }, [encounterEvents]);
  const selectedEncounter = useMemo(() => {
    if (!selectedEncounterKey) return null;
    return dto?.resources?.[selectedEncounterKey] ?? null;
  }, [dto, selectedEncounterKey]);
  const selectedEncounterEvent = useMemo(() => {
    return encounterEvents.find((e) => `Encounter/${e.evidence?.[0]?.id}` === selectedEncounterKey) ?? null;
  }, [encounterEvents, selectedEncounterKey]);
  const selectedEncounterRelatedEvents = useMemo(() => {
    if (!selectedEncounterEvent) return [];
    const encounterAt = dateScore(selectedEncounterEvent.at);
    if (!encounterAt) return [];
    const end = encounterAt + 14 * 24 * 60 * 60 * 1000;
    return timelineEvents
      .filter((e) => {
        if (e.kind === "encounter") return false;
        const at = dateScore(e.at);
        return at > encounterAt && at <= end;
      })
      .sort((a, b) => dateScore(a.at) - dateScore(b.at));
  }, [timelineEvents, selectedEncounterEvent]);
  const selectedEncounterRelatedByType = useMemo(() => {
    const order: TimelineKind[] = ["lab", "vital", "problem", "procedure", "med", "document"];
    return order
      .map((kind) => ({
        kind,
        label: timelineKindMeta.find((m) => m.kind === kind)?.label ?? kind,
        items: selectedEncounterRelatedEvents.filter((e) => e.kind === kind),
      }))
      .filter((group) => group.items.length > 0);
  }, [selectedEncounterRelatedEvents]);
  const labTypeGroups = useMemo(() => {
    if (!dto) return [];
    const groups = new Map<string, Array<{ at: string; latest: string; flag?: "H" | "L" | "A" | "critical"; evidence: EvidenceRef[]; value?: number }>>();
    for (const lab of dto.snapshot?.labs ?? []) {
      const obsEvidence = (lab.evidence ?? []).find((e) => e.resourceType === "Observation");
      const obs = obsEvidence ? dto.resources?.[`Observation/${obsEvidence.id}`] : null;
      const at = obs?.effectiveDateTime ?? obs?.issued ?? obs?.meta?.lastUpdated ?? "";
      const arr = groups.get(lab.label) ?? [];
      arr.push({
        at,
        latest: lab.latest,
        flag: lab.flag,
        evidence: lab.evidence,
        value: parseNumericValue(lab.latest) ?? undefined,
      });
      groups.set(lab.label, arr);
    }
    return Array.from(groups.entries())
      .map(([label, items]) => ({
        label,
        items: items.sort((a, b) => dateScore(b.at) - dateScore(a.at)),
        abnormal: items.some((i) => !!i.flag),
      }))
      .sort((a, b) => {
        if (Number(b.abnormal) !== Number(a.abnormal)) return Number(b.abnormal) - Number(a.abnormal);
        return a.label.localeCompare(b.label);
      });
  }, [dto]);
  const abnormalLabChartGroups = useMemo(() => {
    return labTypeGroups
      .filter((g) => g.abnormal)
      .map((g) => ({
        label: g.label,
        points: g.items
          .filter((i) => i.value != null && i.at)
          .map((i) => ({ at: i.at, value: i.value as number, abnormal: !!i.flag }))
          .sort((a, b) => dateScore(a.at) - dateScore(b.at)),
      }))
      .filter((g) => g.points.length > 0);
  }, [labTypeGroups]);
  const selectedEncounterVitalSeries = useMemo(() => {
    if (!dto) return [];
    const vitals = selectedEncounterRelatedEvents.filter((e) => e.kind === "vital");
    const groups = new Map<string, Array<{ at: string; value: number; abnormal: boolean }>>();
    for (const e of vitals) {
      const ev = e.evidence?.[0];
      const key = ev ? `${ev.resourceType}/${ev.id}` : "";
      const r = key ? dto.resources?.[key] : null;
      const rawValue =
        r?.valueQuantity?.value != null
          ? `${r.valueQuantity.value}`
          : typeof r?.valueString === "string"
            ? r.valueString
            : typeof r?.valueInteger === "number"
              ? String(r.valueInteger)
              : e.summary ?? "";
      const numeric = parseNumericValue(rawValue);
      if (numeric == null) continue;
      const arr = groups.get(e.label) ?? [];
      arr.push({ at: e.at, value: numeric, abnormal: !!observationAbnormalTag(e.evidence, dto?.resources) || isAbnormalEvent(e) });
      groups.set(e.label, arr);
    }
    return Array.from(groups.entries())
      .map(([label, points]) => ({
        label,
        points: points.sort((a, b) => dateScore(a.at) - dateScore(b.at)),
      }))
      .sort((a, b) => b.points.length - a.points.length);
  }, [dto, selectedEncounterRelatedEvents]);
  const phq9Rows = useMemo(() => buildPhq9Rows(dto), [dto]);
  const selectedPhq9Response = useMemo(() => {
    if (!selectedPhq9Ref) return null;
    const r: any = dto?.resources?.[selectedPhq9Ref];
    return r?.resourceType === "QuestionnaireResponse" ? r : null;
  }, [dto, selectedPhq9Ref]);
  const selectedPhq9Items = useMemo(() => {
    const canonical = [
      { linkId: "q1", text: "Little interest or pleasure in doing things" },
      { linkId: "q2", text: "Feeling down, depressed, or hopeless" },
      { linkId: "q3", text: "Trouble falling or staying asleep, or sleeping too much" },
      { linkId: "q4", text: "Feeling tired or having little energy" },
      { linkId: "q5", text: "Poor appetite or overeating" },
      { linkId: "q6", text: "Feeling bad about yourself - or that you are a failure or have let yourself or your family down" },
      { linkId: "q7", text: "Trouble concentrating on things, such as reading the newspaper or watching television" },
      { linkId: "q8", text: "Moving or speaking so slowly that other people could have noticed. Or the opposite - being so fidgety or restless that you have been moving around a lot more than usual" },
      { linkId: "q9", text: "Thoughts that you would be better off dead, or of hurting yourself in some way" },
    ];
    const byLink = new Map<string, any>();
    const walk = (items: any[]) => {
      for (const it of items) {
        const link = String(it?.linkId ?? "").trim();
        if (link) byLink.set(link, it);
        if (Array.isArray(it?.item) && it.item.length > 0) walk(it.item);
      }
    };
    if (Array.isArray(selectedPhq9Response?.item)) walk(selectedPhq9Response.item);

    return canonical.map((q) => {
      const it = byLink.get(q.linkId);
      const a = Array.isArray(it?.answer) ? it.answer[0] : null;
      const codeRaw = a?.valueCoding?.code ?? a?.valueInteger ?? a?.valueDecimal;
      const codeNum = Number(codeRaw);
      const score = Number.isFinite(codeNum) ? codeNum : undefined;
      const answerText =
        String(a?.valueCoding?.display ?? a?.valueString ?? "").trim() ||
        (score != null ? String(score) : "No answer");
      return {
        linkId: q.linkId,
        question: String(it?.text ?? q.text),
        answer: answerText,
        score,
      };
    });
  }, [selectedPhq9Response]);
  const selectedPhq9Total = useMemo(() => {
    if (!selectedPhq9Ref) return undefined;
    const selectedObs: any = dto?.resources?.[selectedPhq9Ref];
    if (selectedObs?.resourceType === "Observation") {
      const raw = selectedObs?.valueQuantity?.value ?? selectedObs?.valueInteger ?? selectedObs?.valueDecimal;
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
    const fromAnswers = selectedPhq9Items.reduce((sum, q) => {
      const n = Number(q.score);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);
    return fromAnswers > 0 ? fromAnswers : undefined;
  }, [dto, selectedPhq9Items, selectedPhq9Ref]);

  function resolvePhq9LinkedResourceKey(row: any): string {
    const obsKey = keyOf(row?.evidence?.[0]) ?? "";
    const obs: any = obsKey ? dto?.resources?.[obsKey] : null;
    const linkCandidates = [
      ...(Array.isArray(obs?.derivedFrom) ? obs.derivedFrom : []),
      ...(Array.isArray(obs?.hasMember) ? obs.hasMember : []),
      ...(Array.isArray(obs?.focus) ? obs.focus : []),
      ...(Array.isArray(obs?.basedOn) ? obs.basedOn : []),
    ]
      .map((x: any) => String(x?.reference ?? "").trim())
      .filter(Boolean);
    const qr = linkCandidates.find((ref: string) => ref.startsWith("QuestionnaireResponse/") && !!dto?.resources?.[ref]);
    if (qr) return qr;
    const linked = linkCandidates.find((ref: string) => !!dto?.resources?.[ref]);
    return linked ?? obsKey;
  }

  function selectPhq9LinkedResource(row: any, context: "snapshot" | "phq9" = "snapshot") {
    const key = resolvePhq9LinkedResourceKey(row);
    setSelected(key);
    setSelectedPhq9Ref(key);
    if (context === "phq9") setSelectedPhq9TabRef(key);
  }

  const mentalRows = useMemo(() => {
    const items = dto?.snapshot?.mentalStatus ?? [];
    return items.filter((m) => {
      const label = String(m?.label ?? "").toLowerCase();
      if (label.includes("phq-9") || label.includes("phq 9")) return false;
      const ev = m?.evidence?.[0];
      const key = ev ? `${ev.resourceType}/${ev.id}` : "";
      const obs: any = key ? dto?.resources?.[key] : null;
      const codings = Array.isArray(obs?.code?.coding) ? obs.code.coding : [];
      return !codings.some((c: any) => String(c?.code ?? "").trim() === "44261-6");
    });
  }, [dto]);
  const snapshotProblems = dto?.snapshot?.problems ?? [];
  const snapshotMeds = dto?.snapshot?.meds ?? [];
  const snapshotAllergies = dto?.snapshot?.allergies ?? [];
  const snapshotProcedures = dto?.snapshot?.procedures ?? [];
  const snapshotVitals = dto?.snapshot?.vitals ?? [];
  const snapshotLabs = dto?.snapshot?.labs ?? [];
  const abnormalVitalsBanner = useMemo<PatientInsightsDTO["banners"][number] | null>(() => {
    if (!dto) return null;
    const rows = snapshotVitals
      .map((v) => {
        const tag = observationAbnormalTag(v.evidence, dto.resources);
        const ev = v.evidence?.[0];
        const key = ev ? `${ev.resourceType}/${ev.id}` : "";
        const at = clinicalDateOf(v.evidence, dto.resources);
        return { v, tag, key, at };
      })
      .filter((x) => !!x.tag && !!x.key);
    if (rows.length === 0) return null;

    const seen = new Set<string>();
    const evidence = rows
      .map((x) => x.v.evidence?.[0])
      .filter((ev): ev is NonNullable<typeof ev> => {
        if (!ev) return false;
        const k = `${ev.resourceType}/${ev.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    const labels = rows.map((x) => `${x.v.label} (${x.tag})`);
    const dates = rows.map((x) => x.at).filter(Boolean) as string[];
    return {
      severity: "high",
      title: `Abnormal vitals: ${rows.length}`,
      detail: Array.from(new Set(labels)).slice(0, 6).join(" • "),
      occurredAt: Array.from(new Set(dates)).map((d) => fmtAt(d)).join(" • "),
      evidence,
    };
  }, [dto, snapshotVitals]);
  const phq9ElevatedBanner = useMemo<PatientInsightsDTO["banners"][number] | null>(() => {
    if (!dto) return null;
    const elevated = phq9Rows.filter((r) => typeof r.score === "number" && r.score >= 10);
    if (elevated.length === 0) return null;

    const seen = new Set<string>();
    const evidence = elevated
      .map((r) => r.row?.evidence?.[0])
      .filter((ev): ev is NonNullable<typeof ev> => {
        if (!ev?.resourceType || !ev?.id) return false;
        const k = `${ev.resourceType}/${ev.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    const details = elevated
      .map((r) => `${r.score}${r.severity ? ` (${r.severity})` : ""}`)
      .slice(0, 8)
      .join(" • ");
    const dates = elevated
      .map((r) => clinicalDateOf(r.row?.evidence, dto.resources, r.row?.at))
      .filter(Boolean)
      .map((d) => fmtAt(String(d)));

    return {
      severity: "high",
      title: `PHQ-9 score 10+: ${elevated.length}`,
      detail: details,
      occurredAt: Array.from(new Set(dates)).join(" • "),
      evidence,
    };
  }, [dto, phq9Rows]);
  const displayBanners = useMemo(() => {
    let out = dto?.banners ?? [];
    if (abnormalVitalsBanner) {
      const hasVitals = out.some((b) => /^abnormal vitals:/i.test(String(b.title ?? "")));
      if (!hasVitals) out = [abnormalVitalsBanner, ...out];
    }
    if (phq9ElevatedBanner) {
      const hasPhq9 = out.some((b) => /phq-?9/i.test(String(b.title ?? "")));
      if (!hasPhq9) out = [phq9ElevatedBanner, ...out];
    }
    return out;
  }, [dto, abnormalVitalsBanner, phq9ElevatedBanner]);
  const recentAbnormalReviewCounts = useMemo<Record<Tab, number>>(
    () => buildAbnormalNavCounts(dto, { recentMonths: 6 }),
    [dto]
  );
  const abnormalAnyCounts = useMemo<Record<Tab, number>>(
    () => buildAbnormalNavCounts(dto),
    [dto]
  );
  const hasSnapshotAnyData =
    snapshotProblems.length > 0 ||
    snapshotMeds.length > 0 ||
    snapshotAllergies.length > 0 ||
    snapshotProcedures.length > 0 ||
    snapshotVitals.length > 0 ||
    snapshotLabs.length > 0 ||
    phq9Rows.length > 0;
  const patientAge = useMemo(() => {
    return ageFromDob(personChart?.dob);
  }, [personChart?.dob]);
  const sexTone = useMemo(() => sexToneFromSex(dto?.patient?.sex), [dto?.patient?.sex]);
  const selectedBannerEvidenceRows = useMemo(
    () => buildSelectedBannerEvidenceRows(selectedBanner, dto),
    [selectedBanner, dto]
  );

  const bannerExpanded = useMemo(() => buildBannerExpandedMap(dto), [dto]);

  function addLoadedBundle(id: string, nextDto: PatientInsightsDTO) {
    setLoadedBundles((prev) => {
      const now = new Date().toISOString();
      const nextIdentity = patientIdentityKey(nextDto);
      const existing = prev.find((p) => patientIdentityKey(p.dto) === nextIdentity);
      const row: LoadedPatientBundle = {
        entryKey: existing?.entryKey ?? `${id}-${nextDto.patient?.id ?? "unknown"}-${now}`,
        bundleId: id,
        patientId: nextDto.patient?.id,
        name: nextDto.patient?.name ?? "Unknown Patient",
        dob: nextDto.patient?.dob,
        sex: nextDto.patient?.sex,
        loadedAt: now,
        dto: nextDto,
      };
      const withoutExistingPatient = prev.filter((p) => patientIdentityKey(p.dto) !== nextIdentity);
      const next = [row, ...withoutExistingPatient].slice(0, 30);
      setActiveBundleEntryKey(row.entryKey);
      return next;
    });
  }

  async function loadInsightsByBundleId(id: string) {
    try {
      const out = await postJSON("/api/insights", { bundle_id: id });
      setDto(out);
      setErr(null);
      setSelectedBanner(null);
      setSelectedPhq9Ref("");
      setSelectedPhq9TabRef("");
      if (typeof window !== "undefined") {
        window.localStorage.setItem("pi_bundle_id", id);
      }
      addLoadedBundle(id, out);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const missingBundle = /HTTP 404/i.test(msg) || /Bundle not found/i.test(msg);
      if (missingBundle && typeof window !== "undefined") {
        window.localStorage.removeItem("pi_bundle_id");
        setErr("Saved bundle is no longer available after server restart. Please choose and upload the bundle again.");
        return;
      }
      setErr(msg || "Failed to load insights");
    }
  }

  async function uploadBundleText(text: string) {
    let bundle = JSON.parse(text);
    
    // If the parsed content is an array, wrap it in a proper FHIR Bundle object
    if (Array.isArray(bundle)) {
      bundle = {
        resourceType: "Bundle",
        type: "collection",
        entry: bundle,
      };
    }
    
    setUploading(true);
    try {
      const up = await postJSON("/api/bundles", { bundle });
      await loadInsightsByBundleId(up.bundle_id);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to upload bundle");
    } finally {
      setUploading(false);
    }
  }

  async function onPickFile(file: File) {
    const text = await file.text();
    await uploadBundleText(text);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("pi_bundle_id");
    if (!saved) return;
    void loadInsightsByBundleId(saved);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("pi_inspector_dock", inspectorDock);
  }, [inspectorDock]);

  useEffect(() => {
    setShowRawEncounterJson(false);
  }, [selectedEncounterKey]);

  return (
    <div className={`pi sex-${sexTone} dock-${inspectorDock}`}>
      <aside className="pi-left">
        <div className="pi-brand">
          <img
            src="https://interstella-demo.stella-apps.com/assets/logos/IS-logo.svg"
            alt="InterStella"
            className="pi-brand-logo"
          />
        </div>

        <div
          className={`pi-personpanel ${personResourceKey ? "clickable" : ""}`}
          onClick={() => personResourceKey && setSelected(personResourceKey)}
        >
          <div className="pi-personchart">
            <div className="pi-personchart-h">Person Resource</div>
            {!dto ? (
              <div className="pi-muted">Load a bundle to view Person resource stats.</div>
            ) : (
              <>
                <div className="pi-personchart-sub">{personChart?.hasPerson ? `Person/${personChart.id}` : `Patient/${personChart?.id ?? "n/a"} (fallback)`}</div>
                <div className="pi-persongrid">
                  <div className="pi-personrow"><span>Name</span><strong>{personChart?.name ?? "n/a"}</strong></div>
                  <div className="pi-personrow"><span>DOB</span><strong>{fmtUsDob(personChart?.dob)}</strong></div>
                  <div className="pi-personrow"><span>Gender</span><strong>{personChart?.gender ?? "n/a"}</strong></div>
                  <div className="pi-personrow"><span>Address</span><strong>{personChart?.address ?? "n/a"}</strong></div>
                  <div className="pi-personrow"><span>Contact</span><strong>{personChart?.contact ?? "n/a"}</strong></div>
                  <div className="pi-personrow"><span>Identifier</span><strong>{personChart?.identifier ?? "n/a"}</strong></div>
                </div>
                <div className="pi-personchips">
                  <span className="pi-chip">Links {personChart?.links ?? 0}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="pi-nav">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = tab === n.key;
            const count = navCounts[n.key] ?? 0;
            const tone =
              n.key === "snapshot"
                ? "synopsis"
                : n.key === "timeline"
                  ? "timeline"
                  : count <= 0
                    ? "none"
                    : count < 3
                      ? "low"
                      : count < 10
                        ? "mid"
                        : "high";
            const showCount = n.key !== "timeline";
            return (
              <button key={n.key} className={`pi-navbtn tone-${tone} ${active ? "active" : ""}`} onClick={() => setTab(n.key)}>
                <span className="pi-navbtn-l">
                  <Icon size={18} />
                  <span>{n.label}</span>
                </span>
                <span className="pi-nav-r">
                  {showCount ? (
                    <span className={`pi-navcount tone-${tone} ${abnormalAnyCounts[n.key] > 0 ? "pi-navcount-abnormal-any" : ""}`}>{count}</span>
                  ) : null}
                  {recentAbnormalReviewCounts[n.key] > 0 ? (
                    <span className="pi-navreview" title={`${recentAbnormalReviewCounts[n.key]} abnormal item(s) in last 6 months to review`}>
                      {recentAbnormalReviewCounts[n.key]}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="pi-leftfooter">
          <div className="pi-chip">API-first</div>
          <div className="pi-chip">Evidence-linked</div>
        </div>
      </aside>

      <main className="pi-main">
        <section className="pi-patient-tabs">
          {loadedBundles.length === 0 ? (
            <div className="pi-muted">Load bundles to build patient tabs.</div>
          ) : (
            <div className="pi-patient-tabs-list">
              {loadedBundles.map((p) => (
                (() => {
                  const age = ageFromDob(p.dob);
                  const tier = ageTierFromAge(age);
                  const tabSexTone: "male" | "female" | "other" =
                    String(p.sex ?? "").toLowerCase() === "male"
                      ? "male"
                      : String(p.sex ?? "").toLowerCase() === "female"
                        ? "female"
                        : "other";
                  return (
                <button
                  key={p.entryKey}
                  className={`pi-patient-tab age-${tier} sex-${tabSexTone} ${activeBundleEntryKey === p.entryKey ? "active" : ""}`}
                  onClick={() => {
                    setDto(p.dto);
                    setErr(null);
                    setSelected(null);
                    setSelectedEncounterKey("");
                    setSelectedPhq9Ref("");
                    setSelectedPhq9TabRef("");
                    setActiveBundleEntryKey(p.entryKey);
                  }}
                >
                  <div className="pi-patient-tab-name">{p.name}</div>
                  <div className="pi-patient-tab-meta">DOB {fmtUsDob(p.dob ?? "—")}</div>
                  <div className="pi-patient-tab-age">{age != null ? `Age ${age}` : "Age unknown"}</div>
                </button>
                  );
                })()
              ))}
            </div>
          )}
        </section>

        <PatientHeader
          patientName={dto?.patient?.name}
          patientSex={dto?.patient?.sex}
          patientAge={patientAge}
          patientDob={dto?.patient?.dob}
          patientIdentifier={dto?.patient?.identifiers?.[0]?.value}
          insightsCount={displayBanners.length}
          organizationVisitedCount={organizationVisitedCount}
          locationVisitedCount={locationVisitedCount}
          nextOfKinCount={nextOfKinCount}
        />

        <section className="pi-top-right-tools">
          <div className="pi-inspector-dock">
            <span className="pi-inspector-dock-l">FHIR Inspector</span>
            <div className="pi-inspector-switch">
              <button className={`pi-inspector-btn ${inspectorDock === "right" ? "active" : ""}`} onClick={() => setInspectorDock("right")}>Right</button>
              <button className={`pi-inspector-btn ${inspectorDock === "bottom" ? "active" : ""}`} onClick={() => setInspectorDock("bottom")}>Bottom</button>
              <button className={`pi-inspector-btn ${inspectorDock === "hidden" ? "active" : ""}`} onClick={() => setInspectorDock("hidden")}>Hide</button>
            </div>
          </div>
          <div className="pi-uploader">
            <label className="pi-uploadbtn">
              <Upload size={18} />
              <span>{uploading ? "Uploading…" : "Choose bundle JSON"}</span>
              <input
                type="file"
                accept="application/json"
                onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])}
                style={{ display: "none" }}
              />
            </label>
          </div>
          <div
            className={`pi-orgpanel ${personResourceKey ? "clickable" : ""}`}
            onClick={() => personResourceKey && setSelected(personResourceKey)}
          >
            <div className="pi-orgchart-h">Patient In Bundle</div>
            {!dto ? (
              <div className="pi-muted">Load a bundle to view patient details.</div>
            ) : (
              <div className="pi-detail-grid">
                <div><strong>Name:</strong> {personChart?.name ?? "n/a"}{patientAge != null ? ` (${patientAge})` : ""}</div>
                <div><strong>DOB:</strong> {fmtUsDob(personChart?.dob)}</div>
                <div><strong>Gender:</strong> {personChart?.gender ?? "n/a"}</div>
                <div><strong>ID:</strong> {personChart?.id ?? "n/a"}</div>
                <div><strong>Identifier:</strong> {personChart?.identifier ?? "n/a"}</div>
                <div><strong>Contact:</strong> {personChart?.contact ?? "n/a"}</div>
              </div>
            )}
          </div>
          <div className="pi-orgpanel">
            <div className="pi-orgchart-h">Next Of Kin In Bundle</div>
            {!dto ? (
              <div className="pi-muted">Load a bundle to view next of kin.</div>
            ) : nextOfKinChart.items.length === 0 ? (
              <div className="pi-muted">No RelatedPerson resources found.</div>
            ) : (
              <div className="pi-orgbars">
                {nextOfKinChart.items.map((k) => (
                  <button key={k.id} className="pi-orgbar pi-orgbar-btn" onClick={() => setSelected(`RelatedPerson/${k.id}`)}>
                    <div className="pi-orgbar-l">
                      <div className="pi-orgbar-name" title={k.label}>{k.label}</div>
                      <div className="pi-orgbar-meta">{`Relationship: ${k.relation} • Phone: ${k.phone}`}</div>
                    </div>
                    <div className="pi-orgbar-track">
                      <div className="pi-orgbar-fill" style={{ width: `${Math.max(8, Math.round((k.count / nextOfKinChart.max) * 100))}%` }} />
                    </div>
                    <div className="pi-orgbar-v">{k.count}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="pi-orgpanel">
            <div className="pi-orgchart-h">Organizations In Bundle</div>
            {!dto ? (
              <div className="pi-muted">Load a bundle to view organizations.</div>
            ) : orgChart.items.length === 0 ? (
              <div className="pi-muted">No Organization resources found.</div>
            ) : (
              <div className="pi-orgbars">
                {orgChart.items.map((o) => (
                  <button key={o.id} className="pi-orgbar pi-orgbar-btn" onClick={() => setSelected(`Organization/${o.id}`)}>
                    <div className="pi-orgbar-l">
                      <div className="pi-orgbar-name" title={o.label}>{o.label}</div>
                      <div className="pi-orgbar-meta">{`Name: ${o.name} • Code: ${o.code} • Display: ${o.display}`}</div>
                    </div>
                    <div className="pi-orgbar-track">
                      <div className="pi-orgbar-fill" style={{ width: `${Math.max(8, Math.round((o.count / orgChart.max) * 100))}%` }} />
                    </div>
                    <div className="pi-orgbar-v">{o.count}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="pi-orgchart-h pi-orgchart-subhead">Locations In Bundle</div>
            {!dto ? (
              <div className="pi-muted">Load a bundle to view locations.</div>
            ) : locationChart.items.length === 0 ? (
              <div className="pi-muted">No Location resources found.</div>
            ) : (
              <div className="pi-orgbars">
                {locationChart.items.map((l) => (
                  <button key={l.id} className="pi-orgbar pi-orgbar-btn" onClick={() => setSelected(`Location/${l.id}`)}>
                    <div className="pi-orgbar-l">
                      <div className="pi-orgbar-name" title={l.label}>{l.label}</div>
                      <div className="pi-orgbar-meta">{`Name: ${l.name} • Code: ${l.code} • Display: ${l.display}`}</div>
                    </div>
                    <div className="pi-orgbar-track">
                      <div className="pi-orgbar-fill" style={{ width: `${Math.max(8, Math.round((l.count / locationChart.max) * 100))}%` }} />
                    </div>
                    <div className="pi-orgbar-v">{l.count}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {err && (
          <div className="pi-error">
            <strong>Request failed:</strong>
            <div className="pi-error-msg">{err}</div>
          </div>
        )}

        <section className="pi-banners">
          {displayBanners.length === 0 ? (
            <div className="pi-emptybanner">
              <AlertTriangle size={18} />
              <div>
                <div className="pi-emptybanner-title">No insight rules matched this bundle</div>
                <div className="pi-emptybanner-sub">Insights appear when abnormal labs/vitals, severe allergies, utilization, or chronic burden are detected.</div>
              </div>
            </div>
          ) : (
            displayBanners.map((b, i) => (
              (() => {
                const key = insightBannerKey(b);
                const expanded = bannerExpanded.get(key);
                return (
              <button
                key={i}
                className={`pi-banner ${b.severity}`}
                onClick={() => {
                  const isSame =
                    selectedBanner?.title === b.title &&
                    selectedBanner?.detail === b.detail &&
                    selectedBanner?.occurredAt === b.occurredAt;
                  setSelectedBanner((prev) => {
                    const sameAsPrev =
                      prev?.title === b.title &&
                      prev?.detail === b.detail &&
                      prev?.occurredAt === b.occurredAt;
                    return sameAsPrev ? null : b;
                  });
                  if (!isSame) {
                    setSelected(keyOf(b.evidence?.[0]));
                  }
                }}
              >
                <div className="pi-banner-t">{b.title}</div>
                <div className="pi-banner-d">{expanded?.detail ?? b.detail ?? ""}</div>
                <div className="pi-banner-m">{expanded?.occurredAt ?? b.occurredAt ?? ""}</div>
              </button>
                );
              })()
            ))
          )}
        </section>
        {selectedBanner && (
          <section className="pi-banner-details">
            {(() => {
              const key = insightBannerKey(selectedBanner);
              const expanded = bannerExpanded.get(key);
              return (
                <>
            <div className="pi-banner-details-h">Insight Details</div>
            <div className="pi-banner-details-title">{selectedBanner.title}</div>
            <div className="pi-banner-details-sub">
              {[expanded?.detail ?? selectedBanner.detail ?? "", (expanded?.occurredAt ?? selectedBanner.occurredAt) ? `At: ${expanded?.occurredAt ?? selectedBanner.occurredAt}` : ""].filter(Boolean).join(" • ")}
            </div>
                </>
              );
            })()}
            {selectedBannerEvidenceRows.length === 0 ? (
              <div className="pi-muted">No linked evidence on this insight.</div>
            ) : (
              <div className="pi-banner-details-list">
                {selectedBannerEvidenceRows.map((row) => (
                  <button key={row.key} className="pi-row" onClick={() => setSelected(row.key)}>
                    <span className="pi-icon">i</span>
                    <span className="pi-row-t">
                      <span>{row.label}</span>
                      <span className="pi-row-status">{row.status}</span>
                    </span>
                    <span className="pi-row-m">{row.rightMeta ?? sourceLine(row.evidence ? [row.evidence] : undefined, dto?.resources)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "snapshot" && (
          <section className="pi-grid">
            {!hasSnapshotAnyData ? (
              <div className="pi-card">
                <div className="pi-card-h">Synopsis</div>
                <div className="pi-muted">No clinical items with data available in this bundle.</div>
              </div>
            ) : (
              <>
            {snapshotProblems.length > 0 && (
            <div className="pi-card">
              <div className="pi-card-h">Active Problems</div>
              {snapshotProblems.map((p, i) => (
                  (() => {
                    const chronic = isChronicProblem(p, dto?.resources);
                    const onsetRaw = p.onset ?? clinicalDateOf(p.evidence, dto?.resources);
                    const onsetText = `Onset: ${onsetRaw ? fmtAt(onsetRaw) : "n/a"}`;
                    const source = metaSourceOf(p.evidence, dto?.resources) ?? "n/a";
                    const rightMeta = `${onsetText}\nSource: ${source}`;
                    const statusText = `Status: ${p.status ?? "n/a"}`;
                    return (
                  <button key={i} className={`pi-row ${chronic ? "pi-row-chronic" : ""}`} onClick={() => setSelected(keyOf(p.evidence?.[0]))}>
                    <span className="pi-dot" />
                    <span className="pi-row-t">
                      <span>{p.text}</span>
                      <span className={`pi-row-status ${chronic ? "pi-flag" : ""}`}>{`${chronic ? "Chronic • " : ""}${statusText}`}</span>
                    </span>
                    <span className="pi-row-m">{rightMeta}</span>
                  </button>
                    );
                  })()
                ))}
            </div>
            )}

            {snapshotMeds.length > 0 && (
            <div className="pi-card">
              <div className="pi-card-h">Medication Insights</div>
              {snapshotMeds.map((m, i) => {
                  const chronic = isChronicMedication(m, dto?.resources);
                  const dose = medicationDosageOf(m.evidence, dto?.resources, m.dosage);
                  const patientInstruction = medicationPatientInstructionOf(m.evidence, dto?.resources, m.patientInstruction);
                  return (
                    <button key={i} className={`pi-row ${chronic ? "pi-row-chronic" : ""}`} onClick={() => setSelected(keyOf(m.evidence?.[0]))}>
                      <span className="pi-pill" />
                      <span className="pi-row-t pi-row-t-stack">
                        <span>{m.text}</span>
                        <span className={`pi-row-status ${chronic ? "pi-flag" : ""}`}>{`${chronic ? "Chronic-condition med • " : ""}${dose ? `Dosage: ${dose} • ` : "Dosage: n/a • "}${patientInstruction ? `Patient Instruction: ${patientInstruction} • ` : ""}${statusLine(m.evidence, dto?.resources, m.status)}`}</span>
                      </span>
                      <span className="pi-row-m">{sourceLine(m.evidence, dto?.resources)}</span>
                    </button>
                  );
                })
              }
            </div>
            )}

            {snapshotAllergies.length > 0 && (
            <div className="pi-card">
              <div className="pi-card-h">Allergies</div>
              {snapshotAllergies.map((a, i) => {
                  const high = isHighSeverityAllergy(a);
                  const details = allergyDetailsOf(a.evidence, dto?.resources);
                  const at = clinicalDateOf(a.evidence, dto?.resources);
                  const source = metaSourceOf(a.evidence, dto?.resources) ?? "n/a";
                  const detailsLine = `Manifestation: ${details.manifestation || "n/a"} • Note: ${details.note || "n/a"} • Severity: ${details.severity || "n/a"}`;
                  const rightMeta = `Onset: ${at ? fmtAt(at) : "n/a"}\nSource: ${source}`;
                  const middleText = high
                    ? `${detailsLine} • Abnormal • Value: ${abnormalValueOf(a.evidence, dto?.resources, a.criticality ?? "severe")} • Status: ${a.criticality ?? "n/a"}`
                    : `${detailsLine} • Status: ${a.criticality ?? "n/a"}`;
                  return (
                    <button key={i} className={`pi-row ${high ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(a.evidence?.[0]))}>
                      <span className="pi-icon">A</span>
                      <span className="pi-row-t">
                        <span>{a.text}</span>
                        <span className={`pi-row-status ${high ? "pi-flag" : ""}`}>{middleText}</span>
                      </span>
                      <span className={`pi-row-m ${high ? "pi-flag" : ""}`}>{rightMeta}</span>
                    </button>
                  );
                })
              }
            </div>
            )}

            {snapshotProcedures.length > 0 && (
            <div className="pi-card">
              <div className="pi-card-h">Procedures</div>
              {snapshotProcedures.map((p, i) => (
                  <button key={i} className="pi-row" onClick={() => setSelected(keyOf(p.evidence?.[0]))}>
                    <span className="pi-icon">P</span>
                    <span className="pi-row-t"><span>{p.text}</span><span className={`pi-row-status ${isNonFinalStatus(p.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>{statusLine(p.evidence, dto?.resources, p.status)}</span></span>
                    <span className="pi-row-m">{sourceLine(p.evidence, dto?.resources)}</span>
                  </button>
                ))}
            </div>
            )}

            {snapshotVitals.length > 0 && (
            <div className="pi-card">
              <div className="pi-card-h">Recent Vitals</div>
              {snapshotVitals.map((v, i) => {
                  const abnormalTag = observationAbnormalTag(v.evidence, dto?.resources);
                  const expectedRange = observationExpectedRange(v.evidence, dto?.resources);
                  const abnormal = !!abnormalTag;
                  return (
                  <button key={i} className={`pi-row ${abnormal ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(v.evidence?.[0]))}>
                    <span className="pi-icon">↗</span>
                    <span className="pi-row-t pi-row-t-stack"><span>{v.label}</span><span className={`pi-row-status ${abnormal ? "pi-flag" : ""} ${isNonFinalStatus(v.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>{`${abnormal ? `Abnormal: ${abnormalTag ?? "Out of range"}${expectedRange ? ` • Expected: ${expectedRange}` : ""} • ` : ""}${statusLine(v.evidence, dto?.resources, undefined)}`}</span></span>
                    <span className="pi-row-m">{sourceLine(v.evidence, dto?.resources)}</span>
                  </button>
                  );
                })
              }
            </div>
            )}

            {snapshotLabs.length > 0 && (
            <div className="pi-card">
              <div className="pi-card-h">Recent Labs</div>
              {snapshotLabs.map((l, i) => (
                  <button key={i} className={`pi-row ${l.flag ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(l.evidence?.[0]))}>
                    <span className="pi-icon">L</span>
                    <span className="pi-row-t">
                      <span>{l.label}</span>
                    </span>
                    <span className={`pi-row-m pi-row-m-stack ${l.flag ? "pi-flag" : ""}`}>
                      <span>{sourceLine(l.evidence, dto?.resources)}</span>
                      <span className={isNonFinalStatus(l.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}>
                        {(() => {
                          const s = statusOf(l.evidence, dto?.resources) ?? l.flag ?? "n/a";
                          return l.flag ? `Value: ${l.latest} (${l.flag}) • Status: ${s}` : `Value: ${l.latest} • Status: ${s}`;
                        })()}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
            )}

            {phq9Rows.length > 0 && (
            <div className="pi-card">
              <div className="pi-card-h">PHQ-9</div>
              <>
                  {phq9Rows.map((item, i) => (
                    <button key={i} className={`pi-row ${item.abnormal ? "pi-row-abnormal" : ""}`} onClick={() => selectPhq9LinkedResource(item.row, "snapshot")}>
                      <span className="pi-icon">M</span>
                      <span className="pi-row-t">
                        <span>{item.row.label}</span>
                        <span className={`pi-row-status ${item.abnormal ? "pi-flag" : ""}`}>
                          {`${item.severity}${item.score != null ? ` • Score: ${item.score}` : ""} • ${statusLine(item.row.evidence, dto?.resources, item.row.latest)}`}
                        </span>
                      </span>
                      <span className="pi-row-m">{sourceLine(item.row.evidence, dto?.resources)}</span>
                    </button>
                  ))}
                  <Phq9DetailPanel
                    show={!!selectedPhq9Ref && !!selectedPhq9Response}
                    emptyText="Select a PHQ-9 row above to render questionnaire questions and answers."
                    authoredText={selectedPhq9Response?.authored ? fmtAt(selectedPhq9Response.authored) : "n/a"}
                    statusText={selectedPhq9Response?.status ?? "n/a"}
                    totalScore={selectedPhq9Total}
                    items={selectedPhq9Items}
                  />
              </>
            </div>
            )}

              </>
            )}
          </section>
        )}

        {tab === "labs" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">LABS</div>
              {(dto?.snapshot?.labs ?? []).length === 0 ? (
                <div className="pi-muted">No labs extracted yet.</div>
              ) : (
                <>
                  {abnormalLabChartGroups.length > 0 && (
                    <div className="pi-type-group">
                      <div className="pi-type-group-h">Abnormal Lab Trends</div>
                      <div className="pi-vitalmini-wrap">
                        {abnormalLabChartGroups.map((series) => (
                          <div key={series.label} className="pi-vitalmini-card">
                            <div className="pi-vitalmini-title">{series.label}</div>
                            <div className="pi-vitalmini-range">
                              {(() => {
                                const vals = series.points.map((p) => p.value);
                                const hi = Math.max(...vals);
                                const lo = Math.min(...vals);
                                return (
                                  <>
                                    <span>High: {hi}</span>
                                    <span>Low: {lo}</span>
                                  </>
                                );
                              })()}
                            </div>
                            <svg className="pi-vitalmini-svg" viewBox="0 0 420 96" preserveAspectRatio="none" aria-label={`Lab trend for ${series.label}`}>
                              {(() => {
                                const points = series.points;
                                const min = Math.min(...points.map((p) => p.value));
                                const max = Math.max(...points.map((p) => p.value));
                                const pad = max === min ? Math.max(1, Math.abs(max) * 0.1) : (max - min) * 0.12;
                                const lo = min - pad;
                                const hi = max + pad;
                                const toX = (i: number) => (points.length === 1 ? 210 : 14 + (i * (420 - 28)) / (points.length - 1));
                                const toY = (v: number) => {
                                  const t = (v - lo) / (hi - lo);
                                  return 84 - t * 68;
                                };
                                const yHigh = toY(max);
                                const yLow = toY(min);
                                const poly = points.map((p, i) => `${toX(i)},${toY(p.value)}`).join(" ");
                                return (
                                  <>
                                    <line x1="14" y1="84" x2="406" y2="84" className="pi-vitalmini-axis" />
                                    <line x1="14" y1={yHigh} x2="406" y2={yHigh} className="pi-vitalmini-guide" />
                                    <line x1="14" y1={yLow} x2="406" y2={yLow} className="pi-vitalmini-guide" />
                                    <polyline points={poly} className="pi-vitalmini-line" />
                                    {points.map((p, i) => (
                                      <circle key={`${p.at}-${i}`} cx={toX(i)} cy={toY(p.value)} r="3.5" className={p.abnormal ? "pi-vitalmini-dot flag" : "pi-vitalmini-dot"} />
                                    ))}
                                  </>
                                );
                              })()}
                            </svg>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {labTypeGroups.map((group) => (
                    <div key={group.label} className="pi-type-group">
                      <div className="pi-type-group-h">
                        {group.label}
                        {group.abnormal ? " • Abnormal" : ""}
                      </div>
                      {group.items.map((l, i) => (
                        <button key={`${group.label}-${i}`} className={`pi-row ${l.flag ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(l.evidence?.[0]))}>
                          <span className="pi-icon">L</span>
                          <span className="pi-row-t pi-row-t-stack">
                            <span>{l.latest}</span>
                            <span className={`pi-row-status ${l.flag ? "pi-flag" : ""} ${isNonFinalStatus(l.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>
                              {l.flag
                                ? `Value: ${l.latest} (${l.flag}) • ${statusLine(l.evidence, dto?.resources, l.flag)}`
                                : statusLine(l.evidence, dto?.resources, l.flag)}
                            </span>
                          </span>
                          <span className="pi-row-m">{sourceLine(l.evidence, dto?.resources)}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>
        )}

        {tab === "timeline" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">TIMELINE</div>
              {timelineColumns.length === 0 ? (
                <div className="pi-muted">No encounter events extracted yet.</div>
              ) : (
                <>
                  <div className="pi-h-timeline-wrap">
                    <div className="pi-h-timeline">
                      {timelineColumns.map((col, colIndex) => (
                        <div key={col.key} className={`pi-h-slot ${colIndex > 0 ? "month-split" : ""}`}>
                          <div className="pi-h-month">{fmtMonthKey(col.key)}</div>
                          <div className="pi-h-stack above">
                            {col.encounters.map((t, i) => (
                              (() => {
                                const key = `Encounter/${t.evidence?.[0]?.id}`;
                                const encounter = dto?.resources?.[key];
                                const tone = encounterToneClass(encounter);
                                const details = encounterDetailsOf(encounter, dto?.resources);
                                return (
                              <button
                                key={`${col.key}-e-${i}`}
                                className={`pi-h-card enc-${tone} ${selectedEncounterKey === key ? "selected" : ""}`}
                                onClick={() => {
                                  setSelectedEncounterKey(key);
                                  setSelected(key);
                                }}
                              >
                                <div className="pi-h-card-head">
                                  <span className="pi-h-kindicon"><Hospital size={14} /></span>
                                  <span className="pi-h-event-date">{fmtAt(t.at)}</span>
                                </div>
                                <div className="pi-h-event-title">{t.label}</div>
                                <div className="pi-h-event-sub">
                                  {`Class: ${details.classLabel} • Location: ${details.location} • Source: ${details.source}`}
                                </div>
                              </button>
                                );
                              })()
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="pi-timeline-detail">
                    {!selectedEncounter ? (
                      <div className="pi-muted">Select an encounter above to view all details in this panel.</div>
                    ) : (
                      <>
                        <div className="pi-card-h">Encounter Details</div>
                        <div className="pi-detail-grid pi-detail-grid-encounter">
                          <div><strong>Date:</strong> {selectedEncounterEvent ? fmtAt(selectedEncounterEvent.at) : "—"}</div>
                          <div><strong>Class:</strong> {selectedEncounter?.class?.code ?? selectedEncounter?.class?.display ?? "—"}</div>
                          <div><strong>Status:</strong> {selectedEncounter?.status ?? "—"}</div>
                          <div><strong>Type:</strong> {selectedEncounterEvent?.label ?? "Encounter"}</div>
                        </div>
                        <div className="pi-card-h">Related Events (Next 14 Days)</div>
                        {selectedEncounterRelatedEvents.length === 0 ? (
                          <div className="pi-muted">No related events in the 14-day window after this encounter.</div>
                        ) : (
                          <>
                            <div className="pi-timeline-anchors">
                              {selectedEncounterRelatedByType.map((group) => {
                                const MetaIcon = timelineKindMeta.find((m) => m.kind === group.kind)?.icon ?? FileText;
                                return (
                                  <a key={`jump-${group.kind}`} href={`#timeline-group-${group.kind}`} className="pi-timeline-anchor pi-navbtn">
                                    <span className="pi-navbtn-l">
                                      <MetaIcon size={16} />
                                      <span>{group.label}</span>
                                    </span>
                                    <span className="pi-navcount tone-mid">{group.items.length}</span>
                                  </a>
                                );
                              })}
                            </div>
                          {selectedEncounterRelatedByType.map((group) => (
                            <div id={`timeline-group-${group.kind}`} key={group.kind} className={`pi-type-group kind-${group.kind}`}>
                              <div className="pi-type-group-h">{group.label}</div>
                              {group.kind === "vital" && selectedEncounterVitalSeries.length > 0 && (
                                <div className="pi-vitalmini-wrap">
                                  {selectedEncounterVitalSeries.map((series) => (
                                    <div key={series.label} className="pi-vitalmini-card">
                                      <div className="pi-vitalmini-title">{series.label}</div>
                                      <svg className="pi-vitalmini-svg" viewBox="0 0 420 96" preserveAspectRatio="none" aria-label={`Vital trend for ${series.label}`}>
                                        {(() => {
                                          const points = series.points;
                                          const min = Math.min(...points.map((p) => p.value));
                                          const max = Math.max(...points.map((p) => p.value));
                                          const pad = max === min ? Math.max(1, Math.abs(max) * 0.1) : (max - min) * 0.12;
                                          const lo = min - pad;
                                          const hi = max + pad;
                                          const toX = (i: number) => (points.length === 1 ? 210 : 14 + (i * (420 - 28)) / (points.length - 1));
                                          const toY = (v: number) => {
                                            const t = (v - lo) / (hi - lo);
                                            return 84 - t * 68;
                                          };
                                          const poly = points.map((p, i) => `${toX(i)},${toY(p.value)}`).join(" ");
                                          return (
                                            <>
                                              <line x1="14" y1="84" x2="406" y2="84" className="pi-vitalmini-axis" />
                                              <polyline points={poly} className="pi-vitalmini-line" />
                                              {points.map((p, i) => (
                                                <circle key={`${p.at}-${i}`} cx={toX(i)} cy={toY(p.value)} r="3.5" className={p.abnormal ? "pi-vitalmini-dot flag" : "pi-vitalmini-dot"} />
                                              ))}
                                            </>
                                          );
                                        })()}
                                      </svg>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {group.items.map((e, i) => {
                                const Icon = timelineKindMeta.find((m) => m.kind === e.kind)?.icon ?? FileText;
                                const vitalAbnormalTag = e.kind === "vital" ? observationAbnormalTag(e.evidence, dto?.resources) : undefined;
                                const vitalExpectedRange = e.kind === "vital" ? observationExpectedRange(e.evidence, dto?.resources) : undefined;
                                const abnormal = !!vitalAbnormalTag || isAbnormalEvent(e);
                                const itemValue = clinicalItemValue(e, dto?.resources);
                                return (
                                  <button key={`${group.kind}-${i}`} className={`pi-row ${abnormal ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(e.evidence?.[0]))}>
                                    <span className="pi-icon"><Icon size={12} /></span>
                                    <span className="pi-row-t">
                                      <span>{e.label}</span>
                                      <span className={`pi-row-status ${abnormal ? "pi-flag" : ""} ${isNonFinalStatus(e.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>
                                        {abnormal
                                          ? `${vitalAbnormalTag ? `Abnormal: ${vitalAbnormalTag}` : "Abnormal: Out of range"}${vitalExpectedRange ? ` • Expected: ${vitalExpectedRange}` : ""} • Value: ${abnormalValueOf(e.evidence, dto?.resources, itemValue ?? "n/a")} • ${statusLine(e.evidence, dto?.resources, undefined)}`
                                          : statusLine(e.evidence, dto?.resources, undefined)}
                                      </span>
                                    </span>
                                    <span className="pi-row-m">{sourceLine(e.evidence, dto?.resources)}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                          </>
                        )}
                        <div className="pi-card-h">Raw Encounter Resource</div>
                        <button
                          className={`pi-inspector-btn ${showRawEncounterJson ? "active" : ""}`}
                          onClick={() => setShowRawEncounterJson((prev) => !prev)}
                        >
                          {showRawEncounterJson ? "Hide raw FHIR JSON" : "View raw FHIR JSON"}
                        </button>
                        {showRawEncounterJson && (
                          <pre className="pi-json pi-json-inline">{JSON.stringify(selectedEncounter, null, 2)}</pre>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {tab === "encounters" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">ENCOUNTERS</div>
              {encounterEvents.length === 0 ? (
                <div className="pi-muted">No encounters extracted yet.</div>
              ) : (
                encounterEvents
                  .slice()
                  .sort((a, b) => dateScore(b.at) - dateScore(a.at))
                  .map((e, i) => {
                    const key = keyOf(e.evidence?.[0]) ?? "";
                    const encounter = key ? dto?.resources?.[key] : null;
                    const tone = encounterToneClass(encounter);
                    const details = encounterDetailsOf(encounter, dto?.resources);
                    return (
                      <button key={`${e.at}-${i}`} className={`pi-row pi-row-enc enc-${tone}`} onClick={() => setSelected(keyOf(e.evidence?.[0]))}>
                        <span className="pi-icon">E</span>
                        <span className="pi-row-t">
                          <span>{e.label}</span>
                          <span className="pi-row-status">
                            {`Class: ${details.classLabel} • Location: ${details.location} • Practitioner: ${details.practitioner} • ${statusLine(e.evidence, dto?.resources, e.summary)}`}
                          </span>
                        </span>
                        <span className="pi-row-m">{sourceLine(e.evidence, dto?.resources, e.at)}</span>
                      </button>
                    );
                  })
              )}
            </div>
          </section>
        )}

        {tab === "problems" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">PROBLEMS</div>
              {(dto?.snapshot?.problems ?? []).length === 0 ? (
                <div className="pi-muted">No problems extracted yet.</div>
              ) : (
                dto!.snapshot.problems.map((p, i) => (
                  (() => {
                    const chronic = isChronicProblem(p, dto?.resources);
                    const onsetRaw = p.onset ?? clinicalDateOf(p.evidence, dto?.resources);
                    const onsetText = `Onset: ${onsetRaw ? fmtAt(onsetRaw) : "n/a"}`;
                    const source = metaSourceOf(p.evidence, dto?.resources) ?? "n/a";
                    const rightMeta = `${onsetText}\nSource: ${source}`;
                    const statusText = `Status: ${p.status ?? "n/a"}`;
                    return (
                  <button key={i} className={`pi-row ${chronic ? "pi-row-chronic" : ""}`} onClick={() => setSelected(keyOf(p.evidence?.[0]))}>
                    <span className="pi-dot" />
                    <span className="pi-row-t">
                      <span>{p.text}</span>
                      <span className={`pi-row-status ${chronic ? "pi-flag" : ""}`}>{`${chronic ? "Chronic • " : ""}${statusText}`}</span>
                    </span>
                    <span className="pi-row-m">{rightMeta}</span>
                  </button>
                    );
                  })()
                ))
              )}
            </div>
          </section>
        )}

        {tab === "vitals" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">VITALS</div>
              {(dto?.snapshot?.vitals ?? []).length === 0 ? (
                <div className="pi-muted">No vitals extracted yet.</div>
              ) : (
                dto!.snapshot.vitals.map((v, i) => {
                  const abnormalTag = observationAbnormalTag(v.evidence, dto?.resources);
                  const expectedRange = observationExpectedRange(v.evidence, dto?.resources);
                  const abnormal = !!abnormalTag;
                  return (
                  <button key={i} className={`pi-row ${abnormal ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(v.evidence?.[0]))}>
                    <span className="pi-icon">↗</span>
                    <span className="pi-row-t pi-row-t-stack"><span>{v.label}</span><span className={`pi-row-status ${abnormal ? "pi-flag" : ""} ${isNonFinalStatus(v.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>{`${abnormal ? `Abnormal: ${abnormalTag ?? "Out of range"}${expectedRange ? ` • Expected: ${expectedRange}` : ""} • ` : ""}${statusLine(v.evidence, dto?.resources, v.trend)}`}</span></span>
                    <span className="pi-row-m">{sourceLine(v.evidence, dto?.resources)}</span>
                  </button>
                  );
                })
              )}
            </div>
          </section>
        )}

        {tab === "procedures" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">PROCEDURES</div>
              {(dto?.snapshot?.procedures ?? []).length === 0 ? (
                <div className="pi-muted">No procedures extracted yet.</div>
              ) : (
                dto!.snapshot.procedures.map((p, i) => (
                  <button key={i} className="pi-row" onClick={() => setSelected(keyOf(p.evidence?.[0]))}>
                    <span className="pi-icon">P</span>
                    <span className="pi-row-t"><span>{p.text}</span><span className={`pi-row-status ${isNonFinalStatus(p.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>{statusLine(p.evidence, dto?.resources, p.status)}</span></span>
                    <span className="pi-row-m">{sourceLine(p.evidence, dto?.resources)}</span>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {tab === "meds" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">MEDS</div>
              {(dto?.snapshot?.meds ?? []).length === 0 ? (
                <div className="pi-muted">No meds extracted yet.</div>
              ) : (
                dto!.snapshot.meds.map((m, i) => {
                  const chronic = isChronicMedication(m, dto?.resources);
                  const dose = medicationDosageOf(m.evidence, dto?.resources, m.dosage);
                  const patientInstruction = medicationPatientInstructionOf(m.evidence, dto?.resources, m.patientInstruction);
                  return (
                    <button key={i} className={`pi-row ${chronic ? "pi-row-chronic" : ""}`} onClick={() => setSelected(keyOf(m.evidence?.[0]))}>
                      <span className="pi-pill" />
                      <span className="pi-row-t pi-row-t-stack"><span>{m.text}</span><span className={`pi-row-status ${chronic ? "pi-flag" : ""}`}>{`${chronic ? "Chronic-condition med • " : ""}${dose ? `Dosage: ${dose} • ` : "Dosage: n/a • "}${patientInstruction ? `Patient Instruction: ${patientInstruction} • ` : ""}${statusLine(m.evidence, dto?.resources, m.status ?? m.changed)}`}</span></span>
                      <span className="pi-row-m">{sourceLine(m.evidence, dto?.resources)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        )}

        {tab === "immunizations" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">IMMUNIZATIONS</div>
              {(dto?.snapshot?.immunizations ?? []).length === 0 ? (
                <div className="pi-muted">No immunizations extracted yet.</div>
              ) : (
                dto!.snapshot.immunizations.map((im, i) => (
                  <button key={i} className="pi-row" onClick={() => setSelected(keyOf(im.evidence?.[0]))}>
                    <span className="pi-icon">I</span>
                    <span className="pi-row-t"><span>{im.vaccine}</span><span className={`pi-row-status ${isNonFinalStatus(im.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>{statusLine(im.evidence, dto?.resources, im.status)}</span></span>
                    <span className="pi-row-m">{sourceLine(im.evidence, dto?.resources)}</span>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {tab === "allergies" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">ALLERGIES</div>
              {(dto?.snapshot?.allergies ?? []).length === 0 ? (
                <div className="pi-muted">No allergies extracted yet.</div>
              ) : (
                dto!.snapshot.allergies.map((a, i) => {
                  const high = isHighSeverityAllergy(a);
                  const details = allergyDetailsOf(a.evidence, dto?.resources);
                  const at = clinicalDateOf(a.evidence, dto?.resources);
                  const source = metaSourceOf(a.evidence, dto?.resources) ?? "n/a";
                  const detailsLine = `Manifestation: ${details.manifestation || "n/a"} • Note: ${details.note || "n/a"} • Severity: ${details.severity || "n/a"}`;
                  const rightMeta = `Onset: ${at ? fmtAt(at) : "n/a"}\nSource: ${source}`;
                  const middleText = high
                    ? `${detailsLine} • Abnormal • Value: ${abnormalValueOf(a.evidence, dto?.resources, a.criticality ?? "severe")} • Status: ${a.criticality ?? "n/a"}`
                    : `${detailsLine} • Status: ${a.criticality ?? "n/a"}`;
                  return (
                  <button key={i} className={`pi-row ${high ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(a.evidence?.[0]))}>
                    <span className="pi-icon">A</span>
                    <span className="pi-row-t">
                      <span>{a.text}</span>
                      <span className={`pi-row-status ${high ? "pi-flag" : ""}`}>{middleText}</span>
                    </span>
                    <span className={`pi-row-m ${high ? "pi-flag" : ""}`}>{rightMeta}</span>
                  </button>
                  );
                })
              )}
            </div>
          </section>
        )}

        {tab === "social" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">SOCIAL HISTORY</div>
              {(dto?.snapshot?.socialHistory ?? []).length === 0 ? (
                <div className="pi-muted">No social history extracted yet.</div>
              ) : (
                dto!.snapshot.socialHistory.map((s, i) => (
                  <button key={i} className="pi-row" onClick={() => setSelected(keyOf(s.evidence?.[0]))}>
                    <span className="pi-icon">S</span>
                    <span className="pi-row-t"><span>{s.label}</span><span className={`pi-row-status ${isNonFinalStatus(s.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>{statusLine(s.evidence, dto?.resources, s.latest)}</span></span>
                    <span className="pi-row-m">{sourceLine(s.evidence, dto?.resources)}</span>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {tab === "mental" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">MENTAL STATUS</div>
              {mentalRows.length === 0 ? (
                <div className="pi-muted">No mental status extracted yet.</div>
              ) : (
                mentalRows.map((m, i) => (
                  <button key={i} className="pi-row" onClick={() => setSelected(keyOf(m.evidence?.[0]))}>
                    <span className="pi-icon">M</span>
                    <span className="pi-row-t">
                      <span>{m.label}</span>
                      <span className={`pi-row-status ${isNonFinalStatus(m.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>
                        {`${statusLine(m.evidence, dto?.resources, undefined)} • ValueString: ${observationValueStringOf(m.evidence, dto?.resources, m.latest) ?? "n/a"}`}
                      </span>
                    </span>
                    <span className="pi-row-m">{sourceLine(m.evidence, dto?.resources)}</span>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {tab === "phq9" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">PHQ-9</div>
              {phq9Rows.length === 0 ? (
                <div className="pi-muted">No PHQ-9 extracted yet.</div>
              ) : (
                phq9Rows.map((item, i) => (
                  <button key={i} className={`pi-row ${item.abnormal ? "pi-row-abnormal" : ""}`} onClick={() => selectPhq9LinkedResource(item.row, "phq9")}>
                    <span className="pi-icon">M</span>
                    <span className="pi-row-t">
                      <span>{item.row.label}</span>
                      <span className={`pi-row-status ${item.abnormal ? "pi-flag" : ""}`}>
                        {`${item.severity}${item.score != null ? ` • Score: ${item.score}` : ""} • ${statusLine(item.row.evidence, dto?.resources, item.row.latest)}`}
                      </span>
                    </span>
                    <span className="pi-row-m">{sourceLine(item.row.evidence, dto?.resources)}</span>
                  </button>
                ))
              )}
              <Phq9DetailPanel
                show={!!selectedPhq9TabRef && !!selectedPhq9Response}
                emptyText="Select a PHQ-9 row above to render the questionnaire form."
                authoredText={selectedPhq9Response?.authored ? fmtAt(selectedPhq9Response.authored) : "n/a"}
                statusText={selectedPhq9Response?.status ?? "n/a"}
                totalScore={selectedPhq9Total}
                items={selectedPhq9Items}
              />
            </div>
          </section>
        )}

        {tab !== "snapshot" && tab !== "labs" && tab !== "timeline" && tab !== "encounters" && tab !== "problems" && tab !== "procedures" && tab !== "vitals" && tab !== "meds" && tab !== "immunizations" && tab !== "allergies" && tab !== "social" && tab !== "mental" && tab !== "phq9" && (
          <section className="pi-placeholder">
            <div className="pi-placeholder-card">
              <div className="pi-placeholder-title">{tab.toUpperCase()}</div>
              <div className="pi-muted">We’ll fill this view as we add more extraction rules.</div>
            </div>
          </section>
        )}
      </main>

      <aside className="pi-right">
        <div className="pi-right-top">
          <div>
            <div className="pi-right-h">FHIR Inspector</div>
            <div className="pi-right-sub">{selected ?? "Click any banner/card to inspect source JSON"}</div>
          </div>
          <div className="pi-right-badge">
            <ShieldAlert size={18} />
            <span>Inspectable</span>
          </div>
        </div>

        <pre className="pi-json">{selectedResource ? JSON.stringify(selectedResource, null, 2) : ""}</pre>
      </aside>
    </div>
  );
}
