import { getSecret } from "../crypto/keystore.js";

// Real-world web search via Exa, shared by the /api/tools/web-search endpoint (bee
// `web_lookup` tool) and the proactive errand runner — so the search + cap logic
// lives in exactly one place. Key stays server-side; { configured:false } when no
// key is set so callers degrade honestly instead of inventing answers.
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

// ponytail: in-memory daily counter, resets on restart — a soft backstop on the
// shared Exa key, same pattern as the LLM day-cap.
let windowStart = Date.now();
let count = 0;
const CAP = Number(process.env["HIVE_SEARCH_DAILY_CAP"] ?? 50);

export async function webSearch(query: string): Promise<SearchResponse> {
  const q = query.trim();
  if (!q) return { configured: true, results: [], error: "empty query" };
  const key = getSecret("provider:exa") ?? process.env["EXA_API_KEY"];
  if (!key) return { configured: false, results: [] };

  const now = Date.now();
  if (now - windowStart > 86_400_000) {
    windowStart = now;
    count = 0;
  }
  if (count >= CAP) return { configured: true, results: [], error: "search daily limit reached" };
  count++;

  try {
    const r = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ query: q, numResults: 5, type: "auto", contents: { text: { maxCharacters: 500 } } }),
    });
    if (!r.ok) return { configured: true, results: [], error: `search failed (${r.status})` };
    const data = (await r.json()) as { results?: { title?: string; url: string; text?: string }[] };
    return {
      configured: true,
      results: (data.results ?? []).slice(0, 5).map((x) => ({
        title: x.title ?? x.url,
        url: x.url,
        snippet: (x.text ?? "").trim().slice(0, 400),
      })),
    };
  } catch (e) {
    return { configured: true, results: [], error: (e as Error).message };
  }
}

export interface PageContent {
  url: string;
  title: string;
  text: string;
}

// Fetch the full text of one URL (e.g. a link a member shared) via Exa /contents.
// Shares the same daily cap as search.
export async function readUrl(url: string): Promise<{ configured: boolean; page?: PageContent; error?: string }> {
  const u = url.trim();
  if (!u) return { configured: true, error: "empty url" };
  const key = getSecret("provider:exa") ?? process.env["EXA_API_KEY"];
  if (!key) return { configured: false };

  const now = Date.now();
  if (now - windowStart > 86_400_000) {
    windowStart = now;
    count = 0;
  }
  if (count >= CAP) return { configured: true, error: "search daily limit reached" };
  count++;

  try {
    const r = await fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ ids: [u], text: { maxCharacters: 4000 } }),
    });
    if (!r.ok) return { configured: true, error: `fetch failed (${r.status})` };
    const data = (await r.json()) as { results?: { url: string; title?: string; text?: string }[] };
    const res = data.results?.[0];
    if (!res) return { configured: true, error: "no readable content" };
    return { configured: true, page: { url: res.url, title: res.title ?? res.url, text: (res.text ?? "").slice(0, 4000) } };
  } catch (e) {
    return { configured: true, error: (e as Error).message };
  }
}
