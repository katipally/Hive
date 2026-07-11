// Relation vocabulary. The extractor emits free-text relation verbs, so "lives_in",
// "resides_in", "based_in", "lives" all mean the same thing — but supersession and
// contradiction detection only work if they compare equal. We normalize every relation
// to a canonical verb at ingest, so a newer "resides_in" fact correctly supersedes an
// older "lives_in" one. ponytail: a hand-curated synonym map — extend as real data shows gaps.

const SYNONYMS: Record<string, string> = {
  // location (functional)
  lives_in: "lives_in",
  lives: "lives_in",
  living_in: "lives_in",
  resides_in: "lives_in",
  resides: "lives_in",
  based_in: "lives_in",
  located_in: "lives_in",
  location: "lives_in",
  from: "lives_in",
  moved_to: "lives_in",
  // employment (functional)
  works_at: "works_at",
  works_for: "works_at",
  employed_at: "works_at",
  employed_by: "works_at",
  job_at: "works_at",
  works: "works_at",
  employer: "works_at",
  // study (functional)
  studies_at: "studies_at",
  studied_at: "studies_at",
  student_at: "studies_at",
  attends: "studies_at",
  // relationships (functional)
  dating: "dating",
  dates: "dating",
  partner_of: "dating",
  seeing: "dating",
  married_to: "married_to",
  spouse_of: "married_to",
  wife_of: "married_to",
  husband_of: "married_to",
  birthday_on: "birthday_on",
  born_on: "birthday_on",
  // interests (non-functional — a person can have many)
  likes: "likes",
  loves: "likes",
  enjoys: "likes",
  into: "likes",
  fan_of: "likes",
  interested_in: "likes",
  passionate_about: "likes",
  wants: "wants",
  wants_to: "wants",
  wishes_to: "wants",
  planning_to: "wants",
  hopes_to: "wants",
  owns: "owns",
  has: "owns",
  knows: "knows",
  friend_of: "knows",
  friends_with: "knows",
  // dislikes (non-functional)
  dislikes: "dislikes",
  hates: "dislikes",
  not_into: "dislikes",
  // family (functional-ish; a person has one set, but we don't auto-supersede these)
  sibling_of: "sibling_of",
  brother_of: "sibling_of",
  sister_of: "sibling_of",
  parent_of: "parent_of",
  mother_of: "parent_of",
  father_of: "parent_of",
  child_of: "child_of",
  son_of: "child_of",
  daughter_of: "child_of",
  // skills / affiliations (non-functional)
  plays: "plays",
  practices: "plays",
  speaks: "speaks",
  member_of: "member_of",
  volunteers_at: "member_of",
  manages: "manages",
  allergic_to: "allergic_to",
};

// Relations where a newer fact supersedes the old (moved cities, changed jobs, etc.).
// Keyed on CANONICAL verbs so paraphrases all invalidate correctly.
const FUNCTIONAL = new Set(["lives_in", "works_at", "studies_at", "dating", "married_to", "birthday_on"]);

export function normalizeRel(rel: string): string {
  const key = rel.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return SYNONYMS[key] ?? key;
}

export function isFunctional(canonicalRel: string): boolean {
  return FUNCTIONAL.has(canonicalRel);
}
