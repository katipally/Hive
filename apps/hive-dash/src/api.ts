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
