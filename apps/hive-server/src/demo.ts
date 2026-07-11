// Demo scenario + one-shot bootstrap for the hosted/public build.
//
// The scenario is chosen to show the two things that make Hive Hive:
//   1. Contextual-integrity disclosure — Bob & Cara are planning a SURPRISE party
//      for Alice. Her birthday (Aug 2) may be shared with them; the surprise must
//      never leak back to her.
//   2. Proactive connection — Alice and Bob both love the outdoors and both want
//      to go to Japan, a real introduction the orchestrator can surface.
import { createMember, createPairingCode, listMembers } from "./db/repo.js";
import { upsertEntity, insertMemory, insertEdge } from "./graph/write.js";
import { embedTexts, embeddingsConfigured } from "./llm/call.js";
import { hasSecret, putSecret } from "./crypto/keystore.js";
import { setModelRole, setBaseUrl, roleConfigured } from "./settings/settings.js";
import { runOrchestrator } from "./proactive/orchestrator.js";
import type { ModelRole } from "@hive/shared";

// Seed the demo friend group. Assumes the DB is already open. No-op if members
// already exist, so it's safe to call on every boot.
export async function seedDemo(): Promise<{ name: string; code: string }[]> {
  if (listMembers().length > 0) return listMembers().map((m) => ({ name: m.name, code: createPairingCode(m.id) }));

  const alice = createMember("Alice", "Europe/Berlin");
  const bob = createMember("Bob", "America/New_York");
  const cara = createMember("Cara", "Europe/London");
  // No placeholder identity here — the bee's demo auto-pair links each member to a
  // real web identity (`web-<name>`) with the live bee attached, so they show online.

  const facts: Record<string, string[]> = {
    [alice.id]: [
      "Alice lives in Munich",
      "Alice works at Acme as a designer",
      "Alice's birthday is August 2",
      "Alice loves rock climbing and being outdoors",
      "Alice has always wanted to visit Japan",
    ],
    [bob.id]: [
      "Bob lives in Brooklyn",
      "Bob is a photographer",
      "Bob loves hiking and the outdoors",
      "Bob is saving up for a trip to Japan this autumn",
      // the secret — owned by Bob, must be withheld from Alice
      "Bob is secretly planning a surprise birthday party for Alice on August 2",
    ],
    [cara.id]: [
      "Cara lives in London",
      "Cara runs a small bakery called Rise",
      "Cara and Alice met at university",
      "Cara plays the cello",
      // the secret — owned by Cara, must be withheld from Alice
      "Cara is helping Bob organise Alice's surprise party and is baking the cake",
    ],
  };

  const entity = (name: string, type: string, memberId: string | null = null) => upsertEntity(name, type, memberId);
  const aE = entity("Alice", "person", alice.id);
  const bE = entity("Bob", "person", bob.id);
  const cE = entity("Cara", "person", cara.id);

  for (const [memberId, texts] of Object.entries(facts)) {
    const embs = embeddingsConfigured() ? await embedTexts(texts).catch(() => []) : [];
    texts.forEach((t, i) =>
      insertMemory({ memberId, kind: "raw", text: t, salience: 0.7, sourceTurnId: null, embedding: embs[i] }),
    );
  }

  const rel = (src: string, r: string, dst: string) =>
    insertEdge({ srcEntityId: src, rel: r, dstEntityId: dst, confidence: 0.9, validFrom: null, sourceMemoryId: null });
  const japan = entity("Japan", "place");
  const outdoors = entity("the outdoors", "topic");
  rel(aE, "lives_in", entity("Munich", "place"));
  rel(aE, "works_at", entity("Acme", "org"));
  rel(aE, "likes", entity("rock climbing", "topic"));
  rel(aE, "likes", outdoors);
  rel(aE, "wants_to_visit", japan);
  rel(bE, "lives_in", entity("Brooklyn", "place"));
  rel(bE, "likes", entity("hiking", "topic"));
  rel(bE, "likes", outdoors);
  rel(bE, "planning", japan);
  rel(cE, "lives_in", entity("London", "place"));
  rel(cE, "works_at", entity("Rise", "org"));
  rel(cE, "friends_with", aE);
  rel(bE, "friends_with", aE);
  rel(cE, "likes", entity("cello", "topic"));

  return [alice, bob, cara].map((m) => ({ name: m.name, code: createPairingCode(m.id) }));
}

// One-shot boot bootstrap for the hosted demo (guarded by HIVE_DEMO). Bakes the
// provider key + model roles from env, seeds the scenario, and kicks one
// orchestrator pass so Disclosures/Proactive have content when the link is opened.
export async function bootstrapDemo(): Promise<void> {
  if (!process.env["HIVE_DEMO"]) return;

  const key = process.env["MINIMAX_API_KEY"];
  if (key && !hasSecret("provider:minimax")) {
    putSecret("provider:minimax", key);
    const base = process.env["HIVE_MINIMAX_BASE_URL"];
    if (base) setBaseUrl("minimax", base);
    const model = process.env["HIVE_DEMO_MODEL"] ?? "MiniMax-M2";
    for (const role of ["chat", "extraction", "social"] as ModelRole[]) {
      setModelRole(role, { provider: "minimax", modelId: model });
    }
    console.log(`[hive] demo: minimax key baked in, roles → ${model}`);
  }

  const members = await seedDemo();
  console.log(`[hive] demo: ${members.length} members ready (${members.map((m) => `${m.name} ${m.code}`).join(", ")})`);

  // fire-and-forget after boot so the first visit already shows a live nudge/disclosure
  if (roleConfigured("social")) {
    setTimeout(() => void runOrchestrator().catch(() => {}), 4000).unref?.();
  }
}
