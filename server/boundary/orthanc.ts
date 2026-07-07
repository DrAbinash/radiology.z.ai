/**
 * Orthanc client — queries the Orthanc REST API directly.
 *
 * Orthanc runs on your Synology NAS (same one the ERP uses). This client
 * fetches the study/series/instance list and DICOM tags so the worklist
 * is always live — no sync, no duplication.
 *
 * Auth: Orthanc basic auth (ORTHANC_USER / ORTHANC_PASSWORD) if configured.
 * URL: ORTHANC_URL — e.g. http://<nas-ip>:8042
 */

const ORTHANC_URL = process.env.ORTHANC_URL ?? "http://localhost:8042";
const ORTHANC_USER = process.env.ORTHANC_USER ?? "";
const ORTHANC_PASSWORD = process.env.ORTHANC_PASSWORD ?? "";

function authHeader(): Record<string, string> {
  if (!ORTHANC_USER) return {};
  const token = Buffer.from(`${ORTHANC_USER}:${ORTHANC_PASSWORD}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

async function orthancFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${ORTHANC_URL.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeader(), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Orthanc ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface OrthancStudy {
  id: string; // Orthanc internal ID
  studyInstanceUid: string;
  patientId: string;
  patientName: string; // formatted: "Last^First^Middle"
  patientBirthDate: string; // YYYYMMDD
  patientSex: string;
  accessionNumber: string;
  studyDate: string; // YYYYMMDD
  studyTime: string;
  studyDescription: string;
  modality: string; // MR, CT, US, CR, etc.
  bodyPart: string;
  referringPhysician: string;
  numberOfSeries: number;
  numberOfInstances: number;
  seriesIds: string[];
}

interface OrthancStudyResponse {
  ID: string;
  MainDicomTags: Record<string, string>;
  PatientMainDicomTags: Record<string, string>;
  Series: string[];
  IsStable: boolean;
}

/** Formats a DICOM patient name "Last^First^Middle" → "First Middle Last" */
function formatDicomName(raw: string): string {
  if (!raw) return "Unknown";
  // DICOM PN format: Last^First^Middle^Prefix^Suffix
  const parts = raw.split("^");
  const [last, first, middle] = parts;
  return [first, middle, last].filter(Boolean).join(" ").trim() || raw;
}

/** Converts YYYYMMDD → ISO date string */
function formatDicomDate(d: string): string {
  if (!d || d.length !== 8) return d;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** Calculates age from birth date */
function calcAge(birthDate: string): string | null {
  if (!birthDate || birthDate.length !== 8) return null;
  const birth = new Date(`${birthDate.slice(0, 4)}-${birthDate.slice(4, 6)}-${birthDate.slice(6, 8)}`);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return `${age}y`;
}

/** Lists all studies in Orthanc, optionally filtered by modality. */
export async function listStudies(opts?: {
  modality?: string; // "MR,CT"
}): Promise<OrthancStudy[]> {
  // Use the /studies endpoint with expand=true to get tags in one call
  const studies = await orthancFetch<OrthancStudyResponse[]>(
    "/studies?expand=true",
  );

  const all = studies.map(parseStudy);
  if (!opts?.modality) return all;

  const modalities = opts.modality.split(",").map((m) => m.trim().toUpperCase()).filter(Boolean);
  return all.filter((s) => modalities.includes(s.modality.toUpperCase()));
}

function parseStudy(s: OrthancStudyResponse): OrthancStudy {
  const tags = s.MainDicomTags;
  const ptags = s.PatientMainDicomTags;
  return {
    id: s.ID,
    studyInstanceUid: tags["StudyInstanceUID"] ?? "",
    patientId: ptags["PatientID"] ?? tags["PatientID"] ?? "",
    patientName: formatDicomName(ptags["PatientName"] ?? tags["PatientName"] ?? ""),
    patientBirthDate: ptags["PatientBirthDate"] ?? "",
    patientSex: ptags["PatientSex"] ?? "",
    accessionNumber: tags["AccessionNumber"] ?? "",
    studyDate: formatDicomDate(tags["StudyDate"] ?? ""),
    studyTime: tags["StudyTime"] ?? "",
    studyDescription: tags["StudyDescription"] ?? "",
    modality: tags["Modality"] ?? tags["ModalitiesInStudy"] ?? "OT",
    bodyPart: tags["BodyPartExamined"] ?? "",
    referringPhysician: formatDicomName(tags["ReferringPhysicianName"] ?? ""),
    numberOfSeries: s.Series.length,
    numberOfInstances: 0, // would need per-series fetch; skip for worklist performance
    seriesIds: s.Series,
  };
}

/** Fetches a single study by StudyInstanceUID with full detail. */
export async function getStudyByUid(studyInstanceUid: string): Promise<OrthancStudy | null> {
  // Orthanc doesn't filter by UID directly in a single call without the /tools/find endpoint
  const body = {
    Level: "Study",
    Query: { StudyInstanceUID: studyInstanceUid },
    Expand: true,
  };
  const results = await orthancFetch<OrthancStudyResponse[]>("/tools/find", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (results.length === 0) return null;
  return parseStudy(results[0]);
}

/** Returns the WADO-RS URL for a study's images (for OHIF/Weasis to fetch). */
export function getStudyWadoUrl(studyInstanceUid: string): string {
  return `${ORTHANC_URL.replace(/\/$/, "")}/wado-rs/studies/${studyInstanceUid}`;
}

/** Returns the Orthanc DICOM-web viewer URL (if the DICOM-web plugin is enabled). */
export function getOrthancViewerUrl(studyInstanceUid: string): string {
  return `${ORTHANC_URL.replace(/\/$/, "")}/dicom-web/viewer/viewer.html?StudyInstanceUIDs=${studyInstanceUid}`;
}

/** Tests connectivity to Orthanc. */
export async function testOrthanc(): Promise<{ ok: boolean; systemInfo?: string; error?: string }> {
  try {
    const info = await orthancFetch<{ Name?: string; Version?: string }>("/system");
    return {
      ok: true,
      systemInfo: `${info.Name ?? "Orthanc"} ${info.Version ?? ""}`.trim(),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Connection failed" };
  }
}
