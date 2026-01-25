import { describe, it, expect } from "vitest";

describe("llm provider env", () => {
  it("parses provider from provider/model ids", async () => {
    const { getLlmProviderFromModelId } = await import("@clawdlets/shared/lib/llm-provider-env");
    expect(getLlmProviderFromModelId("")).toBe(null);
    expect(getLlmProviderFromModelId("glm-4.7")).toBe(null);
    expect(getLlmProviderFromModelId("/glm-4.7")).toBe(null);
    expect(getLlmProviderFromModelId("ZAI/glm-4.7")).toBe("zai");
    expect(getLlmProviderFromModelId("z.ai/glm-4.7")).toBe("zai");
    expect(getLlmProviderFromModelId("z-ai/glm-4.7")).toBe("zai");
  });

  it("returns required env vars for known providers and empty for unknown", async () => {
    const { getLlmProviderInfo, getProviderRequiredEnvVars, getModelRequiredEnvVars } = await import("@clawdlets/shared/lib/llm-provider-env");
    expect(getProviderRequiredEnvVars("unknown")).toEqual([]);
    expect(getProviderRequiredEnvVars("openai")).toEqual(["OPENAI_API_KEY"]);
    expect(getProviderRequiredEnvVars("minimax")).toEqual(["MINIMAX_API_KEY"]);
    expect(getModelRequiredEnvVars("anthropic/claude")).toEqual(["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"]);
    expect(getModelRequiredEnvVars("nope")).toEqual([]);
    expect(getLlmProviderInfo("openai-codex")?.auth).toBe("oauth");
  });

});
