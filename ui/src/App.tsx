import { PatientInsightsPage } from "./pages/PatientInsightsPage";
import "./styles.css";
import bundle from "./fixtures/patientBundle.json";

export default function App() {
  (window as any).__BUNDLE__ = bundle;

  // quick sanity log (shows up in browser console)
  console.log("Loaded bundle:", (window as any).__BUNDLE__?.resourceType, "entries:", ((window as any).__BUNDLE__?.entry ?? []).length);

  return <PatientInsightsPage />;
}
