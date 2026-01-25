import { describe, expect, it } from "vitest";

describe("prototype pollution guards", () => {
  it("rejects __proto__ keys in secrets init json", async () => {
    const { parseSecretsInitJson } = await import("../src/lib/secrets-init");

    const raw = '{"adminPasswordHash":"hash","secrets":{"__proto__":"polluted"}}';
    expect(() => parseSecretsInitJson(raw)).toThrow();
  });

  it("rejects prototype keys in migrate legacy env maps", async () => {
    const { migrateClawdletsConfigToV9 } = await import("../src/lib/clawdlets-config-migrate");

    const raw = JSON.parse(
      '{"schemaVersion":8,"fleet":{"envSecrets":{"constructor":"x"},"bots":{},"botOrder":[]},"hosts":{}}',
    );
    expect(() => migrateClawdletsConfigToV9(raw)).toThrow();
  });
});

