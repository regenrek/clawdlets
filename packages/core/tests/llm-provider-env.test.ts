import { describe, it, expect } from "vitest";

describe("llm provider env", () => {
  it("parses provider from provider/model ids", async () => {
    const { getLlmProviderFromModelId } = await import("../src/lib/llm-provider-env");
    expect(getLlmProviderFromModelId("")).toBe(null);
    expect(getLlmProviderFromModelId("glm-4.7")).toBe(null);
    expect(getLlmProviderFromModelId("/glm-4.7")).toBe(null);
    expect(getLlmProviderFromModelId("ZAI/glm-4.7")).toBe("zai");
  });

  it("returns required env vars for known providers and empty for unknown", async () => {
    const { getProviderRequiredEnvVars, getModelRequiredEnvVars } = await import("../src/lib/llm-provider-env");
    expect(getProviderRequiredEnvVars("unknown")).toEqual([]);
    expect(getProviderRequiredEnvVars("openai")).toEqual(["OPENAI_API_KEY", "OPEN_AI_APIKEY"]);
    expect(getModelRequiredEnvVars("anthropic/claude")).toEqual(["ANTHROPIC_API_KEY"]);
    expect(getModelRequiredEnvVars("nope")).toEqual([]);
  });

  it("suggests canonical secret names for known env vars", async () => {
    const { getRecommendedSecretNameForEnvVar } = await import("../src/lib/llm-provider-env");
    expect(getRecommendedSecretNameForEnvVar("")).toBe(null);
    expect(getRecommendedSecretNameForEnvVar("ANTHROPIC_API_KEY")).toBe("anthropic_api_key");
    expect(getRecommendedSecretNameForEnvVar("OPENAI_API_KEY")).toBe("openai_api_key");
    expect(getRecommendedSecretNameForEnvVar("OPEN_AI_APIKEY")).toBe("openai_api_key");
    expect(getRecommendedSecretNameForEnvVar("Z_AI_API_KEY")).toBe("z_ai_api_key");
    expect(getRecommendedSecretNameForEnvVar("NOPE")).toBe(null);
  });
});

