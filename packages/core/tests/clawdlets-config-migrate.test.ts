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

  it("migrates v9 -> v10 (moves host ssh keys to fleet)", async () => {
    const { migrateClawdletsConfigToV10 } = await import("../src/lib/clawdlets-config-migrate");

    const raw = {
      schemaVersion: 9,
      fleet: {
        secretEnv: {},
        secretFiles: {},
        botOrder: [],
        bots: {},
      },
      hosts: {
        alpha: {
          sshAuthorizedKeys: ["ssh-ed25519 AAAATEST alpha"],
          sshKnownHosts: ["github.com ssh-ed25519 AAAATEST"],
        },
        beta: {
          sshAuthorizedKeys: ["ssh-ed25519 AAAATEST beta"],
        },
      },
    };

    const res = migrateClawdletsConfigToV10(raw);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);

    const migrated = res.migrated as any;
    expect(migrated.schemaVersion).toBe(10);
    expect(migrated.fleet.sshAuthorizedKeys).toEqual(
      expect.arrayContaining(["ssh-ed25519 AAAATEST alpha", "ssh-ed25519 AAAATEST beta"]),
    );
    expect(migrated.fleet.sshKnownHosts).toEqual(
      expect.arrayContaining(["github.com ssh-ed25519 AAAATEST"]),
    );
    expect(migrated.hosts.alpha.sshAuthorizedKeys).toBeUndefined();
    expect(migrated.hosts.alpha.sshKnownHosts).toBeUndefined();
  });

  it("migrates v10 -> v11 (cache + selfUpdate)", async () => {
    const { migrateClawdletsConfigToV11 } = await import("../src/lib/clawdlets-config-migrate");

    const raw = {
      schemaVersion: 10,
      fleet: {
        secretEnv: {},
        secretFiles: {},
        botOrder: [],
        bots: {},
      },
      hosts: {
        alpha: {
          cache: {
            garnix: {
              private: {
                enable: true,
                netrcSecret: "garnix_netrc",
                netrcPath: "/etc/nix/netrc",
                narinfoCachePositiveTtl: 123,
              },
            },
          },
          selfUpdate: {
            enable: true,
            interval: "30min",
            manifestUrl: "https://example.com/deploy/alpha/prod",
            publicKey: "key1",
            signatureUrl: "https://example.com/deploy/alpha/prod/latest.json.minisig",
          },
        },
      },
    };

    const res = migrateClawdletsConfigToV11(raw);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);

    const migrated = res.migrated as any;
    expect(migrated.schemaVersion).toBe(11);

    expect(migrated.hosts.alpha.cache.garnix).toBeUndefined();
    expect(migrated.hosts.alpha.cache.substituters).toEqual(expect.any(Array));
    expect(migrated.hosts.alpha.cache.trustedPublicKeys).toEqual(expect.any(Array));
    expect(migrated.hosts.alpha.cache.netrc).toEqual({
      enable: true,
      secretName: "garnix_netrc",
      path: "/etc/nix/netrc",
      narinfoCachePositiveTtl: 123,
    });

    expect(migrated.hosts.alpha.selfUpdate.manifestUrl).toBeUndefined();
    expect(migrated.hosts.alpha.selfUpdate.publicKey).toBeUndefined();
    expect(migrated.hosts.alpha.selfUpdate.signatureUrl).toBeUndefined();

    expect(migrated.hosts.alpha.selfUpdate.enable).toBe(true);
    expect(migrated.hosts.alpha.selfUpdate.interval).toBe("30min");
    expect(migrated.hosts.alpha.selfUpdate.baseUrl).toBe("https://example.com/deploy/alpha/prod");
    expect(migrated.hosts.alpha.selfUpdate.channel).toBe("prod");
    expect(migrated.hosts.alpha.selfUpdate.publicKeys).toEqual(["key1"]);
    expect(migrated.hosts.alpha.selfUpdate.allowUnsigned).toBe(false);
    expect(migrated.hosts.alpha.selfUpdate.allowRollback).toBe(false);
    expect(migrated.hosts.alpha.selfUpdate.healthCheckUnit).toBe("");
  });
});
