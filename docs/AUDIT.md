# Hive — Honest Audit &amp; Fix Tracker (as of July 2026)

> Method: three independent read-only code passes (security/hardcoded-values, proactive/disclosure/poll
> correctness, runtime/channels/agent-loop) + live black-box testing on the running stack (chat, emoji,
> slash commands, polls, dashboard). Read-only — nothing was modified. `[ ]` = open, check off as fixed.
>
> Interactive version: the published audit artifact (same content, visual).
>
> **Note (post-audit):** this audit was written against the earlier codebase, which had a
> **demo mode** — seeded personas, a canned conversation replay, and `HIVE_DEMO` / `BEE_DEMO`
> / `VITE_DEMO` / `HIVE_DEMO_MODEL` env flags, plus a `demo.ts` bootstrap and a `pnpm seed`
> script. That scaffolding has since been **removed**: the hive now boots empty, the operator
> creates members, and people pair with a `BEE-XXXX` code. The single model env var is now
> `HIVE_MODEL` (default `MiniMax-M3`) with the key baked from `MINIMAX_API_KEY`. Findings below
> that mention `demo.ts`, the seeded members, or the old env flags describe that earlier code
> and are kept for the record; where the reference is now factually wrong it's flagged inline.

## Remediation pass (July 2026)

A fix pass addressed the usage / agent / hive / bee findings. **Fixed:** ERR-1..5 (no silent
empty replies, mid-stream errors surfaced, WS/heartbeat hardened, bad-timezone guard); PRV-1
(compose from redacted text only), PRV-2 (raw-memory endpoint now behind the bee token), PRV-4
(`/private` persists nothing); PROA-1 (optimistic sent, no re-push burst), PROA-3 (min-respondent
floor), PROA-4 (terminal `expired`/`failed` poll states), PROA-5 (synthesis re-entrancy guard),
PROA-7 (polls respect proactivity=off + quiet hours), PROA-8 (approve status guard), PROA-10
(persisted `lastOrchestrator`); DATA-1 (contradicted memories superseded), DATA-2 (caps +
last-run timestamps persisted in a `kv` table), DATA-3 (dead embeddings code removed); CH-1..6
(per-channel chunking + formatting, typing indicators, web nudge persisted, TTS markdown strip);
slash-command registry + web autocomplete + Telegram menu; model-name mismatch aligned to
`MiniMax-M2`; `getDbLazy` removed; `GET /api/members` no longer mints codes.

**Deferred (documented, low demo impact):** security items SEC-1/3/4/5 (open API/WS — accepted
"purge only" scope; PRV-2 narrows the worst leak); PRV-3 pooling (internal-only, outbound now
closed by PRV-1); MINE-2/MINE-3 (model-specific `[e~[` strip + double memory injection — need
live MiniMax A/B before removal); full magic-number centralization and `entities.attrs` removal
(cosmetic). Security scope was intentionally minimal per the operator's decision (hosted for one
tester, not adversarial).

## Summary

- **11 Critical · 16 High · 21 Medium · 14 Low · 7 verified-OK**
- The demo is genuinely wired (real pipeline, no hand-inserted graph), and the flagship moves (proactive
  nudges, disclosure gating, anonymous polls) are Jason Yuan's Hivemind concept, independently built. The
  dangerous items are **not** magic numbers — they're a **fully open public API**, a **leak in the
  disclosure gate** (the one true differentiator), **silent empty replies**, and a proactive/poll engine
  that **duplicates, mis-attributes, and loops on cost**.
- **Calibration:** none of these are fatal to a laptop-only demo; several are fatal the moment it's a
  hosted URL or a real user.
- **Live-verified working:** emoji end-to-end (16-emoji reply, zero mojibake), clean single-response tool
  use, markdown on web, `/me`, anonymized poll creation, contradiction detection on the graph, FTS recall.

### Cross-cutting root causes (fixing these knocks out many findings)
1. **Status-lag as a rate-limit key.** Cooldown, dedup, and re-delivery all hinge on `status='sent'`,
   which depends on an async bee ack → every burst/duplicate/re-send bug.
2. **Fire-and-forget async escaping the `running` re-entrancy guard** (`deliverQueued`,
   `closeDuePolls`→`synthesizePoll` launched with `void` inside the heartbeat tick).
3. **Disclosure gate judged on a paraphrase, then bypassed at compose.**
4. **Polls are a parallel, ungoverned delivery path** (no mute/quiet-hours/undo/cooldown, weak anonymity).
5. **Critical state is in-memory** → caps ineffective on Render cold-starts; can't horizontally scale.

---

## 01 · Security

> These are the real demo-blockers the moment the URL is public or on a shared network. On a laptop-only
> demo they're latent; on Render they're live.

- [ ] **SEC-1 · CRITICAL — Entire admin/dashboard API is unauthenticated and public.**
  `http/api.ts` (only `/api/llm/chat` checks a token) · `app.use("*", cors())` :51 · `index.ts:24` binds 0.0.0.0.
  *Fails:* anyone reaching the port reads every member's raw memories (`GET /api/members/:id/memories`),
  harvests pairing codes + channel identities from `/api/members`, deletes members, or sets a provider
  `baseUrl` (SSRF via the LLM proxy). `CORS *` lets any site the operator visits `fetch()` and read it.
  *Fix:* operator secret/session on every non-bee route; scope CORS to the dashboard origin; bind internal
  servers to `127.0.0.1`, expose only via Caddy with auth.

- [ ] **SEC-2 · CRITICAL — A live bot token + bee auth tokens are committed to git.**
  `apps/bee/bee-data/bee.json` (tracked despite `.gitignore` — committed before the rule) + `outbox/*.json`.
  *Fix:* revoke the token now, `git rm --cached apps/bee/bee-data/`, purge from history, regenerate bee tokens.

- [ ] **SEC-3 · CRITICAL — Bee auth is trust-on-first-use → LLM proxy claimable + DoS.**
  `ws/bee-hub.ts:80-95` · beeIds minted client-side · no WS Origin check (`index.ts:32-41`).
  *Fails:* connect to public `/ws/bee`, `hello` with any invented `beeId`+token → accepted → free use of
  provider keys via `/api/llm/chat`. Connect first with a real bee's id → lock the real bee out (DoS).
  No Origin check = cross-site WebSocket hijacking.
  *Fix:* server-issued bee credentials (not TOFU), validate WS `Origin`, restrict `/ws/bee` to authed bees.

- [ ] **SEC-4 · CRITICAL — `/ws/dash` broadcasts live member data with zero auth.**
  `ws/dash-hub.ts`. Any page/host subscribes and receives `member.updated` (full records), presence, graph events.
  *Fix:* gate the dash socket behind the same operator auth as the dashboard API.

- [ ] **SEC-5 · HIGH — Pairing codes: brute-forceable, long-lived, readable.**
  `repo.ts:133` (plain lookup) · `bee-hub.ts:109` (no rate limit) · code space ≈31⁴≈9.2×10⁵ · 30-day reuse ·
  also readable from open `/api/members` (SEC-1).
  *Fix:* rate-limit + lock pairing attempts, shorten TTL, one-time-use codes, stop returning codes on list.

- [ ] **SEC-6 · MEDIUM — Encryption-at-rest is cosmetic; key sits beside ciphertext.**
  `crypto/keystore.ts:8-17` (`master.key` in the same dataDir as `hive.db`). AES-GCM mechanics themselves
  are correct (unique IV, verified tag). *Fix:* don't market as "encrypted secrets"; KMS/passphrase for prod.

- [ ] **SEC-7 · MEDIUM — `read_url`/`web_lookup`: unauth shared-quota DoS + no URL scheme check.**
  `http/api.ts:243-255` (unauth) · `tools/search.ts` (global 50/day cap, shared, resets on restart).
  *Fix:* auth the tool endpoints, per-member quota in the DB, validate the URL scheme.

---

## 02 · Privacy &amp; disclosure (the differentiator — and it leaks)

> The contextual-integrity gate is the thing Hivemind only *talks* about and you actually built — which is
> why these are the most important findings in the report: the gate is judged on a paraphrase and then
> bypassed on the outgoing text.

- [ ] **PRV-1 · CRITICAL — Partial-disclosure redaction is defeated at compose time.**
  `proactive/nudges.ts:117-119` → `prompts/proactive.ts:41-46` (raw `cand.reason` passed).
  *Fails:* compose gets the redacted `verdict.disclosed` **and** the raw unredacted `cand.reason`
  ("Why you're reaching out: …"). On `partial`, the compose LLM can re-emit the withheld fact. Every
  cross-member nudge. *Fix:* compose from **only** the disclosed string; never pass the raw reason past the gate.

- [ ] **PRV-2 · CRITICAL — Direct memory endpoint bypasses the disclosure gate.**
  `http/api.ts:290` `GET /api/members/:id/memories` (unauth, any id) · `agent-tools.ts:6-10` trust-boundary claim.
  *Fails:* the gate lives only in `buildContext`. This endpoint (and the `my_memories` tool) return raw,
  ungated memories for any member id, no caller binding. *Fix:* bind to the authed member; route cross-member
  reads through the disclosure agent.

- [ ] **PRV-3 · HIGH — Orchestrator pools everyone's private facts into one prompt, ungated.**
  `orchestrator.ts:26-36` · `social.ts:92-103` (`memberBriefs`, no privacy/salience filter) · fake
  `sourceMemoryIds:["orchestrator"]`. *Fix:* filter briefs by privacy prefs before the call; carry real
  source-memory ids into the disclosure record.

- [ ] **PRV-4 · HIGH — `/private` "off the record" is persisted locally + sent to the cloud summarizer.**
  `bee.ts:247` &amp; `:352` `appendSession` runs unconditionally; `offRecord` only skips display + graph.
  *Fails:* off-record turns hit the on-disk `.jsonl`, become history, and when the thread grows are fed to
  `summarize()` → cloud LLM → `compact.json`. The `/help` promise is false. *Fix:* gate `appendSession` on
  `offRecord`, or keep off-record turns in a volatile buffer excluded from compaction.

- [ ] **PRV-5 · LOW — Disclosure audit references memories the model never read; cache-key ambiguity.**
  `nudges.ts:101` (paraphrase only) vs `agent.ts:66` (records real memoryIds); `agent.ts:39-41` join
  `""`/`" "` so `["ab","c"]≡["a","bc"]`. *Fix:* feed the gate real source-memory text; delimit cache keys.

---

## 03 · Silent failures &amp; error handling

> The scariest class for a live demo: the bee says *nothing* and nobody sees an error. All reachable with
> MiniMax under load (which you already hit — 429/529).

- [ ] **ERR-1 · CRITICAL — Agent-loop `maxTurns` exhaustion → empty reply on every channel.**
  `agent/loop.ts:67` yields `turn_end,text:""`; narration-suppression already wiped `curTurn` → `done("")`.
  *Fails:* a 6-turn tool loop exits empty → web spinner vanishes with nothing; Telegram/Discord send `""`
  (rejected, swallowed) → silence. *Fix:* fall back to the last non-empty turn or a "let me get back to you";
  never `done("")`.

- [ ] **ERR-2 · CRITICAL — Mid-stream LLM errors are swallowed (in-band SSE `error`).**
  `http/api.ts:235-237` emits `{type:"error"}` inside a 200 stream; `loop.ts:34-43` ignores it;
  `chatViaHive` never throws. *Fails:* a provider outage mid-generation → empty/partial reply, honest
  fallback never fires. *Fix:* handle the `error` stream event in the loop; surface as thrown error / notice.

- [ ] **ERR-3 · HIGH — Unguarded identity/pair calls → unhandled rejection + dropped message when hive offline.**
  `bee.ts:125` `identityCheck`, `:147` `pair` (no try/catch); invoked fire-and-forget. *Fix:* wrap the
  identity/pair path; on hive-offline, tell the sender to retry.

- [ ] **ERR-4 · MEDIUM — Hive WS handler: unguarded `ingest`/`pair` + no `unhandledRejection` handler → poison message.**
  `ws/bee-hub.ts:104-130` (only `context.request` wrapped); hive-server has no global rejection handler.
  *Fails:* a throwing `ingest.turn` sends no `ingest.ack` → turn stays in `pendingTurns`, resent every
  reconnect forever. *Fix:* try/catch every WS case, always respond, add a global rejection handler.

- [ ] **ERR-5 · HIGH — One bad timezone kills the whole heartbeat tick.**
  `nudges.ts:205` `toLocaleTimeString(..,{timeZone})` throws `RangeError` on bad IANA; called at
  `heartbeat.ts:75` outside the per-member try. *Fix:* validate timezone on write; wrap `inQuietHours`;
  default UTC on parse failure.

---

## 04 · Proactive, nudge &amp; poll correctness

> The engine works in the happy path (verified live), but the rate-limits, dedup, and poll flow have real
> bugs — all traceable to root causes #1 and #2 in the Summary (status-lag rate-limits, and fire-and-forget
> async escaping the tick's re-entrancy guard).

- [ ] **PROA-1 · CRITICAL — Queued nudges re-delivered every tick until the bee acks → spam.**
  `nudges.ts:161-193` (no status change on success) + `:196-200` `deliverQueued` re-pushes every 15 min.
  *Fix:* mark `sent` optimistically on push (reconcile on ack/failure); don't re-push un-acked within a window.

- [ ] **PROA-2 · CRITICAL — Any user message within 3h is silently recorded as the poll answer.**
  `polling/polls.ts:107-116` (next user turn, zero content matching). *Fix:* require an explicit reply
  affordance (or classify relevance) before capturing an answer.

- [ ] **PROA-3 · CRITICAL — Poll synthesizes with a single answer → anonymity broken.**
  `polls.ts:119-143` (no minimum-respondent floor); `closeDuePolls` force-synthesizes at deadline with 0–1.
  *Fix:* require ≥3 answers to synthesize; otherwise expire quietly.

- [ ] **PROA-4 · CRITICAL — Stuck poll re-synthesizes forever → unbounded LLM cost.**
  `polls.ts:136-142` sets status back to `collecting` but never touches `closesAt`; `store.ts:106-112`
  returns it every tick. *Fix:* add a terminal `expired/failed` status + retry cap.

- [ ] **PROA-5 · CRITICAL — Re-entrant synthesis → double delivery to initiator.**
  `polls.ts:121` guard rejects only `done/cancelled`, not `synthesizing`; manual endpoint + new answer +
  overlapping tick race. *Fix:* guard against `synthesizing`; make status-check + call atomic.

- [ ] **PROA-6 · HIGH — Cooldown &amp; dedup key on lagging `sent` status → burst bypass + duplicates.**
  `store.ts:82-96`; implications + errands + both intro directions propose in one drain, none sent yet.
  *Fix:* count `queued`+`proposed` in cooldown/dedup; dedup at proposal time.

- [ ] **PROA-7 · HIGH — Polls bypass proactivity=off AND quiet hours (ungoverned channel).**
  `polls.ts:51-88` filters only `optOutOfPolling` + reachability. *Fix:* route poll asks through the same
  governance as nudges (mute, quiet hours, cooldown).

- [ ] **PROA-8 · HIGH — Approve endpoint has no status guard → re-deliver already-sent nudges.**
  `http/api.ts:362-364` unconditionally re-queues + `scheduleDelivery` for any id/status.
  *Fix:* only allow approve when current status is `proposed`.

- [ ] **PROA-9 · HIGH — Stacked polls mis-correlate answers; valid answers dropped.**
  `api.ts:334-348` (no `hasOpenPoll` guard) · `store.ts:80-87` returns only the oldest ask.
  *Fix:* one collecting poll per member at a time, or match answers to the most-recent ask.

- [ ] **PROA-10 · HIGH — `lastOrchestrator` is in-memory → orchestrator + poll fire on every restart.**
  `heartbeat.ts:15,66` resets to 0 on boot (unlike persisted `lastHeartbeatAt`). *Fix:* persist it in settings/DB.

- [ ] **PROA-11 · MEDIUM — Two-sided intro can be asymmetric with mismatched text.**
  `orchestrator.ts:49-73` (independent per-direction gate; same `op.reason` both ways).
  *Fix:* direction-specific reasons; consider only introing when both directions clear.

- [ ] **PROA-12 · MEDIUM — Weekly digest killed by cooldown, then blocked 7 days.**
  `heartbeat.ts:111-113` stamps `lastDigest` before awaiting `sendDigest` (subject to per-member cooldown).
  *Fix:* stamp only after a confirmed send; exempt the digest from the nudge cooldown.

- [ ] **PROA-13 · MEDIUM — Autonomous polls compute a synthesis that reaches nobody.**
  `orchestrator.ts:82` (`initiatorMemberId=null`) → `polls.ts:150` delivery gated on a non-null initiator.
  *Fix:* deliver group polls to the group or skip synthesis for them.

- [ ] **PROA-14 · MEDIUM — Salience gate can permanently bury quiet-but-important facts.**
  `implications.ts:36-40` (`HIVE_SALIENCE_MIN` 0.6) &amp; `errands.ts:20` (0.55); default salience ~0.5;
  marked `implications_at` so never reconsidered. *Fix:* reconsider on accumulation, not one-shot gating.

- [ ] **PROA-15 · MEDIUM — Undo-timer vs `deliverQueued` race → double send.**
  `nudges.ts:45-47` deletes from `pendingUndo` before delivering; an interleaving tick sees it absent + still
  `queued`. Restart during the undo window skips it. *Fix:* mark a transitional `delivering` status before send.

---

## 05 · Channel consistency (web / Telegram / Discord)

Content is identical (shared `bee.ts`), but rendering + delivery diverge.

- [ ] **CH-1 · HIGH — Long replies silently fail on Telegram (4096) and Discord (2000).**
  `channels/telegram.ts:63`, `discord.ts:22/53` (one send, no chunking; Discord error `.catch(()=>{})`).
  Hits `/constitution`, `/me`, long answers. *Fix:* chunk outgoing messages per channel limit.

- [ ] **CH-2 · HIGH — Markdown renders only on web; raw `**` leaks to Telegram, links differ on Discord.**
  `bee-ui/lib/markdown.tsx` (web only); Telegram no `parse_mode`; Discord renders `**` but not
  `[text](url)`/bullets the same. *Fix:* per-channel formatter (Telegram MarkdownV2/HTML with escaping, or strip).

- [ ] **CH-3 · HIGH — Web nudge dropped (not queued) when the tab is closed.**
  `channels/web.ts:55-58` throws "offline"; `bee.ts:379-393` persists only *after* a successful send.
  *Live-observed:* poll to offline vicky stuck `0/1`. *Fix:* persist the nudge to the display transcript
  regardless of live delivery.

- [ ] **CH-4 · MEDIUM — Nudge display append always targets the "main" thread.**
  `bee.ts:389` `sessionForMember(...)` defaults `tag="main"`. *Fix:* target the active session.

- [ ] **CH-5 · MEDIUM — Voice mode speaks raw markdown and can't be interrupted.**
  `bee-ui/useVoice.ts:87-97` (no markdown/URL stripping; recognition stops during synthesis, resumes on `onend`).
  *Fix:* strip markdown before TTS; keep recognition warm for barge-in.

- [ ] **CH-6 · LOW — No typing/thinking indicator on Telegram/Discord.**
  `delta()` is a no-op on non-web channels → those channels feel frozen. *Fix:* send a typing action.

---

## 06 · Data model, dead code &amp; state

- [ ] **DATA-1 · HIGH — Memory-level supersession unimplemented → contradictory memories surface.**
  `schema.sql:90` `superseded_by` only ever set to NULL; graph edges get invalidated, raw memory texts never do.
  *Live-observed:* `/me` returned "relocated Austin→Denver" AND "lives in Austin" AND "settling into New York"
  at once. *Fix:* supersede/soft-delete contradicted memories when their functional edge is invalidated.

- [ ] **DATA-2 · HIGH — Critical state is in-memory → caps ineffective on Render, can't horizontally scale.**
  LLM day-cap (`call.ts:10`), Exa cap (`search.ts:20`), `lastOrchestrator`, `lastDigest`, `pendingUndo`,
  extraction idle timers, `claimedChannels`. Render cold-starts every ~15 min → the 300/day + 50/day caps
  reset to 0 constantly. Two instances would double-nudge/double-cap. *Fix:* move caps + gates to the DB;
  idempotent cross-process delivery.

- [ ] **DATA-3 · MEDIUM — Embeddings/vector RAG entirely dead server-side — and a comment oversells it.**
  `embed()` never called by hive-server; no vec table; `dim`/`supportsEmbeddings` decorative; `demo.ts:44-46`
  comment claims "one dashboard click away" (no code path). *Fix:* delete the dead plumbing + the comment.

- [ ] **DATA-4 · MEDIUM — Ephemeral disk silently loses everything a real user configures.**
  `render.yaml` ephemeral disk; `keystore.ts` regenerates `master.key` each boot; demo survives only by
  re-baking `MINIMAX_API_KEY` from env. *Fix:* persistent disk, or a "config resets on restart" banner.

- [ ] **DATA-5 · LOW — Assorted smells.** `entities.attrs` dead field shown as `{}` · `GET /api/members`
  mutates (creates pairing codes) · `memberConnections(1000)` silent truncation · prune full-table churn every
  tick · dead `getDbLazy` wrapper. *Fix:* remove dead fields/wrappers; move code creation out of a GET; page
  connection scans; prune on a slower cadence.

---

## 07 · Extraction, errand &amp; content quality

- [ ] **QUAL-1 · MEDIUM — Errands fire on questions/negations and search the raw text.**
  `errands.ts:13-14` `WANT_RE` (no interrogative/negation handling); query = raw memory text.
  "do you *want* coffee?" / "I don't *want* a dog" both trigger a search + nudge. *Fix:* require an
  affirmative first-person want; extract the object as the query.

- [ ] **QUAL-2 · MEDIUM — Errand retry re-processes the whole batch → duplicate leads.**
  `queue.ts:55-64` retries 3×, re-running `runErrands` over all memoryIds; earlier proposals not yet `sent`
  so dedup misses. *Fix:* track processed memoryIds; mark before proposing.

- [ ] **QUAL-3 · MEDIUM — Digest generated in UTC, ignoring the member's timezone.**
  `heartbeat.ts:90` passes `new Date().toISOString()` regardless of `member.timezone` (quiet-hours honors it).
  *Fix:* localize the digest "now" to the member tz.

- [ ] **QUAL-4 · LOW — Relation normalization is a hand-curated synonym map.**
  `graph/relations.ts:5`. Any verb not listed isn't normalized → supersession/contradiction miss on paraphrase.
  *Fix:* broaden the map or add an LLM/normalization fallback.

- [ ] **QUAL-5 · LOW — English-only, no i18n, despite tracking each member's timezone.**
  All prompts/personas/commands/constitution hardcoded English. *Fix:* i18n layer if going multi-locale.

---

## 08 · Hardcoded values &amp; inconsistencies

No mocks/TODOs/fakes in real code paths — deliberate shortcuts are honestly tagged `ponytail:`.

- [x] **Model-name mismatch (real bug):** `render.yaml` set `HIVE_DEMO_MODEL=MiniMax-M2`, `demo.ts:38`
  defaulted to `MiniMax-M3`, `providers.ts` lists M3 first. *Resolved by the demo-scaffolding removal:*
  there's now one var, `HIVE_MODEL` (default `MiniMax-M3`), and `demo.ts` is gone.
- [x] **75s orchestrator kick** (`demo.ts:54`) — fragile magic delay tuned to "extraction is done." *Moot:*
  `demo.ts` and the seeded-conversation replay were removed; the graph now fills from real chats, not a boot kick.
- [ ] **Centralize buried thresholds:** dedup `0.82`, entity-merge `0.94`, hub cutoff `max(8,p90)`, BFS
  `depth 2/limit 12`, cooldown formula, retrieval `MAX_HITS 12 / recency 6`, graph render caps `3000`,
  `maxTurns 6`, many `LIMIT`s. Name them in one config module.
- [ ] **Hardcoded:** Discord permission bitmask `274877975552`, ports 4800/4801, Anthropic API version string
  in two places, provider URLs, Ollama localhost.
- [ ] **Default `autoApprove:true`** — proactive messages auto-send (20s undo) with no human in the loop out of
  the box. Fine for a demo; reconsider as a "production" default.
- [ ] **Silent-absence defaults:** no `MINIMAX_API_KEY` → `roleConfigured("social")` false → the whole
  proactive story silently never fires, no error. No `EXA_API_KEY` → errands/search silently degrade.
  Surface a clear startup warning.

---

## 09 · Introduced this session — debt to clean up

- [ ] **MINE-1 — Misleading "embeddings one click away" comment.** `demo.ts:44-46`. No code path uses an
  Ollama embeddings model. Remove it (see DATA-3).
- [ ] **MINE-2 — `cleanReply` strips a literal `[e~[`, a model-specific hack.** `bee.ts`. Silently corrupts any
  legit message containing that substring. The narration-suppression is the real fix; scope this tighter or remove.
- [ ] **MINE-3 — Memory injected twice per turn (system prompt + fake assistant turn).** `bee.ts:304-312` +
  `buildSystem:462-465`. Works around MiniMax's system-prompt under-weighting but ships the facts twice
  (wasted tokens / over-anchoring). Storage is clean (not persisted). Consider dropping from the system prompt.
- [x] **MINE-4 — Demo model default set to M3 but `render.yaml` left at M2.** *Resolved:* collapsed to a
  single `HIVE_MODEL` (default `MiniMax-M3`) when demo mode was removed (see §08).

---

## 10 · Gap to Jason Yuan's Hivemind

Hivemind = a multiplayer "Social Intelligence" living in X DMs, holding private 1:1s with many real people,
triangulating across them, proactively connecting/nudging — "narrator, not protagonist."

| Hivemind capability | Hive today | Gap |
|---|---|---|
| Private 1:1 with many people | ✓ Have | Bees per member, real |
| Triangulate across conversations | ✓ Have | Graph + orchestrator + connection-mining |
| "What do people really think about X?" | ◐ Have, buggy | ask_network works; anonymity floor + answer-capture bugs (§04) |
| Context + care (privacy) | ◐ Ahead but leaks | Real gate — but PRV-1/PRV-2 leak it. Fix these → genuinely ahead of Hivemind |
| Proactively initiate / connect strangers | ◐ Have, buggy | Works live; duplication/governance bugs (§04) |
| Lives where people already are (X DMs) | ✗ Missing | Web/Telegram/Discord; no X. Telegram is your closest "it texted me" channel |
| Talks to *real* humans at scale | ✗ Demo-only | 2–3 seeded members; can't horizontally scale (DATA-2) |
| "Narrator, not protagonist" restraint | ◐ Too chatty | Bee over-narrates/asks follow-ups; tune toward quieter, higher-signal |
| Real-world errands (the Riesling hunt) | ◐ Partial | web_lookup exists; needs EXA key + relevance fixes (QUAL-1) |

**Verdict:** conceptually strikingly close and *ahead on privacy* — the differentiator is real code, not a
manifesto. The gap is (a) fix the disclosure leak so the moat holds, (b) live where real people are, and
(c) the restraint/quality of a "social intelligence" vs a chatty assistant.

---

## 11 · What's genuinely solid (credit where due — don't re-investigate)

- ✅ **Durable ingest outbox** — idempotent by `turnId`, persisted, survives restart/reconnect.
- ✅ **Retrieval fail-closed** on cross-member disclosure while preserving own context.
- ✅ **Narration suppression** keeps only the final answer turn (its one gap is ERR-1).
- ✅ **AES-GCM mechanics** correct — unique IV per write, tag verified (weakness is key *placement*, SEC-6).
- ✅ **Multi-channel nudge status** — one channel's failure can't overwrite another's success.
- ✅ **Emoji &amp; unicode** — clean end-to-end through WS JSON, SSE, storage, display. Verified live.
- ✅ **No stubs/mocks/fakes** in real code paths — the debt is honestly tagged, not hidden.

---

## 12 · Suggested fix order

**Before a public/hosted demo (blockers)**
1. SEC-2 — revoke &amp; purge the committed token.
2. SEC-1 / SEC-3 / SEC-4 — auth the API + both WebSockets; bind internal servers to localhost.
3. PRV-1 / PRV-2 — close the disclosure-gate leak + the ungated memory endpoint (your differentiator).
4. ERR-1 / ERR-2 — never send an empty reply; surface mid-stream errors.

**Right after (quality &amp; trust)**
5. PROA-1 / PROA-6 — stop duplicate-nudge bursts (fix the status-lag rate-limit).
6. PROA-3 / PROA-4 / PROA-5 — poll anonymity floor + terminal state + re-entrancy guard.
7. PRV-4 — make `/private` actually private.
8. DATA-1 — supersede contradicted memories so `/me` and recall stop conflicting.
9. CH-1 / CH-2 — chunk + format per channel for true parity.

**Then (scale &amp; polish)**
10. DATA-2 / DATA-4 — move caps/state to the DB; persistent disk.
11. PROA-7…15, QUAL-* — governance, timezone, errand relevance.
12. §08/§09 — centralize magic numbers, fix the model-name mismatch, clean up introduced debt.

---

*Note on the counts: the summary figures are approximate severity groupings — several findings overlap
across the three passes and were deduplicated, and §08 (hardcoded) and §09 (introduced debt) are listed as
bullet clusters rather than individually-numbered items, so the exact itemized IDs won't sum precisely to
the headline totals. The audit was read-only; nothing in the codebase was changed to produce it.*
