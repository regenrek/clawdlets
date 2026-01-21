import { describe, it, expect } from "vitest";

describe("secrets-init UX helpers", () => {
  it("buildSecretsInitTemplate includes secrets and optional tailscale key", async () => {
    const { buildSecretsInitTemplate } = await import("../src/lib/secrets-init");
    const out = buildSecretsInitTemplate({ requiresTailscaleAuthKey: true, secrets: { discord_token_maren: "<REPLACE>" } });
    expect(out.adminPasswordHash).toMatch(/REPLACE_WITH_YESCRYPT_HASH/);
    expect(out.tailscaleAuthKey).toMatch(/REPLACE_WITH_TSKEY_AUTH/);
    expect(Object.keys(out.secrets)).toEqual(["discord_token_maren"]);
  });

  it("buildSecretsInitTemplate omits tailscale key when not required", async () => {
    const { buildSecretsInitTemplate } = await import("../src/lib/secrets-init");
    const out = buildSecretsInitTemplate({ requiresTailscaleAuthKey: false, secrets: {} });
    expect("tailscaleAuthKey" in out).toBe(false);
  });

  it("buildSecretsInitTemplate defaults secrets to {}", async () => {
    const { buildSecretsInitTemplate } = await import("../src/lib/secrets-init");
    const out = buildSecretsInitTemplate({ requiresTailscaleAuthKey: false });
    expect(out.secrets).toEqual({});
  });
});
