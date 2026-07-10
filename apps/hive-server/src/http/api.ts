import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  createMember,
  listMembers,
  getMember,
  updateMember,
  createPairingCode,
  listIdentities,
} from "../db/repo.js";
import { beeOnline, listBees, sendToBee } from "../ws/bee-hub.js";
import { recentActivity } from "../activity.js";
import { putSecret, last4, hasSecret, deleteSecret, getSecret } from "../crypto/keystore.js";
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
} from "../settings/settings.js";
import { PROVIDERS, PROVIDER_IDS, listModels, streamByFamily } from "@hive/shared/llm";
import { isMock, mockComplete } from "../llm/mock.js";
import type { Message, ProviderId, ThinkingLevel } from "@hive/shared/llm";
import type { ModelRole } from "@hive/shared";
import { readGraph, inspectEntity } from "../graph/read.js";
import { deleteMemory, deleteEntity, forgetLastMemory } from "../graph/write.js";
import { sharedInterests } from "../graph/social.js";
import { runOrchestrator } from "../proactive/orchestrator.js";
import { sendDigest } from "../proactive/digest.js";
import { getDb } from "../db/db.js";
import { broadcastDash } from "../ws/dash-hub.js";
import { listDisclosures, disclosuresFromMember } from "../disclosure/store.js";
import { listNudges, setNudgeStatus, setNudgeFeedback } from "../proactive/store.js";
import { deliverNudgeById } from "../proactive/nudges.js";

export function buildApi(version: string): Hono {
  const app = new Hono();
  app.use("*", cors());

  app.get("/api/health", (c) => c.json({ ok: true, version }));

  // ---- members ----
  app.get("/api/members", (c) =>
    c.json(
      listMembers().map((m) => ({
        ...m,
        code: createPairingCode(m.id),
        identities: listIdentities(m.id).map((ci) => ({
          ...ci,
          beeOnline: ci.beeId ? beeOnline(ci.beeId) : false,
        })),
      })),
    ),
  );
  app.post("/api/members", async (c) => {
    const { name, timezone } = await c.req.json<{ name: string; timezone?: string }>();
    if (!name?.trim()) return c.json({ error: "name required" }, 400);
    const m = createMember(name.trim(), timezone);
    return c.json({ ...m, code: createPairingCode(m.id) });
  });
  app.patch("/api/members/:id", async (c) => {
    const body = await c.req.json();
    const m = updateMember(c.req.param("id"), body);
    return m ? c.json(m) : c.json({ error: "not found" }, 404);
  });
  app.get("/api/members/:id/code", (c) => {
    const m = getMember(c.req.param("id"));
    return m ? c.json({ code: createPairingCode(m.id) }) : c.json({ error: "not found" }, 404);
  });

  // ---- bees & channel config ----
  app.get("/api/bees", (c) => c.json(listBees()));
  app.put("/api/bees/:beeId/channels/:channel", async (c) => {
    const beeId = c.req.param("beeId");
    const channel = c.req.param("channel");
    if (!["telegram", "discord", "imessage"].includes(channel)) return c.json({ error: "bad channel" }, 400);
    const config = await c.req.json<Record<string, unknown>>();
    putSecret(`bee:${beeId}:channel:${channel}`, JSON.stringify(config));
    const pushed = sendToBee(beeId, { type: "channel.config", channel: channel as never, config });
    return c.json({ ok: true, pushed });
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
    if (!token || !beeTokenValid(token)) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json<{
      role: ModelRole;
      system?: string;
      messages: Message[];
      thinkingLevel?: ThinkingLevel;
    }>();
    if (isMock()) {
      return streamSSE(c, async (stream) => {
        const text = mockComplete(body.role ?? "chat", body.system, body.messages);
        await stream.writeSSE({ data: JSON.stringify({ type: "text_delta", text }) });
        await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
      });
    }
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
          thinkingLevel: body.thinkingLevel ?? resolved.thinkingLevel,
        })) {
          await stream.writeSSE({ data: JSON.stringify(ev) });
        }
      } catch (e) {
        await stream.writeSSE({ data: JSON.stringify({ type: "error", error: (e as Error).message }) });
      }
    });
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
  app.get("/api/members/:id/memories", (c) => {
    const rows = getDb()
      .db.prepare("SELECT id,kind,text,salience,created_at FROM memories WHERE member_id=? ORDER BY created_at DESC")
      .all(c.req.param("id"));
    return c.json(rows);
  });
  app.get("/api/members/:id/shared", (c) => c.json(disclosuresFromMember(c.req.param("id"))));
  app.get("/api/members/:id/privacy", (c) => c.json({ text: getPrivacyPref(c.req.param("id")) }));
  app.put("/api/members/:id/privacy", async (c) => {
    const { text } = await c.req.json<{ text: string }>();
    setPrivacyPref(c.req.param("id"), text ?? "");
    return c.json({ ok: true });
  });

  // ---- onboarding status ----
  app.get("/api/status", (c) => {
    const db = getDb().db;
    const anyKey = getSecretsByPrefix("provider:").length > 0;
    const roles = getModelRoles();
    const rolesConfigured = ["chat", "extraction", "social", "embeddings"].every((r) => (roles as Record<string, unknown>)[r]);
    const memberCount = (db.prepare("SELECT COUNT(*) c FROM members").get() as { c: number }).c;
    const linkedCount = (db.prepare("SELECT COUNT(DISTINCT member_id) c FROM channel_identities").get() as { c: number }).c;
    return c.json({ anyKey, rolesConfigured, memberCount, linkedCount });
  });
  app.get("/api/stats", (c) => {
    const db = getDb().db;
    const one = (q: string) => (db.prepare(q).get() as { c: number }).c;
    return c.json({
      members: one("SELECT COUNT(*) c FROM members"),
      memories: one("SELECT COUNT(*) c FROM memories"),
      entities: one("SELECT COUNT(*) c FROM entities"),
      edges: one("SELECT COUNT(*) c FROM edges WHERE invalidated_at IS NULL"),
      nudgesSent: one("SELECT COUNT(*) c FROM nudges WHERE status='sent'"),
      disclosures: one("SELECT COUNT(*) c FROM disclosures"),
    });
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
  app.get("/api/activity", (c) => c.json(recentActivity(Number(c.req.query("limit") ?? 100))));
  app.get("/api/disclosures", (c) => c.json(listDisclosures(Number(c.req.query("limit") ?? 200))));
  app.get("/api/nudges", (c) => c.json(listNudges(Number(c.req.query("limit") ?? 200))));
  app.post("/api/nudges/:id/feedback", async (c) => {
    const { helpful } = await c.req.json<{ helpful: boolean }>();
    setNudgeFeedback(c.req.param("id"), !!helpful);
    return c.json({ ok: true });
  });
  app.post("/api/nudges/:id/:action", async (c) => {
    const action = c.req.param("action");
    const nid = c.req.param("id");
    if (action !== "approve" && action !== "dismiss") return c.json({ error: "bad action" }, 400);
    if (action === "approve") {
      setNudgeStatus(nid, "queued");
      await deliverNudgeById(nid);
    } else {
      setNudgeStatus(nid, "dismissed");
    }
    return c.json({ ok: true });
  });

  return app;
}

function beeTokenValid(token: string): boolean {
  // any registered bee token matches (localhost trust domain)
  const rows = getSecretsByPrefix("bee:");
  return rows.some((v) => v === token);
}

// small helper: read all bee token secrets
function getSecretsByPrefix(prefix: string): string[] {
  const names = (
    getDb().db.prepare("SELECT name FROM secrets WHERE name LIKE ?").all(`${prefix}%`) as {
      name: string;
    }[]
  ).map((r) => r.name);
  return names.map((n) => getSecret(n)).filter((v): v is string => !!v);
}
