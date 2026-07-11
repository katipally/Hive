import { id, CONSTITUTION, CONSTITUTION_BRIEF, helpText } from "@hive/shared";
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

interface Linked {
  memberId: string;
  memberName: string;
  channelIdentityId: string;
}

// A non-web channel (Telegram/Discord) must run on exactly ONE bee, or two adapters
// double-process the same inbox. First bee to claim a channel owns it; others skip.
// Web is per-bee (fine).
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
    if (ch.telegram?.botToken) void this.registerAdapter(new TelegramChannel(ch.telegram.botToken), ch.telegram.botToken);
    if (ch.discord?.botToken) void this.registerAdapter(new DiscordChannel(ch.discord.botToken), ch.discord.botToken);
    // web adapter is registered by the runtime
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

  // Signature (token) of the currently-registered adapter per kind, so a redundant
  // re-register (same token) can be skipped — otherwise every hive reconnect re-pushes
  // the stored config and spins up a SECOND long-poller fighting the first over the same
  // bot (Telegram 409 storm → console flood → the whole machine lags).
  private adapterSig = new Map<ChannelKind, string>();

  async registerAdapter(a: ChannelAdapter, sig = ""): Promise<void> {
    if (a.kind !== "web") {
      const owner = claimedChannels.get(a.kind);
      if (owner && owner !== this.instance.beeId) {
        console.warn(`[bee] ${a.kind} already running on ${owner}; ${this.instance.beeId} won't start a duplicate`);
        return;
      }
      // Already running this exact adapter — don't start a duplicate poller.
      if (this.adapters.has(a.kind) && this.adapterSig.get(a.kind) === sig) return;
      claimedChannels.set(a.kind, this.instance.beeId);
    }
    // Stop the old adapter and WAIT for it to fully release before starting the new one,
    // so two pollers never overlap on the same bot.
    const old = this.adapters.get(a.kind);
    if (old) await old.stop().catch(() => {});
    this.adapters.set(a.kind, a);
    this.adapterSig.set(a.kind, sig);
    await a.start((msg, sink) => void this.onMessage(msg, sink)).catch((e) =>
      console.error(`[bee] channel ${a.kind} failed to start: ${(e as Error).message}`),
    );
  }

  // Live health per channel — powers the "verify" step in the connect UI.
  channelHealth(): Record<string, { configured: boolean; running: boolean; detail?: string }> {
    const out: Record<string, { configured: boolean; running: boolean; detail?: string }> = {};
    for (const kind of ["telegram", "discord"] as const) {
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
      let check;
      try {
        check = await this.link.identityCheck(msg.channel, msg.externalId);
      } catch {
        await sink.notice("I can't reach the hive right now — give me a moment and try again?");
        return;
      }
      if (check.known && check.memberId && check.channelIdentityId) {
        linked = {
          memberId: check.memberId,
          memberName: check.memberName ?? "friend",
          channelIdentityId: check.channelIdentityId,
        };
        this.cache.set(k, linked);
      }
    }

    // explicit auth commands — usable on any channel, linked or not
    if (/^\s*\/logout\b/i.test(msg.text)) {
      if (!linked) { await sink.notice("You're not linked here — nothing to log out of. Send /login <code> to connect."); return; }
      await this.unlink(msg.channel, msg.externalId, sink);
      return;
    }
    const login = /^\s*\/login\b\s*(.*)$/i.exec(msg.text);
    if (login) {
      if (linked) { await sink.notice(`You're already linked as ${linked.memberName}. Send /logout first if you want to switch accounts.`); return; }
      const loginCode = detectCode(login[1] ?? "");
      if (!loginCode) { await sink.notice("To link me to your account, send /login and your invite code — e.g. /login BEE-1234."); return; }
      await this.pairWithCode(msg, loginCode, sink);
      return;
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
      if (!(await this.pairWithCode(msg, code, sink))) return;
      return;
    }

    if (await this.handleCommand(msg.text, linked, sink)) return;

    // off-the-record: reply normally but store nothing (no graph, no disclosure).
    const orMarker = /^\s*(\/private|\/offrecord|🔒)\s*/i;
    const offRecord = orMarker.test(msg.text);
    const forChat = offRecord ? { ...msg, text: msg.text.replace(orMarker, "") } : msg;
    await this.chat(forChat, sink, linked, offRecord);
  }

  // Pair this channel address to a member via an invite code, cache it, and confirm.
  // Shared by the bare-code flow and the explicit /login command. Returns the link or null.
  private async pairWithCode(msg: InboundMessage, code: string, sink: ReplySink): Promise<Linked | null> {
    let r;
    try {
      r = await this.link.pair(msg.channel, msg.externalId, msg.displayName, code);
    } catch {
      await sink.notice("I can't reach the hive to link you right now — try again in a moment?");
      return null;
    }
    if (!r.ok || !r.memberId || !r.channelIdentityId) {
      await sink.notice(`That code didn't work: ${r.error ?? "unknown error"}. Try again?`);
      return null;
    }
    const linked: Linked = { memberId: r.memberId, memberName: r.memberName ?? "friend", channelIdentityId: r.channelIdentityId };
    this.cache.set(this.key(msg.channel, msg.externalId), linked);
    await sink.notice(`✅ Linked! Hi ${linked.memberName} — talk to me anytime.`);
    return linked;
  }

  // /logout — unlink just THIS channel identity on the hive, then forget it locally.
  // Other channels and the member's memory are untouched.
  private async unlink(channel: ChannelKind, externalId: string, sink: ReplySink): Promise<void> {
    try {
      const res = await fetch(`${this.cfg.hiveHttpUrl}/api/unlink`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bee-id": this.instance.beeId, "x-bee-token": this.instance.beeToken },
        body: JSON.stringify({ channel, externalId }),
      });
      if (!res.ok) throw new Error(`unlink ${res.status}`);
    } catch {
      await sink.notice("I couldn't reach the hive to unlink you — try again in a moment?");
      return;
    }
    const k = this.key(channel, externalId);
    this.cache.delete(k);
    this.lastPrompt.delete(k);
    await sink.notice("You're logged out — I've unlinked this chat from your account. Send /login <code> anytime to reconnect.");
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
      const mems = await fetch(`${hive}/api/members/${linked.memberId}/memories`, {
        headers: { "x-bee-id": this.instance.beeId, "x-bee-token": this.instance.beeToken },
      })
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
      await sink.notice(helpText()); // generated from the shared registry — never drifts
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

    // record + ingest the user turn — unless it's off the record. Off-record means
    // store NOTHING: not the session .jsonl (which feeds the cloud summarizer), not the
    // display transcript, not the graph. The turn lives only in this request's memory.
    if (!offRecord) {
      appendSession(this.instance.beeId, sessionId, "user", msg.text);
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
    // Off-record turns aren't persisted, so the current user message isn't in the loaded
    // history — inject it in-memory only so the bee can still reply to it.
    if (offRecord) history.push({ role: "user", content: msg.text });
    const system = buildSystem(linked.memberName, blocks, persona);
    // Some models (e.g. MiniMax) under-weight the system prompt and only reliably use
    // facts that appear in the CONVERSATION. So we also seed the hive's retrieved memory
    // as a prior turn the bee already "said" — the model trusts its own earlier statements,
    // which fixes "what do you know about me?" answered with "nothing" despite full context.
    const ownFacts = blocks.filter((b) => b.kind !== "disclosure-note").map((b) => b.text);
    if (ownFacts.length) {
      // Insert RIGHT BEFORE the current user turn so it's the most-recent context the model
      // sees (models attend to recent turns; putting it at the start gets ignored).
      history.splice(Math.max(0, history.length - 1), 0,
        { role: "user", content: `(memory refresh) what do you know about ${linked.memberName} so far?` },
        { role: "assistant", content: `Here's what the hive has on file about ${linked.memberName}:\n${ownFacts.map((f) => `- ${f}`).join("\n")}` },
      );
    }
    const tools = makeBeeTools({
      hiveHttpUrl: this.cfg.hiveHttpUrl,
      memberId: linked.memberId,
      beeId: this.instance.beeId,
      beeToken: this.instance.beeToken,
      recall: (q) => this.link.context(linked.memberId, sessionId, q),
    });

    // Stream only the FINAL answer, not the model's tool-by-tool narration. Text said
    // BEFORE a tool call is "working" chatter ("let me update the hive…"); we discard it
    // so every channel gets one clean reply instead of "updating… saved… updating…".
    let full = ""; // the clean final answer
    let curTurn = ""; // text streamed so far this turn (may just be narration)
    try {
      for await (const ev of runAgentLoop(history, {
        streamFn: hiveStreamFn({ hiveHttpUrl: this.cfg.hiveHttpUrl, beeId: this.instance.beeId, beeToken: this.instance.beeToken, role: "chat" }),
        model: "hive-resolved",
        baseUrl: this.cfg.hiveHttpUrl,
        system,
        tools,
        maxTurns: 6,
      })) {
        if (ev.type === "turn_start") {
          curTurn = "";
        } else if (ev.type === "text_delta") {
          curTurn += ev.text;
          sink.delta(ev.text);
        } else if (ev.type === "tool_start" && curTurn) {
          // that text was pre-tool narration — wipe it from the live stream
          sink.reset?.();
          curTurn = "";
        } else if (ev.type === "turn_end") {
          full = ev.text || curTurn;
        }
      }
    } catch (e) {
      console.error(`[bee] chat failed: ${(e as Error).message}`);
      await sink.done("Sorry — I couldn't reach my brain just now. Mind trying that again in a moment?");
      return;
    }
    full = cleanReply(full || curTurn);
    if (!full) {
      // Agent loop ran out of turns (or produced nothing) — never send a blank reply.
      await sink.done("Sorry, I lost my train of thought there — could you say that again?");
      return; // don't persist/ingest a non-answer
    }
    await sink.done(full); // done carries the clean final text; the web replaces the stream with it
    if (!offRecord) {
      appendSession(this.instance.beeId, sessionId, "assistant", full);
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
    // Persist to the display transcript FIRST (CH-3), so a web nudge survives a closed
    // tab / refresh even when live delivery fails — the old order dropped it entirely.
    const sid = await this.sessionForMember(channel, externalId);
    if (sid) appendDisplay(this.instance.beeId, sid, "nudge", text);

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
      this.adapterSig.delete(channel);
      delete this.instance.channels[channel];
      this.persistInstance();
      return;
    }

    // persist creds locally, then (re)start the adapter
    this.instance.channels[channel] = config as never;
    this.persistInstance();

    const token = (config as { botToken?: string }).botToken;
    if (channel === "telegram" && token) void this.registerAdapter(new TelegramChannel(token), token);
    else if (channel === "discord" && token) void this.registerAdapter(new DiscordChannel(token), token);
  }
}

// Tidy a reply before it leaves the bee: strip a stray tool-call marker some models
// (MiniMax) leak at tool boundaries, and collapse runaway blank lines.
function cleanReply(s: string): string {
  return s
    .replace(/\[e~\[/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildSystem(memberName: string, blocks: ContextBlock[], persona = ""): string {
  let s = `You are ${memberName}'s personal Hive bee — a warm, concise companion who helps them and remembers what they share. Speak naturally and keep replies short unless asked for more.

RESTRAINT — you are a quiet, high-signal presence, not a chatty assistant. Say what's useful and stop. Do NOT end every message with a follow-up question or an offer to help — only ask when you genuinely need something to continue. Silence is fine; a short acknowledgement is often the right reply. Never pad.

${CONSTITUTION_BRIEF}
If ${memberName} ever asks why you did or said something, explain honestly — use the \`explain_decision\` tool to ground your answer.`;
  if (persona) s += `\n\nPERSONALITY & TONE (set by ${memberName} — follow it): ${persona}`;
  s += `

TOOLS — you can act, not just answer:
- Call \`recall\` to look up facts before answering anything about people, plans, preferences, or the past. Privacy is enforced by the hive, so trust what it returns.
- Use \`my_memories\` / \`whats_shared_about_me\` when asked what you know about them or what others know.
- Use \`set_privacy\` when they ask to keep something private.
- Use \`web_lookup\` to find real-world / current info the hive doesn't have (a product, place, event, availability, a current fact). Share what it returns; if it's unavailable, say so — never invent.
- Use \`read_url\` to open and read a specific link the member shares, so you can summarize it or answer questions about it.
- Use \`set_reminder\` when ${memberName} asks to be reminded of something later. The current date/time is ${new Date().toISOString()} (UTC) — compute the reminder's due_iso from that (for relative asks like "in 2 hours" this is exact; for clock times assume their local day).

GROUNDING — this is critical:
- The section "WHAT THE HIVE REMEMBERS ABOUT ${memberName}" below is real, verified memory. Draw on it naturally when it's relevant — don't recite it unprompted or list facts back robotically. But never claim you "don't have that / nothing saved" when the answer is right there.
- Only state facts that appear in that memory below, that a tool returned, or that ${memberName} told you in this conversation. NEVER invent names, dates, places, or preferences.
- ONLY if there are genuinely no relevant facts below AND it wasn't said in this chat, say plainly "I don't have anything about that yet" — never guess or fill gaps with plausible-sounding detail.

DISCRETION — how you handle other people (just as critical):
- You work for ${memberName} alone. Talk about ${memberName}'s own life freely.
- NEVER volunteer facts about other people, and NEVER bring up who else likes/knows/did something. Do not name another person or their preferences unless ${memberName} EXPLICITLY asks about that specific person ("does anyone else like SF?", "what's Yash into?").
- Do not play matchmaker or suggest connections ("you two should…", "you might get along with…"). Making introductions is the hive's job — it does that deliberately and privately, not you mid-chat. When ${memberName} shares something, just be present with THEM about it.
- A good bee is discreet. Knowing something about someone else is not a reason to mention it.`;
  const ownBlocks = blocks.filter((b) => b.kind !== "disclosure-note");
  const otherBlocks = blocks.filter((b) => b.kind === "disclosure-note");
  if (ownBlocks.length) {
    s += `\n\nWHAT THE HIVE REMEMBERS ABOUT ${memberName} (real, verified memory — answer their questions directly from this; don't recite it robotically, but NEVER claim you have nothing when facts are listed here):`;
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
