import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
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
      await mkdir(path.join(repoRoot, "infra", "opentofu"), { recursive: true });
      const sshPubkeyFile = path.join(repoRoot, "id_ed25519.pub");
      await writeFile(sshPubkeyFile, "ssh-ed25519 AAAATEST test\n", "utf8");

      const { destroyOpenTofuVars } = await import("../src/lib/opentofu");
      await destroyOpenTofuVars({
        repoRoot,
        vars: {
          hcloudToken: "token",
          adminCidr: "203.0.113.10/32",
          sshPubkeyFile,
          serverType: "cx43",
          publicSsh: false,
        },
        nixBin: "nix",
      });

      expect(runMock).toHaveBeenCalledTimes(2);

      const [cmd1, args1, opts1] = runMock.mock.calls[0] as any[];
      expect(cmd1).toBe("nix");
      expect(opts1.cwd).toBe(path.join(repoRoot, "infra", "opentofu"));
      expect(args1).toEqual(["run", "--impure", "nixpkgs#opentofu", "--", "init", "-input=false"]);

      const [cmd2, args2, opts2] = runMock.mock.calls[1] as any[];
      expect(cmd2).toBe("nix");
      expect(opts2.cwd).toBe(path.join(repoRoot, "infra", "opentofu"));
      expect(args2.slice(0, 5)).toEqual(["run", "--impure", "nixpkgs#opentofu", "--", "destroy"]);
      expect(args2).toContain("-auto-approve");
      expect(args2).toContain("-input=false");
      expect(args2).toContain("hcloud_token=token");
      expect(args2).toContain("admin_cidr=203.0.113.10/32");
      expect(args2).toContain("ssh_key_id=123");
      expect(args2).toContain("public_ssh=false");
      expect(args2).toContain("server_type=cx43");

      expect(ensureKeyMock).toHaveBeenCalledTimes(1);
      expect(ensureKeyMock.mock.calls[0]?.[0]).toMatchObject({ token: "token", name: "clawdbot-admin" });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

