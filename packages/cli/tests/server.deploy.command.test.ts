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
const resolveManifestPublicKeyMock = vi.fn(() => "pub");
const verifyManifestSignatureMock = vi.fn();
const parseDeployManifestMock = vi.fn();
const createSecretsTarMock = vi.fn();
const runMock = vi.fn();
const sshRunMock = vi.fn();

vi.mock("../src/lib/context.js", () => ({
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
  resolveManifestPublicKey: resolveManifestPublicKeyMock,
  verifyManifestSignature: verifyManifestSignatureMock,
}));

vi.mock("../src/lib/deploy-manifest.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/deploy-manifest.js")>("../src/lib/deploy-manifest.js");
  return {
    ...actual,
    parseDeployManifest: parseDeployManifestMock,
  };
});

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

  it("deploys using manifest and writes output manifest", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha", hostCfg });
    loadDeployCredsMock.mockReturnValue({ envFile: { origin: "default", status: "ok", path: "/repo/.clawdlets/env" }, values: { NIX_BIN: "nix" } });

    const manifestPath = path.join(tmpdir(), "manifest.json");
    fs.writeFileSync(manifestPath, "{}");
    parseDeployManifestMock.mockReturnValue({
      rev: "a".repeat(40),
      host: "alpha",
      toplevel: "/nix/store/abcd1234",
      secretsDigest: "b".repeat(64),
    });

    const tarPath = path.join(tmpdir(), "secrets.tgz");
    fs.writeFileSync(tarPath, "data");
    createSecretsTarMock.mockResolvedValue({ tarPath, digest: "b".repeat(64) });

    const outPath = path.join(tmpdir(), "deploy-out.json");
    const { serverDeploy } = await import("../src/commands/server/deploy.js");
    await serverDeploy.run({ args: { host: "alpha", targetHost: "admin@host", manifest: manifestPath, manifestOut: outPath } } as any);
    expect(runMock).toHaveBeenCalled();
    expect(sshRunMock).toHaveBeenCalled();
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it("rejects manifest host mismatch", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({ hostName: "alpha", hostOverrides: { ...baseHost } });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha", hostCfg });
    loadDeployCredsMock.mockReturnValue({ envFile: { origin: "default", status: "ok", path: "/repo/.clawdlets/env" }, values: { NIX_BIN: "nix" } });
    parseDeployManifestMock.mockReturnValue({
      rev: "a".repeat(40),
      host: "beta",
      toplevel: "/nix/store/abcd1234",
      secretsDigest: "b".repeat(64),
    });
    const manifestPath = path.join(tmpdir(), "manifest.json");
    fs.writeFileSync(manifestPath, "{}");
    const { serverDeploy } = await import("../src/commands/server/deploy.js");
    await expect(serverDeploy.run({ args: { host: "alpha", manifest: manifestPath } } as any)).rejects.toThrow(/manifest host mismatch/i);
  });

  it("rejects manifest rev mismatch when rev provided", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({ hostName: "alpha", hostOverrides: { ...baseHost } });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ repoRoot: "/repo", layout, hostName: "alpha", hostCfg });
    loadDeployCredsMock.mockReturnValue({ envFile: { origin: "default", status: "ok", path: "/repo/.clawdlets/env" }, values: { NIX_BIN: "nix" } });
    parseDeployManifestMock.mockReturnValue({
      rev: "a".repeat(40),
      host: "alpha",
      toplevel: "/nix/store/abcd1234",
      secretsDigest: "b".repeat(64),
    });
    const manifestPath = path.join(tmpdir(), "manifest.json");
    fs.writeFileSync(manifestPath, "{}");
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
    parseDeployManifestMock.mockReturnValue({
      rev: "a".repeat(40),
      host: "alpha",
      toplevel: "/nix/store/abcd1234",
      secretsDigest: "b".repeat(64),
    });
    const tarPath = path.join(tmpdir(), "secrets.tgz");
    fs.writeFileSync(tarPath, "data");
    createSecretsTarMock.mockResolvedValue({ tarPath, digest: "c".repeat(64) });
    const manifestPath = path.join(tmpdir(), "manifest.json");
    fs.writeFileSync(manifestPath, "{}");
    const { serverDeploy } = await import("../src/commands/server/deploy.js");
    await expect(serverDeploy.run({ args: { host: "alpha", manifest: manifestPath } } as any)).rejects.toThrow(/secrets digest mismatch/i);
  });
});
