import assert from "node:assert";
import { wantQuery } from "./errands.js";

// Run: pnpm -C apps/hive-server exec tsx src/proactive/errands.test.ts
// ponytail: one assert-based self-check for the want parser, no framework.

// Affirmative wants → the object of the want (not the whole sentence).
assert.strictEqual(wantQuery("Bob is looking for a good cello teacher"), "good cello teacher");
assert.strictEqual(wantQuery("Alice has been searching for dry Alsatian Riesling under $30"), "dry Alsatian Riesling under $30");
assert.strictEqual(wantQuery("Cara wants to visit Kyoto in the spring"), "Kyoto in the spring");

// Negated wants → null (the QUAL-1 bug: must NOT fire an errand).
assert.strictEqual(wantQuery("I don't want a dog"), null);
assert.strictEqual(wantQuery("Bob is no longer looking for an apartment"), null);
assert.strictEqual(wantQuery("She doesn't need any help"), null);

// No want at all → null.
assert.strictEqual(wantQuery("Alice lives in Berlin and loves hiking"), null);

console.log("errands.test.ts OK");
