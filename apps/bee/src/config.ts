import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { id } from "@hive/shared";

export interface BeeInstanceConfig {
  beeId: string;
  beeToken: string;
  name: string;
  // per-channel config; web is always on. telegram/discord filled from dash (M8).
  channels: {
    web?: { enabled: boolean };
    telegram?: { botToken: string };
    discord?: { botToken: string };
  };
}

export interface BeeConfig {
  hiveWsUrl: string;
  hiveHttpUrl: string;
  webPort: number;
  instances: BeeInstanceConfig[];
}

const DATA_DIR = process.env["BEE_DATA_DIR"] ?? join(process.cwd(), "bee-data");
const CONFIG_PATH = join(DATA_DIR, "bee.json");

export function dataDir(): string {
  return DATA_DIR;
}

function defaults(): BeeConfig {
  // One hive bee hosts the shared channels and serves every member (each channel
  // address maps to a member via identity). Extra bees are for testing only and
  // are created on demand from the web UI — never seed several (that split channel
  // config across bees). See the multi-bee split note in docs/SETUP.md.
  const mk = (name: string): BeeInstanceConfig => ({
    beeId: id("bee"),
    beeToken: randomBytes(16).toString("hex"),
    name,
    channels: { web: { enabled: true } },
  });
  // One bee to start with; more profiles are added at runtime when a member pairs with a
  // code (the "+" in the web UI). Each profile is its own person, keyed by its own uid.
  const instances = [mk("me")];
  return {
    hiveWsUrl: process.env["HIVE_WS_URL"] ?? "ws://localhost:4800/ws/bee",
    hiveHttpUrl: process.env["HIVE_HTTP_URL"] ?? "http://localhost:4800",
    webPort: Number(process.env["BEE_PORT"] ?? 4801),
    instances,
  };
}

export function loadConfig(): BeeConfig {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(CONFIG_PATH)) {
    const d = defaults();
    writeFileSync(CONFIG_PATH, JSON.stringify(d, null, 2));
    return d;
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as BeeConfig;
}

export function saveConfig(cfg: BeeConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
