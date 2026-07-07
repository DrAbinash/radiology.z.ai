/**
 * Settings routes — print settings, AI settings, viewer config, Orthanc test.
 */
import { Router } from "express";
import { db } from "../db";
import { printSettingsTable, aiSettingsTable } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthRequest } from "../middleware/auth";
import { getViewerConfig } from "../boundary/viewers";
import { testOrthanc } from "../boundary/orthanc";
import { testOllama } from "../boundary/ollama";

const router = Router();

async function ensureRow(table: typeof printSettingsTable | typeof aiSettingsTable) {
  const [row] = await db.select().from(table).where(eq(table.id, 1)).limit(1);
  if (!row) await db.insert(table).values({ id: 1 }).onConflictDoNothing();
}

// ── Print settings ──────────────────────────────────────────────────────────
router.get("/print", requireAuth, async (_req, res) => {
  await ensureRow(printSettingsTable);
  const [row] = await db.select().from(printSettingsTable).where(eq(printSettingsTable.id, 1)).limit(1);
  res.json({ settings: row });
});

router.put("/print", requireAuth, requireAdmin, async (req, res) => {
  await ensureRow(printSettingsTable);
  const b = req.body ?? {};
  const updates: Record<string, unknown> = {};
  for (const k of [
    "hospitalName", "hospitalTagline", "hospitalAddress", "hospitalPhone", "hospitalEmail",
    "logoDataUrl", "reportTitle", "layout", "signatureName", "signatureQualification",
    "signatureRegistrationNo", "signatureImageDataUrl", "showQualification", "showRegistrationNo",
    "footerDisclaimer", "paperSize", "fontSize",
  ]) {
    if (b[k] !== undefined) updates[k] = b[k];
  }
  await db.update(printSettingsTable).set(updates).where(eq(printSettingsTable.id, 1));
  res.json({ ok: true });
});

// ── AI settings ──────────────────────────────────────────────────────────────
router.get("/ai", requireAuth, async (_req, res) => {
  await ensureRow(aiSettingsTable);
  const [row] = await db.select().from(aiSettingsTable).where(eq(aiSettingsTable.id, 1)).limit(1);
  res.json({ settings: row });
});

router.put("/ai", requireAuth, requireAdmin, async (req, res) => {
  await ensureRow(aiSettingsTable);
  const b = req.body ?? {};
  const updates: Record<string, unknown> = {};
  for (const k of ["ollamaUrl", "model", "temperature", "maxTokens", "enabled"]) {
    if (b[k] !== undefined) updates[k] = b[k];
  }
  await db.update(aiSettingsTable).set(updates).where(eq(aiSettingsTable.id, 1));
  res.json({ ok: true });
});

// ── Viewer config (read-only, from env) ──────────────────────────────────────
router.get("/viewers", requireAuth, (_req, res) => {
  res.json({ config: getViewerConfig() });
});

// ── Connection tests ─────────────────────────────────────────────────────────
router.post("/test-orthanc", requireAuth, async (_req, res) => {
  res.json(await testOrthanc());
});

router.post("/test-ollama", requireAuth, async (req, res) => {
  const url = req.body?.url || (await db.select().from(aiSettingsTable).where(eq(aiSettingsTable.id, 1)).limit(1))[0]?.ollamaUrl;
  res.json(await testOllama(url));
});

export default router;
