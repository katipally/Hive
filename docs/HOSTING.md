# Hosting

How the hosted build is put together and where it currently runs. Kept as a reference for
future deploys.

## The hosted build: one container

Locally, Hive is four processes. For hosting they are collapsed into a **single Docker
container** fronted by [Caddy](https://caddyserver.com), so the whole thing is one service on
one origin.

```
                     ┌──────────────── container ────────────────┐
  https://…/         │  Caddy  (listens on $PORT)                 │
    /                │    /            → dashboard SPA (static)   │
    /chat            │    /chat        → bee chat SPA (static)    │
    /api  /ws/dash   │    /api …       → hive-server  (localhost:4800)
    /ws/bee          │    /bee-api …   → bee runtime  (localhost:4801)
    /bee-api /ws/chat│    /ws/chat     → bee runtime               │
                     │  hive-server ⇄ bee over localhost           │
                     └────────────────────────────────────────────┘
```

Both SPAs use same-origin relative paths, and their WebSocket code already picks `wss` on
HTTPS, so no frontend URLs are hardcoded. The only ambiguity, both apps call `/api`, is
resolved by building the bee chat with `VITE_BEE_API=/bee-api`, which Caddy rewrites to the
bee's `/api`.

Files:

- `Dockerfile`, installs deps, builds both SPAs, downloads the Caddy binary, copies the
  Caddyfile + entrypoint.
- `docker/Caddyfile`, the routing above.
- `docker/entrypoint.sh`, starts hive-server and bee, **waits for both to accept connections
  on :4800/:4801**, then starts Caddy — so the boot window doesn't return a flood of 502s.
  Exits (so the host restarts) if any of the three dies.
- `render.yaml`, the Render Blueprint.

> **Caddy gotcha:** the official `caddy` Docker image ships its binary with Linux file
> capabilities (`cap_net_bind_service`). Render's sandboxed runtime refuses to `exec` a file
> that has capabilities (`status 126`, "Operation not permitted"). The Dockerfile therefore
> downloads a plain release binary, which has no capabilities. We bind `$PORT`, not a
> privileged port, so none are needed.

## Boot behaviour: empty hive, baked key

The hosted build boots **empty** — no seeded members, no canned conversations. On startup the
hive bakes the provider key and model roles from env (`MINIMAX_API_KEY` + `HIVE_MODEL`), so the
app comes up with a working model but nothing to show yet. The operator then creates members on
the dashboard, people pair with their `BEE-XXXX` codes, and real conversations populate the
graph, disclosures, nudges, and polls through the normal pipeline.

Because the free tier has no persistent disk, all that runtime data is thrown away on restart
and the instance boots empty again — but the provider key **re-bakes from `MINIMAX_API_KEY` on
every boot**, so the model still works after a restart.

## Environment variables

| Var | Purpose | Default |
|-----|---------|---------|
| `MINIMAX_API_KEY` | Provider key, baked from env at boot (set as a secret, never committed) | — |
| `HIVE_MODEL` | MiniMax model used for the chat/extraction/social roles | `MiniMax-M3` |
| `HIVE_LLM_DAILY_CAP` | Global daily LLM-call cap protecting the shared key | `300` |
| `HIVE_SALIENCE_MIN` | Min memory salience to trigger a proactive-nudge LLM call | `0.6` |
| `HIVE_MINIMAX_BASE_URL` | Override for MiniMax's CN endpoint | `api.minimax.io/anthropic` |
| `EXA_API_KEY` | Optional. Upgrades web search/reading to Exa; without it, search is keyless (DuckDuckGo). | — |
| `HIVE_SEARXNG_URL` | Optional keyless search fallback — point at a SearXNG instance. | — |
| `HIVE_SEARCH_DAILY_CAP` | Daily cap on web searches | `50` |
| `PORT` | Public port (injected by the host) | `8080` local |

The key is encrypted at rest via the keystore; only its last four characters are shown. When
the daily cap is hit, LLM calls fail with a clear message and the counter resets within 24h.

## Current Render deployment

- **Service:** `hive-demo` (Web Service, Docker runtime, **Free** plan, region `oregon`).
- **URL:** https://hive-demo.onrender.com
- **Repo/branch:** `katipally/Hive`, branch `rework/design-system-consistency`.
- **Blueprint:** created from `render.yaml`; `autoDeploy` is off, so pushes do **not**
  auto-build.

### Deploying an update

1. Push to the branch above.
2. In the Render dashboard → the `hive-demo` service → **Manual Deploy → Deploy latest
   commit**. (Auto-deploy is off by design.)
3. First build takes a few minutes (it compiles the native `better-sqlite3`).

Set `MINIMAX_API_KEY` once, as a secret, under the service's **Environment**. The other
variables come from `render.yaml`.

### Free-tier behaviour

- **Spin-down:** the instance sleeps after ~15 min idle and cold-starts (~50s) on the next
  request. This also pauses Hive's proactive loops, so **keep it warm** if you want it to
  initiate unattended (see below).
- **Ephemeral disk:** runtime data (graph, members, transcripts) resets on restart/redeploy;
  the instance boots empty again and only the provider key re-bakes from env.

### Keeping it awake (so proactivity actually runs)

Hive's proactive brain only runs while the process is up. Two free options to defeat the
15-min spin-down — both just keep the process warm (zero LLM calls; token spend is still
governed by the salience gate + `HIVE_LLM_DAILY_CAP`):

- **cron-job.org (recommended):** create a job hitting `https://hive-demo.onrender.com/api/health`
  every ~10 min. 1-minute granularity, reliable.
- **GitHub Actions:** `.github/workflows/keep-warm.yml` pings the same URL on a schedule.
  Convenient but GitHub may delay/drop scheduled runs under load, so it's best-effort.

"Awake" ≠ "always thinking": the ping keeps it alive; it only *reasons* (and spends tokens)
when a real event — a new salient fact, a cross-member overlap — justifies it.

## What is not hosted

The **Telegram/Discord** channels need bot tokens, so they're local-operator setup. The
hosted demo uses the **web** channel only. (iMessage is not supported — Apple has no server
API; see docs/CHANNELS.md.)

## Run the container locally

```bash
docker build -t hive-demo .
docker run --rm -p 8080:8080 \
  -e MINIMAX_API_KEY=your-key -e HIVE_MODEL=MiniMax-M3 -e HIVE_LLM_DAILY_CAP=300 \
  hive-demo
# open http://localhost:8080 — it boots empty; add a member on the dashboard, then pair in /chat
```
