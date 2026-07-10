// Deterministic mock LLM for smoke tests (HIVE_MOCK_LLM=1). It embodies
// sensible model behavior so tests verify the pipeline plumbing, not a real model.
import type { Message } from "@hive/shared/llm";
import type { ModelRole } from "@hive/shared";

export function isMock(): boolean {
  return process.env["HIVE_MOCK_LLM"] === "1";
}

export const MOCK_DIM = 64;

// Bag-of-words hashed embedding: similar texts share tokens -> similar vectors.
export function mockEmbed(texts: string[]): number[][] {
  return texts.map((t) => {
    const v = new Array(MOCK_DIM).fill(0);
    for (const tok of tokenize(t)) v[hash(tok) % MOCK_DIM] += 1;
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  });
}

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const SECRET = /surprise|secret|don'?t tell|budget|\bgift\b|keep.*quiet|planning a/i;

export function mockComplete(role: ModelRole, system: string | undefined, messages: Message[]): string {
  const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");

  if ((system ?? "").includes("extract durable knowledge")) return JSON.stringify(mockExtract(user));
  if ((system ?? "").includes("privacy conscience")) return JSON.stringify(mockDisclosure(user));
  if ((system ?? "").includes("worth proactively telling")) return JSON.stringify(mockImplications(user));
  if ((system ?? "").includes("higher-order conclusions")) return JSON.stringify(mockConclude(user));
  if ((system ?? "").includes("worth messaging them about RIGHT NOW")) return JSON.stringify({ worthIt: false, reason: "quiet", topic: "none", about: "self" });
  if ((system ?? "").includes("out-of-the-blue message")) return mockCompose(user);
  // default chat reply
  return "Got it! " + (user.split("\n").pop() ?? "");
}

function memberName(user: string): string {
  const m = user.match(/Member:\s*([A-Za-z]+)/);
  return m?.[1] ?? "They";
}

function mockExtract(user: string): unknown {
  const conv = user.split("Recent conversation to extract from:")[1] ?? user;
  const name = memberName(user);
  const memories: unknown[] = [];
  const entities: unknown[] = [];
  const relations: unknown[] = [];
  const line = (rel: string, dst: string, conf = 0.85) => relations.push({ src: name, rel, dst, confidence: conf, validFrom: null });
  const ent = (n: string, t: string) => entities.push({ name: n, type: t });

  for (const raw of conv.split("\n")) {
    const s = raw.replace(/^(user|assistant):\s*/i, "").trim();
    if (!s || /^assistant:/i.test(raw)) continue;
    let mMoved = s.match(/moved to ([A-Z][a-z]+)/);
    if (mMoved) { ent(mMoved[1]!, "place"); line("lives_in", mMoved[1]!, 0.9); memories.push({ text: `${name} moved to ${mMoved[1]}`, kind: "raw", salience: 0.8 }); }
    let mWork = s.match(/works? at (?:a )?(?:startup )?(?:called )?([A-Z][A-Za-z]+)/);
    if (mWork) { ent(mWork[1]!, "org"); line("works_at", mWork[1]!, 0.9); memories.push({ text: `${name} works at ${mWork[1]}`, kind: "raw", salience: 0.8 }); }
    let mBday = s.match(/birthday is (?:on )?([A-Z][a-z]+ \d+)/);
    if (mBday) { line("birthday_on", mBday[1]!, 0.95); memories.push({ text: `${name}'s birthday is ${mBday[1]}`, kind: "raw", salience: 0.9 }); }
    let mEngaged = s.match(/engaged(?: to ([A-Z][a-z]+))?/);
    if (mEngaged) { if (mEngaged[1]) { ent(mEngaged[1]!, "person"); line("engaged_to", mEngaged[1]!, 0.95); } memories.push({ text: `${name} just got engaged${mEngaged[1] ? ` to ${mEngaged[1]}` : ""}`, kind: "raw", salience: 0.95 }); }
    let mParty = s.match(/surprise (?:birthday )?party for ([A-Z][a-z]+)/i);
    if (mParty) memories.push({ text: `${name} is planning a surprise party for ${mParty[1]} (secret, do not tell ${mParty[1]})`, kind: "raw", salience: 0.9 });
    let mDog = s.match(/(?:dog|cat) named ([A-Z][a-z]+)/);
    if (mDog) { ent(mDog[1]!, "thing"); line("owns", mDog[1]!, 0.9); memories.push({ text: `${name} has a pet named ${mDog[1]}`, kind: "raw", salience: 0.6 }); }
    let mFriend = s.match(/friend ([A-Z][a-z]+)/);
    if (mFriend) { ent(mFriend[1]!, "person"); relations.push({ src: mFriend[1], rel: "friends_with", dst: name, confidence: 0.8, validFrom: null }); }
  }
  return { memories, entities, relations, invalidations: [] };
}

function mockDisclosure(user: string): unknown {
  // items listed as "1. ...", "2. ..."
  const items = user.split("\n").filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s/, ""));
  const safe = items.filter((i) => !SECRET.test(i));
  const secret = items.filter((i) => SECRET.test(i));
  if (safe.length === 0) return { decision: "withhold", disclosed: null, withheld: summarize(secret), reasoning: "All of it is sensitive or a surprise." };
  if (secret.length === 0) return { decision: "share", disclosed: safe.join("; "), withheld: null, reasoning: "None of it is sensitive." };
  return { decision: "partial", disclosed: safe.join("; "), withheld: summarize(secret), reasoning: "Shared the harmless facts, held back the surprise/sensitive parts." };
}
function summarize(items: string[]): string {
  return items.length ? items.map((i) => i.slice(0, 40)).join("; ") : "sensitive details";
}

function mockImplications(user: string): unknown {
  const others = (user.match(/could be nudged: (.+)/)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const facts = user.toLowerCase();
  const nudges: unknown[] = [];
  if (/engaged|birthday|new job|moving|moved/.test(facts)) {
    for (const r of others) {
      if (r === "(none)") continue;
      nudges.push({ recipient: r, reason: `Something notable is happening with their friend — worth reaching out.`, topic: "life_event" });
    }
  }
  return { nudges };
}

function mockConclude(user: string): unknown {
  const name = memberName(user);
  return { conclusions: [{ text: `${name} is actively building a settled, social life.`, salience: 0.6 }] };
}

function mockCompose(user: string): string {
  const name = user.match(/Recipient:\s*([A-Za-z]+)/)?.[1] ?? "friend";
  return `Hey ${name}! Just thinking of you — something good is in the air, want to catch up soon? 🐝`;
}
