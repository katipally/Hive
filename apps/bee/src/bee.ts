import { id } from "@hive/shared";
import type { ChannelKind, ContextBlock } from "@hive/shared";
import { runAgentLoop } from "@hive/shared/agent";
import { saveConfig, type BeeConfig, type BeeInstanceConfig } from "./config.js";
import { HiveLink } from "./hive-link.js";
import { chatViaHive, hiveStreamFn } from "./llm-via-hive.js";
import { makeBeeTools } from "./agent-tools.js";
import { appendSession, loadHistoryCompacted } from "./sessions.js";
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

export class Bee {
  readonly link: HiveLink;
  private adapters = new Map<ChannelKind, ChannelAdapter>();
  private cache = new Map<string, Linked>(); // key: `${channel}:${externalId}`
  private lastPrompt = new Map<string, number>(); // rate-limit pairing prompts

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
    return new IMessageChannel(this.instance.imessageCursor ?? 0, (rowid) => {
      this.instance.imessageCursor = rowid;
      const idx = this.cfg.instances.findIndex((i) => i.beeId === this.instance.beeId);
      if (idx >= 0) this.cfg.instances[idx] = this.instance;
      saveConfig(this.cfg);
    });
  }

  registerAdapter(a: ChannelAdapter): void {
    void this.adapters.get(a.kind)?.stop();
    this.adapters.set(a.kind, a);
    a.start((msg, sink) => void this.onMessage(msg, sink)).catch((e) =>
      console.error(`[bee] channel ${a.kind} failed to start: ${(e as Error).message}`),
    );
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
    await this.chat(msg, sink, linked);
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
    return false;
  }

  private async chat(msg: InboundMessage, sink: ReplySink, linked: Linked): Promise<void> {
    const sessionId = this.key(msg.channel, msg.externalId);

    // record + ingest the user turn
    appendSession(this.instance.beeId, sessionId, "user", msg.text);
    this.link.ingestTurn({
      turnId: id("turn"),
      memberId: linked.memberId,
      channelIdentityId: linked.channelIdentityId,
      sessionId,
      role: "user",
      content: msg.text,
      ts: msg.ts,
    });

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

    // per-member persona/tone (set from the dashboard or the bee's own settings)
    let persona = "";
    try {
      const bs = (await fetch(`${this.cfg.hiveHttpUrl}/api/members/${linked.memberId}/bee-settings`)
        .then((r) => r.json())
        .catch(() => null)) as { persona?: string } | null;
      persona = bs?.persona?.trim() ?? "";
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
        streamFn: hiveStreamFn({ hiveHttpUrl: this.cfg.hiveHttpUrl, beeToken: this.instance.beeToken, role: "chat" }),
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

  private async deliverNudge(nudgeId: string, channel: ChannelKind, externalId: string, text: string): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      this.link.nudgeResult(nudgeId, "failed", `no adapter for ${channel}`);
      return;
    }
    try {
      await adapter.send(externalId, text);
      this.link.nudgeResult(nudgeId, "delivered");
    } catch (e) {
      this.link.nudgeResult(nudgeId, "failed", (e as Error).message);
    }
  }

  private applyChannelConfig(channel: ChannelKind, config: Record<string, unknown>): void {
    // persist creds locally, then (re)start the adapter
    this.instance.channels[channel] = config as never;
    const idx = this.cfg.instances.findIndex((i) => i.beeId === this.instance.beeId);
    if (idx >= 0) this.cfg.instances[idx] = this.instance;
    saveConfig(this.cfg);

    if (channel === "telegram" && (config as { botToken?: string }).botToken)
      this.registerAdapter(new TelegramChannel((config as { botToken: string }).botToken));
    else if (channel === "discord" && (config as { botToken?: string }).botToken)
      this.registerAdapter(new DiscordChannel((config as { botToken: string }).botToken));
    else if (channel === "imessage" && (config as { enabled?: boolean }).enabled)
      this.registerAdapter(this.makeIMessage());
    else this.pendingChannelConfig?.(channel, config);
  }

  // set by runtime for channels the Bee doesn't start itself (e.g. iMessage in M9)
  pendingChannelConfig?: (channel: ChannelKind, config: Record<string, unknown>) => void;
}

function buildSystem(memberName: string, blocks: ContextBlock[], persona = ""): string {
  let s = `You are ${memberName}'s personal Hive bee — a warm, concise companion who helps them and remembers what they share. Speak naturally and keep replies short unless asked for more.`;
  if (persona) s += `\n\nPERSONALITY & TONE (set by ${memberName} — follow it): ${persona}`;
  s += `

TOOLS — you can act, not just answer:
- Call \`recall\` to look up facts before answering anything about people, plans, preferences, or the past. Privacy is enforced by the hive, so trust what it returns.
- Use \`my_memories\` / \`whats_shared_about_me\` when asked what you know about them or what others know.
- Use \`set_privacy\` when they ask to keep something private.

GROUNDING — this is critical:
- Only state facts about people, places, events, or preferences that appear in "Hive context" below, that a tool returned, or that ${memberName} has told you in this conversation.
- If you don't have the information, say so plainly ("I don't have anything about that yet", "I don't know Yash"). NEVER invent names, dates, places, preferences, or any detail. Do not guess or fill gaps with plausible-sounding facts.
- Admitting you don't know is always better than making something up.`;
  if (blocks.length) {
    s += `\n\nHive context (use it naturally; don't recite it verbatim):`;
    for (const b of blocks) s += `\n- ${b.text}`;
  } else {
    s += `\n\nHive context: none found for this. If they're asking about a person or fact you have no context for, tell them you don't have that yet — do not invent an answer.`;
  }
  return s;
}
