import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, Hospital, ShieldAlert, Upload } from "lucide-react";
import { nav, timelineKindMeta } from "./patient-insights/config";
import {
  abnormalValueOf,
  allergyDetailsOf,
  clinicalItemValue,
  dateScore,
  encounterDetailsOf,
  encounterToneClass,
  fmtAt,
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
  observationAbnormalTag,
  observationValueStringOf,
  parseNumericValue,
  postJSON,
  sourceLine,
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

export function PatientInsightsPage() {
  const [tab, setTab] = useState<Tab>("snapshot");
  const [dto, setDto] = useState<PatientInsightsDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedBanner, setSelectedBanner] = useState<PatientInsightsDTO["banners"][number] | null>(null);
  const [selectedEncounterKey, setSelectedEncounterKey] = useState<string>("");
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
  const patientAge = useMemo(() => {
    return ageFromDob(personChart?.dob);
  }, [personChart?.dob]);
  const ageTier = useMemo(() => ageTierFromAge(patientAge), [patientAge]);
  const ageTierLabel = useMemo(() => {
    if (ageTier === "u21") return "Under 21";
    if (ageTier === "u60") return "21 to 59";
    if (ageTier === "o60") return "60+";
    return "Age unknown";
  }, [ageTier]);
  const sexTone = useMemo(() => sexToneFromSex(dto?.patient?.sex), [dto?.patient?.sex]);
  const selectedBannerEvidenceRows = useMemo(() => {
    if (!selectedBanner || !dto?.resources) return [];
    if (/^chronic burden:/i.test(selectedBanner.title)) {
      const chronicProblems = (dto.snapshot?.problems ?? [])
        .filter((p) => isChronicProblem(p, dto.resources))
        .map((p, i) => {
          const ev = p.evidence?.[0];
          const key = ev ? `${ev.resourceType}/${ev.id}` : `Problem-${i}`;
          return { key, label: `Problem: ${p.text}`, status: statusLine(p.evidence, dto.resources, p.status), evidence: ev };
        });
      const chronicMeds = (dto.snapshot?.meds ?? [])
        .filter((m) => isChronicMedication(m, dto.resources))
        .map((m, i) => {
          const ev = m.evidence?.[0];
          const key = ev ? `${ev.resourceType}/${ev.id}` : `Medication-${i}`;
          return { key, label: `Medication: ${m.text}`, status: statusLine(m.evidence, dto.resources, m.status), evidence: ev };
        });
      return [...chronicProblems, ...chronicMeds];
    }
    if (/severe allerg/i.test(selectedBanner.title)) {
      return (dto.snapshot?.allergies ?? [])
        .filter((a) => isHighSeverityAllergy(a))
        .map((a, i) => {
          const ev = a.evidence?.[0];
          const key = ev ? `${ev.resourceType}/${ev.id}` : `Allergy-${i}`;
          return {
            key,
            label: `Allergy: ${a.text}`,
            status: statusLine(a.evidence, dto.resources, a.criticality),
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
      return { key, label, status: statusLine([ev], dto.resources), evidence: ev };
    });
  }, [selectedBanner, dto]);

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
      if (typeof window !== "undefined") {
        window.localStorage.setItem("pi_bundle_id", id);
      }
      addLoadedBundle(id, out);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load insights");
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

  return (
    <div className={`pi sex-${sexTone}`}>
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
                  <div className="pi-personrow"><span>DOB</span><strong>{personChart?.dob ?? "n/a"}</strong></div>
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
            return (
              <button key={n.key} className={`pi-navbtn ${active ? "active" : ""}`} onClick={() => setTab(n.key)}>
                <span className="pi-navbtn-l">
                  <Icon size={18} />
                  <span>{n.label}</span>
                </span>
                <span className="pi-navcount">{count}</span>
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
          <div className="pi-patient-tabs-title">Loaded Patients</div>
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
                    setActiveBundleEntryKey(p.entryKey);
                  }}
                >
                  <div className="pi-patient-tab-name">{p.name}</div>
                  <div className="pi-patient-tab-meta">{p.sex ?? "—"} • DOB {p.dob ?? "—"}</div>
                  <div className="pi-patient-tab-bands">
                    <div className={`pi-patient-tier ${tier}`}>
                      {tier === "u21" ? "Under 21" : tier === "u60" ? "21-59" : tier === "o60" ? "60+" : "Age unknown"}
                      {age != null ? ` • ${age}y` : ""}
                    </div>
                    <div className={`pi-patient-sexband ${tabSexTone}`}>
                      {tabSexTone === "male" ? "Male" : tabSexTone === "female" ? "Female" : "Other"}
                    </div>
                  </div>
                </button>
                  );
                })()
              ))}
            </div>
          )}
        </section>

        <header className="pi-header">
          <div>
            <div className="pi-title">{dto?.patient?.name ?? "Patient Insights"}</div>
            <div className="pi-sub">
              {dto?.patient?.sex ?? "—"}{patientAge != null ? ` • Age ${patientAge}` : ""} • DOB {dto?.patient?.dob ?? "—"} • {dto?.patient?.identifiers?.[0]?.value ?? ""}
            </div>
            <div className="pi-demographics">
              <span className="pi-demotext">{ageTierLabel}</span>
              <span className={`pi-sexbadge ${sexTone}`}>{sexTone === "male" ? "Male profile" : sexTone === "female" ? "Female profile" : "Profile"}</span>
            </div>
          </div>

          <div className="pi-kpis">
            <div className="pi-kpi">
              <div className="pi-kpi-n">{dto?.banners?.length ?? 0}</div>
              <div className="pi-kpi-l">Insights</div>
            </div>
            <div className="pi-kpi">
              <div className="pi-kpi-n">{dto?.timeline?.length ?? 0}</div>
              <div className="pi-kpi-l">Events</div>
            </div>
          </div>
        </header>

        <section className="pi-top-right-tools">
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
                <div><strong>DOB:</strong> {personChart?.dob ?? "n/a"}</div>
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
          {(dto?.banners ?? []).length === 0 ? (
            <div className="pi-emptybanner">
              <AlertTriangle size={18} />
              <div>
                <div className="pi-emptybanner-title">No insight rules matched this bundle</div>
                <div className="pi-emptybanner-sub">Insights appear when abnormal labs/vitals, severe allergies, utilization, or chronic burden are detected.</div>
              </div>
            </div>
          ) : (
            dto!.banners.map((b, i) => (
              <button
                key={i}
                className={`pi-banner ${b.severity}`}
                onClick={() => {
                  setSelectedBanner(b);
                  setSelected(keyOf(b.evidence?.[0]));
                }}
              >
                <div className="pi-banner-t">{b.title}</div>
                <div className="pi-banner-d">{b.detail ?? ""}</div>
                <div className="pi-banner-m">{b.occurredAt ?? ""}</div>
              </button>
            ))
          )}
        </section>
        {selectedBanner && (
          <section className="pi-banner-details">
            <div className="pi-banner-details-h">Insight Details</div>
            <div className="pi-banner-details-title">{selectedBanner.title}</div>
            <div className="pi-banner-details-sub">
              {[selectedBanner.detail ?? "", selectedBanner.occurredAt ? `At: ${selectedBanner.occurredAt}` : ""].filter(Boolean).join(" • ")}
            </div>
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
                    <span className="pi-row-m">{row.key}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "snapshot" && (
          <section className="pi-grid">
            <div className="pi-card">
              <div className="pi-card-h">Active Problems</div>
              {(dto?.snapshot?.problems ?? []).length === 0 ? (
                <div className="pi-muted">No problems extracted yet.</div>
              ) : (
                dto!.snapshot.problems.map((p, i) => (
                  (() => {
                    const chronic = isChronicProblem(p, dto?.resources);
                    return (
                  <button key={i} className={`pi-row ${chronic ? "pi-row-chronic" : ""}`} onClick={() => setSelected(keyOf(p.evidence?.[0]))}>
                    <span className="pi-dot" />
                    <span className="pi-row-t"><span>{p.text}</span><span className={`pi-row-status ${chronic ? "pi-flag" : ""}`}>{`${chronic ? "Chronic • " : ""}${statusLine(p.evidence, dto?.resources, p.status)}`}</span></span>
                    <span className="pi-row-m">{sourceLine(p.evidence, dto?.resources)}</span>
                  </button>
                    );
                  })()
                ))
              )}
            </div>

            <div className="pi-card">
              <div className="pi-card-h">Medication Insights</div>
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
                      <span className="pi-row-t">
                        <span>{m.text}</span>
                        <span className={`pi-row-status ${chronic ? "pi-flag" : ""}`}>{`${chronic ? "Chronic-condition med • " : ""}${dose ? `Dosage: ${dose} • ` : "Dosage: n/a • "}${patientInstruction ? `Patient Instruction: ${patientInstruction} • ` : ""}${statusLine(m.evidence, dto?.resources, m.status)}`}</span>
                      </span>
                      <span className="pi-row-m">{sourceLine(m.evidence, dto?.resources)}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="pi-card">
              <div className="pi-card-h">Allergies</div>
              {(dto?.snapshot?.allergies ?? []).length === 0 ? (
                <div className="pi-muted">No allergies extracted yet.</div>
              ) : (
                dto!.snapshot.allergies.map((a, i) => {
                  const high = isHighSeverityAllergy(a);
                  const details = allergyDetailsOf(a.evidence, dto?.resources);
                  const detailsLine = [
                    details.manifestation ? `Manifestation: ${details.manifestation}` : "",
                    details.note ? `Note: ${details.note}` : "",
                    details.severity ? `Severity: ${details.severity}` : "",
                  ].filter(Boolean).join(" • ");
                  return (
                    <button key={i} className={`pi-row ${high ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(a.evidence?.[0]))}>
                      <span className="pi-icon">A</span>
                      <span className="pi-row-t">
                        <span>{a.text}</span>
                        <span className={`pi-row-status ${high ? "pi-flag" : ""}`}>
                          {[detailsLine,
                            high
                            ? `Abnormal • Value: ${abnormalValueOf(a.evidence, dto?.resources, a.criticality ?? "severe")} • ${statusLine(a.evidence, dto?.resources, a.criticality)}`
                            : statusLine(a.evidence, dto?.resources, a.criticality)]
                            .filter(Boolean)
                            .join(" • ")}
                        </span>
                      </span>
                      <span className="pi-row-m">{sourceLine(a.evidence, dto?.resources)}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="pi-card">
              <div className="pi-card-h">Procedures</div>
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

            <div className="pi-card">
              <div className="pi-card-h">Recent Vitals</div>
              {(dto?.snapshot?.vitals ?? []).length === 0 ? (
                <div className="pi-muted">No vitals extracted yet.</div>
              ) : (
                dto!.snapshot.vitals.map((v, i) => {
                  const abnormalTag = observationAbnormalTag(v.evidence, dto?.resources);
                  const abnormal = !!abnormalTag;
                  return (
                  <button key={i} className={`pi-row ${abnormal ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(v.evidence?.[0]))}>
                    <span className="pi-icon">↗</span>
                    <span className="pi-row-t"><span>{v.label}</span><span className={`pi-row-status ${abnormal ? "pi-flag" : ""} ${isNonFinalStatus(v.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>{`${abnormal ? `Abnormal (${abnormalTag}) • ` : ""}${statusLine(v.evidence, dto?.resources, undefined)}`}</span></span>
                    <span className="pi-row-m">{sourceLine(v.evidence, dto?.resources)}</span>
                  </button>
                  );
                })
              )}
            </div>

            <div className="pi-card">
              <div className="pi-card-h">Recent Labs</div>
              {(dto?.snapshot?.labs ?? []).length === 0 ? (
                <div className="pi-muted">No labs extracted yet.</div>
              ) : (
                dto!.snapshot.labs.map((l, i) => (
                  <button key={i} className={`pi-row ${l.flag ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(l.evidence?.[0]))}>
                    <span className="pi-icon">L</span>
                    <span className="pi-row-t">
                      <span>{l.label}</span>
                      <span className={`pi-row-status ${l.flag ? "pi-flag" : ""}`}>
                        {l.flag
                          ? `Value: ${l.latest} (${l.flag}) • ${statusLine(l.evidence, dto?.resources, l.flag)}`
                          : statusLine(l.evidence, dto?.resources, l.flag)}
                      </span>
                    </span>
                    <span className="pi-row-m">{sourceLine(l.evidence, dto?.resources)}</span>
                  </button>
                ))
              )}
            </div>

            <div className="pi-card">
              <div className="pi-card-h">PHQ-9</div>
              {phq9Rows.length === 0 ? (
                <div className="pi-muted">No PHQ-9 extracted yet.</div>
              ) : (
                phq9Rows.map((item, i) => (
                  <button key={i} className={`pi-row ${item.abnormal ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(item.row.evidence?.[0]))}>
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
            </div>

            <div className="pi-card">
              <div className="pi-card-h">Recent Activity</div>
              {(dto?.timeline ?? []).length === 0 ? (
                <div className="pi-muted">No timeline yet.</div>
              ) : (
                dto!.timeline.slice(0, 8).map((t, i) => (
                  <button key={i} className="pi-time" onClick={() => setSelected(keyOf(t.evidence?.[0]))}>
                    <div className="pi-time-at">{t.at}</div>
                    <div className="pi-time-body">
                      <div className="pi-time-l">{t.label}</div>
                      <div className="pi-time-s">{t.summary ?? ""}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
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
                          <span className="pi-row-t">
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
                    <div className="pi-h-timeline-line" />
                    <div className="pi-h-timeline">
                      {timelineColumns.map((col) => (
                        <div key={col.key} className="pi-h-slot">
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
                                  {`Class: ${details.classLabel} • Location: ${details.location} • Practitioner: ${details.practitioner} • Source: ${details.source} • ${statusLine(t.evidence, dto?.resources, t.summary)}`}
                                </div>
                              </button>
                                );
                              })()
                            ))}
                          </div>
                          <div className="pi-h-mid">
                            <div className="pi-h-event-dot encounter" />
                            <div className="pi-h-mid-date">{fmtMonthKey(col.key)}</div>
                          </div>
                          <div className="pi-h-stack below" />
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
                        <div className="pi-detail-grid">
                          <div><strong>Date:</strong> {selectedEncounterEvent ? fmtAt(selectedEncounterEvent.at) : "—"}</div>
                          <div><strong>Status:</strong> {selectedEncounter?.status ?? "—"}</div>
                          <div><strong>Class:</strong> {selectedEncounter?.class?.code ?? selectedEncounter?.class?.display ?? "—"}</div>
                          <div><strong>Type:</strong> {selectedEncounterEvent?.label ?? "Encounter"}</div>
                        </div>
                        <div className="pi-card-h">Related Events (Next 14 Days)</div>
                        {selectedEncounterRelatedEvents.length === 0 ? (
                          <div className="pi-muted">No related events in the 14-day window after this encounter.</div>
                        ) : (
                          selectedEncounterRelatedByType.map((group) => (
                            <div key={group.kind} className="pi-type-group">
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
                                const abnormal = !!vitalAbnormalTag || isAbnormalEvent(e);
                                const itemValue = clinicalItemValue(e, dto?.resources);
                                return (
                                  <button key={`${group.kind}-${i}`} className={`pi-row ${abnormal ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(e.evidence?.[0]))}>
                                    <span className="pi-icon"><Icon size={12} /></span>
                                    <span className="pi-row-t">
                                      <span>{e.label}</span>
                                      <span className={`pi-row-status ${abnormal ? "pi-flag" : ""} ${isNonFinalStatus(e.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>
                                        {abnormal
                                          ? `${vitalAbnormalTag ? `Abnormal (${vitalAbnormalTag})` : "Abnormal"} • Value: ${abnormalValueOf(e.evidence, dto?.resources, itemValue ?? "n/a")} • ${statusLine(e.evidence, dto?.resources, undefined)}`
                                          : statusLine(e.evidence, dto?.resources, undefined)}
                                      </span>
                                    </span>
                                    <span className="pi-row-m">{sourceLine(e.evidence, dto?.resources)}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ))
                        )}
                        <div className="pi-card-h">Raw Encounter Resource</div>
                        <pre className="pi-json pi-json-inline">{JSON.stringify(selectedEncounter, null, 2)}</pre>
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
                            {`Class: ${details.classLabel} • Location: ${details.location} • Practitioner: ${details.practitioner} • Source: ${details.source} • ${statusLine(e.evidence, dto?.resources, e.summary)}`}
                          </span>
                        </span>
                        <span className="pi-row-m">{fmtAt(e.at)}</span>
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
                    return (
                  <button key={i} className={`pi-row ${chronic ? "pi-row-chronic" : ""}`} onClick={() => setSelected(keyOf(p.evidence?.[0]))}>
                    <span className="pi-dot" />
                    <span className="pi-row-t"><span>{p.text}</span><span className={`pi-row-status ${chronic ? "pi-flag" : ""}`}>{`${chronic ? "Chronic • " : ""}${statusLine(p.evidence, dto?.resources, p.status)}`}</span></span>
                    <span className="pi-row-m">{sourceLine(p.evidence, dto?.resources)}</span>
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
                  const abnormal = !!abnormalTag;
                  return (
                  <button key={i} className={`pi-row ${abnormal ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(v.evidence?.[0]))}>
                    <span className="pi-icon">↗</span>
                    <span className="pi-row-t"><span>{v.label}</span><span className={`pi-row-status ${abnormal ? "pi-flag" : ""} ${isNonFinalStatus(v.evidence, dto?.resources) ? "pi-status-nonfinal" : ""}`}>{`${abnormal ? `Abnormal (${abnormalTag}) • ` : ""}${statusLine(v.evidence, dto?.resources, v.trend)}`}</span></span>
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
                      <span className="pi-row-t"><span>{m.text}</span><span className={`pi-row-status ${chronic ? "pi-flag" : ""}`}>{`${chronic ? "Chronic-condition med • " : ""}${dose ? `Dosage: ${dose} • ` : "Dosage: n/a • "}${patientInstruction ? `Patient Instruction: ${patientInstruction} • ` : ""}${statusLine(m.evidence, dto?.resources, m.status ?? m.changed)}`}</span></span>
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
                  const detailsLine = [
                    details.manifestation ? `Manifestation: ${details.manifestation}` : "",
                    details.note ? `Note: ${details.note}` : "",
                    details.severity ? `Severity: ${details.severity}` : "",
                  ].filter(Boolean).join(" • ");
                  return (
                  <button key={i} className={`pi-row ${high ? "pi-row-abnormal" : ""}`} onClick={() => setSelected(keyOf(a.evidence?.[0]))}>
                    <span className="pi-icon">A</span>
                    <span className="pi-row-t">
                      <span>{a.text}</span>
                      <span className={`pi-row-status ${high ? "pi-flag" : ""}`}>
                        {[detailsLine,
                          high
                          ? `Abnormal • Value: ${abnormalValueOf(a.evidence, dto?.resources, a.criticality ?? "severe")} • ${statusLine(a.evidence, dto?.resources, a.criticality)}`
                          : statusLine(a.evidence, dto?.resources, a.criticality)]
                          .filter(Boolean)
                          .join(" • ")}
                      </span>
                    </span>
                    <span className="pi-row-m">{sourceLine(a.evidence, dto?.resources)}</span>
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
              {(dto?.snapshot?.mentalStatus ?? []).length === 0 ? (
                <div className="pi-muted">No mental status extracted yet.</div>
              ) : (
                dto!.snapshot.mentalStatus.map((m, i) => (
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

        {tab !== "snapshot" && tab !== "labs" && tab !== "timeline" && tab !== "encounters" && tab !== "problems" && tab !== "procedures" && tab !== "vitals" && tab !== "meds" && tab !== "immunizations" && tab !== "allergies" && tab !== "social" && tab !== "mental" && (
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
