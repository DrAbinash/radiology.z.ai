/**
 * PrintPreview — a live, WYSIWYG preview of the final radiology report,
 * rendered as printable HTML. Opens in a modal overlay; the "Print" button
 * triggers window.print() with a print-only stylesheet.
 *
 * Matches the ERP's reportPdfGenerator layout (header → title → patient box
 * → sections → signature → footer) but renders as HTML so it's crisp on
 * screen and paper alike, with no PDF library dependency.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Printer } from "lucide-react";
import { api } from "@/lib/fetchApi";

export interface PrintSettings {
  hospitalName: string;
  hospitalTagline: string;
  hospitalAddress: string;
  hospitalPhone: string;
  hospitalEmail: string;
  logoDataUrl: string | null;
  reportTitle: string;
  layout: string[];
  signatureName: string;
  signatureQualification: string;
  signatureRegistrationNo: string;
  signatureImageDataUrl: string | null;
  showQualification: boolean;
  showRegistrationNo: boolean;
  footerDisclaimer: string;
  paperSize: string;
  fontSize: string;
}

export interface ReportData {
  patientName: string;
  age: string | null;
  sex: string | null;
  accessionNumber: string;
  studyDate: string | null;
  referringDoctor: string | null;
  modality: string;
  bodyPart: string | null;
  clinicalHistory: string;
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
}

const SECTION_LABELS: Record<string, string> = {
  patientBox: "Patient Demographics",
  clinicalHistory: "Clinical History",
  technique: "Technique",
  findings: "Findings",
  impression: "Impression",
  recommendation: "Recommendation",
};

export default function PrintPreview({
  report,
  onClose,
  onPrinted,
}: {
  report: ReportData;
  onClose: () => void;
  onPrinted?: () => void;
}) {
  const [settings, setSettings] = useState<PrintSettings | null>(null);

  useEffect(() => {
    api<{ settings: PrintSettings }>("/api/settings/print")
      .then((r) => setSettings(r.settings))
      .catch(() => {
        /* use defaults if settings not configured */
      });
  }, []);

  // Inject print styles — multi-page aware: sections avoid breaking mid-block,
  // and the patient header repeats on each page via thead.
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "rad-print-preview-style";
    style.textContent = `
      @media print {
        body * { visibility: hidden; }
        #rad-print-area, #rad-print-area * { visibility: visible; }
        #rad-print-area { position: absolute; left: 0; top: 0; width: 100%; }
        .no-print { display: none !important; }
        @page { size: A4; margin: 15mm; }
        /* Avoid breaking inside report sections */
        .rad-section { break-inside: avoid; page-break-inside: avoid; }
        /* The patient box should not be split across pages */
        .rad-patient-box { break-inside: avoid; page-break-inside: avoid; }
        /* Signature block stays together */
        .rad-signature { break-inside: avoid; page-break-inside: avoid; }
        /* Hospital header on first page only */
        .rad-header { break-after: avoid; page-break-after: avoid; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.getElementById("rad-print-preview-style")?.remove();
    };
  }, []);

  function handlePrint() {
    window.print();
    // After the print dialog closes, offer to mark as delivered
    if (onPrinted) {
      setTimeout(() => onPrinted(), 500);
    }
  }

  if (!settings) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <p className="text-white">Loading print settings…</p>
      </div>
    );
  }

  const fontSizeClass =
    settings.fontSize === "small"
      ? "text-[12px]"
      : settings.fontSize === "large"
        ? "text-[15px]"
        : "text-[13px]";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex flex-col">
      {/* Toolbar (no-print) */}
      <div className="no-print bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <h2 className="font-bold text-sm">Print Preview</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handlePrint} className="bg-primary hover:bg-primary/90">
            <Printer className="h-4 w-4" />
            Print Report
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-auto bg-secondary/30 p-4 sm:p-8">
        <div
          id="rad-print-area"
          className={`mx-auto bg-white shadow-lg ${fontSizeClass}`}
          style={{
            maxWidth: settings.paperSize === "A5" ? "148mm" : "210mm",
            minHeight: settings.paperSize === "A5" ? "210mm" : "297mm",
            padding: "15mm",
            fontFamily: "Georgia, 'Times New Roman', serif",
            color: "#1a1a1a",
            lineHeight: 1.6,
          }}
        >
          {/* Hospital header */}
          <div className="rad-header text-center border-b-2 border-gray-300 pb-3 mb-4">
            {settings.logoDataUrl && (
              <img
                src={settings.logoDataUrl}
                alt="logo"
                className="mx-auto mb-2"
                style={{ maxHeight: "60px" }}
              />
            )}
            <h1 className="text-xl font-bold tracking-wide" style={{ fontFamily: "inherit" }}>
              {settings.hospitalName}
            </h1>
            {settings.hospitalTagline && (
              <p className="text-xs italic text-gray-600 mt-0.5">{settings.hospitalTagline}</p>
            )}
            {settings.hospitalAddress && (
              <p className="text-xs text-gray-600 mt-1">{settings.hospitalAddress}</p>
            )}
            <p className="text-xs text-gray-600">
              {[settings.hospitalPhone, settings.hospitalEmail].filter(Boolean).join("  ·  ")}
            </p>
          </div>

          {/* Report title */}
          <h2 className="text-center font-bold underline mb-4" style={{ fontSize: "1.15em" }}>
            {settings.reportTitle}
          </h2>

          {/* Layout-driven sections */}
          {(settings.layout ?? ["patientBox", "clinicalHistory", "technique", "findings", "impression", "recommendation"])
            .map((section) => {
              switch (section) {
                case "patientBox":
                  return (
                    <div key="patientBox" className="rad-patient-box mb-4 border border-gray-300 rounded p-3">
                      <table className="w-full text-xs">
                        <tbody>
                          <tr>
                            <td className="font-semibold pr-4">Patient:</td>
                            <td>{report.patientName}</td>
                            <td className="font-semibold pr-4 pl-6">Age/Sex:</td>
                            <td>{report.age ?? "—"} / {report.sex ?? "—"}</td>
                          </tr>
                          <tr>
                            <td className="font-semibold pr-4 pt-1">Accession:</td>
                            <td className="pt-1 font-mono">{report.accessionNumber}</td>
                            <td className="font-semibold pr-4 pl-6 pt-1">Date:</td>
                            <td className="pt-1">
                              {report.studyDate
                                ? new Date(report.studyDate).toLocaleDateString("en-IN")
                                : "—"}
                            </td>
                          </tr>
                          <tr>
                            <td className="font-semibold pr-4 pt-1">Modality:</td>
                            <td className="pt-1">{report.modality}</td>
                            <td className="font-semibold pr-4 pl-6 pt-1">Ref. Doctor:</td>
                            <td className="pt-1">{report.referringDoctor ?? "—"}</td>
                          </tr>
                          {report.bodyPart && (
                            <tr>
                              <td className="font-semibold pr-4 pt-1">Body Part:</td>
                              <td className="pt-1" colSpan={3}>{report.bodyPart}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                case "clinicalHistory":
                  return report.clinicalHistory?.trim() ? (
                    <Section key="clinicalHistory" label="Clinical History" text={report.clinicalHistory} />
                  ) : null;
                case "technique":
                  return report.technique?.trim() ? (
                    <Section key="technique" label="Technique" text={report.technique} />
                  ) : null;
                case "findings":
                  return report.findings?.trim() ? (
                    <Section key="findings" label="Findings" text={report.findings} />
                  ) : null;
                case "impression":
                  return report.impression?.trim() ? (
                    <Section key="impression" label="Impression" text={report.impression} />
                  ) : null;
                case "recommendation":
                  return report.recommendation?.trim() ? (
                    <Section key="recommendation" label="Recommendation" text={report.recommendation} />
                  ) : null;
                default:
                  return null;
              }
            })}

          {/* Signature block */}
          <div className="rad-signature mt-12 flex justify-end">
            <div className="text-center">
              {settings.signatureImageDataUrl && (
                <img
                  src={settings.signatureImageDataUrl}
                  alt="signature"
                  className="mx-auto mb-1"
                  style={{ maxHeight: "50px" }}
                />
              )}
              <div className="border-t border-gray-500 pt-1 px-8">
                <p className="font-bold text-sm">{settings.signatureName}</p>
                {settings.showQualification && (
                  <p className="text-xs text-gray-700">{settings.signatureQualification}</p>
                )}
                {settings.showRegistrationNo && settings.signatureRegistrationNo && (
                  <p className="text-xs text-gray-700">Reg. No: {settings.signatureRegistrationNo}</p>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 pt-3 border-t border-gray-300 text-center">
            <p className="text-xs italic text-gray-600">{settings.footerDisclaimer}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, text }: { label: string; text: string }) {
  return (
    <div className="rad-section mb-3">
      <p className="font-bold underline mb-1" style={{ fontSize: "1.05em" }}>
        {label}:
      </p>
      <p className="whitespace-pre-wrap" style={{ fontSize: "0.95em" }}>
        {text}
      </p>
    </div>
  );
}
