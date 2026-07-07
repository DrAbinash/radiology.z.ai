/**
 * Viewer launcher — generates URLs that open OHIF or Weasis on the user's
 * laptop, pointing at the study in Orthanc on the NAS.
 *
 * Configuration (env vars or admin settings):
 *   OHIF_URL     — base URL of an OHIF instance. Can be:
 *                    - On the NAS:     http://<nas-ip>:8042/dicom-web/viewer
 *                    - On the laptop:  http://localhost:3004
 *                    - Cloud:          https://viewer.ohif.org
 *   WEASIS_URL   — base for Weasis launch. Usually "weasis://" (protocol)
 *                  which opens the locally-installed Weasis desktop app.
 *   DICOM_WEB_URL — the DICOMweb QIDO-RS/WADO-RS endpoint (Orthanc's
 *                   /dicom-web). Viewers fetch images from here.
 *                   e.g. http://<nas-ip>:8042/dicom-web
 *
 * The generated URLs are returned to the browser; clicking them opens the
 * viewer on the user's laptop, which then pulls images from Orthanc.
 */

const OHIF_URL = process.env.OHIF_URL ?? ""; // e.g. http://localhost:3004 or http://nas:8042/dicom-web/viewer
const WEASIS_URL = process.env.WEASIS_URL ?? "weasis://"; // protocol launcher
const DICOM_WEB_URL = process.env.DICOM_WEB_URL ?? ""; // e.g. http://nas:8042/dicom-web
const ORTHANC_URL = process.env.ORTHANC_URL ?? "http://localhost:8042";

export interface ViewerUrls {
  ohif: string | null;
  weasis: string | null;
  orthancBuiltIn: string | null;
}

/** Generates viewer launch URLs for a study. */
export function getViewerUrls(studyInstanceUid: string): ViewerUrls {
  const urls: ViewerUrls = {
    ohif: null,
    weasis: null,
    orthancBuiltIn: null,
  };

  // OHIF — web viewer. URL format: <base>/viewer?StudyInstanceUIDs=<uid>
  if (OHIF_URL) {
    const base = OHIF_URL.replace(/\/$/, "");
    // If the OHIF_URL already includes /viewer, don't double it up
    const viewerBase = base.endsWith("/viewer") ? base : `${base}/viewer`;
    urls.ohif = `${viewerBase}?StudyInstanceUIDs=${encodeURIComponent(studyInstanceUid)}`;
  }

  // Weasis — desktop app launched via weasis:// protocol.
  // Format: weasis://<dicomweb-base>?studyUID=<uid>
  // Weasis pulls images from the DICOMweb endpoint.
  if (WEASIS_URL) {
    const dicomWebBase = (DICOM_WEB_URL || `${ORTHANC_URL.replace(/\/$/, "")}/dicom-web`).replace(/\/$/, "");
    // The weasis:// protocol uses a specific arc format:
    // weasis://$dicom:rs<base>?studyUID=1.2.3...
    urls.weasis = `${WEASIS_URL}$dicom:rs${dicomWebBase}?studyUID=${encodeURIComponent(studyInstanceUid)}`;
  }

  // Orthanc's built-in DICOMweb viewer (if the plugin is enabled)
  urls.orthancBuiltIn = `${ORTHANC_URL.replace(/\/$/, "")}/dicom-web/viewer/viewer.html?StudyInstanceUIDs=${encodeURIComponent(studyInstanceUid)}`;

  return urls;
}

/** Returns the configured viewer settings (for the admin UI). */
export function getViewerConfig() {
  return {
    ohifUrl: OHIF_URL,
    weasisUrl: WEASIS_URL,
    dicomWebUrl: DICOM_WEB_URL,
    orthancUrl: ORTHANC_URL,
  };
}
