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
    createMember("Dana", "America/Los_Angeles");
  }
  return listMembers().map((m) => ({ name: m.name, code: createPairingCode(m.id) }));
}

// Boot bootstrap. Two independent parts:
//  1. Bake the provider key + model roles from env whenever MINIMAX_API_KEY is present —
//     regardless of HIVE_DEMO — so a *non-demo* hosted instance still has a working model
//     without the plaintext being re-typed in Settings (the ephemeral disk drops it).
//  2. Replay the canned Alice/Bob/Cara scenario ONLY under HIVE_DEMO. Set HIVE_DEMO=0 to
//     boot a blank slate (empty graph/members) that still has a working model, then add
//     data manually.
export async function bootstrapDemo(): Promise<void> {
  const key = process.env["MINIMAX_API_KEY"];
  if (key && !hasSecret("provider:minimax")) {
    putSecret("provider:minimax", key);
    const base = process.env["HIVE_MINIMAX_BASE_URL"];
    if (base) setBaseUrl("minimax", base);
    const model = process.env["HIVE_DEMO_MODEL"] ?? "MiniMax-M3"; // match render.yaml default
    for (const role of ["chat", "extraction", "social"] as ModelRole[]) {
      setModelRole(role, { provider: "minimax", modelId: model });
    }
    console.log(`[hive] minimax key baked from env, roles → ${model}`);
  }
  // DATA-4: on Render's free/ephemeral disk the encryption key (and thus any secret not
  // re-baked from env) is regenerated each boot, so dashboard-entered API keys don't
  // survive a restart. Re-baking MINIMAX from env above keeps the core flow working.
  console.warn("[hive] note: on an ephemeral disk, secrets entered in the dashboard reset on restart — set them via env for persistence.");
  // Retrieval is embedding-free (BM25/FTS5 + graph traversal) — there is no vector RAG
  // path, so no embeddings role is needed.

  // Everything below is the canned demo scenario — skipped when HIVE_DEMO is unset.
  if (!process.env["HIVE_DEMO"]) return;

  const members = await seedDemo();
  console.log(`[hive] demo: ${members.length} members ready (${members.map((m) => `${m.name} ${m.code}`).join(", ")})`);

  // Give the bees time to replay conversations and the pipeline to extract them,
  // then surface a proactive connection/disclosure. The heartbeat keeps it going.
  if (roleConfigured("social")) {
    const delayMs = Number(process.env["HIVE_DEMO_ORCHESTRATOR_DELAY_MS"] ?? 75_000);
    setTimeout(() => void runOrchestrator().catch(() => {}), delayMs).unref?.();
  }
}
