/**
 * AI routes — Ollama-powered radiology assistants.
 * POST /impression, /draft-findings, /enhance, /suggest
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  generateImpression,
  generateDraftFindings,
  enhanceSection,
  suggestFindings,
} from "../boundary/ollama";

const router = Router();

router.post("/impression", requireAuth, async (req, res) => {
  const { findings, modality, bodyPart } = req.body ?? {};
  if (typeof findings !== "string" || !findings.trim()) {
    res.status(400).json({ error: "Findings text is required" });
    return;
  }
  try {
    const impression = await generateImpression(findings, modality ?? "MRI", bodyPart ?? null);
    res.json({ impression });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "AI failed. Is Ollama running?" });
  }
});

router.post("/draft-findings", requireAuth, async (req, res) => {
  const { clinicalHistory, modality, bodyPart, protocolName } = req.body ?? {};
  try {
    const draft = await generateDraftFindings(clinicalHistory ?? "", modality ?? "MRI", bodyPart ?? null, protocolName ?? null);
    res.json({ draft });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "AI failed. Is Ollama running?" });
  }
});

router.post("/enhance", requireAuth, async (req, res) => {
  const { section, text } = req.body ?? {};
  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "Text is required" });
    return;
  }
  try {
    const enhanced = await enhanceSection(section ?? "text", text);
    res.json({ text: enhanced });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "AI failed. Is Ollama running?" });
  }
});

router.post("/suggest", requireAuth, async (req, res) => {
  const { findings, modality, bodyPart, protocolName } = req.body ?? {};
  try {
    const suggestions = await suggestFindings(findings ?? "", modality ?? "MRI", bodyPart ?? null, protocolName ?? null);
    res.json({ suggestions });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "AI failed. Is Ollama running?" });
  }
});

export default router;
