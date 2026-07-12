// Demo bootstrap for the hosted/public build.
//
// The hive starts empty apart from three members. Their bees (BEE_DEMO) replay
// realistic conversations on boot, and the graph, disclosures and proactive nudges
// all emerge from those conversations through the normal pipeline — nothing here
// hand-inserts facts. The scenario is built to show the two things that make Hive
// Hive: contextual-integrity disclosure (Bob & Cara plan a SURPRISE for Alice that
// must never leak to her) and proactive connection (Alice & Bob both love the
// outdoors and both want to visit Japan).
import { createMember, createPairingCode, listMembers } from "./db/repo.js";
import { hasSecret, putSecret } from "./crypto/keystore.js";
import { setModelRole, setBaseUrl, roleConfigured } from "./settings/settings.js";
import { runOrchestrator } from "./proactive/orchestrator.js";
import type { ModelRole } from "@hive/shared";

// Create the three members. No-op if they already exist, so it's safe every boot.
// Facts/graph come from the bees replaying conversations, not from here.
export async function seedDemo(): Promise<{ name: string; code: string }[]> {
  if (listMembers().length === 0) {
    createMember("Alice", "Europe/Berlin");
    createMember("Bob", "America/New_York");
    createMember("Cara", "Europe/London");
  }
  return listMembers().map((m) => ({ name: m.name, code: createPairingCode(m.id) }));
}

// One-shot boot bootstrap (guarded by HIVE_DEMO). Bakes the provider key + model
// roles from env, creates the members, and kicks an orchestrator pass once the bees
// have had time to seed conversations and the pipeline has extracted them.
export async function bootstrapDemo(): Promise<void> {
  if (!process.env["HIVE_DEMO"]) return;

  const key = process.env["MINIMAX_API_KEY"];
  if (key && !hasSecret("provider:minimax")) {
    putSecret("provider:minimax", key);
    const base = process.env["HIVE_MINIMAX_BASE_URL"];
    if (base) setBaseUrl("minimax", base);
    const model = process.env["HIVE_DEMO_MODEL"] ?? "MiniMax-M3"; // match render.yaml default
    for (const role of ["chat", "extraction", "social"] as ModelRole[]) {
      setModelRole(role, { provider: "minimax", modelId: model });
    }
    console.log(`[hive] demo: minimax key baked in, roles → ${model}`);
  }
  // DATA-4: on Render's free/ephemeral disk the encryption key (and thus any secret not
  // re-baked from env) is regenerated each boot, so dashboard-entered API keys don't
  // survive a restart. The demo re-bakes MINIMAX from env above, so the core flow is fine.
  console.warn("[hive] note: on an ephemeral disk, secrets entered in the dashboard reset on restart — set them via env for persistence.");
  // Retrieval is embedding-free (BM25/FTS5 + graph traversal) — there is no vector RAG
  // path, so no embeddings role is needed.

  const members = await seedDemo();
  console.log(`[hive] demo: ${members.length} members ready (${members.map((m) => `${m.name} ${m.code}`).join(", ")})`);

  // Give the bees time to replay conversations and the pipeline to extract them,
  // then surface a proactive connection/disclosure. The heartbeat keeps it going.
  if (roleConfigured("social")) {
    const delayMs = Number(process.env["HIVE_DEMO_ORCHESTRATOR_DELAY_MS"] ?? 75_000);
    setTimeout(() => void runOrchestrator().catch(() => {}), delayMs).unref?.();
  }
}
