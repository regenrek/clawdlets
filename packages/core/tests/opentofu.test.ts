import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const runMock = vi.fn(async () => {});
const ensureKeyMock = vi.fn(async () => "123");

vi.mock("../src/lib/run.js", () => ({
  run: runMock,
  capture: vi.fn(async () => ""),
  captureWithInput: vi.fn(async () => ""),
}));

vi.mock("../src/lib/hcloud.js", () => ({
  ensureHcloudSshKeyId: ensureKeyMock,
}));

describe("opentofu", () => {
  beforeEach(() => {
    runMock.mockClear();
    ensureKeyMock.mockClear();
  });

  it("destroyOpenTofuVars runs init + destroy with vars", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-opentofu-"));
    try {
      const opentofuDir = path.join(repoRoot, ".clawdlets", "infra", "opentofu");
      const sshPubkeyFile = path.join(repoRoot, "id_ed25519.pub");
      await writeFile(sshPubkeyFile, "ssh-ed25519 AAAATEST test\n", "utf8");

      const { destroyOpenTofuVars } = await import("../src/lib/opentofu");
      await destroyOpenTofuVars({
        opentofuDir,
        vars: {
          hostName: "clawdbot-fleet-host",
          hcloudToken: "token",
          adminCidr: "203.0.113.10/32",
          adminCidrIsWorldOpen: false,
          sshPubkeyFile,
          serverType: "cx43",
          sshExposureMode: "tailnet",
          tailnetMode: "tailscale",
        },
        nixBin: "nix",
      });

      expect(runMock).toHaveBeenCalledTimes(2);

      const [cmd1, args1, opts1] = runMock.mock.calls[0] as any[];
      expect(cmd1).toBe("nix");
      expect(opts1.cwd).toBe(opentofuDir);
      expect(args1).toEqual(["run", "--impure", "nixpkgs#opentofu", "--", "init", "-input=false"]);

      const [cmd2, args2, opts2] = runMock.mock.calls[1] as any[];
      expect(cmd2).toBe("nix");
      expect(opts2.cwd).toBe(opentofuDir);
      expect(args2.slice(0, 5)).toEqual(["run", "--impure", "nixpkgs#opentofu", "--", "destroy"]);
      expect(args2).toContain("-auto-approve");
      expect(args2).toContain("-input=false");
      expect(args2).toContain("hcloud_token=token");
      expect(args2).toContain("admin_cidr=203.0.113.10/32");
      expect(args2).toContain("admin_cidr_is_world_open=false");
      expect(args2).toContain("ssh_key_id=123");
      expect(args2).toContain("ssh_exposure_mode=tailnet");
      expect(args2).toContain("tailnet_mode=tailscale");
      expect(args2).toContain("server_type=cx43");

      expect(ensureKeyMock).toHaveBeenCalledTimes(1);
      expect(ensureKeyMock.mock.calls[0]?.[0]).toMatchObject({ token: "token", name: "clawdbot-admin" });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
