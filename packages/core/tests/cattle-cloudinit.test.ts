import { describe, it, expect } from "vitest";

describe("cattle-cloudinit", () => {
  it("builds cloud-init user-data with required files", async () => {
    const { buildCattleCloudInitUserData } = await import("../src/lib/cattle-cloudinit");

    const userData = buildCattleCloudInitUserData({
      hostname: "cattle-rex-1700000000",
      adminAuthorizedKeys: ["ssh-ed25519 AAA"],
      tailscaleAuthKey: "tskey-auth-123",
      task: { schemaVersion: 1, taskId: "issue-42", type: "clawdbot.gateway.agent", message: "do it", callbackUrl: "" },
      publicEnv: { CLAWDLETS_CATTLE_AUTO_SHUTDOWN: "0" },
      secretsBootstrap: { baseUrl: "http://clawdlets-pet:18337", token: "bootstrap-token" },
      extraWriteFiles: [{ path: "/var/lib/clawdlets/identity/SOUL.md", permissions: "0600", owner: "root:root", content: "# Rex\n" }],
    });

    expect(userData.startsWith("#cloud-config\n")).toBe(true);
    expect(userData).toMatch(/cattle\/task\.json/);
    expect(userData).toMatch(/tailscale_auth_key/);
    expect(userData).toMatch(/bootstrap\.json/);
    expect(userData).toMatch(/env\.public/);
    expect(userData).toMatch(/identity\/SOUL\.md/);
    expect(userData).toMatch(/hostname:\s*cattle-rex-1700000000/);
  });

  it("rejects non-public env vars (no secrets in user_data)", async () => {
    const { buildCattleCloudInitUserData } = await import("../src/lib/cattle-cloudinit");

    expect(() =>
      buildCattleCloudInitUserData({
        hostname: "cattle-rex-1700000000",
        adminAuthorizedKeys: ["ssh-ed25519 AAA"],
        tailscaleAuthKey: "tskey-auth-123",
        task: { schemaVersion: 1, taskId: "t", type: "clawdbot.gateway.agent", message: "m", callbackUrl: "" },
        publicEnv: { ZAI_API_KEY: "secret" } as any,
        secretsBootstrap: { baseUrl: "http://clawdlets-pet:18337", token: "bootstrap-token" },
      }),
    ).toThrow(/cloud-init env not allowed/i);
  });

  it("rejects unsupported public env vars", async () => {
    const { buildCattleCloudInitUserData } = await import("../src/lib/cattle-cloudinit");

    expect(() =>
      buildCattleCloudInitUserData({
        hostname: "cattle-rex-1700000000",
        adminAuthorizedKeys: ["ssh-ed25519 AAA"],
        tailscaleAuthKey: "tskey-auth-123",
        task: { schemaVersion: 1, taskId: "t", type: "clawdbot.gateway.agent", message: "m", callbackUrl: "" },
        publicEnv: { CLAWDLETS_RANDOM: "1" } as any,
      }),
    ).toThrow(/cloud-init env not supported/i);
  });

  it("rejects oversized user-data", async () => {
    const { buildCattleCloudInitUserData } = await import("../src/lib/cattle-cloudinit");

    expect(() =>
      buildCattleCloudInitUserData({
        hostname: "cattle-rex-1700000000",
        adminAuthorizedKeys: ["ssh-ed25519 AAA"],
        tailscaleAuthKey: "tskey-auth-123",
        task: { schemaVersion: 1, taskId: "t", type: "clawdbot.gateway.agent", message: "m", callbackUrl: "" },
        extraWriteFiles: [
          { path: "/x", permissions: "0600", owner: "root:root", content: "x".repeat(40_000) },
        ],
      }),
    ).toThrow(/user_data too large/i);
  });

  it("always strips callbackUrl from task.json", async () => {
    const { buildCattleCloudInitUserData } = await import("../src/lib/cattle-cloudinit");

    const userData = buildCattleCloudInitUserData({
      hostname: "cattle-rex-1700000000",
      adminAuthorizedKeys: ["ssh-ed25519 AAA"],
      tailscaleAuthKey: "tskey-auth-123",
      task: {
        schemaVersion: 1,
        taskId: "issue-42",
        type: "clawdbot.gateway.agent",
        message: "do it",
        callbackUrl: "https://evil.example/cb",
      },
    });

    expect(userData).toMatch(/\"callbackUrl\": \"\"/);
    expect(userData).not.toMatch(/evil\\.example/);
  });
});
