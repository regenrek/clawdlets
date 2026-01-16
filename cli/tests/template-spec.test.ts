import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTemplateSpec } from "../src/lib/template-spec";

describe("template spec defaults", () => {
  it("uses config/template-source.json when no args provided", () => {
    const configPath = path.resolve(process.cwd(), "..", "config", "template-source.json");
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw) as { repo: string; path: string; ref: string };

    const saved = {
      repo: process.env.CLAWDLETS_TEMPLATE_REPO,
      path: process.env.CLAWDLETS_TEMPLATE_PATH,
      ref: process.env.CLAWDLETS_TEMPLATE_REF,
    };
    delete process.env.CLAWDLETS_TEMPLATE_REPO;
    delete process.env.CLAWDLETS_TEMPLATE_PATH;
    delete process.env.CLAWDLETS_TEMPLATE_REF;

    try {
      const resolved = resolveTemplateSpec({});
      expect(resolved.repo).toBe(config.repo);
      expect(resolved.path).toBe(config.path);
      expect(resolved.ref).toBe(config.ref);
    } finally {
      process.env.CLAWDLETS_TEMPLATE_REPO = saved.repo;
      process.env.CLAWDLETS_TEMPLATE_PATH = saved.path;
      process.env.CLAWDLETS_TEMPLATE_REF = saved.ref;
    }
  });
});
