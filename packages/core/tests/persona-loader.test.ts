import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

describe("persona-loader", () => {
  it("loads persona files + config", async () => {
    const { loadPersona } = await import("@clawdlets/cattle-core/lib/persona-loader");

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-persona-"));
    const dir = path.join(repoRoot, "cattle", "personas", "rex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SOUL.md"), "# Rex\n", "utf8");
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ schemaVersion: 1, model: { primary: "zai/glm-4.7" } }), "utf8");

    const persona = loadPersona({ repoRoot, personaName: "rex" });
    expect(persona.name).toBe("rex");
    expect(persona.soulText).toContain("Rex");
    expect(persona.config.schemaVersion).toBe(1);
    expect(persona.config.model.primary).toBe("zai/glm-4.7");
    expect(persona.cloudInitFiles.length).toBe(2);
    expect(persona.cloudInitFiles[0]?.path).toBe("/var/lib/clawdlets/cattle/persona/SOUL.md");
  });

  it("enforces file size limits", async () => {
    const { loadPersona } = await import("@clawdlets/cattle-core/lib/persona-loader");

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-persona-"));
    const dir = path.join(repoRoot, "cattle", "personas", "rex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SOUL.md"), "x".repeat(1024), "utf8");
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");

    expect(() => loadPersona({ repoRoot, personaName: "rex", maxSoulBytes: 16 })).toThrow(/file too large/i);
  });
});
