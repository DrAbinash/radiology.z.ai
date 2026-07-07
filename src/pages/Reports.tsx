/**
 * Reports — search past finalized reports.
 * Lets you find a report by patient name, accession, or study description.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { RadUser } from "@/lib/session";

interface Report {
  studyInstanceUid: string;
  patientName: string | null;
  accessionNumber: string | null;
  modality: string | null;
  studyDescription: string | null;
  studyDate: string | null;
  finalizedAt: string | null;
  radiologistName: string | null;
}

const MODALITY_LABELS: Record<string, string> = {
  MR: "MRI", CT: "CT", US: "USG", CR: "X-Ray", MG: "Mammo",
};

export default function Reports({
  user,
  onBack,
  onOpenStudy,
}: {
  user: RadUser;
  onBack: () => void;
  onOpenStudy: (uid: string) => void;
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api<{ reports: Report[] }>(`/api/studies/reports/search?q=${encodeURIComponent(search)}`);
      setReports(res.reports);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="min-h-screen bg-secondary/30">
      <header className="sticky top-0 z-10 bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
            <h1 className="font-bold">Finalized Reports</h1>
          </div>
          <span className="text-sm text-muted-foreground">{user.name}</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Input
          placeholder="Search by patient name, accession, or study…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 max-w-md"
          autoFocus
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {loading ? "Searching…" : `${reports.length} report${reports.length === 1 ? "" : "s"}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {reports.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {search ? "No reports match your search." : "No finalized reports yet."}
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[65vh] overflow-y-auto">
                {reports.map((r) => (
                  <button
                    key={r.studyInstanceUid}
                    onClick={() => onOpenStudy(r.studyInstanceUid)}
                    className="w-full text-left p-4 hover:bg-secondary/50 transition-colors flex items-center gap-4"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
                      {MODALITY_LABELS[r.modality ?? ""] ?? r.modality ?? "—"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{r.patientName ?? "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.accessionNumber && <span className="font-mono">{r.accessionNumber} · </span>}
                        {r.studyDescription ?? "No description"}
                        {r.studyDate && <> · {r.studyDate}</>}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground shrink-0">
                      {r.finalizedAt && (
                        <>
                          <p>Finalized</p>
                          <p>{new Date(r.finalizedAt).toLocaleDateString("en-IN")}</p>
                          {r.radiologistName && <p className="mt-0.5">by {r.radiologistName}</p>}
                        </>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
