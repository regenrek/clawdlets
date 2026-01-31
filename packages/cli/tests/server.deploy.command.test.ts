import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { getRepoLayout } from "@clawdlets/core/repo-layout";
import { makeConfig, baseHost } from "./fixtures.js";

const loadHostContextMock = vi.fn();
const requireDeployGateMock = vi.fn();
const loadDeployCredsMock = vi.fn();
const resolveManifestSignaturePathMock = vi.fn(() => "/tmp/manifest.minisig");
const resolveManifestPublicKeysMock = vi.fn(() => ["pub"]);
const verifyManifestSignatureMock = vi.fn();
const createSecretsTarMock = vi.fn();
const runMock = vi.fn();
const sshRunMock = vi.fn();

vi.mock("@clawdlets/core/lib/context", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("../src/lib/deploy-gate.js", () => ({
  requireDeployGate: requireDeployGateMock,
}));

vi.mock("@clawdlets/core/lib/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

vi.mock("../src/lib/manifest-signature.js", () => ({
  resolveManifestSignaturePath: resolveManifestSignaturePathMock,
  resolveManifestPublicKeys: resolveManifestPublicKeysMock,
  verifyManifestSignature: verifyManifestSignatureMock,
}));

vi.mock("@clawdlets/core/lib/secrets-tar", () => ({
  createSecretsTar: createSecretsTarMock,
}));

vi.mock("@clawdlets/core/lib/run", () => ({
  run: runMock,
}));

vi.mock("@clawdlets/core/lib/ssh-remote", () => ({
  sshRun: sshRunMock,
  shellQuote: (s: string) => s,
}));

vi.mock("../src/commands/ssh-target.js", () => ({
  needsSudo: () => false,
  requireTargetHost: (v: string) => v,
}));

describe("server deploy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deploys using release manifest and triggers updater apply", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha", hostCfg });
    loadDeployCredsMock.mockReturnValue({ envFile: { origin: "default", status: "ok", path: "/repo/.clawdlets/env" }, values: { NIX_BIN: "nix" } });

    const manifestPath = path.join(tmpdir(), "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      host: "alpha",
      system: "x86_64-linux",
      channel: "prod",
      releaseId: 1,
      issuedAt: "2026-01-01T00:00:00.000Z",
      rev: "a".repeat(40),
      toplevel: "/nix/store/abcd1234",
      secrets: { digest: "b".repeat(64) },
    }, null, 2) + "\n");

    const tarPath = path.join(tmpdir(), "secrets.tgz");
    fs.writeFileSync(tarPath, "data");
    createSecretsTarMock.mockResolvedValue({ tarPath, digest: "b".repeat(64) });

    const { serverDeploy } = await import("../src/commands/server/deploy.js");
    await serverDeploy.run({ args: { host: "alpha", targetHost: "admin@host", manifest: manifestPath } } as any);
    expect(runMock).toHaveBeenCalledTimes(3);
    expect(sshRunMock).toHaveBeenCalledTimes(3);
    expect(sshRunMock.mock.calls.map((c) => c[1]).join("\n")).toMatch(/install-secrets/);
    expect(sshRunMock.mock.calls.map((c) => c[1]).join("\n")).toMatch(/update-ingest/);
    expect(sshRunMock.mock.calls.map((c) => c[1]).join("\n")).toMatch(/clawdlets-update-apply\.service/);
  });

  it("rejects manifest host mismatch", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({ hostName: "alpha", hostOverrides: { ...baseHost } });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha", hostCfg });
    loadDeployCredsMock.mockReturnValue({ envFile: { origin: "default", status: "ok", path: "/repo/.clawdlets/env" }, values: { NIX_BIN: "nix" } });
    const manifestPath = path.join(tmpdir(), "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      host: "beta",
      system: "x86_64-linux",
      channel: "prod",
      releaseId: 1,
      issuedAt: "2026-01-01T00:00:00.000Z",
      rev: "a".repeat(40),
      toplevel: "/nix/store/abcd1234",
      secrets: { digest: "b".repeat(64) },
    }, null, 2) + "\n");
    const { serverDeploy } = await import("../src/commands/server/deploy.js");
    await expect(serverDeploy.run({ args: { host: "alpha", manifest: manifestPath } } as any)).rejects.toThrow(/manifest host mismatch/i);
  });

  it("rejects manifest rev mismatch when rev provided", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({ hostName: "alpha", hostOverrides: { ...baseHost } });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha", hostCfg });
    loadDeployCredsMock.mockReturnValue({ envFile: { origin: "default", status: "ok", path: "/repo/.clawdlets/env" }, values: { NIX_BIN: "nix" } });
    const manifestPath = path.join(tmpdir(), "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      host: "alpha",
      system: "x86_64-linux",
      channel: "prod",
      releaseId: 1,
      issuedAt: "2026-01-01T00:00:00.000Z",
      rev: "a".repeat(40),
      toplevel: "/nix/store/abcd1234",
      secrets: { digest: "b".repeat(64) },
    }, null, 2) + "\n");
    const { serverDeploy } = await import("../src/commands/server/deploy.js");
    await expect(serverDeploy.run({ args: { host: "alpha", manifest: manifestPath, rev: "deadbeef" } } as any)).rejects.toThrow(
      /manifest rev mismatch/i,
    );
  });

  it("rejects secrets digest mismatch", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({ hostName: "alpha", hostOverrides: { ...baseHost } });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha", hostCfg });
    loadDeployCredsMock.mockReturnValue({ envFile: { origin: "default", status: "ok", path: "/repo/.clawdlets/env" }, values: { NIX_BIN: "nix" } });
    const manifestPath = path.join(tmpdir(), "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      host: "alpha",
      system: "x86_64-linux",
      channel: "prod",
      releaseId: 1,
      issuedAt: "2026-01-01T00:00:00.000Z",
      rev: "a".repeat(40),
      toplevel: "/nix/store/abcd1234",
      secrets: { digest: "b".repeat(64) },
    }, null, 2) + "\n");
    const tarPath = path.join(tmpdir(), "secrets.tgz");
    fs.writeFileSync(tarPath, "data");
    createSecretsTarMock.mockResolvedValue({ tarPath, digest: "c".repeat(64) });
    const { serverDeploy } = await import("../src/commands/server/deploy.js");
    await expect(serverDeploy.run({ args: { host: "alpha", manifest: manifestPath } } as any)).rejects.toThrow(/secrets digest mismatch/i);
  });
});
