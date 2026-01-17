import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

describe("identity-loader", () => {
  it("loads identity files + config", async () => {
    const { loadIdentity } = await import("../src/lib/identity-loader");

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-identity-"));
    const dir = path.join(repoRoot, "identities", "rex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SOUL.md"), "# Rex\n", "utf8");
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ schemaVersion: 1, model: { primary: "zai/glm-4.7" } }), "utf8");

    const id = loadIdentity({ repoRoot, identityName: "rex" });
    expect(id.name).toBe("rex");
    expect(id.soulText).toContain("Rex");
    expect(id.config.schemaVersion).toBe(1);
    expect(id.config.model.primary).toBe("zai/glm-4.7");
    expect(id.cloudInitFiles.length).toBe(2);
    expect(id.cloudInitFiles[0]?.path).toBe("/var/lib/clawdlets/identity/SOUL.md");
  });

  it("enforces file size limits", async () => {
    const { loadIdentity } = await import("../src/lib/identity-loader");

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-identity-"));
    const dir = path.join(repoRoot, "identities", "rex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SOUL.md"), "x".repeat(1024), "utf8");
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");

    expect(() => loadIdentity({ repoRoot, identityName: "rex", maxSoulBytes: 16 })).toThrow(/file too large/i);
  });
});

