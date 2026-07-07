/**
 * Ollama client — calls a local Ollama instance for AI-assisted reporting.
 *
 * All calls are local + private. The Ollama URL is configurable via the
 * ai_settings table (admin UI) and/or the OLLAMA_URL env var (which
 * overrides the DB on startup, useful for Docker).
 *
 * Typical setup: Ollama + Open WebUI installed on a powerful Windows PC
 * on the same LAN as the Synology NAS. The radiology service (on the NAS)
 * calls the Windows PC's Ollama API at http://<windows-ip>:11434.
 */
import { db } from "../db";
import { aiSettingsTable } from "../db/schema";
import { eq } from "drizzle-orm";

export interface AiSettings {
  ollamaUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
}

/** Loads AI settings from the DB (row id=1), falling back to env vars. */
export async function getAiSettings(): Promise<AiSettings> {
  const [row] = await db
    .select()
    .from(aiSettingsTable)
    .where(eq(aiSettingsTable.id, 1))
    .limit(1);

  return {
    ollamaUrl: process.env.OLLAMA_URL ?? row?.ollamaUrl ?? "http://localhost:11434",
    model: process.env.OLLAMA_MODEL ?? row?.model ?? "llama3.2",
    temperature: Number(row?.temperature ?? "0.3"),
    maxTokens: row?.maxTokens ?? 1024,
    enabled: row?.enabled ?? true,
  };
}

/** Tests connectivity to the Ollama instance. Returns list of available models. */
export async function testOllama(url: string): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ok: false, models: [], error: `Ollama returned ${res.status}` };
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return {
      ok: true,
      models: (data.models ?? []).map((m) => m.name),
    };
  } catch (err) {
    return {
      ok: false,
      models: [],
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

/** Generates text via Ollama's /api/generate endpoint. */
export async function generate(
  prompt: string,
  opts?: { system?: string; temperature?: number; maxTokens?: number },
): Promise<string> {
  const settings = await getAiSettings();
  if (!settings.enabled) {
    throw new Error("AI features are disabled. Enable them in Settings → AI.");
  }

  const res = await fetch(`${settings.ollamaUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      prompt,
      system: opts?.system ?? "You are a radiology reporting assistant. Generate concise, professional medical text. Do not add disclaimers.",
      stream: false,
      options: {
        temperature: opts?.temperature ?? settings.temperature,
        num_predict: opts?.maxTokens ?? settings.maxTokens,
      },
    }),
    signal: AbortSignal.timeout(60_000), // local LLMs can be slow on first call
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { response?: string };
  return (data.response ?? "").trim();
}

// ── Radiology-specific prompt builders ──────────────────────────────────────

/** Generates an impression from the findings text. */
export async function generateImpression(findings: string, modality: string, bodyPart: string | null): Promise<string> {
  const prompt = `Based on the following radiology findings, write a concise impression (1-3 numbered points).

Modality: ${modality}
Body part: ${bodyPart ?? "not specified"}

FINDINGS:
${findings}

Write only the impression, numbered if multiple points. Be concise and specific. Do not repeat the findings.`;
  return generate(prompt, {
    system: "You are a radiologist. Generate a concise, accurate impression from findings. Use standard radiology terminology. Number multiple points.",
    temperature: 0.2,
  });
}

/** Generates a draft findings section from clinical history + protocol. */
export async function generateDraftFindings(
  clinicalHistory: string,
  modality: string,
  bodyPart: string | null,
  protocolName: string | null,
): Promise<string> {
  const prompt = `Draft a radiology findings section based on the following context. Write normal findings if no abnormality is described in the history.

Modality: ${modality}
Body part: ${bodyPart ?? "not specified"}
Protocol: ${protocolName ?? "routine"}
Clinical history: ${clinicalHistory || "not provided"}

Write the findings paragraph in standard radiology reporting style. Describe what was evaluated and the findings. Do not include technique or impression — findings only.`;
  return generate(prompt, {
    system: "You are a radiologist drafting a findings section. Use clear, professional language. Describe anatomy evaluated and findings. Default to normal if no pathology is indicated.",
    temperature: 0.3,
  });
}

/** Enhances/improves a section's wording (grammar, clarity, standardization). */
export async function enhanceSection(sectionName: string, text: string): Promise<string> {
  const prompt = `Improve the following radiology ${sectionName} text. Fix grammar, improve clarity, use standard radiology terminology, but preserve all clinical meaning. Return only the improved text.

Current ${sectionName}:
${text}`;
  return generate(prompt, {
    system: "You are a radiology editor. Improve grammar and clarity while preserving all clinical meaning. Return only the improved text, no explanations.",
    temperature: 0.2,
  });
}

/** Suggests additional findings to consider based on current findings + protocol. */
export async function suggestFindings(
  currentFindings: string,
  modality: string,
  bodyPart: string | null,
  protocolName: string | null,
): Promise<string[]> {
  const prompt = `A radiologist is reporting the following study. Suggest 3-5 additional findings or anatomical areas they should specifically evaluate, based on what's already described.

Modality: ${modality}
Body part: ${bodyPart ?? "not specified"}
Protocol: ${protocolName ?? "routine"}

Current findings:
${currentFindings || "(none yet)"}

List 3-5 specific things to check, one per line. Be concise (e.g. "Evaluate for midline shift", "Check for hemorrhage in basal cisterns"). Do not repeat what's already described.`;
  const text = await generate(prompt, {
    system: "You are a radiology assistant suggesting areas to evaluate. Be specific and clinically relevant. One suggestion per line.",
    temperature: 0.4,
    maxTokens: 256,
  });
  return text
    .split("\n")
    .map((l) => l.replace(/^\d+\.\s*|^[-*]\s*/, "").trim())
    .filter((l) => l.length > 3)
    .slice(0, 5);
}
