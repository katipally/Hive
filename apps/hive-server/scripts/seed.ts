// Seed a fake 3-member friend group directly into hive.db so the dashboard
// (3D graph, members) has content without running conversations.
// Usage: HIVE_DATA_DIR=./hive-data pnpm seed
import { join } from "node:path";
import { openDb } from "../src/db/db.js";
import { initKeystore } from "../src/crypto/keystore.js";
import { createMember, createPairingCode, linkIdentity } from "../src/db/repo.js";
import { upsertEntity, insertMemory, insertEdge } from "../src/graph/write.js";
import { embedTexts, embeddingsConfigured } from "../src/llm/call.js";

const DATA_DIR = process.env["HIVE_DATA_DIR"] ?? join(process.cwd(), "hive-data");
openDb(DATA_DIR);
initKeystore(DATA_DIR);

async function seed() {
  const alice = createMember("Alice", "Europe/Berlin");
  const bob = createMember("Bob", "America/New_York");
  const cara = createMember("Cara", "Europe/London");
  for (const m of [alice, bob, cara]) linkIdentity(m.id, "web", `seed_${m.name.toLowerCase()}`, m.name, null);

  const facts: Record<string, string[]> = {
    [alice.id]: [
      "Alice lives in Munich",
      "Alice works at Acme as a designer",
      "Alice's birthday is August 2",
      "Alice loves rock climbing",
    ],
    [bob.id]: [
      "Bob lives in Brooklyn",
      "Bob is a photographer",
      "Bob loves hiking and the outdoors",
      "Bob is saving up for a trip to Japan",
    ],
    [cara.id]: [
      "Cara lives in London",
      "Cara runs a small bakery called Rise",
      "Cara and Alice met at university",
      "Cara plays the cello",
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

  // relations
  const rel = (src: string, r: string, dst: string) =>
    insertEdge({ srcEntityId: src, rel: r, dstEntityId: dst, confidence: 0.9, validFrom: null, sourceMemoryId: null });
  rel(aE, "lives_in", entity("Munich", "place"));
  rel(aE, "works_at", entity("Acme", "org"));
  rel(aE, "likes", entity("rock climbing", "topic"));
  rel(bE, "lives_in", entity("Brooklyn", "place"));
  rel(bE, "likes", entity("hiking", "topic"));
  rel(bE, "planning", entity("Japan trip", "event"));
  rel(cE, "lives_in", entity("London", "place"));
  rel(cE, "works_at", entity("Rise", "org"));
  rel(cE, "friends_with", aE);
  rel(bE, "friends_with", aE);
  rel(cE, "likes", entity("cello", "topic"));

  console.log("Seeded members + codes:");
  for (const m of [alice, bob, cara]) console.log(`  ${m.name}: ${createPairingCode(m.id)}`);
  console.log("Done. Open the dashboard to see the graph.");
  process.exit(0);
}

seed();
