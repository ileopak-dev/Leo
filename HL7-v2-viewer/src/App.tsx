import { useEffect, useState } from "react";
import Hl7Viewer from "./components/Hl7Viewer";

const LOGO_URL = "https://interstella-demo.stella-apps.com/assets/logos/IS-logo.svg";

export default function App() {
  const [raw, setRaw] = useState<string>("");

  useEffect(() => {
    fetch("/samples/adt_a04.hl7")
      .then((r) => r.text())
      .then(setRaw)
      .catch(() => setRaw(""));
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: "10px 14px",
          boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
        }}
      >
        <h2 style={{ margin: 0 }}>HL7 v2 Viewer</h2>
        <img src={LOGO_URL} alt="Interstella" style={{ height: 30, width: "auto", display: "block" }} />
      </div>

      <p style={{ marginTop: 6, opacity: 0.75 }}>Edit/paste an HL7 message below.</p>

      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        style={{
          width: "100%",
          height: 160,
          padding: 10,
          borderRadius: 14,
          border: "1px solid #ddd",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
        }}
      />

      <div style={{ height: 12 }} />

      {raw.trim() ? <Hl7Viewer raw={raw} /> : <div>Paste an HL7 message to begin.</div>}
    </div>
  );
}
