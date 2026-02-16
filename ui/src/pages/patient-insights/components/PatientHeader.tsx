import { fmtUsDob } from "../helpers";

type Props = {
  patientName?: string;
  patientSex?: string;
  patientAge?: number;
  patientDob?: string;
  patientIdentifier?: string;
  insightsCount: number;
  organizationVisitedCount: number;
  locationVisitedCount: number;
  nextOfKinCount: number;
};

export function PatientHeader(props: Props) {
  const {
    patientName,
    patientSex,
    patientAge,
    patientDob,
    patientIdentifier,
    insightsCount,
    organizationVisitedCount,
    locationVisitedCount,
    nextOfKinCount,
  } = props;

  return (
    <header className="pi-header">
      <div>
        <div className="pi-title">{patientName ?? "Patient Insights"}</div>
        <div className="pi-sub">
          {patientSex ?? "—"}
          {patientAge != null ? ` • Age ${patientAge}` : ""}
          {" • DOB "}
          {fmtUsDob(patientDob ?? "—")}
          {" • "}
          {patientIdentifier ?? ""}
        </div>
      </div>

      <div className="pi-kpis">
        <div className="pi-kpi">
          <div className="pi-kpi-n">{insightsCount}</div>
          <div className="pi-kpi-l">Insights</div>
        </div>
        <div className="pi-kpi">
          <div className="pi-kpi-n">{organizationVisitedCount}</div>
          <div className="pi-kpi-l">Organisations Visited</div>
        </div>
        <div className="pi-kpi">
          <div className="pi-kpi-n">{locationVisitedCount}</div>
          <div className="pi-kpi-l">Locations Visited</div>
        </div>
        <div className="pi-kpi">
          <div className="pi-kpi-n">{nextOfKinCount}</div>
          <div className="pi-kpi-l">Next of Kin</div>
        </div>
      </div>
    </header>
  );
}
