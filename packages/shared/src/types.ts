// Core domain types shared across hive-server, bee, and the UIs.

export type ChannelKind = "web" | "telegram" | "discord" | "imessage";

export type EntityType = "person" | "place" | "org" | "event" | "thing" | "topic";

export type MemoryKind = "raw" | "abstract" | "conclusion";

export type ModelRole = "chat" | "extraction" | "social" | "embeddings";

export interface Member {
  id: string;
  name: string;
  timezone: string;
  quietHoursStart: string | null; // 'HH:MM' local
  quietHoursEnd: string | null;
  preferredChannelIdentityId: string | null;
  lastHeartbeatAt: number | null;
  createdAt: number;
}

export interface ChannelIdentity {
  id: string;
  memberId: string;
  channel: ChannelKind;
  externalId: string;
  displayName: string | null;
  beeId: string | null;
  linkedAt: number;
}

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  attrs: Record<string, unknown>;
  memberId: string | null;
  createdAt: number;
}

export interface Memory {
  id: string;
  memberId: string;
  kind: MemoryKind;
  text: string;
  salience: number;
  sourceTurnId: string | null;
  provenance: string[];
  supersededBy: string | null;
  createdAt: number;
}

export interface Edge {
  id: string;
  srcEntityId: string;
  rel: string;
  dstEntityId: string;
  confidence: number;
  validFrom: number | null;
  validTo: number | null;
  sourceMemoryId: string | null;
  createdAt: number;
  invalidatedAt: number | null;
  invalidatedByMemoryId: string | null;
}

export type DisclosureDecision = "share" | "partial" | "withhold";
export type DisclosureContext = "chat" | "nudge";

export interface Disclosure {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  context: DisclosureContext;
  decision: DisclosureDecision;
  disclosed: string | null;
  withheld: string | null;
  reasoning: string;
  memoryIds: string[];
  createdAt: number;
}

export type NudgeKind = "event" | "heartbeat";
export type NudgeStatus =
  | "proposed"
  | "queued"
  | "sent"
  | "suppressed"
  | "dismissed"
  | "failed";

export interface Nudge {
  id: string;
  memberId: string;
  kind: NudgeKind;
  status: NudgeStatus;
  draft: string | null;
  reasoning: string;
  source: Record<string, unknown>;
  dedupKey: string;
  channelIdentityId: string | null;
  createdAt: number;
  sentAt: number | null;
  suppressReason: string | null;
  feedback?: number | null; // 1 = helpful, -1 = not helpful
}

export type ActivityType =
  | "extraction"
  | "conclusion"
  | "implication"
  | "disclosure"
  | "nudge"
  | "heartbeat_pass"
  | "error";

export interface ActivityEntry {
  id: string;
  ts: number;
  type: ActivityType;
  memberId: string | null;
  payload: Record<string, unknown>;
}

// 3D graph payload (react-force-graph-3d native shape).
export interface GraphNode {
  id: string;
  name: string;
  type: EntityType;
  memberId: string | null;
  val: number; // node size (salience/degree)
  group: string; // color group (entity type)
}

export interface GraphLink {
  source: string;
  target: string;
  rel: string;
  confidence: number;
  validFrom: number | null;
  validTo: number | null;
  invalidated: boolean;
  sourceMemoryId: string | null;
}

export interface GraphPayload {
  nodes: GraphNode[];
  links: GraphLink[];
}
