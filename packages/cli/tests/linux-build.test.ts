import { describe, expect, it } from "vitest";
import { requireLinuxForLocalNixosBuild } from "../src/lib/linux-build.js";

describe("requireLinuxForLocalNixosBuild", () => {
  it("throws actionable error on darwin", () => {
    expect(() => requireLinuxForLocalNixosBuild({ platform: "darwin", command: "clawdlets server deploy" })).toThrowError(
      /local NixOS builds require Linux/i,
    );
  });

  it("does not throw on linux", () => {
    expect(() => requireLinuxForLocalNixosBuild({ platform: "linux", command: "clawdlets server deploy" })).not.toThrow();
  });
});

