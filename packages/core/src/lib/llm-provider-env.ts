import providerInfoJson from "../assets/llm-providers.json" with { type: "json" };

export type LlmProviderAuth = "apiKey" | "oauth";

export type LlmProviderInfo = {
  auth: LlmProviderAuth;
  secretEnvVars: string[];
  configEnvVars: string[];
};

function normalizeProviderInfoMap(raw: unknown): {
  providers: Record<string, LlmProviderInfo>;
  aliasToProvider: Record<string, string>;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { providers: {}, aliasToProvider: {} };
  const providers: Record<string, LlmProviderInfo> = {};
  const aliasToProvider: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k || "").trim().toLowerCase();
    if (!key) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const info = v as Record<string, unknown>;
    const auth = info["auth"] === "oauth" ? "oauth" : "apiKey";
    const secretEnvVars = Array.isArray(info["secretEnvVars"]) ? (info["secretEnvVars"] as unknown[]) : [];
    const configEnvVars = Array.isArray(info["configEnvVars"]) ? (info["configEnvVars"] as unknown[]) : [];
    providers[key] = {
      auth,
      secretEnvVars: secretEnvVars.map((s) => String(s || "").trim()).filter(Boolean),
      configEnvVars: configEnvVars.map((s) => String(s || "").trim()).filter(Boolean),
    };
    const aliases = Array.isArray(info["aliases"]) ? (info["aliases"] as unknown[]) : [];
    for (const a of aliases) {
      const alias = String(a || "").trim().toLowerCase();
      if (!alias || alias === key) continue;
      aliasToProvider[alias] = key;
    }
  }
  return { providers, aliasToProvider };
}

const normalized = normalizeProviderInfoMap(providerInfoJson);
const PROVIDER_INFO = normalized.providers ?? {};
const PROVIDER_ALIASES = normalized.aliasToProvider ?? {};

function normalizeProviderId(provider: string): string {
  const p = String(provider || "").trim().toLowerCase();
  if (!p) return "";
  return PROVIDER_ALIASES[p] ?? p;
}

export function getLlmProviderFromModelId(modelId: string): string | null {
  const s = String(modelId || "").trim();
  if (!s) return null;
  const idx = s.indexOf("/");
  if (idx <= 0) return null;
  const provider = normalizeProviderId(s.slice(0, idx));
  return provider || null;
}

export function getLlmProviderInfo(provider: string): LlmProviderInfo | null {
  const p = normalizeProviderId(provider);
  if (!p) return null;
  return PROVIDER_INFO[p] ?? null;
}

export function getKnownLlmProviders(): string[] {
  return Object.keys(PROVIDER_INFO).sort();
}

export function getProviderRequiredEnvVars(provider: string): string[] {
  return getLlmProviderInfo(provider)?.secretEnvVars ?? [];
}

export function getModelRequiredEnvVars(modelId: string): string[] {
  const provider = getLlmProviderFromModelId(modelId);
  return provider ? getProviderRequiredEnvVars(provider) : [];
}
