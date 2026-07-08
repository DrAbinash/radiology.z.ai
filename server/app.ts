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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === "production";

// The compiled server runs from /app/dist/server/index.mjs, so the built
// frontend lives one level up in /app/dist/public.
const publicDir = path.resolve(__dirname, "../public");

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
if (isProd) {
  console.log("[app] Static frontend dir:", publicDir);
  console.log(
    "[app] Frontend index exists:",
    existsSync(path.join(publicDir, "index.html")),
  );

  app.use(express.static(publicDir));

  app.get("*", (req: Request, res: Response, next) => {
    if (req.path.startsWith("/api") || req.path === "/health") {
      return next();
    }

    const indexPath = path.join(publicDir, "index.html");
    if (!existsSync(indexPath)) {
      res.status(500).send("Frontend index.html not found");
      return;
    }

    res.sendFile(indexPath);
  });
}

app.use((err: Error, _req: Request, res: Response, _next: unknown) => {
  console.error("[app] error:", err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
