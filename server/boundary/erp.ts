/**
 * ERP boundary client — OPTIONAL enrichment layer.
 *
 * When ERP_API_URL + BOUNDARY_API_KEY are set, the standalone enriches
 * Orthanc studies with patient demographics, referring doctor, clinical
 * history, and the ordered study name from the ERP. This gives you the
 * best of both worlds:
 *
 *   Orthanc → images + DICOM tags (always available)
 *   ERP     → patient name/age/sex/phone, referring doctor, clinical
 *             history, ordered study name (richer, registration-quality data)
 *
 * If the ERP is unreachable or the study isn't found there, the standalone
 * gracefully falls back to Orthanc DICOM tags only — it never breaks.
 *
 * When you later remove radiology reporting from the ERP, patient
 * registration + billing + orders stay in the ERP. This enrichment keeps
 * working because it reads the ERP's patient + order tables (which are
 * NOT radiology-specific).
 */

const ERP_API_URL = process.env.ERP_API_URL ?? "";
const BOUNDARY_KEY = process.env.BOUNDARY_API_KEY ?? "";

export function isErpEnabled(): boolean {
  return Boolean(ERP_API_URL && BOUNDARY_KEY);
}

export interface ErpStudyEnrichment {
  patientName?: string; // ERP-formatted (proper case, not DICOM ^ format)
  patientId?: string;
  age?: string;
  sex?: string;
  phone?: string;
  referringDoctor?: string; // ERP doctor name
  clinicalHistory?: string; // from the ERP order
  studyName?: string; // ordered test display name
  billStatus?: string; // paid | pending
  priority?: string;
}

async function erpFetch<T>(path: string): Promise<T | null> {
  if (!isErpEnabled()) return null;
  try {
    const res = await fetch(`${ERP_API_URL}${path}`, {
      headers: { "X-Boundary-Key": BOUNDARY_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // graceful fallback — Orthanc tags used instead
  }
}

interface ErpStudyResponse {
  study: {
    accessionNumber: string;
    patientName: string;
    patientId: number;
    age: string | null;
    sex: string | null;
    referringDoctor: string | null;
    clinicalHistory: string | null;
    studyDescription: string | null;
    bodyPart: string | null;
    priority: string;
    billStatus: string | null;
  };
  patient: {
    patientId: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    ageValue: number | null;
    ageUnit: string | null;
  } | null;
}

/**
 * Fetches study + patient enrichment from the ERP by accession number.
 * Returns null if the ERP isn't configured or the study isn't found —
 * the caller falls back to Orthanc DICOM tags.
 */
export async function enrichFromErp(accessionNumber: string): Promise<ErpStudyEnrichment | null> {
  if (!accessionNumber) return null;
  const data = await erpFetch<ErpStudyResponse>(
    `/api/boundary/studies/${encodeURIComponent(accessionNumber)}`,
  );
  if (!data) return null;

  const s = data.study;
  const p = data.patient;

  return {
    patientName: s.patientName || (p ? `${p.firstName} ${p.lastName}` : undefined),
    patientId: p?.patientId ?? String(s.patientId),
    age: s.age ?? (p?.ageValue != null ? `${p.ageValue} ${p.ageUnit ?? "y"}` : undefined),
    sex: s.sex ?? p?.gender ?? undefined,
    phone: p?.phone ?? undefined,
    referringDoctor: s.referringDoctor ?? undefined,
    clinicalHistory: s.clinicalHistory ?? undefined,
    studyName: s.studyDescription ?? undefined,
    billStatus: s.billStatus ?? undefined,
    priority: s.priority ?? undefined,
  };
}

/**
 * Batch-enriches multiple studies. Uses Promise.allSettled so one failure
 * doesn't block the rest. Returns a map of accession → enrichment.
 */
export async function batchEnrichFromErp(
  accessionNumbers: string[],
): Promise<Map<string, ErpStudyEnrichment>> {
  const map = new Map<string, ErpStudyEnrichment>();
  if (!isErpEnabled() || accessionNumbers.length === 0) return map;

  const results = await Promise.allSettled(
    accessionNumbers.map((acc) => enrichFromErp(acc)),
  );

  results.forEach((result, i) => {
    if (result.status === "fulfilled" && result.value) {
      map.set(accessionNumbers[i], result.value);
    }
  });

  return map;
}

/**
 * Pushes a finalized report to the ERP so staff can print from the ERP's
 * existing print screen. The report text is stored in
 * radiology_studies.finalReport — the same column the ERP's own reporting
 * used, so the ERP's print/delivery/portal flows work unchanged.
 *
 * Returns true on success, false on failure (the standalone keeps the
 * report locally either way — never loses work).
 */
export async function pushReportToErp(
  accessionNumber: string,
  finalReportText: string,
  reportedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isErpEnabled()) {
    return { ok: false, error: "ERP not configured" };
  }
  if (!accessionNumber) {
    return { ok: false, error: "No accession number on this study" };
  }

  try {
    const res = await fetch(
      `${ERP_API_URL}/api/boundary/studies/${encodeURIComponent(accessionNumber)}/report`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boundary-Key": BOUNDARY_KEY },
        body: JSON.stringify({
          status: "reported_final",
          finalReportText,
          reportedBy,
          reportedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `ERP ${res.status}: ${body.slice(0, 100)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Connection failed" };
  }
}
