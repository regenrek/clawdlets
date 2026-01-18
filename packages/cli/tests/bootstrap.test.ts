import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRepoLayout } from "@clawdlets/core/repo-layout";

const applyOpenTofuVarsMock = vi.fn().mockResolvedValue(undefined);
const runMock = vi.fn().mockResolvedValue(undefined);
const captureMock = vi.fn().mockResolvedValue("46.0.0.1");
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
  };
});

const hostName = "clawdbot-beta-3";
const baseHost = {
  enable: false,
  diskDevice: "/dev/sda",
  sshAuthorizedKeys: [],
  flakeHost: "",
  hetzner: { serverType: "cx43" },
  provisioning: { adminCidr: "203.0.113.10/32", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
  sshExposure: { mode: "bootstrap" },
  tailnet: { mode: "tailscale" },
  agentModelPrimary: "zai/glm-4.7",
};

function setConfig(hostOverrides: Partial<typeof baseHost>) {
  loadClawdletsConfigMock.mockReturnValue({
    layout: getRepoLayout("/repo"),
    configPath: "/repo/fleet/clawdlets.json",
    config: {
      schemaVersion: 7,
      fleet: {},
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
});
