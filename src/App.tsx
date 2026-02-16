import { useEffect, useState } from "react";
import Hl7Viewer from "./components/Hl7Viewer";

export default function App() {
  const [raw, setRaw] = useState<string>("");

  useEffect(() => {
    fetch("/samples/adt_a04.hl7")
      .then(r => r.text())
      .then(setRaw)
      .catch(() => setRaw(""));
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>HL7 v2 Viewer</h2>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Local test · Pretty / Grid / Raw</div>
      </div>

      <p style={{ marginTop: 6, opacity: 0.75 }}>
        Edit/paste an HL7 message below. The viewer will re-render instantly. Raw tab is the exact segment text.
      </p>

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
          fontSize: 12
        }}
      />

      <div style={{ height: 12 }} />

      {raw.trim() ? <Hl7Viewer raw={raw} /> : <div>Paste an HL7 message to begin.</div>}
    </div>
  );
}
