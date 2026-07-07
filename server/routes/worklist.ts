/**
 * Worklist route — lists studies from Orthanc, enriched with ERP patient data.
 *
 * Flow:
 *   1. Fetch study list from Orthanc (images live here)
 *   2. If ERP_API_URL is set, batch-enrich each study with ERP patient
 *      demographics (proper name, phone, referring doctor, clinical history,
 *      bill status) by matching accession number
 *   3. If ERP is not configured, use Orthanc DICOM tags only (graceful)
 *
 * GET /api/worklist?modality=MR,CT
 */
import { Router } from "express";
import { db } from "../db";
import { reportDraftsTable } from "../db/schema";
import { eq } from "drizzle-orm";
import { listStudies, type OrthancStudy } from "../boundary/orthanc";
import { getViewerUrls } from "../boundary/viewers";
import { batchEnrichFromErp, isErpEnabled, type ErpStudyEnrichment } from "../boundary/erp";
import { requireAuth, type AuthRequest } from "../middleware/auth";

const router = Router();

interface WorklistItem extends OrthancStudy {
  age: string | null;
  draftStatus: string | null;
  draftRadiologist: string | null;
  viewerUrls: ReturnType<typeof getViewerUrls>;
  // ERP-enriched fields (optional — present when ERP is configured)
  erpEnriched?: ErpStudyEnrichment;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const modality = (req.query.modality as string) || undefined;
    const studies = await listStudies({ modality });

    // ── ERP enrichment (optional, best-effort) ──────────────────────────────
    // If the ERP is configured, batch-fetch patient demographics + referring
    // doctor + clinical history by accession number. Falls back to Orthanc
    // DICOM tags if the ERP is unreachable or the study isn't found.
    const accessionNumbers = studies.map((s) => s.accessionNumber).filter(Boolean);
    const erpEnrichments = isErpEnabled()
      ? await batchEnrichFromErp(accessionNumbers)
      : new Map<string, ErpStudyEnrichment>();

    const items: WorklistItem[] = await Promise.all(
      studies.map(async (s) => {
        const [draft] = await db
          .select()
          .from(reportDraftsTable)
          .where(eq(reportDraftsTable.studyInstanceUid, s.studyInstanceUid))
          .limit(1);

        // Calculate age from Orthanc birth date (fallback if no ERP)
        let age: string | null = null;
        if (s.patientBirthDate && s.patientBirthDate.length === 8) {
          const birth = new Date(
            `${s.patientBirthDate.slice(0, 4)}-${s.patientBirthDate.slice(4, 6)}-${s.patientBirthDate.slice(6, 8)}`,
          );
          const now = new Date();
          let a = now.getFullYear() - birth.getFullYear();
          const m = now.getMonth() - birth.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) a--;
          age = `${a}y`;
        }

        const erpEnriched = s.accessionNumber ? erpEnrichments.get(s.accessionNumber) : undefined;

        return {
          ...s,
          // Prefer ERP age if available, else Orthanc-calculated
          age: erpEnriched?.age ?? age,
          draftStatus: draft?.status ?? null,
          draftRadiologist: draft?.radiologistName ?? null,
          viewerUrls: getViewerUrls(s.studyInstanceUid),
          erpEnriched,
        };
      }),
    );

    // Sort: unfinished drafts first, then by study date (newest first)
    items.sort((a, b) => {
      if (a.draftStatus === "draft" && b.draftStatus !== "draft") return -1;
      if (b.draftStatus === "draft" && a.draftStatus !== "draft") return 1;
      return (b.studyDate ?? "").localeCompare(a.studyDate ?? "");
    });

    res.json({ studies: items, erpEnabled: isErpEnabled() });
  } catch (err) {
    console.error("[worklist] error:", err);
    res.status(502).json({
      error: "Could not fetch studies from Orthanc. Is Orthanc running and ORTHANC_URL set?",
    });
  }
});

export default router;
