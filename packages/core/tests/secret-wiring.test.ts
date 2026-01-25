import { describe, expect, it } from "vitest";

describe("secret wiring targetPath validation", () => {
  it("rejects path traversal segments", async () => {
    const { SecretFileSpecSchema } = await import("../src/lib/secret-wiring");
    expect(() =>
      SecretFileSpecSchema.parse({
        secretName: "discord_token_maren",
        targetPath: "/var/lib/clawdlets/../etc/shadow",
        mode: "0400",
      }),
    ).toThrow(/targetPath/);
  });

  it("rejects trailing /..", async () => {
    const { SecretFileSpecSchema } = await import("../src/lib/secret-wiring");
    expect(() =>
      SecretFileSpecSchema.parse({
        secretName: "discord_token_maren",
        targetPath: "/var/lib/clawdlets/..",
        mode: "0400",
      }),
    ).toThrow(/targetPath/);
  });

  it("rejects NUL characters", async () => {
    const { SecretFileSpecSchema } = await import("../src/lib/secret-wiring");
    expect(() =>
      SecretFileSpecSchema.parse({
        secretName: "discord_token_maren",
        targetPath: "/var/lib/clawdlets/secrets/ok\u0000bad",
        mode: "0400",
      }),
    ).toThrow(/targetPath/);
  });
});
