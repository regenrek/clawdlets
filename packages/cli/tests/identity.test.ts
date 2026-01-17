import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, it, expect } from "vitest";

describe("identity command", () => {
  it("identity add creates a skeleton", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-cli-identity-"));
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "flake.nix"), "{ }\n", "utf8");

    const prev = process.cwd();
    try {
      process.chdir(repoRoot);
      const { identity } = await import("../src/commands/identity");
      await identity.subCommands.add.run({ args: { name: "rex" } as any });
    } finally {
      process.chdir(prev);
    }

    expect(fs.existsSync(path.join(repoRoot, "identities", "rex", "SOUL.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "identities", "rex", "config.json"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "identities", "rex", "skills"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "identities", "rex", "memory"))).toBe(true);
  });
});

