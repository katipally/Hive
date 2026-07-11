import assert from "node:assert";
import { splitMessage, toTelegram, toDiscord } from "./format.js";

// Run: pnpm -C apps/bee exec tsx src/channels/format.test.ts
// ponytail: one assert-based self-check, no framework.

// splitMessage: never exceeds max, loses no characters, keeps order.
{
  const long = Array.from({ length: 50 }, (_, i) => `paragraph number ${i} with some words`).join("\n\n");
  const parts = splitMessage(long, 100);
  assert.ok(parts.length > 1, "long text should split");
  for (const p of parts) assert.ok(p.length <= 100, `part over limit: ${p.length}`);
  assert.strictEqual(parts.join(" ").replace(/\s+/g, " ").trim(), long.replace(/\s+/g, " ").trim(), "no content lost");
}
// A single unbreakable run still gets hard-cut under the limit.
{
  const blob = "x".repeat(250);
  const parts = splitMessage(blob, 100);
  for (const p of parts) assert.ok(p.length <= 100);
  assert.strictEqual(parts.join(""), blob);
}
// Short text passes through untouched.
assert.deepStrictEqual(splitMessage("hi", 100), ["hi"]);

// toTelegram strips markdown; toDiscord keeps emphasis but expands links.
assert.strictEqual(toTelegram("**bold** and [t](http://u)"), "bold and t (http://u)");
assert.strictEqual(toDiscord("**bold** and [t](http://u)"), "**bold** and t (http://u)");

console.log("format.test.ts OK");
