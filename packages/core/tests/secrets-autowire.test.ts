import { describe, expect, it } from "vitest";

describe("secrets autowire", () => {
  it("plans stable mappings with deterministic ordering", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { planSecretsAutowire } = await import("../src/lib/secrets-autowire");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
      fleet: {
        botOrder: ["alpha", "beta"],
        secretEnv: {},
        bots: {
          alpha: {
            clawdbot: {
              channels: { discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" } },
            },
          },
          beta: {
            clawdbot: {
              channels: { telegram: { enabled: true, botToken: "${TELEGRAM_BOT_TOKEN}" } },
            },
          },
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const plan = planSecretsAutowire({ config: cfg, hostName: "clawdbot-fleet-host" });
    const summary = plan.updates.map((u) => `${u.envVar}:${u.bot}:${u.scope}:${u.secretName}`);
    expect(summary).toEqual([
      "DISCORD_BOT_TOKEN:alpha:bot:discord_token_alpha",
      "OPENAI_API_KEY:alpha:fleet:openai_api_key",
      "TELEGRAM_BOT_TOKEN:beta:bot:telegram_bot_token_beta",
    ]);
  });

  it("no-ops when already wired", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { planSecretsAutowire } = await import("../src/lib/secrets-autowire");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
      fleet: {
        botOrder: ["maren"],
        secretEnv: { OPENAI_API_KEY: "openai_api_key" },
        bots: {
          maren: {
            profile: { secretEnv: { DISCORD_BOT_TOKEN: "discord_token_maren" } },
            clawdbot: {
              channels: { discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" } },
            },
          },
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const plan = planSecretsAutowire({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.updates).toEqual([]);
  });
});
