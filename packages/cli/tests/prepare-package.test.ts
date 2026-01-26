import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("prepare-package guardrails", () => {
  it("rejects unsafe out dir without override", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
    const script = path.join(repoRoot, "scripts", "prepare-package.mjs");
    const tmpOut = path.join(os.tmpdir(), "clawdlets-unsafe-out");
    const res = spawnSync(process.execPath, [script, "--out", tmpOut, "--pkg", "packages/cli"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/--out must be under/i);
  });

  it("prepares publish dir without node_modules (no local-protocol deps)", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
    const script = path.join(repoRoot, "scripts", "prepare-package.mjs");
    const tmpParent = path.join(repoRoot, "packages", "cli", ".tmp");
    fs.mkdirSync(tmpParent, { recursive: true });
    const tmpBase = fs.mkdtempSync(path.join(tmpParent, "prepare-package-"));
    const tmpOut = path.join(tmpBase, "clawdlets");

    try {
      const res = spawnSync(
        process.execPath,
        [script, "--out", tmpOut, "--pkg", "packages/cli", "--allow-unsafe-out"],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      );
      expect(res.status).toBe(0);

      const outPkg = JSON.parse(fs.readFileSync(path.join(tmpOut, "package.json"), "utf8"));

      expect(outPkg.bundledDependencies).toBeUndefined();

      expect(fs.existsSync(path.join(tmpOut, "node_modules"))).toBe(false);
      expect(fs.existsSync(path.join(tmpOut, "vendor"))).toBe(false);
      expect(fs.existsSync(path.join(tmpOut, "dist", "assets", "opentofu", "main.tf"))).toBe(true);

      for (const [name, spec] of Object.entries(outPkg.dependencies || {})) {
        expect(String(name)).not.toMatch(/^@clawdlets\//);
        expect(String(spec)).not.toMatch(/^(workspace:|file:|link:)/);
        expect(name).toBeTruthy();
      }

      // tmpOut lives under packages/cli, so Node can resolve deps via packages/cli/node_modules.
      const ver = spawnSync(process.execPath, [path.join(tmpOut, "dist", "main.mjs"), "--version"], {
        cwd: tmpOut,
        encoding: "utf8",
      });
      expect(ver.status).toBe(0);
      expect(String(ver.stdout || "").trim()).toBe(String(outPkg.version));

      const pack = spawnSync("npm", ["pack", "--silent"], { cwd: tmpOut, encoding: "utf8" });
      expect(pack.status).toBe(0);
      const tgz = String(pack.stdout || "").trim();
      expect(tgz).toMatch(/\.tgz$/);

      const tar = spawnSync("tar", ["-tf", tgz], { cwd: tmpOut, encoding: "utf8" });
      expect(tar.status).toBe(0);
      expect(tar.stdout).not.toContain("package/vendor/");
      expect(tar.stdout).not.toContain("package/node_modules/");
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
