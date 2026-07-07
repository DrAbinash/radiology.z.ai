/**
 * QuickFindingsPanel — the smart reporting side panel, adapted for the
 * standalone radiology service. Integrates:
 *   - Study tabs (multi-select, auto-technique)
 *   - Finding buttons with property chips (abnormality engine)
 *   - Protocol picker + auto-addressed checklist (checklist engine)
 *   - Learned suggestions (learning engine)
 *   - Search + keyboard shortcuts
 *
 * Insert/remove safety is owned by the parent (Cockpit), which keeps a
 * map of exactly-inserted text per button. This panel only reports intents
 * upward via callbacks.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Star, Lightbulb, CheckCircle2 } from "lucide-react";
import type { Side } from "@/lib/sideSwap";
import {
  parseProperties,
  type AbnormalityInstance,
} from "@/lib/abnormalityEngine";
import {
  computeChecklistStatus,
  summarizeChecklist,
  parseChecklist,
} from "@/lib/checklistEngine";
import { rankSuggestions, type LearnedPattern } from "@/lib/learningEngine";

export type QuickFinding = {
  id: number;
  studyType: string;
  label: string;
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
  tags: string;
  suggests: string;
  properties: string;
  sortOrder: number;
  isActive: boolean;
};

export type QuickStudyTab = {
  id: number;
  name: string;
  modality: string;
  techniqueText: string;
  normalText: string;
  sortOrder: number;
  isActive: boolean;
};

export type QuickProtocol = {
  id: number;
  name: string;
  studyType: string;
  region: string;
  modality: string;
  checklistJson: string;
  techniqueText: string;
  normalText: string;
  recommendationText: string;
  requiredMeasurements: string;
  isGoldStandard: boolean;
  sortOrder: number;
  isActive: boolean;
};

type QuickSelectData = {
  tabs: QuickStudyTab[];
  findings: QuickFinding[];
  protocols: QuickProtocol[];
};

interface Props {
  selectedIds: Set<number>;
  onToggle: (finding: QuickFinding, nowSelected: boolean) => void;
  side: Side;
  onSideChange: (side: Side) => void;
  disabled?: boolean;
  initialStudyHint?: string | null;
  instances?: Map<number, AbnormalityInstance>;
  onUpdateInstance?: (finding: QuickFinding, patch: Partial<AbnormalityInstance>) => void;
  onAutoTechnique?: (text: string) => void;
  onInsertNormals?: (text: string) => void;
  activeProtocolId?: number | null;
  onProtocolChange?: (protocol: QuickProtocol | null) => void;
  onChecklistChange?: (percent: number, remaining: string[]) => void;
  onAcceptLearnedSuggestion?: (text: string) => void;
  radiologistId?: number;
}

const SIDES: Array<{ value: Side; label: string }> = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "bilateral", label: "Bilateral" },
];

export default function QuickFindingsPanel({
  selectedIds,
  onToggle,
  side,
  onSideChange,
  disabled,
  initialStudyHint,
  instances,
  onUpdateInstance,
  onAutoTechnique,
  onInsertNormals,
  activeProtocolId,
  onProtocolChange,
  onChecklistChange,
  onAcceptLearnedSuggestion,
  radiologistId,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");

  // Fetch tabs + findings + protocols in one cached call
  const [data, setData] = useState<QuickSelectData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<QuickSelectData>("/api/meta/quick-select")
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        /* silent — cockpit shows its own error */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTabs = useMemo(
    () => (data?.tabs ?? []).filter((t) => t.isActive),
    [data],
  );
  const findingsById = useMemo(
    () => new Map((data?.findings ?? []).map((f) => [f.id, f])),
    [data],
  );
  const findingsByLabel = useMemo(() => {
    const m = new Map<string, QuickFinding[]>();
    for (const f of data?.findings ?? []) {
      const key = f.label.trim().toLowerCase();
      m.set(key, [...(m.get(key) ?? []), f]);
    }
    return m;
  }, [data]);

  // Multi-select tabs (auto-initialized from study description hint)
  const [selectedTabs, setSelectedTabs] = useState<Set<string> | null>(null);
  const effectiveTabs = useMemo(() => {
    if (selectedTabs) return selectedTabs;
    if (!initialStudyHint || activeTabs.length === 0) return new Set<string>();
    const hint = initialStudyHint.toLowerCase();
    const match = activeTabs.find((t) => hint.includes(t.name.toLowerCase()));
    return match ? new Set([match.name]) : new Set<string>();
  }, [selectedTabs, initialStudyHint, activeTabs]);

  function toggleTab(name: string) {
    const next = new Set(effectiveTabs);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
      const tab = activeTabs.find((t) => t.name === name);
      if (tab?.techniqueText) onAutoTechnique?.(tab.techniqueText);
    }
    setSelectedTabs(next);
  }

  // ── Protocol engine ───────────────────────────────────────────────────────
  const availableProtocols = useMemo(
    () =>
      (data?.protocols ?? []).filter(
        (p) => p.isActive && effectiveTabs.has(p.studyType),
      ),
    [data, effectiveTabs],
  );
  const activeProtocol = useMemo(
    () => availableProtocols.find((p) => p.id === activeProtocolId) ?? null,
    [availableProtocols, activeProtocolId],
  );
  const checklist = useMemo(
    () => parseChecklist(activeProtocol?.checklistJson),
    [activeProtocol],
  );
  const selectedRefs = useMemo(
    () =>
      [...selectedIds]
        .map((id) => findingsById.get(id))
        .filter((f): f is QuickFinding => !!f)
        .map((f) => ({ label: f.label, tags: f.tags })),
    [selectedIds, findingsById],
  );
  const checklistStatus = useMemo(
    () => computeChecklistStatus(checklist, selectedRefs),
    [checklist, selectedRefs],
  );
  const checklistSummary = useMemo(
    () => summarizeChecklist(checklistStatus),
    [checklistStatus],
  );

  useEffect(() => {
    if (activeProtocol)
      onChecklistChange?.(checklistSummary.percent, checklistSummary.remaining);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProtocol?.id, checklistSummary.percent, checklistSummary.remaining.join("|")]);

  // ── Search + filtering ─────────────────────────────────────────────────────
  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (f: QuickFinding) =>
    !searchLower ||
    f.label.toLowerCase().includes(searchLower) ||
    f.tags.toLowerCase().includes(searchLower) ||
    f.findingText.toLowerCase().includes(searchLower);

  const visibleFindings = useMemo(() => {
    if (!data) return [];
    const tabOrder = activeTabs.map((t) => t.name);
    const pool = searchLower
      ? data.findings.filter((f) => f.isActive && matchesSearch(f))
      : data.findings.filter((f) => f.isActive && effectiveTabs.has(f.studyType));
    return pool.sort((a, b) => {
      const ta = tabOrder.indexOf(a.studyType);
      const tb = tabOrder.indexOf(b.studyType);
      if (ta !== tb) return ta - tb;
      return a.sortOrder - b.sortOrder;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, effectiveTabs, activeTabs, searchLower]);

  // ── Suggested strip ────────────────────────────────────────────────────────
  const suggestedFindings = useMemo(() => {
    const out: QuickFinding[] = [];
    const seen = new Set<number>();
    for (const id of selectedIds) {
      const f = findingsById.get(id);
      if (!f?.suggests) continue;
      for (const rawLabel of f.suggests.split(",")) {
        const key = rawLabel.trim().toLowerCase();
        if (!key) continue;
        const candidates = findingsByLabel.get(key) ?? [];
        const pick =
          candidates.find((c) => c.studyType === f.studyType && c.isActive) ??
          candidates.find((c) => c.isActive);
        if (pick && !selectedIds.has(pick.id) && !seen.has(pick.id)) {
          seen.add(pick.id);
          out.push(pick);
        }
      }
    }
    return out;
  }, [selectedIds, findingsById, findingsByLabel]);

  // ── Learned patterns (Phase 5) ─────────────────────────────────────────────
  const selectedLabels = useMemo(
    () =>
      [...selectedIds]
        .map((id) => findingsById.get(id)?.label)
        .filter((l): l is string => !!l),
    [selectedIds, findingsById],
  );
  const [learnedPatterns, setLearnedPatterns] = useState<LearnedPattern[]>([]);
  useEffect(() => {
    if (selectedLabels.length === 0 || !onAcceptLearnedSuggestion || !radiologistId) {
      setLearnedPatterns([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      selectedLabels.map((label) =>
        api<{ patterns: LearnedPattern[] }>(
          `/api/meta/learned-patterns?trigger=${encodeURIComponent(label)}`,
        ).then((r) => r.patterns),
      ),
    )
      .then((results) => {
        if (!cancelled) setLearnedPatterns(results.flat());
      })
      .catch(() => {
        if (!cancelled) setLearnedPatterns([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLabels.join("|"), radiologistId]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      if (e.ctrlKey && !e.altKey) {
        const tab = activeTabs[n - 1];
        if (tab) {
          e.preventDefault();
          toggleTab(tab.name);
        }
      } else if (e.altKey && !e.ctrlKey) {
        const f = visibleFindings[n - 1];
        if (f && !disabled) {
          e.preventDefault();
          onToggle(f, !selectedIds.has(f.id));
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return <p className="text-xs text-muted-foreground p-3">Loading quick select…</p>;
  }
  if (!data || activeTabs.length === 0) {
    return (
      <div className="p-3 space-y-2">
        <p className="text-xs text-muted-foreground">
          No quick-select study tabs configured. Run the seeder to copy them from
          the ERP.
        </p>
      </div>
    );
  }

  function PropertyChips({ f }: { f: QuickFinding }) {
    const props = parseProperties(f.properties);
    if (props.length === 0 || !onUpdateInstance) return null;
    const inst =
      instances?.get(f.id) ?? { side: "", severity: "", chronicity: "", level: "", value: "" };
    const chipCls = (active: boolean) =>
      `text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground hover:bg-muted/50"
      }`;
    return (
      <div className="flex flex-wrap items-center gap-1 pl-4 pb-1.5">
        {props.includes("side") &&
          (["left", "right", "bilateral"] as const).map((s) => (
            <button
              key={s}
              className={chipCls(inst.side === s)}
              disabled={disabled}
              onClick={() => onUpdateInstance(f, { side: inst.side === s ? "" : s })}
            >
              {s === "bilateral" ? "B/L" : s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        {props.includes("severity") &&
          (["mild", "moderate", "severe"] as const).map((s) => (
            <button
              key={s}
              className={chipCls(inst.severity === s)}
              disabled={disabled}
              onClick={() => onUpdateInstance(f, { severity: inst.severity === s ? "" : s })}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        {props.includes("chronicity") &&
          (["acute", "chronic"] as const).map((s) => (
            <button
              key={s}
              className={chipCls(inst.chronicity === s)}
              disabled={disabled}
              onClick={() => onUpdateInstance(f, { chronicity: inst.chronicity === s ? "" : s })}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        {props.includes("level") && (
          <input
            value={inst.level}
            disabled={disabled}
            placeholder="L4-L5"
            onChange={(e) => onUpdateInstance(f, { level: e.target.value })}
            className="h-6 w-20 text-[10px] border rounded px-1 bg-background"
          />
        )}
        {props.includes("measurement") && (
          <input
            value={inst.value}
            disabled={disabled}
            placeholder="mm"
            onChange={(e) => onUpdateInstance(f, { value: e.target.value })}
            className="h-6 w-14 text-[10px] border rounded px-1 bg-background"
          />
        )}
      </div>
    );
  }

  function FindingButton({ f, index }: { f: QuickFinding; index?: number }) {
    const selected = selectedIds.has(f.id);
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-0.5">
          <Button
            size="sm"
            variant={selected ? "default" : "outline"}
            className={`flex-1 justify-start text-xs h-8 ${selected ? "bg-primary text-primary-foreground" : ""}`}
            disabled={disabled}
            onClick={() => onToggle(f, !selected)}
            title={index ? `Alt+${index}` : undefined}
          >
            {f.label}
          </Button>
        </div>
        {selected && <PropertyChips f={f} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search findings…  (press /)"
          className="h-8 pl-7 text-xs"
        />
      </div>

      {/* Side selector */}
      <div className="flex gap-1">
        {SIDES.map((s) => (
          <Button
            key={s.value}
            size="sm"
            variant={side === s.value ? "default" : "outline"}
            className="flex-1 h-7 text-xs"
            onClick={() => onSideChange(s.value)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {/* Study tabs */}
      {!searchLower && (
        <div className="flex flex-wrap gap-1">
          {activeTabs.map((t, i) => (
            <Button
              key={t.id}
              size="sm"
              variant={effectiveTabs.has(t.name) ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => toggleTab(t.name)}
              title={`Ctrl+${i + 1}`}
            >
              {t.name}
            </Button>
          ))}
          {effectiveTabs.size > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => {
                setSelectedTabs(new Set());
                onProtocolChange?.(null);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Protocol picker */}
      {availableProtocols.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">
            Protocol
          </p>
          <div className="flex flex-wrap gap-1">
            {availableProtocols.map((p) => (
              <button
                key={p.id}
                onClick={() => onProtocolChange?.(activeProtocolId === p.id ? null : p)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  activeProtocolId === p.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted/50"
                }`}
              >
                {p.isGoldStandard && <span className="mr-0.5">★</span>}
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Checklist (when a protocol is active) */}
      {activeProtocol && checklist.length > 0 && (
        <div className="rounded-lg border border-border bg-secondary/30 p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">
              Checklist
            </span>
            <Badge
              variant={checklistSummary.percent === 100 ? "default" : "outline"}
              className="text-[10px]"
            >
              {checklistSummary.addressed}/{checklistSummary.total} ({checklistSummary.percent}%)
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1">
            {checklistStatus.map((item) => (
              <span
                key={item.label}
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  item.addressed
                    ? "bg-primary/15 text-primary line-through"
                    : "bg-muted text-muted-foreground"
                }`}
                title={item.addressed ? `Addressed by ${item.matchedBy.join(", ")}` : "Not yet addressed"}
              >
                {item.addressed && <CheckCircle2 className="inline h-2.5 w-2.5 mr-0.5" />}
                {item.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Learned suggestions */}
      {learnedPatterns.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
          <p className="text-[10px] font-semibold uppercase text-amber-700 mb-1 flex items-center gap-1">
            <Lightbulb className="h-3 w-3" /> You usually add
          </p>
          <div className="flex flex-wrap gap-1">
            {learnedPatterns.map((p, i) => (
              <button
                key={i}
                onClick={() => onAcceptLearnedSuggestion?.(p.suggestedText)}
                className="text-[10px] px-2 py-1 rounded border border-amber-500/30 bg-background hover:bg-amber-500/10 text-left"
              >
                {p.suggestedText.length > 50
                  ? p.suggestedText.slice(0, 50) + "…"
                  : p.suggestedText}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Baseline normals button */}
      {effectiveTabs.size > 0 && onInsertNormals && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            const tab = activeTabs.find((t) => effectiveTabs.has(t.name) && t.normalText);
            if (tab?.normalText) onInsertNormals(tab.normalText);
            else if (activeProtocol?.normalText) onInsertNormals(activeProtocol.normalText);
          }}
        >
          <Star className="h-3 w-3" /> Baseline normals
        </Button>
      )}

      {/* Suggested strip */}
      {suggestedFindings.length > 0 && !searchLower && (
        <div>
          <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">
            Suggested
          </p>
          <div className="flex flex-wrap gap-1">
            {suggestedFindings.map((f, i) => (
              <FindingButton key={f.id} f={f} index={i + 1} />
            ))}
          </div>
        </div>
      )}

      {/* Finding buttons */}
      <div>
        <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">
          Findings {searchLower && `(matching "${search}")`}
        </p>
        {visibleFindings.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            {searchLower
              ? "No findings match your search."
              : "Select a study tab above to see findings."}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {visibleFindings.map((f, i) => (
              <FindingButton key={f.id} f={f} index={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
