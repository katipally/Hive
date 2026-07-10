import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer, type WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { id } from "@hive/shared";
import type { ChannelAdapter, InboundMessage, ReplySink } from "./types.js";
import { Bee } from "../bee.js";
import { saveConfig, type BeeConfig, type BeeInstanceConfig } from "../config.js";
import { sessionTurns } from "../sessions.js";

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

  attach(ws: WebSocket, externalId: string): void {
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
      };
      this.onMessage?.(
        { channel: "web", externalId, displayName: null, text: m.text, ts: Date.now() },
        sink,
      );
    });
  }

  async send(externalId: string, text: string): Promise<void> {
    const set = this.conns.get(externalId);
    if (!set || set.size === 0) throw new Error("web client offline");
    for (const ws of set) ws.send(JSON.stringify({ type: "nudge", text }));
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
  app.get("/api/bees", (c) =>
    c.json([...bees.values()].map((b) => ({ beeId: b.instance.beeId, name: b.instance.name }))),
  );
  app.post("/api/bees", async (c) => {
    const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
    const nm = name?.trim() || `bee-${bees.size + 1}`;
    return c.json(addBee(nm));
  });
  // Server-backed chat history for the web client (persists across devices).
  app.get("/api/history", (c) => {
    const bee = c.req.query("bee") ?? "";
    const uid = c.req.query("uid") ?? "";
    if (!bee || !uid) return c.json([]);
    return c.json(sessionTurns(bee, `web:${uid}`));
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
    const wc = webChannels.get(beeId);
    if (!wc || !uid) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wc.attach(ws, uid));
  });
}
