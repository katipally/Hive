import WebSocket from "ws";
import { id } from "@hive/shared";
import type { BeeToHive, HiveToBee, ChannelKind, ContextBlock } from "@hive/shared";
import type { BeeInstanceConfig } from "./config.js";

export interface LinkHandlers {
  onNudge(nudge: Extract<HiveToBee, { type: "nudge.deliver" }>): void;
  onChannelConfig(channel: ChannelKind, config: Record<string, unknown>): void;
  onIdentityRevoked(channelIdentityId: string): void;
}

type Pending = { resolve: (msg: HiveToBee) => void; reject: (e: Error) => void };

export class HiveLink {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private outbox: BeeToHive[] = []; // queued while offline (ingest turns etc.)
  private connected = false;
  private backoff = 500;

  constructor(
    private readonly instance: BeeInstanceConfig,
    private readonly url: string,
    private readonly handlers: LinkHandlers,
  ) {}

  start(): void {
    this.open();
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
      // flush queued messages
      const queued = this.outbox.splice(0);
      for (const m of queued) this.raw(m);
    });
    ws.on("message", (data) => this.onMessage(data.toString()));
    ws.on("close", () => {
      this.connected = false;
      this.ws = null;
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

  private raw(msg: BeeToHive): void {
    if (this.connected && this.ws) this.ws.send(JSON.stringify(msg));
    else this.outbox.push(msg);
  }

  private request<T extends HiveToBee>(
    build: (reqId: string) => BeeToHive,
    timeoutMs = 15_000,
  ): Promise<T> {
    const reqId = id("req");
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (m: HiveToBee) => void, reject });
      const to = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error("hive request timeout"));
      }, timeoutMs);
      const wrap = (m: HiveToBee) => {
        clearTimeout(to);
        resolve(m as T);
      };
      this.pending.set(reqId, { resolve: wrap, reject });
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

  ingestTurn(t: Omit<Extract<BeeToHive, { type: "ingest.turn" }>, "type">): void {
    this.raw({ type: "ingest.turn", ...t });
  }

  nudgeResult(nudgeId: string, status: "delivered" | "failed", error?: string): void {
    this.raw({ type: "nudge.result", nudgeId, status, error });
  }
}
