import { describe, it, expect } from "vitest";

describe("identifiers", () => {
  it("assertSafeHostName rejects traversal", async () => {
    const { assertSafeHostName } = await import("@clawdlets/shared/lib/identifiers");
    expect(() => assertSafeHostName("../pwn")).toThrow(/invalid host name/i);
  });

  it("assertSafeHostName accepts safe host", async () => {
    const { assertSafeHostName } = await import("@clawdlets/shared/lib/identifiers");
    expect(() => assertSafeHostName("clawdbot-fleet-host")).not.toThrow();
  });

  it("assertSafeSecretName rejects traversal", async () => {
    const { assertSafeSecretName } = await import("@clawdlets/shared/lib/identifiers");
    expect(() => assertSafeSecretName("../pwn")).toThrow(/invalid secret name/i);
  });

  it("assertSafePersonaName accepts safe persona", async () => {
    const { assertSafePersonaName } = await import("@clawdlets/shared/lib/identifiers");
    expect(() => assertSafePersonaName("rex")).not.toThrow();
    expect(() => assertSafePersonaName("../pwn")).toThrow(/invalid persona name/i);
  });

  it("sanitizeOperatorId strips unsafe chars", async () => {
    const { sanitizeOperatorId } = await import("@clawdlets/shared/lib/identifiers");
    expect(sanitizeOperatorId("kevin kern")).toBe("kevin_kern");
    expect(sanitizeOperatorId("../pwn")).not.toMatch(/\//);
  });

  it("sanitizeOperatorId never returns '.' or '..'", async () => {
    const { sanitizeOperatorId } = await import("@clawdlets/shared/lib/identifiers");
    expect(sanitizeOperatorId(".")).toBe("operator");
    expect(sanitizeOperatorId("..")).toBe("operator");
  });

  it("EnvVarNameSchema accepts uppercase env var names", async () => {
    const { EnvVarNameSchema } = await import("@clawdlets/shared/lib/identifiers");
    expect(() => EnvVarNameSchema.parse("OPENAI_API_KEY")).not.toThrow();
    expect(() => EnvVarNameSchema.parse("bad-key")).toThrow(/invalid env var name/i);
  });
});
