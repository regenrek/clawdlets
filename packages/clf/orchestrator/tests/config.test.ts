import { describe, it, expect } from "vitest";

describe("clf-orchestrator config", () => {
  it("bounds bootstrap token TTL", async () => {
    const { loadClfOrchestratorConfigFromEnv } = await import("../src/config");

    const min = loadClfOrchestratorConfigFromEnv({
      HCLOUD_TOKEN: "token",
      TAILSCALE_AUTH_KEY: "tskey-auth-123",
      CLF_CATTLE_IMAGE: "img",
      CLF_CATTLE_SECRETS_BASE_URL: "",
      CLF_CATTLE_BOOTSTRAP_TTL_MS: "1000",
    } as any);
    expect(min.cattle.bootstrapTtlMs).toBe(30_000);

    const max = loadClfOrchestratorConfigFromEnv({
      HCLOUD_TOKEN: "token",
      TAILSCALE_AUTH_KEY: "tskey-auth-123",
      CLF_CATTLE_IMAGE: "img",
      CLF_CATTLE_SECRETS_BASE_URL: "",
      CLF_CATTLE_BOOTSTRAP_TTL_MS: String(99 * 60 * 60_000),
    } as any);
    expect(max.cattle.bootstrapTtlMs).toBe(15 * 60_000);
  });

  it("rejects invalid secrets base url", async () => {
    const { loadClfOrchestratorConfigFromEnv } = await import("../src/config");
    expect(() =>
      loadClfOrchestratorConfigFromEnv({
        HCLOUD_TOKEN: "token",
        TAILSCALE_AUTH_KEY: "tskey-auth-123",
        CLF_CATTLE_IMAGE: "img",
        CLF_CATTLE_SECRETS_BASE_URL: "ftp://bad",
      } as any),
    ).toThrow(/invalid CLF_CATTLE_SECRETS_BASE_URL/i);
  });

  it("rejects missing required env vars", async () => {
    const { loadClfOrchestratorConfigFromEnv } = await import("../src/config");
    expect(() => loadClfOrchestratorConfigFromEnv({} as any)).toThrow(/missing HCLOUD_TOKEN/i);
  });

  it("rejects invalid bool env values", async () => {
    const { loadClfOrchestratorConfigFromEnv } = await import("../src/config");
    expect(() =>
      loadClfOrchestratorConfigFromEnv({
        HCLOUD_TOKEN: "token",
        TAILSCALE_AUTH_KEY: "tskey-auth-123",
        CLF_CATTLE_IMAGE: "img",
        CLF_CATTLE_SECRETS_BASE_URL: "",
        CLF_CATTLE_AUTO_SHUTDOWN: "maybe",
      } as any),
    ).toThrow(/invalid bool env value/i);
  });

  it("rejects invalid int env values", async () => {
    const { loadClfOrchestratorConfigFromEnv } = await import("../src/config");
    expect(() =>
      loadClfOrchestratorConfigFromEnv({
        HCLOUD_TOKEN: "token",
        TAILSCALE_AUTH_KEY: "tskey-auth-123",
        CLF_CATTLE_IMAGE: "img",
        CLF_CATTLE_SECRETS_BASE_URL: "",
        CLF_CATTLE_MAX_INSTANCES: "x",
      } as any),
    ).toThrow(/invalid int env value/i);
  });
});
