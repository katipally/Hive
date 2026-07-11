import { getDb } from "../db/db.js";
import { getMember } from "../db/repo.js";
import { webSearch } from "../tools/search.js";
import { proposeCandidate } from "./nudges.js";
import { logActivity } from "../activity.js";

// Proactive errands: when a member expresses a want the hive could go find, it searches
// the web unprompted and — if it finds a lead — reaches out through the SAME nudge
// pipeline (cooldown/dedup/delivery). About-self, so no disclosure gate is involved.
// Search is keyless (no API key needed), so errands actually run in the demo.
//
// Cheap keyword gate first (no LLM, no search) so ordinary chatter costs nothing:
const WANT_RE =
  /\b(want(?:s|ed)?|looking for|trying to find|searching for|needs? (?:a|an|some)|wish(?:es|ed)? (?:i|they|he|she) had|would love (?:a|to find)|on the hunt for|can'?t find)\b/i;
// …but NOT when the want is negated ("doesn't want a dog", "no longer looking").
const NEG_RE = /\b(?:don'?t|do not|does\s?n'?t|did\s?n'?t|no longer|never|not)\s+(?:really\s+)?(?:want|need|looking|searching|wish)/i;

export async function runErrands(memberId: string, memoryIds: string[]): Promise<void> {
  const { db } = getDb();
  const member = getMember(memberId);
  if (!member) return;
  const SALIENCE_MIN = Number(process.env["HIVE_ERRAND_SALIENCE_MIN"] ?? 0.55);

  for (const mid of memoryIds) {
    const row = db.prepare("SELECT text, salience FROM memories WHERE id=?").get(mid) as
      | { text: string; salience: number }
      | undefined;
    if (!row || row.salience < SALIENCE_MIN) continue;
    // Search for the OBJECT of the want, not the whole third-person memory sentence, and
    // skip negated wants — "Bob is looking for a good cello teacher" → "good cello teacher";
    // "I don't want a dog" → null.
    const query = wantQuery(row.text);
    if (!query) continue;

    const res = await webSearch(query);
    if (res.error || res.results.length === 0) {
      logActivity("errand", memberId, { summary: res.error ? `search failed: ${res.error}` : `searched "${query}", found nothing`, count: 0 });
      continue;
    }
    const top = res.results[0]!;
    logActivity("errand", memberId, { summary: `found a lead for "${query}"`, count: res.results.length });
    // Hand the lead to the nudge composer (about-self, so no gate) so the message reads
    // like a friend who went and looked — not a templated "here's a link" line.
    await proposeCandidate({
      recipientMemberId: memberId,
      aboutMemberId: memberId,
      kind: "errand",
      reason: `${member.name} mentioned wanting ${query}. You went looking and found a lead: "${top.title}" — ${top.url}${top.snippet ? ` (${clip(top.snippet, 140)})` : ""}. Share it warmly in one or two sentences and include the link.`,
      topic: `errand:${slug(query)}`,
      sourceMemoryIds: [mid],
    });
  }
}

// The searchable object of an affirmative want, or null if there's no actionable (and
// non-negated) want. Exported for the self-check.
export function wantQuery(text: string): string | null {
  if (NEG_RE.test(text) || !WANT_RE.test(text)) return null;
  const m = WANT_RE.exec(text);
  if (!m) return null;
  let obj = text.slice(m.index + m[0].length).trim();
  obj = obj.replace(/^(a|an|some|to find|to buy|to get|to visit|for)\s+/i, "");
  obj = obj.split(/[.;\n]|,\s+(?:but|and then|because)\b/i)[0]!.trim();
  return obj.length >= 3 ? clip(obj, 100) : null;
}

function clip(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
