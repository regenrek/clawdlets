import { describe, it, expect } from "vitest";
import path from "node:path";

describe("repo-layout path safety", () => {
  it("rejects unsafe host segments in host path helpers", async () => {
    const { getRepoLayout, getHostSecretsDir, getHostExtraFilesDir } = await import("../src/repo-layout");
    const layout = getRepoLayout("/repo", "/repo/.clawdlets");
    expect(() => getHostSecretsDir(layout, "../pwn")).toThrow(/invalid host name/i);
    expect(() => getHostExtraFilesDir(layout, "../pwn")).toThrow(/invalid host name/i);
  });

  it("rejects unsafe bot ids in getBotWorkspaceDir", async () => {
    const { getRepoLayout, getBotWorkspaceDir } = await import("../src/repo-layout");
    const layout = getRepoLayout("/repo", "/repo/.clawdlets");
    expect(() => getBotWorkspaceDir(layout, "../pwn")).toThrow(/invalid bot id/i);
    expect(() => getBotWorkspaceDir(layout, "A")).toThrow(/invalid bot id/i);
  });

  it("rejects unsafe secret names in getHostSecretFile", async () => {
    const { getRepoLayout, getHostSecretFile } = await import("../src/repo-layout");
    const layout = getRepoLayout("/repo", "/repo/.clawdlets");
    expect(() => getHostSecretFile(layout, "clawdbot-fleet-host", "../pwn")).toThrow(/invalid secret name/i);
  });

  it("builds expected paths for valid inputs", async () => {
    const { getRepoLayout, getBotWorkspaceDir, getHostSecretsDir, getHostSecretFile, getHostExtraFilesKeyPath } = await import("../src/repo-layout");
    const layout = getRepoLayout("/repo", "/repo/.clawdlets");

    expect(getHostSecretsDir(layout, "clawdbot-fleet-host")).toBe(path.join("/repo", "secrets", "hosts", "clawdbot-fleet-host"));
    expect(getHostSecretFile(layout, "clawdbot-fleet-host", "admin_password_hash")).toBe(
      path.join("/repo", "secrets", "hosts", "clawdbot-fleet-host", "admin_password_hash.yaml"),
    );
    expect(getHostExtraFilesKeyPath(layout, "clawdbot-fleet-host")).toBe(
      path.join("/repo", ".clawdlets", "extra-files", "clawdbot-fleet-host", "var", "lib", "sops-nix", "key.txt"),
    );
    expect(getBotWorkspaceDir(layout, "maren")).toBe(path.join("/repo", "fleet", "workspaces", "bots", "maren"));
  });
});
