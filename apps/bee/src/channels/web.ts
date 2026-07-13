import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer, type WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { id } from "@hive/shared";
import type { ChannelAdapter, InboundMessage, ReplySink } from "./types.js";
import { Bee } from "../bee.js";
import { saveConfig, dataDir, type BeeConfig, type BeeInstanceConfig } from "../config.js";
import { displayTurns, deleteDisplay, listSessionTags } from "../sessions.js";

// Web channel: bee-ui connects over WS. externalId = a client-persisted uid.
export class WebChannel implements ChannelAdapter {
  readonly kind = "web" as const;
  private conns = new Map<string, Set<WebSocket>>(); // externalId -> sockets
  private onMessage?: (msg: InboundMessage, sink: ReplySink) => void;

  async start(onMessage: (msg: InboundMessage, sink: ReplySink) => void): Promise<void> {
    this.onMessage = onMessage;
  }
  async stop(): Promise<void> {
    for (const set of this.conns.values()) for (const ws of set) ws.close();
    this.conns.clear();
  }

  attach(ws: WebSocket, externalId: string, sessionTag?: string): void {
    if (!this.conns.has(externalId)) this.conns.set(externalId, new Set());
    this.conns.get(externalId)!.add(ws);
    ws.on("close", () => this.conns.get(externalId)?.delete(ws));
    ws.on("message", (raw) => {
      let m: { type: string; text?: string };
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.type !== "msg" || !m.text) return;
      const sink: ReplySink = {
        delta: (text) => ws.send(JSON.stringify({ type: "delta", text })),
        done: (text) => ws.send(JSON.stringify({ type: "done", text })),
        notice: (text) => ws.send(JSON.stringify({ type: "notice", text })),
        reset: () => ws.send(JSON.stringify({ type: "reset" })),
      };
      this.onMessage?.(
        { channel: "web", externalId, displayName: null, text: m.text, ts: Date.now(), sessionTag },
        sink,
      );
    });
  }

  async send(externalId: string, text: string, session?: string): Promise<void> {
    const set = this.conns.get(externalId);
    if (!set || set.size === 0) throw new Error("web client offline");
    // Broadcast to all of the member's open tabs, carrying the target thread. The tab
    // viewing that thread renders it inline; other tabs use it as a "your bee reached out"
    // signal (and refresh their thread list to surface a new one).
    for (const ws of set) ws.send(JSON.stringify({ type: "nudge", text, session: session ?? "main" }));
  }

  health() {
    return { ok: true, detail: `${this.conns.size} web clients` };
  }
}

export function startWebServer(cfg: BeeConfig, bees: Map<string, Bee>): void {
  const webChannels = new Map<string, WebChannel>();
  for (const [beeId, bee] of bees) {
    const wc = new WebChannel();
    webChannels.set(beeId, wc);
    bee.registerAdapter(wc);
  }

  // Spin up a brand-new bee at runtime: mint id+token, persist to config, wire
  // its web channel, and start it. It appears in /api/bees immediately.
  function addBee(name: string): { beeId: string; name: string } {
    const inst: BeeInstanceConfig = {
      beeId: id("bee"),
      beeToken: randomBytes(16).toString("hex"),
      name,
      channels: { web: { enabled: true } },
    };
    cfg.instances.push(inst);
    saveConfig(cfg);
    const bee = new Bee(inst, cfg);
    bees.set(inst.beeId, bee);
    const wc = new WebChannel();
    webChannels.set(inst.beeId, wc);
    bee.registerAdapter(wc);
    bee.start();
    return { beeId: inst.beeId, name: inst.name };
  }

  const app = new Hono();
  app.use("*", cors());
  // primary = the default "me" bee (first instance). The web UI shows the primary plus the
  // profiles THIS browser has paired locally, so a fresh browser doesn't list every member's
  // bee that happens to live on this shared runtime.
  app.get("/api/bees", (c) =>
    c.json(
      [...bees.values()].map((b) => ({
        beeId: b.instance.beeId,
        name: b.instance.name,
        primary: b.instance.beeId === cfg.instances[0]?.beeId,
      })),
    ),
  );
  // Which bee a code's member already has a web identity on (passthrough from the hive), so
  // pairing the same member from another browser reuses that bee — and its history.
  app.get("/api/bee-for-code", async (c) => {
    const code = c.req.query("code") ?? "";
    const info = await fetch(`${cfg.hiveHttpUrl}/api/member-bee?code=${encodeURIComponent(code)}`)
      .then((x) => x.json())
      .catch(() => ({ beeId: null }));
    return c.json(info as { beeId: string | null });
  });
  // The server-side roster of members + the bee each is hosted on. The web UI hydrates its
  // profile list from this (not browser storage), so every browser shows the same members
  // and their conversations. Only members already paired on a bee that exists here are listed.
  app.get("/api/roster", async (c) => {
    const members = (await fetch(`${cfg.hiveHttpUrl}/api/members`).then((x) => x.json()).catch(() => [])) as {
      name: string;
      code: string;
      identities: { channel: string; beeId: string | null }[];
    }[];
    const have = new Set([...bees.keys()]);
    const roster = members
      .map((m) => {
        const web = (m.identities ?? []).find((i) => i.channel === "web" && i.beeId);
        return web?.beeId && have.has(web.beeId) ? { beeId: web.beeId, name: m.name, code: m.code } : null;
      })
      .filter((r): r is { beeId: string; name: string; code: string } => r !== null);
    return c.json(roster);
  });
  app.post("/api/bees", async (c) => {
    const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
    const nm = name?.trim() || `bee-${bees.size + 1}`;
    return c.json(addBee(nm));
  });
  // Remove a profile for good: stop the Bee + its adapters, drop it from config,
  // and delete its on-disk sessions. Always keep at least one profile.
  app.delete("/api/bees/:beeId", async (c) => {
    const beeId = c.req.param("beeId");
    const bee = bees.get(beeId);
    if (!bee) return c.json({ error: "unknown profile" }, 404);
    if (bees.size <= 1) return c.json({ error: "can't remove your only profile" }, 400);
    await bee.stop();
    bees.delete(beeId);
    webChannels.delete(beeId);
    const idx = cfg.instances.findIndex((i) => i.beeId === beeId);
    if (idx >= 0) cfg.instances.splice(idx, 1);
    saveConfig(cfg);
    rmSync(join(dataDir(), "sessions", beeId), { recursive: true, force: true });
    return c.json({ ok: true });
  });
  // ---- "reach your bee elsewhere" (read-only; bots are set up by the operator) ----
  // Live channel health (used by the operator dashboard's verify).
  app.get("/api/channels", (c) => {
    const bee = bees.get(c.req.query("bee") ?? "");
    if (!bee) return c.json({ error: "unknown bee" }, 404);
    return c.json(bee.channelHealth());
  });
  // Public join addresses (bot links) — passthrough from the hive.
  app.get("/api/channel-info", async (c) => {
    const info = await fetch(`${cfg.hiveHttpUrl}/api/channel-info`).then((x) => x.json()).catch(() => ({}));
    return c.json(info as Record<string, unknown>);
  });
  // This web member's own invite code, so the guide can show "send this to link".
  app.get("/api/my-code", async (c) => {
    const beeId = c.req.query("bee") ?? "";
    const bee = bees.get(beeId);
    if (!bee) return c.json({});
    return c.json(await bee.webMemberCode(c.req.query("uid") ?? ""));
  });
  // Link a web profile to a member by invite code (the "+ add profile" flow). Returns
  // the member name so the UI can name the profile; errors surface inline.
  app.post("/api/pair", async (c) => {
    const { bee: beeId, uid, code } = await c.req.json<{ bee?: string; uid?: string; code?: string }>();
    const bee = bees.get(beeId ?? "");
    if (!bee) return c.json({ ok: false, error: "unknown bee" }, 404);
    if (!uid || !code) return c.json({ ok: false, error: "Paste your invite code." }, 400);
    const r = await bee.pairWeb(uid, code.trim().toUpperCase());
    return c.json(r, r.ok ? 200 : 400);
  });
  // Which channels this web member has already linked — drives the "connected here"
  // badges. Resolves the member via their own code, then passes through to the hive.
  app.get("/api/my-channels", async (c) => {
    const beeId = c.req.query("bee") ?? "";
    const bee = bees.get(beeId);
    const fallback = { web: true, telegram: false, discord: false };
    if (!bee) return c.json(fallback);
    const { code } = (await bee.webMemberCode(c.req.query("uid") ?? "")) as { code?: string };
    if (!code) return c.json(fallback);
    const info = await fetch(`${cfg.hiveHttpUrl}/api/member-channels?code=${encodeURIComponent(code)}`)
      .then((x) => x.json())
      .catch(() => fallback);
    return c.json(info as Record<string, unknown>);
  });
  // The conversation threads that exist for this bee (so the client lists every
  // seeded/prior session, not just ones created in this browser).
  app.get("/api/sessions", async (c) => {
    const beeId = c.req.query("bee") ?? "";
    const bee = bees.get(beeId);
    if (!bee) return c.json([]);
    // scope to the member this uid is paired to, so one bee's shared thread list
    // doesn't leak other members' threads into this person's sidebar.
    const uid = c.req.query("uid") ?? "";
    const memberId = uid ? await bee.webMemberId(uid) : null;
    return c.json(
      listSessionTags(beeId, memberId ?? undefined).map((tag) => ({
        id: tag,
        // the proactive reach-out thread (where the bee messages an idle member) gets a
        // friendly name; normal threads prettify their tag. "hive-*" kept for back-compat.
        title: tag === "hive" || tag.startsWith("hive-") ? "From your bee" : tag.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
      })),
    );
  });

  // Server-backed chat history (incl. nudges/polls) for the web client. Reads the
  // member's unified display transcript so proactive messages survive a refresh.
  app.get("/api/history", async (c) => {
    const beeId = c.req.query("bee") ?? "";
    const uid = c.req.query("uid") ?? "";
    const session = c.req.query("session") || "main";
    const bee = bees.get(beeId);
    if (!bee || !uid) return c.json([]);
    const sid = await bee.sessionForMember("web", uid, session);
    if (!sid) return c.json([]);
    return c.json(displayTurns(beeId, sid));
  });
  // Delete a single conversation thread's server-side transcript (display + LLM
  // session + compaction) so the reset is real, not just local.
  app.delete("/api/history", async (c) => {
    const beeId = c.req.query("bee") ?? "";
    const uid = c.req.query("uid") ?? "";
    const session = c.req.query("session") || "main";
    const bee = bees.get(beeId);
    if (!bee || !uid) return c.json({ ok: false }, 400);
    const sid = await bee.sessionForMember("web", uid, session);
    if (sid) deleteDisplay(beeId, sid);
    return c.json({ ok: true });
  });
  app.get("/api/health", (c) => c.json({ ok: true }));

  const server = serve({ fetch: app.fetch, port: cfg.webPort });
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/ws/chat") {
      socket.destroy();
      return;
    }
    const beeId = url.searchParams.get("bee") ?? "";
    const uid = url.searchParams.get("uid") ?? "";
    const session = url.searchParams.get("session") ?? undefined;
    const wc = webChannels.get(beeId);
    if (!wc || !uid) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wc.attach(ws, uid, session));
  });
}
