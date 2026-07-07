/**
 * Cockpit — the radiology reporting workspace, with full engine integration.
 *
 * Wires together:
 *   - QuickFindingsPanel (study tabs, finding buttons, property chips)
 *   - Abnormality Engine (structured instances → instant report updates)
 *   - Protocol + Checklist Engine (auto-addressed checklist, quality score)
 *   - Learning Engine (suggestion chips, record at finalize)
 *   - Draft autosave (every 2s) → radiology DB
 *   - Finalize → assembled text pushed to ERP via boundary
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import QuickFindingsPanel, {
  type QuickFinding,
  type QuickProtocol,
} from "@/components/QuickFindingsPanel";
import PrintPreview, { type ReportData } from "@/components/PrintPreview";
import VoiceDictationButton from "@/components/VoiceDictationButton";
import type { RadUser } from "@/lib/session";
import type { Side } from "@/lib/sideSwap";
import {
  renderAbnormality,
  EMPTY_INSTANCE,
  type AbnormalityInstance,
} from "@/lib/abnormalityEngine";
import {
  mergeBlock,
  removeBlock,
  mergeImpression,
  removeImpression,
} from "@/lib/quickFindingsMerge";

interface StudyDetail {
  study: {
    id: string;
    studyInstanceUid: string;
    patientName: string;
    patientId: string;
    patientBirthDate: string;
    patientSex: string;
    accessionNumber: string;
    studyDate: string;
    studyDescription: string;
    modality: string;
    bodyPart: string;
    referringPhysician: string;
    numberOfSeries: number;
  };
  draft: {
    clinicalHistory: string | null;
    technique: string | null;
    findings: string | null;
    impression: string | null;
    recommendation: string | null;
    abnormalities: unknown[] | null;
  } | null;
  viewerUrls: {
    ohif: string | null;
    weasis: string | null;
    orthancBuiltIn: string | null;
  };
  // ERP enrichment (present when ERP_API_URL is configured)
  erpEnrichment?: {
    patientName?: string;
    patientId?: string;
    age?: string;
    sex?: string;
    phone?: string;
    referringDoctor?: string;
    clinicalHistory?: string;
    studyName?: string;
    billStatus?: string;
    priority?: string;
  } | null;
}

export default function Cockpit({
  accession: studyUid,
  user,
  onBack,
}: {
  accession: string; // StudyInstanceUID from Orthanc
  user: RadUser;
  onBack: () => void;
}) {
  const [data, setData] = useState<StudyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [finalizedReport, setFinalizedReport] = useState<ReportData | null>(null);
  const [delivering, setDelivering] = useState(false);

  // Refs for keyboard navigation between sections
  const findingsRef = useRef<HTMLTextAreaElement>(null);
  const impressionRef = useRef<HTMLTextAreaElement>(null);

  // AI loading states
  const [aiLoading, setAiLoading] = useState<string | null>(null); // "impression" | "draft" | "enhance-<section>" | "suggest"

  // ── AI handlers (Ollama-powered) ──────────────────────────────────────────
  async function runAiImpression() {
    if (!findings.trim()) {
      alert("Write or select findings first, then generate the impression.");
      return;
    }
    setAiLoading("impression");
    try {
      const res = await api<{ impression: string }>("/api/ai/impression", {
        method: "POST",
        body: JSON.stringify({
          findings,
          modality: data!.study.modality,
          bodyPart: data!.study.bodyPart,
        }),
      });
      if (res.impression.trim()) {
        setImpression((prev) => [...prev, ...(prev.length ? ["", res.impression] : [res.impression])].filter(Boolean));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "AI failed. Is Ollama running?");
    } finally {
      setAiLoading(null);
    }
  }

  async function runAiDraft() {
    setAiLoading("draft");
    try {
      const res = await api<{ draft: string }>("/api/ai/draft-findings", {
        method: "POST",
        body: JSON.stringify({
          clinicalHistory,
          modality: data!.study.modality,
          bodyPart: data!.study.bodyPart,
          protocolName: activeProtocol?.name ?? null,
        }),
      });
      if (res.draft.trim()) {
        setFindings((prev) => (prev.trim() ? prev + "\n\n" + res.draft : res.draft));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "AI failed. Is Ollama running?");
    } finally {
      setAiLoading(null);
    }
  }

  async function runAiEnhance(section: string, value: string, setter: (v: string) => void) {
    if (!value.trim()) return;
    setAiLoading(`enhance-${section}`);
    try {
      const res = await api<{ text: string }>("/api/ai/enhance", {
        method: "POST",
        body: JSON.stringify({ section, text: value }),
      });
      if (res.text.trim()) setter(res.text);
    } catch (err) {
      alert(err instanceof Error ? err.message : "AI failed. Is Ollama running?");
    } finally {
      setAiLoading(null);
    }
  }

  // ── Keyboard hotkeys ────────────────────────────────────────────────────
  //   Ctrl+S      → save draft now
  //   Ctrl+Enter  → finalize & sign
  //   Ctrl+P      → preview (without finalizing)
  //   Alt+F       → focus findings
  //   Alt+I       → focus impression
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void saveDraft();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && data) {
        e.preventDefault();
        void handleFinalize();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "p" && data) {
        e.preventDefault();
        handlePreviewOnly();
        return;
      }
      if (e.altKey && !e.ctrlKey) {
        if (e.key === "f") {
          e.preventDefault();
          findingsRef.current?.focus();
        } else if (e.key === "i") {
          e.preventDefault();
          impressionRef.current?.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Report sections
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [technique, setTechnique] = useState("");
  const [findings, setFindings] = useState("");
  const [impression, setImpression] = useState<string[]>([]);
  const [recommendation, setRecommendation] = useState("Please correlate with clinical findings.");

  // Quick Select engine state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [quickSide, setQuickSide] = useState<Side>("left");
  const [quickInstances, setQuickInstances] = useState<Map<number, AbnormalityInstance>>(new Map());
  const insertedTextRef = useRef<
    Map<number, { finding: string; impression: string; technique: string; recommendation: string }>
  >(new Map());
  const lastToggledFindingRef = useRef<QuickFinding | null>(null);

  // Protocol + checklist state
  const [activeProtocolId, setActiveProtocolId] = useState<number | null>(null);
  const [activeProtocol, setActiveProtocol] = useState<QuickProtocol | null>(null);
  const [checklistPercent, setChecklistPercent] = useState(100);
  const [checklistRemaining, setChecklistRemaining] = useState<string[]>([]);

  // Track the abnormalities array for the draft (so we can record learning at finalize)
  const [abnormalitiesForDraft, setAbnormalitiesForDraft] = useState<
    Array<{ label: string; recommendationText: string }>
  >([]);

  // ── Load study + draft ─────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await api<StudyDetail>(`/api/studies/${encodeURIComponent(studyUid)}`);
        setData(res);
        const d = res.draft;
        setClinicalHistory(d?.clinicalHistory ?? res.erpEnrichment?.clinicalHistory ?? "");
        setTechnique(d?.technique ?? "");
        setFindings(d?.findings ?? "");
        setImpression(d?.impression ? [d.impression] : []);
        setRecommendation(d?.recommendation ?? "Please correlate with clinical findings.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load study");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [studyUid]);

  // ── Abnormality engine: exact-remove then dedupe-merge ─────────────────────
  const applyRendered = useCallback(
    (
      id: number,
      next: { finding: string; impression: string; technique: string; recommendation: string } | null,
    ) => {
      const prev = insertedTextRef.current.get(id);
      if (prev) {
        if (prev.finding) setFindings((p) => removeBlock(p, prev.finding));
        if (prev.impression) setImpression((p) => removeImpression(p, prev.impression));
        if (prev.technique) setTechnique((p) => removeBlock(p, prev.technique));
        if (prev.recommendation) setRecommendation((p) => removeBlock(p, prev.recommendation));
      }
      if (next) {
        insertedTextRef.current.set(id, next);
        if (next.finding) setFindings((p) => mergeBlock(p, next.finding));
        if (next.impression) setImpression((p) => mergeImpression(p, next.impression));
        if (next.technique) setTechnique((p) => mergeBlock(p, next.technique));
        if (next.recommendation) setRecommendation((p) => mergeBlock(p, next.recommendation));
      } else {
        insertedTextRef.current.delete(id);
      }
    },
    [],
  );

  function handleQuickToggle(f: QuickFinding, nowSelected: boolean) {
    if (nowSelected) lastToggledFindingRef.current = f;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (nowSelected) next.add(f.id);
      else next.delete(f.id);
      return next;
    });
    if (nowSelected) {
      const inst: AbnormalityInstance = { ...EMPTY_INSTANCE, side: quickSide };
      setQuickInstances((prev) => new Map(prev).set(f.id, inst));
      applyRendered(f.id, renderAbnormality(f, inst));
      setAbnormalitiesForDraft((prev) => [
        ...prev,
        { label: f.label, recommendationText: f.recommendationText },
      ]);
    } else {
      setQuickInstances((prev) => {
        const next = new Map(prev);
        next.delete(f.id);
        return next;
      });
      applyRendered(f.id, null);
      setAbnormalitiesForDraft((prev) => prev.filter((a) => a.label !== f.label));
    }
  }

  function handleInstanceUpdate(f: QuickFinding, patch: Partial<AbnormalityInstance>) {
    const current = quickInstances.get(f.id) ?? { ...EMPTY_INSTANCE, side: quickSide };
    const inst = { ...current, ...patch };
    setQuickInstances((prev) => new Map(prev).set(f.id, inst));
    applyRendered(f.id, renderAbnormality(f, inst));
  }

  function handleAutoTechnique(text: string) {
    setTechnique((prev) => (prev.trim() ? prev : text));
  }

  function handleInsertNormals(text: string) {
    setFindings((prev) => mergeBlock(prev, text));
  }

  function handleProtocolChange(protocol: QuickProtocol | null) {
    setActiveProtocol(protocol);
    setActiveProtocolId(protocol?.id ?? null);
    if (!protocol) return;
    if (protocol.techniqueText)
      setTechnique((prev) => (prev.trim() ? prev : protocol.techniqueText));
    if (protocol.recommendationText)
      setRecommendation((prev) => mergeBlock(prev, protocol.recommendationText));
  }

  function handleAcceptLearnedSuggestion(text: string) {
    setRecommendation((prev) => mergeBlock(prev, text));
  }

  // ── Autosave (debounced 2s) ────────────────────────────────────────────────
  const saveDraft = useCallback(async () => {
    setSaving(true);
    try {
      await api(`/api/studies/${encodeURIComponent(studyUid)}/draft`, {
        method: "PUT",
        body: JSON.stringify({
          clinicalHistory,
          technique,
          findings,
          impression: impression.join("\n"),
          recommendation,
          abnormalities: abnormalitiesForDraft,
          activeProtocolName: activeProtocol?.name ?? null,
          activeProtocolRegion: activeProtocol?.region ?? null,
        }),
      });
    } catch {
      /* silent */
    } finally {
      setSaving(false);
    }
  }, [studyUid, clinicalHistory, technique, findings, impression, recommendation, abnormalitiesForDraft, activeProtocol]);

  useEffect(() => {
    if (!data) return;
    const t = setTimeout(saveDraft, 2000);
    return () => clearTimeout(t);
  }, [data, saveDraft]);

  // ── Finalize → Print Preview → Deliver (one flow) ──────────────────────────
  // Finalize pushes the assembled report to the ERP, then opens the print
  // preview. After printing, the radiologist can mark the study as delivered
  // (which logs the print issuance in the ERP) — all in one flow.
  async function handleFinalize() {
    if (!confirm("Finalize this report? This pushes it to the ERP for printing and delivery.")) {
      return;
    }
    setFinalizing(true);
    try {
      const res = await api<{ ok: boolean; finalReportText: string }>(
        `/api/studies/${encodeURIComponent(studyUid)}/finalize`,
        { method: "POST" },
      );
      // Build the report data for the print preview from the current study + sections
      const reportData: ReportData = {
        patientName: data!.study.patientName,
        age: data!.study.patientSex || null,
        sex: data!.study.patientSex || null,
        accessionNumber: data!.study.accessionNumber,
        studyDate: data!.study.studyDate,
        referringDoctor: data!.study.referringPhysician || null,
        modality: data!.study.modality,
        bodyPart: data!.study.bodyPart,
        clinicalHistory,
        technique,
        findings,
        impression: impression.join("\n"),
        recommendation,
      };
      setFinalizedReport(reportData);
      setShowPreview(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Finalize failed");
    } finally {
      setFinalizing(false);
    }
  }

  /** Preview without finalizing — lets the radiologist see the layout mid-report. */
  function handlePreviewOnly() {
    const reportData: ReportData = {
      patientName: data!.study.patientName,
      age: data!.study.patientSex || null,
      sex: data!.study.patientSex || null,
      accessionNumber: data!.study.accessionNumber,
      studyDate: data!.study.studyDate,
      referringDoctor: data!.study.referringPhysician || null,
      modality: data!.study.modality,
      bodyPart: data!.study.bodyPart,
      clinicalHistory,
      technique,
      findings,
      impression: impression.join("\n"),
      recommendation,
    };
    setFinalizedReport(reportData);
    setShowPreview(true);
  }

  /** Mark the study as delivered in the ERP (after printing). */
  async function handleMarkDelivered() {
    setDelivering(true);
    try {
      await api(`/api/studies/${encodeURIComponent(studyUid)}/deliver`, { method: "POST" });
      alert("Study marked as delivered in the ERP. ✓");
      onBack();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not mark as delivered");
    } finally {
      setDelivering(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading study…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
        <p className="text-destructive">{error || "Study not found"}</p>
        <Button variant="outline" onClick={onBack}>
          Back to worklist
        </Button>
      </div>
    );
  }

  const { study } = data;
  const qualityColor =
    checklistPercent === 100
      ? "bg-primary/10 text-primary border-primary/20"
      : checklistPercent >= 50
        ? "bg-amber-500/10 text-amber-700 border-amber-500/20"
        : "bg-destructive/10 text-destructive border-destructive/20";

  return (
    <div className="min-h-screen bg-secondary/30">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="sm" onClick={onBack}>
              ← Back
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-bold truncate">{study.patientName}</h1>
                <Badge variant="outline">{study.modality}</Badge>
                {activeProtocol && (
                  <Badge variant="secondary" className="text-xs">
                    {activeProtocol.isGoldStandard && "★ "}
                    {activeProtocol.name}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-mono">{study.accessionNumber}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saving && (
              <span className="text-xs text-muted-foreground hidden sm:block">Saving…</span>
            )}
            {activeProtocol && (
              <Badge className={qualityColor} title={`Checklist: ${checklistRemaining.join(", ") || "complete"}`}>
                {checklistPercent}% complete
              </Badge>
            )}
            {data?.viewerUrls.weasis && (
              <a href={data.viewerUrls.weasis} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" title="Open in Weasis (desktop app)">Weasis</Button>
              </a>
            )}
            {data?.viewerUrls.ohif && (
              <a href={data.viewerUrls.ohif} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" title="Open in OHIF (web)">OHIF</Button>
              </a>
            )}
            {!data?.viewerUrls.ohif && data?.viewerUrls.orthancBuiltIn && (
              <a href={data.viewerUrls.orthancBuiltIn} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" title="Open Orthanc viewer">🖼️ Viewer</Button>
              </a>
            )}
            <Button variant="outline" size="sm" onClick={handlePreviewOnly} title="Preview the report layout without finalizing">
              👁️ Preview
            </Button>
            <Button onClick={handleFinalize} disabled={finalizing} className="bg-primary hover:bg-primary/90">
              {finalizing ? "Finalizing…" : "✓ Finalize & Sign"}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Patient bar — ERP-enriched where available, else Orthanc DICOM tags */}
        <Card className="mb-4">
          <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Patient ID</p>
              <p className="font-medium font-mono">
                {data.erpEnrichment?.patientId ?? study.patientId}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Age / Sex</p>
              <p className="font-medium">
                {data.erpEnrichment?.age ?? "—"} / {data.erpEnrichment?.sex ?? study.patientSex ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Study</p>
              <p className="font-medium">
                {data.erpEnrichment?.studyName ?? study.studyDescription ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Body Part</p>
              <p className="font-medium">{study.bodyPart || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Referring Doctor</p>
              <p className="font-medium">
                {data.erpEnrichment?.referringDoctor ?? study.referringPhysician ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="font-medium">
                {study.studyDate ? new Date(study.studyDate).toLocaleDateString("en-IN") : "—"}
              </p>
            </div>
            {/* ERP enrichment indicator */}
            {data.erpEnrichment && (
              <div className="col-span-2 sm:col-span-4 lg:col-span-6 pt-2 border-t border-border/50 flex items-center gap-3 text-xs text-muted-foreground">
                {data.erpEnrichment.phone && <span>📞 {data.erpEnrichment.phone}</span>}
                {data.erpEnrichment.billStatus && (
                  <span className={
                    data.erpEnrichment.billStatus === "paid"
                      ? "text-primary font-medium"
                      : "text-amber-600 font-medium"
                  }>
                    Bill: {data.erpEnrichment.billStatus}
                  </span>
                )}
                {data.erpEnrichment.priority && data.erpEnrichment.priority !== "routine" && (
                  <span className="text-destructive font-medium">
                    {data.erpEnrichment.priority.toUpperCase()}
                  </span>
                )}
                <span className="ml-auto text-primary">✓ ERP data linked</span>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Report editor */}
          <div className="lg:col-span-2 space-y-4">
            <ReportSection
              label="Clinical History"
              value={clinicalHistory}
              onChange={setClinicalHistory}
              rows={2}
            />
            <ReportSection
              label="Technique"
              value={technique}
              onChange={setTechnique}
              rows={3}
              hint="Auto-filled from protocol — edit as needed"
              aiAction={{
                label: aiLoading === "enhance-technique" ? "Enhancing…" : "Enhance",
                onRun: () => runAiEnhance("technique", technique, setTechnique),
                loading: aiLoading === "enhance-technique",
              }}
            />
            <ReportSection
              label="Findings"
              value={findings}
              onChange={setFindings}
              rows={8}
              textareaRef={findingsRef}
              hotkey="Alt+F"
              aiAction={{
                label: aiLoading === "draft" ? "Drafting…" : "Draft",
                onRun: runAiDraft,
                loading: aiLoading === "draft",
              }}
            />
            <ReportSection
              label="Impression"
              value={impression.join("\n")}
              onChange={(v) => setImpression(v.split("\n").filter(Boolean))}
              rows={3}
              textareaRef={impressionRef}
              hotkey="Alt+I"
              aiAction={{
                label: aiLoading === "impression" ? "Generating…" : "Generate",
                onRun: runAiImpression,
                loading: aiLoading === "impression",
              }}
            />
            <ReportSection
              label="Recommendation"
              value={recommendation}
              onChange={setRecommendation}
              rows={2}
            />
          </div>

          {/* Quick Select panel */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="p-3">
                <CardTitle className="text-sm">Quick Select</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <QuickFindingsPanel
                  selectedIds={selectedIds}
                  onToggle={handleQuickToggle}
                  side={quickSide}
                  onSideChange={setQuickSide}
                  disabled={finalizing}
                  initialStudyHint={study.studyDescription ?? study.bodyPart}
                  instances={quickInstances}
                  onUpdateInstance={handleInstanceUpdate}
                  onAutoTechnique={handleAutoTechnique}
                  onInsertNormals={handleInsertNormals}
                  activeProtocolId={activeProtocolId}
                  onProtocolChange={handleProtocolChange}
                  onChecklistChange={(percent, remaining) => {
                    setChecklistPercent(percent);
                    setChecklistRemaining(remaining);
                  }}
                  onAcceptLearnedSuggestion={handleAcceptLearnedSuggestion}
                  radiologistId={user.id}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-3">
                <CardTitle className="text-sm">Reporting as</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 text-sm">
                <p className="font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {user.role.replace("_", " ")}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Print Preview modal — opens after finalize (or via Preview button) */}
      {showPreview && finalizedReport && (
        <PrintPreview
          report={finalizedReport}
          onClose={() => {
            setShowPreview(false);
            // If the report was finalized (not just a preview), offer to mark delivered
            if (!finalizing && finalizedReport) {
              if (confirm("Was the report printed successfully? Mark this study as delivered in the ERP?")) {
                void handleMarkDelivered();
              }
            }
          }}
          onPrinted={() => {
            /* print dialog closed — the onClose handler will offer the deliver prompt */
          }}
        />
      )}

      {/* Delivering indicator */}
      {delivering && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <p className="bg-card px-6 py-4 rounded-lg shadow-lg font-medium">
            Marking as delivered in ERP…
          </p>
        </div>
      )}
    </div>
  );
}

function ReportSection({
  label,
  value,
  onChange,
  rows,
  hint,
  textareaRef,
  hotkey,
  aiAction,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  hint?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  hotkey?: string;
  aiAction?: { label: string; onRun: () => void; loading: boolean };
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold">{label}</label>
            {hotkey && (
              <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-secondary text-muted-foreground">
                {hotkey}
              </kbd>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
            {aiAction && (
              <Button
                variant="ghost"
                size="sm"
                onClick={aiAction.onRun}
                disabled={aiAction.loading}
                className="text-primary hover:bg-primary/10"
                title={aiAction.label}
              >
                {aiAction.loading ? "⏳" : "✨"} {aiAction.label}
              </Button>
            )}
            <VoiceDictationButton onText={(text) => onChange(value + text)} />
          </div>
        </div>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={`${label}…`}
        />
      </CardContent>
    </Card>
  );
}
