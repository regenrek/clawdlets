import { describe, expect, it } from "vitest";

describe("clawdlets config migrate", () => {
  it("migrates v8 -> v9 (removes legacy keys, wires discord token ref)", async () => {
    const { migrateClawdletsConfigToV9 } = await import("../src/lib/clawdlets-config-migrate");

    const raw = {
      schemaVersion: 8,
      fleet: {
        guildId: "123",
        envSecrets: { ZAI_API_KEY: "z_ai_api_key" },
        modelSecrets: { openai: "openai_api_key" },
        botOrder: ["maren"],
        bots: {
          maren: {
            profile: { discordTokenSecret: "discord_token_maren" },
            clawdbot: { channels: { discord: { enabled: true } } },
          },
        },
      },
      hosts: { alpha: {} },
    };

    const res = migrateClawdletsConfigToV9(raw);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.warnings).toEqual([]);

    const migrated = res.migrated as any;
    expect(migrated.schemaVersion).toBe(9);
    expect(migrated.fleet.guildId).toBeUndefined();
    expect(migrated.fleet.envSecrets).toBeUndefined();
    expect(migrated.fleet.modelSecrets).toBeUndefined();

    expect(migrated.fleet.secretEnv.ZAI_API_KEY).toBe("z_ai_api_key");
    expect(migrated.fleet.secretEnv.OPENAI_API_KEY).toBe("openai_api_key");

    expect(migrated.fleet.bots.maren.profile.discordTokenSecret).toBeUndefined();
    expect(migrated.fleet.bots.maren.profile.secretEnv.DISCORD_BOT_TOKEN).toBe("discord_token_maren");
    expect(migrated.fleet.bots.maren.clawdbot.channels.discord.token).toBe("${DISCORD_BOT_TOKEN}");
  });

  it("warns on discordTokenSecret mismatch and keeps secretEnv", async () => {
    const { migrateClawdletsConfigToV9 } = await import("../src/lib/clawdlets-config-migrate");

    const raw = {
      schemaVersion: 8,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            profile: {
              secretEnv: { DISCORD_BOT_TOKEN: "discord_token_old" },
              discordTokenSecret: "discord_token_new",
            },
            clawdbot: { channels: { discord: { enabled: true } } },
          },
        },
      },
      hosts: { alpha: {} },
    };

    const res = migrateClawdletsConfigToV9(raw);
    const migrated = res.migrated as any;
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.warnings.some((w) => w.includes("discordTokenSecret differs"))).toBe(true);

    expect(migrated.fleet.bots.maren.profile.discordTokenSecret).toBeUndefined();
    expect(migrated.fleet.bots.maren.profile.secretEnv.DISCORD_BOT_TOKEN).toBe("discord_token_old");
    expect(migrated.fleet.bots.maren.clawdbot.channels.discord.token).toBe("${DISCORD_BOT_TOKEN}");
  });
});

