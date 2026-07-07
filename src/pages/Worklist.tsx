import { useEffect, useState } from "react";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { RadUser } from "@/lib/session";

interface ViewerUrls {
  ohif: string | null;
  weasis: string | null;
  orthancBuiltIn: string | null;
}

interface Study {
  id: string;
  studyInstanceUid: string;
  patientId: string;
  patientName: string;
  patientBirthDate: string;
  patientSex: string;
  accessionNumber: string;
  studyDate: string;
  studyDescription: string;
  modality: string;
  bodyPart: string;
  referringPhysician: string;
  numberOfSeries: number;
  age: string | null;
  draftStatus: string | null;
  draftRadiologist: string | null;
  viewerUrls: ViewerUrls;
  // ERP enrichment (present when ERP_API_URL is configured)
  erpEnriched?: {
    patientName?: string;
    age?: string;
    sex?: string;
    referringDoctor?: string;
    studyName?: string;
    billStatus?: string;
    priority?: string;
  } | null;
}

const MODALITY_LABELS: Record<string, string> = {
  MR: "MRI", CT: "CT", US: "USG", CR: "X-Ray", MG: "Mammo",
};

export default function Worklist({
  user,
  onOpenStudy,
  onOpenSettings,
  onOpenReports,
}: {
  user: RadUser;
  onOpenStudy: (uid: string) => void;
  onOpenSettings?: () => void;
  onOpenReports?: () => void;
}) {
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalityFilter, setModalityFilter] = useState("MR,CT,US,CR");
  const [search, setSearch] = useState("");
  const [myQueueOnly, setMyQueueOnly] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ studies: Study[] }>(`/api/worklist?modality=${modalityFilter}`);
      setStudies(res.studies);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load worklist");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [modalityFilter]);

  const filtered = studies.filter((s) => {
    if (myQueueOnly && s.draftRadiologist !== user.name) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.patientName.toLowerCase().includes(q) ||
      s.accessionNumber.toLowerCase().includes(q) ||
      (s.studyDescription ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-secondary/30">
      <header className="sticky top-0 z-10 bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧠</span>
            <div>
              <h1 className="font-bold text-primary leading-tight">Radiology Workstation</h1>
              <p className="text-xs text-muted-foreground">MRI · CT · USG · X-ray</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">{user.name}</span>
            <Badge variant="outline" className="capitalize">{user.role}</Badge>
            {user.role === "admin" && onOpenSettings && (
              <button onClick={onOpenSettings} className="text-sm text-muted-foreground hover:text-primary" title="Settings">
                ⚙️
              </button>
            )}
            {onOpenReports && (
              <button onClick={onOpenReports} className="text-sm text-muted-foreground hover:text-primary" title="Search past reports">
                📂
              </button>
            )}
            <Button variant="ghost" size="sm" onClick={load} title="Refresh">↻</Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="flex flex-wrap gap-2">
            {[
              { label: "All", value: "MR,CT,US,CR" },
              { label: "MRI", value: "MR" },
              { label: "CT", value: "CT" },
              { label: "USG", value: "US" },
              { label: "X-ray", value: "CR" },
            ].map((opt) => (
              <Button
                key={opt.value}
                variant={modalityFilter === opt.value ? "default" : "outline"}
                size="sm"
                onClick={() => setModalityFilter(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <Button
              variant={myQueueOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setMyQueueOnly(!myQueueOnly)}
            >
              📋 My Queue
            </Button>
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-[200px]"
            />
          </div>
        </div>

        {error && (
          <Card className="mb-4 border-destructive/30 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">
              {error}
              <Button variant="outline" size="sm" onClick={load} className="ml-3">Retry</Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Studies {loading ? "…" : `(${filtered.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading studies from Orthanc…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No studies found.</div>
            ) : (
              <div className="divide-y divide-border max-h-[65vh] overflow-y-auto">
                {filtered.map((s) => (
                  <div key={s.id} className="p-4 hover:bg-secondary/50 transition-colors group">
                    <div className="flex items-start gap-4">
                      <button
                        onClick={() => onOpenStudy(s.studyInstanceUid)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
                            {MODALITY_LABELS[s.modality] ?? s.modality}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold truncate">
                              {s.erpEnriched?.patientName ?? s.patientName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {s.erpEnriched?.age ?? s.age ?? "—"} / {s.erpEnriched?.sex ?? s.patientSex ?? "—"}
                              {s.accessionNumber && <> · <span className="font-mono">{s.accessionNumber}</span></>}
                              {s.studyDate && <> · {s.studyDate}</>}
                              {s.erpEnriched?.referringDoctor && <> · Dr. {s.erpEnriched.referringDoctor}</>}
                            </p>
                            <p className="text-sm text-muted-foreground truncate">
                              {s.erpEnriched?.studyName ?? s.studyDescription ?? "No description"}
                              {s.bodyPart && ` · ${s.bodyPart}`}
                            </p>
                          </div>
                        </div>
                      </button>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {s.draftStatus === "draft" && (
                          <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/20">Draft</Badge>
                        )}
                        {s.draftStatus === "finalized" && (
                          <Badge className="bg-primary/10 text-primary border-primary/20">Finalized</Badge>
                        )}
                        {s.draftStatus === "delivered" && (
                          <Badge className="bg-green-500/10 text-green-700 border-green-500/20">Delivered</Badge>
                        )}
                        {s.erpEnriched?.billStatus === "pending" && (
                          <Badge variant="outline" className="text-amber-600 border-amber-500/30">Bill pending</Badge>
                        )}
                        {s.erpEnriched?.priority && s.erpEnriched.priority !== "routine" && (
                          <Badge className="bg-destructive/10 text-destructive border-destructive/20">
                            {s.erpEnriched.priority.toUpperCase()}
                          </Badge>
                        )}
                        {/* Viewer launch buttons */}
                        <div className="flex gap-1">
                          {s.viewerUrls.weasis && (
                            <a href={s.viewerUrls.weasis} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm" className="h-7 text-xs" title="Open in Weasis (desktop)">
                                Weasis
                              </Button>
                            </a>
                          )}
                          {s.viewerUrls.ohif && (
                            <a href={s.viewerUrls.ohif} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm" className="h-7 text-xs" title="Open in OHIF (web)">
                                OHIF
                              </Button>
                            </a>
                          )}
                          {!s.viewerUrls.ohif && s.viewerUrls.orthancBuiltIn && (
                            <a href={s.viewerUrls.orthancBuiltIn} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm" className="h-7 text-xs" title="Open Orthanc built-in viewer">
                                Viewer
                              </Button>
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
