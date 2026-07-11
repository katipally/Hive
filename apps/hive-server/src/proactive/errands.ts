import { getDb } from "../db/db.js";
import { getMember } from "../db/repo.js";
import { webSearch } from "../tools/search.js";
import { proposeCandidate } from "./nudges.js";
import { logActivity } from "../activity.js";

// Proactive errands: when a member expresses a want the hive could go find, it
// searches the web unprompted and — if it finds a lead — reaches out through the
// SAME nudge pipeline (cooldown/dedup/delivery). Not a parallel system; an errand
// is just a NudgeKind. About-self, so no disclosure gate is involved.
//
// Cheap keyword gate first (no LLM, no search) so ordinary chatter costs nothing:
const WANT_RE =
  /\b(want|wanted|looking for|trying to find|searching for|need(?:s|ed)? (?:a|an|some)|wish i had|would love (?:a|to find)|on the hunt for|can'?t find)\b/i;

export async function runErrands(memberId: string, memoryIds: string[]): Promise<void> {
  const { db } = getDb();
  const member = getMember(memberId);
  if (!member) return;
  const SALIENCE_MIN = Number(process.env["HIVE_ERRAND_SALIENCE_MIN"] ?? 0.55);

  for (const mid of memoryIds) {
    const row = db.prepare("SELECT text, salience FROM memories WHERE id=?").get(mid) as
      | { text: string; salience: number }
      | undefined;
    if (!row || row.salience < SALIENCE_MIN || !WANT_RE.test(row.text)) continue;

    // ponytail: search the memory text verbatim as the query — crude but works; refine
    // to extract just the object of the want if results get noisy.
    const res = await webSearch(row.text);
    if (!res.configured) return; // search not set up — stop, don't retry this batch
    if (res.error || res.results.length === 0) {
      logActivity("errand", memberId, { summary: res.error ? `search failed: ${res.error}` : "searched, found nothing", count: 0 });
      continue;
    }
    const top = res.results[0]!;
    logActivity("errand", memberId, { summary: `found a lead for "${clip(row.text)}"`, count: res.results.length });
    await proposeCandidate({
      recipientMemberId: memberId,
      aboutMemberId: memberId, // about self → no cross-member disclosure gate
      kind: "errand",
      reason: `Found a lead for something ${member.name} wanted`,
      topic: `errand:${slug(row.text)}`,
      sourceMemoryIds: [mid],
      draft: `You mentioned "${clip(row.text)}" — I went looking and found something that might help: ${top.title} (${top.url})`,
    });
  }
}

function clip(s: string): string {
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
