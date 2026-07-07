import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import worklistRouter from "./routes/worklist";
import studyRouter from "./routes/study";
import metaRouter from "./routes/meta";
import settingsRouter from "./routes/settings";
import aiRouter from "./routes/ai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(__dirname, "..");
const isProd = process.env.NODE_ENV === "production";

const app: Express = express();
app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "radiology-zai", time: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/worklist", worklistRouter);
app.use("/api/studies", studyRouter);
app.use("/api/meta", metaRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/ai", aiRouter);

// Serve built frontend (production)
const staticDir = path.resolve(artifactDir, "dist", "public");
if (isProd && existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("*", (req: Request, res: Response) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

app.use((err: Error, _req: Request, res: Response, _next: unknown) => {
  console.error("[app] error:", err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
