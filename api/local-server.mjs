import express from "express";
import { handler } from "./dist/handler.js";

const app = express();
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/insights", async (req, res) => {
  const event = { body: JSON.stringify(req.body) };
  const out = await handler(event);
  res.status(out.statusCode || 200);
  if (out.headers) {
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  }
  res.send(out.body);
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
