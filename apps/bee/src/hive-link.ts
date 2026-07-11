import WebSocket from "ws";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { id } from "@hive/shared";
import type { BeeToHive, HiveToBee, ChannelKind, ContextBlock } from "@hive/shared";
import type { BeeInstanceConfig } from "./config.js";
import { dataDir } from "./config.js";

export interface LinkHandlers {
  onNudge(nudge: Extract<HiveToBee, { type: "nudge.deliver" }>): void;
  onChannelConfig(channel: ChannelKind, config: Record<string, unknown>): void;
  onIdentityRevoked(channelIdentityId: string): void;
}

type Pending = { resolve: (msg: HiveToBee) => void; reject: (e: Error) => void };
type IngestTurn = Extract<BeeToHive, { type: "ingest.turn" }>;

// Turns pile up here while the hive is unreachable. Persisted so a bee restart
// doesn't drop the conversation from the hive's brain — this is the core promise.
// ponytail: 5000-turn cap (drop oldest); raise it if a bee can be offline for days.
const MAX_PENDING_TURNS = 5000;

export class HiveLink {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private outbox: BeeToHive[] = []; // transient queue for non-critical msgs (nudge.result) while offline
  private pendingTurns = new Map<string, IngestTurn>(); // durable: unacked ingest turns, keyed by turnId
  private connected = false;
  private backoff = 500;
  private stopped = false; // set by stop(): suppress the auto-reconnect loop

  constructor(
    private readonly instance: BeeInstanceConfig,
    private readonly url: string,
    private readonly handlers: LinkHandlers,
  ) {
    this.loadTurns();
  }

  start(): void {
    this.open();
  }

  // Tear down for good — used when a profile is deleted. Closes the socket and
  // suppresses the reconnect loop so the removed bee doesn't linger on the hive.
  stop(): void {
    this.stopped = true;
    this.connected = false;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on("open", () => {
      this.connected = true;
      this.backoff = 500;
      this.raw({
        type: "hello",
        beeId: this.instance.beeId,
        beeToken: this.instance.beeToken,
        version: "0.1.0",
        channels: Object.keys(this.instance.channels) as ChannelKind[],
      });
      // resend any turns the hive never acked (idempotent: hive INSERT-OR-IGNOREs by turnId),
      // then flush transient messages.
      for (const t of this.pendingTurns.values()) this.send(t);
      const queued = this.outbox.splice(0);
      for (const m of queued) this.raw(m);
    });
    ws.on("message", (data) => this.onMessage(data.toString()));
    ws.on("close", () => {
      this.connected = false;
      this.ws = null;
      if (this.stopped) return;
      setTimeout(() => this.open(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 15_000);
    });
    ws.on("error", () => ws.close());
  }

  private onMessage(text: string): void {
    let msg: HiveToBee;
    try {
      msg = JSON.parse(text) as HiveToBee;
    } catch {
      return;
    }
    // resolve pending request/response by reqId
    if ("reqId" in msg && this.pending.has(msg.reqId)) {
      this.pending.get(msg.reqId)!.resolve(msg);
      this.pending.delete(msg.reqId);
      return;
    }
    switch (msg.type) {
      case "ingest.ack":
        if (this.pendingTurns.delete(msg.turnId)) this.persistTurns();
        break;
      case "nudge.deliver":
        this.handlers.onNudge(msg);
        break;
      case "channel.config":
        this.handlers.onChannelConfig(msg.channel, msg.config);
        break;
      case "identity.revoked":
        this.handlers.onIdentityRevoked(msg.channelIdentityId);
        break;
      default:
        break;
    }
  }

  // send now if connected, else drop into the transient outbox (non-critical msgs only)
  private raw(msg: BeeToHive): void {
    if (this.connected && this.ws) this.ws.send(JSON.stringify(msg));
    else this.outbox.push(msg);
  }

  // send now if connected, else silently skip — used for durable turns whose queue
  // is pendingTurns (resent on reconnect), so they must NOT also land in outbox.
  private send(msg: BeeToHive): void {
    if (this.connected && this.ws) this.ws.send(JSON.stringify(msg));
  }

  private request<T extends HiveToBee>(
    build: (reqId: string) => BeeToHive,
    timeoutMs = 15_000,
  ): Promise<T> {
    const reqId = id("req");
    return new Promise<T>((resolve, reject) => {
      const to = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error("hive request timeout"));
      }, timeoutMs);
      this.pending.set(reqId, {
        resolve: (m: HiveToBee) => {
          clearTimeout(to);
          resolve(m as T);
        },
        reject,
      });
      this.raw(build(reqId));
    });
  }

  identityCheck(channel: ChannelKind, externalId: string) {
    return this.request<Extract<HiveToBee, { type: "identity.result" }>>((reqId) => ({
      type: "identity.check",
      reqId,
      channel,
      externalId,
    }));
  }

  pair(channel: ChannelKind, externalId: string, displayName: string | null, code: string) {
    return this.request<Extract<HiveToBee, { type: "pair.result" }>>((reqId) => ({
      type: "pair.attempt",
      reqId,
      channel,
      externalId,
      displayName,
      code,
    }));
  }

  async context(memberId: string, sessionId: string, text: string): Promise<ContextBlock[]> {
    const r = await this.request<Extract<HiveToBee, { type: "context.response" }>>((reqId) => ({
      type: "context.request",
      reqId,
      memberId,
      sessionId,
      text,
    }));
    return r.blocks;
  }

  // Durable: queue the turn, persist it, and try to send. It stays queued until the
  // hive acks it (ingest.ack), surviving reconnects and process restarts.
  ingestTurn(t: Omit<IngestTurn, "type">): void {
    const msg: IngestTurn = { type: "ingest.turn", ...t };
    this.pendingTurns.set(msg.turnId, msg);
    if (this.pendingTurns.size > MAX_PENDING_TURNS) {
      const oldest = this.pendingTurns.keys().next().value as string | undefined;
      if (oldest) this.pendingTurns.delete(oldest);
    }
    this.persistTurns();
    this.send(msg);
  }

  nudgeResult(nudgeId: string, status: "delivered" | "failed", error?: string): void {
    this.raw({ type: "nudge.result", nudgeId, status, error });
  }

  // ---- durable-outbox persistence ----
  private turnsPath(): string {
    return join(dataDir(), "outbox", `${this.instance.beeId}.json`);
  }
  private persistTurns(): void {
    const p = this.turnsPath();
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, JSON.stringify([...this.pendingTurns.values()]));
  }
  private loadTurns(): void {
    const p = this.turnsPath();
    if (!existsSync(p)) return;
    try {
      const arr = JSON.parse(readFileSync(p, "utf8")) as IngestTurn[];
      for (const t of arr) this.pendingTurns.set(t.turnId, t);
    } catch {
      // corrupt outbox file — start clean rather than crash the bee
    }
  }
}
