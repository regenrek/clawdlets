import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const findRepoRootMock = vi.fn();
const loadDeployCredsMock = vi.fn();

vi.mock("@clawdlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawdlets/core/lib/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

describe("env commands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("env init writes explicit env file", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-env-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    const envFile = path.join(repoRoot, ".env.custom");
    const { envInit } = await import("../src/commands/env.js");
    await envInit.run({ args: { envFile } } as any);
    const content = fs.readFileSync(envFile, "utf8");
    expect(content).toMatch(/HCLOUD_TOKEN=/);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("note: you must pass --env-file"));
  });

  it("env show prints resolved values", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-env-show-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    loadDeployCredsMock.mockReturnValue({
      envFile: { status: "ok", origin: "default", path: "/repo/.clawdlets/env" },
      values: { HCLOUD_TOKEN: "token", GITHUB_TOKEN: "gh", NIX_BIN: "nix", SOPS_AGE_KEY_FILE: "/keys/age" },
      sources: { HCLOUD_TOKEN: "file", GITHUB_TOKEN: "env", NIX_BIN: "default", SOPS_AGE_KEY_FILE: "file" },
    });
    const { envShow } = await import("../src/commands/env.js");
    await envShow.run({ args: {} } as any);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("env file: ok"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("HCLOUD_TOKEN: set"));
  });
});
