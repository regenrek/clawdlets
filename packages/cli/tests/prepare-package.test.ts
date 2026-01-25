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

  it("prepares publish dir without node_modules (vendored workspace deps)", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
    const script = path.join(repoRoot, "scripts", "prepare-package.mjs");
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-prepare-package-"));
    const tmpOut = path.join(tmpBase, "clawdlets");

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

    expect(outPkg.dependencies?.["@clawdlets/core"]).toBe("file:vendor/@clawdlets/core");
    expect(outPkg.dependencies?.dotenv).toBeTruthy();
    expect(outPkg.dependencies?.ajv).toBeTruthy();
    expect(outPkg.dependencies?.zod).toBeTruthy();
    expect(outPkg.bundledDependencies).toBeUndefined();

    expect(fs.existsSync(path.join(tmpOut, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(tmpOut, "vendor", "@clawdlets", "core", "package.json"))).toBe(true);

    const pack = spawnSync("npm", ["pack", "--silent"], { cwd: tmpOut, encoding: "utf8" });
    expect(pack.status).toBe(0);
    const tgz = String(pack.stdout || "").trim();
    expect(tgz).toMatch(/\.tgz$/);

    const tar = spawnSync("tar", ["-tf", tgz], { cwd: tmpOut, encoding: "utf8" });
    expect(tar.status).toBe(0);
    expect(tar.stdout).toContain("package/vendor/@clawdlets/core/package.json");
    expect(tar.stdout).not.toContain("package/node_modules/");
  });
});
