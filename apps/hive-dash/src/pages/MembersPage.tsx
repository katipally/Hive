import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { UserPlus, Copy, Check, MessageSquare, Send, Hash, Smartphone, Settings2, Trash2 } from "lucide-react";
import { api, type MemberRow, type ChannelInfo } from "../api.js";
import { useDashSocket } from "../useDashSocket.js";
import { Button, Card, Input, PageHeader, EmptyState, Field, Avatar, StatusDot } from "../components/ui.js";
import { Dialog, ConfirmDialog, Segmented, useToast } from "@hive/ui";
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
  const [deleteFor, setDeleteFor] = useState<MemberRow | null>(null);
  const [chInfo, setChInfo] = useState<ChannelInfo>({});
  const toast = useToast();

  async function delMember() {
    if (!deleteFor) return;
    try {
      await api(`/api/members/${deleteFor.id}`, { method: "DELETE" });
      toast(`Removed ${deleteFor.name}`);
      setDeleteFor(null);
      load();
    } catch {
      toast("Couldn't remove member", "error");
    }
  }

  // Cold-start resilient: a just-woken free-tier server can answer an early fetch
  // before the members are ready. If we get an empty list (or an error), retry a
  // few times so navigating to this tab right after wake doesn't look empty/broken.
  const coldRetries = useRef(0);
  const load = useCallback((): Promise<void> => api<MemberRow[]>("/api/members").then((m) => {
    setMembers(m);
    if (m.length === 0 && coldRetries.current < 6) { coldRetries.current++; setTimeout(load, 1500); }
    else coldRetries.current = 0;
  }).catch(() => {
    if (coldRetries.current < 6) { coldRetries.current++; setTimeout(load, 1500); }
    else toast("Couldn't load members", "error");
  }), [toast]);
  useEffect(() => void load(), [load]);
  useEffect(() => { api<ChannelInfo>("/api/channel-info").then(setChInfo).catch(() => {}); }, []);

  // The zero-friction handoff: a ready message the operator sends to a friend.
  function inviteText(code: string): string {
    const ways: string[] = [];
    if (chInfo.telegram?.username) ways.push(`• Telegram: https://t.me/${chInfo.telegram.username}`);
    if (chInfo.imessage?.handle) ways.push(`• iMessage: text ${chInfo.imessage.handle}`);
    if (chInfo.discord?.inviteUrl) ways.push(`• Discord: ${chInfo.discord.inviteUrl} — then DM the bot`);
    ways.push("• Web chat: open the app and paste your code");
    return `Join our hive! Message us on any of these and send your code:\n\n  ${code}\n\n${ways.join("\n")}`;
  }
  function copyInvite(code: string) {
    navigator.clipboard?.writeText(inviteText(code));
    setCopied("inv:" + code);
    toast("Invite copied — send it to them");
    setTimeout(() => setCopied(null), 1500);
  }
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
                    <Avatar name={m.name} size={36} className="text-[14px]" />
                    <div>
                      <div className="text-[15px] font-semibold text-fg">{m.name}</div>
                      <div className="text-[11px] text-faint">{m.timezone}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => copy(m.code)}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] text-accent transition hover:border-accent/40"
                      title="Copy just the code"
                    >
                      {copied === m.code ? <Check size={13} /> : <Copy size={13} />}
                      {m.code}
                    </button>
                    <button
                      onClick={() => copyInvite(m.code)}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition hover:border-border-heavy hover:text-fg"
                      title="Copy a ready-to-send invite (links + code)"
                    >
                      {copied === "inv:" + m.code ? <Check size={13} /> : <Send size={13} />}
                      Invite
                    </button>
                    <button
                      onClick={() => setConfigFor(m)}
                      className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:border-border-heavy hover:text-fg"
                      title="Bee settings"
                      aria-label={`Settings for ${m.name}'s bee`}
                    >
                      <Settings2 size={15} />
                    </button>
                    <button
                      onClick={() => setDeleteFor(m)}
                      className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:border-withhold/40 hover:text-withhold"
                      title="Remove member"
                      aria-label={`Remove ${m.name}`}
                    >
                      <Trash2 size={15} />
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
                          <StatusDot online={ci.beeOnline} className="size-1.5" />
                          {ci.beeOnline ? "online" : "offline"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <BeeConfigDialog member={configFor} onClose={() => setConfigFor(null)} onSaved={load} />
      <ConfirmDialog
        open={!!deleteFor}
        onClose={() => setDeleteFor(null)}
        onConfirm={delMember}
        title={deleteFor ? `Remove ${deleteFor.name}?` : ""}
        description="Permanently deletes their memories, connections, polls, and everything the hive knows about them. This can't be undone."
        confirmLabel="Remove member"
      />
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

