import { describe, expect, it } from "vitest";

describe("prototype pollution guards", () => {
  it("rejects __proto__ keys in secrets init json", async () => {
    const { parseSecretsInitJson } = await import("../src/lib/secrets-init");

    const raw = '{"adminPasswordHash":"hash","secrets":{"__proto__":"polluted"}}';
    expect(() => parseSecretsInitJson(raw)).toThrow();
  });
});
