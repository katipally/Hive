import type { EmbedRequest, ProviderId } from "./types.js";
import { openaiEmbed } from "./openai-compat.js";

// Only openai + ollama support embeddings; both use the OpenAI-compat /embeddings shape.
export async function embed(provider: ProviderId, req: EmbedRequest): Promise<number[][]> {
  if (provider !== "openai" && provider !== "ollama")
    throw new Error(`provider ${provider} has no embeddings`);
  return openaiEmbed(req);
}
