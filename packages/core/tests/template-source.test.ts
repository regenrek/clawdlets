import { describe, it, expect } from "vitest";
import { normalizeTemplatePath, normalizeTemplateRef, normalizeTemplateRepo } from "../src/lib/template-source";

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
    expect(normalizeTemplateRef("main")).toBe("main");
    expect(normalizeTemplateRef("feature/test-1")).toBe("feature/test-1");
    expect(() => normalizeTemplateRef("")).toThrow(/missing/);
    expect(() => normalizeTemplateRef("main dev")).toThrow(/whitespace/);
    expect(() => normalizeTemplateRef("bad..ref")).toThrow(/invalid/);
    expect(() => normalizeTemplateRef("bad^ref")).toThrow(/invalid/);
  });
});
