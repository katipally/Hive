import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Send, Hash, Globe, Check, X, Loader2 } from "lucide-react";
import { api, type BeeRow, type ChannelInfo } from "../api.js";
import { PageHeader, Card, Input, Button, Pill, StatusDot } from "../components/ui.js";
import { useToast } from "@hive/ui";
import { stagger } from "../lib/motion.js";

type Health = Record<string, { configured: boolean; running: boolean; detail?: string }>;

// One-time operator setup. Channels run on the hive's PRIMARY bee; every member
// then connects to the same bots by sending their invite code. Not per-member.
const CHANNELS = [
  {
    id: "telegram",
    label: "Telegram",
    Icon: Send,
    kind: "token" as const,
    hint: "Bot token from @BotFather (looks like 123456:ABC-DEF…)",
    connect: "Members open this Telegram bot and send their invite code (BEE-XXXX).",
    steps: [
      "In Telegram, search @BotFather (blue check) and tap Start.",
      "Send /newbot → pick a name → pick a username ending in “bot”.",
      "Copy the token BotFather gives you (123456:ABC-DEF…).",
      "Paste it below and press Connect.",
    ],
  },
  {
    id: "discord",
    label: "Discord",
    Icon: Hash,
    kind: "token" as const,
    hint: "Bot token — Message Content Intent must be ON",
    connect: "Invite each member to your private server, then they DM the bot their invite code (BEE-XXXX).",
    note: "Discord only lets a bot DM someone who shares a server with it — so you make one private server, invite the bot AND your members to it, and the actual chatting still happens in DMs.",
    steps: [
      "Open discord.com/developers/applications → New Application → name it → Create.",
      "Left menu → Bot → turn ON “Message Content Intent” (Privileged Gateway Intents) → Save.",
      "Reset Token → Copy it.",
      "In Discord, click the + in your server list → “Create My Own” → make a private server (this is required — a bot can only DM people who share a server with it).",
      "Back in the dev portal: OAuth2 → URL Generator → tick scope “bot” → open the link → add the bot to that private server.",
      "Invite the people who’ll use it to that same server.",
      "Paste the token below and press Connect. Members then DM the bot “BEE-XXXX”.",
    ],
  },
] as const;

export function ChannelsPage() {
  const toast = useToast();
  const [bees, setBees] = useState<BeeRow[]>([]);
  const [health, setHealth] = useState<Health>({});
  const [chInfo, setChInfo] = useState<ChannelInfo>({});
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    await api<BeeRow[]>("/api/bees").then(setBees).catch(() => setBees([]));
    await api<ChannelInfo>("/api/channel-info").then(setChInfo).catch(() => {});
  };
  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // The address members use to reach this channel (shown once it's live).
  const joinAddress = (id: string): string | null => {
    if (id === "telegram" && chInfo.telegram?.username) return `https://t.me/${chInfo.telegram.username}`;
    if (id === "discord" && chInfo.discord?.inviteUrl) return chInfo.discord.inviteUrl;
    return null;
  };

  // The canonical hive bee (server-designated: the oldest/first-registered bee) hosts
  // the shared channel bots. Deterministic — no guessing, no flipping between bees.
  const primary = bees.find((b) => b.primary) ?? bees[0] ?? null;

  const refreshHealth = useCallback(async (beeId?: string) => {
    if (!beeId) return;
    try {
      setHealth(await api<Health>(`/bee-api/channels?bee=${beeId}`));
    } catch {
      setHealth({});
    }
  }, []);
  useEffect(() => { refreshHealth(primary?.beeId); }, [primary?.beeId, refreshHealth]);

  // Poll health so status reflects the adapter actually coming up (or failing).
  function verify(channel: string) {
    if (!primary) return;
    setVerifying(channel);
    let tries = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      tries++;
      const h = await api<Health>(`/bee-api/channels?bee=${primary.beeId}`).catch(() => ({}) as Health);
      setHealth(h);
      if (h[channel]?.running || tries >= 6) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setVerifying(null);
        if (!h[channel]?.running) toast("Not connected yet — check the token / Message Content intent, then Verify again", "error");
      }
    }, 1500);
  }

  async function connect(channel: string, config: Record<string, unknown>, label: string) {
    if (!primary) return;
    setBusy(channel);
    try {
      await api(`/api/bees/${primary.beeId}/channels/${channel}`, { method: "PUT", body: JSON.stringify(config) });
      toast(`${label} saved — verifying…`);
      setTokens((t) => ({ ...t, [channel]: "" }));
      await load();
      verify(channel);
    } catch (e) {
      toast(`Couldn't connect ${label}: ${(e as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(channel: string, label: string) {
    if (!primary) return;
    setBusy(channel);
    try {
      await api(`/api/bees/${primary.beeId}/channels/${channel}`, { method: "DELETE" });
      toast(`${label} disconnected`);
      await load();
      await refreshHealth(primary.beeId);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] px-8 py-6">
      <PageHeader
        title="Channels"
        subtitle="One-time setup. Connect the shared bots once — then every member joins by sending their invite code."
      />

      {!primary ? (
        <Card className="p-5 text-[13px] text-muted">
          No bee is running yet. Start the stack with <span className="font-mono text-fg">pnpm dev</span>, then refresh.
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2 text-[12px] text-muted">
            <StatusDot online={primary.online} />
            Channels run on your hive bee
            <span className="font-mono text-faint">{primary.beeId.slice(0, 14)}…</span>
            {!primary.online && <span className="text-withhold">· offline — start it to go live</span>}
            {bees.length > 1 && <span className="text-faint">· {bees.length} bees total</span>}
          </div>

          <div className="mb-3 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
            <Globe size={16} className="text-muted" />
            <span className="text-[13px] font-medium text-fg">Web chat</span>
            <Pill tone="share">always on</Pill>
            <span className="ml-auto text-[12px] text-faint">Open the web chat and paste an invite code.</span>
          </div>

          <div className="flex flex-col gap-3">
            {CHANNELS.map((ch, i) => {
              const h = health[ch.id];
              const running = !!h?.running;
              const configured = h?.configured ?? primary.channels.includes(ch.id);
              return (
                <motion.div key={ch.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={stagger(i)}>
                  <Card className="p-4">
                    <div className="flex items-center gap-2.5">
                      <ch.Icon size={17} className="text-accent" />
                      <span className="text-[15px] font-semibold text-fg">{ch.label}</span>
                      {running ? (
                        <Pill tone="share">connected</Pill>
                      ) : configured ? (
                        <Pill tone="partial">saved · not live</Pill>
                      ) : (
                        <Pill tone="muted">not set up</Pill>
                      )}
                      {configured && (
                        <Button variant="subtle" className="ml-auto" disabled={busy === ch.id} onClick={() => disconnect(ch.id, ch.label)}>
                          <X size={13} /> Disconnect
                        </Button>
                      )}
                    </div>

                    {running ? (
                      <div className="mt-2.5 rounded-lg bg-share/10 px-3.5 py-2.5 text-[13px] text-fg">
                        <span className="font-medium">How members join: </span>
                        {ch.connect}
                        {joinAddress(ch.id) && <div className="mt-1 break-all font-mono text-[12px] text-accent">{joinAddress(ch.id)}</div>}
                      </div>
                    ) : (
                      <>
                        {"note" in ch && ch.note && (
                          <p className="mt-2.5 rounded-lg bg-accent-soft/40 px-3 py-2 text-[12px] leading-relaxed text-muted">{ch.note}</p>
                        )}
                        <ol className="mt-2.5 flex flex-col gap-1.5">
                          {ch.steps.map((s, si) => (
                            <li key={si} className="flex gap-2.5 text-[12.5px] leading-relaxed text-muted">
                              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">{si + 1}</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ol>
                        <div className="mt-3 flex items-center gap-2">
                          {ch.kind === "token" ? (
                            <>
                              <Input
                                type="password"
                                placeholder={ch.hint}
                                value={tokens[ch.id] ?? ""}
                                onChange={(e) => setTokens((t) => ({ ...t, [ch.id]: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === "Enter" && tokens[ch.id]?.trim()) connect(ch.id, { botToken: tokens[ch.id]!.trim() }, ch.label); }}
                              />
                              <Button variant="primary" disabled={busy === ch.id || verifying === ch.id || !tokens[ch.id]?.trim()} onClick={() => connect(ch.id, { botToken: tokens[ch.id]!.trim() }, ch.label)}>
                                {verifying === ch.id ? <><Loader2 size={14} className="animate-spin" /> verifying…</> : <><Check size={14} /> Connect</>}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Input
                                placeholder="Your Mac's iMessage number or Apple ID email"
                                value={tokens[ch.id] ?? ""}
                                onChange={(e) => setTokens((t) => ({ ...t, [ch.id]: e.target.value }))}
                              />
                              <Button variant="primary" disabled={busy === ch.id || verifying === ch.id} onClick={() => connect(ch.id, { enabled: true, handle: tokens[ch.id]?.trim() }, ch.label)}>
                                {verifying === ch.id ? <><Loader2 size={14} className="animate-spin" /> verifying…</> : <><Check size={14} /> {configured ? "Re-enable" : "Enable"}</>}
                              </Button>
                            </>
                          )}
                          {configured && !verifying && (
                            <Button variant="ghost" onClick={() => verify(ch.id)}><Check size={14} /> Verify</Button>
                          )}
                        </div>
                        {configured && <p className="mt-2 text-[12px] text-partial">Saved, but the bot isn't live yet — {ch.id === "discord" ? "check the token and that Message Content Intent is ON" : "check the token"}, then Verify.</p>}
                        {h?.detail && <p className="mt-1 text-[12px] text-withhold">{h.detail}</p>}
                      </>
                    )}
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
