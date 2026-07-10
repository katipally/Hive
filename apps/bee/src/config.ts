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
    imessage?: { enabled: boolean };
  };
  // iMessage poll cursor (M9)
  imessageCursor?: number;
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
  // Seed 3 local bee instances for a friend-group demo (all on the web channel).
  const mk = (name: string): BeeInstanceConfig => ({
    beeId: id("bee"),
    beeToken: randomBytes(16).toString("hex"),
    name,
    channels: { web: { enabled: true } },
  });
  return {
    hiveWsUrl: process.env["HIVE_WS_URL"] ?? "ws://localhost:4800/ws/bee",
    hiveHttpUrl: process.env["HIVE_HTTP_URL"] ?? "http://localhost:4800",
    webPort: Number(process.env["BEE_PORT"] ?? 4801),
    instances: [mk("bee-1"), mk("bee-2"), mk("bee-3")],
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
