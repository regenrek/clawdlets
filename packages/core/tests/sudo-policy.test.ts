import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("sudo policy (host)", () => {
  it("does not allow wildcard nixos-rebuild flake rebuilds in sudoers", () => {
    const repoRoot = path.resolve(process.env.CLAWDLETS_TEMPLATE_DIR || path.join(__dirname, ".template"));
    const p = path.join(repoRoot, "infra", "nix", "hosts", "clawdlets-host.nix");
    const text = fs.readFileSync(p, "utf8");
    expect(text.includes("--flake *")).toBe(false);
    expect(/Cmnd_Alias\s+CLAWDBOT_REBUILD\b/.test(text)).toBe(false);
  });
});
