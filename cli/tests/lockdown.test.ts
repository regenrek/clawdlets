import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRepoLayout } from "@clawdbot/clawdlets-core/repo-layout";

const sshRunMock = vi.fn().mockResolvedValue(undefined);
const sshCaptureMock = vi.fn().mockResolvedValue(
  JSON.stringify([{ outputs: { out: "/nix/store/lockdown-test-system" } }]),
);
const applyOpenTofuVarsMock = vi.fn().mockResolvedValue(undefined);
const resolveGitRevMock = vi.fn().mockResolvedValue("0123456789abcdef0123456789abcdef01234567");
const loadDeployCredsMock = vi.fn();
const findRepoRootMock = vi.fn().mockReturnValue("/repo");
const resolveBaseFlakeMock = vi.fn().mockResolvedValue({ flake: "github:owner/repo" });
const loadClawdletsConfigMock = vi.fn();
const requireDeployGateMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@clawdbot/clawdlets-core/lib/ssh-remote", async () => {
  const actual = await vi.importActual<typeof import("@clawdbot/clawdlets-core/lib/ssh-remote")>(
    "@clawdbot/clawdlets-core/lib/ssh-remote",
  );
  return {
    ...actual,
    sshRun: sshRunMock,
    sshCapture: sshCaptureMock,
  };
});

vi.mock("@clawdbot/clawdlets-core/lib/opentofu", () => ({
  applyOpenTofuVars: applyOpenTofuVarsMock,
}));

vi.mock("@clawdbot/clawdlets-core/lib/git", () => ({
  resolveGitRev: resolveGitRevMock,
}));

vi.mock("@clawdbot/clawdlets-core/lib/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

vi.mock("@clawdbot/clawdlets-core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawdbot/clawdlets-core/lib/base-flake", () => ({
  resolveBaseFlake: resolveBaseFlakeMock,
}));

vi.mock("@clawdbot/clawdlets-core/lib/clawdlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawdbot/clawdlets-core/lib/clawdlets-config")>(
    "@clawdbot/clawdlets-core/lib/clawdlets-config",
  );
  return {
    ...actual,
    loadClawdletsConfig: loadClawdletsConfigMock,
  };
});

vi.mock("../src/lib/deploy-gate.js", () => ({
  requireDeployGate: requireDeployGateMock,
}));

const hostName = "clawdbot-beta-4";
const baseHost = {
  enable: true,
  diskDevice: "/dev/sda",
  sshAuthorizedKeys: [],
  flakeHost: "",
  targetHost: "admin@100.64.0.10",
  hetzner: { serverType: "cx43" },
  opentofu: { adminCidr: "203.0.113.10/32", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
  sshExposure: { mode: "tailnet" },
  tailnet: { mode: "tailscale" },
  operator: { deploy: { enable: true } },
  agentModelPrimary: "zai/glm-4.7",
};

function setConfig() {
  loadClawdletsConfigMock.mockReturnValue({
    layout: getRepoLayout("/repo"),
    configPath: "/repo/fleet/clawdlets.json",
    config: {
      schemaVersion: 5,
      defaultHost: hostName,
      fleet: { bots: ["maren"] },
      hosts: {
        [hostName]: baseHost,
      },
    },
  });
}

describe("lockdown command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConfig();
    loadDeployCredsMock.mockReturnValue({
      envFile: { status: "ok", path: "/repo/.clawdlets/env" },
      values: { HCLOUD_TOKEN: "token", GITHUB_TOKEN: "", NIX_BIN: "nix" },
    });
  });

  it("applies opentofu vars without ssh", async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(tmpdir(), "clawdlets-lockdown-"));
    const keyPath = path.join(tempDir, "id_ed25519.pub");
    await fs.promises.writeFile(keyPath, "ssh-ed25519 AAAA", "utf8");
    loadClawdletsConfigMock.mockReturnValue({
      layout: getRepoLayout("/repo"),
      configPath: "/repo/fleet/clawdlets.json",
      config: {
        schemaVersion: 5,
        defaultHost: hostName,
        fleet: { bots: ["maren"] },
        hosts: {
          [hostName]: {
            ...baseHost,
            opentofu: {
              ...baseHost.opentofu,
              sshPubkeyFile: keyPath,
            },
          },
        },
      },
    });

    const { lockdown } = await import("../src/commands/lockdown.ts");
    await lockdown.run({
      args: {
        host: hostName,
        rev: "HEAD",
        ref: "",
        skipRebuild: false,
        skipTofu: false,
        dryRun: false,
        sshTty: false,
      } as any,
    });

    expect(applyOpenTofuVarsMock).toHaveBeenCalled();
    expect(sshCaptureMock).not.toHaveBeenCalled();
    expect(sshRunMock).not.toHaveBeenCalled();
  });
});
