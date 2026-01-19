import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { getRepoLayout } from "@clawdlets/core/repo-layout";
import { makeConfig } from "./fixtures.js";

const loadHostContextMock = vi.fn();
const resolveGitRevMock = vi.fn();
const createSecretsTarMock = vi.fn();
const captureMock = vi.fn();
const requireLinuxMock = vi.fn();

vi.mock("../src/lib/context.js", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("@clawdlets/core/lib/git", () => ({
  resolveGitRev: resolveGitRevMock,
}));

vi.mock("@clawdlets/core/lib/secrets-tar", () => ({
  createSecretsTar: createSecretsTarMock,
}));

vi.mock("@clawdlets/core/lib/run", () => ({
  capture: captureMock,
}));

vi.mock("../src/lib/linux-build.js", () => ({
  requireLinuxForLocalNixosBuild: requireLinuxMock,
}));

describe("server manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes manifest with provided toplevel", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({ hostName: "alpha" });
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha" });
    resolveGitRevMock.mockResolvedValue("a".repeat(40));
    const tarPath = path.join(tmpdir(), "secrets.tgz");
    fs.writeFileSync(tarPath, "data");
    createSecretsTarMock.mockResolvedValue({ tarPath, digest: "b".repeat(64) });
    const outPath = path.join(tmpdir(), "deploy-manifest.alpha.json");
    const { serverManifest } = await import("../src/commands/server/manifest.js");
    await serverManifest.run({ args: { host: "alpha", toplevel: "/nix/store/abcd1234", out: outPath } } as any);
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it("rejects when git rev cannot be resolved", async () => {
    const layout = getRepoLayout("/repo");
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha" });
    resolveGitRevMock.mockResolvedValue(null);
    const { serverManifest } = await import("../src/commands/server/manifest.js");
    await expect(serverManifest.run({ args: { host: "alpha", toplevel: "/nix/store/abcd1234" } } as any)).rejects.toThrow(
      /unable to resolve git rev/i,
    );
  });

  it("fails when nix build returns invalid JSON", async () => {
    const layout = getRepoLayout("/repo");
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha" });
    resolveGitRevMock.mockResolvedValue("a".repeat(40));
    requireLinuxMock.mockImplementation(() => {});
    captureMock.mockResolvedValue("not-json");
    const { serverManifest } = await import("../src/commands/server/manifest.js");
    await expect(serverManifest.run({ args: { host: "alpha" } } as any)).rejects.toThrow(/invalid JSON/i);
  });
});
