import { describe, it, expect } from "vitest";

describe("fleet secrets plan", () => {
  it("collects required secrets for zai/* models", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
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
    expect(plan.missing).toEqual([]);
    expect(plan.secretNamesAll).toEqual(["z_ai_api_key"]);
    expect(plan.secretNamesRequired).toEqual(["z_ai_api_key"]);
    const requiredNames = plan.required.map((spec) => spec.name);
    expect(requiredNames).toContain("z_ai_api_key");
    expect(requiredNames).toContain("admin_password_hash");
  });

  it("flags missing secretEnv mapping for openai/* models", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
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
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "OPENAI_API_KEY")).toBe(true);
  });

  it("accepts legacy Z_AI_API_KEY mappings for zai/*", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
      fleet: {
        botOrder: ["maren"],
        bots: { maren: {} },
        secretEnv: { Z_AI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing).toEqual([]);
    expect(plan.secretNamesRequired).toContain("z_ai_api_key");
  });

  it("does not require secretEnv mapping for OAuth providers", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
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
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "OPENAI_API_KEY")).toBe(false);
    expect(plan.warnings.some((w) => w.kind === "auth" && w.provider === "openai-codex")).toBe(true);
  });

  it("warns on inline channel tokens with suggested env wiring", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            clawdbot: { channels: { discord: { enabled: true, token: "inline-token" } } },
          },
        },
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    const warning = plan.warnings.find((w) => w.kind === "inlineToken");
    expect(warning?.message).toMatch(/Inline discord token/i);
    expect(warning?.suggestion).toMatch(/DISCORD_BOT_TOKEN/);
  });

  it("includes hook + skill secret mappings from profile", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            profile: {
              hooks: { tokenSecret: "hooks_token" },
              skills: { entries: { "brave-search": { apiKeySecret: "brave_api_key" } } },
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
    expect(plan.missing).toEqual([]);
    expect(plan.secretNamesRequired).toEqual(expect.arrayContaining(["hooks_token", "brave_api_key"]));
    expect(plan.byBot.maren.envVarsRequired).toEqual(
      expect.arrayContaining(["CLAWDBOT_HOOKS_TOKEN", "CLAWDBOT_SKILL_BRAVE_SEARCH_API_KEY"]),
    );
  });

  it("warns on inline hooks + skill apiKey values", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            clawdbot: {
              hooks: { token: "inline-hook-token" },
              skills: { entries: { "brave-search": { apiKey: "inline-skill-key" } } },
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
    expect(plan.warnings.some((w) => w.kind === "inlineToken" && w.path === "hooks.token")).toBe(true);
    expect(plan.warnings.some((w) => w.kind === "inlineApiKey" && w.path === "skills.entries.brave-search.apiKey")).toBe(true);
  });

  it("includes per-bot secretEnv overrides for mixed providers", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
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
    expect(plan.missing).toEqual([]);
    expect(plan.secretNamesRequired).toEqual(["anthropic_api_key", "z_ai_api_key"]);
  });

  it("requires DISCORD_BOT_TOKEN mapping when referenced", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
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
      schemaVersion: 11,
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
    expect(plan.missing.some((m) => m.kind === "envVar" && m.bot === "maren" && m.envVar === "DISCORD_BOT_TOKEN")).toBe(true);
  });

  it("rejects host secretFiles targetPath outside /var/lib/clawdlets", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");

    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 11,
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
      }),
    ).toThrow(/targetPath must be under/i);
  });

  it("flags host secretFiles targetPath traversal", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");

    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 11,
        fleet: {
          botOrder: ["maren"],
          bots: { maren: {} },
          secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
          secretFiles: {
            netrc: { secretName: "garnix_netrc", targetPath: "/var/lib/clawdlets/../etc/shadow", mode: "0400" },
          },
        },
        hosts: {
          "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/must not contain/i);
  });

  it("flags invalid per-bot secretFiles targetPath", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
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
    expect(plan.missing.some((m) => m.kind === "secretFile" && m.scope === "bot" && m.bot === "maren" && m.fileId === "creds")).toBe(true);
  });

  it("flags per-bot secretFiles targetPath traversal", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");

    expect(() =>
      ClawdletsConfigSchema.parse({
        schemaVersion: 11,
        fleet: {
          botOrder: ["maren"],
          bots: {
            maren: {
              profile: {
                secretEnv: {},
                secretFiles: {
                creds: { secretName: "discord_token_maren", targetPath: "/var/lib/clawdlets/secrets/bots/maren/../etc/shadow", mode: "0400" },
                },
              },
            },
          },
          secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
        },
        hosts: {
          "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/must not contain/i);
  });

  it("does not mark whatsapp as stateful when explicitly disabled", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
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

  it("includes env vars from models.providers", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            clawdbot: {
              models: {
                providers: {
                  moonshot: { apiKey: "${MOONSHOT_API_KEY}" },
                },
              },
            },
          },
        },
        secretEnv: {},
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "MOONSHOT_API_KEY")).toBe(true);
  });

  it("includes fallback model provider keys", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            clawdbot: {
              agents: { defaults: { model: { primary: "openai/gpt-4o", fallbacks: ["anthropic/claude-3-5-sonnet"] } } },
            },
          },
        },
        secretEnv: {},
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "OPENAI_API_KEY")).toBe(true);
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "ANTHROPIC_API_KEY")).toBe(false);
    expect(plan.warnings.some((w) => w.kind === "auth" && w.provider === "anthropic")).toBe(true);
  });

  it("warns on inline discord token", async () => {
    const { ClawdletsConfigSchema } = await import("../src/lib/clawdlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawdletsConfigSchema.parse({
      schemaVersion: 11,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            clawdbot: {
              channels: { discord: { enabled: true, token: "inline-token" } },
            },
          },
        },
        secretEnv: {},
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "DISCORD_BOT_TOKEN")).toBe(true);
    expect(plan.warnings.some((w) => w.kind === "inlineToken" && w.path === "channels.discord.token")).toBe(true);
    expect(plan.warnings.some((w) => w.kind === "inlineToken" && w.suggestion?.includes("${DISCORD_BOT_TOKEN}"))).toBe(true);
  });

  it("suggests default secret names for env vars", async () => {
    const { suggestSecretNameForEnvVar } = await import("../src/lib/fleet-secrets-plan-helpers");

    expect(suggestSecretNameForEnvVar("OPENAI_API_KEY")).toBe("openai_api_key");
    expect(suggestSecretNameForEnvVar("DISCORD_BOT_TOKEN", "maren")).toBe("discord_token_maren");
  });
});
