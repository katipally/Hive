// End-to-end smoke test against the mock LLM (HIVE_MOCK_LLM=1).
// Verifies: pairing, chat, extraction→graph, temporal invalidation, dedup,
// cross-member disclosure (share birthday / withhold surprise), and a
// proactive nudge delivered out-of-conversation to another member's bee.
//
// Run with:  pnpm smoke   (starts nothing; expects hive+bee already running in mock mode)
// or standalone via scripts/run-smoke.sh which boots both.
import assert from "node:assert";
import WebSocket from "ws";

const HIVE = "http://localhost:4800";
const BEE = "http://localhost:4801";

async function j<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "content-type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json() as Promise<T>;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ChatClient {
  send(text: string): Promise<string>;
  nudges: string[];
  close(): void;
}
function connect(beeId: string, uid: string): Promise<ChatClient> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:4801/ws/chat?bee=${beeId}&uid=${uid}`);
    const nudges: string[] = [];
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === "nudge") nudges.push(m.text);
    });
    ws.on("open", () =>
      resolve({
        nudges,
        close: () => ws.close(),
        send(text) {
          return new Promise((res) => {
            let full = "";
            const h = (d: WebSocket.RawData) => {
              const m = JSON.parse(d.toString());
              if (m.type === "delta") full += m.text;
              if (m.type === "done" || m.type === "notice") {
                ws.off("message", h);
                res(full || m.text);
              }
            };
            ws.on("message", h);
            ws.send(JSON.stringify({ type: "msg", text }));
          });
        },
      }),
    );
  });
}

async function main() {
  console.log("· health checks");
  await j(`${HIVE}/api/health`);
  const bees = await j<{ beeId: string; name: string }[]>(`${BEE}/api/bees`);
  assert(bees.length >= 2, "need >=2 bee instances");

  console.log("· create members");
  const alice = await j<{ id: string; code: string }>(`${HIVE}/api/members`, { method: "POST", body: JSON.stringify({ name: "Alice" }) });
  const bob = await j<{ id: string; code: string }>(`${HIVE}/api/members`, { method: "POST", body: JSON.stringify({ name: "Bob" }) });

  const aClient = await connect(bees[0]!.beeId, "alice_smoke");
  const bClient = await connect(bees[1]!.beeId, "bob_smoke");

  console.log("· pairing (unknown -> refused -> code -> linked)");
  const refused = await aClient.send("hello there");
  assert(/invite code/i.test(refused), "unknown sender should get pairing prompt");
  const linked = await aClient.send(alice.code);
  assert(/Linked/i.test(linked), "code should link");
  await bClient.send(bob.code);

  console.log("· Alice shares facts (birthday + secret party for Bob + moves)");
  await aClient.send("my birthday is August 2 and I just moved to Berlin");
  await aClient.send("I'm planning a surprise party for Bob, don't tell him, the budget is 300");
  await waitExtract(alice.id, 3);

  console.log("· temporal invalidation (moved to Munich)");
  await aClient.send("actually I moved to Munich now");
  await aClient.send("also my friend Bob is great");
  await sleep(1500);
  await waitExtract(alice.id, 3);

  const graph = await j<{ nodes: any[]; links: any[] }>(`${HIVE}/api/graph?showInvalidated=1`);
  const berlin = graph.links.find((l) => l.rel === "lives_in" && graph.nodes.find((n) => n.id === l.target)?.name === "Berlin");
  const munich = graph.links.find((l) => l.rel === "lives_in" && graph.nodes.find((n) => n.id === l.target)?.name === "Munich");
  assert(berlin?.invalidated === true, "Berlin lives_in should be invalidated");
  assert(munich && !munich.invalidated, "Munich lives_in should be live");
  console.log("  ✓ Berlin invalidated, Munich live");

  console.log("· disclosure: Bob asks Alice's birthday (share) then about surprises (withhold)");
  await bClient.send("when is Alice's birthday?");
  await sleep(300);
  await bClient.send("is anyone planning a surprise party for me?");
  await sleep(500);

  const disclosures = await j<any[]>(`${HIVE}/api/disclosures`);
  assert(disclosures.length > 0, "disclosures should be logged");
  const shared = disclosures.find((d) => d.decision !== "withhold" && /august 2/i.test(d.disclosed ?? ""));
  const withheld = disclosures.find((d) => /surprise|party/i.test((d.withheld ?? "") + (d.reasoning ?? "")));
  assert(shared, "birthday should have been shareable");
  assert(withheld, "surprise party should have been withheld");
  // the surprise must never appear in any DISCLOSED text handed to another member
  const leaked = disclosures.some((d) => /surprise party|budget|\b300\b/i.test(d.disclosed ?? ""));
  assert(!leaked, "disclosed context must never contain the surprise/budget");
  console.log("  ✓ birthday shared, surprise withheld, no leak in disclosed context");

  console.log("· proactive: Alice gets engaged -> Bob nudged out-of-conversation");
  await aClient.send("huge news, I just got engaged to Sam!");
  await waitExtract(alice.id, 2);
  await sleep(1500);
  const nudges = await j<any[]>(`${HIVE}/api/nudges`);
  const bobNudge = nudges.find((n) => n.memberId === bob.id && (n.status === "sent" || n.status === "queued"));
  assert(bobNudge, "Bob should have a nudge");
  // delivered to Bob's bee client?
  let waited = 0;
  while (bClient.nudges.length === 0 && waited < 5000) {
    await sleep(300);
    waited += 300;
  }
  assert(bClient.nudges.length > 0, "Bob's bee should receive the nudge out-of-conversation");
  console.log(`  ✓ nudge delivered to Bob: "${bClient.nudges[0]}"`);

  console.log("· dedup: same engagement news again -> suppressed");
  await aClient.send("did I mention I got engaged to Sam? so happy!");
  await waitExtract(alice.id, 1);
  await sleep(1000);
  const nudges2 = await j<any[]>(`${HIVE}/api/nudges`);
  const suppressed = nudges2.find((n) => n.memberId === bob.id && n.status === "suppressed");
  assert(suppressed, "repeat should be suppressed (cooldown/dedup)");
  console.log(`  ✓ repeat suppressed (${suppressed.suppressReason})`);

  aClient.close();
  bClient.close();
  console.log("\n✅ SMOKE PASSED");
  process.exit(0);
}

async function waitExtract(memberId: string, minMemories: number, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const acts = await j<any[]>(`${HIVE}/api/activity?limit=50`);
    const mems = acts.filter((a) => a.type === "extraction" && a.memberId === memberId).reduce((s, a) => s + (a.payload.memories ?? 0), 0);
    if (mems >= minMemories) return;
    await sleep(500);
  }
}

main().catch((e) => {
  console.error("\n❌ SMOKE FAILED:", e.message);
  process.exit(1);
});
