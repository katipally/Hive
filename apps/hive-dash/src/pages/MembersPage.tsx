import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { UserPlus, Copy, Check, MessageSquare, Send, Hash, Smartphone, Settings2 } from "lucide-react";
import { api, type MemberRow } from "../api.js";
import { useDashSocket } from "../useDashSocket.js";
import { Button, Card, Input, PageHeader, EmptyState, Field } from "../components/ui.js";
import { Dialog, Segmented, useToast } from "@hive/ui";
import { stagger } from "../lib/motion.js";
import { cn } from "../lib/cn.js";

interface BeeSettings {
  persona: string;
  proactivity: "off" | "low" | "normal" | "high";
}

const CHANNEL_ICON: Record<string, typeof MessageSquare> = {
  web: MessageSquare,
  telegram: Send,
  discord: Hash,
  imessage: Smartphone,
};

export function MembersPage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [configFor, setConfigFor] = useState<MemberRow | null>(null);
  const toast = useToast();

  const load = () => api<MemberRow[]>("/api/members").then(setMembers).catch(() => toast("Couldn't load members", "error"));
  useEffect(() => void load(), []);
  useDashSocket((e) => {
    if (e.type === "member.updated" || e.type === "bee.presence") load();
  });

  async function addMember() {
    if (!name.trim()) return;
    try {
      await api("/api/members", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setName("");
      load();
      toast("Member added");
    } catch {
      toast("Couldn't add member", "error");
    }
  }
  function copy(code: string) {
    navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="h-full overflow-y-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] px-8 py-6">
      <PageHeader title="Members" subtitle="Everyone in this hive. Share an invite code to link a member's bee." />

      <Card className="mb-5 p-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="New member name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMember()}
          />
          <Button variant="primary" onClick={addMember} className="shrink-0">
            <UserPlus size={15} /> Add member
          </Button>
        </div>
      </Card>

      {members.length === 0 ? (
        <EmptyState icon={<UserPlus size={22} />} title="No members yet" hint="Add someone above to start building the hive." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {members.map((m, i) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={stagger(i)}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="grid size-9 place-items-center rounded-full text-[14px] font-semibold text-bg"
                      style={{ background: "linear-gradient(135deg, #5b9dff, #e2701f)" }}
                    >
                      {m.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-[15px] font-semibold text-fg">{m.name}</div>
                      <div className="text-[11px] text-faint">{m.timezone}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => copy(m.code)}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] text-honey transition hover:border-honey/40"
                      title="Copy invite code"
                    >
                      {copied === m.code ? <Check size={13} /> : <Copy size={13} />}
                      {m.code}
                    </button>
                    <button
                      onClick={() => setConfigFor(m)}
                      className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:border-border-heavy hover:text-fg"
                      title="Bee settings"
                      aria-label={`Settings for ${m.name}'s bee`}
                    >
                      <Settings2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="mt-3.5 flex flex-col gap-1.5">
                  {m.identities.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-faint">
                      Not linked yet — share the code to connect a channel.
                    </div>
                  )}
                  {m.identities.map((ci) => {
                    const Icon = CHANNEL_ICON[ci.channel] ?? MessageSquare;
                    return (
                      <div
                        key={ci.id}
                        className="flex items-center gap-2.5 rounded-lg bg-fg/[0.03] px-3 py-2 text-[13px]"
                      >
                        <Icon size={14} className="text-muted" />
                        <span className="capitalize text-fg">{ci.channel}</span>
                        <span className="truncate font-mono text-[11px] text-faint">{ci.externalId}</span>
                        <span
                          className={cn(
                            "ml-auto flex items-center gap-1.5 text-[11px]",
                            ci.beeOnline ? "text-share" : "text-faint",
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              ci.beeOnline ? "bg-share shadow-[0_0_6px_var(--color-share)]" : "bg-faint",
                            )}
                          />
                          {ci.beeOnline ? "online" : "offline"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <ChannelConnect member={m} />
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <BeeConfigDialog member={configFor} onClose={() => setConfigFor(null)} onSaved={load} />
    </div>
  );
}

const PROACTIVITY = [
  { v: "off", l: "Off" },
  { v: "low", l: "Low" },
  { v: "normal", l: "Normal" },
  { v: "high", l: "High" },
] as const;

// Per-bee persona / behaviour: tone, proactivity, quiet hours, timezone.
function BeeConfigDialog({ member, onClose, onSaved }: { member: MemberRow | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [persona, setPersona] = useState("");
  const [proactivity, setProactivity] = useState<BeeSettings["proactivity"]>("normal");
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [timezone, setTimezone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!member) return;
    setQuietStart(member.quietHoursStart ?? "");
    setQuietEnd(member.quietHoursEnd ?? "");
    setTimezone(member.timezone);
    api<BeeSettings>(`/api/members/${member.id}/bee-settings`)
      .then((s) => { setPersona(s.persona); setProactivity(s.proactivity); })
      .catch(() => {});
  }, [member]);

  async function save() {
    if (!member) return;
    setSaving(true);
    try {
      await Promise.all([
        api(`/api/members/${member.id}/bee-settings`, { method: "PUT", body: JSON.stringify({ persona, proactivity }) }),
        api(`/api/members/${member.id}`, {
          method: "PATCH",
          body: JSON.stringify({ timezone, quietHoursStart: quietStart || null, quietHoursEnd: quietEnd || null }),
        }),
      ]);
      toast("Bee settings saved");
      onSaved();
      onClose();
    } catch {
      toast("Couldn't save settings", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!member} onClose={onClose} title={member ? `${member.name}'s bee` : ""} description="Shape how this member's bee behaves." className="max-w-lg">
      <div className="flex flex-col gap-4">
        <Field label="Persona & tone">
          <textarea
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            rows={3}
            placeholder="e.g. Playful and a little sarcastic. Keep it brief. Never nag."
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent/50"
          />
        </Field>

        <Field label="Proactivity">
          <Segmented
            value={proactivity}
            onChange={setProactivity}
            options={PROACTIVITY.map((o) => ({ value: o.v, label: o.l }))}
          />
        </Field>

        <div className="flex flex-wrap gap-4">
          <Field label="Quiet hours from">
            <Input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} className="w-32" />
          </Field>
          <Field label="Quiet hours to">
            <Input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} className="w-32" />
          </Field>
          <Field label="Timezone">
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" className="w-40" />
          </Field>
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

const CONNECTABLE = [
  { id: "telegram", label: "Telegram", Icon: Send, field: "botToken", hint: "Bot token from @BotFather" },
  { id: "discord", label: "Discord", Icon: Hash, field: "botToken", hint: "Bot token (enable Message Content intent)" },
] as const;

function ChannelConnect({ member }: { member: MemberRow }) {
  const [open, setOpen] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const beeId = member.identities.find((i) => i.beeId)?.beeId ?? null;
  const connected = new Set(member.identities.map((i) => i.channel));

  async function connect(channel: string, field: string) {
    if (!beeId || !token.trim()) return;
    setStatus("connecting…");
    try {
      const r = await api<{ pushed: boolean }>(`/api/bees/${beeId}/channels/${channel}`, {
        method: "PUT",
        body: JSON.stringify({ [field]: token.trim() }),
      });
      setStatus(r.pushed ? `${channel} started — DM the bot your code to link it` : "saved (bee offline, will start when it reconnects)");
      setToken("");
      setOpen(null);
    } catch (e) {
      setStatus(`failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {!beeId ? (
        <p className="text-[11px] text-faint">Pair on web chat first, then you can connect Telegram or Discord here.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-faint">Add a channel:</span>
          {CONNECTABLE.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setOpen(open === c.id ? null : c.id);
                setToken("");
                setStatus(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] transition",
                connected.has(c.id)
                  ? "border-share/30 text-share"
                  : open === c.id
                    ? "border-honey/40 text-honey"
                    : "border-border text-muted hover:border-border-heavy hover:text-fg",
              )}
            >
              <c.Icon size={13} />
              {c.label}
              {connected.has(c.id) && <Check size={12} />}
            </button>
          ))}
          {status && <span className="text-[11px] text-muted">{status}</span>}
        </div>
      )}
      {open && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="password"
            placeholder={CONNECTABLE.find((c) => c.id === open)!.hint}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect(open, CONNECTABLE.find((c) => c.id === open)!.field)}
            className="max-w-sm"
          />
          <Button variant="primary" onClick={() => connect(open, CONNECTABLE.find((c) => c.id === open)!.field)} disabled={!token.trim()}>
            Connect
          </Button>
        </div>
      )}
    </div>
  );
}
