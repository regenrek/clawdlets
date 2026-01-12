import { describe, it, expect } from "vitest";
import path from "node:path";

describe("relativePathForSopsRule", () => {
  it("accepts hosts/<host> relative path", async () => {
    const { relativePathForSopsRule } = await import("../src/lib/sops-path");
    const root = path.join(process.cwd(), "__sops_path_test__");
    const fromDir = path.join(root, "secrets");
    const toPath = path.join(fromDir, "hosts", "clawdbot-fleet-host");
    expect(relativePathForSopsRule({ fromDir, toPath, label: "host secrets dir" })).toBe("hosts/clawdbot-fleet-host");
  });

  it("rejects '.' / empty relative paths", async () => {
    const { relativePathForSopsRule } = await import("../src/lib/sops-path");
    const root = path.join(process.cwd(), "__sops_path_test__");
    const fromDir = path.join(root, "secrets");
    const toPath = fromDir;
    expect(() => relativePathForSopsRule({ fromDir, toPath, label: "host secrets dir" })).toThrow(/empty|non-empty|invalid/i);
  });

  it("rejects paths that escape fromDir", async () => {
    const { relativePathForSopsRule } = await import("../src/lib/sops-path");
    const root = path.join(process.cwd(), "__sops_path_test__");
    const fromDir = path.join(root, "secrets");
    const toPath = path.join(root, "not-secrets");
    expect(() => relativePathForSopsRule({ fromDir, toPath, label: "host secrets dir" })).toThrow(/\.\.|escapes|under/i);
  });
});

