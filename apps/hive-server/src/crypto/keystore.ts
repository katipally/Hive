import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/db.js";

let masterKey: Buffer | null = null;

export function initKeystore(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const keyPath = join(dataDir, "master.key");
  if (existsSync(keyPath)) {
    masterKey = readFileSync(keyPath);
  } else {
    masterKey = randomBytes(32);
    writeFileSync(keyPath, masterKey, { mode: 0o600 });
  }
}

function key(): Buffer {
  if (!masterKey) throw new Error("keystore not initialized");
  return masterKey;
}

// Store an encrypted secret by name (e.g. 'provider:anthropic').
export function putSecret(name: string, plaintext: string): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  getDb()
    .db.prepare(
      "INSERT OR REPLACE INTO secrets(name, ciphertext, iv, tag, updated_at) VALUES(?,?,?,?,?)",
    )
    .run(name, ct, iv, tag, Date.now());
}

export function getSecret(name: string): string | null {
  const row = getDb()
    .db.prepare("SELECT ciphertext, iv, tag FROM secrets WHERE name = ?")
    .get(name) as { ciphertext: Buffer; iv: Buffer; tag: Buffer } | undefined;
  if (!row) return null;
  const decipher = createDecipheriv("aes-256-gcm", key(), row.iv);
  decipher.setAuthTag(row.tag);
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
}

export function hasSecret(name: string): boolean {
  const row = getDb().db.prepare("SELECT 1 FROM secrets WHERE name = ?").get(name);
  return !!row;
}

export function deleteSecret(name: string): void {
  getDb().db.prepare("DELETE FROM secrets WHERE name = ?").run(name);
}

export function last4(name: string): string | null {
  const v = getSecret(name);
  return v ? v.slice(-4) : null;
}

export function listSecretNames(prefix: string): string[] {
  return (
    getDb().db.prepare("SELECT name FROM secrets WHERE name LIKE ?").all(`${prefix}%`) as { name: string }[]
  ).map((r) => r.name);
}
