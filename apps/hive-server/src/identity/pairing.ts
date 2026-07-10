import type { ChannelKind } from "@hive/shared";
import { findIdentity, memberForCode, linkIdentity, getMember } from "../db/repo.js";

export interface IdentityResult {
  known: boolean;
  memberId?: string;
  memberName?: string;
  channelIdentityId?: string;
}

export function checkIdentity(channel: ChannelKind, externalId: string): IdentityResult {
  const ci = findIdentity(channel, externalId);
  if (!ci) return { known: false };
  const m = getMember(ci.memberId);
  return { known: true, memberId: ci.memberId, memberName: m?.name, channelIdentityId: ci.id };
}

export interface PairResult {
  ok: boolean;
  memberId?: string;
  memberName?: string;
  channelIdentityId?: string;
  error?: string;
}

export function attemptPair(
  channel: ChannelKind,
  externalId: string,
  displayName: string | null,
  code: string,
  beeId: string | null,
): PairResult {
  const memberId = memberForCode(code);
  if (!memberId) return { ok: false, error: "invalid or expired code" };
  const ci = linkIdentity(memberId, channel, externalId, displayName, beeId);
  const m = getMember(memberId);
  return { ok: true, memberId, memberName: m?.name, channelIdentityId: ci.id };
}
