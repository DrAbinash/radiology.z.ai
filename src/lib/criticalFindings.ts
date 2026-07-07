/**
 * criticalFindings.ts — detects urgent findings in report text that may
 * require immediate communication to the referring physician.
 *
 * Pure, dependency-free. Scans the findings + impression text for keywords
 * and returns a list of alerts with severity.
 */

export interface CriticalFinding {
  keyword: string;
  severity: "critical" | "urgent";
  message: string;
}

const CRITICAL_PATTERNS: Array<{ regex: RegExp; keyword: string; message: string }> = [
  // Hemorrhage
  { regex: /\b(acute\s+)?haemorrhage\b|\b(acute\s+)?hemorrhage\b|\bbleed/i, keyword: "Haemorrhage", message: "Acute haemorrhage — notify referring physician immediately" },
  { regex: /\bSDH\b|\bsubdural\s+haematoma/i, keyword: "Subdural haematoma", message: "Subdural haematoma — assess for mass effect & midline shift" },
  { regex: /\bEDH\b|\bepidural\s+haematoma/i, keyword: "Epidural haematoma", message: "Epidural haematoma — surgical emergency if >30ml or midline shift" },
  { regex: /\bSAH\b|\bsubarachnoid\s+haemorrhage/i, keyword: "SAH", message: "Subarachnoid haemorrhage — urgent neurosurgical referral" },
  { regex: /\bintraparenchymal\s+haematoma/i, keyword: "Intraparenchymal haematoma", message: "Intraparenchymal bleed — monitor for expansion" },
  // Mass effect
  { regex: /\bmidline\s+shift/i, keyword: "Midline shift", message: "Midline shift — urgent neurosurgical evaluation" },
  { regex: /\bmass\s+effect/i, keyword: "Mass effect", message: "Mass effect — assess for herniation risk" },
  { regex: /\bherniation|\bherniat/i, keyword: "Herniation", message: "Brain herniation — neurosurgical emergency" },
  { regex: /\buncal\s+herniation/i, keyword: "Uncal herniation", message: "Uncal herniation — immediate neurosurgical consultation" },
  // Stroke
  { regex: /\bacute\s+infarct|\bacute\s+ischaem|\bacute\s+ischem/i, keyword: "Acute infarct", message: "Acute infarct — assess thrombolysis window" },
  { regex: /\bhyperdense\s+MCA/i, keyword: "Hyperdense MCA", message: "Hyperdense MCA sign — acute M1 occlusion, consider thrombectomy" },
  { regex: /\blarge\s+vessel\s+occlusion|\bLVO\b/i, keyword: "LVO", message: "Large vessel occlusion — consider mechanical thrombectomy" },
  { regex: /\bASPECTS\s*[<=:]\s*[0-6]/i, keyword: "Low ASPECTS", message: "ASPECTS ≤6 — limited thrombolysis benefit, urgent stroke team" },
  // Infection
  { regex: /\babscess|\bempyema/i, keyword: "Abscess", message: "Intracranial abscess/empyema — urgent neurosurgical + infectious disease referral" },
  // Tumour
  { regex: /\bmass\s+lesion|\btumou?r|\bneoplasm/i, keyword: "Mass lesion", message: "Mass lesion — consider biopsy/resection referral" },
  // Hydrocephalus
  { regex: /\bhydrocephalus|\bventriculomegaly/i, keyword: "Hydrocephalus", message: "Hydrocephalus — assess for shunt requirement" },
  // Compression
  { regex: /\bcord\s+compression|\bspinal\s+cord\s+compression/i, keyword: "Cord compression", message: "Spinal cord compression — urgent neurosurgical referral" },
  { regex: /\bcauda\s+equina/i, keyword: "Cauda equina", message: "Cauda equina syndrome — surgical emergency" },
  // Aneurysm
  { regex: /\baneurysm|\bAVM|\bvascular\s+malformation/i, keyword: "Vascular lesion", message: "Vascular lesion — consider neurointerventional referral" },
];

/** Scans text for critical findings. Returns matched alerts (deduplicated). */
export function detectCriticalFindings(text: string): CriticalFinding[] {
  if (!text || !text.trim()) return [];

  const found: CriticalFinding[] = [];
  const seen = new Set<string>();

  for (const { regex, keyword, message } of CRITICAL_PATTERNS) {
    if (regex.test(text) && !seen.has(keyword)) {
      seen.add(keyword);
      // Determine severity
      const criticalKeywords = ["haemorrhage", "hemorrhage", "herniation", "SAH", "cord compression", "cauda equina"];
      const severity: CriticalFinding["severity"] = criticalKeywords.some((k) =>
        keyword.toLowerCase().includes(k.toLowerCase()),
      )
        ? "critical"
        : "urgent";

      found.push({ keyword, severity, message });
    }
  }

  return found;
}
