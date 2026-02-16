import express from "express";
import { buildInsights } from "./insights/buildInsights";

const app = express();
app.use(express.json({ limit: "15mb" }));

// In-memory bundle storage for local dev
const bundles: Record<string, any> = {};
let bundleCounter = 0;

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/bundles", (req, res) => {
  const bundle = req.body?.bundle;
  console.log("POST /api/bundles - full body keys:", Object.keys(req.body));
  console.log("POST /api/bundles - bundle type:", typeof bundle);
  console.log("POST /api/bundles - bundle keys:", bundle ? Object.keys(bundle).slice(0, 10) : "null");
  console.log("POST /api/bundles - bundle.resourceType:", bundle?.resourceType);
  
  if (!bundle) {
    return res.status(400).json({ error: "bundle is required in request body" });
  }
  if (bundle.resourceType !== "Bundle") {
    return res.status(400).json({ error: `Invalid resourceType: ${bundle.resourceType}, expected "Bundle"` });
  }
  const bundle_id = `bundle-${++bundleCounter}`;
  bundles[bundle_id] = bundle;
  console.log(`Stored bundle ${bundle_id} with ${bundle.entry?.length ?? 0} entries`);
  return res.json({ bundle_id });
});

app.post("/api/insights", (req, res) => {
  let bundle = req.body?.bundle;
  const bundle_id = req.body?.bundle_id;

  // If bundle_id is provided, look it up from storage
  if (bundle_id && !bundle) {
    bundle = bundles[bundle_id];
    if (!bundle) {
      return res.status(404).json({ error: `Bundle not found: ${bundle_id}` });
    }
  }

  if (!bundle || bundle.resourceType !== "Bundle") {
    return res.status(400).json({ error: "bundle (FHIR Bundle) is required" });
  }
  const dto = buildInsights(bundle, { includeResources: true });
  return res.json(dto);
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Local API listening on http://localhost:${port}`));
