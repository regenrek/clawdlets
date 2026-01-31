import { describe, expect, it } from "vitest";

describe("config patch channel presets", () => {
  it("applies discord preset (enabled + env token ref)", async () => {
    const { applyCapabilityPreset, getChannelCapabilityPreset } = await import("../src/lib/capability-presets");

    const res = applyCapabilityPreset({ clawdbot: {}, preset: getChannelCapabilityPreset("discord") });
    expect(res.warnings).toEqual([]);
    expect(res.clawdbot).toMatchObject({
      channels: { discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" } },
    });
  });

  it("rejects inline discord token values", async () => {
    const { applyCapabilityPreset, getChannelCapabilityPreset } = await import("../src/lib/capability-presets");

    expect(() =>
      applyCapabilityPreset({
        clawdbot: { channels: { discord: { enabled: true, token: "inline-token" } } },
        preset: getChannelCapabilityPreset("discord"),
      }),
    ).toThrow(/channels\.discord\.token already set/);
  });

  it("applies slack preset (env refs for botToken + appToken)", async () => {
    const { applyCapabilityPreset, getChannelCapabilityPreset } = await import("../src/lib/capability-presets");

    const res = applyCapabilityPreset({ clawdbot: {}, preset: getChannelCapabilityPreset("slack") });
    expect(res.warnings).toEqual([]);
    expect(res.clawdbot).toMatchObject({
      channels: {
        slack: {
          enabled: true,
          botToken: "${SLACK_BOT_TOKEN}",
          appToken: "${SLACK_APP_TOKEN}",
        },
      },
    });
  });

  it("adds a warning for whatsapp preset (stateful login)", async () => {
    const { applyCapabilityPreset, getChannelCapabilityPreset } = await import("../src/lib/capability-presets");

    const res = applyCapabilityPreset({ clawdbot: {}, preset: getChannelCapabilityPreset("whatsapp") });
    expect(res.clawdbot).toMatchObject({ channels: { whatsapp: { enabled: true } } });
    expect(res.warnings.join("\n")).toMatch(/stateful login/i);
  });
});

describe("config patch security defaults", () => {
  it("sets logging.redactSensitive and session.dmScope", async () => {
    const { applySecurityDefaults } = await import("../src/lib/config-patch");

    const res = applySecurityDefaults({ clawdbot: {} });
    expect(res.clawdbot).toMatchObject({
      logging: { redactSensitive: "tools" },
      session: { dmScope: "per-channel-peer" },
    });
    expect(res.changes.map((c) => c.path).sort()).toEqual(["logging.redactSensitive", "session.dmScope"]);
  });

  it("hardens open WhatsApp DMs and group policy", async () => {
    const { applySecurityDefaults } = await import("../src/lib/config-patch");

    const res = applySecurityDefaults({
      clawdbot: {
        channels: {
          whatsapp: {
            enabled: true,
            dmPolicy: "open",
            allowFrom: ["*"],
          },
        },
      },
    });
    expect(res.clawdbot).toMatchObject({
      channels: {
        whatsapp: {
          dmPolicy: "pairing",
          groupPolicy: "allowlist",
        },
      },
    });
    expect(res.warnings.join("\n")).toMatch(/changed dmPolicy from "open" to "pairing"/i);
  });
});
