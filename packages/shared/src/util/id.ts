import { randomBytes } from "node:crypto";

// Sortable-ish id: base36 timestamp + random suffix. Good enough for a local single-hive app.
export function id(prefix = ""): string {
  const t = Date.now().toString(36);
  const r = randomBytes(6).toString("hex");
  return prefix ? `${prefix}_${t}${r}` : `${t}${r}`;
}

// Pairing code like BEE-7K2M (no ambiguous chars).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function pairingCode(): string {
  const b = randomBytes(4);
  let s = "";
  for (let i = 0; i < 4; i++) s += ALPHABET[b[i]! % ALPHABET.length];
  return `BEE-${s}`;
}
