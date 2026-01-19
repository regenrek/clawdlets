import { describe, expect, it } from "vitest";
import { needsSudo, requireTargetHost } from "../src/commands/server/common.js";

describe("server common re-exports", () => {
  it("exposes ssh-target helpers", () => {
    expect(needsSudo("root@host")).toBe(false);
    expect(needsSudo("admin@host")).toBe(true);
    expect(() => requireTargetHost("", "alpha")).toThrow(/missing target host/i);
  });
});
