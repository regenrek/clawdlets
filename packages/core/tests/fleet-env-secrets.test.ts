import { describe, it, expect } from "vitest";

describe("fleet envSecrets plan", () => {
  it("collects required secrets for zai/* models", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetEnvSecretsPlan } = await import("../src/lib/fleet-env-secrets");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 6,
      fleet: {
        bots: ["maren"],
        envSecrets: {
          ZAI_API_KEY: "z_ai_api_key",
          Z_AI_API_KEY: "z_ai_api_key",
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetEnvSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingEnvSecretMappings).toEqual([]);
    expect(plan.secretNamesAll).toEqual(["z_ai_api_key"]);
    expect(plan.secretNamesRequired).toEqual(["z_ai_api_key"]);
    expect(plan.envVarsBySecretName["z_ai_api_key"]).toEqual(["ZAI_API_KEY", "Z_AI_API_KEY"]);
  });

  it("flags missing OPEN_AI_APIKEY mapping for openai/* models", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetEnvSecretsPlan } = await import("../src/lib/fleet-env-secrets");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 6,
      fleet: {
        bots: ["maren"],
        envSecrets: {
          OPENAI_API_KEY: "openai_api_key",
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const plan = buildFleetEnvSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingEnvSecretMappings.some((m) => m.bot === "maren" && m.envVar === "OPEN_AI_APIKEY")).toBe(true);
    expect(plan.secretNamesRequired).toEqual(["openai_api_key"]);
  });

  it("includes per-bot model overrides when collecting required secrets", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetEnvSecretsPlan } = await import("../src/lib/fleet-env-secrets");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 6,
      fleet: {
        bots: ["alpha", "beta"],
        envSecrets: {
          ZAI_API_KEY: "z_ai_api_key",
          Z_AI_API_KEY: "z_ai_api_key",
          ANTHROPIC_API_KEY: "anthropic_api_key",
        },
        botOverrides: {
          alpha: {
            passthrough: { agents: { defaults: { modelPrimary: "anthropic/claude-3-5-sonnet" } } },
          },
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetEnvSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingEnvSecretMappings).toEqual([]);
    expect(plan.secretNamesRequired).toEqual(["anthropic_api_key", "z_ai_api_key"]);
  });
});
