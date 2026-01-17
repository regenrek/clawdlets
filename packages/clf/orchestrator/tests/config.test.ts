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
    expect(max.cattle.bootstrapTtlMs).toBe(60 * 60_000);
  });
});

