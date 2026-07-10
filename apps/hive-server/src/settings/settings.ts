import { getDb } from "../db/db.js";
import { getSecret } from "../crypto/keystore.js";
import { PROVIDERS, type ProviderId, type ThinkingLevel } from "@hive/shared/llm";
import type { ModelRole } from "@hive/shared";

export interface RoleConfig {
  provider: ProviderId;
  modelId: string;
  thinkingLevel?: ThinkingLevel;
  dim?: number; // embeddings only
}

export interface ProactiveConfig {
  heartbeatIntervalMin: number;
  cooldownHours: number;
  heartbeatMinGapHours: number;
  autoApprove: boolean;
}

const DEFAULT_PROACTIVE: ProactiveConfig = {
  heartbeatIntervalMin: 15,
  cooldownHours: 2,
  heartbeatMinGapHours: 24,
  autoApprove: true,
};

function getJson<T>(key: string, fallback: T): T {
  const row = getDb().db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

function setJson(key: string, value: unknown): void {
  getDb()
    .db.prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)")
    .run(key, JSON.stringify(value), Date.now());
}

export function getModelRoles(): Partial<Record<ModelRole, RoleConfig>> {
  return getJson("modelRoles", {});
}
export function setModelRole(role: ModelRole, cfg: RoleConfig): void {
  const roles = getModelRoles();
  roles[role] = cfg;
  setJson("modelRoles", roles);
}

export function getBaseUrls(): Partial<Record<ProviderId, string>> {
  return getJson("providerBaseUrls", {});
}
export function setBaseUrl(provider: ProviderId, url: string): void {
  const b = getBaseUrls();
  b[provider] = url;
  setJson("providerBaseUrls", b);
}

export function getProactive(): ProactiveConfig {
  return { ...DEFAULT_PROACTIVE, ...getJson<Partial<ProactiveConfig>>("proactive", {}) };
}
export function setProactive(cfg: Partial<ProactiveConfig>): void {
  setJson("proactive", { ...getProactive(), ...cfg });
}

export interface ResolvedRole {
  provider: ProviderId;
  family: (typeof PROVIDERS)[ProviderId]["api"];
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  thinkingLevel?: ThinkingLevel;
  dim?: number;
}

// Resolve a role to a concrete provider/model/key for making a call.
export function resolveRole(role: ModelRole): ResolvedRole {
  const cfg = getModelRoles()[role];
  if (!cfg) throw new Error(`no model configured for role '${role}'`);
  const spec = PROVIDERS[cfg.provider];
  const baseUrl = getBaseUrls()[cfg.provider] ?? spec.defaultBaseUrl;
  const apiKey = getSecret(`provider:${cfg.provider}`) ?? undefined;
  return {
    provider: cfg.provider,
    family: spec.api,
    baseUrl,
    apiKey,
    model: cfg.modelId,
    thinkingLevel: cfg.thinkingLevel,
    dim: cfg.dim,
  };
}

export function roleConfigured(role: ModelRole): boolean {
  return !!getModelRoles()[role];
}

// Per-member bee settings: persona/tone (fed into the bee's system prompt) and
// how proactive that member's bee is allowed to be.
export type Proactivity = "off" | "low" | "normal" | "high";
export interface BeeSettings {
  persona: string;
  proactivity: Proactivity;
}
const DEFAULT_BEE_SETTINGS: BeeSettings = { persona: "", proactivity: "normal" };

export function getBeeSettings(memberId: string): BeeSettings {
  return { ...DEFAULT_BEE_SETTINGS, ...getJson<Partial<BeeSettings>>(`bee:${memberId}`, {}) };
}
export function setBeeSettings(memberId: string, patch: Partial<BeeSettings>): void {
  setJson(`bee:${memberId}`, { ...getBeeSettings(memberId), ...patch });
}

// Per-member privacy preferences (free text the disclosure agent must honour).
export function getPrivacyPref(memberId: string): string {
  const row = getDb().db.prepare("SELECT value FROM settings WHERE key=?").get(`privacy:${memberId}`) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as string) : "";
}
export function setPrivacyPref(memberId: string, text: string): void {
  setJson(`privacy:${memberId}`, text);
}
