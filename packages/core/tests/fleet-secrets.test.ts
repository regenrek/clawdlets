import { describe, it, expect } from "vitest";

describe("fleet secrets plan", () => {
  it("collects required secrets for zai/* models", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 8,
      fleet: {
        botOrder: ["maren"],
        bots: { maren: {} },
        modelSecrets: {
          zai: "z_ai_api_key",
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingSecretConfig).toEqual([]);
    expect(plan.secretNamesAll).toEqual(["z_ai_api_key"]);
    expect(plan.secretNamesRequired).toEqual(["z_ai_api_key"]);
  });

  it("flags missing modelSecrets entry for openai/* models", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 8,
      fleet: {
        botOrder: ["maren"],
        bots: { maren: {} },
        modelSecrets: {},
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingSecretConfig.some((m) => m.kind === "model" && m.provider === "openai")).toBe(true);
  });

  it("does not require modelSecrets entry for OAuth providers", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 8,
      fleet: {
        botOrder: ["maren"],
        bots: { maren: {} },
        modelSecrets: {},
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai-codex/gpt-5" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingSecretConfig.some((m) => m.kind === "model" && m.provider === "openai-codex")).toBe(false);
  });

  it("includes per-bot modelSecrets overrides for mixed providers", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 8,
      fleet: {
        botOrder: ["alpha", "beta"],
        modelSecrets: {
          zai: "z_ai_api_key",
        },
        bots: {
          alpha: {
            profile: {
              modelSecrets: { anthropic: "anthropic_api_key" },
            },
            clawdbot: {
              agents: { defaults: { model: { primary: "anthropic/claude-3-5-sonnet" } } },
            },
          },
          beta: {},
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingSecretConfig).toEqual([]);
    expect(plan.secretNamesRequired).toEqual(["anthropic_api_key", "z_ai_api_key"]);
  });

  it("requires discordTokenSecret when discord enabled", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 8,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            profile: { discordTokenSecret: "discord_token_maren" },
            clawdbot: {
              channels: { discord: { enabled: true } },
            },
          },
        },
        modelSecrets: { zai: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.secretNamesRequired).toContain("discord_token_maren");
  });

  it("flags missing discordTokenSecret when discord enabled", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 8,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            clawdbot: {
              channels: { discord: { enabled: true } },
            },
          },
        },
        modelSecrets: { zai: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingSecretConfig.some((m) => m.kind === "discord" && m.bot === "maren")).toBe(true);
  });
});
