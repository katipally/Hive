// Boot bootstrap: if a provider key is supplied via env, bake it into the keystore and
// point the model roles at it. This lets a hosted deploy come up with a working model
// without the key being typed into Settings by hand (and survive an ephemeral-disk
// restart). Operators can still bring their own keys/models from Settings at any time.
import { hasSecret, putSecret } from "./crypto/keystore.js";
import { setModelRole, setBaseUrl } from "./settings/settings.js";
import type { ModelRole } from "@hive/shared";

export function bakeProviderKeyFromEnv(): void {
  const key = process.env["MINIMAX_API_KEY"];
  if (!key || hasSecret("provider:minimax")) return;
  putSecret("provider:minimax", key);
  const base = process.env["HIVE_MINIMAX_BASE_URL"];
  if (base) setBaseUrl("minimax", base);
  const model = process.env["HIVE_MODEL"] ?? "MiniMax-M3";
  for (const role of ["chat", "extraction", "social"] as ModelRole[]) {
    setModelRole(role, { provider: "minimax", modelId: model });
  }
  console.log(`[hive] provider key baked from env, model roles → ${model}`);
}
