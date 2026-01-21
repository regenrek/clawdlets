import { describe, it, expect } from "vitest";

describe("fleet secrets plan", () => {
  it("collects required secrets for zai/* models", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 9,
      fleet: {
        botOrder: ["maren"],
        bots: { maren: {} },
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
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

  it("flags missing secretEnv mapping for openai/* models", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 9,
      fleet: {
        botOrder: ["maren"],
        bots: { maren: {} },
        secretEnv: {},
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingSecretConfig.some((m) => m.kind === "envVar" && m.envVar === "OPENAI_API_KEY")).toBe(true);
  });

  it("does not require secretEnv mapping for OAuth providers", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 9,
      fleet: {
        botOrder: ["maren"],
        bots: { maren: {} },
        secretEnv: {},
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai-codex/gpt-5" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingSecretConfig.some((m) => m.kind === "envVar" && m.envVar === "OPENAI_API_KEY")).toBe(false);
  });

  it("includes per-bot secretEnv overrides for mixed providers", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 9,
      fleet: {
        botOrder: ["alpha", "beta"],
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
        bots: {
          alpha: {
            profile: {
              secretEnv: { ANTHROPIC_API_KEY: "anthropic_api_key" },
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

  it("requires DISCORD_BOT_TOKEN mapping when referenced", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 9,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            profile: { secretEnv: { DISCORD_BOT_TOKEN: "discord_token_maren" } },
            clawdbot: {
              channels: { discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" } },
            },
          },
        },
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.secretNamesRequired).toContain("discord_token_maren");
  });

  it("flags missing DISCORD_BOT_TOKEN mapping when referenced", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 9,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            clawdbot: {
              channels: { discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" } },
            },
          },
        },
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingSecretConfig.some((m) => m.kind === "envVar" && m.bot === "maren" && m.envVar === "DISCORD_BOT_TOKEN")).toBe(true);
  });

  it("flags invalid host secretFiles targetPath", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 9,
      fleet: {
        botOrder: ["maren"],
        bots: { maren: {} },
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
        secretFiles: {
          netrc: { secretName: "garnix_netrc", targetPath: "/srv/clawdbot/maren/credentials/netrc", mode: "0400" },
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingSecretConfig.some((m) => m.kind === "secretFile" && m.scope === "host" && m.fileId === "netrc")).toBe(true);
  });

  it("flags invalid per-bot secretFiles targetPath", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 9,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            profile: {
              secretEnv: {},
              secretFiles: {
                creds: { secretName: "discord_token_maren", targetPath: "/var/lib/clawdlets/secrets/discord_token_maren", mode: "0400" },
              },
            },
          },
        },
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missingSecretConfig.some((m) => m.kind === "secretFile" && m.scope === "bot" && m.bot === "maren" && m.fileId === "creds")).toBe(true);
  });

  it("does not mark whatsapp as stateful when explicitly disabled", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 9,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            clawdbot: { channels: { whatsapp: { enabled: false } } },
          },
        },
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.byBot.maren.statefulChannels).toEqual([]);
  });
});
