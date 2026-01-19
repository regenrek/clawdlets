import { describe, expect, it, vi } from "vitest";

const validateTargetHostMock = vi.fn((v: string) => v);

vi.mock("@clawdlets/core/lib/ssh-remote", () => ({
  validateTargetHost: validateTargetHostMock,
}));

describe("ssh target helpers", () => {
  it("needsSudo detects root", async () => {
    const { needsSudo } = await import("../src/commands/ssh-target.js");
    expect(needsSudo("root@host")).toBe(false);
    expect(needsSudo("admin@host")).toBe(true);
  });

  it("requireTargetHost validates and returns", async () => {
    const { requireTargetHost } = await import("../src/commands/ssh-target.js");
    expect(requireTargetHost("admin@host", "alpha")).toBe("admin@host");
    expect(validateTargetHostMock).toHaveBeenCalled();
  });

  it("requireTargetHost throws when missing", async () => {
    const { requireTargetHost } = await import("../src/commands/ssh-target.js");
    expect(() => requireTargetHost("  ", "alpha")).toThrow(/missing target host/i);
  });
});
