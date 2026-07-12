import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Send, Hash, Globe, Check, X, Loader2, ChevronDown, ExternalLink } from "lucide-react";
import { api, ApiError, type BeeRow, type ChannelInfo } from "../api.js";
import { PageHeader, Card, Panel, Input, Button, Pill, StatusDot } from "../components/ui.js";
import { useToast } from "@hive/ui";
import { cn } from "../lib/cn.js";

type Health = Record<string, { configured: boolean; running: boolean; detail?: string }>;
type Field = { key: string; placeholder: string; type?: "text" | "password" };

// One-time operator setup. Channels run on the hive's PRIMARY bee; every member then
// connects to the same bots by sending their invite code (BEE-XXXX). Not per-member.
// Steps are kept concise-but-complete: everything needed, nothing more.
const CHANNELS: {
  id: string;
  label: string;
  Icon: typeof Send;
  note?: string;
  steps: string[];
  fields: Field[];
}[] = [
  {
    id: "telegram",
    label: "Telegram",
    Icon: Send,
    steps: [
      "In Telegram open @BotFather → send /newbot → pick a name, then a username ending in “bot”.",
      "Copy the token it gives you, paste it below, and press Connect.",
    ],
    fields: [{ key: "botToken", placeholder: "Bot token from @BotFather (123456:ABC-DEF…)", type: "password" }],
  },
  {
    id: "discord",
    label: "Discord",
    Icon: Hash,
    note: "Discord only lets a bot DM people who share a server with it — so members join one server and the bot DMs them to link. That's why you add a server invite below.",
    steps: [
      "discord.com/developers/applications → New Application → open Bot → turn on BOTH “Message Content Intent” and “Server Members Intent” → Reset Token → copy it.",
      "OAuth2 → URL Generator → tick scope “bot” → open that link → add the bot to a server (make a new one if you don't have it).",
      "In that server: Invite People → Edit invite link → set it to never expire → copy the discord.gg link.",
      "Paste the bot token and the server invite below → Connect.",
    ],
    fields: [
      { key: "botToken", placeholder: "Bot token (Reset Token in the dev portal)", type: "password" },
      { key: "serverInvite", placeholder: "Server invite link (discord.gg/…)", type: "text" },
    ],
  },
];

export function ChannelsPage() {
  const toast = useToast();
  const [bees, setBees] = useState<BeeRow[]>([]);
  const [health, setHealth] = useState<Health>({});
  const [chInfo, setChInfo] = useState<ChannelInfo>({});
  const [inputs, setInputs] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null); // auto-poll after connect
  const [openId, setOpenId] = useState<string | null>(null); // single-open accordion
  const [errors, setErrors] = useState<Record<string, { msg: string; field?: string }>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    await api<BeeRow[]>("/api/bees").then(setBees).catch(() => setBees([]));
    await api<ChannelInfo>("/api/channel-info").then(setChInfo).catch(() => {});
  };
  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // The canonical hive bee (server-designated: the oldest/first-registered bee) hosts the
  // shared channel bots. Deterministic — no guessing, no flipping between bees.
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

  // After a successful Connect the token is already validated, so we just wait for the
  // adapter to come up — a short automatic poll, no manual "check status" button.
  function awaitLive(channel: string) {
    if (!primary) return;
    setStarting(channel);
    let tries = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      tries++;
      const h = await api<Health>(`/bee-api/channels?bee=${primary.beeId}`).catch(() => ({}) as Health);
      setHealth(h);
      if (h[channel]?.running || tries >= 6) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setStarting(null);
      }
    }, 1500);
  }

  const field = (ch: string, key: string) => inputs[ch]?.[key] ?? "";
  const setField = (ch: string, key: string, val: string) =>
    setInputs((p) => ({ ...p, [ch]: { ...p[ch], [key]: val } }));
  const ready = (c: (typeof CHANNELS)[number]) => c.fields.every((f) => field(c.id, f.key).trim());

  // The address members use to reach a channel once it's live.
  const joinAddress = (id: string): string | null => {
    if (id === "telegram" && chInfo.telegram?.username) return `https://t.me/${chInfo.telegram.username}`;
    if (id === "discord" && chInfo.discord?.inviteUrl) return chInfo.discord.inviteUrl;
    return null;
  };

  async function connect(c: (typeof CHANNELS)[number]) {
    if (!primary) return;
    const config: Record<string, string> = {};
    for (const f of c.fields) config[f.key] = field(c.id, f.key).trim();
    setBusy(c.id);
    setErrors((e) => ({ ...e, [c.id]: { msg: "" } }));
    try {
      await api(`/api/bees/${primary.beeId}/channels/${c.id}`, { method: "PUT", body: JSON.stringify(config) });
      toast(`${c.label} connected`);
      setInputs((p) => ({ ...p, [c.id]: {} }));
      await load();
      awaitLive(c.id);
    } catch (e) {
      // server rejected the token/invite before saving anything — show it inline by field
      setErrors((p) => ({
        ...p,
        [c.id]: { msg: e instanceof ApiError ? e.message : `Couldn't connect ${c.label}.`, field: e instanceof ApiError ? e.field : undefined },
      }));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(c: (typeof CHANNELS)[number]) {
    if (!primary) return;
    setBusy(c.id);
    try {
      await api(`/api/bees/${primary.beeId}/channels/${c.id}`, { method: "DELETE" });
      toast(`${c.label} disconnected`);
      setErrors((e) => ({ ...e, [c.id]: { msg: "" } }));
      await load();
      await refreshHealth(primary.beeId);
    } catch (e) {
      toast(`Couldn't disconnect ${c.label}: ${(e as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  }

  // What a member does to reach this channel, shown once it's live.
  function MemberJoin({ id }: { id: string }) {
    const addr = joinAddress(id);
    if (id === "telegram") {
      return (
        <div className="rounded-lg bg-share/10 px-3.5 py-2.5 text-[13px] text-fg">
          <span className="font-medium">Members join by </span>opening the bot and sending their invite code.
          {addr && (
            <a href={addr} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 break-all font-mono text-[12px] text-accent hover:underline">
              {addr} <ExternalLink size={11} />
            </a>
          )}
        </div>
      );
    }
    // discord
    return (
      <div className="rounded-lg bg-share/10 px-3.5 py-2.5 text-[13px] text-fg">
        <span className="font-medium">Members join </span>your server and the bot DMs them automatically — they just reply with their invite code (no need to find the bot).
        {addr && (
          <a href={addr} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 break-all font-mono text-[12px] text-accent hover:underline">
            {addr} <ExternalLink size={11} />
          </a>
        )}
      </div>
    );
  }

  return (
    <Panel width="prose">
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

          <div className="flex flex-col gap-2">
            {/* Web chat — always on, nothing to set up. */}
            <Card className="flex items-center gap-2.5 px-4 py-3">
              <Globe size={16} className="text-muted" />
              <span className="text-[14px] font-semibold text-fg">Web chat</span>
              <Pill tone="share">always on</Pill>
              <span className="ml-auto hidden text-[12px] text-faint sm:inline">Members open the web chat and paste their invite code.</span>
            </Card>

            {CHANNELS.map((c) => {
              const h = health[c.id];
              const running = !!h?.running;
              const configured = h?.configured ?? primary.channels.includes(c.id);
              const open = openId === c.id;
              const err = errors[c.id]?.msg;
              const status = running ? "connected" : configured ? "needs attention" : "not set up";
              const tone = running ? "share" : configured ? "partial" : "muted";
              return (
                <Card key={c.id} className="overflow-hidden">
                  <button
                    onClick={() => setOpenId(open ? null : c.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-fg/[0.02]"
                  >
                    <c.Icon size={17} className="text-accent" />
                    <span className="text-[14px] font-semibold text-fg">{c.label}</span>
                    <Pill tone={tone as "share" | "partial" | "muted"}>{status}</Pill>
                    <span className="ml-auto flex items-center gap-1.5 text-[12px] font-medium text-muted">
                      {configured ? "Manage" : "Set up"}
                      <ChevronDown size={15} className={cn("transition-transform", open && "rotate-180")} />
                    </span>
                  </button>

                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-col gap-3 border-t border-border px-4 py-3.5">
                          {running ? (
                            <MemberJoin id={c.id} />
                          ) : (
                            <>
                              {starting === c.id ? (
                                <p className="flex items-center gap-2 text-[12.5px] text-partial">
                                  <Loader2 size={14} className="animate-spin" /> Starting the bot…
                                </p>
                              ) : configured ? (
                                <p className="text-[12.5px] text-partial">Saved, but the bot isn't live. Re-enter the details below to reconnect, or disconnect it.</p>
                              ) : null}

                              {c.note && (
                                <p className="rounded-lg bg-accent-soft/40 px-3 py-2 text-[12px] leading-relaxed text-muted">{c.note}</p>
                              )}
                              <ol className="flex flex-col gap-1.5">
                                {c.steps.map((s, si) => (
                                  <li key={si} className="flex gap-2.5 text-[12.5px] leading-relaxed text-muted">
                                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">{si + 1}</span>
                                    <span>{s}</span>
                                  </li>
                                ))}
                              </ol>

                              <div className="flex flex-col gap-2">
                                {c.fields.map((f) => (
                                  <Input
                                    key={f.key}
                                    type={f.type ?? "text"}
                                    placeholder={f.placeholder}
                                    className={errors[c.id]?.field === f.key ? "border-withhold/60 focus:border-withhold" : undefined}
                                    value={field(c.id, f.key)}
                                    onChange={(e) => { setField(c.id, f.key, e.target.value); if (err) setErrors((x) => ({ ...x, [c.id]: { msg: "" } })); }}
                                    onKeyDown={(e) => { if (e.key === "Enter" && ready(c)) connect(c); }}
                                  />
                                ))}
                              </div>

                              {err && <p className="text-[12px] text-withhold">{err}</p>}

                              <div className="flex items-center gap-2">
                                <Button variant="primary" disabled={busy === c.id || !ready(c)} onClick={() => connect(c)}>
                                  {busy === c.id ? <><Loader2 size={14} className="animate-spin" /> connecting…</> : <><Check size={14} /> {configured ? "Reconnect" : "Connect"}</>}
                                </Button>
                              </div>
                            </>
                          )}

                          {configured && (
                            <div className="border-t border-border pt-3">
                              <Button variant="subtle" disabled={busy === c.id} onClick={() => disconnect(c)}>
                                <X size={13} /> Disconnect
                              </Button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}
