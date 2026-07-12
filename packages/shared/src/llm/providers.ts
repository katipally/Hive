import type { ProviderId, ProviderSpec } from "./types.js";

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    api: "anthropic-messages",
    defaultBaseUrl: "https://api.anthropic.com",
    listPath: "/v1/models",
    needsKey: true,
    supportsEmbeddings: false,
  },
  minimax: {
    id: "minimax",
    label: "MiniMax",
    // Anthropic-compatible endpoint (openclaw-proven for tool calling).
    // Intl: api.minimax.io, CN: api.minimaxi.com. Base URL is overridable in settings.
    api: "anthropic-messages",
    defaultBaseUrl: "https://api.minimax.io/anthropic",
    listPath: "https://api.minimax.io/v1/models",
    needsKey: true,
    supportsEmbeddings: false,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    api: "openai-compat",
    defaultBaseUrl: "https://api.openai.com/v1",
    listPath: "/models",
    needsKey: true,
    supportsEmbeddings: true,
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    // Chat via OpenAI-compat at {base}/v1; model listing via native /api/tags.
    api: "openai-compat",
    defaultBaseUrl: "http://localhost:11434",
    listPath: "/api/tags",
    needsKey: false,
    supportsEmbeddings: true,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

// MiniMax has no reliable public model-list endpoint; keep a static fallback. M3 leads
// to match the hosted demo default (render.yaml / demo.ts), so the fallback picks the
// same model the demo is configured for.
export const MINIMAX_FALLBACK_MODELS = [
  "MiniMax-M3",
  "MiniMax-M2",
  "MiniMax-Text-01",
  "abab6.5s-chat",
];
