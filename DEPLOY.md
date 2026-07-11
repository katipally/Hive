# Hosting the Hive demo

This ships a **single container**: the hive brain + a web-only bee behind a Caddy
reverse proxy, with the dashboard and web chat served as static builds. One public
URL, one origin.

```
                          ┌──────────── container ────────────┐
  https://…/        ─────►│ Caddy :$PORT                       │
    /                     │   /            → dashboard (static)│
    /chat                 │   /chat        → web chat (static) │
    /api  /ws/dash /ws/bee│   /api …       → hive-server :4800 │
    /bee-api  /ws/chat    │   /bee-api …   → bee :4801         │
                          │ hive-server ⇄ bee over localhost   │
                          │ seeds itself on boot (HIVE_DEMO=1) │
                          └────────────────────────────────────┘
```

**What is NOT hosted:** iMessage (reads a Mac's `chat.db` + AppleScript) and the
Telegram/Discord bots. Those are local-operator channels and can't run for a
stranger. The hosted demo is the **web** channel only — which is all Jason needs to
see the graph, disclosures, and proactive nudges work.

---

## Deploy to Render (free, no credit card)

Render's free web service needs no card, gives an `https://…onrender.com` URL, and
runs Docker. It has no persistent disk and sleeps after ~15 min idle — both fine
here, because the demo **re-seeds itself on every boot**.

1. **Push this repo to GitHub** (any branch).
2. Go to **render.com** → sign up (free) → **New → Blueprint** → connect this repo.
   Render reads `render.yaml` and creates the `hive-demo` web service.
   (Or **New → Web Service → Docker**, pointing at the repo root, if you skip the blueprint.)
3. In the service's **Environment**, set one secret:
   - `MINIMAX_API_KEY` = your MiniMax key
   (The rest — `HIVE_DEMO=1`, `HIVE_DEMO_MODEL=MiniMax-M2`, `HIVE_LLM_DAILY_CAP=300` —
   come from `render.yaml`.)
4. **Deploy.** First build takes a few minutes (it compiles `better-sqlite3`).
5. Open the URL. You'll land on the dashboard with the graph already populated.

**Cold starts:** after idle, the first hit takes ~30–60s to wake. Before you send the
link to Jason, open it once yourself so it's warm — or keep it warm with a free pinger
(e.g. cron-job.org hitting `/api/health` every 10 min).

### Environment variables

| Var | Purpose | Default |
|---|---|---|
| `MINIMAX_API_KEY` | The baked-in provider key (set as a secret) | — |
| `HIVE_DEMO` | Enables boot seed + key/role bootstrap | `1` (in render.yaml) |
| `HIVE_DEMO_MODEL` | MiniMax model for chat/extraction/social | `MiniMax-M2` |
| `HIVE_LLM_DAILY_CAP` | Global daily LLM-call cap (protects the key) | `300` |
| `HIVE_MINIMAX_BASE_URL` | Override for MiniMax's CN endpoint | `api.minimax.io/anthropic` |

The key is encrypted at rest via the keystore; only its last 4 digits are ever shown.
When the daily cap is hit, calls fail with a clear "daily demo limit" message and reset
within 24h.

---

## Run the container locally (when Docker is available)

```bash
docker build -t hive-demo .
docker run --rm -p 8080:8080 \
  -e MINIMAX_API_KEY=your-key \
  -e HIVE_DEMO=1 -e HIVE_LLM_DAILY_CAP=300 \
  hive-demo
# open http://localhost:8080
```

---

## The 90-second demo (what to show Jason)

The seed is a friend group — Alice, Bob, Cara — built around two moments that are the
whole point of Hive:

1. **Contextual-integrity disclosure.** Open **Dashboard → Graph**: Alice, Bob, Cara
   and their world. Bob and Cara are secretly planning a **surprise birthday party for
   Alice**. Open **web chat** (`/chat`), paste **Alice's** invite code (shown on the
   **Members** tab) to link as Alice, then ask *"what are Bob and Cara up to?"* Her bee
   shares what it may — and **withholds the surprise**. Every decision, with the model's
   reasoning and what was withheld, is logged on the **Disclosures** tab.

2. **Proactive connection.** Alice and Bob both love the outdoors and both want to visit
   Japan. On **Proactive**, hit **Find connections** — the orchestrator surfaces the
   introduction on its own. Nudges are delivered out-of-band to the right person's bee.

Lead with the disclosure moment. It's the codification of the "route context between
people with care" idea — the reason to build this at all.
