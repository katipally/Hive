import { getSecret } from "../crypto/keystore.js";
import { getKVNum, setKVNum } from "../db/kv.js";

// Real-world web search + page reading, shared by the /api/tools endpoints (bee
// `web_lookup` / `read_url` tools) and the proactive errand runner — so the search +
// cap logic lives in one place.
//
// KEYLESS BY DEFAULT: search works with no API key by scraping DuckDuckGo's HTML
// endpoint (the technique production agents like openclaw use); page reading uses Jina's
// free reader with a raw-fetch fallback. If an Exa key IS present it's used instead as a
// higher-quality upgrade. So `configured` is always true — the bee can always look things
// up, and errands never silently no-op for lack of a key.
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}
export interface SearchResponse {
  configured: boolean;
  results: SearchResult[];
  error?: string;
}

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15_000;

// Daily counter persisted in the DB (survives restart) — a soft backstop / politeness cap
// on scraping and the shared Exa key. Returns false when the cap is hit.
const CAP = Number(process.env["HIVE_SEARCH_DAILY_CAP"] ?? 50);
function chargeSearch(): boolean {
  const now = Date.now();
  let windowStart = getKVNum("search:capWindowStart") ?? now;
  let count = getKVNum("search:capCount") ?? 0;
  if (now - windowStart > 86_400_000) {
    windowStart = now;
    count = 0;
  }
  if (count >= CAP) return false;
  setKVNum("search:capWindowStart", windowStart);
  setKVNum("search:capCount", count + 1);
  return true;
}

function exaKey(): string | undefined {
  return getSecret("provider:exa") ?? process.env["EXA_API_KEY"];
}

// ---- search ----
export async function webSearch(query: string): Promise<SearchResponse> {
  const q = query.trim();
  if (!q) return { configured: true, results: [], error: "empty query" };
  if (!chargeSearch()) return { configured: true, results: [], error: "search daily limit reached" };

  const key = exaKey();
  if (key) {
    try {
      return { configured: true, results: await exaSearch(q, key) };
    } catch {
      /* Exa failed — fall through to the keyless path rather than failing the search */
    }
  }
  try {
    return { configured: true, results: await keylessSearch(q) };
  } catch (e) {
    return { configured: true, results: [], error: (e as Error).message };
  }
}

async function exaSearch(q: string, key: string): Promise<SearchResult[]> {
  const r = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ query: q, numResults: 5, type: "auto", contents: { text: { maxCharacters: 500 } } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`exa ${r.status}`);
  const data = (await r.json()) as { results?: { title?: string; url: string; text?: string }[] };
  return (data.results ?? []).slice(0, 5).map((x) => ({ title: x.title ?? x.url, url: x.url, snippet: (x.text ?? "").trim().slice(0, 400) }));
}

// Keyless: DuckDuckGo HTML endpoint → (optional) a self-hosted SearXNG if configured.
async function keylessSearch(q: string): Promise<SearchResult[]> {
  try {
    const hits = await ddgSearch(q);
    if (hits.length) return hits;
  } catch {
    /* DDG rate-limited or challenged — try SearXNG if available */
  }
  const searx = process.env["HIVE_SEARXNG_URL"];
  if (searx) return searxSearch(q, searx);
  return [];
}

async function ddgSearch(q: string): Promise<SearchResult[]> {
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kp=-1`, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`ddg ${r.status}`);
  const html = await r.text();
  const results = parseDdg(html);
  if (results.length === 0 && /challenge-form|g-recaptcha|are you a human/i.test(html)) {
    throw new Error("ddg bot challenge");
  }
  return results;
}

function parseDdg(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const snippets: string[] = [];
  const snipRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = snipRe.exec(html)); ) snippets.push(stripHtml(m[1]!));
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let i = 0;
  for (let m; (m = linkRe.exec(html)) && out.length < 5; i++) {
    const url = decodeUddg(m[1]!);
    const title = stripHtml(m[2]!);
    if (url && title) out.push({ title, url, snippet: snippets[i] ?? "" });
  }
  return out;
}

// DDG wraps target links as //duckduckgo.com/l/?uddg=<real-url> — recover the real URL.
function decodeUddg(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) return decodeURIComponent(m[1]!);
  return href.startsWith("//") ? "https:" + href : href;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

async function searxSearch(q: string, base: string): Promise<SearchResult[]> {
  const r = await fetch(`${base.replace(/\/$/, "")}/search?format=json&q=${encodeURIComponent(q)}`, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`searxng ${r.status}`);
  const data = (await r.json()) as { results?: { title?: string; url: string; content?: string }[] };
  return (data.results ?? []).slice(0, 5).map((x) => ({ title: x.title ?? x.url, url: x.url, snippet: (x.content ?? "").slice(0, 400) }));
}

// ---- page reading ----
export interface PageContent {
  url: string;
  title: string;
  text: string;
}

const MAX_PAGE_CHARS = 4000;

export async function readUrl(url: string): Promise<{ configured: boolean; page?: PageContent; error?: string }> {
  const u = url.trim();
  if (!u) return { configured: true, error: "empty url" };
  // Only fetch real web pages — no file://, data:, javascript:, etc.
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return { configured: true, error: "not a valid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { configured: true, error: "only http(s) URLs can be read" };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { configured: true, error: "that address isn't allowed" }; // SSRF guard
  }
  if (!chargeSearch()) return { configured: true, error: "search daily limit reached" };

  const key = exaKey();
  if (key) {
    try {
      return { configured: true, page: await exaContents(u, key) };
    } catch {
      /* fall through to keyless read */
    }
  }
  try {
    return { configured: true, page: await keylessRead(parsed) };
  } catch (e) {
    return { configured: true, error: (e as Error).message };
  }
}

async function exaContents(u: string, key: string): Promise<PageContent> {
  const r = await fetch("https://api.exa.ai/contents", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ ids: [u], text: { maxCharacters: MAX_PAGE_CHARS } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`exa ${r.status}`);
  const data = (await r.json()) as { results?: { url: string; title?: string; text?: string }[] };
  const res = data.results?.[0];
  if (!res) throw new Error("no readable content");
  return { url: res.url, title: res.title ?? res.url, text: (res.text ?? "").slice(0, MAX_PAGE_CHARS) };
}

// Keyless: Jina's free reader returns clean markdown for any URL (handles JS pages); if it
// fails, fall back to a raw fetch + tag strip.
async function keylessRead(parsed: URL): Promise<PageContent> {
  try {
    const r = await fetch(`https://r.jina.ai/${parsed.href}`, {
      headers: { "user-agent": UA, accept: "text/plain" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.ok) {
      const text = (await r.text()).slice(0, MAX_PAGE_CHARS);
      if (text.trim()) return { url: parsed.href, title: firstLine(text) || parsed.hostname, text };
    }
  } catch {
    /* fall through to raw fetch */
  }
  const r = await fetch(parsed.href, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`fetch failed (${r.status})`);
  const html = (await r.text()).slice(0, 1_000_000);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? parsed.hostname;
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  return { url: parsed.href, title: stripHtml(title), text: stripHtml(body).slice(0, MAX_PAGE_CHARS) };
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim())?.trim() ?? "").replace(/^#+\s*/, "").slice(0, 120);
}

// Block loopback / private / link-local / cloud-metadata targets so the reader can't be
// pointed at internal services (SSRF). Best-effort on the literal host — DNS rebinding is
// out of scope for a demo, but the obvious internal addresses are refused.
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 127 || a === 10 || // this-host, loopback, private
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local + 169.254.169.254 metadata
    (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
  );
}
