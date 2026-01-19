import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeConfig, baseHost } from "./fixtures.js";
import { getRepoLayout } from "@clawdlets/core/repo-layout";

const applyOpenTofuVarsMock = vi.fn();
const destroyOpenTofuVarsMock = vi.fn();
const loadDeployCredsMock = vi.fn();
const expandPathMock = vi.fn((v: string) => v);
const findRepoRootMock = vi.fn(() => "/repo");
const resolveHostNameOrExitMock = vi.fn(() => "alpha");
const loadClawdletsConfigMock = vi.fn();

vi.mock("@clawdlets/core/lib/opentofu", () => ({
  applyOpenTofuVars: applyOpenTofuVarsMock,
  destroyOpenTofuVars: destroyOpenTofuVarsMock,
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

vi.mock("../src/lib/host-resolve.js", () => ({
  resolveHostNameOrExit: resolveHostNameOrExitMock,
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

describe("infra command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies opentofu vars", async () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-infra-"));
    const pubkey = path.join(tmp, "id_ed25519.pub");
    fs.writeFileSync(pubkey, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEk4yXx5oKXxmA3k2xZ6oUw1wK8bC9B8dJr3p+o8k8P test", "utf8");
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: {
        ...baseHost,
        provisioning: { ...baseHost.provisioning, adminCidr: "203.0.113.10/32", sshPubkeyFile: pubkey },
      },
    });
    const layout = getRepoLayout("/repo");
    loadClawdletsConfigMock.mockReturnValue({ layout, config });
    loadDeployCredsMock.mockReturnValue({
      envFile: { status: "ok", path: "/repo/.clawdlets/env" },
      values: { HCLOUD_TOKEN: "token", NIX_BIN: "nix", GITHUB_TOKEN: "" },
    });
    const { infra } = await import("../src/commands/infra.js");
    await infra.subCommands?.apply?.run?.({ args: { host: "alpha", dryRun: true } } as any);
    expect(applyOpenTofuVarsMock).toHaveBeenCalled();
  });

  it("destroy requires force when no TTY", async () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-infra-destroy-"));
    const pubkey = path.join(tmp, "id_ed25519.pub");
    fs.writeFileSync(pubkey, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEk4yXx5oKXxmA3k2xZ6oUw1wK8bC9B8dJr3p+o8k8P test", "utf8");
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, provisioning: { ...baseHost.provisioning, sshPubkeyFile: pubkey } },
    });
    const layout = getRepoLayout("/repo");
    loadClawdletsConfigMock.mockReturnValue({ layout, config });
    loadDeployCredsMock.mockReturnValue({
      envFile: { status: "ok", path: "/repo/.clawdlets/env" },
      values: { HCLOUD_TOKEN: "token", NIX_BIN: "nix", GITHUB_TOKEN: "" },
    });
    const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const { infra } = await import("../src/commands/infra.js");
    await expect(infra.subCommands?.destroy?.run?.({ args: { host: "alpha" } } as any)).rejects.toThrow(/refusing to destroy/i);
    if (original) Object.defineProperty(process.stdin, "isTTY", original);
  });
});
