import { callRoleJson } from "../llm/call.js";
import { DISCLOSURE_SYSTEM, disclosureUser } from "../prompts/disclosure.js";
import { insertDisclosure } from "./store.js";
import { logActivity } from "../activity.js";
import { getMember } from "../db/repo.js";
import { getPrivacyPref } from "../settings/settings.js";
import type { DisclosureContext, DisclosureDecision } from "@hive/shared";

export interface DisclosureVerdict {
  decision: DisclosureDecision;
  disclosed: string | null;
  withheld: string | null;
  reasoning: string;
}

// Decide what one member's knowledge may be revealed to another. Always audited.
export async function decideDisclosure(opts: {
  toMemberId: string;
  fromMemberId: string;
  question: string;
  memories: { id: string; text: string }[];
  context: DisclosureContext;
}): Promise<DisclosureVerdict> {
  const to = getMember(opts.toMemberId);
  const from = getMember(opts.fromMemberId);
  const toName = to?.name ?? "the member";
  const fromName = from?.name ?? "another member";

  const pref = getPrivacyPref(opts.fromMemberId);
  let user = disclosureUser(toName, fromName, opts.question, opts.memories);
  if (pref.trim()) user += `\n\n${fromName} has set this privacy preference — you MUST honour it: "${pref.trim()}"`;

  let v: DisclosureVerdict;
  try {
    v = await callRoleJson<DisclosureVerdict>("social", {
      system: DISCLOSURE_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
  } catch (e) {
    // fail closed: withhold on error
    v = { decision: "withhold", disclosed: null, withheld: "all", reasoning: `disclosure agent error: ${(e as Error).message}` };
  }
  if (!["share", "partial", "withhold"].includes(v.decision)) v.decision = "withhold";
  if (v.decision === "withhold") v.disclosed = null;

  insertDisclosure({
    fromMemberId: opts.fromMemberId,
    toMemberId: opts.toMemberId,
    context: opts.context,
    decision: v.decision,
    disclosed: v.disclosed,
    withheld: v.withheld,
    reasoning: v.reasoning,
    memoryIds: opts.memories.map((m) => m.id),
  });
  logActivity("disclosure", opts.toMemberId, {
    summary: `${v.decision} from ${fromName} → ${toName}`,
    decision: v.decision,
    reasoning: v.reasoning,
  });
  return v;
}
