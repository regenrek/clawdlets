import { describe, expect, it } from "vitest";

describe("config patch channel presets", () => {
  it("applies discord preset (enabled + env token ref)", async () => {
    const { applyChannelPreset } = await import("../src/lib/config-patch");

    const res = applyChannelPreset({ clawdbot: {}, preset: "discord" });
    expect(res.warnings).toEqual([]);
    expect(res.clawdbot).toMatchObject({
      channels: { discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" } },
    });
  });

  it("rejects inline discord token values", async () => {
    const { applyChannelPreset } = await import("../src/lib/config-patch");

    expect(() =>
      applyChannelPreset({
        clawdbot: { channels: { discord: { enabled: true, token: "inline-token" } } },
        preset: "discord",
      }),
    ).toThrow(/channels\.discord\.token already set/);
  });

  it("applies slack preset (env refs for botToken + appToken)", async () => {
    const { applyChannelPreset } = await import("../src/lib/config-patch");

    const res = applyChannelPreset({ clawdbot: {}, preset: "slack" });
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
    const { applyChannelPreset } = await import("../src/lib/config-patch");

    const res = applyChannelPreset({ clawdbot: {}, preset: "whatsapp" });
    expect(res.clawdbot).toMatchObject({ channels: { whatsapp: { enabled: true } } });
    expect(res.warnings.join("\n")).toMatch(/stateful login/i);
  });
});

