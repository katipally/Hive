# Hosting

How the public demo is built and where it currently runs. Kept as a reference for future
deploys.

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
- `docker/entrypoint.sh`, starts hive-server and bee, then Caddy in the foreground; exits (so
  the host restarts) if any of the three dies.
- `render.yaml`, the Render Blueprint.

> **Caddy gotcha:** the official `caddy` Docker image ships its binary with Linux file
> capabilities (`cap_net_bind_service`). Render's sandboxed runtime refuses to `exec` a file
> that has capabilities (`status 126`, "Operation not permitted"). The Dockerfile therefore
> downloads a plain release binary, which has no capabilities. We bind `$PORT`, not a
> privileged port, so none are needed.

## Demo mode

The hosted build runs in demo mode, driven by three environment flags:

- `HIVE_DEMO=1`, the hive bakes the provider key + model roles from env, creates three
  members, and kicks one orchestrator pass after the bees have seeded conversations.
- `BEE_DEMO=1`, the bee runtime starts **one bee per member** (shown as switchable profiles),
  pins each bee to its member server-side, and replays a couple of realistic conversations per
  member on boot. The hive's graph, disclosures, and nudges are then built from those
  conversations through the normal pipeline, nothing is hand-inserted.
- `VITE_DEMO=1`, build flag for the bee chat SPA.

Because the free tier has no persistent disk, data is **re-seeded on every boot**; this is why
the demo doesn't need a paid disk.

## Environment variables

| Var | Purpose | Default |
|-----|---------|---------|
| `MINIMAX_API_KEY` | Baked-in provider key (set as a secret, never committed) |, |
| `HIVE_DEMO` | Enable the hive demo bootstrap | `1` (render.yaml) |
| `BEE_DEMO` | Enable the 3-bee demo runtime | `1` (entrypoint) |
| `HIVE_DEMO_MODEL` | MiniMax model for chat/extraction/social | `MiniMax-M2` |
| `HIVE_LLM_DAILY_CAP` | Global daily LLM-call cap protecting the shared key | `300` |
| `HIVE_MINIMAX_BASE_URL` | Override for MiniMax's CN endpoint | `api.minimax.io/anthropic` |
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
  request. Open the URL once before sharing it, or keep it warm with a free pinger hitting
  `/api/health`. The dashboard's graph and members views retry while empty, so a cold start
  doesn't leave them looking broken.
- **Ephemeral disk:** runtime data resets on restart/redeploy; the demo re-seeds on boot.

## What is not hosted

The **iMessage** channel reads a Mac's `chat.db` and sends via AppleScript, and the
**Telegram/Discord** channels need bot tokens, all local-operator features. The hosted demo
uses the **web** channel only.

## Run the container locally

```bash
docker build -t hive-demo .
docker run --rm -p 8080:8080 \
  -e MINIMAX_API_KEY=your-key -e HIVE_DEMO=1 -e HIVE_LLM_DAILY_CAP=300 \
  hive-demo
# open http://localhost:8080
```
