import { describe, expect, it } from "vitest"

describe("secrets write allowlist", () => {
  it("rejects unmanaged secret names", async () => {
    const { ClawdletsConfigSchema } = await import("@clawdlets/core/lib/clawdlets-config")
    const { assertSecretsAreManaged, buildManagedHostSecretNameAllowlist } = await import("../src/sdk/secrets-allowlist")

    const config = ClawdletsConfigSchema.parse({
      schemaVersion: 9,
      fleet: { botOrder: [], bots: {}, secretEnv: {} },
      hosts: { alpha: { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" } },
    })

    const allowlist = buildManagedHostSecretNameAllowlist({ config, host: "alpha" })
    expect(() => assertSecretsAreManaged({ allowlist, secrets: { unmanaged_secret: "value" } })).toThrow(
      /unmanaged secret name/i,
    )
  })

  it("includes required host secrets", async () => {
    const { ClawdletsConfigSchema } = await import("@clawdlets/core/lib/clawdlets-config")
    const { buildManagedHostSecretNameAllowlist } = await import("../src/sdk/secrets-allowlist")

    const config = ClawdletsConfigSchema.parse({
      schemaVersion: 9,
      fleet: {
        botOrder: [],
        bots: {},
        secretEnv: {},
        backups: { restic: { enable: true, repository: "s3://restic" } },
      },
      hosts: {
        alpha: {
          tailnet: { mode: "tailscale" },
          cache: { garnix: { private: { enable: true, netrcSecret: "garnix_netrc" } } },
        },
      },
    })

    const allowlist = buildManagedHostSecretNameAllowlist({ config, host: " alpha " })
    expect(allowlist.has("admin_password_hash")).toBe(true)
    expect(allowlist.has("tailscale_auth_key")).toBe(true)
    expect(allowlist.has("garnix_netrc")).toBe(true)
    expect(allowlist.has("restic_password")).toBe(true)
  })
})
