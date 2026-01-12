const PROVIDER_ENV_VARS: Record<string, readonly string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY", "OPEN_AI_APIKEY"],
  zai: ["ZAI_API_KEY", "Z_AI_API_KEY"],
} as const;

export function getLlmProviderFromModelId(modelId: string): string | null {
  const s = String(modelId || "").trim();
  if (!s) return null;
  const idx = s.indexOf("/");
  if (idx <= 0) return null;
  const provider = s.slice(0, idx).trim().toLowerCase();
  return provider || null;
}

export function getProviderRequiredEnvVars(provider: string): string[] {
  const p = String(provider || "").trim().toLowerCase();
  const v = PROVIDER_ENV_VARS[p];
  return v ? [...v] : [];
}

export function getModelRequiredEnvVars(modelId: string): string[] {
  const provider = getLlmProviderFromModelId(modelId);
  return provider ? getProviderRequiredEnvVars(provider) : [];
}

export function getRecommendedSecretNameForEnvVar(envVar: string): string | null {
  const k = String(envVar || "").trim();
  if (!k) return null;
  if (k === "ANTHROPIC_API_KEY") return "anthropic_api_key";
  if (k === "OPENAI_API_KEY" || k === "OPEN_AI_APIKEY") return "openai_api_key";
  if (k === "ZAI_API_KEY" || k === "Z_AI_API_KEY") return "z_ai_api_key";
  return null;
}
