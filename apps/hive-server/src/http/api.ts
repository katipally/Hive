import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  createMember,
  listMembers,
  getMember,
  updateMember,
  createPairingCode,
  activePairingCode,
  unlinkIdentity,
  listIdentities,
  memberForCode,
  deleteMember,
} from "../db/repo.js";
import { beeOnline, listBees, sendToBee } from "../ws/bee-hub.js";
import { recentActivity } from "../activity.js";
import { putSecret, last4, hasSecret, deleteSecret, getSecret, listSecretNames } from "../crypto/keystore.js";
import {
  getModelRoles,
  setModelRole,
  getBaseUrls,
  setBaseUrl,
  getProactive,
  setProactive,
  resolveRole,
  getPrivacyPref,
  setPrivacyPref,
  getBeeSettings,
  setBeeSettings,
  getChannelInfo,
  setChannelInfo,
  clearChannelInfo,
} from "../settings/settings.js";
import { PROVIDERS, PROVIDER_IDS, listModels, streamByFamily } from "@hive/shared/llm";
import type { Message, ProviderId, ThinkingLevel, ToolSpec } from "@hive/shared/llm";
import { CONSTITUTION } from "@hive/shared";
import type { ModelRole } from "@hive/shared";
import { readGraph, inspectEntity } from "../graph/read.js";
import { deleteMemory, deleteEntity, forgetLastMemory } from "../graph/write.js";
import { sharedInterests } from "../graph/social.js";
import { runOrchestrator } from "../proactive/orchestrator.js";
import { sendDigest } from "../proactive/digest.js";
import { getDb } from "../db/db.js";
import { broadcastDash } from "../ws/dash-hub.js";
import { listDisclosures, disclosuresFromMember } from "../disclosure/store.js";
import { listNudges, setNudgeStatus, setNudgeFeedback, getNudge } from "../proactive/store.js";
import { scheduleDelivery, undoNudge } from "../proactive/nudges.js";
import { insertReminder, listReminders } from "../proactive/reminders.js";
import { startPoll, cancelPoll, synthesizePoll } from "../polling/polls.js";
import { listPollDetails } from "../polling/store.js";
import { webSearch, readUrl } from "../tools/search.js";

export function buildApi(version: string): Hono {
  const app = new Hono();
  app.use("*", cors());

  app.get("/api/health", (c) => c.json({ ok: true, version }));
  app.get("/api/constitution", (c) => c.json({ text: CONSTITUTION }));

  // ---- members ----
  app.get("/api/members", (c) =>
    c.json(
      listMembers().map((m) => ({
        ...m,
        code: activePairingCode(m.id), // read-only: a GET must not mint pairing rows (DATA-5)
        identities: listIdentities(m.id).map((ci) => ({
          ...ci,
          beeOnline: ci.beeId ? beeOnline(ci.beeId) : false,
        })),
      })),
    ),
  );
  // ---- reminders (bee-authenticated): the bee's "do something later" capability ----
  app.post("/api/reminders", async (c) => {
    const token = c.req.header("x-bee-token");
    const beeId = c.req.header("x-bee-id");
    if (!token || !beeId || !beeTokenValid(beeId, token)) return c.json({ error: "unauthorized" }, 401);
    const { memberId, text, dueIso } = await c.req.json<{ memberId: string; text: string; dueIso: string }>();
    const due = Date.parse(dueIso ?? "");
    if (!memberId || !text?.trim() || Number.isNaN(due)) return c.json({ error: "memberId, text, dueIso required" }, 400);
    if (due < Date.now() - 60_000) return c.json({ error: "that time is in the past" }, 400);
    const id = insertReminder(memberId, text.trim(), due);
    return c.json({ ok: true, id });
  });
  app.get("/api/members/:id/reminders", (c) => c.json(listReminders(c.req.param("id"))));

  // ---- /logout: unlink one channel identity (bee-authenticated) ----
  app.post("/api/unlink", async (c) => {
    const token = c.req.header("x-bee-token");
    const beeId = c.req.header("x-bee-id");
    if (!token || !beeId || !beeTokenValid(beeId, token)) return c.json({ error: "unauthorized" }, 401);
    const { channel, externalId } = await c.req.json<{ channel: string; externalId: string }>();
    if (!channel || !externalId) return c.json({ error: "channel + externalId required" }, 400);
    const r = unlinkIdentity(channel as never, externalId);
    if (r) broadcastDash({ type: "graph.dirty" });
    return c.json({ ok: !!r });
  });
  app.post("/api/members", async (c) => {
    const { name, timezone } = await c.req.json<{ name: string; timezone?: string }>();
    if (!name?.trim()) return c.json({ error: "name required" }, 400);
    const m = createMember(name.trim(), timezone);
    return c.json({ ...m, code: createPairingCode(m.id) });
  });
  app.patch("/api/members/:id", async (c) => {
    const body = await c.req.json();
    const m = updateMember(c.req.param("id"), body);
    if (m) broadcastDash({ type: "member.updated", member: m }); // was never broadcast → dash didn't live-refresh
    return m ? c.json(m) : c.json({ error: "not found" }, 404);
  });
  app.delete("/api/members/:id", (c) => {
    const id = c.req.param("id");
    const identities = listIdentities(id); // capture before delete
    if (!deleteMember(id)) return c.json({ error: "not found" }, 404);
    // tell each owning bee to forget this member's channel identities
    for (const ci of identities) if (ci.beeId) sendToBee(ci.beeId, { type: "identity.revoked", channelIdentityId: ci.id });
    broadcastDash({ type: "graph.dirty" });
    return c.json({ ok: true });
  });
  app.get("/api/members/:id/code", (c) => {
    const m = getMember(c.req.param("id"));
    return m ? c.json({ code: createPairingCode(m.id) }) : c.json({ error: "not found" }, 404);
  });

  // ---- bees & channel config ----
  app.get("/api/bees", (c) =>
    c.json(
      listBees().map((b) => ({
        ...b,
        channels: listSecretNames(`bee:${b.beeId}:channel:`).map((n) => n.split(":").pop()),
      })),
    ),
  );
  app.put("/api/bees/:beeId/channels/:channel", async (c) => {
    const beeId = c.req.param("beeId");
    const channel = c.req.param("channel");
    if (!["telegram", "discord"].includes(channel)) return c.json({ error: "bad channel" }, 400);
    const config = await c.req.json<Record<string, unknown>>();
    // validate with the provider BEFORE persisting — a rejected token never becomes a channel
    const check = await validateToken(channel, config);
    if (!check.ok) return c.json({ error: check.error, field: check.field ?? "botToken" }, 400);
    putSecret(`bee:${beeId}:channel:${channel}`, JSON.stringify(config));
    const pushed = sendToBee(beeId, { type: "channel.config", channel: channel as never, config });
    await captureChannelInfo(channel, config); // record the public join address
    return c.json({ ok: true, pushed });
  });
  app.delete("/api/bees/:beeId/channels/:channel", (c) => {
    const beeId = c.req.param("beeId");
    const channel = c.req.param("channel");
    if (!["telegram", "discord"].includes(channel)) return c.json({ error: "bad channel" }, 400);
    deleteSecret(`bee:${beeId}:channel:${channel}`);
    clearChannelInfo(channel as "telegram" | "discord");
    // tell the bee to stop the adapter (empty/disabled config)
    const pushed = sendToBee(beeId, { type: "channel.config", channel: channel as never, config: { enabled: false } });
    return c.json({ ok: true, pushed });
  });
  // Public join addresses (bot links) for member invites.
  // Backfills Telegram/Discord from already-configured bots (setups made before
  // this existed) so existing hives get real links without re-entering tokens.
  app.get("/api/channel-info", async (c) => {
    const info = getChannelInfo();
    if (!info.telegram || !info.discord) {
      for (const name of getDb().db.prepare("SELECT name FROM secrets WHERE name LIKE 'bee:%:channel:%'").all() as { name: string }[]) {
        const ch = name.name.split(":").pop();
        if ((ch === "telegram" && !info.telegram) || (ch === "discord" && !info.discord)) {
          const cfg = safeJson(getSecret(name.name));
          if (cfg && typeof cfg["botToken"] === "string") await captureChannelInfo(ch, cfg);
        }
      }
    }
    return c.json(getChannelInfo());
  });

  // Which channels a member has actually linked (for the "connected here" badges in the
  // bee UI). Keyed by the member's own invite code so the bee can passthrough without
  // needing member ids. Web is always available (that's where they're asking from).
  app.get("/api/member-channels", (c) => {
    const code = c.req.query("code");
    const memberId = code ? memberForCode(code) : null;
    const linked = memberId ? new Set(listIdentities(memberId).map((ci) => ci.channel)) : new Set<string>();
    return c.json({ web: true, telegram: linked.has("telegram"), discord: linked.has("discord") });
  });

  // ---- providers / keys ----
  app.get("/api/providers", (c) =>
    c.json(
      PROVIDER_IDS.map((id) => ({
        ...PROVIDERS[id],
        hasKey: hasSecret(`provider:${id}`),
        keyLast4: last4(`provider:${id}`),
        baseUrl: getBaseUrls()[id] ?? PROVIDERS[id].defaultBaseUrl,
      })),
    ),
  );
  app.put("/api/providers/:id/key", async (c) => {
    const id = c.req.param("id") as ProviderId;
    if (!PROVIDERS[id]) return c.json({ error: "unknown provider" }, 400);
    const { key } = await c.req.json<{ key: string }>();
    if (!key) return c.json({ error: "key required" }, 400);
    putSecret(`provider:${id}`, key);
    return c.json({ ok: true, keyLast4: key.slice(-4) });
  });
  app.delete("/api/providers/:id/key", (c) => {
    deleteSecret(`provider:${c.req.param("id")}`);
    return c.json({ ok: true });
  });
  app.put("/api/providers/:id/base-url", async (c) => {
    const id = c.req.param("id") as ProviderId;
    if (!PROVIDERS[id]) return c.json({ error: "unknown provider" }, 400);
    const { baseUrl } = await c.req.json<{ baseUrl: string }>();
    setBaseUrl(id, baseUrl);
    return c.json({ ok: true });
  });

  // ---- live model catalog ----
  app.get("/api/models", async (c) => {
    const provider = c.req.query("provider") as ProviderId;
    if (!PROVIDERS[provider]) return c.json({ error: "unknown provider" }, 400);
    try {
      const models = await listModels(
        provider,
        getSecret(`provider:${provider}`) ?? undefined,
        getBaseUrls()[provider],
      );
      return c.json({ models });
    } catch (e) {
      return c.json({ error: (e as Error).message, models: [] }, 502);
    }
  });

  // ---- model role assignment ----
  app.get("/api/settings", (c) =>
    c.json({ modelRoles: getModelRoles(), baseUrls: getBaseUrls(), proactive: getProactive() }),
  );
  app.put("/api/settings/roles/:role", async (c) => {
    const role = c.req.param("role") as ModelRole;
    const cfg = await c.req.json();
    setModelRole(role, cfg);
    return c.json({ ok: true });
  });
  app.put("/api/settings/proactive", async (c) => {
    setProactive(await c.req.json());
    return c.json({ ok: true });
  });

  // ---- LLM proxy (bee-authenticated) SSE ----
  app.post("/api/llm/chat", async (c) => {
    const token = c.req.header("x-bee-token");
    const beeId = c.req.header("x-bee-id");
    if (!token || !beeId || !beeTokenValid(beeId, token)) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json<{
      role: ModelRole;
      system?: string;
      messages: Message[];
      thinkingLevel?: ThinkingLevel;
      tools?: ToolSpec[];
    }>();
    let resolved;
    try {
      resolved = resolveRole(body.role ?? "chat");
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    return streamSSE(c, async (stream) => {
      try {
        for await (const ev of streamByFamily(resolved.family, {
          baseUrl: resolved.baseUrl,
          apiKey: resolved.apiKey,
          model: resolved.model,
          system: body.system,
          messages: body.messages,
          tools: body.tools,
          thinkingLevel: body.thinkingLevel ?? resolved.thinkingLevel,
        })) {
          await stream.writeSSE({ data: JSON.stringify(ev) });
        }
      } catch (e) {
        await stream.writeSSE({ data: JSON.stringify({ type: "error", error: (e as Error).message }) });
      }
    });
  });

  // ---- errand: real-world web search via Exa (called by the bee's web_lookup tool) ----
  // Search + cap logic lives in tools/search.ts and is shared with proactive errands.
  app.post("/api/tools/web-search", async (c) => {
    const body = await c.req.json<{ query?: string }>().catch(() => ({}) as { query?: string });
    const q = (body.query ?? "").trim();
    if (!q) return c.json({ error: "empty query", results: [] }, 400);
    const res = await webSearch(q);
    return c.json(res);
  });
  app.post("/api/tools/read-url", async (c) => {
    const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });
    const u = (body.url ?? "").trim();
    if (!u) return c.json({ error: "empty url" }, 400);
    return c.json(await readUrl(u));
  });

  // ---- reads for the dashboard ----
  app.get("/api/graph", (c) =>
    c.json(
      readGraph({
        member: c.req.query("member") ?? undefined,
        type: c.req.query("type") ?? undefined,
        showInvalidated: c.req.query("showInvalidated") === "1",
      }),
    ),
  );
  app.get("/api/entities/:id", (c) => {
    const r = inspectEntity(c.req.param("id"));
    return r ? c.json(r) : c.json({ error: "not found" }, 404);
  });

  // ---- correction: forget / delete facts ----
  app.delete("/api/memories/:id", (c) => {
    const ok = deleteMemory(c.req.param("id"));
    if (ok) broadcastDash({ type: "graph.dirty" });
    return c.json({ ok });
  });
  app.delete("/api/entities/:id", (c) => {
    const ok = deleteEntity(c.req.param("id"));
    if (ok) broadcastDash({ type: "graph.dirty" });
    return c.json({ ok });
  });
  app.post("/api/members/:id/forget-last", (c) => {
    const text = forgetLastMemory(c.req.param("id"));
    if (text) broadcastDash({ type: "graph.dirty" });
    return c.json({ forgot: text });
  });

  // ---- member transparency ----
  // Raw memories are the most sensitive read in the system. Gate behind the same bee
  // token as the LLM proxy (the only legitimate caller is a member's own bee), so the
  // public URL can't dump anyone's private memories (PRV-2). The dashboard doesn't use
  // this endpoint; it reads the graph instead.
  app.get("/api/members/:id/memories", (c) => {
    const token = c.req.header("x-bee-token");
    const beeId = c.req.header("x-bee-id");
    if (!token || !beeId || !beeTokenValid(beeId, token)) return c.json({ error: "unauthorized" }, 401);
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
    const offset = Number(c.req.query("offset") ?? 0);
    const rows = getDb()
      .db.prepare("SELECT id,kind,text,salience,created_at FROM memories WHERE member_id=? AND superseded_by IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(c.req.param("id"), limit, offset);
    return c.json(rows);
  });
  app.get("/api/members/:id/shared", (c) => c.json(disclosuresFromMember(c.req.param("id"))));
  app.get("/api/members/:id/privacy", (c) => c.json({ text: getPrivacyPref(c.req.param("id")) }));
  app.put("/api/members/:id/privacy", async (c) => {
    const { text } = await c.req.json<{ text: string }>();
    setPrivacyPref(c.req.param("id"), text ?? "");
    return c.json({ ok: true });
  });

  // ---- per-member bee settings (persona + proactivity) ----
  app.get("/api/members/:id/bee-settings", (c) => c.json(getBeeSettings(c.req.param("id"))));
  app.put("/api/members/:id/bee-settings", async (c) => {
    const patch = await c.req.json<Partial<{ persona: string; proactivity: string }>>();
    setBeeSettings(c.req.param("id"), patch as never);
    return c.json(getBeeSettings(c.req.param("id")));
  });

  app.post("/api/members/:id/digest", async (c) => {
    const ok = await sendDigest(c.req.param("id"));
    return c.json({ ok });
  });
  app.get("/api/social", (c) => c.json({ sharedInterests: sharedInterests() }));
  app.post("/api/orchestrate", async (c) => {
    await runOrchestrator();
    return c.json({ ok: true });
  });
  const off = (c: { req: { query: (k: string) => string | undefined } }) => Number(c.req.query("offset") ?? 0);
  app.get("/api/activity", (c) => c.json(recentActivity(Number(c.req.query("limit") ?? 100), off(c))));
  app.get("/api/disclosures", (c) => c.json(listDisclosures(Number(c.req.query("limit") ?? 200), off(c))));
  app.get("/api/nudges", (c) => c.json(listNudges(Number(c.req.query("limit") ?? 200), off(c))));
  app.post("/api/nudges/:id/feedback", async (c) => {
    const { helpful } = await c.req.json<{ helpful: boolean }>();
    setNudgeFeedback(c.req.param("id"), !!helpful);
    return c.json({ ok: true });
  });
  // ---- ask-your-network polling ----
  app.get("/api/polls", (c) => c.json(listPollDetails(Number(c.req.query("limit") ?? 100))));
  app.post("/api/polls", async (c) => {
    const { topic, question, initiatorMemberId, ttlMs } = await c.req.json<{
      topic: string;
      question: string;
      initiatorMemberId?: string | null;
      ttlMs?: number;
    }>();
    if (!question?.trim()) return c.json({ error: "question required" }, 400);
    const poll = await startPoll({
      initiatorMemberId: initiatorMemberId ?? null,
      topic: topic?.trim() || question.trim().slice(0, 60),
      question: question.trim(),
      ttlMs,
    });
    return c.json(poll);
  });
  app.post("/api/polls/:id/cancel", (c) => {
    cancelPoll(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/api/polls/:id/synthesize", async (c) => {
    await synthesizePoll(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/nudges/:id/:action", (c) => {
    const action = c.req.param("action");
    const nid = c.req.param("id");
    if (action === "approve") {
      // Only a still-proposed nudge can be approved (PROA-8) — otherwise a repeated
      // click re-queues and re-delivers one that already went out.
      if (getNudge(nid)?.status !== "proposed") return c.json({ error: "not awaiting approval" }, 409);
      setNudgeStatus(nid, "queued");
      scheduleDelivery(nid); // holds for the undo window, then sends
    } else if (action === "undo") {
      return c.json({ ok: true, undone: undoNudge(nid) });
    } else if (action === "dismiss") {
      setNudgeStatus(nid, "dismissed");
    } else {
      return c.json({ error: "bad action" }, 400);
    }
    return c.json({ ok: true });
  });

  return app;
}

// Verify a bot token with the provider BEFORE we persist it, so an invalid token is
// never saved as a usable channel (and never offered to members). Returns a structured
// result the HTTP layer turns into an inline field error.
const DISCORD_INVITE_RE = /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([A-Za-z0-9-]+)/;

async function validateToken(channel: string, config: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string; field?: string }> {
  const token = typeof config["botToken"] === "string" ? (config["botToken"] as string).trim() : "";
  if (!token) return { ok: false, error: "Paste the bot token first.", field: "botToken" };
  try {
    if (channel === "telegram") {
      const me = (await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json())) as { ok?: boolean };
      if (!me?.ok) return { ok: false, error: "Telegram rejected that token. Copy a fresh one from @BotFather and try again.", field: "botToken" };
      return { ok: true };
    }
    if (channel === "discord") {
      const res = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bot ${token}` } });
      if (!res.ok) return { ok: false, error: "Discord rejected that token. Reset the token in the dev portal and paste the new one.", field: "botToken" };
      // members can only DM the bot if they share a server, so the operator must give a
      // server invite for them to join — validate it's a real, current invite.
      const invite = typeof config["serverInvite"] === "string" ? (config["serverInvite"] as string).trim() : "";
      const m = invite.match(DISCORD_INVITE_RE);
      if (!m) return { ok: false, error: "Add a server invite link (like discord.gg/abc123) so members can join and DM the bot.", field: "serverInvite" };
      try {
        const ir = await fetch(`https://discord.com/api/v10/invites/${m[1]}`);
        if (!ir.ok) return { ok: false, error: "That server invite is invalid or expired. Make one that never expires and paste it.", field: "serverInvite" };
      } catch { /* network hiccup — accept the well-formed invite rather than block */ }
      return { ok: true };
    }
    return { ok: false, error: "Unknown channel." };
  } catch {
    return { ok: false, error: "Couldn't reach the provider to verify. Check your connection and retry." };
  }
}

// Record how members reach a channel: Telegram's @username (from getMe), or for Discord
// the operator's server invite + the bot's name (so members join the server, then DM it).
async function captureChannelInfo(channel: string, config: Record<string, unknown>): Promise<void> {
  const token = typeof config["botToken"] === "string" ? (config["botToken"] as string) : "";
  if (channel === "telegram" && token) {
    try {
      const me = (await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json())) as {
        result?: { username?: string };
      };
      if (me.result?.username) setChannelInfo({ telegram: { username: me.result.username } });
    } catch {
      /* couldn't reach Telegram now — the token still works; link can be re-fetched */
    }
  } else if (channel === "discord" && token) {
    const invite = typeof config["serverInvite"] === "string" ? (config["serverInvite"] as string).trim() : "";
    if (!invite) return;
    let botName: string | undefined;
    try {
      const me = (await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bot ${token}` } }).then((r) => r.json())) as { username?: string };
      botName = me?.username;
    } catch { /* keep the invite even if we can't read the bot name */ }
    setChannelInfo({ discord: { inviteUrl: invite, botName } });
  }
}

function safeJson(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function beeTokenValid(beeId: string, token: string): boolean {
  // token must match THIS bee's stored token (set on first WS hello, TOFU per bee)
  return getSecret(`bee:${beeId}:token`) === token;
}
