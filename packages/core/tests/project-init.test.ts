import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { initProject } from "../src/lib/project-init";

describe("project init", () => {
  it("creates expected file tree from local template spec", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-project-init-"));
    try {
      const destDir = path.join(tempRoot, "my-project");
      const templateDir = path.join(__dirname, ".template");
      const res = await initProject({
        destDir,
        host: "my-host",
        templateSpec: `file:${templateDir}`,
        gitInit: false,
      });

      expect(res.destDir).toBe(destDir);
      expect(res.host).toBe("my-host");
      expect(res.gitInitialized).toBe(false);
      expect(res.plannedFiles).toContain("fleet/clawdlets.json");

      expect(fs.existsSync(path.join(destDir, "fleet", "clawdlets.json"))).toBe(true);
      expect(fs.existsSync(path.join(destDir, ".gitignore"))).toBe(true);
      expect(fs.existsSync(path.join(destDir, "_gitignore"))).toBe(false);

      const cfg = JSON.parse(await readFile(path.join(destDir, "fleet", "clawdlets.json"), "utf8")) as any;
      expect(cfg.defaultHost).toBe("my-host");
      expect(cfg.hosts?.["my-host"]).toBeTruthy();
      expect(cfg.hosts?.["clawdbot-fleet-host"]).toBeUndefined();

      const readme = await readFile(path.join(destDir, "README.md"), "utf8");
      expect(readme.split("\n")[0]).toBe("# my-project");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

