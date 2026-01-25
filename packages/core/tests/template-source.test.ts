import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { normalizeTemplatePath, normalizeTemplateRef, normalizeTemplateRepo, normalizeTemplateSource } from "../src/lib/template-source";
import { resolveTemplateTestDir } from "../src/lib/template-test-dir";

describe("template source validation", () => {
  it("accepts owner/repo format", () => {
    expect(normalizeTemplateRepo("owner/repo")).toBe("owner/repo");
    expect(normalizeTemplateRepo("owner-name/repo_name")).toBe("owner-name/repo_name");
  });

  it("rejects invalid repo format", () => {
    expect(() => normalizeTemplateRepo("owner")).toThrow(/owner\/repo/);
    expect(() => normalizeTemplateRepo("owner/repo/extra")).toThrow(/owner\/repo/);
    expect(() => normalizeTemplateRepo("owner repo")).toThrow(/owner\/repo/);
  });

  it("rejects path traversal", () => {
    expect(() => normalizeTemplatePath("../templates/default")).toThrow(/invalid segment/);
    expect(() => normalizeTemplatePath("templates/../default")).toThrow(/invalid segment/);
    expect(() => normalizeTemplatePath("/templates/default")).toThrow(/relative/);
  });

  it("validates ref format", () => {
    // Accept 40-hex SHA
    expect(normalizeTemplateRef("0123456789abcdef0123456789abcdef01234567")).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    // Accept branch names
    expect(normalizeTemplateRef("main")).toBe("main");
    expect(normalizeTemplateRef("master")).toBe("master");
    expect(normalizeTemplateRef("feature/my-branch")).toBe("feature/my-branch");
    // Accept tags
    expect(normalizeTemplateRef("v1.0.0")).toBe("v1.0.0");
    // Reject empty and invalid characters
    expect(() => normalizeTemplateRef("")).toThrow(/missing/);
    expect(() => normalizeTemplateRef("bad^ref")).toThrow(/valid git ref/);
    expect(() => normalizeTemplateRef("bad ref")).toThrow(/valid git ref/);
  });

  it("accepts config/template-source.json", () => {
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const configPath = path.join(repoRoot, "config", "template-source.json");
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(normalizeTemplateSource(parsed)).toBeDefined();
  });
});

describe("template test dir guard", () => {
  it("rejects dangerous overrides", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-repo-"));
    await mkdir(path.join(repoRoot, "packages", "core", "tests"), { recursive: true });

    expect(() => resolveTemplateTestDir({ repoRoot, destRoot: "/" })).toThrow(/filesystem root/);
    expect(() => resolveTemplateTestDir({ repoRoot, destRoot: repoRoot })).toThrow(/repo root/);
    expect(() => resolveTemplateTestDir({ repoRoot, destRoot: path.join(repoRoot, "packages") })).toThrow(/end with/);
  });
});
