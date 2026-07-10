import type { ChannelKind } from "../types.js";

// Context block returned to a bee to inject into its reply.
export interface ContextBlock {
  kind: "memory" | "graph" | "disclosure-note";
  text: string;
  sourceIds: string[];
}

// ---- Bee -> Hive ----
export type BeeToHive =
  | { type: "hello"; beeId: string; beeToken: string; version: string; channels: ChannelKind[] }
  | { type: "identity.check"; reqId: string; channel: ChannelKind; externalId: string }
  | {
      type: "pair.attempt";
      reqId: string;
      channel: ChannelKind;
      externalId: string;
      displayName: string | null;
      code: string;
    }
  | { type: "context.request"; reqId: string; memberId: string; sessionId: string; text: string }
  | {
      type: "ingest.turn";
      turnId: string;
      memberId: string;
      channelIdentityId: string;
      sessionId: string;
      role: "user" | "assistant";
      content: string;
      ts: number;
    }
  | { type: "nudge.result"; nudgeId: string; status: "delivered" | "failed"; error?: string }
  | { type: "ping" };

// ---- Hive -> Bee ----
export type HiveToBee =
  | { type: "hello.ack"; ok: true; beeId: string; serverVersion: string }
  | { type: "hello.err"; error: string }
  | {
      type: "identity.result";
      reqId: string;
      known: boolean;
      memberId?: string;
      memberName?: string;
      channelIdentityId?: string;
    }
  | {
      type: "pair.result";
      reqId: string;
      ok: boolean;
      memberId?: string;
      memberName?: string;
      channelIdentityId?: string;
      error?: string;
    }
  | { type: "context.response"; reqId: string; blocks: ContextBlock[] }
  | { type: "ingest.ack"; turnId: string }
  | {
      type: "nudge.deliver";
      nudgeId: string;
      memberId: string;
      channelIdentityId: string;
      channel: ChannelKind;
      externalId: string;
      text: string;
    }
  | { type: "channel.config"; channel: ChannelKind; config: Record<string, unknown> }
  | { type: "identity.revoked"; channelIdentityId: string }
  | { type: "pong" };
