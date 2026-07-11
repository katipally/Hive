import { id, CONSTITUTION, CONSTITUTION_BRIEF } from "@hive/shared";
import type { ChannelKind, ContextBlock } from "@hive/shared";
import { runAgentLoop } from "@hive/shared/agent";
import { saveConfig, type BeeConfig, type BeeInstanceConfig } from "./config.js";
import { HiveLink } from "./hive-link.js";
import { chatViaHive, hiveStreamFn } from "./llm-via-hive.js";
import { makeBeeTools } from "./agent-tools.js";
import { appendSession, appendDisplay, loadHistoryCompacted } from "./sessions.js";
import { detectCode, pairingPrompt } from "./pairing.js";
import type { ChannelAdapter, InboundMessage, ReplySink } from "./channels/types.js";
import { TelegramChannel } from "./channels/telegram.js";
import { DiscordChannel } from "./channels/discord.js";
import { IMessageChannel } from "./channels/imessage/watcher.js";

interface Linked {
  memberId: string;
  memberName: string;
  channelIdentityId: string;
}

// A non-web channel (Telegram/Discord/iMessage) must run on exactly ONE bee, or
// two adapters double-process the same inbox (e.g. two bees both reading chat.db).
// First bee to claim a channel owns it; others skip. Web is per-bee (fine).
const claimedChannels = new Map<ChannelKind, string>();

export class Bee {
  readonly link: HiveLink;
  private adapters = new Map<ChannelKind, ChannelAdapter>();
  private cache = new Map<string, Linked>(); // key: `${channel}:${externalId}`
  private lastPrompt = new Map<string, number>(); // rate-limit pairing prompts
  private personaCache = new Map<string, { v: string; at: number }>(); // memberId -> persona, short TTL

  constructor(
    readonly instance: BeeInstanceConfig,
    private readonly cfg: BeeConfig,
  ) {
    this.link = new HiveLink(instance, cfg.hiveWsUrl, {
      onNudge: (n) => this.deliverNudge(n.nudgeId, n.channel, n.externalId, n.text),
      onChannelConfig: (channel, config) => this.applyChannelConfig(channel, config),
      onIdentityRevoked: (ciId) => {
        for (const [k, v] of this.cache) if (v.channelIdentityId === ciId) this.cache.delete(k);
      },
    });
  }

  start(): void {
    this.link.start();
    // start any channel adapters already configured with credentials
    const ch = this.instance.channels;
    if (ch.telegram?.botToken) this.registerAdapter(new TelegramChannel(ch.telegram.botToken));
    if (ch.discord?.botToken) this.registerAdapter(new DiscordChannel(ch.discord.botToken));
    if (ch.imessage?.enabled) this.registerAdapter(this.makeIMessage());
    // web adapter is registered by the runtime
  }

  private makeIMessage(): IMessageChannel {
    return new IMessageChannel(
      this.instance.imessageCursor ?? 0,
      (rowid) => {
        this.instance.imessageCursor = rowid;
        const idx = this.cfg.instances.findIndex((i) => i.beeId === this.instance.beeId);
        if (idx >= 0) this.cfg.instances[idx] = this.instance;
        saveConfig(this.cfg);
      },
      this.instance.channels.imessage?.dbPath,
    );
  }

  // Full teardown for a deleted profile: stop every channel adapter, release any
  // channels this bee had claimed, and close the hive link (no reconnect).
  async stop(): Promise<void> {
    for (const a of this.adapters.values()) await a.stop().catch(() => {});
    for (const [kind, owner] of claimedChannels) {
      if (owner === this.instance.beeId) claimedChannels.delete(kind);
    }
    this.adapters.clear();
    this.link.stop();
  }

  registerAdapter(a: ChannelAdapter): void {
    if (a.kind !== "web") {
      const owner = claimedChannels.get(a.kind);
      if (owner && owner !== this.instance.beeId) {
        console.warn(`[bee] ${a.kind} already running on ${owner}; ${this.instance.beeId} won't start a duplicate`);
        return;
      }
      claimedChannels.set(a.kind, this.instance.beeId);
    }
    void this.adapters.get(a.kind)?.stop();
    this.adapters.set(a.kind, a);
    a.start((msg, sink) => void this.onMessage(msg, sink)).catch((e) =>
      console.error(`[bee] channel ${a.kind} failed to start: ${(e as Error).message}`),
    );
  }

  // Live health per channel — powers the "verify" step in the connect UI.
  channelHealth(): Record<string, { configured: boolean; running: boolean; detail?: string }> {
    const out: Record<string, { configured: boolean; running: boolean; detail?: string }> = {};
    for (const kind of ["telegram", "discord", "imessage"] as const) {
      const configured = !!this.instance.channels[kind];
      const a = this.adapters.get(kind);
      const h = a?.health();
      out[kind] = { configured, running: !!h?.ok, detail: h?.detail };
    }
    return out;
  }

  // The invite code for the member linked to this web uid — lets the "reach your
  // bee elsewhere" guide show "send this code" without the user knowing their id.
  async webMemberCode(uid: string): Promise<{ code?: string; name?: string }> {
    const check = await this.link.identityCheck("web", uid).catch(() => null);
    if (!check?.known || !check.memberId) return {};
    const r = (await fetch(`${this.cfg.hiveHttpUrl}/api/members/${check.memberId}/code`)
      .then((x) => x.json())
      .catch(() => ({}))) as { code?: string };
    return { code: r.code, name: check.memberName ?? undefined };
  }

  // Persona for a member, cached 60s to avoid a hive round-trip on every message.
  private async getPersona(memberId: string): Promise<string> {
    const hit = this.personaCache.get(memberId);
    if (hit && Date.now() - hit.at < 60_000) return hit.v;
    const bs = (await fetch(`${this.cfg.hiveHttpUrl}/api/members/${memberId}/bee-settings`)
      .then((r) => r.json())
      .catch(() => null)) as { persona?: string } | null;
    const v = bs?.persona?.trim() ?? "";
    this.personaCache.set(memberId, { v, at: Date.now() });
    return v;
  }

  private key(channel: ChannelKind, externalId: string): string {
    return `${channel}:${externalId}`;
  }

  async onMessage(msg: InboundMessage, sink: ReplySink): Promise<void> {
    const k = this.key(msg.channel, msg.externalId);
    let linked = this.cache.get(k);

    if (!linked) {
      const check = await this.link.identityCheck(msg.channel, msg.externalId);
      if (check.known && check.memberId && check.channelIdentityId) {
        linked = {
          memberId: check.memberId,
          memberName: check.memberName ?? "friend",
          channelIdentityId: check.channelIdentityId,
        };
        this.cache.set(k, linked);
      }
    }

    if (!linked) {
      const code = detectCode(msg.text);
      if (!code) {
        // rate-limit the pairing prompt to once/hour per unknown sender
        const last = this.lastPrompt.get(k) ?? 0;
        if (Date.now() - last > 3_600_000) {
          this.lastPrompt.set(k, Date.now());
          await sink.notice(pairingPrompt());
        }
        return;
      }
      const r = await this.link.pair(msg.channel, msg.externalId, msg.displayName, code);
      if (!r.ok || !r.memberId || !r.channelIdentityId) {
        await sink.notice(`That code didn't work: ${r.error ?? "unknown error"}. Try again?`);
        return;
      }
      linked = {
        memberId: r.memberId,
        memberName: r.memberName ?? "friend",
        channelIdentityId: r.channelIdentityId,
      };
      this.cache.set(k, linked);
      await sink.notice(`✅ Linked! Hi ${linked.memberName} — talk to me anytime.`);
      return;
    }

    if (await this.handleCommand(msg.text, linked, sink)) return;

    // off-the-record: reply normally but store nothing (no graph, no disclosure).
    const orMarker = /^\s*(\/private|\/offrecord|🔒)\s*/i;
    const offRecord = orMarker.test(msg.text);
    const forChat = offRecord ? { ...msg, text: msg.text.replace(orMarker, "") } : msg;
    await this.chat(forChat, sink, linked, offRecord);
  }

  // Lightweight commands handled locally (never ingested as facts).
  private async handleCommand(text: string, linked: Linked, sink: ReplySink): Promise<boolean> {
    const hive = this.cfg.hiveHttpUrl;
    if (/^\s*(\/forget\b|forget (that|it|the last|what i just said|that last one))/i.test(text)) {
      const r = (await fetch(`${hive}/api/members/${linked.memberId}/forget-last`, { method: "POST" })
        .then((x) => x.json())
        .catch(() => null)) as { forgot?: string } | null;
      await sink.notice(r?.forgot ? `Done — I forgot: “${r.forgot}”.` : "There's nothing recent to forget.");
      return true;
    }
    if (/^\s*\/me\b/i.test(text)) {
      const mems = await fetch(`${hive}/api/members/${linked.memberId}/memories`)
        .then((x) => x.json())
        .catch(() => []);
      const top = (mems as { text: string }[]).slice(0, 15).map((m) => `• ${m.text}`).join("\n");
      await sink.notice(top ? `Here's what I remember about you:\n${top}` : "I don't have anything about you yet.");
      return true;
    }
    const setPref = text.match(/^\s*\/privacy\s+set\s+(.+)/i);
    if (setPref) {
      await fetch(`${hive}/api/members/${linked.memberId}/privacy`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: setPref[1]!.trim() }),
      }).catch(() => {});
      await sink.notice(`Got it — I'll keep that in mind before sharing anything about you: “${setPref[1]!.trim()}”`);
      return true;
    }
    if (/^\s*\/(shared|privacy)\b/i.test(text)) {
      const shared = await fetch(`${hive}/api/members/${linked.memberId}/shared`)
        .then((x) => x.json())
        .catch(() => []);
      const rows = (shared as { decision: string; disclosed: string | null; toMemberId: string }[]).filter((d) => d.decision !== "withhold" && d.disclosed);
      const list = rows.slice(0, 15).map((d) => `• ${d.disclosed}`).join("\n");
      await sink.notice(list ? `Things I've shared about you with others:\n${list}` : "I haven't shared anything about you with anyone.");
      return true;
    }
    if (/^\s*\/nopoll\b/i.test(text) || /^\s*\/(opt.?out)\b/i.test(text)) {
      await this.setOptOut(linked.memberId, true);
      await sink.notice("Done — I won't include you when I quietly gather the group's opinions.");
      return true;
    }
    if (/^\s*\/(pollme|opt.?in)\b/i.test(text)) {
      await this.setOptOut(linked.memberId, false);
      await sink.notice("Got it — you're back in the loop for group questions.");
      return true;
    }
    if (/^\s*\/(constitution|values|why)\b/i.test(text)) {
      await sink.notice(CONSTITUTION);
      return true;
    }
    if (/^\s*\/help\b/i.test(text)) {
      await sink.notice(
        "Things you can ask me:\n• /me — what I remember about you\n• /shared — what I've shared about you\n• /forget — forget the last thing\n• /private <message> — talk off the record (I won't store it)\n• /nopoll — don't include me when gathering the group's opinions\n• /privacy set <rule> — a standing rule before I share anything about you",
      );
      return true;
    }
    return false;
  }

  private async setOptOut(memberId: string, optOutOfPolling: boolean): Promise<void> {
    await fetch(`${this.cfg.hiveHttpUrl}/api/members/${memberId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ optOutOfPolling }),
    }).catch(() => {});
  }

  private async chat(msg: InboundMessage, sink: ReplySink, linked: Linked, offRecord = false): Promise<void> {
    // Channels collapse to one continuous `main` thread per member (cross-channel
    // continuity). The web UI can open MULTIPLE named conversations per profile —
    // each carries a sessionTag so it gets its own thread. Memory is still unified
    // at the hive graph level; only the conversation transcript is per-session.
    const sessionId = `member:${linked.memberId}:${msg.sessionTag ?? "main"}`;

    // record + ingest the user turn — unless it's off the record (store nothing)
    appendSession(this.instance.beeId, sessionId, "user", msg.text);
    if (!offRecord) {
      appendDisplay(this.instance.beeId, sessionId, "user", msg.text);
      this.link.ingestTurn({
        turnId: id("turn"),
        memberId: linked.memberId,
        channelIdentityId: linked.channelIdentityId,
        sessionId,
        role: "user",
        content: msg.text,
        ts: msg.ts,
      });
    }

    // seed grounding context from hive (also available on demand via the recall tool)
    let blocks: ContextBlock[] = [];
    try {
      blocks = await this.link.context(linked.memberId, sessionId, msg.text);
    } catch {
      /* hive offline — reply without context */
    }

    // Compact long threads: fold the older prefix into a summary (via hive's social role).
    const summarize = async (convo: string): Promise<string> => {
      let out = "";
      try {
        for await (const ev of chatViaHive({
          hiveHttpUrl: this.cfg.hiveHttpUrl,
          beeId: this.instance.beeId,
          beeToken: this.instance.beeToken,
          role: "social",
          system: "Summarize this conversation concisely, preserving names, facts, decisions, and open threads. 2–6 sentences.",
          messages: [{ role: "user", content: convo }],
        })) {
          if (ev.type === "text_delta") out += ev.text;
        }
      } catch {
        /* summarizer unavailable */
      }
      return out.trim();
    };

    // per-member persona/tone (set from the dashboard or the bee's own settings).
    // Cached for 60s so we don't round-trip to the hive on every single message.
    let persona = "";
    try {
      persona = await this.getPersona(linked.memberId);
    } catch {
      /* hive offline — default persona */
    }

    const history = await loadHistoryCompacted(this.instance.beeId, sessionId, summarize);
    const system = buildSystem(linked.memberName, blocks, persona);
    const tools = makeBeeTools({
      hiveHttpUrl: this.cfg.hiveHttpUrl,
      memberId: linked.memberId,
      recall: (q) => this.link.context(linked.memberId, sessionId, q),
    });

    let full = "";
    try {
      for await (const ev of runAgentLoop(history, {
        streamFn: hiveStreamFn({ hiveHttpUrl: this.cfg.hiveHttpUrl, beeId: this.instance.beeId, beeToken: this.instance.beeToken, role: "chat" }),
        model: "hive-resolved",
        baseUrl: this.cfg.hiveHttpUrl,
        system,
        tools,
        maxTurns: 6,
      })) {
        if (ev.type === "text_delta") {
          full += ev.text;
          sink.delta(ev.text);
        }
      }
    } catch (e) {
      await sink.notice(`(couldn't reach my brain: ${(e as Error).message})`);
      return;
    }

    await sink.done(full);
    appendSession(this.instance.beeId, sessionId, "assistant", full);
    if (!offRecord) {
      appendDisplay(this.instance.beeId, sessionId, "bee", full);
      this.link.ingestTurn({
        turnId: id("turn"),
        memberId: linked.memberId,
        channelIdentityId: linked.channelIdentityId,
        sessionId,
        role: "assistant",
        content: full,
        ts: Date.now(),
      });
    }
  }

  // Resolve a member's session key for a channel address (for history/display).
  // `tag` selects the conversation thread (web multi-session); defaults to main.
  async sessionForMember(channel: ChannelKind, externalId: string, tag = "main"): Promise<string | null> {
    const cached = this.cache.get(this.key(channel, externalId));
    let memberId = cached?.memberId;
    if (!memberId) {
      const check = await this.link.identityCheck(channel, externalId).catch(() => null);
      memberId = check?.memberId ?? undefined;
    }
    return memberId ? `member:${memberId}:${tag}` : null;
  }

  private async deliverNudge(nudgeId: string, channel: ChannelKind, externalId: string, text: string): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      this.link.nudgeResult(nudgeId, "failed", `no adapter for ${channel}`);
      return;
    }
    try {
      await adapter.send(externalId, text);
      this.link.nudgeResult(nudgeId, "delivered");
      // persist to the member's display transcript so it survives a refresh
      const sid = await this.sessionForMember(channel, externalId);
      if (sid) appendDisplay(this.instance.beeId, sid, "nudge", text);
    } catch (e) {
      this.link.nudgeResult(nudgeId, "failed", (e as Error).message);
    }
  }

  private persistInstance(): void {
    const idx = this.cfg.instances.findIndex((i) => i.beeId === this.instance.beeId);
    if (idx >= 0) this.cfg.instances[idx] = this.instance;
    saveConfig(this.cfg);
  }

  private applyChannelConfig(channel: ChannelKind, config: Record<string, unknown>): void {
    // Disconnect: operator turned this channel off (no token, or enabled:false).
    const hasToken = !!(config as { botToken?: string }).botToken;
    const disabled =
      config["enabled"] === false || ((channel === "telegram" || channel === "discord") && !hasToken);
    if (disabled) {
      void this.adapters.get(channel)?.stop();
      this.adapters.delete(channel);
      delete this.instance.channels[channel];
      this.persistInstance();
      return;
    }

    // persist creds locally, then (re)start the adapter
    this.instance.channels[channel] = config as never;
    this.persistInstance();

    if (channel === "telegram" && (config as { botToken?: string }).botToken)
      this.registerAdapter(new TelegramChannel((config as { botToken: string }).botToken));
    else if (channel === "discord" && (config as { botToken?: string }).botToken)
      this.registerAdapter(new DiscordChannel((config as { botToken: string }).botToken));
    else if (channel === "imessage" && (config as { enabled?: boolean }).enabled)
      this.registerAdapter(this.makeIMessage());
  }
}

function buildSystem(memberName: string, blocks: ContextBlock[], persona = ""): string {
  let s = `You are ${memberName}'s personal Hive bee — a warm, concise companion who helps them and remembers what they share. Speak naturally and keep replies short unless asked for more.

${CONSTITUTION_BRIEF}
If ${memberName} ever asks why you did or said something, explain honestly — use the \`explain_decision\` tool to ground your answer.`;
  if (persona) s += `\n\nPERSONALITY & TONE (set by ${memberName} — follow it): ${persona}`;
  s += `

TOOLS — you can act, not just answer:
- Call \`recall\` to look up facts before answering anything about people, plans, preferences, or the past. Privacy is enforced by the hive, so trust what it returns.
- Use \`my_memories\` / \`whats_shared_about_me\` when asked what you know about them or what others know.
- Use \`set_privacy\` when they ask to keep something private.

GROUNDING — this is critical:
- Only state facts about people, places, events, or preferences that appear in "Hive context" below, that a tool returned, or that ${memberName} has told you in this conversation.
- If you don't have the information, say so plainly ("I don't have anything about that yet", "I don't know Yash"). NEVER invent names, dates, places, preferences, or any detail. Do not guess or fill gaps with plausible-sounding facts.
- Admitting you don't know is always better than making something up.

DISCRETION — how you handle other people (just as critical):
- You work for ${memberName} alone. Talk about ${memberName}'s own life freely.
- NEVER volunteer facts about other people, and NEVER bring up who else likes/knows/did something. Do not name another person or their preferences unless ${memberName} EXPLICITLY asks about that specific person ("does anyone else like SF?", "what's Yash into?").
- Do not play matchmaker or suggest connections ("you two should…", "you might get along with…"). Making introductions is the hive's job — it does that deliberately and privately, not you mid-chat. When ${memberName} shares something, just be present with THEM about it.
- A good bee is discreet. Knowing something about someone else is not a reason to mention it.`;
  const ownBlocks = blocks.filter((b) => b.kind !== "disclosure-note");
  const otherBlocks = blocks.filter((b) => b.kind === "disclosure-note");
  if (ownBlocks.length) {
    s += `\n\nContext about ${memberName} (use it naturally; don't recite it verbatim):`;
    for (const b of ownBlocks) s += `\n- ${b.text}`;
  }
  if (otherBlocks.length) {
    s += `\n\nBackground about other people — DO NOT bring any of this up on your own. Use it ONLY if ${memberName} directly asks about that specific person, and even then share lightly:`;
    for (const b of otherBlocks) s += `\n- ${b.text}`;
  }
  if (!blocks.length) {
    s += `\n\nHive context: none found for this. If they're asking about a person or fact you have no context for, tell them you don't have that yet — do not invent an answer.`;
  }
  return s;
}
