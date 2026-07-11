export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export interface MemberRow {
  id: string;
  name: string;
  timezone: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  preferredChannelIdentityId: string | null;
  code: string;
  identities: {
    id: string;
    channel: string;
    externalId: string;
    displayName: string | null;
    beeId: string | null;
    beeOnline: boolean;
  }[];
}

export interface ChannelInfo {
  telegram?: { username: string };
  discord?: { inviteUrl: string };
  imessage?: { handle: string };
}

export interface BeeRow {
  beeId: string;
  online: boolean;
  primary: boolean; // the canonical hive bee that hosts the shared channel bots
  channels: string[]; // configured channel names (telegram/discord/imessage)
}

export interface PollAskRow {
  id: string;
  memberId: string;
  question: string;
  answer: string | null;
  deliveredAt: number | null;
  answeredAt: number | null;
}

export interface PollRow {
  id: string;
  initiatorMemberId: string | null;
  topic: string;
  question: string;
  status: "collecting" | "synthesizing" | "done" | "cancelled";
  anonymized: boolean;
  synthesis: string | null;
  closesAt: number | null;
  createdAt: number;
  asks: PollAskRow[];
}

export interface ProviderRow {
  id: string;
  label: string;
  api: string;
  defaultBaseUrl: string;
  baseUrl: string;
  needsKey: boolean;
  supportsEmbeddings: boolean;
  hasKey: boolean;
  keyLast4: string | null;
}

export interface ModelRow {
  id: string;
  provider: string;
  label?: string;
  contextLength?: number;
  supportsReasoning?: boolean;
  supportsTools?: boolean;
}

export interface SettingsData {
  modelRoles: Record<string, { provider: string; modelId: string; thinkingLevel?: string; dim?: number }>;
  baseUrls: Record<string, string>;
  proactive: {
    heartbeatIntervalMin: number;
    cooldownHours: number;
    heartbeatMinGapHours: number;
    autoApprove: boolean;
  };
}
