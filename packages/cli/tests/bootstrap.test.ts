import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRepoLayout } from "@clawdlets/core/repo-layout";

const applyOpenTofuVarsMock = vi.fn().mockResolvedValue(undefined);
const runMock = vi.fn().mockResolvedValue(undefined);
const captureMock = vi.fn().mockResolvedValue("46.0.0.1");
const sshCaptureMock = vi.fn().mockResolvedValue("100.64.0.10\n");
const resolveGitRevMock = vi.fn().mockResolvedValue("deadbeef");
const checkGithubRepoVisibilityMock = vi.fn().mockResolvedValue({ ok: true, status: "public" });
const tryParseGithubFlakeUriMock = vi.fn().mockReturnValue(null);
const loadDeployCredsMock = vi.fn();
const expandPathMock = vi.fn((value: string) => value);
const findRepoRootMock = vi.fn().mockReturnValue("/repo");
const evalFleetConfigMock = vi.fn().mockResolvedValue({ bots: [] });
const withFlakesEnvMock = vi.fn((env: NodeJS.ProcessEnv) => env);
const resolveBaseFlakeMock = vi.fn().mockResolvedValue({ flake: "" });
const loadClawdletsConfigMock = vi.fn();
const writeClawdletsConfigMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@clawdlets/core/lib/opentofu", () => ({
  applyOpenTofuVars: applyOpenTofuVarsMock,
}));

vi.mock("@clawdlets/core/lib/git", () => ({
  resolveGitRev: resolveGitRevMock,
}));

vi.mock("@clawdlets/core/lib/run", () => ({
  run: runMock,
  capture: captureMock,
}));

vi.mock("@clawdlets/core/lib/ssh-remote", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/core/lib/ssh-remote")>(
    "@clawdlets/core/lib/ssh-remote",
  );
  return {
    ...actual,
    sshCapture: sshCaptureMock,
  };
});

vi.mock("@clawdlets/core/lib/github", () => ({
  checkGithubRepoVisibility: checkGithubRepoVisibilityMock,
  tryParseGithubFlakeUri: tryParseGithubFlakeUriMock,
}));

vi.mock("@clawdlets/core/lib/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

vi.mock("@clawdlets/core/lib/path-expand", () => ({
  expandPath: expandPathMock,
}));

vi.mock("@clawdlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawdlets/core/lib/fleet-nix-eval", () => ({
  evalFleetConfig: evalFleetConfigMock,
}));

vi.mock("@clawdlets/core/lib/nix-flakes", () => ({
  withFlakesEnv: withFlakesEnvMock,
}));

vi.mock("@clawdlets/core/lib/base-flake", () => ({
  resolveBaseFlake: resolveBaseFlakeMock,
}));

vi.mock("@clawdlets/core/lib/clawdlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/core/lib/clawdlets-config")>(
    "@clawdlets/core/lib/clawdlets-config",
  );
  return {
    ...actual,
    loadClawdletsConfig: loadClawdletsConfigMock,
    writeClawdletsConfig: writeClawdletsConfigMock,
  };
});

const hostName = "clawdbot-beta-3";
const baseHost = {
  enable: false,
  diskDevice: "/dev/sda",
  flakeHost: "",
  hetzner: { serverType: "cx43" },
  provisioning: { adminCidr: "203.0.113.10/32", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
  sshExposure: { mode: "bootstrap" },
  tailnet: { mode: "tailscale" },
  cache: {
    substituters: ["https://cache.nixos.org", "https://cache.garnix.io"],
    trustedPublicKeys: [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=",
      "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g=",
    ],
    netrc: { enable: false, secretName: "garnix_netrc", path: "/etc/nix/netrc", narinfoCachePositiveTtl: 3600 },
  },
  agentModelPrimary: "zai/glm-4.7",
};

function setConfig(hostOverrides: Partial<typeof baseHost>) {
  loadClawdletsConfigMock.mockReturnValue({
    layout: getRepoLayout("/repo"),
    configPath: "/repo/fleet/clawdlets.json",
    config: {
      schemaVersion: 11,
      fleet: { sshAuthorizedKeys: [], sshKnownHosts: [] },
      hosts: {
        [hostName]: { ...baseHost, ...hostOverrides },
      },
    },
  });
}

describe("bootstrap command", () => {
  let existsSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    loadDeployCredsMock.mockReturnValue({
      envFile: { status: "ok", path: "/repo/.clawdlets/env" },
      values: { HCLOUD_TOKEN: "token", GITHUB_TOKEN: "", NIX_BIN: "nix" },
    });
  });

  afterEach(() => {
    existsSpy.mockRestore();
    if (logSpy) logSpy.mockRestore();
    logSpy = undefined;
  });

  it("rejects tailnet-only SSH exposure for bootstrap", async () => {
    setConfig({ sshExposure: { mode: "tailnet" } });
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await expect(
      bootstrap.run({
        args: {
          host: hostName,
          flake: "github:owner/repo",
          rev: "",
          ref: "",
          force: true,
          dryRun: true,
        } as any,
      }),
    ).rejects.toThrow(/sshExposure\.mode=tailnet/i);
    expect(applyOpenTofuVarsMock).not.toHaveBeenCalled();
  });

  it("prints a lockdown warning when SSH exposure is not tailnet", async () => {
    setConfig({ sshExposure: { mode: "bootstrap" }, tailnet: { mode: "tailscale" } });
    const logs: string[] = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await bootstrap.run({
      args: {
        host: hostName,
        flake: "github:owner/repo",
        rev: "",
        ref: "",
        force: true,
        dryRun: true,
      } as any,
    });
    const output = logs.join("\n");
    expect(output).toMatch(/SSH WILL REMAIN OPEN/i);
    expect(output).toMatch(/--ssh-exposure tailnet/i);
    expect(output).toMatch(/clawdlets lockdown/i);
  });

  it("runs auto-lockdown when --lockdown-after is set", async () => {
    setConfig({ sshExposure: { mode: "bootstrap" }, tailnet: { mode: "tailscale" } });
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await bootstrap.run({
      args: {
        host: hostName,
        flake: "github:owner/repo",
        rev: "",
        ref: "",
        force: true,
        dryRun: false,
        lockdownAfter: true,
      } as any,
    });

    expect(sshCaptureMock).toHaveBeenCalled();
    expect(writeClawdletsConfigMock).toHaveBeenCalled();
    const written = writeClawdletsConfigMock.mock.calls[0]?.[0];
    expect(written?.configPath).toBe("/repo/fleet/clawdlets.json");
    expect(written?.config?.hosts?.[hostName]?.sshExposure?.mode).toBe("tailnet");
    expect(written?.config?.hosts?.[hostName]?.targetHost).toBe("admin@100.64.0.10");

    expect(applyOpenTofuVarsMock).toHaveBeenCalledTimes(2);
    const first = applyOpenTofuVarsMock.mock.calls[0]?.[0];
    const second = applyOpenTofuVarsMock.mock.calls[1]?.[0];
    expect(first?.vars?.sshExposureMode).toBe("bootstrap");
    expect(second?.vars?.sshExposureMode).toBe("tailnet");
  });

  it("rejects --lockdown-after when tailnet.mode is not tailscale", async () => {
    setConfig({ sshExposure: { mode: "bootstrap" }, tailnet: { mode: "none" } });
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await expect(
      bootstrap.run({
        args: {
          host: hostName,
          flake: "github:owner/repo",
          rev: "",
          ref: "",
          force: true,
          dryRun: true,
          lockdownAfter: true,
        } as any,
      }),
    ).rejects.toThrow(/--lockdown-after requires tailnet\.mode=tailscale/i);
    expect(applyOpenTofuVarsMock).not.toHaveBeenCalled();
  });

  it("rejects invalid bootstrap mode", async () => {
    setConfig({});
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await expect(
      bootstrap.run({
        args: { host: hostName, mode: "nope", flake: "github:owner/repo", force: true, dryRun: true } as any,
      }),
    ).rejects.toThrow(/invalid --mode/i);
  });

  it("rejects when HCLOUD_TOKEN is missing", async () => {
    setConfig({});
    loadDeployCredsMock.mockReturnValueOnce({
      envFile: { status: "ok", path: "/repo/.clawdlets/env" },
      values: { HCLOUD_TOKEN: "", GITHUB_TOKEN: "", NIX_BIN: "nix" },
    });
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await expect(
      bootstrap.run({
        args: { host: hostName, flake: "github:owner/repo", force: true, dryRun: true } as any,
      }),
    ).rejects.toThrow(/missing HCLOUD_TOKEN/i);
  });

  it("rejects image mode without hetzner image", async () => {
    setConfig({ hetzner: { serverType: "cx43", image: "", location: "nbg1" } });
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await expect(
      bootstrap.run({
        args: { host: hostName, mode: "image", flake: "github:owner/repo", force: true, dryRun: true } as any,
      }),
    ).rejects.toThrow(/missing hetzner\.image/i);
  });

  it("rejects when both --rev and --ref are provided", async () => {
    resolveBaseFlakeMock.mockResolvedValueOnce({ flake: "github:owner/repo" });
    setConfig({});
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await expect(
      bootstrap.run({
        args: { host: hostName, rev: "HEAD", ref: "main", force: true, dryRun: true } as any,
      }),
    ).rejects.toThrow(/either --rev or --ref/i);
  });

  it("rejects missing adminCidr", async () => {
    setConfig({ provisioning: { adminCidr: "", sshPubkeyFile: "~/.ssh/id_ed25519.pub" } });
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await expect(
      bootstrap.run({ args: { host: hostName, flake: "github:owner/repo", force: true, dryRun: true } as any }),
    ).rejects.toThrow(/missing provisioning\.adminCidr/i);
  });

  it("rejects missing ssh pubkey file", async () => {
    setConfig({ provisioning: { adminCidr: "203.0.113.10/32", sshPubkeyFile: "missing.pub" } });
    existsSpy.mockImplementation((p: fs.PathLike) => !String(p).includes("missing.pub"));
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await expect(
      bootstrap.run({ args: { host: hostName, flake: "github:owner/repo", force: true, dryRun: true } as any }),
    ).rejects.toThrow(/ssh pubkey file not found/i);
  });

  it("rejects missing base flake", async () => {
    resolveBaseFlakeMock.mockResolvedValueOnce({ flake: "" });
    setConfig({});
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await expect(
      bootstrap.run({ args: { host: hostName, force: true, dryRun: true } as any }),
    ).rejects.toThrow(/missing base flake/i);
  });

  it("rejects flake host mismatch", async () => {
    setConfig({});
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await expect(
      bootstrap.run({ args: { host: hostName, flake: "github:owner/repo#other", force: true, dryRun: true } as any }),
    ).rejects.toThrow(/flake host mismatch/i);
  });

  it("rejects private base flake without GITHUB_TOKEN", async () => {
    setConfig({});
    tryParseGithubFlakeUriMock.mockReturnValueOnce({ owner: "owner", repo: "repo" });
    checkGithubRepoVisibilityMock.mockResolvedValueOnce({ ok: true, status: "private-or-missing" });
    const { bootstrap } = await import("../src/commands/bootstrap.ts");
    await expect(
      bootstrap.run({ args: { host: hostName, flake: "github:owner/repo", force: true, dryRun: false } as any }),
    ).rejects.toThrow(/base flake repo appears private/i);
  });
});
