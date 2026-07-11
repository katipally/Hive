import { useEffect, useState } from "react";
import { KeyRound, Check, Trash2, RefreshCw, ShieldAlert, MessageSquare, Search, Sparkles, Zap } from "lucide-react";
import { api, type ProviderRow, type ModelRow, type SettingsData } from "../api.js";
import { PageHeader, Card, Input, Button, Field } from "../components/ui.js";
import { Segmented, useToast, type SegOption } from "@hive/ui";
import { cn } from "../lib/cn.js";

const ROLES = [
  { id: "chat", label: "Chat", hint: "Powers bee replies", Icon: MessageSquare },
  { id: "extraction", label: "Extraction", hint: "Turns talk into the graph", Icon: Search },
  { id: "social", label: "Social reasoning", hint: "Disclosure, proactive & conclusions", Icon: Sparkles },
] as const;
// Retrieval & dedup are lexical (BM25 / FTS5) — no embeddings model, by design.

const EFFORTS = ["off", "low", "medium", "high"];
const fmtCtx = (n?: number) => (n ? (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`) : null);

// provider → segmented options with a key-status dot
const provOpts = (providers: ProviderRow[]): SegOption<string>[] =>
  providers.map((p) => ({ value: p.id, label: p.label, dot: p.hasKey ? "share" : p.needsKey ? "faint" : null }));

export function SettingsPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [models, setModels] = useState<Record<string, ModelRow[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<string>("");
  const toast = useToast();

  const loadProviders = () => api<ProviderRow[]>("/api/providers").then(setProviders);
  const loadSettings = () => api<SettingsData>("/api/settings").then(setSettings);
  useEffect(() => {
    loadProviders();
    loadSettings();
  }, []);
  useEffect(() => {
    if (!activeProvider && providers[0]) setActiveProvider(providers[0].id);
  }, [providers, activeProvider]);

  async function loadModels(provider: string) {
    setLoading(provider);
    try {
      const r = await api<{ models: ModelRow[] }>(`/api/models?provider=${provider}`);
      setModels((m) => ({ ...m, [provider]: r.models }));
      if (!r.models.length) toast(`No models returned for ${provider} — is the key valid?`, "error");
    } catch {
      setModels((m) => ({ ...m, [provider]: [] }));
      toast(`Couldn't fetch ${provider} models`, "error");
    } finally {
      setLoading(null);
    }
  }
  // Preload models for each configured role's provider so the saved model shows in the
  // dropdown immediately (instead of a blank select until the field is focused).
  useEffect(() => {
    if (!settings) return;
    const provs = new Set(Object.values(settings.modelRoles).map((r) => r?.provider).filter(Boolean) as string[]);
    for (const p of provs) if (!models[p]) loadModels(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  async function saveRole(role: string, cfg: Record<string, unknown>) {
    try {
      await api(`/api/settings/roles/${role}`, { method: "PUT", body: JSON.stringify(cfg) });
      loadSettings();
    } catch {
      toast("Couldn't save model role", "error");
    }
  }
  async function saveProactive(patch: Record<string, unknown>) {
    try {
      await api("/api/settings/proactive", { method: "PUT", body: JSON.stringify(patch) });
      loadSettings();
    } catch {
      toast("Couldn't save proactive settings", "error");
    }
  }

  if (!settings) {
    return (
      <div className="mx-auto h-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] px-8 py-6">
        <div className="skeleton mb-4 h-8 w-48 rounded-lg" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const active = providers.find((p) => p.id === activeProvider);

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] px-8 py-6">
      <PageHeader title="Settings" subtitle="Bring your own models. Keys are encrypted at rest; only the last 4 digits are ever shown." />

      {/* providers & keys — pick a provider, configure its key */}
      <h2 className="mb-1 text-[15px] font-semibold text-fg">Providers &amp; keys</h2>
      <p className="mb-3 text-[12.5px] text-muted">Pick a provider to set its key. The dot shows which providers are ready.</p>
      <Segmented value={activeProvider} onChange={setActiveProvider} options={provOpts(providers)} className="mb-3" />
      {active && <ProviderKey provider={active} loading={loading === active.id} onChanged={loadProviders} onFetch={() => loadModels(active.id)} />}
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-[12px] text-muted">
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-arc" />
        <span>
          Keys are shared by everyone who can open this hive (there's no login). Use a spend-limited key, remove it when you're done, or run a
          private copy.
        </span>
      </div>

      {/* roles */}
      <h2 className="mb-1 mt-9 text-[15px] font-semibold text-fg">Model roles</h2>
      <p className="mb-3 text-[12.5px] text-muted">Assign a model to each job. Reasoning effort adapts to the model you pick.</p>
      <div className="flex flex-col gap-2.5">
        {ROLES.map((role) => {
          const cur = settings.modelRoles[role.id];
          const provList = providers;
          const provider = cur?.provider ?? provList[0]?.id ?? "";
          const modelList = models[provider] ?? [];
          const selModel = modelList.find((m) => m.id === cur?.modelId);
          const supportsReasoning = selModel ? selModel.supportsReasoning !== false : true;
          const efforts = supportsReasoning ? EFFORTS : ["off"];
          return (
            <Card key={role.id} className="p-4">
              <div className="flex items-center gap-2.5">
                <role.Icon size={15} className="text-accent" />
                <span className="text-[14px] font-medium text-fg">{role.label}</span>
                <span className="text-[12px] text-faint">{role.hint}</span>
                {cur?.modelId && (
                  <span className="ml-auto font-mono text-[11px] text-muted">
                    {cur.provider}/{cur.modelId}
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-col gap-3">
                <Field label="Provider">
                  <Segmented
                    value={provider}
                    onChange={(id) => { loadModels(id); saveRole(role.id, { ...cur, provider: id, modelId: "" }); }}
                    options={provOpts(provList)}
                    size="sm"
                  />
                </Field>

                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Model">
                    <select
                      value={cur?.modelId ?? ""}
                      onFocus={() => !models[provider] && loadModels(provider)}
                      onChange={(e) => saveRole(role.id, { ...cur, provider, modelId: e.target.value, thinkingLevel: cur?.thinkingLevel })}
                      className="min-w-[220px] rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-fg outline-none focus:border-accent/50"
                    >
                      <option value="" disabled>
                        {modelList.length ? "Select a model…" : loading === provider ? "Loading…" : "Add a key to load models…"}
                      </option>
                      {modelList.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label ?? m.id}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Reasoning effort">
                    <Segmented
                      value={cur?.thinkingLevel ?? "off"}
                      onChange={(e) => saveRole(role.id, { ...cur, provider, thinkingLevel: e })}
                      options={efforts.map((e) => ({ value: e, label: e[0]!.toUpperCase() + e.slice(1) }))}
                      size="sm"
                    />
                  </Field>
                </div>
              </div>

              {selModel && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
                  {fmtCtx(selModel.contextLength) && (
                    <span>
                      Context <b className="text-fg">{fmtCtx(selModel.contextLength)}</b>
                    </span>
                  )}
                  <span>
                    Reasoning <b className="text-fg">{selModel.supportsReasoning === false ? "no" : "yes"}</b>
                  </span>
                  {selModel.supportsTools !== false && (
                    <span>
                      Tools <b className="text-fg">yes</b>
                    </span>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* proactive */}
      <h2 className="mb-1 mt-9 text-[15px] font-semibold text-fg">Proactive engine</h2>
      <p className="mb-3 text-[12.5px] text-muted">How eagerly the hive reaches out on its own.</p>
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-5">
          <Field label="Heartbeat (min)">
            <Input type="number" defaultValue={settings.proactive.heartbeatIntervalMin} onBlur={(e) => saveProactive({ heartbeatIntervalMin: Number(e.target.value) })} className="w-24" />
          </Field>
          <Field label="Cooldown (hrs)">
            <Input type="number" defaultValue={settings.proactive.cooldownHours} onBlur={(e) => saveProactive({ cooldownHours: Number(e.target.value) })} className="w-24" />
          </Field>
          <Field label="Min gap (hrs)">
            <Input type="number" defaultValue={settings.proactive.heartbeatMinGapHours} onBlur={(e) => saveProactive({ heartbeatMinGapHours: Number(e.target.value) })} className="w-24" />
          </Field>
          <Field label="Nudges">
            <Segmented
              value={settings.proactive.autoApprove ? "auto" : "review"}
              onChange={(v) => saveProactive({ autoApprove: v === "auto" })}
              options={[{ value: "auto", label: "Auto-send" }, { value: "review", label: "Review each" }]}
            />
          </Field>
        </div>
      </Card>
      <div className="h-10" />
    </div>
  );
}

// takt-style key entry: status box + password + Save + Remove, with base URL & fetch.
function ProviderKey({
  provider: p,
  loading,
  onChanged,
  onFetch,
}: {
  provider: ProviderRow;
  loading: boolean;
  onChanged: () => void;
  onFetch: () => void;
}) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const toast = useToast();

  async function save() {
    if (!key.trim()) return;
    try {
      await api(`/api/providers/${p.id}/key`, { method: "PUT", body: JSON.stringify({ key: key.trim() }) });
      setKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onChanged();
      toast(`${p.label} key saved`, "success");
    } catch {
      toast(`Couldn't save ${p.label} key`, "error");
    }
  }
  async function remove() {
    try {
      await api(`/api/providers/${p.id}/key`, { method: "DELETE" });
      onChanged();
      toast(`${p.label} key removed`);
    } catch {
      toast(`Couldn't remove ${p.label} key`, "error");
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2.5">
        <span className="text-[14px] font-medium text-fg">{p.label}</span>
        <span className="font-mono text-[11px] text-faint">{p.api}</span>
        <Button variant="subtle" onClick={onFetch} className="ml-auto">
          <RefreshCw size={13} className={cn(loading && "animate-spin")} /> Fetch models
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] text-muted">
          {p.hasKey ? (
            <>
              <Check size={14} className="text-share" /> Key set · ••••{p.keyLast4}
            </>
          ) : p.needsKey ? (
            "No key set"
          ) : (
            "Keyless — local provider"
          )}
        </div>
        {p.needsKey && (
          <>
            <Input
              type="password"
              placeholder={`Paste ${p.label} key`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              className="w-56 shrink-0"
            />
            <Button variant="primary" onClick={save} disabled={!key.trim()} className="shrink-0">
              {saved ? <Check size={14} /> : <KeyRound size={14} />} Save
            </Button>
            {p.hasKey && (
              <Button variant="ghost" onClick={remove} className="shrink-0">
                <Trash2 size={14} /> Remove
              </Button>
            )}
          </>
        )}
      </div>

      <div className="mt-2">
        <Input
          defaultValue={p.baseUrl}
          onBlur={(e) => api(`/api/providers/${p.id}/base-url`, { method: "PUT", body: JSON.stringify({ baseUrl: e.target.value }) })}
          className="max-w-sm font-mono text-[12px]"
        />
      </div>
    </Card>
  );
}
