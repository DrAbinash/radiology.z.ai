/**
 * PrintSettingsPage — admin UI for the printed report layout.
 *
 * Editable: hospital header (name/tagline/address/phone/email/logo),
 * report title, section layout order + visibility, signature block,
 * footer disclaimer, paper size, font size.
 *
 * Changes are saved to the radiology DB via PUT /api/settings/print and
 * immediately reflected in the Print Preview.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { PrintSettings } from "@/components/PrintPreview";
import type { RadUser } from "@/lib/session";
import { isAdmin } from "@/lib/session";
import { ArrowLeft, Save, GripVertical, Cpu, Plug, CheckCircle2, XCircle } from "lucide-react";

interface AiSettings {
  ollamaUrl: string;
  model: string;
  temperature: string;
  maxTokens: number;
  enabled: boolean;
  pushToErp: boolean;
}

const ALL_SECTIONS = [
  { key: "patientBox", label: "Patient Demographics" },
  { key: "clinicalHistory", label: "Clinical History" },
  { key: "technique", label: "Technique" },
  { key: "findings", label: "Findings" },
  { key: "impression", label: "Impression" },
  { key: "recommendation", label: "Recommendation" },
] as const;

export default function PrintSettingsPage({
  user,
  onBack,
}: {
  user: RadUser;
  onBack: () => void;
}) {
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; models: string[]; error?: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ settings: PrintSettings }>("/api/settings/print"),
      api<{ settings: AiSettings }>("/api/ai/settings"),
    ])
      .then(([printRes, aiRes]) => {
        setSettings(printRes.settings);
        setAiSettings(aiRes.settings);
      })
      .catch(() => {
        /* use defaults */
      })
      .finally(() => setLoading(false));
  }, []);

  function updateAi<K extends keyof AiSettings>(key: K, value: AiSettings[K]) {
    setAiSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function handleTestConnection() {
    if (!aiSettings) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api<{ ok: boolean; models: string[]; error?: string }>("/api/ai/test", {
        method: "POST",
        body: JSON.stringify({ url: aiSettings.ollamaUrl }),
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, models: [], error: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveAi() {
    if (!aiSettings) return;
    try {
      await api("/api/ai/settings", { method: "PUT", body: JSON.stringify(aiSettings) });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    }
  }

  // Admin-only
  if (!isAdmin(user.role)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-destructive">Admin access required to edit print settings.</p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading settings…
      </div>
    );
  }

  function update<K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  function moveSection(index: number, direction: "up" | "down") {
    if (!settings) return;
    const layout = [...settings.layout];
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= layout.length) return;
    [layout[index], layout[target]] = [layout[target], layout[index]];
    update("layout", layout);
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      await api("/api/settings/print", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-secondary/30">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <h1 className="font-bold">Print Settings</h1>
          </div>
          <div className="flex items-center gap-2">
            {saved && <Badge className="bg-primary/10 text-primary border-primary/20">Saved ✓</Badge>}
            <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90">
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        {!settings ? (
          <p className="text-muted-foreground">No settings loaded.</p>
        ) : (
          <>
            {/* Hospital Header */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Hospital Header</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Field label="Hospital Name">
                  <Input
                    value={settings.hospitalName}
                    onChange={(e) => update("hospitalName", e.target.value)}
                  />
                </Field>
                <Field label="Tagline">
                  <Input
                    value={settings.hospitalTagline}
                    onChange={(e) => update("hospitalTagline", e.target.value)}
                  />
                </Field>
                <Field label="Address">
                  <Textarea
                    value={settings.hospitalAddress}
                    onChange={(e) => update("hospitalAddress", e.target.value)}
                    rows={2}
                  />
                </Field>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Phone">
                    <Input
                      value={settings.hospitalPhone}
                      onChange={(e) => update("hospitalPhone", e.target.value)}
                    />
                  </Field>
                  <Field label="Email">
                    <Input
                      value={settings.hospitalEmail}
                      onChange={(e) => update("hospitalEmail", e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Logo (data URL — paste a base64 PNG/JPG)">
                  <Input
                    value={settings.logoDataUrl ?? ""}
                    onChange={(e) => update("logoDataUrl", e.target.value || null)}
                    placeholder="data:image/png;base64,..."
                  />
                </Field>
              </CardContent>
            </Card>

            {/* Report Title + Paper */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Report Format</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Field label="Report Title">
                  <Input
                    value={settings.reportTitle}
                    onChange={(e) => update("reportTitle", e.target.value)}
                  />
                </Field>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Paper Size">
                    <select
                      value={settings.paperSize}
                      onChange={(e) => update("paperSize", e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
                    >
                      <option value="A4">A4</option>
                      <option value="A5">A5</option>
                      <option value="Letter">Letter</option>
                    </select>
                  </Field>
                  <Field label="Font Size">
                    <select
                      value={settings.fontSize}
                      onChange={(e) => update("fontSize", e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </Field>
                </div>
              </CardContent>
            </Card>

            {/* Section Layout Order */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Section Layout Order</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">
                  Sections print in this order. Use the arrows to reorder.
                </p>
                <div className="space-y-1.5">
                  {settings.layout.map((section, i) => {
                    const meta = ALL_SECTIONS.find((s) => s.key === section);
                    return (
                      <div
                        key={section}
                        className="flex items-center gap-2 p-2 rounded-lg border border-border bg-background"
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm flex-1">{meta?.label ?? section}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => moveSection(i, "up")}
                          disabled={i === 0}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => moveSection(i, "down")}
                          disabled={i === settings.layout.length - 1}
                        >
                          ↓
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Signature Block */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Signature Block</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Field label="Doctor Name">
                  <Input
                    value={settings.signatureName}
                    onChange={(e) => update("signatureName", e.target.value)}
                  />
                </Field>
                <Field label="Qualification">
                  <Input
                    value={settings.signatureQualification}
                    onChange={(e) => update("signatureQualification", e.target.value)}
                  />
                </Field>
                <Field label="Registration No.">
                  <Input
                    value={settings.signatureRegistrationNo}
                    onChange={(e) => update("signatureRegistrationNo", e.target.value)}
                  />
                </Field>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={settings.showQualification}
                      onChange={(e) => update("showQualification", e.target.checked)}
                    />
                    Show qualification
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={settings.showRegistrationNo}
                      onChange={(e) => update("showRegistrationNo", e.target.checked)}
                    />
                    Show registration no.
                  </label>
                </div>
                <Field label="Signature Image (data URL — paste a base64 PNG of your signature)">
                  <Input
                    value={settings.signatureImageDataUrl ?? ""}
                    onChange={(e) => update("signatureImageDataUrl", e.target.value || null)}
                    placeholder="data:image/png;base64,..."
                  />
                </Field>
              </CardContent>
            </Card>

            {/* Footer */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Footer Disclaimer</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={settings.footerDisclaimer}
                  onChange={(e) => update("footerDisclaimer", e.target.value)}
                  rows={2}
                />
              </CardContent>
            </Card>

            {/* AI Settings (Ollama) */}
            {aiSettings && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-primary" />
                    AI Assistant (Ollama)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Connect to a local Ollama instance (e.g. on your Windows PC) for AI-assisted
                    impression generation, draft findings, and suggestions. All AI is local — no
                    data leaves your LAN.
                  </p>
                  <Field label="Ollama URL (your Windows PC)">
                    <Input
                      value={aiSettings.ollamaUrl}
                      onChange={(e) => updateAi("ollamaUrl", e.target.value)}
                      placeholder="http://192.168.1.50:11434"
                    />
                  </Field>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleTestConnection} disabled={testing}>
                      <Plug className="h-4 w-4" />
                      {testing ? "Testing…" : "Test Connection"}
                    </Button>
                    {testResult && (
                      <div className="flex items-center gap-2 text-sm">
                        {testResult.ok ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                            <span className="text-primary">
                              Connected — {testResult.models.length} models available
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 text-destructive" />
                            <span className="text-destructive">{testResult.error}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {testResult?.ok && testResult.models.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {testResult.models.map((m) => (
                        <button
                          key={m}
                          onClick={() => updateAi("model", m)}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${
                            aiSettings.model === m
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-border hover:bg-muted/50"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid sm:grid-cols-3 gap-3">
                    <Field label="Model">
                      <Input
                        value={aiSettings.model}
                        onChange={(e) => updateAi("model", e.target.value)}
                        placeholder="llama3.2"
                      />
                    </Field>
                    <Field label="Temperature (0-1)">
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max="1"
                        value={aiSettings.temperature}
                        onChange={(e) => updateAi("temperature", e.target.value)}
                      />
                    </Field>
                    <Field label="Max Tokens">
                      <Input
                        type="number"
                        value={aiSettings.maxTokens}
                        onChange={(e) => updateAi("maxTokens", Number(e.target.value))}
                      />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={aiSettings.enabled}
                      onChange={(e) => updateAi("enabled", e.target.checked)}
                    />
                    Enable AI features in the cockpit
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={aiSettings.pushToErp}
                      onChange={(e) => updateAi("pushToErp", e.target.checked)}
                    />
                    <span>
                      <strong>Push finalized reports to ERP</strong> — lets staff
                      print from the ERP's print screen (requires ERP_API_URL +
                      BOUNDARY_API_KEY in .env)
                    </span>
                  </label>
                  <Button onClick={handleSaveAi} size="sm" className="bg-primary hover:bg-primary/90">
                    <Save className="h-4 w-4" /> Save AI Settings
                  </Button>
                  <div className="rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">Setup (on your Windows PC):</p>
                    <p>1. Install Ollama: <code className="bg-background px-1 rounded">winget install Ollama.Ollama</code></p>
                    <p>2. Pull a model: <code className="bg-background px-1 rounded">ollama pull llama3.2</code></p>
                    <p>3. Set OLLAMA_HOST=0.0.0.0:11434 (System env) so other PCs can reach it</p>
                    <p>4. Optional: run Open WebUI in Docker for a chat interface</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
