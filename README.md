# Hive 🐝

Social intelligence for a friend group. Each member has a **Bee** — a personal agent they chat with over Telegram, Discord, iMessage, or a built-in web chat. One **Hive** server is the shared brain: it receives every conversation turn, builds a temporal knowledge graph, and proactively connects people — while a contextual-integrity **disclosure agent** decides what may cross between members (share "Alice's birthday is Aug 2", never the surprise party).

Everything runs locally. No hosting, no `.env` — API keys are entered in the dashboard and encrypted at rest.

## Architecture

```
        ┌─────────── Bees (client side) ───────────┐
 web ─┐  │  bee-1 (Alice)   bee-2 (Bob)   bee-3 …   │
 tg  ─┼──┤   • chat loop     • sessions (JSONL)      │
 dc  ─┤  │   • channel creds • streams every turn ───┼──ws──┐
 imsg─┘  └───────────────────────────────────────────┘      │
                                                             ▼
                                              ┌──────── Hive (the brain) ────────┐
   dashboard ──http/ws──►                     │  extract → graph (SQLite+vec)     │
   • 3D graph  • disclosures                   │  conclude · implications          │
   • proactive queue · activity                │  disclosure agent (audited)       │
   • members · settings (keys/models)          │  proactive: heartbeat + events    │
                                              └───────────────────────────────────┘
```

- **`apps/hive-server`** — brain + HTTP API + `/ws/bee` + `/ws/dash`. SQLite (`better-sqlite3` + `sqlite-vec`), one `hive.db`.
- **`apps/bee`** — bee runtime hosting N bee instances (later: one per machine).
- **`apps/hive-dash`** — React dashboard (3D graph via `react-force-graph-3d`).
- **`apps/bee-ui`** — React web chat with a bee.
- **`packages/shared`** — types, bee↔hive protocol, LLM client + agent loop.

## Quick start

```bash
pnpm install
pnpm dev          # boots hive-server(:4800), bee(:4801), dash(:5173), bee-ui(:5174)
```

Then open the dashboard at **http://localhost:5173**:

1. **Settings** → paste an API key for a provider (Anthropic / OpenAI / Ollama / MiniMax), **Fetch models**, and assign models to the four roles: *chat, extraction, social, embeddings*. (Local Ollama needs no key — just `ollama pull qwen2.5:3b nomic-embed-text`.)
2. **Members** → add a member; copy their `BEE-XXXX` invite code.
3. Open the bee chat at **http://localhost:5174**, pick a bee, send the code to link, then talk. Watch the **Graph** tab fill in and the **Proactive** / **Disclosures** tabs light up.

### Provider notes
- **Anthropic / MiniMax** use the `anthropic-messages` API family; **OpenAI / Ollama** use `openai-compat`. MiniMax base URL: `https://api.minimax.io/anthropic` (CN: `api.minimaxi.com`).
- Reasoning effort is exposed per role where the model supports it.
- Changing the embeddings model/dimension rebuilds the vector index.

## Channels
- **Web** — always on (the bee-ui).
- **Telegram** — create a bot with @BotFather, then `PUT /api/bees/:beeId/channels/telegram {"botToken":"…"}` (dashboard support: Members → channels).
- **Discord** — bot token; enable the **Message Content** privileged intent. DM-only in v1.
- **iMessage (macOS)** — grant **Full Disk Access** to your terminal/node (to read `~/Library/Messages/chat.db`) and **Automation** permission for Messages (to send). Enable with `{"enabled":true}`.

## Verify it works

```bash
# end-to-end test against a real model. Boots a throwaway hive+bee on ports
# 4900/4901 (won't touch a running `pnpm dev`), runs the flow, tears down.
# Skips cleanly if no key is set.
HIVE_TEST_API_KEY=sk-... pnpm smoke
```

The smoke test verifies: pairing → chat → extraction → temporal invalidation → cross-member disclosure (birthday shared, surprise withheld, no leak) → proactive nudge delivered out-of-conversation → dedup suppression.

Seed a demo graph without conversations:

```bash
HIVE_DATA_DIR=./apps/hive-server/hive-data pnpm -C apps/hive-server seed
```

## Hosted demo

A single Docker image (hive + web-only bee behind Caddy) serves the dashboard and web
chat from one origin, seeds a friend-group scenario on boot, and runs against a baked-in
provider key. Deploy free on Render — see **[DEPLOY.md](./DEPLOY.md)**. The macOS iMessage
and Telegram/Discord channels are local-operator only and are not part of the hosted build.

## Data & privacy
- All secrets are AES-256-GCM encrypted with `hive-data/master.key` (created on first boot, `0600`). No plaintext keys on disk, ever.
- Bees never hold API keys — chat streams through the hive LLM proxy.
- Every cross-member disclosure (chat or nudge) is logged with the model's reasoning and what was withheld.
- Unknown senders are refused until paired (allowlist by default).
- Servers bind `127.0.0.1`; the dashboard has no auth (localhost-only) in v1.
