/**
 * Worklist route — lists studies directly from Orthanc (live, no sync).
 *
 * GET /api/worklist?modality=MR,CT
 *   Returns studies from Orthanc, merged with any local draft status.
 */
import { Router } from "express";
import { db } from "../db";
import { reportDraftsTable } from "../db/schema";
import { eq } from "drizzle-orm";
import { listStudies, type OrthancStudy } from "../boundary/orthanc";
import { requireAuth, type AuthRequest } from "../middleware/auth";

const router = Router();

interface WorklistItem extends OrthancStudy {
  age: string | null;
  draftStatus: string | null; // "draft" | "finalized" | null
  draftRadiologist: string | null;
  viewerUrls: {
    ohif: string | null;
    weasis: string | null;
    orthancBuiltIn: string | null;
  };
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const modality = (req.query.modality as string) || undefined;
    const studies = await listStudies({ modality });

    // Merge with local draft status
    const { getViewerUrls } = await import("../boundary/viewers");
    const items: WorklistItem[] = await Promise.all(
      studies.map(async (s) => {
        const [draft] = await db
          .select()
          .from(reportDraftsTable)
          .where(eq(reportDraftsTable.studyInstanceUid, s.studyInstanceUid))
          .limit(1);

        // Calculate age from birth date
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

        return {
          ...s,
          age,
          draftStatus: draft?.status ?? null,
          draftRadiologist: draft?.radiologistName ?? null,
          viewerUrls: getViewerUrls(s.studyInstanceUid),
        };
      }),
    );

    // Sort: unfinished drafts first, then by study date (newest first)
    items.sort((a, b) => {
      if (a.draftStatus === "draft" && b.draftStatus !== "draft") return -1;
      if (b.draftStatus === "draft" && a.draftStatus !== "draft") return 1;
      return (b.studyDate ?? "").localeCompare(a.studyDate ?? "");
    });

    res.json({ studies: items });
  } catch (err) {
    console.error("[worklist] error:", err);
    res.status(502).json({
      error: "Could not fetch studies from Orthanc. Is Orthanc running and ORTHANC_URL set?",
    });
  }
});

export default router;
