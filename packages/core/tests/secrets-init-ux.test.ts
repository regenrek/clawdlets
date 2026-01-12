import { describe, it, expect } from "vitest";

describe("secrets-init UX helpers", () => {
  it("buildSecretsInitTemplate includes bot ids and optional tailscale key", async () => {
    const { buildSecretsInitTemplate } = await import("../src/lib/secrets-init");
    const out = buildSecretsInitTemplate({ bots: ["maren", "sonja"], requiresTailscaleAuthKey: true });
    expect(out.adminPasswordHash).toMatch(/REPLACE_WITH_YESCRYPT_HASH/);
    expect(out.tailscaleAuthKey).toMatch(/REPLACE_WITH_TSKEY_AUTH/);
    expect(out.zAiApiKey).toBe("<OPTIONAL>");
    expect(Object.keys(out.discordTokens)).toEqual(["maren", "sonja"]);
  });

  it("buildSecretsInitTemplate omits tailscale key when not required", async () => {
    const { buildSecretsInitTemplate } = await import("../src/lib/secrets-init");
    const out = buildSecretsInitTemplate({ bots: ["maren"], requiresTailscaleAuthKey: false });
    expect("tailscaleAuthKey" in out).toBe(false);
  });

  it("buildSecretsInitTemplate trims and dedupes bots", async () => {
    const { buildSecretsInitTemplate } = await import("../src/lib/secrets-init");
    const out = buildSecretsInitTemplate({ bots: [" maren ", "maren", "", "sonja"], requiresTailscaleAuthKey: false });
    expect(Object.keys(out.discordTokens)).toEqual(["maren", "sonja"]);
  });
});

