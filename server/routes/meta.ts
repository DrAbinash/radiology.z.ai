/**
 * Meta routes — protocols, quick findings, study tabs, learned patterns.
 * These are the radiology service's own reporting-content data.
 */
import { Router } from "express";
import { db } from "../db";
import { protocolsTable, quickFindingsTable, studyTabsTable, learnedPatternsTable } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { rankSuggestions, isLearnableAddition } from "../../src/lib/learningEngine";

const router = Router();

router.get("/quick-select", requireAuth, async (_req, res) => {
  const [tabs, findings, protocols] = await Promise.all([
    db.select().from(studyTabsTable).where(eq(studyTabsTable.isActive, true)),
    db.select().from(quickFindingsTable).where(eq(quickFindingsTable.isActive, true)),
    db.select().from(protocolsTable).where(eq(protocolsTable.isActive, true)),
  ]);

  res.json({
    tabs: tabs.sort((a, b) => a.sortOrder - b.sortOrder),
    findings: findings.sort((a, b) => a.sortOrder - b.sortOrder),
    protocols: protocols.sort((a, b) => a.sortOrder - b.sortOrder),
  });
});

router.get("/learned-patterns", requireAuth, async (req: AuthRequest, res) => {
  const trigger = (req.query.trigger as string) || "";
  if (!trigger) {
    res.json({ patterns: [] });
    return;
  }
  const rows = await db
    .select()
    .from(learnedPatternsTable)
    .where(
      and(
        eq(learnedPatternsTable.radiologistId, req.user!.id),
        eq(learnedPatternsTable.triggerLabel, trigger.trim()),
      ),
    );
  res.json({
    patterns: rankSuggestions(
      rows.map((r) => ({
        triggerLabel: r.triggerLabel,
        suggestedText: r.suggestedText,
        occurrenceCount: r.occurrenceCount,
        lastUsedAt: r.lastUsedAt,
      })),
      trigger,
    ),
  });
});

/** Records a learned addition at finalize time (fire-and-forget). */
export async function recordLearnedPattern(
  radiologistId: number,
  triggerLabel: string,
  candidateText: string,
  templateText: string,
): Promise<void> {
  if (!isLearnableAddition(candidateText, templateText)) return;
  const existing = await db
    .select()
    .from(learnedPatternsTable)
    .where(
      and(
        eq(learnedPatternsTable.radiologistId, radiologistId),
        eq(learnedPatternsTable.triggerLabel, triggerLabel.trim()),
        eq(learnedPatternsTable.suggestedText, candidateText.trim()),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(learnedPatternsTable)
      .set({ occurrenceCount: existing[0].occurrenceCount + 1, lastUsedAt: new Date() })
      .where(eq(learnedPatternsTable.id, existing[0].id));
  } else {
    await db.insert(learnedPatternsTable).values({
      radiologistId,
      triggerLabel: triggerLabel.trim(),
      suggestedText: candidateText.trim(),
      occurrenceCount: 1,
      lastUsedAt: new Date(),
    });
  }
}

export default router;
