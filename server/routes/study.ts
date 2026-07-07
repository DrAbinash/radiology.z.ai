/**
 * Study + report routes.
 *
 * GET   /api/studies/:uid          — study detail from Orthanc + local draft
 * GET   /api/studies/:uid/draft    — load draft
 * PUT   /api/studies/:uid/draft    — autosave draft
 * POST  /api/studies/:uid/finalize — mark finalized (keeps the report text locally)
 */
import { Router } from "express";
import { db } from "../db";
import { reportDraftsTable, learnedPatternsTable } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getStudyByUid } from "../boundary/orthanc";
import { getViewerUrls } from "../boundary/viewers";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { recordLearnedPattern } from "./meta";

const router = Router();

function assembleFinalReport(sections: {
  clinicalHistory?: string | null;
  technique?: string | null;
  findings?: string | null;
  impression?: string | null;
  recommendation?: string | null;
}): string {
  const parts: string[] = [];
  if (sections.clinicalHistory?.trim()) parts.push(`CLINICAL HISTORY:\n${sections.clinicalHistory.trim()}`);
  if (sections.technique?.trim()) parts.push(`TECHNIQUE:\n${sections.technique.trim()}`);
  if (sections.findings?.trim()) parts.push(`FINDINGS:\n${sections.findings.trim()}`);
  if (sections.impression?.trim()) parts.push(`IMPRESSION:\n${sections.impression.trim()}`);
  if (sections.recommendation?.trim()) parts.push(`RECOMMENDATION:\n${sections.recommendation.trim()}`);
  return parts.join("\n\n");
}

// ── Study detail (Orthanc + draft + viewer URLs) ────────────────────────────
router.get("/:uid", requireAuth, async (req, res) => {
  const uid = String(req.params.uid);
  try {
    const study = await getStudyByUid(uid);
    if (!study) {
      res.status(404).json({ error: "Study not found in Orthanc" });
      return;
    }

    const [draft] = await db
      .select()
      .from(reportDraftsTable)
      .where(eq(reportDraftsTable.studyInstanceUid, uid))
      .orderBy(desc(reportDraftsTable.updatedAt))
      .limit(1);

    res.json({
      study,
      draft,
      viewerUrls: getViewerUrls(uid),
    });
  } catch (err) {
    console.error("[study/detail] error:", err);
    res.status(502).json({ error: "Could not fetch study from Orthanc" });
  }
});

// ── Autosave draft ───────────────────────────────────────────────────────────
router.put("/:uid/draft", requireAuth, async (req: AuthRequest, res) => {
  const uid = String(req.params.uid);
  const body = req.body ?? {};
  const user = req.user!;

  const [existing] = await db
    .select()
    .from(reportDraftsTable)
    .where(eq(reportDraftsTable.studyInstanceUid, uid))
    .orderBy(desc(reportDraftsTable.updatedAt))
    .limit(1);

  const fields = {
    patientName: body.patientName ?? existing?.patientName ?? null,
    patientId: body.patientId ?? existing?.patientId ?? null,
    accessionNumber: body.accessionNumber ?? existing?.accessionNumber ?? null,
    modality: body.modality ?? existing?.modality ?? null,
    studyDescription: body.studyDescription ?? existing?.studyDescription ?? null,
    studyDate: body.studyDate ?? existing?.studyDate ?? null,
    clinicalHistory: body.clinicalHistory ?? null,
    technique: body.technique ?? null,
    findings: body.findings ?? null,
    impression: body.impression ?? null,
    recommendation: body.recommendation ?? null,
    abnormalities: body.abnormalities ?? [],
    activeProtocolName: body.activeProtocolName ?? null,
    radiologistId: user.id,
    radiologistName: user.name,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(reportDraftsTable).set(fields).where(eq(reportDraftsTable.id, existing.id));
    res.json({ ok: true, draftId: existing.id });
  } else {
    const [created] = await db
      .insert(reportDraftsTable)
      .values({ studyInstanceUid: uid, ...fields })
      .returning();
    res.json({ ok: true, draftId: created.id });
  }
});

// ── Finalize ─────────────────────────────────────────────────────────────────
router.post("/:uid/finalize", requireAuth, async (req: AuthRequest, res) => {
  const uid = String(req.params.uid);
  const user = req.user!;

  const [draft] = await db
    .select()
    .from(reportDraftsTable)
    .where(eq(reportDraftsTable.studyInstanceUid, uid))
    .orderBy(desc(reportDraftsTable.updatedAt))
    .limit(1);

  if (!draft) {
    res.status(404).json({ error: "No draft to finalize" });
    return;
  }

  const finalText = assembleFinalReport({
    clinicalHistory: draft.clinicalHistory,
    technique: draft.technique,
    findings: draft.findings,
    impression: draft.impression,
    recommendation: draft.recommendation,
  });

  await db
    .update(reportDraftsTable)
    .set({ status: "finalized", finalizedAt: new Date(), finalReportText: finalText })
    .where(eq(reportDraftsTable.id, draft.id));

  // Learning engine: record habit (fire-and-forget)
  try {
    const abn = (draft.abnormalities as Array<{ label?: string; recommendationText?: string }>) ?? [];
    const last = abn[abn.length - 1];
    if (last?.label && draft.recommendation) {
      void recordLearnedPattern(user.id, last.label, draft.recommendation, last.recommendationText ?? "");
    }
  } catch { /* best-effort */ }

  res.json({ ok: true, finalReportText: finalText });
});

// ── Mark delivered (optional — if ERP boundary configured, pushes to ERP) ────
router.post("/:uid/deliver", requireAuth, async (req: AuthRequest, res) => {
  // In standalone mode, delivery is just a status note.
  // If ERP boundary is configured (ERP_API_URL + BOUNDARY_API_KEY), it pushes there too.
  const uid = String(req.params.uid);
  const user = req.user!;

  const [draft] = await db
    .select()
    .from(reportDraftsTable)
    .where(eq(reportDraftsTable.studyInstanceUid, uid))
    .orderBy(desc(reportDraftsTable.updatedAt))
    .limit(1);

  if (draft) {
    await db
      .update(reportDraftsTable)
      .set({ status: "delivered" })
      .where(eq(reportDraftsTable.id, draft.id));
  }

  // Optional ERP push (if configured)
  const erpUrl = process.env.ERP_API_URL;
  const erpKey = process.env.BOUNDARY_API_KEY;
  if (erpUrl && erpKey && draft?.accessionNumber) {
    try {
      await fetch(`${erpUrl}/api/boundary/studies/${encodeURIComponent(draft.accessionNumber)}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boundary-Key": erpKey },
        body: JSON.stringify({ issueType: "print", quantity: 1, issuedBy: user.name }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* standalone mode — ERP push is best-effort */ }
  }

  res.json({ ok: true });
});

export default router;
