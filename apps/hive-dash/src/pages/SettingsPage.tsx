import { useEffect, useState } from "react";
import { KeyRound, Check, Trash2, RefreshCw, ShieldAlert, MessageSquare, Search, Sparkles, Zap } from "lucide-react";
import { api, type ProviderRow, type ModelRow, type SettingsData } from "../api.js";
import { PageHeader, Card, Input, Button, Pill, Field } from "../components/ui.js";
import { cn } from "../lib/cn.js";

const ROLES = [
  { id: "chat", label: "Chat", hint: "Powers bee replies", Icon: MessageSquare },
  { id: "extraction", label: "Extraction", hint: "Turns talk into the graph", Icon: Search },
  { id: "social", label: "Social reasoning", hint: "Disclosure, proactive & conclusions", Icon: Sparkles },
  { id: "embeddings", label: "Embeddings", hint: "Retrieval & dedup", Icon: Zap },
] as const;

const EFFORTS = ["off", "low", "medium", "high"];
const fmtCtx = (n?: number) => (n ? (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`) : null);

export function SettingsPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [models, setModels] = useState<Record<string, ModelRow[]>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const loadProviders = () => api<ProviderRow[]>("/api/providers").then(setProviders);
  const loadSettings = () => api<SettingsData>("/api/settings").then(setSettings);
  useEffect(() => {
    loadProviders();
    loadSettings();
  }, []);

  async function loadModels(provider: string) {
    setLoading(provider);
    try {
      const r = await api<{ models: ModelRow[] }>(`/api/models?provider=${provider}`);
      setModels((m) => ({ ...m, [provider]: r.models }));
    } catch {
      setModels((m) => ({ ...m, [provider]: [] }));
    } finally {
      setLoading(null);
    }
  }
  async function saveRole(role: string, cfg: Record<string, unknown>) {
    await api(`/api/settings/roles/${role}`, { method: "PUT", body: JSON.stringify(cfg) });
    loadSettings();
  }
  async function saveProactive(patch: Record<string, unknown>) {
    await api("/api/settings/proactive", { method: "PUT", body: JSON.stringify(patch) });
    loadSettings();
  }

  if (!settings) return <div className="px-8 py-6 text-[13px] text-muted">Loading…</div>;

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-8 py-6">
      <PageHeader title="Settings" subtitle="Bring your own models. Keys are encrypted at rest; only the last 4 digits are ever shown." />

      {/* providers & keys */}
      <h2 className="mb-1 text-[15px] font-semibold text-fg">Providers &amp; keys</h2>
      <p className="mb-3 text-[12.5px] text-muted">Pick any provider — the model list is fetched live from it.</p>
      <div className="flex flex-col gap-2.5">
        {providers.map((p) => (
          <ProviderKey key={p.id} provider={p} loading={loading === p.id} onChanged={loadProviders} onFetch={() => loadModels(p.id)} />
        ))}
      </div>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-[12px] text-muted">
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-ember" />
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
          const provOptions = role.id === "embeddings" ? providers.filter((p) => p.supportsEmbeddings) : providers;
          const provider = cur?.provider ?? provOptions[0]?.id ?? "";
          const modelList = models[provider] ?? [];
          const selModel = modelList.find((m) => m.id === cur?.modelId);
          const supportsReasoning = selModel ? selModel.supportsReasoning !== false : true;
          const efforts = supportsReasoning ? EFFORTS : ["off"];
          return (
            <Card key={role.id} className="p-4">
              <div className="flex items-center gap-2.5">
                <role.Icon size={15} className="text-honey" />
                <span className="text-[14px] font-medium text-fg">{role.label}</span>
                <span className="text-[12px] text-faint">{role.hint}</span>
                {cur?.modelId && (
                  <span className="ml-auto font-mono text-[11px] text-muted">
                    {cur.provider}/{cur.modelId}
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Field label="Provider">
                  <select
                    value={provider}
                    onChange={(e) => {
                      loadModels(e.target.value);
                      saveRole(role.id, { ...cur, provider: e.target.value, modelId: "" });
                    }}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-fg outline-none focus:border-honey/50"
                  >
                    {provOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Model">
                  <select
                    value={cur?.modelId ?? ""}
                    onFocus={() => !models[provider] && loadModels(provider)}
                    onChange={(e) => saveRole(role.id, { ...cur, provider, modelId: e.target.value, thinkingLevel: cur?.thinkingLevel })}
                    className="min-w-[190px] rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-fg outline-none focus:border-honey/50"
                  >
                    <option value="" disabled>
                      {modelList.length ? "Select a model…" : "Add a key to load models…"}
                    </option>
                    {modelList.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label ?? m.id}
                      </option>
                    ))}
                  </select>
                </Field>

                {role.id !== "embeddings" ? (
                  <Field label="Reasoning effort">
                    <div className="inline-flex rounded-lg border border-border bg-surface p-1">
                      {efforts.map((e) => {
                        const on = (cur?.thinkingLevel ?? "off") === e;
                        return (
                          <button
                            key={e}
                            onClick={() => saveRole(role.id, { ...cur, provider, thinkingLevel: e })}
                            className={cn(
                              "rounded-md px-3 py-1.5 text-[12px] font-medium capitalize transition",
                              on ? "bg-honey text-bg shadow-sm" : "text-muted hover:text-fg",
                            )}
                          >
                            {e}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                ) : (
                  <Field label="Dimensions">
                    <Input type="number" defaultValue={cur?.dim ?? 768} onBlur={(e) => saveRole(role.id, { ...cur, provider, dim: Number(e.target.value) })} className="w-24" />
                  </Field>
                )}
              </div>

              {selModel && (
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
                  {fmtCtx(selModel.contextLength) && (
                    <span>
                      Context <b className="text-fg">{fmtCtx(selModel.contextLength)}</b>
                    </span>
                  )}
                  <span>
                    Reasoning <b className="text-fg">{selModel.supportsReasoning === false ? "no" : "yes"}</b>
                  </span>
                  {selModel.supportsTools !== false && role.id !== "embeddings" && (
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
            <div className="inline-flex rounded-lg border border-border bg-surface p-1">
              {[
                { v: true, l: "Auto-send" },
                { v: false, l: "Review each" },
              ].map((o) => {
                const on = settings.proactive.autoApprove === o.v;
                return (
                  <button
                    key={o.l}
                    onClick={() => saveProactive({ autoApprove: o.v })}
                    className={cn("rounded-md px-3 py-1.5 text-[12px] font-medium transition", on ? "bg-honey text-bg shadow-sm" : "text-muted hover:text-fg")}
                  >
                    {o.l}
                  </button>
                );
              })}
            </div>
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

  async function save() {
    if (!key.trim()) return;
    await api(`/api/providers/${p.id}/key`, { method: "PUT", body: JSON.stringify({ key: key.trim() }) });
    setKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onChanged();
  }
  async function remove() {
    await api(`/api/providers/${p.id}/key`, { method: "DELETE" });
    onChanged();
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
