import type { ModelInfo, ProviderId } from "./types.js";
import { PROVIDERS, MINIMAX_FALLBACK_MODELS } from "./providers.js";

// Fetch the live model list for a provider using a stored key + optional base override.
export async function listModels(
  provider: ProviderId,
  apiKey: string | undefined,
  baseUrl?: string,
): Promise<ModelInfo[]> {
  const spec = PROVIDERS[provider];
  const base = (baseUrl ?? spec.defaultBaseUrl).replace(/\/$/, "");

  if (provider === "ollama") {
    // native /api/tags; strip trailing /v1 if present
    const root = base.replace(/\/v1$/, "");
    const res = await fetch(`${root}/api/tags`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) throw new Error(`ollama tags ${res.status}`);
    const json = (await res.json()) as { models: { name: string }[] };
    return json.models.map((m) => ({ id: m.name, provider, supportsTools: true }));
  }

  if (provider === "anthropic") {
    const res = await fetch(`${base}/v1/models`, {
      headers: { "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) throw new Error(`anthropic models ${res.status}`);
    const json = (await res.json()) as { data: { id: string; display_name?: string }[] };
    return json.data.map((m) => ({
      id: m.id,
      provider,
      label: m.display_name,
      supportsReasoning: true,
      supportsTools: true,
    }));
  }

  if (provider === "minimax") {
    try {
      const url = spec.listPath.startsWith("http") ? spec.listPath : `${base}${spec.listPath}`;
      const res = await fetch(url, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data: { id: string }[] };
      if (json.data?.length) return json.data.map((m) => ({ id: m.id, provider, supportsTools: true }));
    } catch {
      /* fall through to static list */
    }
    return MINIMAX_FALLBACK_MODELS.map((id) => ({ id, provider, supportsTools: true }));
  }

  // openai
  const res = await fetch(`${base}/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`openai models ${res.status}`);
  const json = (await res.json()) as { data: { id: string }[] };
  return json.data
    .map((m) => ({
      id: m.id,
      provider,
      supportsReasoning: /^(o\d|gpt-5|gpt-4\.1)/.test(m.id),
      supportsTools: true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
